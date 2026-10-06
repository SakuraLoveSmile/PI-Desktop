use super::{planning::*, tests::*, *};
use crate::sessions;
fn research() -> StructuredResearchResult {
    StructuredResearchResult {
        summary: "Checked actual sources".into(),
        findings: vec!["Host owns data".into()],
        risks: vec!["Race".into()],
        recommendations: vec!["CAS".into()],
        verified_sources: vec!["src/main.rs".into()],
    }
}
fn setup() -> (crate::db::Database, String, Vec<TeamMember>) {
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
    assert!(get(&db, &lead).unwrap().is_none());
    let review = review.unwrap();
    confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    let members = list_team_members(&db, &lead).unwrap();
    (db, lead, members)
}
fn task(db: &crate::db::Database, lead: &str, member: &TeamMember) -> TeamTask {
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
fn lead_only_has_no_research_and_standard_contracts_remain_unchanged() {
    let db = test_db();
    let lead = create_test_lead(&db);
    db.conn()
        .execute("UPDATE sessions SET mode='plan' WHERE id=?1", [&lead])
        .unwrap();
    start_test_turn(&db, &lead, "solo");
    declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "solo",
            strategy: "lead_only",
            reason: "Indivisible",
            members: None,
        },
    )
    .unwrap();
    validate_submission(&db, &lead).unwrap();
    assert_eq!(get(&db, &lead).unwrap().unwrap().expected_task_ids.len(), 0);
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
    declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: "initial",
            strategy: "lead_only",
            reason: "Single task",
            members: None,
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
    validate_submission(&restarted.db, &lead).unwrap();
    assert_eq!(
        sessions::session_mode(&restarted.db, &lead)
            .unwrap()
            .as_deref(),
        Some("plan")
    );
}
