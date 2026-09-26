use crate::db::Database;
use crate::sessions::{self, SessionCreateOptions};
use crate::team::board::*;
use crate::team::lifecycle::*;
use crate::team::mailbox::*;
use crate::team::roster::*;

fn test_db() -> Database {
    let dir = tempfile::tempdir().unwrap();
    Database::open(&dir.path().join("pi.sqlite")).unwrap()
}

fn create_test_lead(db: &Database) -> String {
    sessions::create_session_with_options(
        db,
        SessionCreateOptions {
            title: Some("Team Lead".into()),
            mode: Some("agent".into()),
            execution_profile: Some("team".into()),
            ..Default::default()
        },
    )
    .unwrap()
    .id
}

#[test]
fn test_team_roster_crud_and_limits() {
    let db = test_db();
    let lead_id = create_test_lead(&db);

    // 1. Lead can spawn fresh member
    let m1 = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "researcher",
            description: Some("Finds facts"),
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    assert_eq!(m1.name, "researcher");
    assert_eq!(m1.phase, "idle");

    // 2. Lead can spawn fork member
    let m2 = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "coder",
            description: Some("Writes code"),
            context_kind: Some("fork"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    assert_eq!(m2.name, "coder");

    // 3. Teammate cannot spawn another teammate
    let non_lead_err = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &m1.member_session_id,
            name: "sub_agent",
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap_err();
    assert!(non_lead_err.to_string().contains("TEAM_UNAUTHORIZED"));

    // 4. Duplicate name rejected
    let dup_err = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "researcher",
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap_err();
    assert!(dup_err.to_string().contains("TEAM_MEMBER_NAME_COLLISION"));

    // 5. Query roster
    let members = list_team_members(&db, &lead_id).unwrap();
    assert_eq!(members.len(), 2);

    // 6. Max members limit (8)
    for i in 3..=8 {
        create_team_member(
            &db,
            CreateMemberParams {
                team_session_id: &lead_id,
                caller_session_id: &lead_id,
                name: &format!("agent_{i}"),
                description: None,
                context_kind: None,
                model_id: None,
                provider_id: None,
            },
        )
        .unwrap();
    }
    let overflow_err = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "agent_9",
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap_err();
    assert!(overflow_err
        .to_string()
        .contains("TEAM_MEMBER_LIMIT_EXCEEDED"));
}

#[test]
fn lead_deletion_cleanup_rolls_back_when_member_reset_fails() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "worker",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    db.conn()
        .execute_batch(
            "CREATE TRIGGER reject_team_profile_reset
             BEFORE UPDATE OF execution_profile ON sessions
             WHEN NEW.execution_profile = 'standard'
             BEGIN
               SELECT RAISE(ABORT, 'injected profile reset failure');
             END;",
        )
        .unwrap();

    let error = cleanup_team_on_lead_delete(&db, &lead_id).unwrap_err();
    assert!(error.to_string().contains("injected profile reset failure"));
    assert!(get_team(&db, &lead_id).unwrap().is_some());
    let profile: String = db
        .conn()
        .query_row(
            "SELECT execution_profile FROM sessions WHERE id = ?1",
            [&member.member_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(profile, "team");

    db.conn()
        .execute_batch("DROP TRIGGER reject_team_profile_reset;")
        .unwrap();
    cleanup_team_on_lead_delete(&db, &lead_id).unwrap();
    assert!(get_team(&db, &lead_id).unwrap().is_none());
    let profile: String = db
        .conn()
        .query_row(
            "SELECT execution_profile FROM sessions WHERE id = ?1",
            [&member.member_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(profile, "standard");
}

#[test]
fn test_team_task_board_cas_and_dag() {
    let db = test_db();
    let lead_id = create_test_lead(&db);

    // 1. Create task t1
    let t1 = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            task_id: Some("t1"),
            subject: "Design Architecture",
            description: Some("Initial spec"),
            blocked_by: None,
            write_scopes: Some(vec!["docs/adr".into()]),
            owner_session_id: None,
            owner_member_name: None,
        },
    )
    .unwrap();
    assert_eq!(t1.revision, 1);

    // 2. Create task t2 depending on t1
    let t2 = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            task_id: Some("t2"),
            subject: "Implement Code",
            description: None,
            blocked_by: Some(vec!["t1".into()]),
            write_scopes: Some(vec!["crates/host-core/src/team".into()]),
            owner_session_id: None,
            owner_member_name: None,
        },
    )
    .unwrap();
    assert_eq!(t2.blocked_by, vec!["t1"]);

    // 3. Creating task that introduces cycle fails
    let cycle_err = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            task_id: Some("t3"),
            subject: "Cycle Task",
            description: None,
            blocked_by: Some(vec!["t2".into()]),
            write_scopes: None,
            owner_session_id: None,
            owner_member_name: None,
        },
    );
    assert!(cycle_err.is_ok());

    // Updating t1 to depend on t3 creates cycle (t1 -> t3 -> t2 -> t1)
    let update_cycle_err = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            task_id: "t1",
            expected_revision: 1,
            subject: None,
            description: None,
            status: None,
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: Some(vec!["t3".into()]),
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap_err();
    assert!(update_cycle_err
        .to_string()
        .contains("TEAM_TASK_DEPENDENCY_CYCLE"));

    // 4. Stale CAS revision is rejected
    let stale_cas_err = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            task_id: "t2",
            expected_revision: 99,
            subject: Some("New Subject"),
            description: None,
            status: None,
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap_err();
    assert!(stale_cas_err
        .to_string()
        .contains("TEAM_TASK_REVISION_CONFLICT"));

    // 5. Valid CAS update
    let updated_t2 = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            task_id: "t2",
            expected_revision: 1,
            subject: Some("Implement Code v2"),
            description: None,
            status: Some("in_progress"),
            owner_session_id: None,
            owner_member_name: Some(Some("coder")),
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
    assert_eq!(updated_t2.revision, 2);
    assert_eq!(updated_t2.subject, "Implement Code v2");
    assert_eq!(updated_t2.status, "in_progress");

    // 6. Board projection readiness
    let board = get_team_board_projection(&db, &lead_id).unwrap();
    assert_eq!(board.tasks.len(), 3);
    let t1_readiness = board.readiness.iter().find(|r| r.task_id == "t1").unwrap();
    assert!(t1_readiness.is_ready);
    let t2_readiness = board.readiness.iter().find(|r| r.task_id == "t2").unwrap();
    assert!(!t2_readiness.is_ready); // status is in_progress, not pending
}

#[test]
fn test_team_mailbox_and_pause() {
    let db = test_db();
    let lead_id = create_test_lead(&db);

    let m1 = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "alice",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    let m2 = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "bob",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    // 1. Alice can send Bob a message
    let msg = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &m1.member_session_id,
            target_identifier: "bob",
            content: "Hello Bob!",
            idempotency_key: Some("k1"),
        },
    )
    .unwrap();
    assert_eq!(msg.status, "queued");
    assert_eq!(msg.source_member_name, "alice");
    assert_eq!(msg.target_member_name, "bob");

    // 2. Query messages
    let bob_msgs = list_member_messages(&db, &lead_id, &m2.member_session_id).unwrap();
    assert_eq!(bob_msgs.len(), 1);
    assert_eq!(bob_msgs[0].content, "Hello Bob!");

    // 3. Pause & Resume team
    let paused = pause_team(&db, &lead_id).unwrap();
    assert!(paused.paused);

    let resumed = resume_team(&db, &lead_id).unwrap();
    assert!(!resumed.paused);

    // 4. Session deletion guards
    let del_err = can_delete_session(&db, &m1.member_session_id).unwrap_err();
    assert!(del_err.to_string().contains("TEAM_MEMBER_DELETION_BLOCKED"));

    // Clean up on lead delete resets member to standard
    cleanup_team_on_lead_delete(&db, &lead_id).unwrap();
    let m1_session = sessions::get_session(&db, &m1.member_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(m1_session.summary.execution_profile, "standard");
}
