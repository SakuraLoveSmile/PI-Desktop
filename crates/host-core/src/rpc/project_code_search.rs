//! Session-scoped, on-demand code search. Index I/O never holds host state.
use super::*;

fn required<'a>(params: &'a Value, field: &str) -> Result<&'a str, JsonRpcError> {
    params
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| rpc_err(1002, format!("{field} required"), "INVALID_PARAMS"))
}

fn bound_project(st: &AppState, params: &Value) -> Result<String, JsonRpcError> {
    let session_id = required(params, "sessionId")?;
    let session = sessions::get_session(&st.db, session_id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .ok_or_else(|| rpc_err(1007, "session not found", "SESSION_NOT_FOUND"))?;
    crate::team::planning::validate_tool(&st.db, session_id, "CodeSearch").map_err(team_rpc_err)?;
    crate::team::expert_config::validate_tool(&st.db, session_id, "CodeSearch")
        .map_err(team_rpc_err)?;
    let path = session
        .summary
        .project_path
        .ok_or_else(|| rpc_err(1002, "session has no project", "INVALID_PARAMS"))?;
    if crate::db::canonical_project_path(required(params, "boundPath")?)
        != crate::db::canonical_project_path(&path)
    {
        return Err(rpc_err(
            1008,
            "session project changed",
            "SESSION_PROJECT_CHANGED",
        ));
    }
    Ok(path)
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    params: Value,
) -> Result<Value, JsonRpcError> {
    let action = match params.get("action") {
        None => "search",
        Some(Value::String(value)) if matches!(value.as_str(), "search" | "status" | "clear") => {
            match value.as_str() {
                "status" => "status",
                "clear" => "clear",
                _ => "search",
            }
        }
        _ => {
            return Err(rpc_err(
                1002,
                "action must be search, status or clear",
                "INVALID_PARAMS",
            ))
        }
    };
    let query = if action == "search" {
        params
            .get("query")
            .and_then(Value::as_str)
            .filter(|query| (1..=500).contains(&query.chars().count()) && !query.contains('\0'))
            .ok_or_else(|| {
                rpc_err(
                    1002,
                    "query must contain 1–500 characters and no NUL bytes",
                    "INVALID_PARAMS",
                )
            })?
            .to_string()
    } else {
        String::new()
    };
    let limit = params
        .get("limit")
        .map(|value| {
            value
                .as_u64()
                .filter(|limit| (1..=50).contains(limit))
                .map(|limit| limit as usize)
                .ok_or_else(|| rpc_err(1002, "limit must be 1–50", "INVALID_PARAMS"))
        })
        .transpose()?;
    let (path, data_dir) = {
        let st = state.lock().await;
        let path = bound_project(&st, &params)?;
        if action == "clear"
            && sessions::session_mode(&st.db, required(&params, "sessionId")?)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                .is_some_and(|mode| matches!(mode.as_str(), "plan" | "goal"))
        {
            return Err(rpc_err(
                1008,
                "clearing the code index is unavailable in plan mode",
                "TOOL_DISABLED_IN_PLAN",
            ));
        }
        (path, st.data_dir.clone())
    };
    let root = PathBuf::from(&path);
    // Startup and unrelated RPCs do not depend on a healthy rebuildable index.
    let result = tokio::task::spawn_blocking(move || {
        let store = crate::workspace_index::IndexStore::open(&data_dir)?;
        if action == "search" {
            return store.search(&root, &query, limit);
        }
        if action == "clear" {
            store.clear(&root)?;
        }
        let index = store.status(&root)?;
        Ok(crate::workspace_index::CodeSearchResult {
            hits: Vec::new(),
            truncated: index.status == "partial",
            index,
        })
    })
    .await
    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
    let st = state.lock().await;
    if bound_project(&st, &params)? != path {
        return Err(rpc_err(
            1008,
            "session project changed",
            "SESSION_PROJECT_CHANGED",
        ));
    }
    serde_json::to_value(result).map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn code_search_reads_only_the_bound_project_and_remains_available_in_plan() {
        let data = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::write(first.path().join("first.rs"), "fn searchable_first() {}\n").unwrap();
        std::fs::write(
            second.path().join("second.rs"),
            "fn searchable_second() {}\n",
        )
        .unwrap();
        let first_path = first.path().to_string_lossy().into_owned();
        let second_path = second.path().to_string_lossy().into_owned();
        let mut app = AppState::open(data.path()).unwrap();
        app.handshook = true;
        app.workspace.set(second.path());
        let caller = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                mode: Some("plan".into()),
                project_path: Some(first_path.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        assert!(!data.path().join("index").exists());
        let searched = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "query": "searchable" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(searched["hits"].as_array().unwrap().len(), 1);
        assert_eq!(searched["hits"][0]["path"], "first.rs");
        assert_eq!(searched["hits"][0]["line"], 1);
        assert_eq!(searched["index"]["status"], "fresh");
        assert!(data.path().join("index/index.db").is_file());
        let whitespace = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "query": " " }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(whitespace["hits"].as_array().unwrap().len(), 1);
        let status = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "status" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(status["index"]["fileCount"], 1);
        assert!(handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "clear" }),
            tx.clone()
        )
        .await
        .is_err());
        {
            let st = state.lock().await;
            sessions::configure_session(&st.db, &caller.id, "goal", None, None).unwrap();
        }
        assert!(handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "clear" }),
            tx.clone()
        )
        .await
        .is_err());
        {
            let st = state.lock().await;
            sessions::configure_session(&st.db, &caller.id, "agent", None, None).unwrap();
            st.db
                .kv_set(
                    crate::team::expert_config::MEMBER_CONFIG_NS,
                    &caller.id,
                    &json!({ "presetId": "qa", "tools": ["Read"] }),
                )
                .unwrap();
        }
        let blocked_expert = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "status" }),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            blocked_expert.data.unwrap()["errorCode"],
            "TEAM_UNAUTHORIZED"
        );
        {
            let st = state.lock().await;
            st.db
                .kv_delete(crate::team::expert_config::MEMBER_CONFIG_NS, &caller.id)
                .unwrap();
        }
        let cleared = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "clear" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(cleared["index"]["status"], "missing");
        assert!(first.path().join("first.rs").is_file());
        assert!(handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "action": "remove" }),
            tx.clone()
        )
        .await
        .is_err());
        assert!(handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": second_path, "query": "searchable" }),
            tx.clone(),
        )
        .await
        .is_err());
        std::fs::write(first.path().join("first.rs"), "fn updated_only() {}\n").unwrap();
        let updated = handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "query": "searchable" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert!(updated["hits"].as_array().unwrap().is_empty());
        {
            let st = state.lock().await;
            sessions::move_session_project(&st.db, &caller.id, &second_path).unwrap();
        }
        assert!(handle_request(
            state,
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": first_path, "query": "updated" }),
            tx,
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn an_unusable_index_never_prevents_host_startup_or_unrelated_rpc() {
        let data = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("index"), "not a directory").unwrap();
        let path = project.path().to_string_lossy().into_owned();
        let mut app = AppState::open(data.path()).unwrap();
        app.handshook = true;
        let caller = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                project_path: Some(path.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        assert!(handle_request(
            state.clone(),
            "project.codeSearch",
            json!({ "sessionId": caller.id, "boundPath": path, "query": "anything" }),
            tx.clone(),
        )
        .await
        .is_err());
        let memory = handle_request(
            state,
            "project.memory.editor.get",
            json!({ "path": path }),
            tx,
        )
        .await
        .unwrap();
        assert_eq!(memory["editor"]["autoRecordEnabled"], false);
    }
}
