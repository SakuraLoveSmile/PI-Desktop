//! Server adoption against real local shells and an isolated database. Every test shortens the default
//! deadline, so none waits 60 seconds; the 60-second default itself is covered by the background limit
//! E2E script. Jobs start through `background_processes::start`, the same entry the Bash tool uses.
use super::*;
use crate::background_processes as jobs;
use crate::tools::server_adoption::{AdoptionLedger, Limits};
use tempfile::TempDir;

/// Stands in for the 60-second default. Long enough for a loaded machine to start a login shell and
/// print before it runs out; the tests that need an address after it use a longer `sleep`.
const DEFAULT_MS: u64 = 3000;
const SERVING: &str = "printf 'Local: http://localhost:5173/\\n'; sleep 30";

struct Fixture {
    _dir: TempDir,
    state: Arc<Mutex<AppState>>,
    session: String,
    shell: String,
    tx: mpsc::UnboundedSender<String>,
    rx: mpsc::UnboundedReceiver<String>,
}

/// A background job and the way to stop it.
struct Job {
    id: String,
    stop: tokio::sync::watch::Sender<bool>,
}

fn limits(per_session: usize, per_host: usize) -> Limits {
    Limits {
        per_session,
        per_host,
        lifetime: Duration::from_secs(600),
    }
}

impl Fixture {
    fn new(limits: Limits) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        app.server_adoption = Arc::new(AdoptionLedger::new(limits));
        let shell = tools::shell::catalog(None).effective.unwrap().id;
        let session = sessions::create_session(
            &app.db,
            Some("Adoption test".into()),
            Some("agent".into()),
            None,
            None,
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            _dir: dir,
            state: Arc::new(Mutex::new(app)),
            session: session.id,
            shell,
            tx,
            rx,
        }
    }

    /// Starts a background command. `explicit_timeout` is a model `timeout`; without one the job keeps
    /// the shortened default and is eligible for adoption, exactly like a launch with no `timeout`.
    async fn start(&self, call: &str, command: &str, explicit_timeout: Option<u64>) -> Job {
        let budget = self.state.lock().await.tool_budget.clone();
        let permit = budget.acquire(&self.session, "Bash").await.unwrap();
        let (stop, cancellation) = tokio::sync::watch::channel(false);
        let process = jobs::start(
            self.state.clone(),
            self.tx.clone(),
            jobs::ApprovedJob {
                service_scope: None,
                workspace: self._dir.path().to_path_buf(),
                scratch: None,
                args: json!({"command": command, "run_in_background": true}),
                options: tools::BashExecutionOptions {
                    service: false,
                    session_id: self.session.clone(),
                    tool_call_id: call.into(),
                    command_shell_id: self.shell.clone(),
                    timeout_ms: Some(explicit_timeout.unwrap_or(DEFAULT_MS)),
                    cancellation: Some(cancellation),
                    output_tx: None,
                    background_output: None,
                },
                permit,
                timeout_is_default: explicit_timeout.is_none(),
            },
        )
        .await
        .unwrap();
        Job {
            id: process.id,
            stop,
        }
    }

    async fn read(&self, id: &str) -> Value {
        handle_request(
            self.state.clone(),
            "backgroundProcesses.read",
            json!({"sessionId": self.session, "id": id}),
            self.tx.clone(),
        )
        .await
        .unwrap()
    }

    async fn status(&self, id: &str) -> String {
        self.read(id).await["process"]["status"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn address(&self, id: &str) -> Option<String> {
        let st = self.state.lock().await;
        jobs::list_view(&st, &self.session)
            .unwrap()
            .into_iter()
            .find(|process| process.id == id)
            .and_then(|process| process.address)
    }

    /// Waits until the command has printed its address.
    async fn announced(&self, id: &str) -> String {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(address) = self.address(id).await {
                    return address;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap()
    }

    async fn terminal(&mut self, id: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let result = self.read(id).await;
                if !matches!(
                    result["process"]["status"].as_str().unwrap(),
                    "starting" | "running" | "stopping"
                ) {
                    return result;
                }
                self.rx.recv().await.unwrap();
            }
        })
        .await
        .unwrap()
    }

    /// The terminal audit row of a process.
    async fn audit(&self, id: &str) -> Value {
        let st = self.state.lock().await;
        let payload: String = st
            .db
            .conn
            .query_row(
                "SELECT payload_json FROM audit_log WHERE kind = 'background_process_terminal' AND payload_json LIKE ?1 ORDER BY id DESC LIMIT 1",
                [format!("%{id}%")],
                |row| row.get(0),
            )
            .unwrap();
        serde_json::from_str(&payload).unwrap()
    }

    async fn drain(&self) {
        let jobs = {
            let mut st = self.state.lock().await;
            st.shutdown();
            std::mem::take(&mut st.background_jobs)
        };
        for (_, job) in jobs {
            job.await.unwrap();
        }
    }
}

fn message(read: &Value) -> String {
    read["errorMessage"]
        .as_str()
        .unwrap_or_default()
        .to_string()
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_server_that_announces_an_address_outlives_the_default_deadline() {
    let mut f = Fixture::new(limits(2, 2));
    let server = f.start("serve", SERVING, None).await;
    assert_eq!(f.announced(&server.id).await, "http://localhost:5173");

    // Well past the default: an ordinary command would be gone by now.
    tokio::time::sleep(Duration::from_millis(DEFAULT_MS + 500)).await;
    assert_eq!(f.status(&server.id).await, "running");
    assert_eq!(
        f.address(&server.id).await.as_deref(),
        Some("http://localhost:5173")
    );

    server.stop.send(true).unwrap();
    assert_eq!(f.terminal(&server.id).await["process"]["status"], "stopped");
    assert_eq!(f.audit(&server.id).await["serverAdoption"], "adopted");
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_command_that_prints_no_address_still_ends_at_the_default_deadline() {
    let mut f = Fixture::new(limits(2, 2));
    let quiet = f.start("quiet", "printf working; sleep 30", None).await;
    let ended = f.terminal(&quiet.id).await;
    assert_eq!(ended["process"]["status"], "timed_out");
    let text = message(&ended);
    assert!(text.contains("default 3 second"), "{text}");
    assert!(!text.contains("server limit"), "{text}");
    assert!(f.audit(&quiet.id).await.get("serverAdoption").is_none());
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn an_explicit_timeout_is_never_extended_even_for_a_server() {
    let mut f = Fixture::new(limits(2, 2));
    let explicit = f.start("explicit", SERVING, Some(DEFAULT_MS)).await;
    let ended = f.terminal(&explicit.id).await;
    assert_eq!(ended["process"]["status"], "timed_out");
    let text = message(&ended);
    assert!(text.contains("explicit 3 second"), "{text}");
    assert!(f.audit(&explicit.id).await.get("serverAdoption").is_none());
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn an_address_printed_after_the_default_deadline_came_too_late() {
    let mut f = Fixture::new(limits(2, 2));
    let slow = f
        .start(
            "slow",
            "sleep 6; printf 'Local: http://localhost:5173/\\n'; sleep 30",
            None,
        )
        .await;
    let ended = f.terminal(&slow.id).await;
    assert_eq!(ended["process"]["status"], "timed_out");
    assert!(message(&ended).contains("default 3 second"));
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_session_at_its_cap_keeps_the_default_deadline_and_the_message_says_why() {
    let mut f = Fixture::new(limits(1, 2));
    let first = f.start("first", SERVING, None).await;
    f.announced(&first.id).await;

    let second = f.start("second", SERVING, None).await;
    let refused = f.terminal(&second.id).await;
    assert_eq!(refused["process"]["status"], "timed_out");
    let text = message(&refused);
    assert!(text.contains("default 3 second"), "{text}");
    assert!(
        text.contains("this session already keeps 1 server running"),
        "{text}"
    );
    assert_eq!(f.audit(&second.id).await["serverAdoption"], "cap_reached");
    assert_eq!(f.status(&first.id).await, "running");

    first.stop.send(true).unwrap();
    assert_eq!(f.terminal(&first.id).await["process"]["status"], "stopped");
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_host_at_its_cap_keeps_the_default_deadline_and_the_message_says_why() {
    let mut f = Fixture::new(limits(2, 1));
    let first = f.start("first", SERVING, None).await;
    f.announced(&first.id).await;

    let second = f.start("second", SERVING, None).await;
    let refused = f.terminal(&second.id).await;
    assert_eq!(refused["process"]["status"], "timed_out");
    let text = message(&refused);
    assert!(
        text.contains("the Host already keeps 1 server running"),
        "{text}"
    );
    assert_eq!(f.audit(&second.id).await["serverAdoption"], "cap_reached");

    first.stop.send(true).unwrap();
    assert_eq!(f.terminal(&first.id).await["process"]["status"], "stopped");
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_slot_freed_before_the_deadline_is_used_at_the_deadline() {
    let mut f = Fixture::new(limits(1, 2));
    let first = f.start("first", SERVING, None).await;
    f.announced(&first.id).await;

    // The second command announces itself while the only slot is taken, so it is refused for now.
    let second = f
        .start(
            "second",
            "sleep 0.3; printf 'Local: http://localhost:6006/\\n'; sleep 30",
            None,
        )
        .await;
    assert_eq!(f.announced(&second.id).await, "http://localhost:6006");

    first.stop.send(true).unwrap();
    assert_eq!(f.terminal(&first.id).await["process"]["status"], "stopped");

    // Its deadline fires after the slot came back: it is kept instead of stopped.
    tokio::time::sleep(Duration::from_millis(DEFAULT_MS)).await;
    assert_eq!(f.status(&second.id).await, "running");

    second.stop.send(true).unwrap();
    assert_eq!(f.terminal(&second.id).await["process"]["status"], "stopped");
    assert_eq!(f.audit(&second.id).await["serverAdoption"], "adopted");
    f.drain().await;
}

#[cfg(not(windows))]
#[tokio::test]
async fn a_foreground_command_is_never_adopted() {
    let f = Fixture::new(limits(2, 2));
    let started = std::time::Instant::now();
    let result = tools::execute_tool_with_path_access(
        Some(f._dir.path()),
        None,
        "Bash",
        &json!({"command": SERVING}),
        tools::ToolExecutionOptions {
            timeout_ms: Some(DEFAULT_MS),
            allow_external_paths: false,
            hashline: None,
            bash_options: Some(tools::BashExecutionOptions {
                service: false,
                session_id: f.session.clone(),
                tool_call_id: "foreground".into(),
                command_shell_id: f.shell.clone(),
                timeout_ms: Some(DEFAULT_MS),
                cancellation: None,
                output_tx: None,
                background_output: None,
            }),
        },
    )
    .await;
    assert_eq!(result.error_code.as_deref(), Some("TOOL_TIMEOUT"));
    assert!(started.elapsed() < Duration::from_secs(20));
}
