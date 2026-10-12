use super::*;

fn memory_rpc_error(error: anyhow::Error) -> JsonRpcError {
    use crate::db::ProjectMemoryConflict;
    match error.downcast_ref::<ProjectMemoryConflict>() {
        Some(ProjectMemoryConflict::Owner) => rpc_err(1008, error.to_string(), "PROJECT_CHANGED"),
        Some(ProjectMemoryConflict::Snapshot | ProjectMemoryConflict::Entry) => {
            rpc_err(1008, error.to_string(), "CONFLICT")
        }
        None => rpc_err(1002, error.to_string(), "INVALID_PARAMS"),
    }
}

/// Legacy clients do not carry an editor snapshot. Preserve their original
/// behavior until the user opts into concurrent agent writes, then require
/// the snapshot editor so a stale whole-list save cannot discard those writes.
pub(super) fn ensure_legacy_write_allowed(
    db: &crate::db::Database,
    path: &str,
) -> Result<(), JsonRpcError> {
    if db
        .project_group_for_path(path)
        .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?
        .is_some()
        && db
            .get_auto_record_enabled(path)
            .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?
    {
        return Err(rpc_err(
            1002,
            "automatic recording is enabled; use the project memory snapshot editor",
            "INVALID_PARAMS",
        ));
    }
    Ok(())
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    match method {
        "project.memory.editor.get" | "project.memory.editor.save" => {
            let path = params
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let editor = if method == "project.memory.editor.get" {
                st.db.get_project_memory_editor(path)
            } else {
                let owner = params
                    .get("expectedOwner")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "expectedOwner required", "INVALID_PARAMS"))?;
                let memory = params
                    .get("expectedMemory")
                    .ok_or_else(|| rpc_err(1002, "expectedMemory required", "INVALID_PARAMS"))?;
                let entries = params
                    .get("entries")
                    .ok_or_else(|| rpc_err(1002, "entries required", "INVALID_PARAMS"))?;
                st.db
                    .save_project_memory_editor(path, owner, memory, entries)
            }
            .map_err(memory_rpc_error)?;
            Ok(json!({ "editor": editor }))
        }
        "project.autoMemory.setEnabled"
        | "project.autoMemory.agentList"
        | "project.autoMemory.agentUpsert"
        | "project.autoMemory.agentDelete" => {
            let is_agent = method.starts_with("project.autoMemory.agent");
            let st = state.lock().await;
            let path = if is_agent {
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
                let detail = sessions::get_session(&st.db, session_id)
                    .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
                    .ok_or_else(|| rpc_err(1007, "session not found", "SESSION_NOT_FOUND"))?;
                if method != "project.autoMemory.agentList" {
                    crate::team::planning::validate_tool(&st.db, session_id, "ProjectMemory")
                        .map_err(team_rpc_err)?;
                    crate::team::expert_config::validate_tool(&st.db, session_id, "ProjectMemory")
                        .map_err(team_rpc_err)?;
                }
                if method != "project.autoMemory.agentList"
                    && (detail.summary.mode == "plan" || detail.summary.mode == "goal")
                {
                    return Err(rpc_err(
                        1008,
                        "memory writes unavailable in plan mode",
                        "TOOL_DISABLED_IN_PLAN",
                    ));
                }
                detail
                    .summary
                    .project_path
                    .ok_or_else(|| rpc_err(1002, "session has no project", "INVALID_PARAMS"))?
            } else {
                params
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "path required", "INVALID_PARAMS"))?
                    .to_string()
            };
            if is_agent {
                let bound_path = params
                    .get("boundPath")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "session binding required", "INVALID_PARAMS"))?;
                if crate::db::canonical_project_path(bound_path)
                    != crate::db::canonical_project_path(&path)
                {
                    return Err(rpc_err(
                        1008,
                        "session project changed",
                        "SESSION_PROJECT_CHANGED",
                    ));
                }
            }
            for field in ["id", "title", "content", "expectedTitle", "expectedContent"] {
                if params.get(field).is_some_and(|value| !value.is_string()) {
                    return Err(rpc_err(
                        1002,
                        format!("{field} must be a string"),
                        "INVALID_PARAMS",
                    ));
                }
            }
            if matches!(
                method,
                "project.autoMemory.agentUpsert" | "project.autoMemory.agentDelete"
            ) {
                if let Some(id) = params.get("id").and_then(Value::as_str) {
                    if id.trim().is_empty()
                        || params
                            .get("expectedTitle")
                            .and_then(Value::as_str)
                            .is_none()
                        || params
                            .get("expectedContent")
                            .and_then(Value::as_str)
                            .is_none()
                    {
                        return Err(rpc_err(
                            1002,
                            "current entry title and content required",
                            "INVALID_PARAMS",
                        ));
                    }
                }
            }
            if method == "project.autoMemory.setEnabled" {
                let expected_owner = params
                    .get("expectedOwner")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "expectedOwner required", "INVALID_PARAMS"))?;
                let current_owner = st
                    .db
                    .get_project_memory_editor(&path)
                    .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?
                    .owner;
                if current_owner != expected_owner {
                    return Err(rpc_err(
                        1008,
                        "project changed; reload before changing memory",
                        "PROJECT_CHANGED",
                    ));
                }
                let enabled = params
                    .get("enabled")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| rpc_err(1002, "enabled required", "INVALID_PARAMS"))?;
                let auto_record_enabled = st
                    .db
                    .set_auto_memory_enabled(&path, enabled)
                    .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))?;
                return Ok(json!({ "autoRecordEnabled": auto_record_enabled }));
            }
            let state = match method {
                "project.autoMemory.agentUpsert" => {
                    let title = params.get("title").and_then(Value::as_str).unwrap_or("");
                    let content = params
                        .get("content")
                        .and_then(Value::as_str)
                        .ok_or_else(|| rpc_err(1002, "content required", "INVALID_PARAMS"))?;
                    st.db.agent_upsert_project_memory(
                        &path,
                        params.get("id").and_then(Value::as_str),
                        title,
                        content,
                        params.get("expectedTitle").and_then(Value::as_str),
                        params.get("expectedContent").and_then(Value::as_str),
                    )
                }
                "project.autoMemory.agentDelete" => {
                    let id = params
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
                    st.db.agent_delete_project_memory(
                        &path,
                        id,
                        params.get("expectedTitle").and_then(Value::as_str),
                        params.get("expectedContent").and_then(Value::as_str),
                    )
                }
                _ => st.db.get_project_memory_editor(&path),
            }
            .map_err(memory_rpc_error)?;
            let mut memory = serde_json::to_value(&state.memory)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            if memory.get("entries").is_none() {
                memory["entries"] = if state.memory.content.is_empty() {
                    json!([])
                } else {
                    json!([{
                        "id": "legacy-project-memory", "title": "",
                        "content": state.memory.content
                    }])
                };
            }
            Ok(json!({ "memory": memory, "autoRecordEnabled": state.auto_record_enabled }))
        }
        _ => Err(rpc_err(
            1002,
            "unsupported automatic memory method",
            "INVALID_PARAMS",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn legacy_memory_writers_cannot_overwrite_automatic_memory_without_a_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir_all(&root).unwrap();
        let root = root.to_string_lossy().into_owned();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        app.db.ensure_project(&root, false).unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        // The original contract remains usable while automatic recording is off.
        handle_request(
            state.clone(),
            "project.memory.set",
            json!({ "path": root, "content": "Manual original" }),
            tx.clone(),
        )
        .await
        .unwrap();
        {
            let st = state.lock().await;
            st.db.set_auto_memory_enabled(&root, true).unwrap();
            st.db
                .agent_upsert_project_memory(&root, None, "AI", "Preserve this", None, None)
                .unwrap();
        }
        let stale_path_write = handle_request(
            state.clone(),
            "project.memory.set",
            json!({ "path": root, "content": "Stale editor" }),
            tx.clone(),
        )
        .await;
        assert!(stale_path_write.is_err());
        let group = {
            let st = state.lock().await;
            assert!(st
                .db
                .get_project_memory_editor(&root)
                .unwrap()
                .memory
                .content
                .contains("Preserve this"));
            st.db
                .create_project_group("Shared", std::slice::from_ref(&root))
                .unwrap()
        };
        let stale_group_write = handle_request(
            state.clone(),
            "project.group.memory.set",
            json!({ "groupId": group.id, "entries": [] }),
            tx.clone(),
        )
        .await;
        assert!(stale_group_write.is_err());
        {
            let st = state.lock().await;
            assert!(st
                .db
                .get_project_memory_editor(&root)
                .unwrap()
                .memory
                .content
                .contains("Preserve this"));
            st.db.set_auto_memory_enabled(&root, false).unwrap();
        }
        handle_request(state, "project.group.memory.set", json!({ "groupId": group.id, "entries": [{ "id": "manual", "title": "", "content": "Disabled manual update" }] }), tx).await.unwrap();
    }

    #[tokio::test]
    async fn editor_switch_rejects_stale_project_owner_and_preserves_opt_in() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let first = first.to_string_lossy().into_owned();
        let second = second.to_string_lossy().into_owned();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        app.db.ensure_project(&first, false).unwrap();
        app.db.ensure_project(&second, false).unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        let original = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({ "path": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        {
            let st = state.lock().await;
            st.db
                .create_project_group("Combined", &[first.clone(), second])
                .unwrap();
        }
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.setEnabled",
            json!({ "path": first, "enabled": true, "expectedOwner": original["editor"]["owner"] }),
            tx.clone()
        )
        .await
        .is_err());
        {
            let st = state.lock().await;
            assert!(!st.db.get_auto_record_enabled(&first).unwrap());
        }
        let stale_owner = handle_request(
            state.clone(),
            "project.memory.editor.save",
            json!({ "path": first, "expectedOwner": original["editor"]["owner"],
                "expectedMemory": original["editor"]["memory"], "entries": [] }),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(stale_owner.data.unwrap()["errorCode"], "PROJECT_CHANGED");
        let updated = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({ "path": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_ne!(updated["editor"]["owner"], original["editor"]["owner"]);
        let saved = handle_request(
            state.clone(),
            "project.memory.editor.save",
            json!({ "path": first, "expectedOwner": updated["editor"]["owner"],
                "expectedMemory": updated["editor"]["memory"],
                "entries": [{ "id":"manual", "title":"Context", "content":"Save as one list" }] }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            saved["editor"]["memory"]["entries"][0]["content"],
            "Save as one list"
        );
        let stale_snapshot = handle_request(
            state.clone(),
            "project.memory.editor.save",
            json!({ "path": first, "expectedOwner": updated["editor"]["owner"],
                "expectedMemory": updated["editor"]["memory"],
                "entries": [] }),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(stale_snapshot.data.unwrap()["errorCode"], "CONFLICT");
        let invalid_entry = handle_request(
            state.clone(), "project.memory.editor.save",
            json!({ "path": first, "expectedOwner": saved["editor"]["owner"],
                "expectedMemory": saved["editor"]["memory"], "entries": [{ "id": "invalid", "content": false }] }),
            tx.clone(),
        ).await.unwrap_err();
        assert_eq!(invalid_entry.data.unwrap()["errorCode"], "INVALID_PARAMS");
        handle_request(
            state.clone(),
            "project.autoMemory.setEnabled",
            json!({ "path": first, "enabled": true, "expectedOwner": updated["editor"]["owner"] }),
            tx,
        )
        .await
        .unwrap();
        let st = state.lock().await;
        assert!(st.db.get_auto_record_enabled(&first).unwrap());
    }
    #[tokio::test]
    async fn agent_operations_require_current_session_binding_opt_in_and_agent_mode() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let first = first.to_string_lossy().into_owned();
        let second = second.to_string_lossy().into_owned();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        app.db.ensure_project(&second, false).unwrap();
        let session = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                project_path: Some(first.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let plan_session = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                mode: Some("plan".to_string()),
                project_path: Some(first.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        let goal_session = sessions::create_session_with_options(
            &app.db,
            sessions::SessionCreateOptions {
                mode: Some("goal".to_string()),
                project_path: Some(first.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        app.db.set_project_memory(&first, "Manual context").unwrap();
        let state = Arc::new(Mutex::new(app));
        let (tx, _) = mpsc::unbounded_channel();
        let disabled = handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": session.id, "boundPath": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(disabled["autoRecordEnabled"], false);
        assert_eq!(disabled["memory"]["content"], "Manual context");
        assert_eq!(
            disabled["memory"]["entries"][0]["id"],
            "legacy-project-memory"
        );
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "content": "Use pnpm" }),
            tx.clone()
        )
        .await
        .is_err());
        let first_owner = {
            let st = state.lock().await;
            st.db.get_project_memory_editor(&first).unwrap().owner
        };
        handle_request(
            state.clone(),
            "project.autoMemory.setEnabled",
            json!({ "path": first, "enabled": true, "expectedOwner": first_owner }),
            tx.clone(),
        )
        .await
        .unwrap();
        {
            let st = state.lock().await;
            st.db
                .kv_set(
                    crate::team::expert_config::MEMBER_CONFIG_NS,
                    &session.id,
                    &json!({ "presetId": "qa", "tools": ["Read"] }),
                )
                .unwrap();
        }
        let blocked_expert = handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "content": "Not authorized" }),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            blocked_expert.data.unwrap()["errorCode"],
            "TEAM_UNAUTHORIZED"
        );
        let blocked_delete = handle_request(
            state.clone(),
            "project.autoMemory.agentDelete",
            json!({ "sessionId": session.id, "boundPath": first, "id": "legacy-project-memory",
                "expectedTitle": "", "expectedContent": "Manual context" }),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            blocked_delete.data.unwrap()["errorCode"],
            "TEAM_UNAUTHORIZED"
        );
        let internal_context = handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": session.id, "boundPath": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(internal_context["memory"]["content"], "Manual context");
        {
            let st = state.lock().await;
            st.db
                .kv_delete(crate::team::expert_config::MEMBER_CONFIG_NS, &session.id)
                .unwrap();
        }
        let manually_updated = handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "id": "legacy-project-memory",
                "title": "", "content": "Manual updated", "expectedTitle": "",
                "expectedContent": "Manual context" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            manually_updated["memory"]["entries"][0]["content"],
            "Manual updated"
        );
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "id": "legacy-project-memory",
                "title": "", "content": "Stale", "expectedTitle": "",
                "expectedContent": "Manual context" }),
            tx.clone()
        )
        .await
        .is_err());
        let plan_write = handle_request(state.clone(), "project.autoMemory.agentUpsert",
            json!({ "sessionId": plan_session.id, "boundPath": first, "content": "No plan writes" }), tx.clone()).await;
        assert!(plan_write.unwrap_err().message.contains("plan mode"));
        let goal_write = handle_request(state.clone(), "project.autoMemory.agentUpsert",
            json!({ "sessionId": goal_session.id, "boundPath": first, "content": "No goal writes" }), tx.clone()).await;
        assert!(goal_write.unwrap_err().message.contains("plan mode"));
        let plan_list = handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": plan_session.id, "boundPath": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            plan_list["memory"]["entries"][0]["content"],
            "Manual updated"
        );
        assert!(handle_request(state.clone(), "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "id": 123, "content": "Should fail" }), tx.clone()).await.is_err());
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": second, "content": "Wrong project" }),
            tx.clone()
        )
        .await
        .is_err());
        let saved = handle_request(state.clone(), "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first, "title": "Stack", "content": "Use pnpm" }), tx.clone()).await.unwrap();
        assert_eq!(saved["memory"]["entries"][1]["title"], "Stack");
        let listed = handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": session.id, "boundPath": first }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(listed["memory"]["entries"][1]["content"], "Use pnpm");
        // Delete uses the exact last-read entry; a stale content or title is refused.
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.agentDelete",
            json!({ "sessionId": session.id, "boundPath": first,
                "id": listed["memory"]["entries"][1]["id"], "expectedTitle": "Stack",
                "expectedContent": "Stale" }),
            tx.clone()
        )
        .await
        .is_err());
        let deleted = handle_request(
            state.clone(),
            "project.autoMemory.agentDelete",
            json!({ "sessionId": session.id, "boundPath": first,
                "id": listed["memory"]["entries"][1]["id"], "expectedTitle": "Stack",
                "expectedContent": "Use pnpm" }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(deleted["memory"]["entries"].as_array().unwrap().len(), 1);
        // Re-create a note so disabling and reopening can prove retention.
        handle_request(
            state.clone(),
            "project.autoMemory.agentUpsert",
            json!({ "sessionId": session.id, "boundPath": first,
                "title": "Stack", "content": "Use pnpm" }),
            tx.clone(),
        )
        .await
        .unwrap();
        let wrong_session = handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": "unknown", "boundPath": first }),
            tx.clone(),
        )
        .await;
        assert!(wrong_session.is_err());
        {
            let st = state.lock().await;
            sessions::move_session_project(&st.db, &session.id, &second).unwrap();
        }
        assert!(handle_request(
            state.clone(),
            "project.autoMemory.agentList",
            json!({ "sessionId": session.id, "boundPath": first }),
            tx.clone()
        )
        .await
        .is_err());
        let owner_after = {
            let st = state.lock().await;
            st.db.get_project_memory_editor(&first).unwrap().owner
        };
        handle_request(
            state.clone(),
            "project.autoMemory.setEnabled",
            json!({ "path": first, "enabled": false, "expectedOwner": owner_after }),
            tx.clone(),
        )
        .await
        .unwrap();
        let user_view = handle_request(
            state.clone(),
            "project.memory.editor.get",
            json!({ "path": first }),
            tx,
        )
        .await
        .unwrap();
        assert_eq!(
            user_view["editor"]["memory"]["entries"][1]["content"],
            "Use pnpm"
        );
        assert_eq!(user_view["editor"]["autoRecordEnabled"], false);
        assert_eq!(
            user_view["editor"]["memory"]["entries"][0]["content"],
            "Manual updated"
        );
        drop(state);
        let reopened = AppState::open(dir.path()).unwrap();
        let persisted = reopened.db.get_project_memory_editor(&first).unwrap();
        assert!(!persisted.auto_record_enabled);
        assert_eq!(persisted.memory.entries.unwrap()[1].content, "Use pnpm");
    }
}
