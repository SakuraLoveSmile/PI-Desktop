use super::execution_inbox_tests::fixture;
use super::{execution_inbox::*, tests::*, *};
use crate::sessions;
use rusqlite::params;

#[test]
fn blocked_goal_resume_inherits_confirmed_team_strategy_and_inbox() {
    let (db, lead, turn) = fixture();
    db.conn().execute("UPDATE plan_approvals SET kind='goal',target_permission_mode='ask',artifact_relative_path='.pi/goal/goal.md',artifact_sha256='abc',artifact_size_bytes=1 WHERE execution_id='execution'",[]).unwrap();
    crate::goal_reports::bind_execution_turn(&db, "execution", &turn).unwrap();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Goal experts",
            members: Some(vec![super::test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    read(&db, &lead, &lead, &turn).unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let blocked = crate::goal_holds::settle(
        &db,
        &lead,
        "execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    // Ordinary user work may advance the latest strategy while the Goal is held.
    let ordinary = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let other_review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &ordinary,
            strategy: "delegate",
            reason: "Separate ordinary user work",
            members: Some(vec![super::test_support::expert_proposal("other-expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    confirm_launch_review(&db, &lead, &other_review.review_id, other_review.revision).unwrap();
    sessions::end_turn(&db, &ordinary, "completed", None, None, false).unwrap();
    crate::goal_holds::resume(
        &db,
        &lead,
        "execution",
        blocked["hold"]["version"].as_i64().unwrap(),
        None,
    )
    .unwrap();
    let resumed = sessions::begin_turn(&db, &lead, None, None).unwrap();
    crate::goal_reports::bind_execution_turn(&db, "execution", &resumed).unwrap();
    assert!(state(&db, &lead, &lead, &resumed).unwrap().active);
    assert_eq!(
        get_team_snapshot(&db, &lead)
            .unwrap()
            .decision
            .unwrap()
            .lead_turn_id,
        turn
    );
    assert_eq!(
        super::authority::current_confirmed_decision(&db, &lead)
            .unwrap()
            .lead_turn_id,
        turn
    );
    super::authority::validate_lead_tool(&db, &lead, "send_message").unwrap();
    let task = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: None,
            subject: "Verify resumed goal",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: None,
            owner_member_name: Some("expert"),
        },
    )
    .unwrap();
    assert!(get_execution_decision(&db, &lead, &turn)
        .unwrap()
        .unwrap()
        .task_ids
        .contains(&task.task_id));
    let dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Continue original task",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &dispatch, false).unwrap();
    let decision = get_execution_decision(&db, &lead, &turn).unwrap().unwrap();
    let expert_turn = crate::session_collaboration::begin_turn(
        &db,
        &decision.member_session_ids[0],
        &dispatch.id,
        None,
        None,
    )
    .unwrap();
    let result = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &decision.member_session_ids[0],
            target_identifier: "Lead",
            content: "Verified continued work",
            idempotency_key: None,
        },
    )
    .unwrap();
    sessions::end_turn(&db, &expert_turn, "completed", None, None, false).unwrap();
    crate::session_collaboration::settle_turn(&db, &expert_turn).unwrap();
    let consumed = read(&db, &lead, &lead, &resumed).unwrap();
    assert!(consumed.iter().any(|message| message.id == result.id));
    assert!(super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport").is_err());
    db.conn()
        .execute(
            "UPDATE team_tasks SET status='completed' WHERE team_session_id=?1 AND task_id=?2",
            params![lead, task.task_id],
        )
        .unwrap();
    super::authority::validate_lead_tool(&db, &lead, "SubmitGoalReport").unwrap();
    crate::goal_reports::submit_draft(
        &db,
        "execution",
        &serde_json::json!({"summary":"Verified resumed team goal","verdict":"met"}),
    )
    .unwrap();
    sessions::end_turn(&db, &resumed, "completed", None, None, false).unwrap();
    let completed = crate::goal_holds::settle(
        &db,
        &lead,
        "execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert_eq!(completed["execution"]["state"], "completed");
}

#[test]
fn replacement_goal_approval_releases_hold_pause_before_new_member_dispatch() {
    let (db, lead, turn) = fixture();
    ensure_team(&db, &lead).unwrap();
    db.conn().execute("UPDATE plan_approvals SET kind='goal',target_permission_mode='ask',artifact_relative_path='.pi/goal/old.md',artifact_sha256='abc',artifact_size_bytes=1 WHERE execution_id='execution'",[]).unwrap();
    crate::goal_reports::bind_execution_turn(&db, "execution", &turn).unwrap();
    let old_review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Old approved goal",
            members: Some(vec![super::test_support::expert_proposal("old-expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    confirm_launch_review(&db, &lead, &old_review.review_id, old_review.revision).unwrap();
    let old_dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "old-expert",
            content: "Old owned dispatch",
            idempotency_key: None,
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &old_dispatch, false).unwrap();
    let unrelated = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "old-expert",
            content: "Unrelated retained mail",
            idempotency_key: None,
        },
    )
    .unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    crate::goal_holds::settle(
        &db,
        &lead,
        "execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert!(get_team(&db, &lead).unwrap().unwrap().paused);
    let manager = crate::plans::PlanManager;
    let negotiation = sessions::begin_turn(&db, &lead, None, None).unwrap();
    manager
        .enter(&db, &lead, &negotiation, "enter-goal", "goal")
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    let proposal = manager
        .submit(
            &db,
            crate::plans::PlanSubmitParams {
                workspace_root: root.path(),
                session_id: &lead,
                turn_id: &negotiation,
                tool_call_id: "replacement-submit",
                kind: "goal",
                title: "Replacement",
                markdown: "# Replacement contract",
                question: "Approve?",
                artifact_workspace_kind: "project",
            },
        )
        .unwrap();
    sessions::end_turn(&db, &negotiation, "completed", None, None, false).unwrap();
    let approved = manager
        .resolve(
            &db,
            crate::plans::PlanResolveParams {
                workspace_root: Some(root.path()),
                proposal_id: &proposal.id,
                session_id: &lead,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "approve",
                target_permission_mode: Some("ask"),
            },
        )
        .unwrap()
        .execution
        .unwrap();
    assert!(!get_team(&db, &lead).unwrap().unwrap().paused);
    assert_eq!(
        crate::session_collaboration::get(&db, &old_dispatch.id)
            .unwrap()
            .unwrap()
            .status,
        "cancelled"
    );
    assert_eq!(
        super::dispatch_metadata::read(db.conn(), &old_dispatch.id)
            .unwrap()
            .unwrap()
            .dispatch_cancellation
            .as_deref(),
        Some("superseded")
    );
    assert_eq!(
        crate::session_collaboration::get(&db, &unrelated.id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    assert_eq!(
        crate::goal_holds::get_hold(&db, &lead, "execution")
            .unwrap()
            .unwrap()
            .state,
        "superseded"
    );
    manager.claim_execution(&db, &approved.id).unwrap();
    let execution_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    crate::goal_reports::bind_execution_turn(&db, &approved.id, &execution_turn).unwrap();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &execution_turn,
            strategy: "delegate",
            reason: "New approved goal",
            members: Some(vec![super::test_support::expert_proposal("replacement")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "replacement",
            content: "Implement replacement contract",
            idempotency_key: None,
        },
    )
    .unwrap();
    assert!(crate::session_collaboration::begin_turn(
        &db,
        &decision.member_session_ids[0],
        &dispatch.id,
        None,
        None
    )
    .is_ok());
}
