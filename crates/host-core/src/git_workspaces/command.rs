//! Bounded local Git command execution and owned process-tree cleanup.
use super::{internal, Result};
use std::{
    path::Path,
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};
pub(super) const OUTPUT_LIMIT: u64 = 1024 * 1024;

#[derive(Debug)]
pub(super) struct GitOutput {
    pub(super) status: ExitStatus,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
}
impl GitOutput {
    pub(super) fn text(&self) -> Result<String> {
        String::from_utf8(self.stdout.clone())
            .map_err(|_| internal("Git returned non-UTF-8 metadata"))
    }
    pub(super) fn checked(self) -> Result<Self> {
        if self.status.success() {
            Ok(self)
        } else {
            Err(internal(format!(
                "Git failed ({}): {}",
                self.status,
                String::from_utf8_lossy(&self.stderr).trim()
            )))
        }
    }
}
pub(super) async fn bounded_read(reader: impl AsyncRead + Unpin) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(OUTPUT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > OUTPUT_LIMIT {
        return Err(std::io::Error::other(
            "Git output exceeded the metadata limit",
        ));
    }
    Ok(bytes)
}

pub(super) fn command(project: &Path, overrides: &[String], args: &[&str]) -> Command {
    let mut command = Command::new("git");
    // Do not inherit a caller's alternate Git directory, config injection,
    // tracing sink, credential helper or pager settings.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", null)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_LFS_SKIP_SMUDGE", "1")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env("LANGUAGE", "C")
        .args([
            "-c",
            &format!("core.hooksPath={null}"),
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "submodule.recurse=false",
            "-c",
            "protocol.allow=never",
            "-c",
            "core.pager=cat",
        ]);
    for value in overrides {
        command.arg("-c").arg(value);
    }
    command
        .args(args)
        .current_dir(project)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    #[cfg(unix)]
    command.process_group(0);
    command
}
/// Own the entire Git process tree, including Git's internal reset helpers.
struct ProcessTree {
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}
// Windows job handles are process-wide kernel capabilities with no Rust
// thread affinity. This owner transfers with its async operation and is closed
// exactly once, matching the existing Bash process ownership contract.
#[cfg(windows)]
unsafe impl Send for ProcessTree {}
impl ProcessTree {
    fn assign(child: &tokio::process::Child) -> Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                pid: child
                    .id()
                    .ok_or_else(|| internal("Git process ID unavailable"))?,
            })
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err(internal("Unable to create Git process job"));
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
            };
            let assigned = child
                .raw_handle()
                .is_some_and(|handle| unsafe { AssignProcessToJobObject(job, handle) != 0 });
            if configured == 0 || !assigned {
                unsafe {
                    CloseHandle(job);
                }
                return Err(internal("Unable to contain Git process tree"));
            }
            Ok(Self { job })
        }
        #[cfg(all(not(unix), not(windows)))]
        {
            let _ = child;
            Err(internal(
                "Git process ownership unsupported on this platform",
            ))
        }
    }
    fn terminate(&self) {
        #[cfg(unix)]
        {
            unsafe {
                libc::killpg(self.pid as libc::pid_t, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        {
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
            }
        }
    }
}
impl Drop for ProcessTree {
    fn drop(&mut self) {
        self.terminate();
        #[cfg(windows)]
        {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
        }
    }
}

pub(super) async fn run(command: Command, timeout: Duration) -> Result<GitOutput> {
    run_input(command, timeout, None).await
}
pub(super) async fn run_input(
    mut command: Command,
    timeout: Duration,
    input: Option<Vec<u8>>,
) -> Result<GitOutput> {
    if timeout.is_zero() {
        return Err(internal("Git operation timed out"));
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|e| internal(format!("Unable to start Git: {e}")))?;
    let ownership = ProcessTree::assign(&child)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| internal("Git stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| internal("Git stderr unavailable"))?;
    let stdin = child.stdin.take();
    let operation = async {
        let write = async move {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(&input).await?;
            }
            Ok::<_, std::io::Error>(())
        };
        let (status, stdout, stderr, _) = tokio::try_join!(
            child.wait(),
            bounded_read(stdout),
            bounded_read(stderr),
            write
        )?;
        Ok::<_, std::io::Error>(GitOutput {
            status,
            stdout,
            stderr,
        })
    };
    match tokio::time::timeout(timeout, operation).await {
        Ok(Ok(output)) => Ok(output),
        result => {
            ownership.terminate();
            // kill_on_drop also reaps the direct child when cancelled.
            if let Err(error) = child.kill().await {
                tracing::warn!(%error, "Git child cleanup failed");
            }
            let _ = child.wait().await;
            match result {
                Ok(Err(error)) => Err(internal(error)),
                Err(_) => Err(internal("Git operation timed out")),
                Ok(Ok(_)) => unreachable!(),
            }
        }
    }
}
