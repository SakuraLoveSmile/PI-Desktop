use super::*;

fn session(db: &Database, title: &str) -> String {
    sessions::create_session_with_options(
        db,
        sessions::SessionCreateOptions {
            title: Some(title.into()),
            mode: Some("agent".into()),
            permission_mode: Some("ask".into()),
            ..Default::default()
        },
    )
    .unwrap()
    .id
}

fn send(db: &Database, source: &str, target: &str, key: &str) -> Message {
    send_record(
        db,
        &json!({"sourceSessionId":source,"pluginId":"pi.session-orchestrator",
        "content":"Review the change","idempotencyKey":key,"notifyOnCompletion":true}),
        target,
        "task",
    )
    .unwrap()
}

fn ui(role: &str, content: &str) -> sessions::UiMessage {
    serde_json::from_value(
        json!({"id":Uuid::new_v4().to_string(),"role":role,"content":content,
        "createdAt":ms_to_ts(now_ms())}),
    )
    .unwrap()
}

#[test]
fn sessions_are_reused_and_send_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let parent = session(&db, "Parent");
    let child = session(&db, "Existing conversation");
    let first = send(&db, &parent, &child, "one");
    assert_eq!(send(&db, &parent, &child, "one").id, first.id);
    assert_eq!(
        send(&db, &child, &parent, "reply").target_session_id,
        parent
    );
    let mismatch = send_record(
        &db,
        &json!({"sourceSessionId":parent,"pluginId":"pi.session-orchestrator",
        "content":"different","idempotencyKey":"one"}),
        &child,
        "task",
    )
    .unwrap_err();
    assert!(mismatch.to_string().starts_with("IDEMPOTENCY_CONFLICT"));
    let count: i64 = db
        .conn()
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn turn_bound_result_and_callback_are_durable_and_exactly_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();
    let parent = session(&db, "Parent");
    let child = session(&db, "Child");
    let message = send(&db, &parent, &child, "one");
    let turn = begin_turn(&db, &child, &message.id, None, None).unwrap();
    assert!(begin_turn(&db, &child, &message.id, None, None).is_err());
    sessions::append_message(&db, &child, &ui("user", &message.content), Some(&turn)).unwrap();
    sessions::append_message(
        &db,
        &child,
        &ui("assistant", "Authoritative final result"),
        Some(&turn),
    )
    .unwrap();
    assert!(settle_turn(&db, &turn).unwrap().is_none());
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let receipt = settle_turn(&db, &turn).unwrap().unwrap();
    assert_eq!(settle_turn(&db, &turn).unwrap().unwrap().id, receipt.id);
    assert_eq!(
        receipt.reply_to_message_id.as_deref(),
        Some(message.id.as_str())
    );
    assert!(!receipt.notify_on_completion);
    let result = handle(
        &db,
        "session.collaboration.result",
        &json!({"sessionId":child,"messageId":message.id}),
    )
    .unwrap();
    assert_eq!(result["ready"], true);
    assert_eq!(result["message"]["result"], "Authoritative final result");
    drop(db);
    let db = Database::open(&path).unwrap();
    let detail = sessions::get_session(&db, &child).unwrap().unwrap();
    assert_eq!(
        detail.messages[0].session_message.as_ref().unwrap()["sourceSessionId"],
        parent
    );
    assert_eq!(get(&db, &message.id).unwrap().unwrap().status, "completed");
    assert_eq!(
        get(&db, &receipt.id).unwrap().unwrap().status,
        "interrupted"
    );
}

#[test]
fn failed_turn_does_not_promote_intermediate_output() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let parent = session(&db, "Parent");
    let child = session(&db, "Child");
    let message = send(&db, &parent, &child, "one");
    let turn = begin_turn(&db, &child, &message.id, None, None).unwrap();
    sessions::append_message(
        &db,
        &child,
        &ui("assistant", "I will investigate"),
        Some(&turn),
    )
    .unwrap();
    sessions::end_turn(&db, &turn, "error", Some("PROVIDER_FAILED"), None, false).unwrap();
    settle_turn(&db, &turn).unwrap();
    let failed = get(&db, &message.id).unwrap().unwrap();
    assert_eq!(failed.status, "failed");
    assert!(failed.result.is_none());
    assert_eq!(failed.error.as_deref(), Some("PROVIDER_FAILED"));
}

#[test]
fn provenance_cannot_be_forged_or_stripped_and_permissions_are_rechecked() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let parent = session(&db, "Parent");
    let child = session(&db, "Child");
    let message = send(&db, &parent, &child, "one");
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
            params![child],
        )
        .unwrap();
    assert!(begin_turn(&db, &child, &message.id, None, None)
        .unwrap_err()
        .to_string()
        .starts_with("PERMISSION_DENIED"));
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='ask' WHERE id=?1",
            params![child],
        )
        .unwrap();
    let turn = begin_turn(&db, &child, &message.id, None, None).unwrap();
    assert!(sessions::append_message(&db, &child, &ui("user", "forged"), Some(&turn)).is_err());
    sessions::append_message(&db, &child, &ui("user", &message.content), Some(&turn)).unwrap();
    let mut detail = sessions::get_session(&db, &child).unwrap().unwrap();
    detail.messages[0].session_message = None;
    assert!(sessions::replace_messages(&db, &child, &detail.messages).is_err());
}

#[test]
fn queued_cancellation_keeps_the_session_and_notifies_once() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let parent = session(&db, "Parent");
    let child = session(&db, "Child");
    let message = send(&db, &parent, &child, "one");
    let input = json!({"sessionId":child,"messageId":message.id,"pluginId":message.plugin_id,"sourceSessionId":parent});
    handle(&db, "session.collaboration.cancel", &input).unwrap();
    handle(&db, "session.collaboration.cancel", &input).unwrap();
    assert_eq!(get(&db, &message.id).unwrap().unwrap().status, "cancelled");
    assert_eq!(
        repository::pending_callbacks(&db, Some(&parent))
            .unwrap()
            .len(),
        1
    );
    assert!(sessions::get_session(&db, &child).unwrap().is_some());
}

#[test]
fn schema_v15_upgrade_preserves_sessions_and_adds_the_ledger() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let id;
    {
        let db = Database::open(&path).unwrap();
        id = session(&db, "Existing user session");
        db.conn()
            .execute_batch(
                "DROP TABLE session_collaboration_messages; DROP TABLE session_collaboration_links;
            ALTER TABLE turn_queue DROP COLUMN session_message_id; PRAGMA user_version=15;",
            )
            .unwrap();
    }
    let db = Database::open(&path).unwrap();
    assert_eq!(
        sessions::get_session(&db, &id)
            .unwrap()
            .unwrap()
            .summary
            .title,
        "Existing user session"
    );
    assert_eq!(
        db.conn()
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        16
    );
    assert!(crate::db::migration_backup_path(&path, 15).exists());
    assert!(repository::pending_callbacks(&db, None).unwrap().is_empty());
}
