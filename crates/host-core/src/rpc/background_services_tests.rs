//! Public service user paths with an isolated database and real owned shells.
//! Model routes point at an unused loopback port; no model request is made.
use super::*;
use crate::background_processes as jobs;

struct Fixture {
    data: tempfile::TempDir,
    state: Arc<Mutex<AppState>>,
    lead: String,
    turn: String,
    member: String,
    member_turn: String,
    shell: String,
    tx: mpsc::UnboundedSender<String>,
    rx: mpsc::UnboundedReceiver<String>,
}
impl Fixture {
    async fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let mut app = AppState::open(data.path()).unwrap();
        app.handshook = true;
        let shell = tools::shell::catalog(None).effective.unwrap().id;
        let state = Arc::new(Mutex::new(app));
        let (tx, rx) = mpsc::unbounded_channel();
        let mut fixture = Self {
            data,
            state,
            lead: String::new(),
            turn: String::new(),
            member: String::new(),
            member_turn: String::new(),
            shell,
            tx,
            rx,
        };
        let provider = fixture.call("providers.create",json!({"name":"Service fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
        let created = fixture.call("session.create",json!({"mode":"agent","executionProfile":"team","permissionMode":"auto","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":fixture.data.path()})).await.unwrap();
        fixture.lead = created["session"]["id"].as_str().unwrap().into();
        fixture
            .call(
                "session.configure",
                json!({"id":fixture.lead,"mode":"agent","permissionMode":"auto"}),
            )
            .await
            .unwrap();
        let turn = fixture
            .call("session.beginTurn", json!({"sessionId":fixture.lead}))
            .await
            .unwrap();
        fixture.turn = turn["turnId"].as_str().unwrap().into();
        let declared = fixture.call("team.declareStrategy",json!({"teamSessionId":fixture.lead,"callerSessionId":fixture.lead,"leadTurnId":fixture.turn,"strategy":"delegate","reason":"Isolated owned-service test","members":[{"name":"executor","presetId":"fullstack"}]})).await.unwrap();
        let confirmed = fixture.call("team.confirmLaunchReview",json!({"teamSessionId":fixture.lead,"reviewId":declared["review"]["reviewId"],"expectedRevision":declared["review"]["revision"]})).await.unwrap();
        fixture.member = confirmed["decision"]["memberSessionIds"][0]
            .as_str()
            .unwrap()
            .into();
        fixture
            .call(
                "session.configure",
                json!({"id":fixture.member,"mode":"agent","permissionMode":"auto"}),
            )
            .await
            .unwrap();
        let dispatch = fixture.call("team.sendMessage",json!({"teamSessionId":fixture.lead,"callerSessionId":fixture.lead,"target":"executor","content":"Run isolated fixture checks"})).await.unwrap();
        let member_turn = fixture
            .call(
                "session.beginTurn",
                json!({"sessionId":fixture.member,"sessionMessageId":dispatch["message"]["id"]}),
            )
            .await
            .unwrap();
        fixture.member_turn = member_turn["turnId"].as_str().unwrap().into();
        fixture
    }
    async fn call(&self, method: &str, params: Value) -> Result<Value, JsonRpcError> {
        handle_request(self.state.clone(), method, params, self.tx.clone()).await
    }
    fn launch(&self, call: &str, command: &str) -> Value {
        json!({"sessionId":self.lead,"turnId":self.turn,"toolCallId":call,"toolName":"Bash","args":{"command":command,"run_in_background":true,"backgroundKind":"service"},"expectedCommandShellId":self.shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&self.shell),"mode":"agent"})
    }
    async fn start(&self, call: &str, command: &str) -> String {
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.call("tools.execute", self.launch(call, command)),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(result["content"]["backgroundKind"], "service");
        result["content"]["backgroundProcessId"]
            .as_str()
            .unwrap()
            .into()
    }
    async fn read(&self, id: &str) -> Value {
        self.call(
            "backgroundProcesses.read",
            json!({"sessionId":self.lead,"id":id}),
        )
        .await
        .unwrap()
    }
    async fn ready(&mut self, id: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if self.read(id).await["stdout"]
                    .as_str()
                    .unwrap()
                    .contains("ready")
                {
                    break;
                }
                self.rx.recv().await.unwrap();
            }
        })
        .await
        .unwrap();
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
        for (_, task) in jobs {
            task.await.unwrap();
        }
    }
    async fn terminal_for(&mut self, session: &str, id: &str) -> Value {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let result = self
                    .call(
                        "backgroundProcesses.read",
                        json!({"sessionId":session,"id":id}),
                    )
                    .await
                    .unwrap();
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
}

#[tokio::test]
async fn service_arguments_reject_foreground_timeout_and_unconfirmed_owners() {
    let f = Fixture::new().await;
    for field in [
        "foreground",
        "timeout",
        "timeoutMs",
        "invalidKind",
        "wrongTurn",
    ] {
        let mut request = f.launch(field, "printf should-not-run");
        match field {
            "foreground" => request["args"]["run_in_background"] = json!(false),
            "timeout" => request["args"]["timeout"] = json!(90),
            "timeoutMs" => request["timeoutMs"] = json!(90_000),
            "invalidKind" => request["args"]["backgroundKind"] = json!("daemon"),
            _ => request["turnId"] = json!("forged-turn"),
        }
        assert!(f.call("tools.execute", request).await.is_err(), "{field}");
    }
    let outsider = f
        .call(
            "session.create",
            json!({"mode":"agent","permissionMode":"auto","projectPath":f.data.path()}),
        )
        .await
        .unwrap();
    let outsider = outsider["session"]["id"].as_str().unwrap();
    let turn = f
        .call("session.beginTurn", json!({"sessionId":outsider}))
        .await
        .unwrap();
    let mut request = f.launch("outsider", "printf should-not-run");
    request["sessionId"] = json!(outsider);
    request["turnId"] = turn["turnId"].clone();
    assert!(f.call("tools.execute", request).await.is_err());
    assert!(jobs::list(&f.state.lock().await.db, &f.lead)
        .unwrap()
        .is_empty());
    f.drain().await;
}

#[tokio::test]
async fn service_narrow_permission_scope_preserves_the_real_permission_card() {
    let mut f = Fixture::new().await;
    let mut request = f.launch("needs-ask", "printf should-not-run");
    request["permissionScope"] = json!("ask");
    let state = f.state.clone();
    let tx = f.tx.clone();
    let pending =
        tokio::spawn(async move { handle_request(state, "tools.execute", request, tx).await });
    let notification = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let value: Value = serde_json::from_str(&f.rx.recv().await.unwrap()).unwrap();
            if value["method"] == "permissions.request" {
                return value;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(notification["params"]["toolCallId"], "needs-ask");
    assert!(jobs::list(&f.state.lock().await.db, &f.lead)
        .unwrap()
        .is_empty());
    f.call(
        "tools.abort",
        json!({"sessionId":f.lead,"toolCallId":"needs-ask"}),
    )
    .await
    .unwrap();
    assert_eq!(pending.await.unwrap().unwrap()["errorCode"], "TOOL_ABORTED");
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_term_stop_retains_output_and_releases_all_capacity_once() {
    let mut f = Fixture::new().await;
    let id = f.start("friendly","trap 'printf stopped-after-term; exit 0' TERM; printf ready; while :; do sleep 30; done").await;
    f.ready(&id).await;
    let duplicate = f
        .call("tools.execute", f.launch("friendly", "printf different"))
        .await
        .unwrap();
    assert_eq!(duplicate["content"]["backgroundProcessId"], id);
    assert_eq!(
        jobs::list(&f.state.lock().await.db, &f.lead).unwrap().len(),
        1
    );
    let error = f
        .call("tools.execute", f.launch("over-quota", "printf rejected"))
        .await
        .unwrap_err();
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "TEAM_SERVICE_LIMIT_REACHED"
    );
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.lead,"id":id}),
    )
    .await
    .unwrap();
    let terminal = f.terminal(&id).await;
    assert_eq!(terminal["process"]["status"], "stopped");
    assert_eq!(terminal["process"]["stopReason"], "explicit_stop");
    assert_eq!(terminal["process"]["serviceStopEscalated"], false);
    assert!(terminal["stdout"]
        .as_str()
        .unwrap()
        .contains("stopped-after-term"));
    f.call(
        "backgroundProcesses.stop",
        json!({"sessionId":f.lead,"id":id}),
    )
    .await
    .unwrap();
    assert_eq!(
        f.read(&id).await["process"]["stopRequestedAt"],
        terminal["process"]["stopRequestedAt"]
    );
    let budget = f.state.lock().await.tool_budget.clone();
    let permit = tokio::time::timeout(Duration::from_secs(1), budget.acquire(&f.lead, "Bash"))
        .await
        .unwrap()
        .unwrap();
    drop(permit);
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_ignoring_term_is_forced_and_team_pause_preserves_command_jobs() {
    let mut f = Fixture::new().await;
    let id = f
        .start(
            "ignoring",
            "trap '' TERM; printf ready; while :; do sleep 30; done",
        )
        .await;
    f.ready(&id).await;
    let mut ordinary = f.launch("ordinary", "printf command-ready; sleep 30");
    ordinary["args"]["backgroundKind"] = json!("command");
    ordinary["timeoutMs"] = json!(30_000);
    let command = f.call("tools.execute", ordinary).await.unwrap()["content"]
        ["backgroundProcessId"]
        .as_str()
        .unwrap()
        .to_string();
    f.call(
        "team.pause",
        json!({"teamSessionId":f.lead,"callerSessionId":f.lead}),
    )
    .await
    .unwrap();
    {
        let st = f.state.lock().await;
        crate::background_services::sweep(&st, crate::db::now_ms()).unwrap();
    }
    let terminal = f.terminal(&id).await;
    assert_eq!(terminal["process"]["stopReason"], "team_paused");
    assert_eq!(terminal["process"]["serviceStopEscalated"], true);
    assert_eq!(f.read(&command).await["process"]["status"], "running");
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_ttl_and_restart_never_replay_or_claim_a_process() {
    let mut f = Fixture::new().await;
    let id = f
        .start(
            "ttl",
            "trap 'exit 0' TERM; printf ready; while :; do sleep 30; done",
        )
        .await;
    f.ready(&id).await;
    let deadline = chrono::DateTime::parse_from_rfc3339(
        f.read(&id).await["process"]["deadlineAt"].as_str().unwrap(),
    )
    .unwrap()
    .timestamp_millis();
    {
        let st = f.state.lock().await;
        crate::background_services::sweep(&st, deadline).unwrap();
    }
    let terminal = f.terminal(&id).await;
    assert_eq!(terminal["process"]["stopReason"], "ttl_expired");
    assert_eq!(terminal["process"]["status"], "stopped");
    f.drain().await;
    {
        let st = f.state.lock().await;
        st.db
            .conn()
            .execute(
                "UPDATE background_processes SET status='running',ended_at=NULL WHERE id=?1",
                [&id],
            )
            .unwrap();
        st.db.conn().execute("UPDATE background_service_ownership SET stop_reason=NULL,stop_requested_at=NULL,stop_escalated=NULL WHERE process_id=?1",[&id]).unwrap();
    }
    let restored = AppState::open(f.data.path()).unwrap();
    assert!(restored.background_jobs.is_empty());
    let process = jobs::get(&restored.db, &f.lead, &id).unwrap().unwrap();
    let value = serde_json::to_value(process).unwrap();
    assert_eq!(value["status"], "interrupted");
    assert_eq!(value["stopReason"], "host_restart");
    assert!(value.get("serviceStopEscalated").is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn service_pending_terminal_failure_does_not_block_another_teams_hard_pause() {
    let mut f = Fixture::new().await;
    f.state.lock().await.db.conn().execute_batch("CREATE TRIGGER fail_service_terminal BEFORE UPDATE OF ended_at ON background_processes WHEN NEW.ended_at IS NOT NULL BEGIN SELECT RAISE(FAIL,'isolated storage failure'); END;").unwrap();
    let id = f.start("storage-failure", "printf ready").await;
    let terminal = f.terminal(&id).await;
    assert_eq!(terminal["process"]["status"], "completed");
    assert!(terminal["persistenceError"]
        .as_str()
        .unwrap()
        .contains("storage failure"));
    let other = f.call("session.create",json!({"mode":"agent","executionProfile":"team","permissionMode":"auto","projectPath":f.data.path()})).await.unwrap();
    let other = other["session"]["id"].as_str().unwrap();
    f.call("session.beginTurn", json!({"sessionId":other}))
        .await
        .unwrap();
    {
        let st = f.state.lock().await;
        super::team_run_limits::sweep(&st, &f.tx, crate::db::now_ms() + 11 * 60 * 60 * 1000)
            .unwrap();
        assert!(
            crate::team::get_team(&st.db, other)
                .unwrap()
                .unwrap()
                .paused
        );
        st.db
            .conn()
            .execute_batch("DROP TRIGGER fail_service_terminal;")
            .unwrap();
    }
    assert_eq!(f.read(&id).await["process"]["status"], "completed");
    assert!(f.read(&id).await.get("persistenceError").is_none());
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_successor_cleans_failed_owners_service_and_keeps_ordinary_work() {
    let mut f = Fixture::new().await;
    let mut launch = f.launch(
        "member-service",
        "trap 'exit 0' TERM; printf ready; while :; do sleep 30; done",
    );
    launch["sessionId"] = json!(f.member);
    launch["turnId"] = json!(f.member_turn);
    let started = tokio::time::timeout(
        Duration::from_secs(10),
        f.call("tools.execute", launch.clone()),
    )
    .await
    .unwrap()
    .unwrap();
    let id = started["content"]["backgroundProcessId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(started["ok"], true);
    let mut command = launch;
    command["toolCallId"] = json!("member-command");
    command["args"]["backgroundKind"] = json!("command");
    command["timeoutMs"] = json!(30_000);
    let command_id = f.call("tools.execute", command).await.unwrap()["content"]
        ["backgroundProcessId"]
        .as_str()
        .unwrap()
        .to_string();
    f.call("session.endTurn",json!({"turnId":f.member_turn,"status":"error","errorCode":"FIXTURE_FAILURE","createNotification":false})).await.unwrap();
    f.call(
        "session.collaboration.settle",
        json!({"turnId":f.member_turn}),
    )
    .await
    .unwrap();
    let created = f.call("team.createMember",json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"name":"successor","replaces":"executor"})).await.unwrap();
    let successor = created["member"]["memberSessionId"]
        .as_str()
        .unwrap()
        .to_string();
    {
        let st = f.state.lock().await;
        crate::background_services::sweep(&st, crate::db::now_ms()).unwrap();
    }
    let member = f.member.clone();
    let terminal = f.terminal_for(&member, &id).await;
    assert_eq!(terminal["process"]["stopReason"], "member_removed");
    assert_eq!(terminal["process"]["status"], "stopped");
    let ordinary = f
        .call(
            "backgroundProcesses.read",
            json!({"sessionId":f.member,"id":command_id}),
        )
        .await
        .unwrap();
    assert_eq!(ordinary["process"]["status"], "running");
    let dispatch = f.call("team.sendMessage",json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"target":"successor","content":"Continue isolated service fixture"})).await.unwrap();
    let turn = f
        .call(
            "session.beginTurn",
            json!({"sessionId":successor,"sessionMessageId":dispatch["message"]["id"]}),
        )
        .await
        .unwrap();
    let mut launch = f.launch("successor-service", "printf ready; sleep 30");
    launch["sessionId"] = json!(successor);
    launch["turnId"] = turn["turnId"].clone();
    let result = tokio::time::timeout(Duration::from_secs(10), f.call("tools.execute", launch))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["content"]["teamRunId"], f.turn);
    f.drain().await;
}

#[tokio::test]
async fn queued_service_rechecks_pause_and_turn_authority_before_spawning() {
    for pause in [true, false] {
        let f = Fixture::new().await;
        let budget = f.state.lock().await.tool_budget.clone();
        let mut held = Vec::new();
        for _ in 0..4 {
            held.push(budget.acquire(&f.lead, "Bash").await.unwrap());
        }
        let state = f.state.clone();
        let tx = f.tx.clone();
        let request = f.launch("queued-service", "printf must-not-run");
        let waiting =
            tokio::spawn(async move { handle_request(state, "tools.execute", request, tx).await });
        tokio::time::timeout(Duration::from_secs(5), async {
            while budget.snapshot().queued != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        if pause {
            f.call(
                "team.pause",
                json!({"teamSessionId":f.lead,"callerSessionId":f.lead}),
            )
            .await
            .unwrap();
        } else {
            f.call(
                "session.endTurn",
                json!({"turnId":f.turn,"status":"completed","createNotification":false}),
            )
            .await
            .unwrap();
        }
        drop(held);
        let error = waiting.await.unwrap().unwrap_err();
        assert_eq!(
            error.data.unwrap()["errorCode"],
            "TEAM_SERVICE_UNAUTHORIZED"
        );
        assert!(jobs::list(&f.state.lock().await.db, &f.lead)
            .unwrap()
            .is_empty());
        assert_eq!(budget.snapshot().active, 0);
        f.drain().await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn denied_owner_move_does_not_stop_service_and_legal_move_finishes_cleanup() {
    let mut f = Fixture::new().await;
    let id = f
        .start(
            "move-service",
            "trap 'exit 0' TERM; printf ready; while :; do sleep 30; done",
        )
        .await;
    f.ready(&id).await;
    let destination = tempfile::tempdir().unwrap();
    let error = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.lead,"projectPath":destination.path()}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "CONFLICT");
    assert_eq!(f.read(&id).await["process"]["status"], "running");
    assert!(f.read(&id).await["process"].get("stopReason").is_none());
    f.call(
        "team.createTask",
        json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"subject":"Keep the Team active during owner move checks"}),
    )
    .await
    .unwrap();
    f.call(
        "session.endTurn",
        json!({"turnId":f.turn,"status":"completed","createNotification":false}),
    )
    .await
    .unwrap();
    let aliases = tempfile::tempdir().unwrap();
    let alias = aliases.path().join("same-project");
    std::os::unix::fs::symlink(f.data.path(), &alias).unwrap();
    for same_path in [f.data.path().to_path_buf(), alias] {
        let error = f
            .call(
                "session.moveProject",
                json!({"sessionId":f.lead,"projectPath":same_path}),
            )
            .await
            .unwrap_err();
        assert_eq!(
            error.data.unwrap()["errorCode"],
            "SESSION_HAS_BACKGROUND_PROCESSES"
        );
        let running = f.read(&id).await;
        assert_eq!(running["process"]["status"], "running");
        assert!(running["process"].get("stopReason").is_none());
        assert!(running["process"].get("stopRequestedAt").is_none());
    }
    let moved = f
        .call(
            "session.moveProject",
            json!({"sessionId":f.lead,"projectPath":destination.path()}),
        )
        .await
        .unwrap();
    assert!(moved["session"]["projectPath"]
        .as_str()
        .unwrap()
        .contains(destination.path().file_name().unwrap().to_str().unwrap()));
    assert_eq!(
        f.read(&id).await["process"]["stopReason"],
        "owner_workspace_changed"
    );
    assert_eq!(f.read(&id).await["process"]["status"], "stopped");
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_durable_pause_reason_wins_a_direct_abort_before_scheduler_delivery() {
    let mut f = Fixture::new().await;
    let id = f
        .start(
            "pause-then-abort",
            "trap 'exit 0' TERM; printf ready; while :; do sleep 30; done",
        )
        .await;
    f.ready(&id).await;
    f.call(
        "team.pause",
        json!({"teamSessionId":f.lead,"callerSessionId":f.lead}),
    )
    .await
    .unwrap();
    f.state.lock().await.db.conn().execute_batch("CREATE TRIGGER fail_service_terminal BEFORE UPDATE OF ended_at ON background_processes WHEN NEW.ended_at IS NOT NULL BEGIN SELECT RAISE(FAIL,'isolated storage failure'); END;").unwrap();
    f.call(
        "tools.abort",
        json!({"sessionId":f.lead,"toolCallId":"pause-then-abort"}),
    )
    .await
    .unwrap();
    let terminal = f.terminal(&id).await;
    assert!(terminal["persistenceError"].is_string());
    assert_eq!(terminal["process"]["stopReason"], "team_paused");
    let durable = crate::background_services::metadata(&f.state.lock().await.db, &id)
        .unwrap()
        .unwrap();
    assert_eq!(
        terminal["process"]["stopRequestedAt"],
        durable.stop_requested_at.unwrap()
    );
    f.state
        .lock()
        .await
        .db
        .conn()
        .execute_batch("DROP TRIGGER fail_service_terminal;")
        .unwrap();
    assert_eq!(f.read(&id).await["process"]["stopReason"], "team_paused");
    f.drain().await;
}

#[cfg(unix)]
#[tokio::test]
async fn service_in_registered_secondary_root_tracks_its_sessions_primary_owner() {
    let mut f = Fixture::new().await;
    let secondary = tempfile::tempdir().unwrap();
    f.call(
        "project.group.create",
        json!({"name":"Service logical roots","folders":[f.data.path(),secondary.path()]}),
    )
    .await
    .unwrap();
    let mut request = f.launch(
        "secondary-service",
        "trap 'exit 0' TERM; printf ready; while :; do sleep 30; done",
    );
    request["args"]["path"] = json!(secondary.path());
    let result = f.call("tools.execute", request).await.unwrap();
    let id = result["content"]["backgroundProcessId"]
        .as_str()
        .unwrap()
        .to_string();
    f.ready(&id).await;
    assert_eq!(
        f.read(&id).await["process"]["cwd"],
        crate::db::canonical_project_path(secondary.path().to_str().unwrap()).unwrap()
    );
    {
        let st = f.state.lock().await;
        crate::background_services::sweep(&st, crate::db::now_ms()).unwrap();
    }
    assert_eq!(f.read(&id).await["process"]["status"], "running");
    assert!(f.read(&id).await["process"].get("stopReason").is_none());
    f.call(
        "session.endTurn",
        json!({"turnId":f.turn,"status":"completed","createNotification":false}),
    )
    .await
    .unwrap();
    let moved = tempfile::tempdir().unwrap();
    f.call(
        "session.moveProject",
        json!({"sessionId":f.lead,"projectPath":moved.path()}),
    )
    .await
    .unwrap();
    assert_eq!(f.read(&id).await["process"]["status"], "stopped");
    assert_eq!(
        f.read(&id).await["process"]["stopReason"],
        "owner_workspace_changed"
    );
    f.drain().await;
}
