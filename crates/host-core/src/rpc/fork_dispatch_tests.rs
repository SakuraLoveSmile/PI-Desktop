//! Dispatch characterization for the host RPC methods that live outside the
//! central `handle_request` match: Expert Team, Goal reports and progress,
//! Plan schedules and the turn read. It pins that each method still reaches a
//! handler instead of a "method not found" fallback, and that unknown names in
//! these namespaces keep the error shape callers already depend on.

use super::*;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

const TEAM_METHODS: &[&str] = &[
    "team.getRuntimeContext",
    "team.getRoster",
    "team.getSnapshot",
    "team.getBoard",
    "team.createMember",
    "team.createTask",
    "team.updateTask",
    "team.sendMessage",
    "team.listMessages",
    "team.pendingMessages",
    "team.getMessage",
    "team.ackMessage",
    "team.interruptMember",
    "team.pause",
    "team.resume",
    "team.declareStrategy",
    "team.getExecutionDecision",
    "team.getLaunchReview",
    "team.updateLaunchReview",
    "team.confirmLaunchReview",
    "team.cancelLaunchReview",
];

const GOAL_METHODS: &[&str] = &[
    "goalReports.bindExecutionTurn",
    "goalReports.markFailed",
    "goalReports.invalidateDraft",
    "goalReports.submitDraft",
    "goalReports.finalizeReport",
    "goalReports.get",
    "goalReports.list",
    "goalReports.retry",
    "goalReports.getAsset",
    "goalProgress.get",
    "goalProgress.issueToken",
    "goalProgress.update",
];

const PLAN_SCHEDULE_METHODS: &[&str] = &[
    "plans.markMissedSchedules",
    "plans.dueSchedules",
    "plans.claimSchedule",
    "plans.cancelSchedule",
    "plans.markScheduleMissed",
    "plans.markRevisionFailed",
    "session.getTurn",
];

fn test_state(dir: &std::path::Path) -> Arc<Mutex<AppState>> {
    let mut state = AppState::open(dir).unwrap();
    state.handshook = true;
    Arc::new(Mutex::new(state))
}

async fn call(state: &Arc<Mutex<AppState>>, method: &str) -> Result<Value, JsonRpcError> {
    handle_request(
        state.clone(),
        method,
        json!({}),
        mpsc::unbounded_channel().0,
    )
    .await
}

fn error_code(error: &JsonRpcError) -> Option<&str> {
    error
        .data
        .as_ref()
        .and_then(|data| data.get("errorCode"))
        .and_then(Value::as_str)
}

#[tokio::test]
async fn every_fork_method_reaches_a_handler() {
    let dir = tempfile::tempdir().unwrap();
    let state = test_state(dir.path());
    let methods = TEAM_METHODS
        .iter()
        .chain(GOAL_METHODS)
        .chain(PLAN_SCHEDULE_METHODS);
    for method in methods {
        if let Err(error) = call(&state, method).await {
            assert!(
                error.code != -32601 && error_code(&error) != Some("METHOD_NOT_FOUND"),
                "{method} fell through to a method-not-found fallback: {error:?}",
            );
        }
    }
}

#[tokio::test]
async fn unknown_names_keep_their_namespace_error_shape() {
    let dir = tempfile::tempdir().unwrap();
    let state = test_state(dir.path());

    let team = call(&state, "team.noSuchMethod").await.unwrap_err();
    assert_eq!(team.code, 1004);
    assert_eq!(team.message, "unknown method: team.noSuchMethod");
    assert_eq!(error_code(&team), Some("METHOD_NOT_FOUND"));

    for method in [
        "goalReports.noSuchMethod",
        "goalProgress.noSuchMethod",
        "plans.noSuchSchedule",
    ] {
        let error = call(&state, method).await.unwrap_err();
        assert_eq!(error.code, -32601, "{method}");
        assert_eq!(error.message, format!("method not found: {method}"));
        assert_eq!(error_code(&error), Some("NOT_FOUND"), "{method}");
    }
}
