//! Report-only check for processes that outlive a cancelled Bash call.
//!
//! A cancelled call stops by signalling its runner's process group. A
//! descendant that called `setsid`, or otherwise left that group, survives the
//! stop, and the user would only see a stopped row. Before the stop this module
//! records the runner's live descendants. About a second after the stop it logs
//! any that are still running. It never signals a process and never changes the
//! abort result.
//!
//! Limits: only descendants still attached to the runner when the stop begins
//! are attributed; a process reparented earlier is not. Timeouts are not
//! covered. Windows has no report, because this module is Unix-only.

use std::collections::{HashMap, HashSet, VecDeque};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tracing::{debug, warn};

/// A stop must not wait long on a stuck process-table read.
const PS_TIMEOUT: Duration = Duration::from_millis(500);
/// Processes that exit on their own after the kill drop out of the report.
const REPORT_DELAY: Duration = Duration::from_secs(1);
const SUMMARY_LIMIT: usize = 20;
const PS_COLUMNS: &str = "pid=,ppid=,pgid=,stat=,lstart=,comm=";

/// One row of the process table. `lstart` tells a reused pid apart.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Row {
    pid: u32,
    ppid: u32,
    pgid: u32,
    state: String,
    lstart: String,
    name: String,
}

/// A descendant that was alive when the stop began.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Tracked {
    pid: u32,
    lstart: String,
    /// Already outside the runner's process group, so the group kill cannot
    /// reach it.
    escaped: bool,
}

/// Descendants captured before the stop. Empty when there were none or `ps`
/// failed.
#[derive(Debug, Default)]
pub(super) struct Snapshot {
    runner_pid: u32,
    tracked: Vec<Tracked>,
}

#[derive(Debug, PartialEq, Eq)]
struct Survivor {
    pid: u32,
    ppid: u32,
    pgid: u32,
    state: String,
    name: String,
    escaped: bool,
}

/// Records the runner's live descendants. Call before the stop: once the runner
/// exits, its children are reparented and can no longer be found from it.
pub(super) async fn capture(runner_pid: u32) -> Snapshot {
    match process_table().await {
        Ok(rows) => Snapshot {
            runner_pid,
            tracked: descendants(&rows, runner_pid),
        },
        Err(error) => {
            warn!(runner_pid, %error, "bash residual snapshot skipped");
            Snapshot {
                runner_pid,
                ..Snapshot::default()
            }
        }
    }
}

/// Logs, about a second later, the captured descendants that are still running.
/// Only observes: nothing here signals a process.
pub(super) fn schedule_report(snapshot: Snapshot) {
    if snapshot.tracked.is_empty() {
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(REPORT_DELAY).await;
        let rows = match process_table().await {
            Ok(rows) => rows,
            Err(error) => {
                warn!(runner_pid = snapshot.runner_pid, %error, "bash residual check failed");
                return;
            }
        };
        let alive = survivors(&snapshot.tracked, &rows);
        if alive.is_empty() {
            debug!(
                runner_pid = snapshot.runner_pid,
                "bash residual check found no survivors"
            );
        } else {
            warn!(
                runner_pid = snapshot.runner_pid,
                count = alive.len(),
                processes = %summarize(&alive),
                "cancelled bash left processes running; they were not terminated"
            );
        }
    });
}

/// Reads the whole process table. A fixed locale keeps the `lstart` text the
/// same across calls, because the survivor check compares it. The timeout drops
/// the child, and `kill_on_drop` ends it.
async fn process_table() -> Result<Vec<Row>, String> {
    let mut command = Command::new("/bin/ps");
    command
        .args(["-A", "-ww", "-o", PS_COLUMNS])
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(PS_TIMEOUT, command.output())
        .await
        .map_err(|_| "ps timed out".to_string())?
        .map_err(|error| format!("ps did not start: {error}"))?;
    if !output.status.success() {
        return Err(format!("ps exited with {}", output.status));
    }
    Ok(parse_rows(&String::from_utf8_lossy(&output.stdout)))
}

/// Parses `PS_COLUMNS` output. BSD `ps` prints the executable path in `comm` and
/// procps prints a short name, so only the last path segment is kept. `lstart`
/// spans five fields in both formats, so the name is whatever follows nine.
fn parse_rows(text: &str) -> Vec<Row> {
    text.lines().filter_map(parse_row).collect()
}

fn parse_row(line: &str) -> Option<Row> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 9 {
        return None;
    }
    let name = fields[9..].join(" ");
    Some(Row {
        pid: fields[0].parse().ok()?,
        ppid: fields[1].parse().ok()?,
        pgid: fields[2].parse().ok()?,
        state: fields[3].to_string(),
        lstart: fields[4..9].join(" "),
        name: name.rsplit('/').next().unwrap_or_default().to_string(),
    })
}

fn is_zombie(state: &str) -> bool {
    state.starts_with('Z')
}

/// Breadth-first walk over `ppid` from the runner. An escaped process is still a
/// child of the runner until the runner dies, so the walk reaches it. The runner
/// itself is never tracked, and a zombie is neither tracked nor expanded.
fn descendants(rows: &[Row], runner_pid: u32) -> Vec<Tracked> {
    let Some(runner_pgid) = rows
        .iter()
        .find(|row| row.pid == runner_pid)
        .map(|row| row.pgid)
    else {
        return Vec::new();
    };
    let mut children: HashMap<u32, Vec<&Row>> = HashMap::new();
    for row in rows {
        children.entry(row.ppid).or_default().push(row);
    }
    let mut seen = HashSet::from([runner_pid]);
    let mut queue = VecDeque::from([runner_pid]);
    let mut tracked = Vec::new();
    while let Some(parent) = queue.pop_front() {
        for child in children.get(&parent).into_iter().flatten() {
            if !seen.insert(child.pid) || is_zombie(&child.state) {
                continue;
            }
            tracked.push(Tracked {
                pid: child.pid,
                lstart: child.lstart.clone(),
                escaped: child.pgid != runner_pgid,
            });
            queue.push_back(child.pid);
        }
    }
    tracked
}

/// Tracked processes that are still the same process: same pid and start time,
/// and not a zombie. A reused pid carries a later start time.
fn survivors(tracked: &[Tracked], rows: &[Row]) -> Vec<Survivor> {
    let by_pid: HashMap<u32, &Row> = rows.iter().map(|row| (row.pid, row)).collect();
    tracked
        .iter()
        .filter_map(|tracked| {
            let row = by_pid.get(&tracked.pid)?;
            if row.lstart != tracked.lstart || is_zombie(&row.state) {
                return None;
            }
            Some(Survivor {
                pid: row.pid,
                ppid: row.ppid,
                pgid: row.pgid,
                state: row.state.clone(),
                name: row.name.clone(),
                escaped: tracked.escaped,
            })
        })
        .collect()
}

/// Names, pids and states only, capped so one stop logs a bounded line.
fn summarize(alive: &[Survivor]) -> String {
    let mut parts: Vec<String> = alive
        .iter()
        .take(SUMMARY_LIMIT)
        .map(|process| {
            format!(
                "{} pid={} ppid={} pgid={} state={} escaped={}",
                process.name,
                process.pid,
                process.ppid,
                process.pgid,
                process.state,
                process.escaped
            )
        })
        .collect();
    if alive.len() > SUMMARY_LIMIT {
        parts.push(format!("and {} more", alive.len() - SUMMARY_LIMIT));
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::{shell, BashExecutionOptions};
    use serde_json::json;
    use std::process::Command as StdCommand;
    use std::sync::{Arc, Mutex};
    use tokio::sync::watch;

    const START: &str = "Fri Oct 17 10:00:00 2026";
    const LATER: &str = "Fri Oct 17 10:05:00 2026";

    fn row(pid: u32, ppid: u32, pgid: u32, state: &str, name: &str) -> Row {
        Row {
            pid,
            ppid,
            pgid,
            state: state.into(),
            lstart: START.into(),
            name: name.into(),
        }
    }

    #[test]
    fn parses_bsd_and_procps_rows() {
        // BSD prints the executable path; procps prints a short name and pads
        // single-digit days.
        let text = "  4242     1  4242 Ss   Fri Oct 17 10:00:00 2026 /bin/zsh\n\
                       77  4242    77 S+   Wed Oct  7 09:01:02 2026 sleep\n";
        assert_eq!(
            parse_rows(text),
            vec![
                row(4242, 1, 4242, "Ss", "zsh"),
                Row {
                    pid: 77,
                    ppid: 4242,
                    pgid: 77,
                    state: "S+".into(),
                    lstart: "Wed Oct 7 09:01:02 2026".into(),
                    name: "sleep".into(),
                },
            ]
        );
    }

    #[test]
    fn skips_malformed_rows_and_keeps_the_zombie_state() {
        let text = "garbage\n 9 4242 4242 Z Fri Oct 17 10:00:00 2026 <defunct>\n 10 4242\n";
        assert_eq!(parse_rows(text), vec![row(9, 4242, 4242, "Z", "<defunct>")]);
    }

    #[test]
    fn descendants_follow_ppid_and_mark_processes_outside_the_group() {
        let rows = vec![
            row(100, 1, 100, "Ss", "zsh"),
            row(101, 100, 100, "S", "perl"),
            row(102, 100, 102, "S", "sleep"),
            row(103, 102, 102, "S", "sleep"),
            row(200, 1, 200, "S", "unrelated"),
        ];
        let found: Vec<(u32, bool)> = descendants(&rows, 100)
            .iter()
            .map(|tracked| (tracked.pid, tracked.escaped))
            .collect();
        // 101 shares the runner's group; 102 and its child 103 left it.
        assert_eq!(found, vec![(101, false), (102, true), (103, true)]);
    }

    #[test]
    fn zombies_are_neither_tracked_nor_expanded() {
        let rows = vec![
            row(100, 1, 100, "Ss", "zsh"),
            row(101, 100, 101, "Z", "sleep"),
            row(102, 101, 101, "S", "orphan"),
        ];
        assert!(descendants(&rows, 100).is_empty());
    }

    #[test]
    fn a_missing_runner_tracks_nothing() {
        assert!(descendants(&[row(200, 1, 200, "S", "unrelated")], 100).is_empty());
    }

    #[test]
    fn a_self_parented_row_cannot_loop_or_track_the_runner() {
        let rows = vec![
            row(100, 1, 100, "Ss", "zsh"),
            row(100, 100, 100, "Ss", "zsh"),
        ];
        assert!(descendants(&rows, 100).is_empty());
    }

    #[test]
    fn a_grandchild_stays_tracked_after_its_parent_dies() {
        let tracked = descendants(
            &[
                row(100, 1, 100, "Ss", "zsh"),
                row(102, 100, 102, "S", "sleep"),
                row(103, 102, 102, "S", "sleep"),
            ],
            100,
        );
        // The middle process exits, and the grandchild is reparented to init.
        let alive = survivors(&tracked, &[row(103, 1, 102, "S", "sleep")]);
        assert_eq!(alive.iter().map(|s| s.pid).collect::<Vec<_>>(), vec![103]);
        assert!(alive[0].escaped);
    }

    #[test]
    fn a_reused_pid_with_a_later_start_time_is_not_a_survivor() {
        let tracked = descendants(
            &[
                row(100, 1, 100, "Ss", "zsh"),
                row(102, 100, 102, "S", "sleep"),
            ],
            100,
        );
        let reused = Row {
            lstart: LATER.into(),
            ..row(102, 1, 102, "S", "other")
        };
        assert!(survivors(&tracked, &[reused]).is_empty());
    }

    #[test]
    fn a_zombie_survivor_is_not_reported() {
        let tracked = descendants(
            &[
                row(100, 1, 100, "Ss", "zsh"),
                row(102, 100, 102, "S", "sleep"),
            ],
            100,
        );
        assert!(survivors(&tracked, &[row(102, 1, 102, "Z", "sleep")]).is_empty());
    }

    #[test]
    fn the_summary_caps_the_listed_processes_and_counts_the_rest() {
        let alive: Vec<Survivor> = (0..25)
            .map(|pid| Survivor {
                pid,
                ppid: 1,
                pgid: pid,
                state: "S".into(),
                name: "sleep".into(),
                escaped: true,
            })
            .collect();
        let summary = summarize(&alive);
        assert_eq!(summary.matches(" escaped=true").count(), SUMMARY_LIMIT);
        assert!(summary.ends_with("and 5 more"), "{summary}");
    }

    /// Kills the test's own sleep when the test ends, including after a failed
    /// assertion. The start time must still match, so a reused pid is never hit.
    struct SleepGuard {
        pid: u32,
        lstart: String,
    }

    impl Drop for SleepGuard {
        fn drop(&mut self) {
            if lstart_of(self.pid).as_deref() == Some(self.lstart.as_str()) {
                // SAFETY: the pid was just confirmed to be the sleep this test started.
                unsafe { libc::kill(self.pid as libc::pid_t, libc::SIGKILL) };
            }
        }
    }

    /// Returns `(runner pid, sleep pid)` for the `sleep <marker>` this test started.
    async fn wait_for_sleep(marker: &str) -> (u32, u32) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            if let Some(found) = find_sleep(marker) {
                return found;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "sleep {marker} never started"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    fn find_sleep(marker: &str) -> Option<(u32, u32)> {
        let wanted = format!("sleep {marker}");
        let output = StdCommand::new("/bin/ps")
            .args(["-A", "-ww", "-o", "pid=,ppid=,command="])
            .env("LC_ALL", "C")
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| {
                let mut fields = line.split_whitespace();
                let pid: u32 = fields.next()?.parse().ok()?;
                let ppid: u32 = fields.next()?.parse().ok()?;
                (fields.collect::<Vec<_>>().join(" ") == wanted).then_some((ppid, pid))
            })
    }

    /// The start time identifies a process; `None` once it has exited.
    fn lstart_of(pid: u32) -> Option<String> {
        let pid_text = pid.to_string();
        let output = StdCommand::new("/bin/ps")
            .args(["-o", "lstart=", "-p", pid_text.as_str()])
            .env("LC_ALL", "C")
            .output()
            .ok()?;
        let start = String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        (!start.is_empty()).then_some(start)
    }

    /// Collects formatted log lines in memory, so the test can read what the host
    /// writes to the stream that Electron records in the host log.
    #[derive(Clone)]
    struct LogBuffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if let Ok(mut bytes) = self.0.lock() {
                bytes.extend_from_slice(buf);
            }
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn cancelled_bash_reports_a_setsid_survivor_without_terminating_it() {
        // A unique duration tells this test's sleep apart from other processes.
        const MARKER: &str = "4711";
        // Thread-local, so it covers this test's current-thread runtime and the
        // report task that `schedule_report` spawns on it.
        let log_bytes = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_writer({
                let log_bytes = log_bytes.clone();
                move || LogBuffer(log_bytes.clone())
            })
            .finish();
        let _subscriber = tracing::subscriber::set_default(subscriber);
        let workspace = tempfile::tempdir().unwrap();
        let (abort_tx, abort_rx) = watch::channel(false);
        let options = BashExecutionOptions {
            service: false,
            session_id: "residual-session".into(),
            tool_call_id: "residual-call".into(),
            command_shell_id: shell::default_shell_id().into(),
            timeout_ms: Some(30_000),
            cancellation: Some(abort_rx),
            output_tx: None,
            background_output: None,
        };
        // `setsid` moves the sleep out of the runner's process group, so the
        // group kill cannot reach it. That is the case this report names.
        let script =
            format!("perl -MPOSIX -e 'POSIX::setsid() or die; exec q(sleep), q({MARKER})' & wait");
        let args = json!({ "command": script });
        let run = crate::tools::tool_bash(Some(workspace.path()), None, &args, options);
        let driver = async {
            let (runner, sleeper) = wait_for_sleep(MARKER).await;
            let guard = SleepGuard {
                pid: sleeper,
                lstart: lstart_of(sleeper).expect("sleep is running"),
            };
            let before = capture(runner).await;
            assert!(
                before.tracked.iter().any(|t| t.pid == sleeper && t.escaped),
                "{before:?}"
            );
            abort_tx.send(true).expect("the Bash call is listening");
            (guard, before)
        };
        let (result, (guard, before)) = tokio::join!(run, driver);
        match result {
            Err((code, _)) => assert_eq!(code, "TOOL_ABORTED"),
            Ok(value) => panic!("expected the cancelled call to abort, got {value}"),
        }
        // The residual is reported, not terminated: it is still the same process.
        assert_eq!(lstart_of(guard.pid).as_deref(), Some(guard.lstart.as_str()));
        let rows = process_table().await.expect("ps is available");
        assert!(survivors(&before.tracked, &rows)
            .iter()
            .any(|s| s.pid == guard.pid && s.escaped));
        // The report runs about a second after the stop. Poll for it rather than
        // sleep a fixed time, so a slow process-table read cannot flake the test.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let logged = loop {
            let text = String::from_utf8_lossy(&log_bytes.lock().expect("log buffer")).into_owned();
            if text.contains("left processes running") || tokio::time::Instant::now() >= deadline {
                break text;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        };
        // One WARN line must name this sleep as having escaped the group.
        let sleeper_entry = format!("pid={} ppid=", guard.pid);
        assert!(
            logged.lines().any(|line| line.contains("WARN")
                && line.contains("left processes running")
                && line.contains(&sleeper_entry)
                && line.contains("escaped=true")),
            "expected a WARN report naming the escaped sleep:\n{logged}"
        );
        // The report only observes: the sleep is still the same process.
        assert_eq!(lstart_of(guard.pid).as_deref(), Some(guard.lstart.as_str()));
    }
}
