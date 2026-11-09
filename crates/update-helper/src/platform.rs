//! Operating-system effects the installer needs, behind one trait so the
//! install sequence can be tested without touching a real application.

use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CODESIGN: &str = "/usr/bin/codesign";
const OPEN: &str = "/usr/bin/open";
const CODESIGN_TIMEOUT: Duration = Duration::from_secs(180);
const OPEN_TIMEOUT: Duration = Duration::from_secs(30);

pub trait Platform {
    fn process_alive(&self, pid: u32) -> bool;
    /// Atomically exchanges two directories on the same volume.
    fn exchange(&self, a: &Path, b: &Path) -> io::Result<()>;
    /// Pids of processes whose executable lives inside `bundle`.
    fn processes_in_bundle(&self, bundle: &Path) -> io::Result<Vec<u32>>;
    fn has_quarantine(&self, path: &Path) -> io::Result<bool>;
    /// Integrity check only (`codesign --verify --deep --strict`).
    fn verify_signature(&self, app: &Path) -> Result<(), String>;
    /// Starts a new instance of the app (`open -n`).
    fn launch(&self, app: &Path) -> io::Result<()>;
    fn sleep(&self, duration: Duration);
    fn now_ms(&self) -> u64;
}

pub struct SystemPlatform;

impl Platform for SystemPlatform {
    fn process_alive(&self, pid: u32) -> bool {
        // Pid 0 would address the caller's whole process group.
        let Some(pid) = libc::pid_t::try_from(pid).ok().filter(|pid| *pid > 0) else {
            return false;
        };
        // SAFETY: signal 0 only checks that the process exists.
        if unsafe { libc::kill(pid, 0) } == 0 {
            return true;
        }
        io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
    }

    fn exchange(&self, a: &Path, b: &Path) -> io::Result<()> {
        sys::exchange(a, b)
    }

    fn processes_in_bundle(&self, bundle: &Path) -> io::Result<Vec<u32>> {
        let processes = sys::list_processes()?;
        Ok(paths_inside(bundle, &processes, std::process::id()))
    }

    fn has_quarantine(&self, path: &Path) -> io::Result<bool> {
        sys::has_quarantine(path)
    }

    fn verify_signature(&self, app: &Path) -> Result<(), String> {
        let args = [
            "--verify".as_ref(),
            "--deep".as_ref(),
            "--strict".as_ref(),
            app.as_os_str(),
        ];
        let (status, detail) =
            run_command(CODESIGN, &args, CODESIGN_TIMEOUT).map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("codesign exited with {status}: {detail}"))
        }
    }

    fn launch(&self, app: &Path) -> io::Result<()> {
        let args = ["-n".as_ref(), app.as_os_str()];
        let (status, detail) = run_command(OPEN, &args, OPEN_TIMEOUT)?;
        if status.success() {
            Ok(())
        } else {
            Err(io::Error::other(format!(
                "open exited with {status}: {detail}"
            )))
        }
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }

    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
    }
}

/// Pids whose executable path lies inside `bundle`, excluding `own_pid`.
pub fn paths_inside(bundle: &Path, processes: &[(u32, PathBuf)], own_pid: u32) -> Vec<u32> {
    let canonical = std::fs::canonicalize(bundle).unwrap_or_else(|_| bundle.to_path_buf());
    processes
        .iter()
        .filter(|(pid, path)| *pid != own_pid && path.starts_with(&canonical))
        .map(|(pid, _)| *pid)
        .collect()
}

/// Takes an exclusive, non-blocking lock on `path`. `None` means another
/// helper holds it. The lock lives as long as the returned file.
pub fn acquire_lock(path: &Path) -> io::Result<Option<File>> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    // SAFETY: the descriptor is valid for the lifetime of `file`.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(Some(file));
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::WouldBlock {
        Ok(None)
    } else {
        Err(error)
    }
}

/// Runs a program with a deadline and returns its status plus the first bytes
/// of stderr.
fn run_command(
    program: &str,
    args: &[&std::ffi::OsStr],
    timeout: Duration,
) -> io::Result<(ExitStatus, String)> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(pipe) = stderr.as_mut() {
            let mut bytes = Vec::new();
            let _ = pipe.by_ref().take(2048).read_to_end(&mut bytes);
            text = String::from_utf8_lossy(&bytes).trim().to_string();
            let _ = io::copy(pipe, &mut io::sink());
        }
        text
    });
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok((status, reader.join().unwrap_or_default()));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("{program} did not finish within {}s", timeout.as_secs()),
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(target_os = "macos")]
mod sys {
    use std::ffi::{CString, OsString};
    use std::io;
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    const QUARANTINE: &str = "com.apple.quarantine";

    fn c_path(path: &Path) -> io::Result<CString> {
        CString::new(path.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a NUL byte"))
    }

    pub fn exchange(a: &Path, b: &Path) -> io::Result<()> {
        let (a, b) = (c_path(a)?, c_path(b)?);
        // SAFETY: both pointers are valid NUL-terminated strings for the call.
        if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub fn has_quarantine(path: &Path) -> io::Result<bool> {
        let path = c_path(path)?;
        let name = CString::new(QUARANTINE).map_err(io::Error::other)?;
        // SAFETY: valid C strings; a null value with size 0 only queries the size.
        let size = unsafe {
            libc::getxattr(
                path.as_ptr(),
                name.as_ptr(),
                std::ptr::null_mut(),
                0,
                0,
                libc::XATTR_NOFOLLOW,
            )
        };
        if size >= 0 {
            return Ok(true);
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ENOATTR) {
            Ok(false)
        } else {
            Err(error)
        }
    }

    /// Every process the current user may inspect, with its executable path.
    pub fn list_processes() -> io::Result<Vec<(u32, PathBuf)>> {
        // SAFETY: a null buffer with size 0 only asks for the number of pids.
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count <= 0 {
            return Err(io::Error::last_os_error());
        }
        let capacity = count as usize + 64;
        let mut pids: Vec<libc::pid_t> = vec![0; capacity];
        let bytes = i32::try_from(capacity * std::mem::size_of::<libc::pid_t>())
            .map_err(|_| io::Error::other("process table is too large"))?;
        // SAFETY: the buffer holds `capacity` pid_t values and `bytes` matches it.
        let written = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
        if written <= 0 {
            return Err(io::Error::last_os_error());
        }
        pids.truncate(written as usize);
        let mut processes = Vec::new();
        for pid in pids.into_iter().filter(|pid| *pid > 0) {
            let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
            // SAFETY: the buffer is writable for its full length.
            let length =
                unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
            if length <= 0 {
                continue; // gone already, or owned by another user
            }
            buffer.truncate(length as usize);
            processes.push((pid as u32, PathBuf::from(OsString::from_vec(buffer))));
        }
        Ok(processes)
    }
}

#[cfg(not(target_os = "macos"))]
mod sys {
    use std::io;
    use std::path::{Path, PathBuf};

    fn unsupported<T>() -> io::Result<T> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the update helper only supports macOS",
        ))
    }

    pub fn exchange(_a: &Path, _b: &Path) -> io::Result<()> {
        unsupported()
    }

    pub fn has_quarantine(_path: &Path) -> io::Result<bool> {
        unsupported()
    }

    pub fn list_processes() -> io::Result<Vec<(u32, PathBuf)>> {
        unsupported()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_processes_inside_the_bundle() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundle = std::fs::canonicalize(dir.path())
            .expect("canonical")
            .join("X.app");
        std::fs::create_dir(&bundle).expect("bundle");
        let processes = vec![
            (10, bundle.join("Contents/MacOS/X")),
            (
                11,
                bundle.join("Contents/Frameworks/H.app/Contents/MacOS/H"),
            ),
            (
                12,
                PathBuf::from(format!("{}-sibling/bin", bundle.display())),
            ),
            (13, PathBuf::from("/usr/bin/true")),
            (
                14,
                bundle.join("Contents/Resources/bin/pi-desktop-host-core"),
            ),
        ];
        assert_eq!(paths_inside(&bundle, &processes, 14), vec![10, 11]);
    }

    #[test]
    fn lock_is_exclusive_until_the_holder_is_dropped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(".update.lock");
        let first = acquire_lock(&path).expect("lock").expect("free");
        assert!(acquire_lock(&path).expect("second attempt").is_none());
        drop(first);
        assert!(acquire_lock(&path).expect("third attempt").is_some());
    }

    #[test]
    fn own_process_is_alive_and_an_exited_child_is_not() {
        let platform = SystemPlatform;
        assert!(platform.process_alive(std::process::id()));
        let mut child = Command::new("sh")
            .args(["-c", "exit 0"])
            .spawn()
            .expect("spawn");
        let pid = child.id();
        child.wait().expect("wait");
        assert!(!platform.process_alive(pid));
        assert!(!platform.process_alive(0));
    }

    #[test]
    fn command_deadline_kills_a_stuck_child() {
        let error = run_command("sleep", &["5".as_ref()], Duration::from_millis(200))
            .expect_err("deadline");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use std::fs;

        #[test]
        fn exchange_swaps_two_directories_atomically() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (a, b) = (dir.path().join("A.app"), dir.path().join("B.app"));
            for (path, content) in [(&a, "a"), (&b, "b")] {
                fs::create_dir_all(path.join("Contents")).expect("dir");
                fs::write(path.join("Contents/marker"), content).expect("marker");
            }
            SystemPlatform.exchange(&a, &b).expect("exchange");
            assert_eq!(
                fs::read_to_string(a.join("Contents/marker")).expect("a"),
                "b"
            );
            assert_eq!(
                fs::read_to_string(b.join("Contents/marker")).expect("b"),
                "a"
            );
            assert!(SystemPlatform
                .exchange(&a, &dir.path().join("missing.app"))
                .is_err());
        }

        #[test]
        fn process_listing_includes_this_test_binary() {
            let exe = fs::canonicalize(std::env::current_exe().expect("exe")).expect("canonical");
            let processes = sys::list_processes().expect("list");
            assert!(
                processes
                    .iter()
                    .any(|(pid, path)| *pid == std::process::id() && *path == exe),
                "own pid and path must be listed"
            );
            let inside = SystemPlatform
                .processes_in_bundle(exe.parent().expect("dir"))
                .expect("scan");
            assert!(!inside.contains(&std::process::id()), "own pid is excluded");
        }

        #[test]
        fn quarantine_attribute_is_detected_and_not_cleared() {
            let dir = tempfile::tempdir().expect("tempdir");
            let app = dir.path().join("Q.app");
            fs::create_dir(&app).expect("app");
            assert!(!SystemPlatform.has_quarantine(&app).expect("clean"));
            let status = Command::new("/usr/bin/xattr")
                .args(["-w", "com.apple.quarantine", "0081;00000000;Test;"])
                .arg(&app)
                .status()
                .expect("xattr");
            assert!(status.success());
            assert!(SystemPlatform.has_quarantine(&app).expect("marked"));
            assert!(SystemPlatform.has_quarantine(&app).expect("still marked"));
        }

        #[test]
        fn unsigned_bundle_fails_signature_verification() {
            let dir = tempfile::tempdir().expect("tempdir");
            let app = dir.path().join("U.app");
            fs::create_dir_all(app.join("Contents/MacOS")).expect("dirs");
            let error = SystemPlatform.verify_signature(&app).expect_err("unsigned");
            assert!(error.contains("codesign"), "{error}");
        }
    }
}
