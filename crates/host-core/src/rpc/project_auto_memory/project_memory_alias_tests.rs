use super::*;
fn all_kv(db: &crate::db::Database) -> Vec<(String, String, String, i64)> {
    db.conn
        .prepare("SELECT ns, key, value_json, updated_at FROM kv ORDER BY ns, key")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap()
}

#[tokio::test]
async fn project_memory_alias_retains_instructions_and_uses_shared_opt_in_without_roots() {
    use crate::project_memory_owner::{tests::Fixture, TEST_PROJECTION};
    let f = Fixture::new();
    let owner = f.repository.to_str().unwrap().to_owned();
    let slot = f.slot.to_str().unwrap().to_owned();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(&owner, false).unwrap();
    app.db.ensure_project(&slot, false).unwrap();
    app.db
        .set_project_memory(&slot, "Older worktree finding")
        .unwrap();
    app.db
        .set_project_memory(&owner, "Owner legacy memory")
        .unwrap();
    let group = app
        .db
        .create_project_group("Owner", std::slice::from_ref(&owner))
        .unwrap();
    app.db
        .set_project_group_instructions(&group.id, "Real shared instructions")
        .unwrap();
    app.db.set_auto_memory_enabled(&owner, true).unwrap();
    let session_ids: Vec<_> = ["agent", "plan", "goal"]
        .into_iter()
        .map(|mode| {
            sessions::create_session_with_options(
                &app.db,
                sessions::SessionCreateOptions {
                    project_path: Some(slot.clone()),
                    mode: Some(mode.into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .id
        })
        .collect();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    TEST_PROJECTION.scope(f.projection.clone(), async {
        let context = handle_request(state.clone(), "project.group.context", json!({"path":slot}), tx.clone()).await.unwrap();
        assert!(context["context"].is_null());
        let alias = &context["memoryAlias"];
        assert!(alias["memory"]["content"].as_str().unwrap().contains("Owner legacy memory"));
        assert!(alias["memory"]["content"].as_str().unwrap().contains("Older worktree finding"));
        assert_eq!(alias["instructions"], "Real shared instructions");
        assert!(alias.get("roots").is_none());
        let editor = handle_request(state.clone(), "project.memory.editor.get", json!({"path":slot}), tx.clone()).await.unwrap();
        assert!(editor["editor"]["owner"].as_str().unwrap().starts_with("memory:"));
        assert_eq!(editor["editor"]["autoRecordEnabled"], true);
        for id in &session_ids {
            let read = handle_request(state.clone(), "project.autoMemory.agentList", json!({"sessionId":id,"boundPath":slot}), tx.clone()).await.unwrap();
            assert_eq!(&read["memoryAlias"], alias);
            assert_eq!(read["autoRecordEnabled"], true);
        }
        let before = all_kv(&state.lock().await.db);
        handle_request(state.clone(), "project.autoMemory.agentList", json!({"sessionId":session_ids[0],"boundPath":slot}), tx.clone()).await.unwrap();
        assert_eq!(all_kv(&state.lock().await.db), before, "ordinary refresh does not rewrite migration or binding timestamps");
        let added = handle_request(state.clone(), "project.autoMemory.agentUpsert", json!({"sessionId":session_ids[0],"boundPath":slot,"title":"Stable","content":"Verified durable convention"}), tx.clone()).await.unwrap();
        assert!(added["memory"]["content"].as_str().unwrap().contains("Verified durable convention"));
        for id in &session_ids[1..] {
            let denied = handle_request(state.clone(), "project.autoMemory.agentUpsert", json!({"sessionId":id,"boundPath":slot,"content":"Not allowed"}), tx.clone()).await.unwrap_err();
            assert_eq!(denied.data.unwrap()["errorCode"], "TOOL_DISABLED_IN_PLAN");
        }
        let forged = handle_request(state.clone(), "project.autoMemory.agentList", json!({"sessionId":session_ids[0],"boundPath":owner}), tx).await.unwrap_err();
        assert_eq!(forged.data.unwrap()["errorCode"], "SESSION_PROJECT_CHANGED");
    }).await;
    assert_eq!(
        state
            .lock()
            .await
            .db
            .get_project_memory(&slot)
            .unwrap()
            .content,
        "Older worktree finding"
    );
}

#[tokio::test]
async fn project_memory_alias_rechecks_binding_after_unlocked_git_validation() {
    use crate::project_memory_owner::{tests::Fixture, TEST_PROJECTION, TEST_VALIDATION_GATE};
    let f = Fixture::new();
    let slot = f.slot.to_str().unwrap().to_owned();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    let session = sessions::create_session_with_options(
        &app.db,
        sessions::SessionCreateOptions {
            project_path: Some(slot.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    let state = Arc::new(Mutex::new(app));
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (tx, _) = mpsc::unbounded_channel();
    let call = tokio::spawn({
        let state = state.clone();
        let id = session.id.clone();
        let projection = f.projection.clone();
        let entered = entered.clone();
        let release = release.clone();
        async move {
            TEST_PROJECTION
                .scope(
                    projection,
                    TEST_VALIDATION_GATE.scope(
                        (entered, release),
                        handle_request(
                            state,
                            "project.autoMemory.agentList",
                            json!({"sessionId":id,"boundPath":slot}),
                            tx,
                        ),
                    ),
                )
                .await
        }
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), entered.notified())
        .await
        .unwrap();
    {
        let st = tokio::time::timeout(std::time::Duration::from_secs(2), state.lock())
            .await
            .expect("Git validation must not own AppState");
        let replacement = st
            .db
            .ensure_project(f.repository.to_str().unwrap(), false)
            .unwrap();
        st.db
            .conn
            .execute(
                "UPDATE sessions SET project_id=?1 WHERE id=?2",
                rusqlite::params![replacement, session.id],
            )
            .unwrap();
    }
    release.notify_one();
    let denied = call.await.unwrap().unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "SESSION_PROJECT_CHANGED");
}

#[tokio::test]
async fn project_memory_alias_refreshes_shared_edits_and_revokes_only_invalid_instructions() {
    use crate::project_memory_owner::{tests::Fixture, TEST_PROJECTION};
    let mut f = Fixture::new();
    let owner = f.repository.to_str().unwrap().to_owned();
    let slot = f.slot.to_str().unwrap().to_owned();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(&owner, false).unwrap();
    let session = sessions::create_session_with_options(
        &app.db,
        sessions::SessionCreateOptions {
            project_path: Some(slot.clone()),
            mode: Some("plan".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    TEST_PROJECTION.scope(f.projection.clone(), async {
        for content in ["version one", "version two", ""] {
            let editor = handle_request(state.clone(), "project.memory.editor.get", json!({"path":owner}), tx.clone()).await.unwrap();
            let entries = if content.is_empty() { json!([]) } else { json!([{"id":"current","title":"","content":content}]) };
            handle_request(state.clone(), "project.memory.editor.save", json!({"path":owner, "expectedOwner":editor["editor"]["owner"], "expectedMemory":editor["editor"]["memory"], "entries":entries}), tx.clone()).await.unwrap();
            let read = handle_request(state.clone(), "project.autoMemory.agentList", json!({"sessionId":session.id,"boundPath":slot}), tx.clone()).await.unwrap();
            assert_eq!(read["memoryAlias"]["memory"]["content"], content);
        }
        f.data["schema_version"] = json!(2);
        f.save();
        let read = handle_request(state.clone(), "project.autoMemory.agentList", json!({"sessionId":session.id,"boundPath":slot}), tx).await.unwrap();
        assert!(read.get("memoryAlias").is_none(), "unverified owner instructions are revoked");
        assert_eq!(read["memory"]["content"], "", "Git-verified shared memory is independent of the legacy projection");
    }).await;
}
