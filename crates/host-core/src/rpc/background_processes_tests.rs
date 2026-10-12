//! Public RPC user paths against real local shells and an isolated database.
use super::*;
use crate::background_processes as jobs;
use tempfile::TempDir;

struct Fixture {
    _dir: TempDir,
    state: Arc<Mutex<AppState>>,
    session: String,
    shell: String,
    tx: mpsc::UnboundedSender<String>,
    rx: mpsc::UnboundedReceiver<String>,
}
impl Fixture {
    fn new(permission: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let shell = tools::shell::catalog(None).effective.unwrap().id;
        let session = sessions::create_session(
            &app.db,
            Some("Background test".into()),
            Some("agent".into()),
            None,
            None,
            Some(dir.path().to_string_lossy().into_owned()),
        )
        .unwrap();
        sessions::configure_session_with_thinking(
            &app.db,
            &session.id,
            "agent",
            None,
            None,
            None,
            Some(permission),
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
    async fn call(&self, method: &str, params: Value) -> Result<Value, JsonRpcError> {
        handle_request(self.state.clone(), method, params, self.tx.clone()).await
    }
    async fn start(&self, call: &str, command: &str, timeout: u64) -> Value {
        self.call("tools.execute",json!({"sessionId":self.session,"toolCallId":call,"toolName":"Bash","args":{"command":command,"run_in_background":true},"timeoutMs":timeout,"expectedCommandShellId":self.shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&self.shell),"mode":"agent"})).await.unwrap()
    }
    async fn read(&self, id: &str) -> Value {
        self.call(
            "backgroundProcesses.read",
            json!({"sessionId":self.session,"id":id}),
        )
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
#[cfg(not(windows))]
#[tokio::test]
async fn background_user_path_output_completion_duplicate_and_restart() {
    let mut f = Fixture::new("auto");
    let start = f
        .start("complete", "printf '你好'; printf 'warning' >&2", 5000)
        .await;
    assert_eq!(start["ok"], true);
    assert_eq!(start["content"]["status"], "starting");
    assert!(start["content"].get("exitCode").is_none());
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    let read = f.terminal(id).await;
    assert_eq!(read["process"]["status"], "completed");
    assert_eq!(read["process"]["exitCode"], 0);
    assert_eq!(read["stdout"], "你好");
    assert_eq!(read["stderr"], "warning");
    let duplicate = f.start("complete", "printf should-not-execute", 5000).await;
    assert_eq!(duplicate["content"]["backgroundProcessId"], id);
    assert_eq!(duplicate["content"]["status"], "completed");
    assert_eq!(f.read(id).await["stdout"], "你好");
    assert_eq!(f.state.lock().await.tool_budget.snapshot().active, 0);
    assert!(f.state.lock().await.active_bash_cancellations.is_empty());
    let list = f
        .call("backgroundProcesses.list", json!({"sessionId":f.session}))
        .await
        .unwrap();
    assert_eq!(list["processes"].as_array().unwrap().len(), 1);
    let st = f.state.lock().await;
    let reopened = AppState::open(&st.data_dir).unwrap();
    assert_eq!(
        jobs::read(&reopened, &f.session, id).unwrap()["stdout"],
        "你好"
    );
}
#[cfg(not(windows))]
#[tokio::test]
async fn background_nonzero_timeout_and_bounded_output_spill() {
    let mut f = Fixture::new("auto");
    let failed = f
        .start("fail", "printf before; printf error >&2; exit 7", 5000)
        .await;
    let failed = f
        .terminal(failed["content"]["backgroundProcessId"].as_str().unwrap())
        .await;
    assert_eq!(failed["process"]["status"], "failed");
    assert_eq!(failed["process"]["exitCode"], 7);
    assert_eq!(failed["stderr"], "error");
    let timed = f
        .start("timeout", "printf before-timeout; sleep 30", 1000)
        .await;
    let timed = f
        .terminal(timed["content"]["backgroundProcessId"].as_str().unwrap())
        .await;
    assert_eq!(timed["process"]["status"], "timed_out");
    assert_eq!(timed["stdout"], "before-timeout");
    let message = timed["errorMessage"].as_str().unwrap();
    assert!(message.contains("explicit 1 second"), "{message}");
    assert!(
        message.contains("timeout") && message.contains("21600"),
        "{message}"
    );
    let id = timed["process"]["id"].as_str().unwrap();
    let persisted: String = f
        .state
        .lock()
        .await
        .db
        .conn
        .query_row(
            "SELECT result_json FROM background_processes WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    let persisted: Value = serde_json::from_str(&persisted).unwrap();
    assert_eq!(persisted["content"]["timeoutMs"], 1000);
    assert_eq!(persisted["content"]["timeoutIsDefault"], false);
    let large=f.start("large","head -c 120000 /dev/zero | tr '\\0' x; head -c 120000 /dev/zero | tr '\\0' y >&2; printf tail >&2",5000).await;
    let id = large["content"]["backgroundProcessId"].as_str().unwrap();
    let large = f.terminal(id).await;
    assert_eq!(large["process"]["status"], "completed");
    assert_eq!(large["stdout"].as_str().unwrap().len(), 65536);
    assert_eq!(large["stderr"].as_str().unwrap().len(), 65536);
    assert!(large["stderr"].as_str().unwrap().ends_with("tail"));
    assert_eq!(large["stdoutTruncated"], true);
    assert_eq!(large["stderrTruncated"], true);
    let st = f.state.lock().await;
    let encoded: String = st
        .db
        .conn
        .query_row(
            "SELECT result_json FROM background_processes WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(result["content"]["truncated"], true);
    assert!(result["content"]["stdout"]
        .as_str()
        .unwrap()
        .contains("saved to"));
}
#[cfg(not(windows))]
#[tokio::test]
async fn background_blocks_project_move_after_turn_ends_until_stopped() {
    let mut f = Fixture::new("auto");
    let target = tempfile::tempdir().unwrap();
    let turn = f
        .call("session.beginTurn", json!({"sessionId":f.session}))
        .await
        .unwrap();
    let start = f.start("move", "printf started; sleep 30", 60000).await;
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    f.call(
        "session.endTurn",
        json!({"turnId":turn["turnId"],"status":"completed","createNotification":false}),
    )
    .await
    .unwrap();
    assert!(!sessions::session_has_running_turn(&f.state.lock().await.db, &f.session).unwrap());

    let blocked = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.session,"projectPath":target.path()}),
        )
        .await;
    let before_stop = f
        .call("session.get", json!({"id":f.session}))
        .await
        .unwrap();
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.session,"id":id}),
    )
    .await
    .unwrap();
    assert_eq!(f.terminal(id).await["process"]["status"], "stopped");
    let moved = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.session,"projectPath":target.path()}),
        )
        .await
        .unwrap();

    assert_eq!(
        blocked.unwrap_err().data.unwrap()["errorCode"],
        "SESSION_HAS_BACKGROUND_PROCESSES"
    );
    assert_eq!(
        before_stop["session"]["projectPath"],
        crate::db::canonical_project_path(&f._dir.path().to_string_lossy()).unwrap()
    );
    assert_eq!(
        moved["session"]["projectPath"],
        crate::db::canonical_project_path(&target.path().to_string_lossy()).unwrap()
    );
    assert_eq!(
        f.read(id).await["process"]["cwd"],
        crate::db::canonical_project_path(&f._dir.path().to_string_lossy()).unwrap()
    );
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_stop_is_session_scoped_idempotent_and_blocks_deletion() {
    let mut f = Fixture::new("auto");
    let start = f.start("stop", "printf started; sleep 30", 60000).await;
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    assert_eq!(f.state.lock().await.tool_budget.snapshot().shell, 1);
    {
        let st = f.state.lock().await;
        let error = st
            .db
            .conn
            .execute("DELETE FROM sessions WHERE id=?1", [&f.session])
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("SESSION_HAS_BACKGROUND_PROCESSES"));
        assert!(sessions::session_mode(&st.db, &f.session)
            .unwrap()
            .is_some());
    }

    let other = {
        let st = f.state.lock().await;
        sessions::create_session(&st.db, None, Some("agent".into()), None, None, None)
            .unwrap()
            .id
    };
    let error = f
        .call(
            "backgroundProcesses.stop",
            json!({"sessionId":other,"id":id}),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "BACKGROUND_PROCESS_NOT_FOUND"
    );
    let error = f
        .call("session.delete", json!({"id":f.session}))
        .await
        .unwrap_err();
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "SESSION_HAS_BACKGROUND_PROCESSES"
    );
    let error = f
        .call("projects.remove", json!({"path":f._dir.path()}))
        .await
        .unwrap_err();
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "SESSION_HAS_BACKGROUND_PROCESSES"
    );
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.session,"id":id}),
    )
    .await
    .unwrap();
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.session,"id":id}),
    )
    .await
    .unwrap();
    assert_eq!(f.terminal(id).await["process"]["status"], "stopped");
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.session,"id":id}),
    )
    .await
    .unwrap();
    assert_eq!(f.state.lock().await.tool_budget.snapshot().active, 0);
    assert_eq!(
        f.call("session.delete", json!({"id":f.session}))
            .await
            .unwrap()["ok"],
        true
    );
    assert!(jobs::get(&f.state.lock().await.db, &f.session, id)
        .unwrap()
        .is_none());
}
#[cfg(not(windows))]
#[tokio::test]
async fn background_shutdown_drains_and_restart_never_resumes() {
    let f = Fixture::new("auto");
    let start = f.start("shutdown", "sleep 30", 60000).await;
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    f.drain().await;
    assert_eq!(
        jobs::read(&*f.state.lock().await, &f.session, id).unwrap()["process"]["status"],
        "interrupted"
    );
    let st = f.state.lock().await;
    assert!(st.active_bash_cancellations.is_empty());
    assert_eq!(st.tool_budget.snapshot().active, 0);
    st.db
        .conn
        .execute(
            "UPDATE background_processes SET status='running',ended_at=NULL WHERE id=?1",
            [id],
        )
        .unwrap();
    let reopened = AppState::open(&st.data_dir).unwrap();
    assert_eq!(
        jobs::get(&reopened.db, &f.session, id)
            .unwrap()
            .unwrap()
            .status,
        "interrupted"
    );
    assert!(reopened.background_jobs.is_empty());
}
#[cfg(not(windows))]
#[tokio::test]
async fn background_denial_never_spawns_or_occupies_admission() {
    let f = Fixture::new("ask");
    let state = f.state.clone();
    let tx = f.tx.clone();
    let session = f.session.clone();
    let shell = f.shell.clone();
    let pending = tokio::spawn(async move {
        handle_request(state,"tools.execute",json!({"sessionId":session,"toolCallId":"denied","toolName":"Bash","args":{"command":"printf forbidden","run_in_background":true},"expectedCommandShellId":shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&shell),"mode":"agent"}),tx).await
    });
    let mut rx = f.rx;
    let request = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
            if event["method"] == "permissions.request" {
                break event["params"].clone();
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(f.state.lock().await.tool_budget.snapshot().active, 0);
    assert!(jobs::list(&f.state.lock().await.db, &f.session)
        .unwrap()
        .is_empty());
    handle_request(
        f.state.clone(),
        "permissions.resolve",
        json!({"requestId":request["requestId"],"decision":"deny"}),
        f.tx.clone(),
    )
    .await
    .unwrap();
    let result = pending.await.unwrap().unwrap();
    assert_eq!(result["errorCode"], "TOOL_DENIED");
    assert!(jobs::list(&f.state.lock().await.db, &f.session)
        .unwrap()
        .is_empty());
    assert!(f.state.lock().await.active_bash_cancellations.is_empty());
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_holds_shell_capacity_until_stop_and_releases_to_queued_job() {
    let mut f = Fixture::new("auto");
    let mut ids = Vec::new();
    for index in 0..4 {
        let result = f
            .start(&format!("capacity-{index}"), "sleep 30", 60000)
            .await;
        ids.push(
            result["content"]["backgroundProcessId"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    assert_eq!(f.state.lock().await.tool_budget.snapshot().shell, 4);
    let state = f.state.clone();
    let session = f.session.clone();
    let shell = f.shell.clone();
    let tx = f.tx.clone();
    let queued = tokio::spawn(async move {
        handle_request(state,"tools.execute",json!({"sessionId":session,"toolCallId":"queued","toolName":"Bash","args":{"command":"printf queued-output","run_in_background":true},"timeoutMs":5000,"expectedCommandShellId":shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&shell),"mode":"agent"}),tx).await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if f.state.lock().await.tool_budget.snapshot().queued == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!queued.is_finished());
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.session,"id":ids[0]}),
    )
    .await
    .unwrap();
    let started = tokio::time::timeout(Duration::from_secs(5), queued)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let completed = f
        .terminal(started["content"]["backgroundProcessId"].as_str().unwrap())
        .await;
    assert_eq!(completed["stdout"], "queued-output");
    assert_eq!(completed["process"]["status"], "completed");
    f.drain().await;
    assert_eq!(f.state.lock().await.tool_budget.snapshot().active, 0);
}

#[tokio::test]
async fn background_flag_is_validated_before_approval() {
    let f = Fixture::new("ask");
    let error=f.call("tools.execute",json!({"sessionId":f.session,"toolCallId":"invalid","toolName":"Bash","args":{"command":"printf forbidden","run_in_background":"yes"},"expectedCommandShellId":f.shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&f.shell),"mode":"agent"})).await.unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "INVALID_PARAMS");
    let st = f.state.lock().await;
    assert_eq!(st.tool_budget.snapshot().active, 0);
    assert!(st.active_bash_cancellations.is_empty());
    assert!(jobs::list(&st.db, &f.session).unwrap().is_empty());
}

#[test]
fn background_list_caps_history_without_dropping_dedupe() {
    let f = Fixture::new("auto");
    let st = f.state.blocking_lock();
    for index in 0..101 {
        st.db.conn.execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES(?1,?2,?3,'history','/','completed',?4)",rusqlite::params![format!("id-{index:03}"),f.session,format!("call-{index}"),(chrono::DateTime::parse_from_rfc3339("2026-10-09T00:00:00+00:00").unwrap()+chrono::Duration::seconds(index)).to_rfc3339()]).unwrap();
    }
    let list = jobs::list(&st.db, &f.session).unwrap();
    assert_eq!(list.len(), 100);
    assert_eq!(list[0].id, "id-100");
    st.db.conn.execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES('old-active',?1,'old-active','active','/','running','2000-01-01T00:00:00+00:00')",[&f.session]).unwrap();
    let with_active = jobs::list(&st.db, &f.session).unwrap();
    assert_eq!(with_active.len(), 101);
    assert_eq!(with_active.last().unwrap().id, "old-active");
    st.db.conn.execute_batch(jobs::SCHEMA).unwrap();
    let error = st
        .db
        .conn
        .execute("DELETE FROM sessions WHERE id=?1", [&f.session])
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("SESSION_HAS_BACKGROUND_PROCESSES"));

    assert!(jobs::duplicate(&st.db, &f.session, "call-0")
        .unwrap()
        .is_some());
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_already_cancelled_runner_does_not_spawn() {
    let f = Fixture::new("auto");
    let marker = f._dir.path().join("must-not-exist");
    let (_sender, receiver) = tokio::sync::watch::channel(true);
    let result = tools::execute_tool_with_path_access(
        Some(f._dir.path()),
        None,
        "Bash",
        &json!({"command":format!("printf leaked > '{}'",marker.display())}),
        tools::ToolExecutionOptions {
            timeout_ms: Some(5000),
            allow_external_paths: false,
            hashline: None,
            bash_options: Some(tools::BashExecutionOptions {
                service: false,
                session_id: f.session,
                tool_call_id: "already-cancelled".into(),
                command_shell_id: f.shell,
                timeout_ms: Some(5000),
                cancellation: Some(receiver),
                output_tx: None,
                background_output: None,
            }),
        },
    )
    .await;
    assert_eq!(result.error_code.as_deref(), Some("TOOL_ABORTED"));
    assert!(!marker.exists());
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_terminal_persistence_failure_retains_output_and_retries_on_read() {
    let mut f = Fixture::new("auto");
    {
        let st = f.state.lock().await;
        st.db.conn.execute_batch("CREATE TRIGGER reject_background_completion BEFORE UPDATE ON background_processes WHEN NEW.status IN ('completed','failed','stopped','timed_out','interrupted') BEGIN SELECT RAISE(ABORT,'injected finalization failure'); END;").unwrap();
    }
    let start = f
        .start("persist-failure", "printf retained-output", 5000)
        .await;
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    let terminal = f.terminal(id).await;
    assert_eq!(terminal["process"]["status"], "completed");
    assert_eq!(terminal["stdout"], "retained-output");
    assert!(terminal["persistenceError"]
        .as_str()
        .unwrap()
        .contains("injected finalization failure"));
    {
        let st = f.state.lock().await;
        assert_eq!(st.tool_budget.snapshot().active, 0);
        assert!(st.active_bash_cancellations.is_empty());
        assert!(st.background_outputs.contains_key(id));
        assert!(st.pending_background_finalizations.contains_key(id));
        assert_eq!(
            jobs::get(&st.db, &f.session, id).unwrap().unwrap().status,
            "running"
        );
    }
    let duplicate = f
        .start("persist-failure", "printf must-not-run", 5000)
        .await;
    assert_eq!(duplicate["content"]["status"], "completed");
    assert_eq!(duplicate["content"]["backgroundProcessId"], id);
    let listed = f
        .call("backgroundProcesses.list", json!({"sessionId":f.session}))
        .await
        .unwrap();
    assert_eq!(listed["processes"][0]["status"], "completed");
    let stopped = f
        .call(
            "backgroundProcesses.stop",
            json!({"sessionId":f.session,"id":id}),
        )
        .await
        .unwrap();
    assert_eq!(stopped["process"]["status"], "completed");
    let blocked = f
        .call("session.delete", json!({"id":f.session}))
        .await
        .unwrap_err();
    assert_eq!(
        blocked.data.unwrap()["errorCode"],
        "BACKGROUND_PROCESS_PERSISTENCE_FAILED"
    );
    let target = tempfile::tempdir().unwrap();
    let blocked = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.session,"projectPath":target.path()}),
        )
        .await
        .unwrap_err();
    assert_eq!(
        blocked.data.unwrap()["errorCode"],
        "BACKGROUND_PROCESS_PERSISTENCE_FAILED"
    );
    f.state
        .lock()
        .await
        .db
        .conn
        .execute_batch("DROP TRIGGER reject_background_completion")
        .unwrap();
    let repaired = f.read(id).await;
    assert_eq!(repaired["stdout"], "retained-output");
    assert_eq!(repaired["process"]["status"], "completed");
    assert!(repaired.get("persistenceError").is_none());
    {
        let st = f.state.lock().await;
        assert!(!st.background_outputs.contains_key(id));
        assert!(!st.pending_background_finalizations.contains_key(id));
        assert_eq!(
            jobs::get(&st.db, &f.session, id).unwrap().unwrap().status,
            "completed"
        );
    }
    let moved = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.session,"projectPath":target.path()}),
        )
        .await
        .unwrap();
    assert_eq!(
        moved["session"]["projectPath"],
        crate::db::canonical_project_path(&target.path().to_string_lossy()).unwrap()
    );
    assert_eq!(
        f.call("session.delete", json!({"id":f.session}))
            .await
            .unwrap()["ok"],
        true
    );
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_failed_execution_exposes_reason_even_without_output() {
    let mut f = Fixture::new("auto");
    let start = f.start("invalid-command", "\0", 5000).await;
    let id = start["content"]["backgroundProcessId"].as_str().unwrap();
    let terminal = f.terminal(id).await;
    assert_eq!(terminal["process"]["status"], "failed");
    assert_eq!(terminal["errorCode"], "INVALID_ARGUMENT");
    assert!(terminal["errorMessage"].as_str().unwrap().contains("NUL"));
    assert_eq!(terminal["stdout"], "");
    assert_eq!(terminal["stderr"], "");
}

#[cfg(not(windows))]
#[tokio::test]
async fn background_stop_reaches_owner_when_stopping_write_is_rejected() {
    for reject_terminal in [false, true] {
        let mut f = Fixture::new("auto");
        let start = f
            .start("stop-storage-failure", "printf stop-ready; sleep 30", 60000)
            .await;
        let id = start["content"]["backgroundProcessId"].as_str().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if f.read(id).await["stdout"] == "stop-ready" {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let blocked_statuses = if reject_terminal {
            "'stopping','stopped'"
        } else {
            "'stopping'"
        };
        f.state
            .lock()
            .await
            .db
            .conn
            .execute_batch(&format!(
                "CREATE TRIGGER reject_background_stop BEFORE UPDATE ON background_processes
             WHEN NEW.status IN ({blocked_statuses})
             BEGIN SELECT RAISE(ABORT,'injected stop persistence failure'); END;"
            ))
            .unwrap();
        let error = f
            .call(
                "backgroundProcesses.stop",
                json!({"sessionId":f.session,"id":id}),
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("injected stop persistence failure"));
        let signal_delivered = {
            let st = f.state.lock().await;
            let sender = st
                .active_bash_cancellations
                .get(&(f.session.clone(), "stop-storage-failure".into()))
                .unwrap();
            let delivered = *sender.borrow();
            // Keep the failing baseline isolated: clean up the old implementation's
            // child before asserting that the actual Stop request delivered its signal.
            if !delivered {
                sender.send_replace(true);
            }
            delivered
        };
        let terminal = f.terminal(id).await;
        assert_eq!(terminal["process"]["status"], "stopped");
        assert_eq!(terminal["stdout"], "stop-ready");
        {
            let st = f.state.lock().await;
            assert_eq!(st.tool_budget.snapshot().active, 0);
            assert!(st.active_bash_cancellations.is_empty());
            assert_eq!(
                st.pending_background_finalizations.contains_key(id),
                reject_terminal
            );
        }
        assert_eq!(terminal.get("persistenceError").is_some(), reject_terminal);
        f.state
            .lock()
            .await
            .db
            .conn
            .execute_batch("DROP TRIGGER reject_background_stop")
            .unwrap();
        let repaired = f.read(id).await;
        assert_eq!(repaired["process"]["status"], "stopped");
        assert_eq!(repaired["stdout"], "stop-ready");
        assert!(repaired.get("persistenceError").is_none());
        assert!(!f
            .state
            .lock()
            .await
            .pending_background_finalizations
            .contains_key(id));
        assert!(
            signal_delivered,
            "Stop must reach the process owner despite a rejected status write"
        );
    }
}

#[test]
fn historical_background_timeout_records_do_not_invent_limit_provenance() {
    let f = Fixture::new("auto");
    let st = f.state.blocking_lock();
    let old = json!({"errorCode":"TOOL_TIMEOUT","content":{"error":"bash timed out"}}).to_string();
    st.db.conn.execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at,result_json) VALUES('old-timeout',?1,'old-timeout','old','/','timed_out','2026-10-09T00:00:00Z',?2)",rusqlite::params![f.session,old]).unwrap();
    let detail = jobs::read(&st, &f.session, "old-timeout").unwrap();
    assert_eq!(detail["errorMessage"], "bash timed out");
    assert!(detail.get("timeoutMs").is_none());
    assert!(detail["process"].get("timeoutIsDefault").is_none());
}
