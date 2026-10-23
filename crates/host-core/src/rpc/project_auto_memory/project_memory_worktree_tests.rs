use super::*;
use crate::project_memory_owner::tests::{git, Fixture};

#[tokio::test]
async fn worktree_memory_group_creation_after_slot_reuse_does_not_transfer_old_notes_or_history() {
    let f = Fixture::new();
    let other = Fixture::new();
    let slot = f.slot.to_str().unwrap();
    let extra = f.dir.path().join("new-notes");
    std::fs::create_dir(&extra).unwrap();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db
        .set_project_memory(slot, "Previous repository private knowledge")
        .unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let previous = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":slot}),
        tx.clone(),
    )
    .await
    .unwrap();
    let session = handle_request(
        state.clone(),
        "session.create",
        json!({"projectPath":slot}),
        tx.clone(),
    )
    .await
    .unwrap();
    git(&f.repository, &["worktree", "remove", slot]);
    git(
        &other.repository,
        &["worktree", "add", "-q", "-b", "replacement-group", slot],
    );
    handle_request(
        state.clone(),
        "project.group.create",
        json!({"name":"Replacement","folders":[slot,extra]}),
        tx.clone(),
    )
    .await
    .unwrap();
    let current = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":slot}),
        tx,
    )
    .await
    .unwrap();
    assert_ne!(current["editor"]["owner"], previous["editor"]["owner"]);
    assert!(!current["editor"]["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("Previous repository"));
    let st = state.lock().await;
    let old_id = session["session"]["id"].as_str().unwrap();
    assert_eq!(
        format!(
            "memory:{}",
            st.db.project_memory_space_session(old_id).unwrap().unwrap()
        ),
        previous["editor"]["owner"].as_str().unwrap()
    );
}

#[tokio::test]
async fn worktree_memory_new_slot_group_copies_current_notes_and_only_selected_history() {
    for explicit_source in [false, true] {
        let f = Fixture::new();
        let main = f.repository.to_str().unwrap();
        let slot = f.slot.to_str().unwrap();
        let extra = f.dir.path().join("slot-notes");
        std::fs::create_dir(&extra).unwrap();
        let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
        app.handshook = true;
        app.db.ensure_project(main, false).unwrap();
        app.db.ensure_project(slot, false).unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        let editor = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({"path":main}),
            tx.clone(),
        )
        .await
        .unwrap();
        let saved = handle_request(state.clone(), "project.memory.editor.save", json!({
        "path":main,"expectedOwner":editor["editor"]["owner"],"expectedMemory":editor["editor"]["memory"],
        "entries":[{"id":"live","title":"Current","content":"Only the current shared collection contains this"}]
    }), tx.clone()).await.unwrap();
        if explicit_source {
            let main_notes = f.dir.path().join("main-notes");
            std::fs::create_dir(&main_notes).unwrap();
            handle_request(
                state.clone(),
                "project.group.create",
                json!({"name":"Original explicit project","folders":[main,main_notes]}),
                tx.clone(),
            )
            .await
            .unwrap();
        }
        let main_session = handle_request(
            state.clone(),
            "session.create",
            json!({"projectPath":main}),
            tx.clone(),
        )
        .await
        .unwrap();
        let slot_session = handle_request(
            state.clone(),
            "session.create",
            json!({"projectPath":slot}),
            tx.clone(),
        )
        .await
        .unwrap();
        handle_request(
            state.clone(),
            "project.group.create",
            json!({"name":"Separate work","folders":[slot,extra]}),
            tx.clone(),
        )
        .await
        .unwrap();
        let separate = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({"path":slot}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_ne!(separate["editor"]["owner"], saved["editor"]["owner"]);
        assert_eq!(separate["editor"]["memory"], saved["editor"]["memory"]);
        {
            let st = state.lock().await;
            let main_id = main_session["session"]["id"].as_str().unwrap();
            let slot_id = slot_session["session"]["id"].as_str().unwrap();
            assert_eq!(
                format!(
                    "memory:{}",
                    st.db
                        .project_memory_space_session(main_id)
                        .unwrap()
                        .unwrap()
                ),
                saved["editor"]["owner"].as_str().unwrap()
            );
            assert_eq!(
                format!(
                    "memory:{}",
                    st.db
                        .project_memory_space_session(slot_id)
                        .unwrap()
                        .unwrap()
                ),
                separate["editor"]["owner"].as_str().unwrap()
            );
        }
        let retained = handle_request(state, "project.memory.editor.get", json!({"path":main}), tx)
            .await
            .unwrap();
        assert_eq!(retained["editor"]["owner"], saved["editor"]["owner"]);
        assert_eq!(retained["editor"]["memory"], saved["editor"]["memory"]);
    }
}

#[tokio::test]
async fn worktree_memory_group_expansion_and_shrink_preserve_notes_and_history_identity() {
    let f = Fixture::new();
    let main = f.repository.to_str().unwrap().to_owned();
    let notes = f.dir.path().join("notes");
    std::fs::create_dir(&notes).unwrap();
    let notes = notes.to_str().unwrap().to_owned();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(&main, false).unwrap();
    let group_id = app.db.project_group_for_path(&main).unwrap().unwrap().id;
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let first = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    let saved = handle_request(state.clone(), "project.memory.editor.save", json!({
        "path":main,"expectedOwner":first["editor"]["owner"],"expectedMemory":first["editor"]["memory"],
        "entries":[{"id":"current","title":"Current knowledge","content":"Notes written after automatic sharing"}]
    }), tx.clone()).await.unwrap();
    let old_session = handle_request(
        state.clone(),
        "session.create",
        json!({"projectPath":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    let expanded = handle_request(
        state.clone(),
        "project.group.update",
        json!({"groupId":group_id,"name":"Expanded","folders":[main,notes]}),
        tx.clone(),
    )
    .await
    .unwrap();
    let expanded_id = expanded["group"]["id"].as_str().unwrap();
    let shared = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":notes}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        shared["editor"]["owner"], saved["editor"]["owner"],
        "adding a root must retain the project memory UUID"
    );
    assert_eq!(shared["editor"]["memory"], saved["editor"]["memory"]);
    let new_session = handle_request(
        state.clone(),
        "session.create",
        json!({"projectPath":notes}),
        tx.clone(),
    )
    .await
    .unwrap();
    let old_id = old_session["session"]["id"].as_str().unwrap();
    let new_id = new_session["session"]["id"].as_str().unwrap();
    {
        let st = state.lock().await;
        assert_eq!(
            st.db.project_memory_space_session(old_id).unwrap(),
            st.db.project_memory_space_session(new_id).unwrap()
        );
    }
    handle_request(
        state.clone(),
        "project.group.update",
        json!({"groupId":expanded_id,"name":"Shrunk","folders":[main]}),
        tx.clone(),
    )
    .await
    .unwrap();
    let shrunk = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(shrunk["editor"]["owner"], saved["editor"]["owner"]);
    assert_eq!(shrunk["editor"]["memory"], saved["editor"]["memory"]);
    let groups = handle_request(state, "project.groups.list", json!({}), tx)
        .await
        .unwrap();
    let row = groups["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == expanded_id)
        .unwrap();
    assert_eq!(
        format!("memory:{}", row["memoryProject"]["id"].as_str().unwrap()),
        saved["editor"]["owner"].as_str().unwrap()
    );
}

#[tokio::test]
async fn worktree_memory_explicit_mixed_roots_share_one_editor_in_either_primary_order() {
    for non_git_primary in [false, true] {
        let f = Fixture::new();
        let notes = f.dir.path().join("project-notes");
        std::fs::create_dir(&notes).unwrap();
        let main = f.repository.to_str().unwrap().to_owned();
        let notes = notes.to_str().unwrap().to_owned();
        let roots = if non_git_primary {
            vec![notes.clone(), main.clone()]
        } else {
            vec![main.clone(), notes.clone()]
        };
        let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
        app.handshook = true;
        let group = app.db.create_project_group("Mixed roots", &roots).unwrap();
        app.db
            .set_project_group_memory(
                &group.id,
                &json!([
                    {"id":"initial","title":"Shared","content":"Original group knowledge"}
                ]),
            )
            .unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        // The non-Git root is usable even before a Git root has been opened.
        let first = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({"path":notes}),
            tx.clone(),
        )
        .await
        .unwrap();
        let other = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({"path":main}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(first["editor"]["owner"], other["editor"]["owner"]);
        assert!(first["editor"]["owner"]
            .as_str()
            .unwrap()
            .starts_with("memory:"));
        let saved = handle_request(state.clone(), "project.memory.editor.save", json!({
            "path":notes, "expectedOwner":first["editor"]["owner"],
            "expectedMemory":first["editor"]["memory"],
            "entries":[{"id":"shared","title":"Updated","content":"Saved from the non-Git root"}]
        }), tx.clone()).await.unwrap();
        let read = handle_request(state, "project.memory.editor.get", json!({"path":main}), tx)
            .await
            .unwrap();
        assert_eq!(read["editor"]["memory"], saved["editor"]["memory"]);
    }
}

#[tokio::test]
async fn worktree_memory_legacy_setter_remains_compatible_until_agent_recording_is_enabled() {
    let f = Fixture::new();
    let main = f.repository.to_str().unwrap();
    let slot = f.slot.to_str().unwrap();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(main, false).unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    handle_request(
        state.clone(),
        "project.memory.set",
        json!({"path":slot,"content":"  Existing client note.\n"}),
        tx.clone(),
    )
    .await
    .unwrap();
    let editor = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        editor["editor"]["memory"]["content"],
        "  Existing client note.\n"
    );
    handle_request(state.clone(), "project.memory.set", json!({"path":main,"entries":[{"id":"legacy","title":"Existing","content":"Existing entry client"}]}), tx.clone()).await.unwrap();
    let other = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":slot}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert!(other["editor"]["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("Existing entry client"));
    handle_request(
        state.clone(),
        "project.autoMemory.setEnabled",
        json!({"path":main,"expectedOwner":editor["editor"]["owner"],"enabled":true}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert!(handle_request(
        state.clone(),
        "project.memory.set",
        json!({"path":slot,"content":"Stale writer"}),
        tx.clone()
    )
    .await
    .is_err());
    let retained = handle_request(state, "project.memory.get", json!({"path":main}), tx)
        .await
        .unwrap();
    assert!(retained["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("Existing entry client"));
}

#[tokio::test]
async fn worktree_memory_user_path_reads_saves_and_reopens_one_collection() {
    let f = Fixture::new();
    let branch = f.dir.path().join("release-verify");
    git(
        &f.repository,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "release-verify",
            branch.to_str().unwrap(),
        ],
    );
    let main = f.repository.to_str().unwrap();
    let branch = branch.to_str().unwrap();
    let data = f.dir.path().join("app-data");
    let mut app = AppState::open(&data).unwrap();
    app.handshook = true;
    app.db.ensure_project(main, false).unwrap();
    app.db.ensure_project(branch, false).unwrap();
    app.db
        .set_project_memory(main, "Use the existing project design system.")
        .unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let editor = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":branch}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert!(editor["editor"]["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("existing project design system"));
    let main_editor = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(main_editor["editor"]["owner"], editor["editor"]["owner"]);
    let saved = handle_request(state.clone(), "project.memory.editor.save", json!({"path":branch,
        "expectedOwner": editor["editor"]["owner"], "expectedMemory": editor["editor"]["memory"],
        "entries": [{"id":"stable", "title":"Design", "content":"Keep the existing design system and validate its user path."}]
    }), tx.clone()).await.unwrap();
    let read = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(read["editor"]["memory"], saved["editor"]["memory"]);
    assert_eq!(
        state
            .lock()
            .await
            .db
            .get_project_memory(main)
            .unwrap()
            .content,
        "Use the existing project design system.",
        "migration retains the source collection"
    );
    drop(state);
    git(&f.repository, &["worktree", "remove", branch]);
    let mut app = AppState::open(&data).unwrap();
    app.handshook = true;
    let reopened = Arc::new(Mutex::new(app));
    let read = handle_request(
        reopened,
        "project.memory.editor.get",
        json!({"path":main}),
        tx,
    )
    .await
    .unwrap();
    assert_eq!(read["editor"]["owner"], saved["editor"]["owner"]);
    assert_eq!(read["editor"]["memory"], saved["editor"]["memory"]);
}

#[tokio::test]
async fn worktree_memory_reused_directory_does_not_import_previous_repository_sources_or_sessions()
{
    let f = Fixture::new();
    let other = Fixture::new();
    let slot = f.slot.to_str().unwrap();
    let mut app = AppState::open(&f.dir.path().join("app-data")).unwrap();
    app.handshook = true;
    app.db
        .set_project_memory(slot, "Previous repository's task evidence")
        .unwrap();
    let session = sessions::create_session_with_options(
        &app.db,
        sessions::SessionCreateOptions {
            project_path: Some(slot.into()),
            ..Default::default()
        },
    )
    .unwrap();
    let original = crate::project_memory_owner::prepare(slot).await.unwrap();
    let original_project = app.db.ensure_project_memory_space(&original).unwrap();
    assert_eq!(
        app.db.project_memory_space_session(&session.id).unwrap(),
        Some(original_project.id.clone())
    );
    git(&f.repository, &["worktree", "remove", slot]);
    git(
        &other.repository,
        &["worktree", "add", "-q", "-b", "reused", slot],
    );
    let replacement = crate::project_memory_owner::prepare(slot).await.unwrap();
    let replacement_project = app.db.ensure_project_memory_space(&replacement).unwrap();
    assert_ne!(original_project.id, replacement_project.id);
    assert!(app
        .db
        .get_memory_space_content(&replacement_project.id)
        .unwrap()
        .content
        .is_empty());
    assert!(app
        .db
        .get_memory_space_content(&original_project.id)
        .unwrap()
        .content
        .contains("Previous repository"));
    assert_eq!(
        app.db.get_project_memory(slot).unwrap().content,
        "Previous repository's task evidence"
    );
    assert_eq!(
        app.db.project_memory_space_session(&session.id).unwrap(),
        Some(original_project.id)
    );
    assert!(app
        .db
        .bind_project_memory_space_session(&session.id, &replacement_project.id)
        .is_err());
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    assert!(handle_request(
        state,
        "project.autoMemory.agentList",
        json!({"sessionId":session.id,"boundPath":slot}),
        tx
    )
    .await
    .is_err());
}

#[tokio::test]
async fn worktree_memory_overflow_preserves_original_editors_for_recovery() {
    let f = Fixture::new();
    let main = f.repository.to_str().unwrap();
    let slot = f.slot.to_str().unwrap();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db
        .set_project_memory(main, &"a".repeat(20_000))
        .unwrap();
    app.db
        .set_project_memory(slot, &"b".repeat(20_000))
        .unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let editor = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(editor["editor"]["migrationRequired"], true);
    assert_eq!(
        editor["editor"]["memory"]["content"]
            .as_str()
            .unwrap()
            .len(),
        20_000
    );
    assert!(
        state
            .lock()
            .await
            .db
            .project_memory_space_for_path(main)
            .unwrap()
            .is_none(),
        "migration failure rolls back associations"
    );
    handle_request(
        state.clone(),
        "project.memory.editor.save",
        json!({"path":main,
            "expectedOwner":editor["editor"]["owner"], "expectedMemory":editor["editor"]["memory"],
            "entries":[{"id":"short","title":"","content":"Condensed original knowledge"}]
        }),
        tx.clone(),
    )
    .await
    .unwrap();
    let recovered = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":slot}),
        tx,
    )
    .await
    .unwrap();
    assert!(recovered["editor"].get("migrationRequired").is_none());
    assert!(recovered["editor"]["owner"]
        .as_str()
        .unwrap()
        .starts_with("memory:"));
    assert!(recovered["editor"]["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("Condensed original knowledge"));
    assert_eq!(
        state
            .lock()
            .await
            .db
            .get_project_memory(slot)
            .unwrap()
            .content
            .len(),
        20_000
    );
}

#[tokio::test]
async fn worktree_memory_stale_editor_cannot_discard_another_checkout_update() {
    let f = Fixture::new();
    let main = f.repository.to_str().unwrap();
    let slot = f.slot.to_str().unwrap();
    let mut app = AppState::open(&f.dir.path().join("profile")).unwrap();
    app.handshook = true;
    app.db.ensure_project(main, false).unwrap();
    app.db.ensure_project(slot, false).unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, _) = mpsc::unbounded_channel();
    let stale = handle_request(
        state.clone(),
        "project.memory.editor.get",
        json!({"path":main}),
        tx.clone(),
    )
    .await
    .unwrap();
    let changed = handle_request(state.clone(), "project.memory.editor.save", json!({"path":slot,
        "expectedOwner":stale["editor"]["owner"], "expectedMemory":stale["editor"]["memory"],
        "entries":[{"id":"verified","title":"Shared","content":"Preserve this other checkout update"}]
    }), tx.clone()).await.unwrap();
    let denied = handle_request(state.clone(), "project.memory.editor.save", json!({"path":main,
        "expectedOwner":stale["editor"]["owner"], "expectedMemory":stale["editor"]["memory"], "entries":[]
    }), tx).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "CONFLICT");
    assert_eq!(
        state
            .lock()
            .await
            .db
            .get_project_memory_editor(main)
            .unwrap()
            .memory
            .content,
        changed["editor"]["memory"]["content"]
    );
}
