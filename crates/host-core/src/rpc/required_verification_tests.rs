use super::handle_request as handle;
use super::*;

async fn proposal(state: &Arc<Mutex<AppState>>, root: &Path, kind: &str) -> plans::PlanProposal {
    std::fs::create_dir_all(root).unwrap();
    let st = state.lock().await;
    let session = sessions::create_session(
        &st.db,
        None,
        Some(kind.into()),
        None,
        None,
        Some(root.to_string_lossy().into_owned()),
    )
    .unwrap();
    let turn = sessions::begin_turn(&st.db, &session.id, None, None).unwrap();
    let proposal = st
        .plans
        .submit(
            &st.db,
            plans::PlanSubmitParams {
                workspace_root: root,
                session_id: &session.id,
                turn_id: &turn,
                tool_call_id: &format!("required-verification-{kind}"),
                kind,
                title: "Verify frozen commands",
                markdown: "# Goal\nRun cargo test --locked and pnpm test.",
                question: "Proceed?",
                artifact_workspace_kind: "project",
            },
        )
        .unwrap();
    sessions::end_turn(&st.db, &turn, "completed", None, None, false).unwrap();
    proposal
}

fn approval(proposal: &plans::PlanProposal) -> Value {
    json!({"proposalId": proposal.id, "sessionId": proposal.session_id, "turnId": proposal.turn_id,
        "toolCallId": proposal.tool_call_id, "version": proposal.version, "action": "approve",
        "targetPermissionMode": "auto", "requiredVerificationCommands": ["cargo test --locked", "pnpm test"]})
}

#[tokio::test]
async fn required_verification_approval_persists_and_current_execution_corrects_missing_checks() {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
    state.lock().await.handshook = true;
    let proposal = proposal(&state, &dir.path().join("workspace"), "goal").await;
    let (tx, _rx) = mpsc::unbounded_channel();
    let params = approval(&proposal);
    let approved = handle(state.clone(), "plans.resolve", params.clone(), tx.clone())
        .await
        .unwrap();
    let required = &params["requiredVerificationCommands"];
    assert_eq!(
        approved["proposal"]["requiredVerificationCommands"],
        *required
    );
    assert_eq!(
        approved["execution"]["requiredVerificationCommands"],
        *required
    );
    let id = approved["execution"]["id"].as_str().unwrap();
    let persisted = {
        let st = state.lock().await;
        st.plans
            .queued_executions(&st.db, Some(&proposal.session_id))
            .unwrap()
    };
    assert_eq!(
        serde_json::to_value(&persisted[0]).unwrap()["requiredVerificationCommands"],
        *required
    );
    assert_eq!(
        handle(state.clone(), "plans.resolve", params.clone(), tx.clone())
            .await
            .unwrap()["execution"]["id"],
        id
    );
    for changed in [
        None,
        Some(json!(["pnpm test"])),
        Some(json!(["pnpm test", "cargo test --locked"])),
    ] {
        let mut changed_params = params.clone();
        changed_params
            .as_object_mut()
            .unwrap()
            .remove("requiredVerificationCommands");
        if let Some(changed) = changed {
            changed_params["requiredVerificationCommands"] = changed;
        }
        let error = handle(state.clone(), "plans.resolve", changed_params, tx.clone())
            .await
            .unwrap_err();
        assert_eq!(error.data.unwrap()["errorCode"], "PLAN_APPROVAL_CONFLICT");
    }
    let mut stale = params.clone();
    stale["toolCallId"] = json!("another-call");
    assert_eq!(
        handle(state.clone(), "plans.resolve", stale, tx.clone())
            .await
            .unwrap_err()
            .data
            .unwrap()["errorCode"],
        "PLAN_APPROVAL_STALE"
    );
    handle(
        state.clone(),
        "plans.claimExecution",
        json!({"executionId": id}),
        tx.clone(),
    )
    .await
    .unwrap();
    let missing = json!({"summary": "Both commands passed", "verdict": "met", "checks": []});
    let error = handle(
        state.clone(),
        "goalReports.submitDraft",
        json!({"executionId": id, "draft": missing}),
        tx.clone(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "INVALID_ARGUMENT");
    assert!(error.message.contains("cargo test --locked"));
    assert!(error.message.contains("Example"));
    assert!(!dir.path().join("goal_reports").exists());
    let turn = handle(
        state.clone(),
        "session.beginTurn",
        json!({"sessionId": proposal.session_id}),
        tx.clone(),
    )
    .await
    .unwrap();
    let turn_id = turn["turnId"].as_str().unwrap();
    handle(
        state.clone(),
        "goalReports.bindExecutionTurn",
        json!({"executionId": id, "turnId": turn_id}),
        tx.clone(),
    )
    .await
    .unwrap();
    for (call, command) in [
        ("native-cargo", "cargo test --locked"),
        ("native-js", "pnpm test"),
    ] {
        handle(state.clone(), "session.appendMessage", json!({"sessionId": proposal.session_id, "turnId": turn_id, "message": {
            "id": call, "role": "tool", "content": "Native command result", "createdAt": "2026-10-22T00:00:00Z",
            "toolName": "Bash", "toolCallId": call, "toolArgs": {"command": command}, "toolStatus": "success",
            "toolResult": {"content": [{"type":"text", "text":"Command completed"}], "details": {"exitCode":0}, "isError":false}
        }}), tx.clone()).await.unwrap();
    }
    let corrected = json!({"summary": "Both commands passed", "verdict": "met", "checks": [
        {"id": "cargo", "command": "cargo test --locked", "exitCode": 0, "result": "passed", "evidenceRefs":["ev-cargo"]},
        {"id": "js", "command": "pnpm test", "exitCode": 0, "result": "passed", "evidenceRefs":["ev-js"]}
    ], "evidences": [
        {"id":"ev-cargo", "kind":"tool_result", "refId":"native-cargo", "summary":"Native cargo result"},
        {"id":"ev-js", "kind":"tool_result", "refId":"native-js", "summary":"Native JS result"}
    ]});
    handle(
        state.clone(),
        "goalReports.submitDraft",
        json!({"executionId": id, "draft": corrected}),
        tx.clone(),
    )
    .await
    .unwrap();
    handle(
        state.clone(),
        "session.endTurn",
        json!({"turnId": turn_id, "status":"completed", "createNotification":false}),
        tx.clone(),
    )
    .await
    .unwrap();
    let settled = handle(
        state.clone(),
        "goalExecutions.settle",
        json!({"sessionId": proposal.session_id, "executionId": id, "ended": "agent_stopped"}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(settled["execution"]["state"], "completed");
    let st = state.lock().await;
    let report = crate::goal_reports::read_report(&st.db, &proposal.session_id, id).unwrap();
    assert_eq!(report.state, "ready");
    assert_eq!(report.report.unwrap()["checks"], corrected["checks"]);
    drop(st);
    drop(state);
    let restarted = AppState::open(dir.path()).unwrap();
    let history = restarted
        .plans
        .history_for_session(&restarted.db, &proposal.session_id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&history[0]).unwrap()["requiredVerificationCommands"],
        *required
    );
}

#[tokio::test]
async fn required_verification_rejects_non_goal_or_non_approve_without_resolving() {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
    state.lock().await.handshook = true;
    let (tx, _rx) = mpsc::unbounded_channel();
    for kind in ["plan", "goal"] {
        let proposal = proposal(&state, &dir.path().join(kind), kind).await;
        for action in ["approve", "reject", "schedule", "request_changes"] {
            if kind == "goal" && action == "approve" {
                continue;
            }
            let mut params = approval(&proposal);
            params["action"] = json!(action);
            let error = handle(state.clone(), "plans.resolve", params, tx.clone())
                .await
                .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], "INVALID_ARGUMENT");
            let st = state.lock().await;
            assert_eq!(
                st.plans
                    .pending_for_session(&st.db, Some(&proposal.session_id))
                    .unwrap()
                    .len(),
                1
            );
        }
    }
}
