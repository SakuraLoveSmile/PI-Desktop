//! Service-only bounded graceful stop using the runner's verified ownership.
use super::{
    kill_and_reap, process_output_chunk, CapturedOutput, OutputChunk, OutputNotifier,
    ProcessOwnership,
};
use std::process::ExitStatus;
use std::time::Duration;
use tokio::{process::ChildStdin, sync::mpsc};

const GRACE: Duration = Duration::from_secs(5);

pub(super) async fn stop_or_kill(
    options: &super::BashExecutionOptions,
    runner: Runner<'_>,
    output: Output<'_>,
) -> Result<(), String> {
    if !options.service {
        return kill_and_reap(
            runner.pid,
            runner.ownership,
            runner.control,
            runner.wait_task,
        )
        .await;
    }
    let escalated = stop(runner, output).await?;
    if let Some(output) = &options.background_output {
        output
            .lock()
            .map_err(|_| "background service output lock poisoned".to_string())?
            .finish_service_stop(escalated);
    }
    Ok(())
}

pub(super) struct Runner<'a> {
    pub pid: u32,
    pub ownership: &'a mut ProcessOwnership,
    pub control: &'a mut Option<ChildStdin>,
    pub wait_task: &'a mut tokio::task::JoinHandle<std::io::Result<ExitStatus>>,
}
pub(super) struct Output<'a> {
    pub rx: &'a mut mpsc::Receiver<OutputChunk>,
    pub closed: &'a mut bool,
    pub stdout: &'a mut CapturedOutput,
    pub stderr: &'a mut CapturedOutput,
    pub notifier: &'a mut OutputNotifier,
}

/// Returns whether force escalation was needed. Windows intentionally uses its
/// existing JobObject stop, which is always forced rather than graceful.
pub(super) async fn stop(mut runner: Runner<'_>, output: Output<'_>) -> Result<bool, String> {
    #[cfg(unix)]
    {
        // The PID came directly from the still-owned Child, whose process group
        // was verified before start; persisted PIDs are never accepted here.
        let sent = unsafe { libc::killpg(runner.pid as libc::pid_t, libc::SIGTERM) };
        if sent != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                kill_and_reap(
                    runner.pid,
                    runner.ownership,
                    runner.control,
                    runner.wait_task,
                )
                .await?;
                return Err(format!(
                    "service TERM failed; owned tree forcibly stopped: {error}"
                ));
            }
        }
        let grace = tokio::time::sleep(GRACE);
        tokio::pin!(grace);
        let mut output_tick = tokio::time::interval(Duration::from_millis(100));
        loop {
            tokio::select! {
                waited = &mut runner.wait_task => {
                    let wait_error = match waited {
                        Ok(Ok(_)) => None,
                        Ok(Err(error)) => Some(format!("service wait failed: {error}")),
                        Err(error) => Some(format!("service wait task failed: {error}")),
                    };
                    // A shell may exit while an ignoring descendant still owns
                    // the group. Contain that group before releasing capacity.
                    let remaining = unsafe { libc::killpg(runner.pid as libc::pid_t, 0) } == 0;
                    if remaining { runner.ownership.terminate_fail_closed(runner.pid)?; }
                    runner.control.take();
                    return match wait_error { Some(error) => Err(error), None => Ok(remaining) };
                }
                _ = &mut grace => {
                    kill_and_reap(runner.pid,runner.ownership,runner.control,runner.wait_task).await?;
                    return Ok(true);
                }
                chunk = output.rx.recv(), if !*output.closed => {
                    match chunk {
                        Some(chunk) => process_output_chunk(chunk,output.stdout,output.stderr,output.notifier),
                        None => *output.closed = true,
                    }
                }
                _ = output_tick.tick() => output.notifier.flush_due(),
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = output;
        kill_and_reap(
            runner.pid,
            runner.ownership,
            runner.control,
            runner.wait_task,
        )
        .await?;
        Ok(true)
    }
}
