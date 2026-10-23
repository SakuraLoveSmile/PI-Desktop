use super::*;
use crate::project_memory_owner::tests::Fixture;

fn memory_state(db: &crate::db::Database) -> Vec<(String, String, String)> {
    let mut statement = db
        .conn()
        .prepare("SELECT ns, key, value_json FROM kv ORDER BY ns, key")
        .unwrap();
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

#[tokio::test]
async fn worktree_memory_group_edit_rejects_combining_independent_used_memory_spaces_atomically() {
    for scenario in ["update", "create", "empty-primary", "explicit-update"] {
        let first = Fixture::new();
        let second = Fixture::new();
        let paths = [
            first.repository.to_str().unwrap(),
            second.repository.to_str().unwrap(),
        ];
        let mut app = AppState::open(&first.dir.path().join("profile")).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        let mut owners = Vec::new();
        let mut sessions = Vec::new();
        let mut memories = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            let editor = handle_request(
                state.clone(),
                "project.memory.editor.get",
                json!({"path":path}),
                tx.clone(),
            )
            .await
            .unwrap();
            let saved = handle_request(state.clone(), "project.memory.editor.save", json!({
                "path":path,"expectedOwner":editor["editor"]["owner"],"expectedMemory":editor["editor"]["memory"],
                "entries":[{"id":"existing","title":"Current","content":format!("Independent project {index} current knowledge")}]
            }), tx.clone()).await.unwrap();
            owners.push(saved["editor"]["owner"].as_str().unwrap().to_owned());
            memories.push(saved["editor"]["memory"].clone());
            let session = handle_request(
                state.clone(),
                "session.create",
                json!({"projectPath":path}),
                tx.clone(),
            )
            .await
            .unwrap();
            sessions.push(session["session"]["id"].as_str().unwrap().to_owned());
        }
        let empty = first.dir.path().join("empty-new-root");
        std::fs::create_dir(&empty).unwrap();
        if scenario == "explicit-update" {
            handle_request(
                state.clone(),
                "project.group.create",
                json!({"name":"Existing explicit","folders":[paths[0],empty]}),
                tx.clone(),
            )
            .await
            .unwrap();
        }
        let (before, groups, group_id) = {
            let st = state.lock().await;
            (
                memory_state(&st.db),
                serde_json::to_value(st.db.list_project_groups().unwrap()).unwrap(),
                st.db.project_group_for_path(paths[0]).unwrap().unwrap().id,
            )
        };
        let method = if matches!(scenario, "create" | "empty-primary") {
            "project.group.create"
        } else {
            "project.group.update"
        };
        let folders = if scenario == "empty-primary" {
            vec![empty.to_str().unwrap().to_owned(), paths[1].to_owned()]
        } else {
            paths.iter().map(|path| (*path).to_owned()).collect()
        };
        let result = handle_request(
            state.clone(),
            method,
            json!({"groupId":group_id,"name":"Combined","folders":folders}),
            tx.clone(),
        )
        .await;
        assert!(
            result.is_err(),
            "independent used memory spaces require an explicit merge decision"
        );
        assert!(result
            .unwrap_err()
            .message
            .contains("memory space conflict"));
        {
            let st = state.lock().await;
            assert_eq!(
                memory_state(&st.db),
                before,
                "all memory indexes, content, bindings and compatibility copies roll back"
            );
            assert_eq!(
                serde_json::to_value(st.db.list_project_groups().unwrap()).unwrap(),
                groups
            );
            for (index, path) in paths.iter().enumerate() {
                let project = st.db.project_memory_space_for_path(path).unwrap().unwrap();
                assert_eq!(format!("memory:{}", project.id), owners[index]);
                assert_eq!(
                    st.db
                        .project_memory_space_session(&sessions[index])
                        .unwrap()
                        .unwrap(),
                    project.id
                );
            }
        }
        for (index, path) in paths.iter().enumerate() {
            let editor = handle_request(
                state.clone(),
                "project.memory.editor.get",
                json!({"path":path}),
                tx.clone(),
            )
            .await
            .unwrap();
            assert_eq!(editor["editor"]["owner"], owners[index]);
            assert_eq!(editor["editor"]["memory"], memories[index]);
        }
    }
}

#[tokio::test]
async fn worktree_memory_legacy_group_edit_without_fresh_evidence_cannot_orphan_existing_memory() {
    for create in [false, true] {
        let f = Fixture::new();
        let main = f.repository.to_str().unwrap().to_owned();
        let notes = f.dir.path().join("notes");
        std::fs::create_dir(&notes).unwrap();
        let roots = [main.clone(), notes.to_str().unwrap().to_owned()];
        let app = AppState::open(&f.dir.path().join("profile")).unwrap();
        let prepared = crate::project_memory_owner::prepare(&main).await.unwrap();
        let project = app.db.ensure_project_memory_space(&prepared).unwrap();
        app.db.set_memory_space_content(&project.id, &json!([{"id":"live","title":"Current","content":"Do not orphan current project notes"}])).unwrap();
        let session = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                project_path: Some(main.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        app.db
            .bind_project_memory_space_session(&session.id, &project.id)
            .unwrap();
        let group = app.db.project_group_for_path(&main).unwrap().unwrap();
        let before = memory_state(&app.db);
        let groups = serde_json::to_value(app.db.list_project_groups().unwrap()).unwrap();
        let result = if create {
            app.db.create_project_group("Combined", &roots)
        } else {
            app.db.update_project_group(&group.id, "Combined", &roots)
        };
        assert!(
            result.is_err(),
            "synchronous callers must not silently replace an existing shared UUID"
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("requires fresh memory identity evidence"));
        assert_eq!(memory_state(&app.db), before);
        assert_eq!(
            serde_json::to_value(app.db.list_project_groups().unwrap()).unwrap(),
            groups
        );
        assert_eq!(
            app.db
                .project_memory_space_for_path(&main)
                .unwrap()
                .unwrap()
                .id,
            project.id
        );
        assert_eq!(
            app.db
                .project_memory_space_session(&session.id)
                .unwrap()
                .unwrap(),
            project.id
        );
    }
}
