//! Register this test module under rpc with #[path = "../team/run_limits_pending_tests.rs"].
//! It exercises private RPC/scheduler seams without changing production visibility.
use super::{handle_request, team_run_limits, AppState};
use crate::{sessions, team, turn_queue};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

#[tokio::test]
async fn hard_paused_late_answer_waits_for_policy_resume_and_new_user_admission() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    // The configured provider is never contacted. All operations use real local RPC/domain wiring.
    let provider = call("providers.create", json!({"name":"Pending limit fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","thinkingLevels":["off"]}]})).await.unwrap();
    let created = call("session.create", json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","permissionMode":"ask"})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let negotiation = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let strategy = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":negotiation["turnId"],"strategy":"delegate","reason":"Coordinate an approved expert before the Goal question","members":[{"name":"validator","presetId":"fullstack","selection":{"thinkingLevel":"off"}}]})).await.unwrap();
    let approved = call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":strategy["review"]["reviewId"],"expectedRevision":strategy["review"]["revision"]})).await.unwrap();
    assert_eq!(approved["review"]["status"], "confirmed");
    assert_eq!(
        approved["decision"]["memberSessionIds"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    call("plans.enter", json!({"sessionId":lead,"turnId":negotiation["turnId"],"toolCallId":"enter","requestedMode":"goal","kind":"goal"})).await.unwrap();
    let proposal = call("plans.submit", json!({"sessionId":lead,"turnId":negotiation["turnId"],"toolCallId":"submit","kind":"goal","title":"Pending at the hard limit","markdown":"# Goal\n\nAsk the user before continuing.\n","question":"Approve?"})).await.unwrap();
    call(
        "session.endTurn",
        json!({"turnId":negotiation["turnId"],"status":"completed","createNotification":false}),
    )
    .await
    .unwrap();
    let resolved = call("plans.resolve", json!({"proposalId":proposal["proposal"]["id"],"sessionId":lead,"turnId":negotiation["turnId"],"toolCallId":"submit","version":proposal["proposal"]["version"],"action":"approve","targetPermissionMode":"ask"})).await.unwrap();
    let execution = resolved["execution"]["id"].as_str().unwrap();
    call("plans.claimExecution", json!({"executionId":execution}))
        .await
        .unwrap();
    let active = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let turn = active["turnId"].as_str().unwrap();
    // The execution turn is a new user scope: reuse the actual member through
    // another trusted confirmation rather than inheriting negotiation consent.
    let execution_strategy = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn,"strategy":"delegate","reason":"Execute the approved Goal with its reviewed expert","members":[{"name":"validator","memberSessionId":approved["decision"]["memberSessionIds"][0],"selection":{"thinkingLevel":"off"}}]})).await.unwrap();
    let execution_approval = call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":execution_strategy["review"]["reviewId"],"expectedRevision":execution_strategy["review"]["revision"]})).await.unwrap();
    assert_eq!(execution_approval["review"]["status"], "confirmed");
    call(
        "goalReports.bindExecutionTurn",
        json!({"executionId":execution,"turnId":turn}),
    )
    .await
    .unwrap();
    let issued = call(
        "goalProgress.issueToken",
        json!({"sessionId":lead,"executionId":execution,"turnId":turn}),
    )
    .await
    .unwrap();
    let old_token = issued["writeToken"].as_str().unwrap();
    assert!(old_token.starts_with("gptk_"));
    call("team.registerLeadAsk", json!({"sessionId":lead,"callerSessionId":lead,"turnId":turn,"request":{"requestId":"hard-limit-ask","sessionId":lead,"toolCallId":"ask-call","questions":[{"question":"Model-authored recovery instructions stay historical","options":["Review","Wait"]}]}})).await.unwrap();

    // Age only isolated fixture records; the real Host clock/deadline logic stays intact.
    let old_budget = {
        let st = state.lock().await;
        let now = crate::db::now_ms();
        let key = format!("{lead}:hard-limit-ask");
        let mut ask = st.db.kv_get(team::lead_asks::NS, &key).unwrap().unwrap();
        ask["createdAt"] = json!(now - team::lead_asks::WAIT_MS);
        st.db.kv_set(team::lead_asks::NS, &key, &ask).unwrap();
        let mut budget = team::run_limits::state(&st.db, lead).unwrap().unwrap();
        budget.started_at = now - team::run_limits::RunLimitSettings::default().hard_ms;
        st.db
            .kv_set(
                team::run_limits::STATE_NS,
                lead,
                &serde_json::to_value(&budget).unwrap(),
            )
            .unwrap();
        budget
    };
    let pending = call(
        "team.deferLeadAsk",
        json!({"sessionId":lead,"callerSessionId":lead,"turnId":turn,"requestId":"hard-limit-ask"}),
    )
    .await
    .unwrap();
    assert_eq!(pending["ask"]["status"], "pending");
    {
        let st = state.lock().await;
        team_run_limits::sweep(&st, &tx, crate::db::now_ms()).unwrap();
        assert!(team::get_team(&st.db, lead).unwrap().unwrap().paused);
    }
    call("session.endTurn", json!({"turnId":turn,"status":"aborted","errorCode":"TURN_ABORTED","createNotification":false})).await.unwrap();
    assert_eq!(
        call("team.listLeadAsks", json!({"sessionId":lead}))
            .await
            .unwrap()["asks"][0]["status"],
        "pending"
    );
    let answered = call(
        "team.resolveLeadAsk",
        json!({"sessionId":lead,"requestId":"hard-limit-ask","answers":[["Review"]]}),
    )
    .await
    .unwrap();
    assert_eq!(answered["ask"]["status"], "answered");
    let queued = {
        let st = state.lock().await;
        let records = turn_queue::list(&st.db, Some(lead)).unwrap();
        assert_eq!(records.len(), 1);
        let queued = records.into_iter().next().unwrap();
        assert_eq!(queued.principal, "desktop");
        assert_eq!(
            queued.user_message_id.as_deref(),
            Some("asktool-answer:hard-limit-ask")
        );
        assert!(queued.session_message_id.is_none());
        assert!(queued.content.contains("Review"));
        assert!(!queued
            .content
            .contains("Model-authored recovery instructions"));
        assert_eq!(
            team::run_limits::state(&st.db, lead)
                .unwrap()
                .unwrap()
                .run_id,
            old_budget.run_id
        );
        assert_eq!(
            st.db.kv_get(team::authority::SCOPE_NS, lead).unwrap(),
            Some(json!(turn))
        );
        queued
    };
    // A queued authenticated answer is not permission to unpause or start a new run.
    assert!(call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .is_err());
    assert!(call(
        "team.resume",
        json!({"teamSessionId":lead,"callerSessionId":lead})
    )
    .await
    .is_err());
    let denied = call(
        "goalProgress.update",
        json!({"sessionId":lead,"executionId":execution,"writeToken":old_token,"items":[]}),
    )
    .await
    .unwrap_err();
    assert_eq!(
        denied.data.unwrap()["errorCode"],
        "GOAL_PROGRESS_NOT_RUNNING"
    );
    {
        let st = state.lock().await;
        assert_eq!(sessions::running_turn_id(&st.db, lead).unwrap(), None);
        assert_eq!(
            turn_queue::list(&st.db, Some(lead)).unwrap()[0].id,
            queued.id
        );
        assert_eq!(
            team::run_limits::state(&st.db, lead)
                .unwrap()
                .unwrap()
                .run_id,
            old_budget.run_id
        );
        assert_eq!(
            st.db.kv_get(team::authority::SCOPE_NS, lead).unwrap(),
            Some(json!(turn))
        );
        // Settings change alone must not release the durable pause or queue.
        st.db.set_setting("app", &json!({"expertTeam":{"schemaVersion":1,"userDefaults":{},"projectOverrides":{},"runLimits":{"enabled":false,"softMs":1,"hardMs":2}}})).unwrap();
        assert!(team::get_team(&st.db, lead).unwrap().unwrap().paused);
    }
    assert!(call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .is_err());
    call(
        "team.resume",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    {
        let st = state.lock().await;
        let resumed = team::run_limits::state(&st.db, lead).unwrap().unwrap();
        assert_eq!(resumed.run_id, old_budget.run_id);
        assert_eq!(resumed.started_at, old_budget.started_at);
        assert!(resumed.elapsed_ms >= team::run_limits::RunLimitSettings::default().hard_ms);
        assert_eq!(resumed.hard_reached_at, None);
        assert_eq!(
            st.db.kv_get(team::authority::SCOPE_NS, lead).unwrap(),
            Some(json!(turn))
        );
        assert_eq!(
            turn_queue::list(&st.db, Some(lead)).unwrap()[0].id,
            queued.id
        );
    }
    // Only actual trusted user-turn admission creates a new authority scope and run.
    let admitted = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let new_turn = admitted["turnId"].as_str().unwrap();
    assert_ne!(new_turn, turn);
    call("session.appendMessage", json!({"sessionId":lead,"turnId":new_turn,"message":{"id":queued.user_message_id,"role":"user","content":queued.content,"createdAt":"2026-10-11T00:00:00Z"}})).await.unwrap();
    {
        let st = state.lock().await;
        let new_budget = team::run_limits::state(&st.db, lead).unwrap().unwrap();
        assert_eq!(new_budget.run_id, new_turn);
        assert_eq!(new_budget.elapsed_ms, 0);
        assert_eq!(
            st.db.kv_get(team::authority::SCOPE_NS, lead).unwrap(),
            Some(json!(new_turn))
        );
        let role: String = st
            .db
            .conn()
            .query_row(
                "SELECT role FROM messages WHERE id=?1",
                [queued.user_message_id.as_deref().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(role, "user");
        assert!(team::authority::require_confirmed_strategy(&st.db, lead).is_err());
        let execution_state: String = st
            .db
            .conn()
            .query_row(
                "SELECT execution_state FROM plan_approvals WHERE execution_id=?1",
                [execution],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(execution_state, "interrupted");
        turn_queue::remove(&st.db, &queued.id).unwrap();
    }
    let still_denied = call(
        "goalProgress.update",
        json!({"sessionId":lead,"executionId":execution,"writeToken":old_token,"items":[]}),
    )
    .await
    .unwrap_err();
    assert_eq!(
        still_denied.data.unwrap()["errorCode"],
        "GOAL_PROGRESS_NOT_RUNNING"
    );
}
