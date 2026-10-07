use super::{authority::*, planning, tests::*, *};
use crate::{session_collaboration, sessions};
use serde_json::json;

fn proposal(db: &crate::db::Database, lead: &str, turn: &str) -> TeamLaunchReview {
    declare_team_strategy(
        db,
        DeclareStrategyParams {
            team_session_id: lead,
            caller_session_id: lead,
            lead_turn_id: turn,
            strategy: "delegate",
            reason: "One focused expert task",
            members: Some(vec![TeamProposedMember {
                name: "expert".into(),
                description: None,
                context_kind: None,
                member_session_id: None,
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap()
    .1
    .unwrap()
}
fn dispatch(db: &crate::db::Database, lead: &str) -> TeamMessage {
    let message = send_team_message(
        db,
        SendMessageParams {
            team_session_id: lead,
            caller_session_id: lead,
            target_identifier: "expert",
            content: "Inspect the assigned task",
            idempotency_key: None,
        },
    )
    .unwrap();
    record_dispatch(db, lead, &message, false).unwrap();
    message
}

#[test]
fn solo_and_empty_declarations_are_rejected_without_consuming_the_delegate_retry() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    for strategy in ["lead_only", "delegate"] {
        let error = declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: &turn,
                strategy,
                reason: "Do not bypass Expert Team",
                members: None,
            },
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("TEAM_APPROVAL_REQUIRED")
                || error.to_string().contains("INVALID_PARAMS")
        );
        assert!(get_execution_decision(&db, &lead, &turn).unwrap().is_none());
        assert!(get_launch_review(&db, &lead, None).unwrap().is_none());
    }
    let review = proposal(&db, &lead, &turn);
    assert_eq!(review.strategy.as_deref(), Some("delegate"));
    assert_eq!(review.members.len(), 1);
    assert_eq!(review.status, "pending");
}

#[test]
fn expert_turn_is_required_beyond_consent_and_new_user_scopes_cannot_inherit_it() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let review = proposal(&db, &lead, &turn);
    for tool in [
        "Read",
        "Glob",
        "Grep",
        "ToolSearch",
        "asktool",
        "team_status",
        "declare_team_strategy",
    ] {
        validate_lead_tool(&db, &lead, tool).unwrap();
    }
    assert!(validate_lead_tool(&db, &lead, "Write").is_err());
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    for tool in [
        "task_create",
        "task_update",
        "send_message",
        "spawn_teammate",
    ] {
        validate_lead_tool(&db, &lead, tool).unwrap();
    }
    for tool in [
        "Bash",
        "Write",
        "Edit",
        "Skill",
        "plugin_execute",
        "BrowserPreview",
        "SubmitPlan",
    ] {
        assert!(validate_lead_tool(&db, &lead, tool).is_err());
    }
    let message = dispatch(&db, &lead);
    assert!(
        validate_lead_tool(&db, &lead, "Write").is_err(),
        "queued dispatch does not prove participation"
    );
    let member_turn =
        session_collaboration::begin_turn(&db, &message.target_session_id, &message.id, None, None)
            .unwrap();
    validate_lead_tool(&db, &lead, "Write").unwrap();
    db.conn()
        .execute(
            "UPDATE turns SET status='failed' WHERE id=?1",
            [&member_turn],
        )
        .unwrap();
    assert!(
        validate_lead_tool(&db, &lead, "Write").is_err(),
        "failed expert cannot remain an execution grant"
    );
    db.conn()
        .execute(
            "UPDATE turns SET status='completed' WHERE id=?1",
            [&member_turn],
        )
        .unwrap();
    validate_lead_tool(&db, &lead, "Write").unwrap();
    finish_test_turn(&db, &turn);
    let mail_turn =
        session_collaboration::begin_turn(&db, &lead, &decision.message_ids[0], None, None)
            .unwrap();
    validate_lead_tool(&db, &lead, "Write").unwrap();
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &mail_turn,
            strategy: "delegate",
            reason: "Unnecessary redeclaration",
            members: None,
        },
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("approved strategy already covers this continuation"));
    assert!(get_execution_decision(&db, &lead, &mail_turn)
        .unwrap()
        .is_none());
    finish_test_turn(&db, &mail_turn);
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    assert!(validate_lead_tool(&db, &lead, "Write").is_err());
}

#[test]
fn historical_solo_or_empty_reviews_never_authorize_even_when_marked_confirmed() {
    for (strategy, status) in [
        ("lead_only", "pending"),
        ("lead_only", "confirmed"),
        ("delegate", "confirmed"),
    ] {
        let db = test_db();
        let lead = create_test_lead(&db);
        let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
        let review = json!({"schemaVersion":1,"reviewId":"old-review","teamSessionId":lead,"leadTurnId":turn,"revision":1,"status":status,"strategy":strategy,"members":[]});
        db.kv_set(
            TEAM_LAUNCH_REVIEW_NS,
            &format!("{lead}:old-review"),
            &review,
        )
        .unwrap();
        db.kv_set(TEAM_EXECUTION_DECISION_NS, &format!("{lead}:{turn}"), &json!({"schemaVersion":1,"teamSessionId":lead,"leadTurnId":turn,"strategy":strategy,"updatedAt":"0","reviewIds":["old-review"],"taskIds":[],"memberSessionIds":[],"messageIds":[]})).unwrap();
        assert!(confirm_launch_review(&db, &lead, "old-review", 1)
            .unwrap_err()
            .to_string()
            .contains("TEAM_APPROVAL_REQUIRED"));
        assert!(validate_lead_tool(&db, &lead, "Write").is_err());
        // Even an identical historical solo retry must be rejected before its cache is read.
        if strategy == "lead_only" {
            assert!(declare_team_strategy(
                &db,
                DeclareStrategyParams {
                    team_session_id: &lead,
                    caller_session_id: &lead,
                    lead_turn_id: &turn,
                    strategy: "lead_only",
                    reason: "",
                    members: None
                }
            )
            .is_err());
        }
    }
}

#[test]
fn cancelled_interrupted_and_stale_reviews_never_materialize_experts() {
    for resolution in ["cancel", "interrupt", "new-turn"] {
        let db = test_db();
        let lead = create_test_lead(&db);
        let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
        let review = proposal(&db, &lead, &turn);
        match resolution {
            "cancel" => {
                cancel_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
            }
            "interrupt" => {
                interrupt_pending_reviews_on_boot(&db).unwrap();
            }
            _ => {
                finish_test_turn(&db, &turn);
                sessions::begin_turn(&db, &lead, None, None).unwrap();
            }
        }
        assert!(confirm_launch_review(&db, &lead, &review.review_id, review.revision).is_err());
        assert!(list_team_members(&db, &lead).unwrap().is_empty());
        assert!(planning::get(&db, &lead).unwrap().is_none());
        assert!(validate_lead_tool(&db, &lead, "Bash").is_err());
        assert!(list_pending_team_messages(&db, &lead).unwrap().is_empty());
    }
}

#[test]
fn old_unreviewed_aggregation_cannot_bypass_forced_expert_participation() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    planning::start(&db, &lead, "lead_only", None, vec![]).unwrap();
    assert!(planning::validate_submission(&db, &lead).is_err());
    let review = proposal(&db, &lead, &turn);
    assert_eq!(review.launch_policy.as_deref(), Some("automatic_plan"));
    assert!(planning::validate_submission(&db, &lead).is_err());
    assert_eq!(
        planning::get(&db, &lead).unwrap().unwrap().strategy,
        "delegate"
    );
}

#[test]
fn legacy_review_shape_remains_readable_as_delegate() {
    let review: TeamLaunchReview = serde_json::from_value(json!({"schemaVersion":1,"reviewId":"old","teamSessionId":"lead","leadTurnId":"turn","revision":1,"status":"pending","members":[]})).unwrap();
    assert_eq!(review.strategy.as_deref().unwrap_or("delegate"), "delegate");
}

#[test]
fn team_goal_negotiation_keeps_its_contract_and_agent_requires_strategy_consent() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='goal' WHERE id=?1", [&lead])
        .unwrap();
    sessions::begin_turn(&db, &lead, None, None).unwrap();
    for tool in ["SubmitGoal", "Read", "Glob", "Grep", "ToolSearch"] {
        planning::validate_tool(&db, &lead, tool).unwrap();
    }
    assert!(require_confirmed_strategy(&db, &lead).is_err());
    db.conn()
        .execute("UPDATE sessions SET mode='agent' WHERE id=?1", [&lead])
        .unwrap();
    planning::validate_tool(&db, &lead, "Read").unwrap();
    assert!(planning::validate_tool(&db, &lead, "Write").is_err());
}
