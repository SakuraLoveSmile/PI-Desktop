use super::*;
use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(["-c", "core.hooksPath=/dev/null"])
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repository(root: &Path) {
    std::fs::create_dir_all(root).unwrap();
    git(root, &["init", "-b", "main"]);
    git(
        root,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    );
}

fn session(db: &Database, path: &str, note: Option<(&str, &str)>) -> String {
    let id = sessions::create_session(
        db,
        Some("Task".into()),
        Some("agent".into()),
        None,
        None,
        Some(path.to_owned()),
    )
    .unwrap()
    .id;
    if let Some((message_id, text)) = note {
        let message: UiMessage = serde_json::from_value(json!({"id":message_id,"role":"user",
            "content":text,"createdAt":"2026-10-23T00:00:00Z"}))
        .unwrap();
        sessions::append_message(db, &id, &message, None).unwrap();
    }
    id
}

async fn call(
    state: &Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    let (tx, _) = mpsc::unbounded_channel();
    handle_request(state.clone(), method, params, tx).await
}

#[tokio::test]
async fn worktree_history_user_path_shares_recall_without_adding_tool_roots() {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("Music");
    let checkout = temporary.path().join("release-verify");
    let other = temporary.path().join("unrelated").join("Music");
    repository(&main);
    repository(&other);
    git(
        &main,
        &["worktree", "add", "-b", "task", checkout.to_str().unwrap()],
    );
    let main = main.to_str().unwrap().to_owned();
    let checkout = checkout.to_str().unwrap().to_owned();
    let other = other.to_str().unwrap().to_owned();
    let mut app = AppState::open(&temporary.path().join("profile")).unwrap();
    app.handshook = true;
    let group = app
        .db
        .create_project_group("Music", std::slice::from_ref(&main))
        .unwrap();
    let source = session(
        &app.db,
        &main,
        Some(("main-note", "durable player convention")),
    );
    let caller = session(&app.db, &checkout, None);
    let unrelated = session(
        &app.db,
        &other,
        Some(("private-note", "durable private convention")),
    );
    let state = Arc::new(Mutex::new(app));
    let results = call(
        &state,
        "project.history.search",
        json!({"sessionId":caller,
        "boundPath":checkout,"query":"durable"}),
    )
    .await
    .unwrap();
    assert_eq!(results["hits"].as_array().unwrap().len(), 1);
    assert_eq!(results["hits"][0]["sessionId"], source);
    let read = call(
        &state,
        "project.history.context",
        json!({"sessionId":caller,"boundPath":checkout,
        "targetSessionId":source,"messageId":"main-note"}),
    )
    .await
    .unwrap();
    assert_eq!(read["messages"][0]["content"], "durable player convention");
    assert!(call(
        &state,
        "project.history.context",
        json!({"sessionId":caller,"boundPath":checkout,
        "targetSessionId":unrelated,"messageId":"private-note"})
    )
    .await
    .is_err());
    let st = state.lock().await;
    let persisted = st.db.project_group_for_path(&main).unwrap().unwrap();
    assert_eq!(persisted.id, group.id);
    assert_eq!(persisted.roots.len(), 1);
    assert_eq!(
        Some(persisted.roots[0].path.clone()),
        crate::db::canonical_project_path(&main)
    );
    assert_eq!(
        sessions::get_session(&st.db, &caller)
            .unwrap()
            .unwrap()
            .summary
            .project_path,
        crate::db::canonical_project_path(&checkout)
    );
}

#[tokio::test]
async fn worktree_history_survives_removal_and_rejects_a_reused_path() {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("Music");
    let slot = temporary.path().join("slot-3");
    let other = temporary.path().join("another-Music");
    repository(&main);
    repository(&other);
    git(
        &main,
        &["worktree", "add", "--detach", slot.to_str().unwrap()],
    );
    let mut app = AppState::open(&temporary.path().join("profile")).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let original = call(
        &state,
        "session.create",
        json!({"projectPath":slot,"title":"Original task"}),
    )
    .await
    .unwrap();
    let owner = call(
        &state,
        "session.create",
        json!({"projectPath":main,"title":"Owner task"}),
    )
    .await
    .unwrap();
    let original_id = original["session"]["id"].as_str().unwrap();
    let owner_id = owner["session"]["id"].as_str().unwrap();
    let original_memory = original["session"]["memoryProjectId"].as_str().unwrap();
    {
        let st = state.lock().await;
        let message: UiMessage = serde_json::from_value(json!({"id":"old-note","role":"user",
            "content":"durable old repository evidence","createdAt":"2026-10-23T00:00:00Z"}))
        .unwrap();
        sessions::append_message(&st.db, original_id, &message, None).unwrap();
    }
    git(&main, &["worktree", "remove", slot.to_str().unwrap()]);
    let old_history = call(
        &state,
        "project.history.search",
        json!({"sessionId":owner_id,
        "boundPath":main,"query":"durable"}),
    )
    .await
    .unwrap();
    assert_eq!(old_history["hits"][0]["sessionId"], original_id);
    git(
        &other,
        &["worktree", "add", "--detach", slot.to_str().unwrap()],
    );
    let replacement = call(
        &state,
        "session.create",
        json!({"projectPath":slot,"title":"Replacement task"}),
    )
    .await
    .unwrap();
    let replacement_id = replacement["session"]["id"].as_str().unwrap();
    assert_ne!(replacement["session"]["memoryProjectId"], original_memory);
    // Forking an old transcript after its checkout was reused must preserve
    // the old logical project, including the cloned message search index.
    let fork = call(&state, "session.fork", json!({"sessionId":original_id}))
        .await
        .unwrap();
    let fork_id = fork["session"]["id"].as_str().unwrap();
    let new_history = call(
        &state,
        "project.history.search",
        json!({"sessionId":replacement_id,
        "boundPath":slot,"query":"durable"}),
    )
    .await
    .unwrap();
    assert!(new_history["hits"].as_array().unwrap().is_empty());
    let fork_history = call(
        &state,
        "project.history.search",
        json!({"sessionId":owner_id,
        "boundPath":main,"query":"durable"}),
    )
    .await
    .unwrap();
    assert!(fork_history["hits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["sessionId"] == fork_id));
    assert_eq!(fork["session"]["memoryProjectId"], original_memory);
    assert!(call(
        &state,
        "project.history.context",
        json!({"sessionId":replacement_id,"boundPath":slot,
        "targetSessionId":original_id,"messageId":"old-note"})
    )
    .await
    .is_err());
    assert!(call(
        &state,
        "project.history.search",
        json!({"sessionId":original_id,
        "boundPath":slot,"query":"durable"})
    )
    .await
    .is_err());
    let listed = call(&state, "session.list", json!({})).await.unwrap();
    let old_row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == original_id)
        .unwrap();
    assert_eq!(old_row["memoryProjectId"], original_memory);
    drop(listed);
    // Losing Git evidence cannot turn a reused checkout into legacy path-only
    // history access to both repositories that previously occupied it.
    git(&other, &["worktree", "remove", slot.to_str().unwrap()]);
    std::fs::create_dir_all(&slot).unwrap();
    let plain = call(&state, "session.create", json!({"projectPath":slot}))
        .await
        .unwrap();
    assert!(call(
        &state,
        "project.history.search",
        json!({"sessionId":plain["session"]["id"],
        "boundPath":slot,"query":"durable"})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn worktree_project_list_and_legacy_editor_share_memory_but_keep_roots() {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("Music");
    let branch = temporary.path().join("release-verify");
    let slot = temporary.path().join("slot-3");
    repository(&main);
    git(
        &main,
        &["worktree", "add", "-b", "release", branch.to_str().unwrap()],
    );
    git(
        &main,
        &["worktree", "add", "--detach", slot.to_str().unwrap()],
    );
    let mut app = AppState::open(&temporary.path().join("profile")).unwrap();
    app.handshook = true;
    let paths = [&main, &branch, &slot];
    let mut group_ids = Vec::new();
    for path in paths {
        group_ids.push(
            app.db
                .create_project_group("Music", &[path.to_str().unwrap().into()])
                .unwrap()
                .id,
        );
    }
    let state = Arc::new(Mutex::new(app));
    let listed = call(&state, "project.groups.list", json!({}))
        .await
        .unwrap();
    let groups = listed["groups"].as_array().unwrap();
    let identity = &groups
        .iter()
        .find(|group| group["id"] == group_ids[0])
        .unwrap()["memoryProject"]["id"];
    assert!(identity.is_string());
    for (index, path) in paths.iter().enumerate() {
        let group = groups
            .iter()
            .find(|group| group["id"] == group_ids[index])
            .unwrap();
        assert_eq!(&group["memoryProject"]["id"], identity);
        assert_eq!(group["roots"].as_array().unwrap().len(), 1);
        assert_eq!(
            group["roots"][0]["path"],
            crate::db::canonical_project_path(path.to_str().unwrap()).unwrap()
        );
    }
    let written = call(&state,"project.group.memory.set",json!({"groupId":group_ids[1],
        "entries":[{"id":"convention","title":"Build","content":"Use the shared player convention"}]})).await.unwrap();
    assert!(written["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("shared player"));
    let editor = call(&state, "project.memory.editor.get", json!({"path":slot}))
        .await
        .unwrap();
    assert_eq!(
        editor["editor"]["owner"],
        format!("memory:{}", identity.as_str().unwrap())
    );
    assert!(editor["editor"]["memory"]["content"]
        .as_str()
        .unwrap()
        .contains("shared player"));
    let read = call(
        &state,
        "project.group.memory.get",
        json!({"groupId":group_ids[0]}),
    )
    .await
    .unwrap();
    assert_eq!(read["memory"], editor["editor"]["memory"]);
    call(
        &state,
        "project.autoMemory.setEnabled",
        json!({"path":main,
        "expectedOwner":editor["editor"]["owner"],"enabled":true}),
    )
    .await
    .unwrap();
    assert!(call(
        &state,
        "project.group.memory.set",
        json!({"groupId":group_ids[2],
        "entries":[]})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn worktree_session_move_changes_durable_recall_identity_only_when_requested() {
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("Music");
    let second = temporary.path().join("Another");
    let plain = temporary.path().join("Notes");
    repository(&first);
    repository(&second);
    std::fs::create_dir_all(&plain).unwrap();
    let mut app = AppState::open(&temporary.path().join("profile")).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let source = call(&state, "session.create", json!({"projectPath":first}))
        .await
        .unwrap();
    let target = call(&state, "session.create", json!({"projectPath":second}))
        .await
        .unwrap();
    let id = source["session"]["id"].as_str().unwrap();
    assert_ne!(
        source["session"]["memoryProjectId"],
        target["session"]["memoryProjectId"]
    );
    let moved = call(
        &state,
        "session.moveProject",
        json!({"sessionId":id,"projectPath":second}),
    )
    .await
    .unwrap();
    assert_eq!(
        moved["session"]["memoryProjectId"],
        target["session"]["memoryProjectId"]
    );
    let detail = call(&state, "session.get", json!({"id":id})).await.unwrap();
    assert_eq!(
        detail["session"]["memoryProjectId"],
        target["session"]["memoryProjectId"]
    );
    let moved = call(
        &state,
        "session.moveProject",
        json!({"sessionId":id,"projectPath":plain}),
    )
    .await
    .unwrap();
    assert!(moved["session"]["memoryProjectId"].is_null());
    assert!(state
        .lock()
        .await
        .db
        .project_memory_space_session(id)
        .unwrap()
        .is_none());
}
