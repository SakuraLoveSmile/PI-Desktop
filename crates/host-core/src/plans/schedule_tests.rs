use super::*;

fn approved_schedule(scheduled_for: i64) -> (tempfile::TempDir, Database, PlanProposal) {
    let dir = tempfile::tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let session = sessions::create_session(
        &db,
        Some("Plan".into()),
        Some(KIND_PLAN.into()),
        None,
        None,
        Some(workspace.to_string_lossy().into_owned()),
    )
    .unwrap();
    let turn = sessions::begin_turn(&db, &session.id, None, None).unwrap();
    let proposal = PlanManager
        .submit(
            &db,
            PlanSubmitParams {
                workspace_root: &workspace,
                session_id: &session.id,
                turn_id: &turn,
                tool_call_id: "schedule-test-call",
                kind: KIND_PLAN,
                title: "Scheduled plan",
                markdown: "# Scheduled plan\n- run once",
                question: "Proceed?",
                artifact_workspace_kind: WORKSPACE_KIND_PROJECT,
            },
        )
        .unwrap();
    db.conn()
        .execute(
            "UPDATE plan_approvals
             SET status = 'approved', action = 'approve',
                 target_permission_mode = 'ask', resolved_at = ?1
             WHERE request_id = ?2",
            params![scheduled_for, proposal.id],
        )
        .unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET mode = 'agent' WHERE id = ?1",
            params![session.id],
        )
        .unwrap();
    db.conn()
        .execute(
            "INSERT INTO plan_execution_schedules
             (proposal_id, scheduled_for, timezone, state, updated_at)
             VALUES (?1, ?2, 'UTC', 'scheduled', ?2)",
            params![proposal.id, scheduled_for],
        )
        .unwrap();
    (dir, db, proposal)
}

#[test]
fn due_schedules_are_marked_missed_without_catch_up() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    let manager = PlanManager;

    assert_eq!(
        manager.due_schedules(&db, 999).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        manager.due_schedules(&db, 1_000).unwrap(),
        vec![proposal.id.clone()]
    );
    assert_eq!(
        manager.mark_overdue_schedules_missed(&db, 1_001).unwrap(),
        vec![proposal.id.clone()]
    );
    assert!(manager.due_schedules(&db, 2_000).unwrap().is_empty());
    let state: String = db
        .conn()
        .query_row(
            "SELECT state FROM plan_execution_schedules WHERE proposal_id = ?1",
            params![proposal.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state, MISSED);
}

#[test]
fn claim_schedule_is_atomic_and_only_succeeds_once() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    let manager = PlanManager;
    let execution = manager
        .claim_schedule(&db, &proposal.id, 1_000, false)
        .unwrap();

    assert_eq!(execution.proposal_id, proposal.id);
    assert_eq!(execution.state, EXECUTION_QUEUED);
    assert!(manager
        .claim_schedule(&db, &proposal.id, 1_001, false)
        .is_err());
    let (schedule_state, execution_state): (String, String) = db
        .conn()
        .query_row(
            "SELECT s.state, p.execution_state
             FROM plan_execution_schedules s
             JOIN plan_approvals p ON p.request_id = s.proposal_id
             WHERE s.proposal_id = ?1",
            params![proposal.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(schedule_state, CLAIMED);
    assert_eq!(execution_state, EXECUTION_QUEUED);
}

#[test]
fn missed_schedule_requires_explicit_allowance() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    let manager = PlanManager;
    manager.mark_overdue_schedules_missed(&db, 2_000).unwrap();

    assert!(manager
        .claim_schedule(&db, &proposal.id, 2_000, false)
        .is_err());
    let execution = manager
        .claim_schedule(&db, &proposal.id, 2_000, true)
        .unwrap();
    assert_eq!(execution.state, EXECUTION_QUEUED);
}

#[test]
fn cancelling_schedule_prevents_claim_and_is_idempotent() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    let manager = PlanManager;

    assert!(manager.cancel_schedule(&db, &proposal.id).unwrap());
    assert!(!manager.cancel_schedule(&db, &proposal.id).unwrap());
    assert!(manager
        .claim_schedule(&db, &proposal.id, 1_000, true)
        .is_err());
}

#[test]
fn claim_restores_the_approved_permission_snapshot() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode = 'auto' WHERE id = ?1",
            params![proposal.session_id],
        )
        .unwrap();
    PlanManager
        .claim_schedule(&db, &proposal.id, 1_000, false)
        .unwrap();
    let permission: String = db
        .conn()
        .query_row(
            "SELECT permission_mode FROM sessions WHERE id = ?1",
            params![proposal.session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(permission, "ask");
}

#[test]
fn a_busy_session_cannot_auto_claim_a_due_plan() {
    let (_dir, db, proposal) = approved_schedule(1_000);
    let turn = sessions::begin_turn(&db, &proposal.session_id, None, None).unwrap();
    let error = PlanManager
        .claim_schedule(&db, &proposal.id, 1_000, false)
        .unwrap_err();
    assert_eq!(error.to_string(), "PLAN_SCHEDULE_SESSION_BUSY");
    assert!(PlanManager.miss_schedule(&db, &proposal.id, 1_000).unwrap());
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert_eq!(
        PlanManager
            .claim_schedule(&db, &proposal.id, 1_001, false)
            .unwrap_err()
            .to_string(),
        "PLAN_SCHEDULE_MISSED"
    );
}
