use super::*;

#[tokio::test]
#[ignore = "Cross-process candidate integration requires built JS packages and Node; run explicitly with --ignored"]
async fn approved_goal_ask_timeout_replays_runtime_main_and_host_interruption() {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let mut child = tokio::process::Command::new("node")
        .current_dir(root)
        .arg(root.join("apps/desktop/test/fixtures/team-ask-approved-replay.mjs"))
        .arg(data.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let diagnostic = tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut r = stderr;
        let mut text = String::new();
        r.read_to_string(&mut text).await.unwrap();
        text
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut completed = None;
    tokio::time::timeout(std::time::Duration::from_secs(60), async {
        while let Some(line) = lines.next_line().await.unwrap() {
            let request: Value = serde_json::from_str(&line).unwrap();
            let method = request["method"].as_str().unwrap();
            let params = request["params"].clone();
            if method == "__fixture.done" {
                completed = Some(params);
                stdin
                    .write_all(
                        format!("{}\n", json!({"id":request["id"],"result":{"ok":true}}))
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                break;
            }
            if method == "team.deferLeadAsk" {
                // Rust owns the isolated fixture clock: simulate elapsed Host time without a production test backdoor.
                let st = state.lock().await;
                let key = format!(
                    "{}:{}",
                    params["sessionId"].as_str().unwrap(),
                    params["requestId"].as_str().unwrap()
                );
                let mut ask = st
                    .db
                    .kv_get(crate::team::lead_asks::NS, &key)
                    .unwrap()
                    .unwrap();
                ask["createdAt"] = json!(crate::db::now_ms() - crate::team::lead_asks::WAIT_MS);
                st.db
                    .kv_set(crate::team::lead_asks::NS, &key, &ask)
                    .unwrap();
            }
            let response = match handle_request(state.clone(), method, params, tx.clone()).await {
                Ok(result) => json!({"id":request["id"],"result":result}),
                Err(error) => json!({"id":request["id"],"error":error}),
            };
            stdin
                .write_all(format!("{response}\n").as_bytes())
                .await
                .unwrap();
        }
    })
    .await
    .expect("approved Goal replay exceeded fixture budget");
    drop(stdin);
    let status = child.wait().await.unwrap();
    let diagnostic = diagnostic.await.unwrap();
    assert!(status.success(), "{diagnostic}");
    let completed = completed.expect("Node did not verify the production boundary");
    let st = state.lock().await;
    let execution_state: String = st
        .db
        .conn()
        .query_row(
            "SELECT execution_state FROM plan_approvals WHERE execution_id=?1",
            [completed["executionId"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(execution_state, "interrupted");
    let successful_reports: i64 = st
        .db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM goal_reports WHERE execution_id=?1 AND status='ready'",
            [completed["executionId"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(successful_reports, 0);
    eprintln!("{diagnostic}");
}

#[tokio::test]
async fn failed_approved_member_is_replaced_once_without_second_review() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider = call("providers.create", json!({"name":"Replacement fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created = call("session.create", json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture"})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let declared = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn["turnId"],"strategy":"delegate","reason":"Recover an approved failed expert","members":[{"name":"builder","presetId":"fullstack"}]})).await.unwrap();
    let review = &declared["review"];
    let approved = call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":review["reviewId"],"expectedRevision":review["revision"]})).await.unwrap();
    let original = approved["decision"]["memberSessionIds"][0]
        .as_str()
        .unwrap();
    state
        .lock()
        .await
        .db
        .conn()
        .execute(
            "UPDATE team_members SET phase='failed' WHERE member_session_id=?1",
            [original],
        )
        .unwrap();
    let replacement = call("team.createMember", json!({"teamSessionId":lead,"callerSessionId":lead,"name":"builder_replacement","replaces":"builder"})).await.unwrap();
    assert_ne!(replacement["member"]["memberSessionId"], original);
    let replay = call("team.createMember", json!({"teamSessionId":lead,"callerSessionId":lead,"name":"builder_replacement","replaces":"builder"})).await.unwrap();
    assert_eq!(
        replay["member"]["memberSessionId"],
        replacement["member"]["memberSessionId"]
    );
    let second = call("team.createMember", json!({"teamSessionId":lead,"callerSessionId":lead,"name":"builder_third","replaces":"builder"})).await.unwrap_err();
    assert!(second.message.contains("nextStep"));
    let denied = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Run again"})).await.unwrap_err();
    assert!(denied.message.contains("nextStep"));
    let dispatch = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder_replacement","content":"Complete the original task"})).await.unwrap();
    let message = &dispatch["message"];
    call("session.beginTurn", json!({"sessionId":replacement["member"]["memberSessionId"],"sessionMessageId":message["id"]})).await.unwrap();
    assert_eq!(
        call(
            "team.getLaunchReview",
            json!({"teamSessionId":lead,"reviewId":review["reviewId"]})
        )
        .await
        .unwrap()["review"]["revision"],
        approved["review"]["revision"]
    );
}

#[tokio::test]
async fn stale_stop_cannot_cancel_questions_of_the_replacement_turn() {
    let folder = tempfile::tempdir().unwrap();
    let mut app = AppState::open(folder.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let created = call(
        "session.create",
        json!({"mode":"agent","executionProfile":"team"}),
    )
    .await
    .unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let first = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    call(
        "session.endTurn",
        json!({"turnId":first["turnId"],"status":"aborted","createNotification":false}),
    )
    .await
    .unwrap();
    let second = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    call("team.registerLeadAsk",json!({"sessionId":lead,"callerSessionId":lead,"turnId":second["turnId"],"request":{"requestId":"new-ask","sessionId":lead,"toolCallId":"new-tool","questions":[{"question":"New turn decision?","options":["Wait"]}]}})).await.unwrap();
    assert_eq!(
        call(
            "team.cancelLeadAsks",
            json!({"sessionId":lead,"expectedTurnId":first["turnId"]})
        )
        .await
        .unwrap()["ok"],
        false
    );
    assert_eq!(
        call("team.listLeadAsks", json!({"sessionId":lead}))
            .await
            .unwrap()["asks"][0]["status"],
        "waiting"
    );
    assert_eq!(
        call(
            "team.cancelLeadAsks",
            json!({"sessionId":lead,"expectedTurnId":second["turnId"]})
        )
        .await
        .unwrap()["ok"],
        true
    );
    assert!(call("team.listLeadAsks", json!({"sessionId":lead}))
        .await
        .unwrap()["asks"]
        .as_array()
        .unwrap()
        .is_empty());
}
