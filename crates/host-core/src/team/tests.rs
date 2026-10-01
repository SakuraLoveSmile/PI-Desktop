use crate::db::Database;
use crate::session_collaboration;
use crate::sessions::{self, SessionCreateOptions};
use crate::team::board::*;
use crate::team::lifecycle::*;
use crate::team::mailbox::*;
use crate::team::model::*;
use crate::team::review::*;
use crate::team::roster::*;
use serde_json::json;

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
fn fresh_member_uses_the_existing_project_display_name() {
    let db = test_db();
    let project = tempfile::tempdir().unwrap();
    let lead = sessions::create_session_with_options(
        &db,
        SessionCreateOptions {
            title: Some("Named Team Lead".into()),
            mode: Some("agent".into()),
            execution_profile: Some("team".into()),
            project_path: Some(project.path().to_string_lossy().into_owned()),
            project_name: Some("Friendly Workspace".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let member = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead.id,
            caller_session_id: &lead.id,
            name: "researcher",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    let member_session = sessions::get_session(&db, &member.member_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        member_session.summary.project_name.as_deref(),
        Some("Friendly Workspace")
    );
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
    create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "coder",
            description: None,
            context_kind: Some("fresh"),
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();

    // 1. Create task t1
    let t1 = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
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
            caller_session_id: &lead_id,
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
            caller_session_id: &lead_id,
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
            caller_session_id: &lead_id,
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
            caller_session_id: &lead_id,
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
            caller_session_id: &lead_id,
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

    let m3 = create_team_member(
        &db,
        CreateMemberParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            name: "observer",
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

    // Replaying the same Host idempotency tuple returns the durable message.
    let replay = send_team_message(
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
    assert_eq!(replay.id, msg.id);
    let conflict = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &m1.member_session_id,
            target_identifier: "bob",
            content: "Different payload",
            idempotency_key: Some("k1"),
        },
    )
    .unwrap_err();
    assert!(conflict.to_string().contains("IDEMPOTENCY_CONFLICT"));

    // 2. Query messages
    let bob_msgs = list_member_messages(&db, &lead_id, &m2.member_session_id).unwrap();
    assert_eq!(bob_msgs.len(), 1);
    assert_eq!(bob_msgs[0].content, "Hello Bob!");
    assert_eq!(
        get_team_message(&db, &lead_id, &m2.member_session_id, &msg.id)
            .unwrap()
            .unwrap()
            .content,
        "Hello Bob!"
    );
    assert!(get_team_message(&db, &lead_id, &m3.member_session_id, &msg.id).is_err());

    // Only the durable target can acknowledge, and the receipt survives in
    // the collaboration ledger as the source of deliveryStatus.
    let wrong_ack =
        ack_team_message(&db, &lead_id, &m1.member_session_id, &msg.id, None).unwrap_err();
    assert!(wrong_ack.to_string().contains("only the message target"));
    let missing_receipt =
        ack_team_message(&db, &lead_id, &m2.member_session_id, &msg.id, None).unwrap_err();
    assert!(missing_receipt
        .to_string()
        .contains("TEAM_DELIVERY_PENDING"));
    db.conn()
        .execute(
            "INSERT INTO turn_queue
             (id, session_id, principal, idempotency_key, input_hash, content,
              session_message_id, permission_mode, position, created_at)
             VALUES ('team-turn', ?1, 'desktop', ?2, 'hash', ?3, ?4, 'ask', 1, 1)",
            rusqlite::params![
                m2.member_session_id,
                format!("team-message:{}", msg.id),
                msg.content,
                msg.id,
            ],
        )
        .unwrap();
    assert!(ack_team_message(
        &db,
        &lead_id,
        &m2.member_session_id,
        &msg.id,
        Some("received"),
    )
    .unwrap());
    let acknowledged = list_member_messages(&db, &lead_id, &m1.member_session_id).unwrap();
    assert_eq!(acknowledged[0].delivery_status, "acknowledged");
    assert_eq!(
        db.conn()
            .query_row(
                "SELECT COUNT(*) FROM session_collaboration_messages
                 WHERE kind='completion' AND reply_to_message_id=?1",
                [&msg.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1
    );

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

#[test]
fn paused_team_mailbox_message_survives_restart_until_resume() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();
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
    pause_team(&db, &lead_id).unwrap();
    let team_message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: "worker",
            content: "Deliver after resume",
            idempotency_key: Some("paused-restart"),
        },
    )
    .unwrap();

    let ordinary_source = sessions::create_session_with_options(
        &db,
        SessionCreateOptions {
            title: Some("Ordinary source".into()),
            mode: Some("agent".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let ordinary_target = sessions::create_session_with_options(
        &db,
        SessionCreateOptions {
            title: Some("Ordinary target".into()),
            mode: Some("agent".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let ordinary_message = session_collaboration::handle(
        &db,
        "session.collaboration.send",
        &json!({
            "sourceSessionId": ordinary_source.id,
            "pluginId": "pi.session-orchestrator",
            "content": "Do not replay after restart",
            "idempotencyKey": "ordinary-restart",
            "notifyOnCompletion": true,
            "sessionId": ordinary_target.id,
            "kind": "task"
        }),
    )
    .unwrap()["message"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    drop(db);
    let db = Database::open(&path).unwrap();

    let recovered_team_message = get_team_message(&db, &lead_id, &lead_id, &team_message.id)
        .unwrap()
        .unwrap();
    assert_eq!(recovered_team_message.status, "queued");
    assert_eq!(recovered_team_message.delivery_status, "queued");
    assert!(list_pending_team_messages(&db, &lead_id)
        .unwrap()
        .is_empty());
    assert_eq!(
        session_collaboration::get(&db, &ordinary_message)
            .unwrap()
            .unwrap()
            .status,
        "interrupted"
    );

    resume_team(&db, &lead_id).unwrap();
    let pending = list_pending_team_messages(&db, &lead_id).unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, team_message.id);
    assert_eq!(pending[0].target_session_id, member.member_session_id);
}

#[test]
fn team_message_persists_effective_permission_ceiling_and_rechecks_admission() {
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

    db.set_setting("app", &json!({"defaultPermissionMode": "auto"}))
        .unwrap();
    let inherited = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: "worker",
            content: "Inherited ceiling",
            idempotency_key: Some("inherit-auto"),
        },
    )
    .unwrap();
    let ceiling: String = db
        .conn()
        .query_row(
            "SELECT permission_ceiling FROM session_collaboration_messages WHERE id=?1",
            [&inherited.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ceiling, "auto");

    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='ask' WHERE id IN (?1, ?2)",
            [&lead_id, &member.member_session_id],
        )
        .unwrap();
    let ask_message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            target_identifier: "worker",
            content: "Ask ceiling",
            idempotency_key: Some("ask-ceiling"),
        },
    )
    .unwrap();
    let ask_ceiling: String = db
        .conn()
        .query_row(
            "SELECT permission_ceiling FROM session_collaboration_messages WHERE id=?1",
            [&ask_message.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ask_ceiling, "ask");

    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
            [&member.member_session_id],
        )
        .unwrap();
    let denied = session_collaboration::begin_turn(
        &db,
        &member.member_session_id,
        &ask_message.id,
        None,
        None,
    )
    .unwrap_err();
    assert!(denied.to_string().contains("PERMISSION_DENIED"));

    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='ask' WHERE id=?1",
            [&member.member_session_id],
        )
        .unwrap();
    assert!(session_collaboration::begin_turn(
        &db,
        &member.member_session_id,
        &ask_message.id,
        None,
        None,
    )
    .is_ok());
}

#[test]
fn team_lead_can_reassign_owner_name_only_and_members_cannot_transfer_tasks() {
    let db = test_db();
    let lead_id = create_test_lead(&db);
    let a = create_team_member(
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
    let b = create_team_member(
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

    let task = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: Some("handoff"),
            subject: "Handoff",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(&a.member_session_id),
            owner_member_name: Some("alice"),
        },
    )
    .unwrap();
    let moved = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: "handoff",
            expected_revision: task.revision,
            subject: None,
            description: None,
            status: None,
            owner_session_id: None,
            owner_member_name: Some(Some("bob")),
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
    assert_eq!(
        moved.owner_session_id.as_deref(),
        Some(b.member_session_id.as_str())
    );
    assert_eq!(moved.owner_member_name.as_deref(), Some("bob"));
    let mismatch = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: "handoff",
            expected_revision: moved.revision,
            subject: None,
            description: None,
            status: None,
            owner_session_id: Some(Some(&a.member_session_id)),
            owner_member_name: Some(Some("bob")),
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap_err();
    assert!(mismatch.to_string().contains("TEAM_TASK_OWNER_MISMATCH"));
    let unassigned = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: "handoff",
            expected_revision: moved.revision,
            subject: None,
            description: None,
            status: None,
            owner_session_id: None,
            owner_member_name: Some(None),
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
    assert!(unassigned.owner_session_id.is_none());
    assert!(unassigned.owner_member_name.is_none());

    let member_task = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            task_id: Some("member-task"),
            subject: "Member task",
            description: None,
            blocked_by: None,
            write_scopes: None,
            owner_session_id: Some(&a.member_session_id),
            owner_member_name: Some("alice"),
        },
    )
    .unwrap();
    let denied = update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead_id,
            caller_session_id: &a.member_session_id,
            task_id: "member-task",
            expected_revision: member_task.revision,
            subject: None,
            description: None,
            status: None,
            owner_session_id: Some(Some(&b.member_session_id)),
            owner_member_name: Some(Some("bob")),
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap_err();
    assert!(denied.to_string().contains("TEAM_UNAUTHORIZED"));
}

#[test]
fn test_team_strategy_declaration_and_launch_review_lifecycle() {
    let db = test_db();
    let lead_id = create_test_lead(&db);

    // 1. Lead declares lead_only
    let (dec1, rev1) = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead_id,
            caller_session_id: &lead_id,
            lead_turn_id: "turn-1",
            strategy: "lead_only",
            reason: "Indivisible task",
            members: None,
        },
    )
    .unwrap();
    assert_eq!(dec1.strategy.as_deref(), Some("lead_only"));
    assert!(rev1.is_none());

    // 2. Query execution decision
    let dec_read = get_execution_decision(&db, &lead_id, "turn-1")
        .unwrap()
        .unwrap();
    assert_eq!(dec_read.strategy.as_deref(), Some("lead_only"));
    assert_eq!(dec_read.reason.as_deref(), Some("Indivisible task"));

    // 3. Lead declares delegate with proposed members on turn-2
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
                    selection: None,
                },
            ]),
        },
    )
    .unwrap();
    assert_eq!(dec2.strategy.as_deref(), Some("delegate"));
    let rev = rev2.unwrap();
    assert_eq!(rev.status, "pending");
    assert_eq!(rev.revision, 1);
    assert_eq!(rev.members.len(), 2);
    assert_eq!(rev.members[0].name, "architect");
    assert_eq!(rev.members[0].selection.model_id, "model-1");

    // 4. Read review
    let read_rev = get_launch_review(&db, &lead_id, Some(&rev.review_id))
        .unwrap()
        .unwrap();
    assert_eq!(read_rev.review_id, rev.review_id);
    assert_eq!(read_rev.members[1].name, "tester");

    // 5. Update review selections with CAS
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

    // CAS mismatch fails
    let stale_err = update_launch_review(&db, &lead_id, &rev.review_id, 1, vec![]).unwrap_err();
    assert!(stale_err
        .to_string()
        .contains("TEAM_REVIEW_REVISION_CONFLICT"));

    // 6. Confirm review
    let (confirmed, confirmed_dec) =
        confirm_launch_review(&db, &lead_id, &rev.review_id, 2).unwrap();
    assert_eq!(confirmed.status, "confirmed");
    assert_eq!(confirmed.revision, 3);
    assert_eq!(confirmed_dec.member_session_ids.len(), 2);
    assert!(!confirmed_dec.message_ids.is_empty());

    // 7. Duplicate confirm is idempotent
    let (dup_confirmed, _) = confirm_launch_review(&db, &lead_id, &rev.review_id, 3).unwrap();
    assert_eq!(dup_confirmed.status, "confirmed");

    // 8. Roster now contains materialized members
    let roster = list_team_members(&db, &lead_id).unwrap();
    assert_eq!(roster.len(), 2);
    assert_eq!(roster[0].name, "architect");
    assert_eq!(roster[1].name, "tester");

    // 9. Session configure gate on active member
    let member_sid = &roster[0].member_session_id;
    // Changing mode away from agent fails
    let mode_err =
        gate_session_configure(&db, member_sid, "chat", None, None, None, None).unwrap_err();
    assert!(mode_err
        .to_string()
        .contains("TEAM_MEMBER_MODEL_CHANGE_BLOCKED"));

    // Valid idle configure succeeds
    assert!(gate_session_configure(
        &db,
        member_sid,
        "agent",
        Some("prov-new"),
        Some("model-new"),
        Some("high"),
        Some("team"),
    )
    .is_ok());

    // 10. Boot interruption on pending reviews
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
                selection: None,
            }]),
        },
    )
    .unwrap();
    let p_id = pending_rev.unwrap().review_id;
    interrupt_pending_reviews_on_boot(&db).unwrap();
    let interrupted_rev = get_launch_review(&db, &lead_id, Some(&p_id))
        .unwrap()
        .unwrap();
    assert_eq!(interrupted_rev.status, "interrupted");
}
