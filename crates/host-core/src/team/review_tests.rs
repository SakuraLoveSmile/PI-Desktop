use super::test_support::expert_proposal;
use super::tests::{
    create_team_member, create_test_lead, ensure_test_route, finish_test_turn, start_test_turn,
    test_db,
};
use crate::sessions;
use crate::team::review::{require_approved_member, validate_member_route};
use crate::team::roster::{create_team_member as create_team_member_unapproved, *};
use crate::team::*;
use serde_json::json;

#[test]
fn direct_roster_creation_requires_approval_without_creating_a_session() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let error = create_team_member_unapproved(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "unreviewed",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    assert!(list_team_members(&db, &lead_id).unwrap().is_empty());
    let member_sessions: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE title = 'Teammate: unreviewed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(member_sessions, 0);
}

#[test]
fn route_validation_rejects_unsupported_thinking_levels() {
    let db = test_db();
    ensure_test_route(&db, "off-only-provider", "off-only-model");
    let config = json!({
        "models": [{"id": "off-only-model", "thinkingLevels": ["off"]}],
        "supportsReasoning": false
    })
    .to_string();
    db.conn()
        .execute(
            "UPDATE providers SET config_json = ?1 WHERE id = ?2",
            rusqlite::params![config, "off-only-provider"],
        )
        .unwrap();
    let error =
        validate_member_route(&db, "off-only-provider", "off-only-model", "high").unwrap_err();
    assert!(error.to_string().contains("TEAM_MODEL_SELECTION_INVALID"));
}

#[test]
fn strategy_declaration_requires_a_running_turn_owned_by_the_lead() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let other_lead = create_test_lead(&db);
    start_test_turn(&db, &other_lead, "foreign-turn");

    for turn_id in ["foreign-turn", "missing-turn", ""] {
        let error = declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead_id,
                caller_session_id: &lead_id,
                lead_turn_id: turn_id,
                strategy: "delegate",
                reason: "No record should be written",
                members: Some(vec![expert_proposal("probe")]),
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("TEAM_TURN_INVALID") || turn_id.is_empty());
        assert!(get_execution_decision(&db, &lead_id, turn_id)
            .unwrap()
            .is_none());
    }
    assert!(get_latest_execution_decision(&db, &lead_id)
        .unwrap()
        .is_none());
}

#[test]
fn review_cannot_alias_an_existing_member_session_under_a_different_name() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let existing = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "researcher",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let latest_before = get_latest_execution_decision(&db, &lead_id)
        .unwrap()
        .unwrap();
    start_test_turn(&db, &lead_id, "alias-turn");
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "alias-turn",
            strategy: "delegate",
            reason: "Try to rename an immutable member",
            members: Some(vec![TeamProposedMember {
                name: "writer".to_string(),
                description: None,
                context_kind: Some("fresh".to_string()),
                member_session_id: Some(existing.member_session_id.clone()),
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap_err();
    finish_test_turn(&db, "alias-turn");
    assert!(error.to_string().contains("TEAM_MEMBER_NAME_COLLISION"));
    assert!(get_execution_decision(&db, &lead_id, "alias-turn")
        .unwrap()
        .is_none());
    assert_eq!(
        get_latest_execution_decision(&db, &lead_id)
            .unwrap()
            .unwrap()
            .lead_turn_id,
        latest_before.lead_turn_id
    );
    assert_eq!(list_team_members(&db, &lead_id).unwrap().len(), 1);
}

#[test]
fn forked_member_applies_the_confirmed_route_and_thinking_level() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    ensure_test_route(&db, "fork-provider", "fork-model");
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "fork-worker",
            description: None,
            context_kind: Some("fork"),
            model_id: Some("fork-model"),
            provider_id: Some("fork-provider"),
        },
    )
    .unwrap();
    let session = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(session.provider_id.as_deref(), Some("fork-provider"));
    assert_eq!(session.model_id.as_deref(), Some("fork-model"));
    assert_eq!(session.thinking_level, "off");
}

#[test]
fn uncommitted_team_fork_is_not_restored_as_an_ordinary_session() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let outer_tx = db.conn().unchecked_transaction().unwrap();
    let result = sessions::fork_session_through(&db, &lead_id, Some("Staged fork"), None).unwrap();
    let child_id = match result {
        sessions::ForkSessionResult::Created(detail) => detail.summary.id,
        sessions::ForkSessionResult::Busy | sessions::ForkSessionResult::NotFound => {
            panic!("expected a staged fork")
        }
    };
    drop(outer_tx);

    let transcript = crate::transcripts::transcript_path(db.data_dir(), &child_id).unwrap();
    let marker = transcript.with_extension("team-fork-pending");
    assert!(transcript.exists());
    assert!(marker.exists());
    assert!(!sessions::restore_orphaned_session(&db, &child_id).unwrap());
    assert!(sessions::get_session(&db, &child_id).unwrap().is_none());
    assert!(transcript.exists());
    assert!(marker.exists());
    let turns: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM turns WHERE session_id = ?1",
            [&child_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(turns, 0);
}

#[test]
fn test_team_strategy_declaration_and_launch_review_lifecycle() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    ensure_test_route(&db, "prov-1", "model-1");
    ensure_test_route(&db, "prov-test", "model-test");

    start_test_turn(&db, &lead_id, "turn-1");
    let (dec1, rev1) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-1",
            strategy: "delegate",
            reason: "Indivisible task",
            members: Some(vec![expert_proposal("probe")]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "turn-1");
    assert_eq!(dec1.strategy.as_deref(), Some("delegate"));
    assert_eq!(rev1.unwrap().status, "pending");

    let dec_read = get_execution_decision(&db, &lead_id, "turn-1")
        .unwrap()
        .unwrap();
    assert_eq!(dec_read.strategy.as_deref(), Some("delegate"));
    assert_eq!(dec_read.reason.as_deref(), Some("Indivisible task"));
    assert_eq!(
        get_latest_execution_decision(&db, &lead_id)
            .unwrap()
            .unwrap()
            .lead_turn_id,
        "turn-1"
    );
    assert_eq!(
        declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead_id,
                caller_session_id: &lead_id,
                lead_turn_id: "turn-1",
                strategy: "delegate",
                reason: "Indivisible task",
                members: Some(vec![expert_proposal("probe")]),
            },
        )
        .unwrap()
        .0
        .lead_turn_id,
        "turn-1"
    );
    let conflict = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-1",
            strategy: "delegate",
            reason: "Different input",
            members: Some(vec![expert_proposal("probe")]),
        },
    )
    .unwrap_err();
    assert!(conflict
        .to_string()
        .contains("TEAM_REVIEW_REVISION_CONFLICT"));

    let unicode = "🧪".repeat(MAX_TEAM_STRATEGY_REASON_CHARS + 4);
    start_test_turn(&db, &lead_id, "turn-unicode");
    let (bounded, _) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-unicode",
            strategy: "delegate",
            reason: &unicode,
            members: Some(vec![expert_proposal("probe")]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "turn-unicode");
    assert_eq!(
        bounded.reason.as_deref().unwrap().chars().count(),
        MAX_TEAM_STRATEGY_REASON_CHARS
    );

    start_test_turn(&db, &lead_id, "turn-2");
    let (dec2, rev2) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-2",
            strategy: "delegate",
            reason: "Complex multi-file refactoring",
            members: Some(vec![
                TeamProposedMember {
                    name: "architect".to_string(),
                    description: Some("System architecture".to_string()),
                    context_kind: Some("fresh".to_string()),
                    member_session_id: None,
                    presentation: None,
                    selection: Some(TeamMemberSelectionPartial {
                        provider_id: Some("prov-1".to_string()),
                        model_id: Some("model-1".to_string()),
                        thinking_level: Some("high".to_string()),
                    }),
                },
                TeamProposedMember {
                    name: "tester".to_string(),
                    description: Some("Testing suites".to_string()),
                    context_kind: Some("fresh".to_string()),
                    member_session_id: None,
                    presentation: None,
                    selection: None,
                },
            ]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "turn-2");
    assert_eq!(dec2.strategy.as_deref(), Some("delegate"));
    let rev = rev2.unwrap();
    assert_eq!(rev.status, "pending");
    assert_eq!(rev.revision, 1);
    assert_eq!(rev.members.len(), 2);
    assert_eq!(rev.members[0].name, "architect");
    assert_eq!(rev.members[0].selection.model_id, "model-1");

    let read_rev = get_launch_review(&db, &lead_id, Some(&rev.review_id))
        .unwrap()
        .unwrap();
    assert_eq!(read_rev.review_id, rev.review_id);
    assert_eq!(read_rev.members[1].name, "tester");

    let updated_rev = update_launch_review(
        &db,
        &lead_id,
        &rev.review_id,
        1,
        vec![TeamLaunchReviewSelectionUpdate {
            name: "tester".to_string(),
            provider_id: "prov-test".to_string(),
            model_id: "model-test".to_string(),
            thinking_level: "low".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(updated_rev.revision, 2);
    assert_eq!(updated_rev.members[1].selection.model_id, "model-test");
    let stale_err = update_launch_review(&db, &lead_id, &rev.review_id, 1, vec![]).unwrap_err();
    assert!(stale_err
        .to_string()
        .contains("TEAM_REVIEW_REVISION_CONFLICT"));
    let empty_update = update_launch_review(&db, &lead_id, &rev.review_id, 2, vec![]).unwrap_err();
    assert!(empty_update.to_string().contains("INVALID_PARAMS"));
    let duplicate_update = update_launch_review(
        &db,
        &lead_id,
        &rev.review_id,
        2,
        vec![
            TeamLaunchReviewSelectionUpdate {
                name: "tester".to_string(),
                provider_id: "prov-test".to_string(),
                model_id: "model-test".to_string(),
                thinking_level: "low".to_string(),
            },
            TeamLaunchReviewSelectionUpdate {
                name: "TESTER".to_string(),
                provider_id: "prov-test".to_string(),
                model_id: "model-test".to_string(),
                thinking_level: "low".to_string(),
            },
        ],
    )
    .unwrap_err();
    assert!(duplicate_update.to_string().contains("INVALID_PARAMS"));
    let unchanged = get_launch_review(&db, &lead_id, Some(&rev.review_id))
        .unwrap()
        .unwrap();
    assert_eq!(unchanged.revision, 2);
    assert_eq!(unchanged.members[1].selection.model_id, "model-test");

    let (confirmed, confirmed_dec) =
        confirm_launch_review(&db, &lead_id, &rev.review_id, 2).unwrap();
    assert_eq!(confirmed.status, "confirmed");
    assert_eq!(confirmed.revision, 3);
    assert_eq!(confirmed_dec.member_session_ids.len(), 2);
    assert!(!confirmed_dec.message_ids.is_empty());
    let (dup_confirmed, dup_decision) =
        confirm_launch_review(&db, &lead_id, &rev.review_id, 2).unwrap();
    assert_eq!(dup_confirmed.status, "confirmed");
    assert_eq!(
        dup_decision.member_session_ids,
        confirmed_dec.member_session_ids
    );
    assert_eq!(dup_decision.message_ids, confirmed_dec.message_ids);

    let roster = list_team_members(&db, &lead_id).unwrap();
    assert_eq!(roster.len(), 2);
    assert_eq!(roster[0].name, "architect");
    assert_eq!(roster[1].name, "tester");
    let member_sid = &roster[0].member_session_id;
    let mode_err =
        gate_session_configure(&db, member_sid, "chat", None, None, None, None, None).unwrap_err();
    assert!(mode_err
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
    ensure_test_route(&db, "prov-new", "model-new");
    assert!(gate_session_configure(
        &db,
        member_sid,
        "agent",
        Some("prov-new"),
        Some("model-new"),
        Some("high"),
        None,
        Some("team"),
    )
    .is_ok());

    start_test_turn(&db, &lead_id, "turn-3");
    let (_, pending_rev) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-3",
            strategy: "delegate",
            reason: "Another batch",
            members: Some(vec![TeamProposedMember {
                name: "analyst".to_string(),
                description: None,
                context_kind: None,
                member_session_id: None,
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "turn-3");
    let p_id = pending_rev.unwrap().review_id;
    let revision_before_restart = get_team(&db, &lead_id).unwrap().unwrap().revision;
    interrupt_pending_reviews_on_boot(&db).unwrap();
    let interrupted_rev = get_launch_review(&db, &lead_id, Some(&p_id))
        .unwrap()
        .unwrap();
    assert_eq!(interrupted_rev.status, "interrupted");
    assert_eq!(
        get_team(&db, &lead_id).unwrap().unwrap().revision,
        revision_before_restart + 1
    );
}

#[test]
fn member_presentation_survives_review_confirmation_and_snapshot_hydration() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    ensure_test_route(&db, "prov-presentation", "model-presentation");
    start_test_turn(&db, &lead_id, "presentation-turn");
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "presentation-turn",
            strategy: "delegate",
            reason: "Delegate a research task",
            members: Some(vec![TeamProposedMember {
                name: "research-alex".to_string(),
                description: Some("Research specialist".to_string()),
                context_kind: None,
                member_session_id: None,
                presentation: Some(TeamMemberPresentation {
                    role: "researcher".to_string(),
                    display_name: "Alex".to_string(),
                }),
                selection: None,
            }]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "presentation-turn");
    let review = review.unwrap();
    assert_eq!(
        review.members[0]
            .presentation
            .as_ref()
            .unwrap()
            .display_name,
        "Alex"
    );
    assert!(list_team_members(&db, &lead_id).unwrap().is_empty());

    confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap();
    send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: "research-alex",
            content: "Start the research when ready.",
            idempotency_key: Some("presentation-waiting-message"),
        },
    )
    .unwrap();
    let snapshot = get_team_snapshot(&db, &lead_id).unwrap();
    assert_eq!(snapshot.members.len(), 1);
    assert_eq!(
        snapshot.members[0].presentation.as_ref().unwrap().role,
        "researcher"
    );
    assert_eq!(
        snapshot.members[0]
            .presentation
            .as_ref()
            .unwrap()
            .display_name,
        "Alex"
    );
    assert_eq!(snapshot.members[0].phase, "idle");
    assert_eq!(snapshot.queued_message_count, 2);
    let waiting_messages: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages
             WHERE target_session_id=?1 AND status='queued'",
            [&snapshot.members[0].member_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(waiting_messages, 1);
    assert_eq!(snapshot.lead_phase, "completed");
    assert_eq!(
        snapshot.revision,
        get_team(&db, &lead_id).unwrap().unwrap().revision
    );

    start_test_turn(&db, &lead_id, "lead-error-turn");
    sessions::end_turn(
        &db,
        "lead-error-turn",
        "error",
        Some("MODEL_ERROR"),
        None,
        false,
    )
    .unwrap();
    assert_eq!(
        get_team_snapshot(&db, &lead_id).unwrap().lead_phase,
        "failed"
    );
}

#[test]
fn failed_confirmation_rolls_back_session_roster_message_and_review_state() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    start_test_turn(&db, &lead_id, "atomic-confirm-turn");
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "atomic-confirm-turn",
            strategy: "delegate",
            reason: "Exercise confirmation rollback",
            members: Some(vec![TeamProposedMember {
                name: "atomic-worker".to_string(),
                description: None,
                context_kind: Some("fresh".to_string()),
                member_session_id: None,
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "atomic-confirm-turn");
    let review = review.unwrap();
    db.conn()
        .execute_batch(
            "CREATE TRIGGER reject_team_confirmation_state
             BEFORE UPDATE ON kv
             WHEN NEW.ns = 'team-launch-review-v1'
             BEGIN
               SELECT RAISE(ABORT, 'injected confirmation state failure');
             END;",
        )
        .unwrap();

    let error =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap_err();
    assert!(error
        .to_string()
        .contains("injected confirmation state failure"));
    assert!(list_team_members(&db, &lead_id).unwrap().is_empty());
    let sessions_after_failure: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(sessions_after_failure, 1);
    let pending = get_launch_review(&db, &lead_id, Some(&review.review_id))
        .unwrap()
        .unwrap();
    assert_eq!(pending.status, "pending");
    assert_eq!(pending.revision, review.revision);
    let decision = get_execution_decision(&db, &lead_id, "atomic-confirm-turn")
        .unwrap()
        .unwrap();
    assert!(decision.member_session_ids.is_empty());
    assert!(decision.message_ids.is_empty());
    let queued_confirmations: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages
             WHERE idempotency_key LIKE 'team-review:%:confirmed'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(queued_confirmations, 0);

    db.conn()
        .execute_batch("DROP TRIGGER reject_team_confirmation_state;")
        .unwrap();
    let (confirmed, decision) =
        confirm_launch_review(&db, &lead_id, &review.review_id, review.revision).unwrap();
    assert_eq!(confirmed.status, "confirmed");
    assert_eq!(decision.member_session_ids.len(), 1);
    assert_eq!(decision.message_ids.len(), 1);
}

#[test]
fn team_member_configure_updates_session_and_roster_atomically_and_expires_route_approval() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "config-worker",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    ensure_test_route(&db, "new-provider", "new-model");
    let configured = sessions::configure_session_with_profile(
        &db,
        &member.member_session_id,
        "agent",
        Some("new-provider"),
        Some("new-model"),
        Some("high"),
        None,
        Some("team"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(configured.provider_id.as_deref(), Some("new-provider"));
    assert_eq!(configured.model_id.as_deref(), Some("new-model"));
    assert_eq!(configured.thinking_level, "high");
    let roster = get_team_member_by_session_id(&db, &member.member_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(roster.provider_id.as_deref(), Some("new-provider"));
    assert_eq!(roster.model_id.as_deref(), Some("new-model"));
    let approval_error =
        require_approved_member(&db, &lead_id, &member.member_session_id).unwrap_err();
    assert!(approval_error
        .to_string()
        .contains("TEAM_APPROVAL_REQUIRED"));
    let send_error = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: "config-worker",
            content: "Unapproved dispatch",
            idempotency_key: Some("unapproved-config-dispatch"),
        },
    )
    .unwrap_err();
    assert!(send_error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    let unapproved_messages: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages
             WHERE idempotency_key = 'unapproved-config-dispatch'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unapproved_messages, 0);
    let task_error = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: Some("unapproved-config-task"),
            subject: "Unapproved work",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(&member.member_session_id),
            owner_member_name: Some("config-worker"),
        },
    )
    .unwrap_err();
    assert!(task_error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    assert!(list_team_tasks(&db, &lead_id).unwrap().is_empty());
    let report_error = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &member.member_session_id,
            target_identifier: "Lead",
            content: "Existing member report",
            idempotency_key: Some("member-report-to-lead"),
        },
    )
    .unwrap_err();
    assert!(report_error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    let unapproved_reports: i64 = db
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM session_collaboration_messages
             WHERE idempotency_key = 'member-report-to-lead'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unapproved_reports, 0);

    ensure_test_route(&db, "rollback-provider", "rollback-model");
    db.conn()
        .execute_batch(
            "CREATE TRIGGER reject_team_route_mirror
             BEFORE UPDATE OF provider_id ON team_members
             WHEN NEW.provider_id = 'rollback-provider'
             BEGIN
               SELECT RAISE(ABORT, 'injected route mirror failure');
             END;",
        )
        .unwrap();
    let error = sessions::configure_session_with_profile(
        &db,
        &member.member_session_id,
        "agent",
        Some("rollback-provider"),
        Some("rollback-model"),
        Some("low"),
        None,
        Some("team"),
    )
    .unwrap_err();
    assert!(error.to_string().contains("injected route mirror failure"));
    let unchanged = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap()
        .summary;
    assert_eq!(unchanged.provider_id.as_deref(), Some("new-provider"));
    assert_eq!(unchanged.model_id.as_deref(), Some("new-model"));
    assert_eq!(unchanged.thinking_level, "high");
    db.conn()
        .execute_batch("DROP TRIGGER reject_team_route_mirror;")
        .unwrap();

    start_test_turn(&db, &lead_id, "configure-pending");
    let (_, pending) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "configure-pending",
            strategy: "delegate",
            reason: "Review the existing worker route",
            members: Some(vec![TeamProposedMember {
                name: "config-worker".to_string(),
                description: None,
                context_kind: Some("fresh".to_string()),
                member_session_id: Some(member.member_session_id.clone()),
                presentation: None,
                selection: Some(TeamMemberSelectionPartial {
                    provider_id: Some("new-provider".to_string()),
                    model_id: Some("new-model".to_string()),
                    thinking_level: Some("high".to_string()),
                }),
            }]),
        },
    )
    .unwrap();
    finish_test_turn(&db, "configure-pending");
    assert!(pending.is_some());
    let blocked = sessions::configure_session_with_profile(
        &db,
        &member.member_session_id,
        "agent",
        Some("test-provider"),
        Some("test-model"),
        Some("off"),
        None,
        Some("team"),
    )
    .unwrap_err();
    assert!(blocked
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
}

#[test]
fn solo_declaration_cannot_start_team_planning() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "lead_only",
            reason: "Single task",
            members: None,
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("TEAM_APPROVAL_REQUIRED"));
    assert!(get_execution_decision(&db, &lead, &turn).unwrap().is_none());
    assert!(get_launch_review(&db, &lead, None).unwrap().is_none());
    assert!(super::planning::get(&db, &lead).unwrap().is_none());
}
