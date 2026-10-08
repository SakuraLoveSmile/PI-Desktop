use super::test_support::{complete_approved_expert_turn, expert_proposal};
use super::{planning::*, tests::*, *};
use crate::sessions;
pub(super) fn research() -> StructuredResearchResult {
    StructuredResearchResult {
        summary: "Checked actual sources".into(),
        findings: vec!["Host owns data".into()],
        risks: vec!["Race".into()],
        recommendations: vec!["CAS".into()],
        verified_sources: vec!["src/main.rs".into()],
    }
}
pub(super) fn setup() -> (crate::db::Database, String, Vec<TeamMember>) {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    start_test_turn(&db, &lead, "planning-turn");
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "planning-turn",
            strategy: "delegate",
            reason: "Two areas",
            members: Some(
                ["backend", "frontend"]
                    .into_iter()
                    .map(|name| TeamProposedMember {
                        preset_id: None,
                        name: name.into(),
                        description: None,
                        context_kind: None,
                        member_session_id: None,
                        presentation: None,
                        selection: None,
                    })
                    .collect(),
            ),
        },
    )
    .unwrap();
    let review = review.unwrap();
    assert_eq!(review.status, "confirmed");
    assert_eq!(review.launch_policy.as_deref(), Some("automatic_plan"));
    assert!(get(&db, &lead).unwrap().is_some());
    let members = list_team_members(&db, &lead).unwrap();
    for member in &members {
        complete_approved_expert_turn(&db, &lead, &member.member_session_id);
    }
    (db, lead, members)
}
pub(super) fn task(db: &crate::db::Database, lead: &str, member: &TeamMember) -> TeamTask {
    create_team_task(
        db,
        CreateTaskParams {
            team_session_id: lead,
            caller_session_id: lead,
            task_id: None,
            subject: &member.name,
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(&member.member_session_id),
            owner_member_name: None,
        },
    )
    .unwrap()
}
#[test]
fn expected_tasks_results_questions_and_review_purpose_are_authoritative() {
    let (db, lead, members) = setup();
    let first = task(&db, &lead, &members[0]);
    let second = task(&db, &lead, &members[1]);
    let state = get(&db, &lead).unwrap().unwrap();
    assert_eq!(state.expected_task_ids.len(), 2);
    assert_eq!(
        sessions::session_mode(&db, &members[0].member_session_id)
            .unwrap()
            .as_deref(),
        Some("plan")
    );
    assert!(purpose(&db, &lead).unwrap().is_none());
    assert!(validate_submission(&db, &lead).is_err());
    let revision = get_team(&db, &lead).unwrap().unwrap().revision;
    let p = || SubmitResearch {
        team: &lead,
        caller: &members[0].member_session_id,
        planning_id: &state.planning_id,
        round_id: &state.round_id,
        task_id: &first.task_id,
        expected_revision: first.revision,
        result: research(),
    };
    let result = submit(&db, p()).unwrap();
    assert_eq!(result.structured_result.risks, vec!["Race"]);
    assert!(get_team(&db, &lead).unwrap().unwrap().revision > revision);
    let completed_rev = get_team(&db, &lead).unwrap().unwrap().revision;
    assert_eq!(submit(&db, p()).unwrap(), result);
    assert_eq!(
        get_team(&db, &lead).unwrap().unwrap().revision,
        completed_rev
    );
    assert!(validate_submission(&db, &lead).is_err());
    question(&db, &lead, &lead, &state.round_id, "question", true).unwrap();
    submit(
        &db,
        SubmitResearch {
            team: &lead,
            caller: &members[1].member_session_id,
            planning_id: &state.planning_id,
            round_id: &state.round_id,
            task_id: &second.task_id,
            expected_revision: second.revision,
            result: research(),
        },
    )
    .unwrap();
    assert!(validate_submission(&db, &lead).is_err());
    question(&db, &lead, &lead, &state.round_id, "question", false).unwrap();
    start_test_turn(&db, &members[1].member_session_id, "research-still-running");
    assert!(validate_submission(&db, &lead).is_err());
    assert_eq!(
        projection(&db, &lead, &lead).unwrap()["isReadyForPlanSubmission"],
        false
    );
    finish_test_turn(&db, "research-still-running");
    validate_submission(&db, &lead).unwrap();
    update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: &first.task_id,
            expected_revision: 2,
            subject: Some("Recheck changed requirement"),
            description: None,
            status: Some("in_progress"),
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
    assert!(validate_submission(&db, &lead).is_err());
    submit(
        &db,
        SubmitResearch {
            team: &lead,
            caller: &members[0].member_session_id,
            planning_id: &state.planning_id,
            round_id: &state.round_id,
            task_id: &first.task_id,
            expected_revision: 3,
            result: research(),
        },
    )
    .unwrap();
    validate_submission(&db, &lead).unwrap();
    submitted(&db, &lead, "proposal").unwrap();
    assert!(validate_submission(&db, &lead).is_err());
    resolved(&db, &lead, "proposal", "reject").unwrap();
    validate_submission(&db, &lead).unwrap();
    submitted(&db, &lead, "revised").unwrap();
    resolved(&db, &lead, "revised", "approve").unwrap();
    assert_eq!(get(&db, &lead).unwrap().unwrap().phase, "closed");
    for tool in ["Write", "Bash", "Skill", "BrowserPreview", "plugin_write"] {
        assert!(validate_tool(&db, &members[0].member_session_id, tool).is_err());
    }
    validate_tool(&db, &members[0].member_session_id, "Read").unwrap();
    // A future, explicitly confirmed Agent review grants execution purpose.
    db.conn()
        .execute("UPDATE sessions SET mode='agent' WHERE id=?1", [&lead])
        .unwrap();
    start(
        &db,
        &lead,
        "delegate",
        Some("execution-review"),
        vec![members[0].member_session_id.clone()],
    )
    .unwrap();
    validate_tool(&db, &members[0].member_session_id, "Write").unwrap();
    assert_eq!(
        sessions::session_mode(&db, &members[0].member_session_id)
            .unwrap()
            .as_deref(),
        Some("agent")
    );
}
#[test]
fn result_rejects_wrong_owner_old_round_cas_deleted_or_oversized_payload() {
    let (db, lead, members) = setup();
    let owned = task(&db, &lead, &members[0]);
    let state = get(&db, &lead).unwrap().unwrap();
    let attempt = |caller: &str, round: &str, revision: i64, result| {
        submit(
            &db,
            SubmitResearch {
                team: &lead,
                caller,
                planning_id: &state.planning_id,
                round_id: round,
                task_id: &owned.task_id,
                expected_revision: revision,
                result,
            },
        )
    };
    assert!(attempt(
        &members[1].member_session_id,
        &state.round_id,
        1,
        research()
    )
    .unwrap_err()
    .to_string()
    .contains("UNAUTHORIZED"));
    assert!(
        attempt(&members[0].member_session_id, "old-round", 1, research())
            .unwrap_err()
            .to_string()
            .contains("STALE")
    );
    assert!(attempt(
        &members[0].member_session_id,
        &state.round_id,
        99,
        research()
    )
    .unwrap_err()
    .to_string()
    .contains("REVISION_CONFLICT"));
    let mut large = research();
    large.summary = "x".repeat(4001);
    assert!(attempt(&members[0].member_session_id, &state.round_id, 1, large).is_err());
    db.conn()
        .execute(
            "UPDATE team_tasks SET deleted=1 WHERE task_id=?1",
            [&owned.task_id],
        )
        .unwrap();
    assert!(attempt(
        &members[0].member_session_id,
        &state.round_id,
        1,
        research()
    )
    .is_err());
    assert!(get(&db, &lead).unwrap().unwrap().results.is_empty());
}
#[test]
fn ordinary_completion_cannot_bypass_research_and_questions_recover_after_stop() {
    let (db, lead, members) = setup();
    let owned = task(&db, &lead, &members[0]);
    let err = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead,
            caller_session_id: &members[0].member_session_id,
            task_id: &owned.task_id,
            expected_revision: 1,
            subject: None,
            description: None,
            status: Some("completed"),
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("submit_research_result"));
    assert_eq!(
        get_team_task(&db, &lead, &owned.task_id)
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
    let state = get(&db, &lead).unwrap().unwrap();
    question(&db, &lead, &lead, &state.round_id, "pending", true).unwrap();
    recover(&db).unwrap();
    assert!(get(&db, &lead).unwrap().unwrap().open_questions.is_empty());
    assert!(validate_submission(&db, &lead).is_err());
}
#[test]
fn forced_team_rejects_solo_but_standard_contracts_remain_unchanged() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    start_test_turn(&db, &lead, "solo");
    assert!(declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "solo",
            strategy: "lead_only",
            reason: "Indivisible",
            members: None,
        }
    )
    .is_err());
    assert!(get(&db, &lead).unwrap().is_none());
    assert!(validate_submission(&db, &lead).is_err());
    db.conn()
        .execute(
            "UPDATE sessions SET execution_profile='standard' WHERE id=?1",
            [&lead],
        )
        .unwrap();
    validate_submission(&db, &lead).unwrap();
}

#[test]
fn dissolving_planning_team_detaches_researchers_as_plan_and_removes_private_metadata() {
    let (db, lead, members) = setup();
    let owned = task(&db, &lead, &members[0]);
    let state = get(&db, &lead).unwrap().unwrap();
    submit(
        &db,
        SubmitResearch {
            team: &lead,
            caller: &members[0].member_session_id,
            planning_id: &state.planning_id,
            round_id: &state.round_id,
            task_id: &owned.task_id,
            expected_revision: 1,
            result: research(),
        },
    )
    .unwrap();
    sessions::delete_session_with_team_cleanup(&db, &lead).unwrap();
    assert!(get(&db, &lead).unwrap().is_none());
    for member in members {
        assert!(purpose(&db, &member.member_session_id).unwrap().is_none());
        assert_eq!(
            sessions::session_mode(&db, &member.member_session_id)
                .unwrap()
                .as_deref(),
            Some("plan")
        );
        assert_eq!(
            sessions::session_execution_profile(&db, &member.member_session_id)
                .unwrap()
                .as_deref(),
            Some("standard")
        );
        sessions::delete_session(&db, &member.member_session_id).unwrap();
        assert!(purpose(&db, &member.member_session_id).unwrap().is_none());
    }
}
#[test]
fn restarting_pending_proposal_recovers_aggregation_without_research_replay() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let db = crate::db::Database::open_in_dir(data.path()).unwrap();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    start_test_turn(&db, &lead, "initial");
    let (_, review) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "initial",
            strategy: "delegate",
            reason: "Single task",
            members: Some(vec![expert_proposal("expert")]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    assert_eq!(review.launch_policy.as_deref(), Some("automatic_plan"));
    let member = list_team_members(&db, &lead).unwrap().remove(0);
    complete_approved_expert_turn(&db, &lead, &member.member_session_id);
    let owned = task(&db, &lead, &member);
    let state = get(&db, &lead).unwrap().unwrap();
    submit(
        &db,
        SubmitResearch {
            team: &lead,
            caller: &member.member_session_id,
            planning_id: &state.planning_id,
            round_id: &state.round_id,
            task_id: &owned.task_id,
            expected_revision: 1,
            result: research(),
        },
    )
    .unwrap();

    crate::plans::PlanManager
        .submit(
            &db,
            crate::plans::PlanSubmitParams {
                workspace_root: workspace.path(),
                session_id: &lead,
                turn_id: "initial",
                tool_call_id: "plan",
                kind: "plan",
                title: "Plan",
                markdown: "# Immutable plan",
                question: "Approve?",
                artifact_workspace_kind: "project",
            },
        )
        .unwrap();
    assert_eq!(get(&db, &lead).unwrap().unwrap().phase, "submitted");
    drop(db);
    let restarted = crate::state::AppState::open(data.path()).unwrap();
    assert_eq!(
        get(&restarted.db, &lead).unwrap().unwrap().phase,
        "aggregating"
    );
    assert!(validate_submission(&restarted.db, &lead)
        .unwrap_err()
        .to_string()
        .contains("TEAM_APPROVAL_REQUIRED"));
    assert_eq!(
        sessions::session_mode(&restarted.db, &lead)
            .unwrap()
            .as_deref(),
        Some("plan")
    );
}

#[test]
fn automatic_planning_launch_is_idempotent_and_never_execution_consent() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let declare = || {
        declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: &turn,
                strategy: "delegate",
                reason: "Research automatically",
                members: Some(vec![expert_proposal("expert")]),
            },
        )
    };
    let (decision, review) = declare().unwrap();
    let review = review.unwrap();
    assert_eq!(review.status, "confirmed");
    assert_eq!(review.launch_policy.as_deref(), Some("automatic_plan"));
    assert_eq!(decision.member_session_ids.len(), 1);
    assert!(
        decision.message_ids.is_empty(),
        "automatic launch must not impersonate user confirmation mail"
    );
    assert!(list_pending_team_messages(&db, &lead).unwrap().is_empty());
    let state = get(&db, &lead).unwrap().unwrap();
    let revision = get_team(&db, &lead).unwrap().unwrap().revision;
    let retry = declare().unwrap();
    assert_eq!(retry.0, decision);
    assert_eq!(retry.1.unwrap(), review);
    assert_eq!(get(&db, &lead).unwrap().unwrap().round_id, state.round_id);
    assert_eq!(get_team(&db, &lead).unwrap().unwrap().revision, revision);
    assert!(confirm_launch_review(&db, &lead, &review.review_id, review.revision).is_err());
    assert!(cancel_launch_review(&db, &lead, &review.review_id, review.revision).is_err());
    super::authority::validate_lead_tool(&db, &lead, "task_create").unwrap();
    assert!(super::authority::validate_lead_tool(&db, &lead, "complete").is_err());
    complete_approved_expert_turn(&db, &lead, &decision.member_session_ids[0]);
    super::authority::validate_lead_tool(&db, &lead, "complete").unwrap();
    db.conn()
        .execute("UPDATE sessions SET mode='agent' WHERE id=?1", [&lead])
        .unwrap();
    for tool in ["Write", "complete", "task_create", "send_message"] {
        assert!(
            super::authority::validate_lead_tool(&db, &lead, tool).is_err(),
            "Plan launch must not authorize {tool}"
        );
    }
    assert!(validate_tool(&db, &decision.member_session_ids[0], "Write").is_err());
}

#[test]
fn planning_revision_and_retry_start_new_read_only_rounds_without_approval() {
    let (db, lead, members) = setup();
    let previous = get(&db, &lead).unwrap().unwrap();
    let owned = task(&db, &lead, &members[0]);
    for action in ["changes_requested", "reject"] {
        submitted(&db, &lead, "checkpoint").unwrap();
        resolved(&db, &lead, "checkpoint", action).unwrap();
        // Each real user revision/retry creates a distinct strategy scope.
        let active = db
            .conn()
            .query_row(
                "SELECT id FROM turns WHERE session_id=?1 AND status='running'",
                [&lead],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        sessions::end_turn(&db, &active, "completed", None, None, false).unwrap();
        let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
        let (decision, review) = declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: &turn,
                strategy: "delegate",
                reason: "Revise research",
                members: Some(vec![expert_proposal("backend")]),
            },
        )
        .unwrap();
        assert_eq!(
            review.unwrap().launch_policy.as_deref(),
            Some("automatic_plan")
        );
        assert_eq!(
            decision.member_session_ids,
            vec![members[0].member_session_id.clone()]
        );
        let round = get(&db, &lead).unwrap().unwrap();
        assert_ne!(round.round_id, previous.round_id);
        assert!(round.results.is_empty());
        assert!(round.expected_task_ids.is_empty());
        assert!(submit(
            &db,
            SubmitResearch {
                team: &lead,
                caller: &members[0].member_session_id,
                planning_id: &previous.planning_id,
                round_id: &previous.round_id,
                task_id: &owned.task_id,
                expected_revision: 1,
                result: research()
            }
        )
        .is_err());
        assert!(validate_tool(&db, &members[0].member_session_id, "Bash").is_err());
        assert!(validate_submission(&db, &lead).is_err());
    }
}

#[test]
fn legacy_pending_planning_retry_auto_launches_and_stale_reviews_do_not_deadlock() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let params = || DeclareStrategyParams {
        team_session_id: &lead,
        caller_session_id: &lead,
        lead_turn_id: &turn,
        strategy: "delegate",
        reason: "Existing pending research",
        members: Some(vec![expert_proposal("expert")]),
    };
    let (_, review) = declare_team_strategy(&db, params()).unwrap();
    let mut legacy = review.unwrap();
    legacy.launch_policy = None;
    let value = serde_json::to_value(&legacy).unwrap();
    for key in [
        legacy.review_id.clone(),
        format!("{lead}:{}", legacy.review_id),
    ] {
        db.kv_set(TEAM_LAUNCH_REVIEW_NS, &key, &value).unwrap();
    }
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    assert!(confirm_launch_review(&db, &lead, &legacy.review_id, legacy.revision).is_err());
    let (decision, review) = declare_team_strategy(&db, params()).unwrap();
    assert_eq!(
        review.unwrap().launch_policy.as_deref(),
        Some("automatic_plan")
    );
    assert_eq!(decision.member_session_ids.len(), 1);
    assert!(decision.message_ids.is_empty());
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    db.conn()
        .execute("UPDATE sessions SET mode='agent' WHERE id=?1", [&lead])
        .unwrap();
    let stale_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let (_, stale) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &stale_turn,
            strategy: "delegate",
            reason: "Abandoned execution proposal",
            members: Some(vec![expert_proposal("expert")]),
        },
    )
    .unwrap();
    let stale = stale.unwrap();
    sessions::end_turn(&db, &stale_turn, "completed", None, None, false).unwrap();
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let current = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let (_, latest) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &current,
            strategy: "delegate",
            reason: "New research",
            members: Some(vec![expert_proposal("expert")]),
        },
    )
    .unwrap();
    assert_eq!(latest.unwrap().status, "confirmed");
    assert_eq!(
        get_launch_review(&db, &lead, Some(&stale.review_id))
            .unwrap()
            .unwrap()
            .status,
        "interrupted"
    );
    assert!(confirm_launch_review(&db, &lead, &stale.review_id, stale.revision).is_err());
}

#[test]
fn automatic_planning_preserves_pause_and_rolls_back_failed_launch() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let (decision, _) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Paused research",
            members: Some(vec![expert_proposal("expert")]),
        },
    )
    .unwrap();
    pause_team(&db, &lead).unwrap();
    let message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Inspect",
            idempotency_key: Some("paused-research"),
        },
    )
    .unwrap();
    super::authority::record_dispatch(&db, &lead, &message, false).unwrap();
    assert!(list_pending_team_messages(&db, &lead).unwrap().is_empty());
    assert!(super::authority::validate_lead_tool(&db, &lead, "complete").is_err());
    resume_team(&db, &lead).unwrap();
    assert_eq!(list_pending_team_messages(&db, &lead).unwrap().len(), 1);
    let actual = crate::session_collaboration::begin_turn(
        &db,
        &decision.member_session_ids[0],
        &message.id,
        None,
        None,
    )
    .unwrap();
    sessions::end_turn(&db, &actual, "aborted", None, None, false).unwrap();
    crate::session_collaboration::settle_turn(&db, &actual).unwrap();
    assert!(super::authority::validate_lead_tool(&db, &lead, "complete").is_err());
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let new_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    start_test_turn(&db, &decision.member_session_ids[0], "busy-expert");
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &new_turn,
            strategy: "delegate",
            reason: "Atomic launch",
            members: Some(vec![
                expert_proposal("new-expert"),
                expert_proposal("expert"),
            ]),
        },
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));
    assert!(get_team_member_by_name(&db, &lead, "new-expert")
        .unwrap()
        .is_none());
    assert!(get_execution_decision(&db, &lead, &new_turn)
        .unwrap()
        .is_none());
    assert_eq!(
        get_launch_review(&db, &lead, None)
            .unwrap()
            .unwrap()
            .lead_turn_id,
        turn
    );
}

#[test]
fn failed_automatic_materialization_rolls_back_the_declaration_and_partial_roster() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    db.conn().execute_batch("CREATE TRIGGER reject_automatic_launch BEFORE UPDATE ON kv WHEN NEW.ns='team-launch-review-v1' BEGIN SELECT RAISE(ABORT,'injected automatic launch failure'); END;").unwrap();
    let declare = || {
        declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: &turn,
                strategy: "delegate",
                reason: "Atomic automatic launch",
                members: Some(vec![expert_proposal("first"), expert_proposal("second")]),
            },
        )
    };
    assert!(declare()
        .unwrap_err()
        .to_string()
        .contains("injected automatic launch failure"));
    assert!(list_team_members(&db, &lead).unwrap().is_empty());
    assert!(get(&db, &lead).unwrap().is_none());
    assert!(get_execution_decision(&db, &lead, &turn).unwrap().is_none());
    assert!(get_launch_review(&db, &lead, None).unwrap().is_none());
    assert!(list_pending_team_messages(&db, &lead).unwrap().is_empty());
    let sessions: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(sessions, 1);
    db.conn()
        .execute_batch("DROP TRIGGER reject_automatic_launch;")
        .unwrap();
    let (decision, review) = declare().unwrap();
    assert_eq!(decision.member_session_ids.len(), 2);
    assert_eq!(review.unwrap().status, "confirmed");
}

fn planning_message(id: &str, role: &str, text: &str) -> sessions::UiMessage {
    serde_json::from_value(
        serde_json::json!({"id":id,"role":role,"content":text,"createdAt":"2026-10-07T00:00:00Z"}),
    )
    .unwrap()
}

#[test]
fn automatic_plan_fork_copies_the_current_prompt_and_settled_history_only() {
    for with_history in [false, true] {
        let db = test_db();
        let lead = create_test_lead(&db);
        db.conn()
            .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
            .unwrap();
        if with_history {
            let prior = sessions::begin_turn(&db, &lead, None, None).unwrap();
            sessions::append_message(
                &db,
                &lead,
                &planning_message("prior-user", "user", "PRIOR_REQUIREMENT"),
                Some(&prior),
            )
            .unwrap();
            sessions::append_message(
                &db,
                &lead,
                &planning_message("prior-reply", "assistant", "SETTLED_REPLY"),
                Some(&prior),
            )
            .unwrap();
            sessions::end_turn(&db, &prior, "completed", None, None, false).unwrap();
        }
        let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
        sessions::append_message(
            &db,
            &lead,
            &planning_message("current-user", "user", "CURRENT_REQUIREMENT"),
            Some(&turn),
        )
        .unwrap();
        sessions::append_message(
            &db,
            &lead,
            &planning_message("live-assistant", "assistant", "LIVE_ASSISTANT"),
            Some(&turn),
        )
        .unwrap();
        let mut live = planning_message("live-tool", "tool", "LIVE_TOOL");
        live.status = Some("streaming".into());
        live.tool_call_id = Some("INFLIGHT_CALL".into());
        live.tool_name = Some("declare_team_strategy".into());
        sessions::append_message(&db, &lead, &live, Some(&turn)).unwrap();
        let source = sessions::get_session(&db, &lead).unwrap().unwrap();
        let source_text = serde_json::to_string(&source.messages).unwrap();
        assert!(source_text.contains("INFLIGHT_CALL"));
        assert!(source_text.contains("LIVE_ASSISTANT"));
        assert!(matches!(
            sessions::fork_session_through(&db, &lead, None, None).unwrap(),
            sessions::ForkSessionResult::Busy
        ));
        assert!(matches!(
            sessions::fork_session_through(&db, &lead, None, Some("current-user")).unwrap(),
            sessions::ForkSessionResult::Busy
        ));
        let mut member = expert_proposal("forked-researcher");
        member.context_kind = Some("fork".into());
        let (decision, review) = declare_team_strategy(
            &db,
            DeclareStrategyParams {
                team_session_id: &lead,
                caller_session_id: &lead,
                lead_turn_id: &turn,
                strategy: "delegate",
                reason: "Research with immutable context",
                members: Some(vec![member]),
            },
        )
        .unwrap();
        assert_eq!(
            review.unwrap().launch_policy.as_deref(),
            Some("automatic_plan")
        );
        let child = sessions::get_session(&db, &decision.member_session_ids[0])
            .unwrap()
            .unwrap();
        assert_eq!(child.messages.len(), if with_history { 3 } else { 1 });
        let transcript = serde_json::to_string(&child.messages).unwrap();
        assert!(transcript.contains("CURRENT_REQUIREMENT"));
        assert_eq!(transcript.contains("SETTLED_REPLY"), with_history);
        assert!(!transcript.contains("INFLIGHT_CALL"));
        assert!(!transcript.contains("LIVE_ASSISTANT"));
        assert_eq!(child.summary.mode, "plan");
        assert!(validate_tool(&db, &child.summary.id, "Write").is_err());
        assert!(sessions::session_has_running_turn(&db, &lead).unwrap());
        sessions::append_message(
            &db,
            &lead,
            &planning_message("later-live", "assistant", "LATER_MUTATION"),
            Some(&turn),
        )
        .unwrap();
        let after = sessions::get_session(&db, &child.summary.id)
            .unwrap()
            .unwrap();
        assert_eq!(serde_json::to_string(&after.messages).unwrap(), transcript);
        let path = crate::transcripts::transcript_path(db.data_dir(), &child.summary.id).unwrap();
        assert!(!path.with_extension("team-fork-pending").exists());
        assert!(
            sessions::fork_team_plan_research_session(&db, &lead, None, "foreign-turn").is_err()
        );
        sessions::append_message(
            &db,
            &lead,
            &planning_message("steering-user", "user", "LATER_STEERING"),
            Some(&turn),
        )
        .unwrap();
        assert!(
            matches!(
                sessions::fork_team_plan_research_session(&db, &lead, None, &turn).unwrap(),
                sessions::ForkSessionResult::Busy
            ),
            "live-prefix steering must not enter research snapshots"
        );
        db.conn()
            .execute("UPDATE sessions SET mode='agent' WHERE id=?1", [&lead])
            .unwrap();
        assert!(sessions::fork_team_plan_research_session(&db, &lead, None, &turn).is_err());
    }
}

#[test]
fn automatic_plan_fork_rollback_removes_staged_transcripts_and_preserves_source() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    sessions::append_message(
        &db,
        &lead,
        &planning_message("prompt", "user", "KEEP_SOURCE"),
        Some(&turn),
    )
    .unwrap();
    let source = crate::transcripts::transcript_path(db.data_dir(), &lead).unwrap();
    let original = std::fs::read(&source).unwrap();
    let before = std::fs::read_dir(source.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<std::collections::BTreeSet<_>>();
    db.conn().execute_batch("CREATE TRIGGER reject_auto_fork BEFORE UPDATE ON kv WHEN NEW.ns='team-launch-review-v1' BEGIN SELECT RAISE(ABORT,'injected fork launch failure'); END;").unwrap();
    let mut member = expert_proposal("forked");
    member.context_kind = Some("fork".into());
    let error = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Atomic fork",
            members: Some(vec![member]),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("injected fork launch failure"));
    assert!(list_team_members(&db, &lead).unwrap().is_empty());
    assert!(get_execution_decision(&db, &lead, &turn).unwrap().is_none());
    let after = std::fs::read_dir(source.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(after, before);
    assert_eq!(std::fs::read(source).unwrap(), original);
    assert!(sessions::session_has_running_turn(&db, &lead).unwrap());
}
