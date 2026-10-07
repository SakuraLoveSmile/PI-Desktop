use super::tests::{
    create_team_member, create_test_lead, ensure_test_route, finish_test_turn, start_test_turn,
    test_db,
};
use crate::sessions;
use crate::team::*;
use serde_json::json;

fn propose_reuse_review(
    db: &crate::db::Database,
    lead_session_id: &str,
    member: &TeamMember,
    turn_id: &str,
) -> TeamLaunchReview {
    let selection = sessions::get_session(db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    start_test_turn(db, lead_session_id, turn_id);
    let (_, review) = declare_team_strategy(
        db,
        DeclareStrategyParams {
            team_session_id: lead_session_id,
            caller_session_id: lead_session_id,
            lead_turn_id: turn_id,
            strategy: "delegate",
            reason: "Review an existing member route",
            members: Some(vec![TeamProposedMember {
                name: member.name.clone(),
                description: member.description.clone(),
                context_kind: Some(member.context_kind.clone()),
                member_session_id: Some(member.member_session_id.clone()),
                presentation: None,
                selection: Some(TeamMemberSelectionPartial {
                    provider_id: selection.provider_id,
                    model_id: selection.model_id,
                    thinking_level: Some(selection.thinking_level),
                }),
            }]),
        },
    )
    .unwrap();
    finish_test_turn(db, turn_id);
    review.unwrap()
}

#[test]
fn confirmation_reuse_rejects_a_running_member_then_succeeds_when_idle() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "running-reuse",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let review = propose_reuse_review(&db, &lead_id, &member, "running-reuse-proposal");
    let turn_id = sessions::begin_turn(&db, &member.member_session_id, None, None).unwrap();

    let error =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap_err();
    assert!(error
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
    assert_eq!(
        get_launch_review(&db, &lead_id, Some(&review.review_id))
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
    sessions::end_turn(&db, &turn_id, "completed", None, None, false).unwrap();
    let (confirmed, _) =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap();
    assert_eq!(confirmed.status, "confirmed");
}

#[test]
fn confirmation_reuse_rejects_queued_dispatch_without_mutating_route_or_review() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "queued-reuse",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let review = propose_reuse_review(&db, &lead_id, &member, "queued-reuse-proposal");
    let before = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: &member.name,
            content: "Pending queue must block route reuse",
            idempotency_key: Some("queued-reuse-dispatch"),
        },
    )
    .unwrap();

    let error =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap_err();
    assert!(error
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
    let after = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(after.provider_id, before.provider_id);
    assert_eq!(after.model_id, before.model_id);
    assert_eq!(after.thinking_level, before.thinking_level);
    assert_eq!(
        get_launch_review(&db, &lead_id, Some(&review.review_id))
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
}

#[test]
fn confirmation_reuse_rejects_turn_queue_work_without_mutating_route_or_review() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "turn-queue-reuse",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let review = propose_reuse_review(&db, &lead_id, &member, "turn-queue-reuse-proposal");
    let before = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    db.conn()
        .execute(
            "INSERT INTO turn_queue (
                id, session_id, principal, input_hash, content, permission_mode,
                position, created_at
             ) VALUES ('queued-work', ?1, 'test', 'hash', 'queued', 'ask', 1, 0)",
            [&member.member_session_id],
        )
        .unwrap();

    let error =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap_err();
    assert!(error
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
    let after = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(after.provider_id, before.provider_id);
    assert_eq!(after.model_id, before.model_id);
    assert_eq!(after.thinking_level, before.thinking_level);
    assert_eq!(
        get_launch_review(&db, &lead_id, Some(&review.review_id))
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
}

#[test]
fn confirmation_reuse_rejects_another_pending_review_without_mutating_state() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "pending-review-reuse",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let review = propose_reuse_review(&db, &lead_id, &member, "pending-reuse-first");
    let other = propose_reuse_review(&db, &lead_id, &member, "pending-reuse-second");
    let before = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;

    let error =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap_err();
    assert!(error.to_string().contains("TEAM_REVIEW_REVISION_CONFLICT"));
    let after = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(after.provider_id, before.provider_id);
    assert_eq!(after.model_id, before.model_id);
    assert_eq!(after.thinking_level, before.thinking_level);
    for review_id in [&review.review_id, &other.review_id] {
        assert_eq!(
            get_launch_review(&db, &lead_id, Some(review_id))
                .unwrap()
                .unwrap()
                .status,
            "pending"
        );
    }
}

#[test]
fn ordinary_member_turn_requires_approval_and_the_confirmed_route() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "turn-gated-member",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    db.conn()
        .execute("DELETE FROM kv WHERE ns = ?1", [TEAM_LAUNCH_REVIEW_NS])
        .unwrap();
    db.conn()
        .execute("DELETE FROM kv WHERE ns = ?1", [TEAM_EXECUTION_DECISION_NS])
        .unwrap();

    let error = sessions::begin_turn(&db, &member.member_session_id, None, None).unwrap_err();
    assert!(error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    let turns: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM turns WHERE session_id = ?1",
            [&member.member_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(turns, 0);
}

#[test]
fn ordinary_member_turn_rejects_a_route_override() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "route-gated-member",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    let error = sessions::begin_turn(
        &db,
        &member.member_session_id,
        Some("another-provider"),
        Some("another-model"),
    )
    .unwrap_err();
    assert!(error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    let turns: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM turns WHERE session_id = ?1",
            [&member.member_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(turns, 0);
}

#[test]
fn unrelated_fresh_member_review_does_not_block_existing_member_configuration() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let existing = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "existing-worker",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    start_test_turn(&db, &lead_id, "fresh-member-review");
    let (_, pending) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "fresh-member-review",
            strategy: "delegate",
            reason: "Add a separate worker",
            members: Some(vec![TeamProposedMember {
                name: "new-worker".to_string(),
                description: None,
                context_kind: Some("fresh".to_string()),
                member_session_id: None,
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "fresh-member-review");
    assert!(pending.is_some());

    ensure_test_route(&db, "independent-provider", "independent-model");
    let configured = sessions::configure_session_with_profile(
        &db,
        &existing.member_session_id,
        "agent",
        Some("independent-provider"),
        Some("independent-model"),
        Some("high"),
        None,
        Some("team"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        configured.provider_id.as_deref(),
        Some("independent-provider")
    );
    assert_eq!(configured.model_id.as_deref(), Some("independent-model"));
}

#[test]
fn queued_team_mail_remains_recoverable_after_member_approval_is_removed() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "mail-recovery-member",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: &member.name,
            content: "Previously queued durable dispatch",
            idempotency_key: Some("legacy-queued-mail"),
        },
    )
    .unwrap();
    db.conn()
        .execute("DELETE FROM kv WHERE ns = ?1", [TEAM_LAUNCH_REVIEW_NS])
        .unwrap();
    db.conn()
        .execute("DELETE FROM kv WHERE ns = ?1", [TEAM_EXECUTION_DECISION_NS])
        .unwrap();

    let turn = crate::session_collaboration::begin_turn(
        &db,
        &member.member_session_id,
        &message.id,
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        crate::session_collaboration::get(&db, &message.id)
            .unwrap()
            .unwrap()
            .status,
        "running"
    );
    let report = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &member.member_session_id,
            target_identifier: "Lead",
            content: "Report from the recovered legacy turn",
            idempotency_key: Some("legacy-mail-report"),
        },
    )
    .unwrap();
    assert_eq!(report.target_session_id, lead_id);
    sessions::append_message(
        &db,
        &member.member_session_id,
        &serde_json::from_value(json!({
            "id": "legacy-report",
            "role": "assistant",
            "content": "Recovered result",
            "createdAt": "2026-10-01T00:00:00.000Z"
        }))
        .unwrap(),
        Some(&turn),
    )
    .unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert!(crate::session_collaboration::settle_turn(&db, &turn)
        .unwrap()
        .is_none());
    assert_eq!(
        crate::session_collaboration::get(&db, &message.id)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
}
