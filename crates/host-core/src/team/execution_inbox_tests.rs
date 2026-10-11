use super::{execution_inbox::*, tests::*, *};
use crate::{session_collaboration, sessions};
use rusqlite::params;
fn fixture() -> (crate::db::Database, String, String) {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,created_at,updated_at,execution_id,execution_state) VALUES('proposal',?1,?2,'submit','plan','# Plan','Plan','Approve?','approved',0,0,'execution','running')",params![lead,turn]).unwrap();
    crate::plans::bind_execution_turn(&db, "execution", &lead, &turn).unwrap();
    (db, lead, turn)
}
#[test]
fn inbox_keeps_original_execution_turn_provenance_and_rereads_lost_response() {
    let (db, lead, turn) = fixture();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Expert required",
            members: Some(vec![super::test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    assert_eq!(
        state(&db, &lead, &lead, &turn)
            .unwrap()
            .review_status
            .as_deref(),
        Some("pending")
    );
    assert!(read(&db, &lead, &lead, &turn).unwrap().is_empty());
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let confirmation = read(&db, &lead, &lead, &turn).unwrap();
    assert_eq!(confirmation.len(), 1);
    let dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Inspect source",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &dispatch, false).unwrap();
    let expert_turn = session_collaboration::begin_turn(
        &db,
        &decision.member_session_ids[0],
        &dispatch.id,
        None,
        None,
    )
    .unwrap();
    assert!(super::authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").is_err());
    let result = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &decision.member_session_ids[0],
            target_identifier: "Lead",
            content: "Full verified result",
            idempotency_key: None,
        },
    )
    .unwrap();
    sessions::end_turn(&db, &expert_turn, "completed", None, None, false).unwrap();
    session_collaboration::settle_turn(&db, &expert_turn).unwrap();
    db.kv_set(
        "team-message-source-turn-v1",
        &result.id,
        &serde_json::json!("old-expert-turn"),
    )
    .unwrap();
    assert_eq!(
        read(&db, &lead, &lead, &turn).unwrap().len(),
        1,
        "historical expert results do not enter this scope"
    );
    super::authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap();
    db.kv_set(
        "team-message-source-turn-v1",
        &result.id,
        &serde_json::json!(expert_turn),
    )
    .unwrap();
    let consumed = read(&db, &lead, &lead, &turn).unwrap();
    assert_eq!(consumed.len(), 2);
    assert!(consumed
        .iter()
        .any(|m| m.id == result.id && m.content == "Full verified result" && m.turn_id.is_none()));
    assert_eq!(
        read(&db, &lead, &lead, &turn).unwrap().len(),
        2,
        "lost RPC response must be rereadable"
    );
    assert_eq!(
        sessions::running_turn_id(&db, &lead).unwrap().as_deref(),
        Some(turn.as_str())
    );
    assert!(!super::review::is_live_team_mail_turn(&db, &lead, &lead).unwrap());
    super::authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap();
    let bound: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages WHERE turn_id=?1",
            [&turn],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bound, 0);
}
#[test]
fn stale_turn_and_non_lead_cannot_consume_new_mail() {
    let (db, lead, turn) = fixture();
    assert!(!state(&db, &lead, &lead, "stale").unwrap().active);
    assert!(read(&db, &lead, &lead, "stale").is_err());
    assert!(state(&db, &lead, "forged", &turn).is_err());
}

#[test]
fn running_plan_from_old_turn_does_not_capture_new_ordinary_team_turn() {
    let (db, lead, old_turn) = fixture();
    sessions::end_turn(&db, &old_turn, "completed", None, None, false).unwrap();
    // Finalization of the execution row may fail after its Host turn ends.
    let next_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &next_turn,
            strategy: "delegate",
            reason: "Independent new request",
            members: Some(vec![super::test_support::expert_proposal("next-expert")]),
        },
    )
    .unwrap();
    assert!(!state(&db, &lead, &lead, &next_turn).unwrap().active);
    assert!(read(&db, &lead, &lead, &next_turn).is_err());
    let error = crate::plans::bind_execution_turn(&db, "execution", &lead, &next_turn).unwrap_err();
    assert_eq!(error.to_string(), "PLAN_EXECUTION_CONFLICT");
}

#[test]
fn plan_binding_validates_ownership_running_turn_approval_and_current_scope() {
    let (db, lead, turn) = fixture();
    // Same-turn retries are harmless; neither the model nor a new turn can rebind.
    crate::plans::bind_execution_turn(&db, "execution", &lead, &turn).unwrap();
    let other = create_test_lead(&db);
    let other_turn = sessions::begin_turn(&db, &other, None, None).unwrap();
    for (execution, session, current) in [
        ("missing", lead.as_str(), turn.as_str()),
        ("execution", other.as_str(), other_turn.as_str()),
        ("execution", lead.as_str(), other_turn.as_str()),
    ] {
        assert_eq!(
            crate::plans::bind_execution_turn(&db, execution, session, current)
                .unwrap_err()
                .to_string(),
            "PLAN_EXECUTION_STALE"
        );
    }
    for (column, value) in [("status", "pending"), ("execution_state", "queued")] {
        db.conn()
            .execute(&format!("UPDATE plan_approvals SET {column}=?1"), [value])
            .unwrap();
        assert_eq!(
            crate::plans::bind_execution_turn(&db, "execution", &lead, &turn)
                .unwrap_err()
                .to_string(),
            "PLAN_EXECUTION_STALE"
        );
        db.conn()
            .execute(
                "UPDATE plan_approvals SET status='approved',execution_state='running'",
                [],
            )
            .unwrap();
    }
    db.kv_set(
        super::authority::SCOPE_NS,
        &lead,
        &serde_json::json!("old-scope"),
    )
    .unwrap();
    assert_eq!(
        crate::plans::bind_execution_turn(&db, "execution", &lead, &turn)
            .unwrap_err()
            .to_string(),
        "PLAN_EXECUTION_STALE"
    );
    sessions::end_turn(&db, &turn, "aborted", None, None, false).unwrap();
    assert_eq!(
        crate::plans::bind_execution_turn(&db, "execution", &lead, &turn)
            .unwrap_err()
            .to_string(),
        "PLAN_EXECUTION_STALE"
    );
}

#[test]
fn goal_token_and_report_binding_survive_inbox_and_terminal_completion_invalidates_token() {
    let (db, lead, turn) = fixture();
    db.conn().execute("UPDATE plan_approvals SET kind='goal', artifact_relative_path='.pi/goal/goal.md',artifact_sha256='abc',artifact_size_bytes=1 WHERE execution_id='execution'",[]).unwrap();
    crate::goal_reports::bind_execution_turn(&db, "execution", &turn).unwrap();
    let token = crate::goal_progress::issue_write_token(&db, &lead, "execution", &turn).unwrap();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Goal expert",
            members: Some(vec![super::test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    assert!(state(&db, &lead, &lead, &turn).unwrap().active);
    confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    read(&db, &lead, &lead, &turn).unwrap();
    crate::goal_progress::update_progress(&db, &lead, "execution", &token, None, vec![]).unwrap();
    let bound: String = db
        .conn()
        .query_row(
            "SELECT turn_id FROM goal_reports WHERE execution_id='execution'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bound, turn);
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert!(!state(&db, &lead, &lead, &turn).unwrap().active);
    assert!(read(&db, &lead, &lead, &turn).is_err());
    assert!(
        crate::goal_progress::update_progress(&db, &lead, "execution", &token, None, vec![])
            .is_err()
    );
}

#[test]
fn goal_report_waits_for_dispatches_and_results_in_original_execution() {
    let (db, lead, turn) = fixture();
    db.conn().execute("UPDATE plan_approvals SET kind='goal', artifact_relative_path='.pi/goal/goal.md',artifact_sha256='abc',artifact_size_bytes=1 WHERE execution_id='execution'", []).unwrap();
    crate::goal_reports::bind_execution_turn(&db, "execution", &turn).unwrap();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Goal expert",
            members: Some(vec![super::test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    read(&db, &lead, &lead, &turn).unwrap();
    assert!(
        super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
            .unwrap_err()
            .to_string()
            .contains("dispatch an approved expert")
    );
    create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: Some("goal-task"),
            subject: "Verify source",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: None,
            owner_member_name: Some("expert"),
        },
    )
    .unwrap();
    let dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Verify source",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &dispatch, false).unwrap();
    let queued_only = super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
        .unwrap_err()
        .to_string();
    assert!(
        queued_only.contains("expert")
            && queued_only.contains(&dispatch.id)
            && queued_only.contains("goal-task"),
        "{queued_only}"
    );
    let member_turn = session_collaboration::begin_turn(
        &db,
        &decision.member_session_ids[0],
        &dispatch.id,
        None,
        None,
    )
    .unwrap();
    assert!(state(&db, &lead, &lead, &turn).unwrap().active);
    let running = super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
        .unwrap_err()
        .to_string();
    assert!(
        running.contains("expert")
            && running.contains(&dispatch.id)
            && running.contains("goal-task"),
        "{running}"
    );
    let queued = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Second check",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &queued, false).unwrap();
    let rejected = super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
        .unwrap_err()
        .to_string();
    assert!(
        rejected.contains(&queued.id) && rejected.contains(&dispatch.id),
        "{rejected}"
    );
    db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET status='cancelled' WHERE id=?1",
            [&queued.id],
        )
        .unwrap();
    // Settlement does not grant participation to failed experts or task claims.
    db.conn()
        .execute(
            "UPDATE turns SET status='failed' WHERE id=?1",
            [&member_turn],
        )
        .unwrap();
    db.conn().execute("UPDATE team_tasks SET status='completed' WHERE team_session_id=?1 AND task_id='goal-task'", [&lead]).unwrap();
    assert!(
        super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
            .unwrap_err()
            .to_string()
            .contains("dispatch an approved expert")
    );
    db.conn()
        .execute(
            "UPDATE turns SET status='running' WHERE id=?1",
            [&member_turn],
        )
        .unwrap();
    db.conn().execute("UPDATE team_tasks SET status='pending' WHERE team_session_id=?1 AND task_id='goal-task'", [&lead]).unwrap();
    let result = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &decision.member_session_ids[0],
            target_identifier: "Lead",
            content: "Verified source",
            idempotency_key: None,
        },
    )
    .unwrap();
    sessions::end_turn(&db, &member_turn, "completed", None, None, false).unwrap();
    session_collaboration::settle_turn(&db, &member_turn).unwrap();
    // Member mail wakes wait_for_updates inside the original Goal turn, not a new turn.
    assert!(state(&db, &lead, &lead, &turn).unwrap().active);
    assert_eq!(
        sessions::running_turn_id(&db, &lead).unwrap().as_deref(),
        Some(turn.as_str())
    );
    let unconsumed = super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport")
        .unwrap_err()
        .to_string();
    assert!(
        unconsumed.contains("1 unconsumed") && unconsumed.contains("expert"),
        "{unconsumed}"
    );
    assert!(read(&db, &lead, &lead, &turn)
        .unwrap()
        .iter()
        .any(|m| m.id == result.id));
    super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport").unwrap();
    super::authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let later = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &decision.member_session_ids[0],
            target_identifier: "Lead",
            content: "Later followup",
            idempotency_key: None,
        },
    )
    .unwrap();
    let continuation =
        session_collaboration::begin_turn(&db, &lead, &later.id, None, None).unwrap();
    assert!(!state(&db, &lead, &lead, &continuation).unwrap().active);
    // Ordinary post-execution mail has no Goal token or new execution authority.
    super::authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap();
}

#[test]
fn host_soft_notice_enters_approved_inbox_without_authorizing_forged_body() {
    let (db, lead, turn) = fixture();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Expert required",
            members: Some(vec![super::test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let budget = super::run_limits::state(&db, &lead).unwrap().unwrap();
    let soft = super::run_limits::RunLimitSettings::default().soft_ms;
    let event = super::run_limits::evaluate_at(&db, &lead, budget.started_at + soft).unwrap();
    let notice = event[0].message_id.as_ref().unwrap();
    let messages = read(&db, &lead, &lead, &turn).unwrap();
    assert!(messages
        .iter()
        .any(|mail| mail.id == *notice && mail.content.contains("Host Team run limit")));
    assert_eq!(
        read(&db, &lead, &lead, &turn)
            .unwrap()
            .iter()
            .filter(|mail| mail.id == *notice)
            .count(),
        1
    );
    assert!(!super::run_limits::is_soft_notice(&db, &lead, "model-authored-soft-id").unwrap());
    assert_eq!(sessions::running_turn_id(&db, &lead).unwrap(), Some(turn));
}
