use super::{team_run_limits, AppState};
use crate::{sessions, team};
use rusqlite::params;
use serde_json::json;

#[test]
fn host_budget_path_notifies_once_interrupts_goal_and_retains_pause_on_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let st = AppState::open(dir.path()).unwrap();
    let lead = sessions::create_session_with_options(
        &st.db,
        sessions::SessionCreateOptions {
            title: Some("Limit fixture".into()),
            mode: Some("agent".into()),
            execution_profile: Some("team".into()),
            ..Default::default()
        },
    )
    .unwrap()
    .id;
    team::ensure_team(&st.db, &lead).unwrap();
    let turn = sessions::begin_turn(&st.db, &lead, None, None).unwrap();
    // A real durable approved Goal row, not a mock of finish_execution.
    st.db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,action,target_permission_mode,created_at,updated_at,execution_id,execution_state,artifact_relative_path,artifact_sha256,artifact_size_bytes)
      VALUES('budget-goal',?1,?2,'submit','goal','# Goal','Goal','Approve?','approved','approve','auto',0,0,'budget-execution','running','.pi/goal/test.md','test-sha',12)",params![lead,turn]).unwrap();
    crate::goal_reports::bind_execution_turn(&st.db, "budget-execution", &turn).unwrap();
    let token =
        crate::goal_progress::issue_write_token(&st.db, &lead, "budget-execution", &turn).unwrap();
    let budget = team::run_limits::state(&st.db, &lead).unwrap().unwrap();
    let limits = team::run_limits::RunLimitSettings::default();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    team_run_limits::sweep(&st, &tx, budget.started_at + limits.soft_ms).unwrap();
    team_run_limits::sweep(&st, &tx, budget.started_at + limits.soft_ms + 1).unwrap();
    let soft_notifications: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok())
        .map(|raw| serde_json::from_str::<serde_json::Value>(&raw).unwrap())
        .collect();
    assert_eq!(
        soft_notifications
            .iter()
            .filter(|notice| notice["method"] == "team.changed"
                && notice["params"]["reason"] == "run-limit-soft")
            .count(),
        1
    );
    assert_eq!(
        soft_notifications
            .iter()
            .filter(|notice| notice["method"] == "team.messageQueued")
            .count(),
        1
    );
    team_run_limits::sweep(&st, &tx, budget.started_at + limits.hard_ms).unwrap();
    let snapshot = team::get_team_snapshot(&st.db, &lead).unwrap();
    assert!(snapshot.paused);
    assert_eq!(
        snapshot.run_limits.unwrap().state.hard_reached_at,
        Some(budget.started_at + limits.hard_ms)
    );
    let goal: String = st
        .db
        .conn()
        .query_row(
            "SELECT execution_state FROM plan_approvals WHERE execution_id='budget-execution'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(goal, "interrupted");
    assert!(crate::goal_progress::update_progress(
        &st.db,
        &lead,
        "budget-execution",
        &token,
        None,
        vec![]
    )
    .is_err());
    assert_eq!(
        sessions::running_turn_id(&st.db, &lead).unwrap(),
        Some(turn)
    );
    assert!(std::iter::from_fn(|| rx.try_recv().ok())
        .any(|raw| raw.contains("team.runLimitPauseRequested")));
    drop(st);
    let reopened = AppState::open(dir.path()).unwrap();
    assert!(team::get_team(&reopened.db, &lead).unwrap().unwrap().paused);
    assert!(team::resume_team(&reopened.db, &lead).is_err());
    let settings = json!({"expertTeam":{"schemaVersion":1,"userDefaults":{},"projectOverrides":{},"runLimits":{"enabled":true,"softMs":21600000,"hardMs":72000000}}});
    reopened.db.set_setting("app", &settings).unwrap();
    team::resume_team(&reopened.db, &lead).unwrap();
    assert_eq!(
        team::run_limits::state(&reopened.db, &lead)
            .unwrap()
            .unwrap()
            .run_id,
        budget.run_id
    );
}
