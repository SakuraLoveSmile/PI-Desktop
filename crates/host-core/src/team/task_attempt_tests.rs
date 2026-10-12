use super::board::{
    create_team_task, get_team_task, update_team_task, CreateTaskParams, UpdateTaskParams,
};
use super::tests::{create_test_lead, test_db};
use crate::{db::Database, sessions};

fn task(db: &Database, lead: &str, id: &str) -> super::TeamTask {
    super::ensure_team(db, lead).unwrap();
    create_team_task(
        db,
        CreateTaskParams {
            team_session_id: lead,
            caller_session_id: lead,
            task_id: Some(id),
            subject: "Rewrite the protocol",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(lead),
            owner_member_name: None,
        },
    )
    .unwrap()
}

fn update(db: &Database, lead: &str, current: &super::TeamTask, status: &str) -> super::TeamTask {
    update_team_task(db, update_params(lead, current, Some(status))).unwrap()
}

fn update_params<'a>(
    lead: &'a str,
    current: &'a super::TeamTask,
    status: Option<&'a str>,
) -> UpdateTaskParams<'a> {
    UpdateTaskParams {
        team_session_id: lead,
        caller_session_id: lead,
        task_id: &current.task_id,
        expected_revision: current.revision,
        subject: None,
        description: None,
        status,
        owner_session_id: None,
        owner_member_name: None,
        blocked_by: None,
        write_scopes: None,
        deleted: None,
    }
}

fn latest(db: &Database, lead: &str, id: &str) -> super::TeamTask {
    get_team_task(db, lead, id).unwrap().unwrap()
}

fn attempts(db: &Database) -> i64 {
    db.conn()
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE ns='team-task-attempt-v1'",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn completion_claim_followed_by_mutation_failure_is_failed_and_agent_end_cannot_complete_it() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "rewrite");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let claimed = update(&db, &lead, &original, "completed");
    assert_eq!(claimed.status, "in_progress");
    assert_eq!(
        get_team_task(&db, &lead, "rewrite")
            .unwrap()
            .unwrap()
            .status,
        "in_progress"
    );
    sessions::end_turn(
        &db,
        &turn,
        "error",
        Some("MUTATION_RETRY_BUDGET_EXHAUSTED"),
        None,
        false,
    )
    .unwrap();
    assert_eq!(
        get_team_task(&db, &lead, "rewrite")
            .unwrap()
            .unwrap()
            .status,
        "failed"
    );
    assert!(
        !sessions::end_turn(&db, &turn, "completed", None, None, false)
            .unwrap()
            .updated
    );
    assert_eq!(
        get_team_task(&db, &lead, "rewrite")
            .unwrap()
            .unwrap()
            .status,
        "failed"
    );
}

#[test]
fn successful_turn_promotes_only_explicit_completion_claims() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let claimed = task(&db, &lead, "claimed");
    let active = task(&db, &lead, "active");
    let untouched = task(&db, &lead, "untouched");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &claimed, "completed");
    update(&db, &lead, &active, "in_progress");
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert_eq!(
        get_team_task(&db, &lead, &claimed.task_id)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
    assert_eq!(
        get_team_task(&db, &lead, &active.task_id)
            .unwrap()
            .unwrap()
            .status,
        "in_progress"
    );
    assert_eq!(
        get_team_task(&db, &lead, &untouched.task_id)
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
}

#[test]
fn retry_ignores_old_terminal_events_and_rejects_post_failure_completion_without_retry() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "retry");
    let first = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &original, "completed");
    sessions::end_turn(&db, &first, "error", Some("EDIT_PARSE_FAILED"), None, false).unwrap();
    let failed = latest(&db, &lead, "retry");
    let error =
        update_team_task(&db, update_params(&lead, &failed, Some("completed"))).unwrap_err();
    assert!(error.to_string().contains("TEAM_TASK_REVISION_CONFLICT"));
    let second = sessions::begin_turn(&db, &lead, None, None).unwrap();
    assert!(super::task_attempts::validate_caller_turn(db.conn(), &lead, &first).is_err());
    super::task_attempts::validate_caller_turn(db.conn(), &lead, &second).unwrap();
    let retry = update(&db, &lead, &failed, "in_progress");
    let claimed = update(&db, &lead, &retry, "completed");
    assert!(
        !sessions::end_turn(&db, &first, "completed", None, None, false)
            .unwrap()
            .updated
    );
    assert_eq!(latest(&db, &lead, "retry").revision, claimed.revision);
    sessions::end_turn(&db, &second, "completed", None, None, false).unwrap();
    assert_eq!(latest(&db, &lead, "retry").status, "completed");
    assert_eq!(attempts(&db), 0);
}

#[test]
fn metadata_update_keeps_completion_claim_and_latest_revision() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "metadata");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let claim = update(&db, &lead, &original, "completed");
    let mut params = update_params(&lead, &claim, None);
    params.description = Some("Verified change details");
    let described = update_team_task(&db, params).unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let completed = latest(&db, &lead, "metadata");
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.revision, described.revision + 1);
    assert_eq!(
        completed.description.as_deref(),
        Some("Verified change details")
    );
}

#[test]
fn explicit_resets_deletion_and_reassignment_are_preserved_on_turn_failure() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let originals: Vec<_> = ["pending", "failed", "cancelled", "deleted", "unassigned"]
        .iter()
        .map(|id| task(&db, &lead, id))
        .collect();
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    for original in originals {
        let claim = update(&db, &lead, &original, "completed");
        let mut params = update_params(&lead, &claim, None);
        match original.task_id.as_str() {
            "deleted" => params.deleted = Some(true),
            "unassigned" => params.owner_session_id = Some(None),
            status => params.status = Some(status),
        }
        update_team_task(&db, params).unwrap();
    }
    assert_eq!(attempts(&db), 0);
    sessions::end_turn(&db, &turn, "error", Some("EDIT_PARSE_FAILED"), None, false).unwrap();
    for status in ["pending", "failed", "cancelled"] {
        assert_eq!(latest(&db, &lead, status).status, status);
    }
    assert!(latest(&db, &lead, "deleted").deleted);
    assert_eq!(latest(&db, &lead, "unassigned").status, "in_progress");
    assert!(latest(&db, &lead, "unassigned").owner_session_id.is_none());
}

#[test]
fn explicit_in_progress_binds_failure_but_unclaimed_historical_tasks_are_untouched() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "active");
    let historical = task(&db, &lead, "historical");
    update(&db, &lead, &historical, "completed");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &original, "in_progress");
    sessions::end_turn(&db, &turn, "error", Some("EDIT_PARSE_FAILED"), None, false).unwrap();
    assert_eq!(latest(&db, &lead, "active").status, "failed");
    assert_eq!(latest(&db, &lead, "historical").status, "completed");
}

#[test]
fn stop_and_startup_cancel_pending_claims_without_publishing_completion() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "stop");
    let interrupted = task(&db, &lead, "startup");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &original, "completed");
    sessions::end_turn(&db, &turn, "aborted", None, None, false).unwrap();
    assert_eq!(latest(&db, &lead, "stop").status, "cancelled");
    let restarted = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &interrupted, "completed");
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(latest(&db, &lead, "startup").status, "cancelled");
    assert!(
        !sessions::end_turn(&db, &restarted, "completed", None, None, false)
            .unwrap()
            .updated
    );
    assert_eq!(latest(&db, &lead, "startup").status, "cancelled");
}

#[test]
fn settlement_and_claim_update_roll_back_with_their_owning_transaction() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let original = task(&db, &lead, "atomic");
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    db.conn().execute_batch("CREATE TRIGGER reject_claim BEFORE UPDATE ON team_tasks BEGIN SELECT RAISE(ABORT,'fixture rejects claim'); END;").unwrap();
    assert!(update_team_task(&db, update_params(&lead, &original, Some("completed"))).is_err());
    assert_eq!(attempts(&db), 0);
    assert_eq!(latest(&db, &lead, "atomic").status, "pending");
    db.conn()
        .execute_batch("DROP TRIGGER reject_claim;")
        .unwrap();
    let claim = update(&db, &lead, &original, "completed");
    let revision = super::get_team(&db, &lead).unwrap().unwrap().revision;
    db.conn().execute_batch("CREATE TRIGGER reject_settlement BEFORE UPDATE ON team_tasks WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'fixture rejects settlement'); END;").unwrap();
    assert!(
        sessions::end_turn(&db, &turn, "error", Some("EDIT_PARSE_FAILED"), None, true).is_err()
    );
    assert_eq!(latest(&db, &lead, "atomic").revision, claim.revision);
    assert_eq!(
        super::get_team(&db, &lead).unwrap().unwrap().revision,
        revision
    );
    assert_eq!(
        sessions::get_turn_state(&db, &lead, &turn)
            .unwrap()
            .unwrap()
            .status,
        "running"
    );
    db.conn()
        .execute_batch("DROP TRIGGER reject_settlement;")
        .unwrap();
    sessions::end_turn(&db, &turn, "error", Some("EDIT_PARSE_FAILED"), None, true).unwrap();
    assert_eq!(latest(&db, &lead, "atomic").status, "failed");
}

#[test]
fn deleting_team_or_session_cleans_attempt_metadata() {
    for cleanup_team in [false, true] {
        let db = test_db();
        let lead = create_test_lead(&db);
        let original = task(&db, &lead, "cleanup");
        sessions::begin_turn(&db, &lead, None, None).unwrap();
        update(&db, &lead, &original, "completed");
        assert_eq!(attempts(&db), 1);
        if cleanup_team {
            super::lifecycle::cleanup_team_on_lead_delete(&db, &lead).unwrap();
        } else {
            sessions::delete_session_with_team_cleanup(&db, &lead).unwrap();
        }
        assert_eq!(attempts(&db), 0);
    }
}

#[test]
fn running_owner_precedes_lead_verification_and_idle_owner_uses_running_caller() {
    let db = test_db();
    let lead = create_test_lead(&db);
    let member = super::tests::create_team_member(
        &db,
        super::CreateMemberParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            name: "writer",
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let owner = member.member_session_id.as_str();
    let mut tasks = Vec::new();
    for id in ["owner", "verification", "unrelated"] {
        tasks.push(
            create_team_task(
                &db,
                CreateTaskParams {
                    team_session_id: &lead,
                    caller_session_id: &lead,
                    task_id: Some(id),
                    subject: "Expert assignment",
                    description: None,
                    blocked_by: None,
                    write_scopes: None,
                    owner_session_id: Some(owner),
                    owner_member_name: None,
                },
            )
            .unwrap(),
        );
    }
    let lead_turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let member_turn = sessions::begin_turn(&db, owner, None, None).unwrap();
    update(&db, &lead, &tasks[0], "completed");
    sessions::end_turn(&db, &lead_turn, "error", Some("LEAD_FAILED"), None, false).unwrap();
    assert_eq!(latest(&db, &lead, "owner").status, "in_progress");
    sessions::end_turn(&db, &member_turn, "completed", None, None, false).unwrap();
    assert_eq!(latest(&db, &lead, "owner").status, "completed");
    assert_eq!(latest(&db, &lead, "unrelated").status, "pending");

    let verification = sessions::begin_turn(&db, &lead, None, None).unwrap();
    update(&db, &lead, &tasks[1], "completed");
    sessions::end_turn(
        &db,
        &verification,
        "error",
        Some("VERIFY_FAILED"),
        None,
        false,
    )
    .unwrap();
    assert_eq!(latest(&db, &lead, "verification").status, "failed");
    let new_verification = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let failed = latest(&db, &lead, "verification");
    update(&db, &lead, &failed, "completed");
    sessions::end_turn(&db, &new_verification, "completed", None, None, false).unwrap();
    assert_eq!(latest(&db, &lead, "verification").status, "completed");
}

#[test]
fn accepted_structured_research_result_remains_completed_after_research_turn_failure() {
    let (db, lead, members) = super::planning_tests::setup();
    let member = &members[0];
    let original = super::planning_tests::task(&db, &lead, member);
    let turn = sessions::begin_turn(&db, &member.member_session_id, None, None).unwrap();
    let active = update(&db, &lead, &original, "in_progress");
    assert_eq!(attempts(&db), 1);
    // The unchecked board claim must still require the research submission tool,
    // even though ordinary execution claims become provisional.
    let rejected =
        update_team_task(&db, update_params(&lead, &active, Some("completed"))).unwrap_err();
    assert!(rejected.to_string().contains("submit_research_result"));
    let state = super::planning::get(&db, &lead).unwrap().unwrap();
    super::planning::submit(
        &db,
        super::planning::SubmitResearch {
            team: &lead,
            caller: &member.member_session_id,
            planning_id: &state.planning_id,
            round_id: &state.round_id,
            task_id: &active.task_id,
            expected_revision: active.revision,
            result: super::planning_tests::research(),
        },
    )
    .unwrap();
    assert_eq!(attempts(&db), 0);
    assert_eq!(latest(&db, &lead, &active.task_id).status, "completed");
    sessions::end_turn(&db, &turn, "error", Some("PROVIDER_FAILED"), None, false).unwrap();
    assert_eq!(latest(&db, &lead, &active.task_id).status, "completed");
}
