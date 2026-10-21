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
async fn project_memory_alias_rpc_reads_group_and_legacy_without_writes_or_roots() {
    use crate::project_memory_owner::{tests::Fixture, TEST_PROJECTION};
    let f = Fixture::new();
    let owner = f.repository.to_str().unwrap().to_string();
    let slot = f.slot.to_str().unwrap().to_string();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(&owner, false).unwrap();
    app.db.ensure_project(&slot, false).unwrap();
    app.db
        .set_project_memory(&slot, "stale slot memory")
        .unwrap();
    app.db
        .set_project_memory(&owner, "owner legacy memory")
        .unwrap();
    app.db.kv_set("projectAutoMemory",&format!("path:{owner}"), &json!({"enabled":true,"entries":[{"id":"preview","title":"Preview","content":"unmigrated note"}]})).unwrap();
    let mut session_ids = Vec::new();
    for mode in ["agent", "plan", "goal"] {
        session_ids.push(
            sessions::create_session_with_options(
                &app.db,
                sessions::SessionCreateOptions {
                    project_path: Some(slot.clone()),
                    mode: Some(mode.into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .id,
        );
    }
    let before = all_kv(&app.db);
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    TEST_PROJECTION.scope(f.projection.clone(),async {
            let context=handle_request(state.clone(),"project.group.context",json!({"path":slot}),tx.clone()).await.unwrap();
            assert!(context["context"].is_null());
            assert!(context["memoryAlias"]["memory"]["content"].as_str().unwrap().contains("owner legacy memory"));
            assert!(context["memoryAlias"]["memory"]["content"].as_str().unwrap().contains("unmigrated note"));
            assert!(context["memoryAlias"].get("roots").is_none());
            let editor = handle_request(state.clone(), "project.memory.editor.get", json!({"path":slot}), tx.clone()).await.unwrap();
            assert_eq!(editor["editor"]["memory"], context["memoryAlias"]["memory"]);
            assert_eq!(editor["editor"]["autoRecordEnabled"], false);
            for (index,id) in session_ids.iter().enumerate() {
                let read=handle_request(state.clone(),"project.autoMemory.agentList",json!({"sessionId":id,"boundPath":slot}),tx.clone()).await.unwrap();
                assert_eq!(read["memoryAlias"],context["memoryAlias"]);
                assert_eq!(read["autoRecordEnabled"],false);
                for method in ["project.autoMemory.agentUpsert", "project.autoMemory.agentDelete"] {
                    let denied=handle_request(state.clone(),method,json!({"sessionId":id,"boundPath":slot,"content":"not allowed","id":"preview","expectedTitle":"Preview","expectedContent":"unmigrated note"}),tx.clone()).await.unwrap_err();
                    assert_eq!(denied.data.unwrap()["errorCode"], if index==0 {"MEMORY_ALIAS_READ_ONLY"} else {"TOOL_DISABLED_IN_PLAN"});
                }
            }
            let forged=handle_request(state.clone(),"project.autoMemory.agentList",json!({"sessionId":session_ids[0],"boundPath":owner}),tx.clone()).await.unwrap_err();
            assert_eq!(forged.data.unwrap()["errorCode"],"SESSION_PROJECT_CHANGED");
            for method in ["project.memory.set","project.memory.editor.save","project.autoMemory.setEnabled"] {
                let denied=handle_request(state.clone(),method,json!({"path":slot,"content":"overwrite","entries":[],"expectedOwner":"anything","expectedMemory":{},"enabled":true}),tx.clone()).await.unwrap_err();
                assert_eq!(denied.data.unwrap()["errorCode"],"MEMORY_ALIAS_READ_ONLY");
            }
            let memory=handle_request(state.clone(),"project.memory.get",json!({"path":slot}),tx.clone()).await.unwrap();
            assert_eq!(memory["memory"],context["memoryAlias"]["memory"]);
        }).await;
    assert_eq!(all_kv(&state.lock().await.db), before);
    let group = {
        let st = state.lock().await;
        st.db
            .create_project_group("Owner", std::slice::from_ref(&owner))
            .unwrap()
    };
    {
        let st = state.lock().await;
        st.db
            .set_project_group_instructions(&group.id, "real shared instructions")
            .unwrap();
        st.db
            .set_project_group_memory(&group.id, &json!([]))
            .unwrap();
    }
    let before = all_kv(&state.lock().await.db);
    TEST_PROJECTION
        .scope(f.projection.clone(), async {
            let read = handle_request(
                state.clone(),
                "project.group.context",
                json!({"path":slot}),
                tx.clone(),
            )
            .await
            .unwrap();
            assert!(read["context"].is_null());
            assert_eq!(
                read["memoryAlias"]["instructions"],
                "real shared instructions"
            );
            assert_eq!(read["memoryAlias"]["memory"]["content"], "");
            let per_turn = handle_request(
                state.clone(),
                "project.autoMemory.agentList",
                json!({"sessionId":session_ids[1],"boundPath":slot}),
                tx.clone(),
            )
            .await
            .unwrap();
            assert_eq!(per_turn["memoryAlias"], read["memoryAlias"]);
        })
        .await;
    assert_eq!(all_kv(&state.lock().await.db), before);
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
async fn project_memory_alias_next_read_updates_deletes_and_invalidates_without_cache() {
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
    app.db.set_project_memory(&owner, "version one").unwrap();
    app.db.set_project_memory(&slot, "slot fallback").unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    TEST_PROJECTION
        .scope(f.projection.clone(), async {
            for content in ["version one", "version two", ""] {
                {
                    let st = state.lock().await;
                    if content.is_empty() {
                        st.db.delete_project_memory(&owner).unwrap();
                    } else {
                        st.db.set_project_memory(&owner, content).unwrap();
                    }
                }
                let before = all_kv(&state.lock().await.db);
                let read = handle_request(
                    state.clone(),
                    "project.autoMemory.agentList",
                    json!({"sessionId":session.id,"boundPath":slot}),
                    tx.clone(),
                )
                .await
                .unwrap();
                assert_eq!(read["memoryAlias"]["memory"]["content"], content);
                assert_eq!(all_kv(&state.lock().await.db), before);
            }
            f.data["schema_version"] = json!(2);
            f.save();
            let read = handle_request(
                state.clone(),
                "project.autoMemory.agentList",
                json!({"sessionId":session.id,"boundPath":slot}),
                tx.clone(),
            )
            .await
            .unwrap();
            assert!(read.get("memoryAlias").is_none());
            assert_eq!(read["memory"]["content"], "slot fallback");
        })
        .await;
}
