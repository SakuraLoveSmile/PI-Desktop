//! On-demand historical context, scoped by the caller's host-owned project.
use super::*;
use crate::db::Database;

fn field<'a>(params: &'a Value, name: &str) -> Result<&'a str, JsonRpcError> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| rpc_err(1002, format!("{name} required"), "INVALID_PARAMS"))
}

fn scope(db: &Database, params: &Value) -> Result<Vec<String>, JsonRpcError> {
    let session_id = field(params, "sessionId")?;
    crate::team::planning::validate_tool(db, session_id, "ProjectHistory").map_err(team_rpc_err)?;
    crate::team::expert_config::validate_tool(db, session_id, "ProjectHistory")
        .map_err(team_rpc_err)?;
    let caller = sessions::get_session(db, session_id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .ok_or_else(|| rpc_err(1007, "session not found", "SESSION_NOT_FOUND"))?;
    let path = caller
        .summary
        .project_path
        .ok_or_else(|| rpc_err(1002, "session has no project", "INVALID_PARAMS"))?;
    if crate::db::canonical_project_path(field(params, "boundPath")?)
        != crate::db::canonical_project_path(&path)
    {
        return Err(rpc_err(
            1008,
            "session project changed",
            "SESSION_PROJECT_CHANGED",
        ));
    }
    let group = db
        .project_group_for_path(&path)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
    Ok(group
        .map(|g| g.roots.into_iter().map(|r| r.path).collect())
        .unwrap_or_else(|| vec![path]))
}

fn query(db: &Database, method: &str, params: &Value) -> Result<Value, JsonRpcError> {
    let legacy_roots = scope(db, params)?;
    let memory_project = db
        .project_memory_space_session(field(params, "sessionId")?)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
    let roots = if let Some(id) = &memory_project {
        db.project_memory_space_paths(id)
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
    } else {
        legacy_roots
    };
    let search_query = match params.get("query") {
        None => "",
        Some(Value::String(s)) => s.trim(),
        _ => return Err(rpc_err(1002, "query must be a string", "INVALID_PARAMS")),
    };
    if search_query.chars().count() > 500 {
        return Err(rpc_err(
            1002,
            "query exceeds 500 characters",
            "INVALID_PARAMS",
        ));
    }
    if method == "project.history.search" {
        if search_query.is_empty() {
            return Err(rpc_err(1002, "query required", "INVALID_PARAMS"));
        }
        let limit = match params.get("limit") {
            None => 10,
            Some(v) => v
                .as_u64()
                .filter(|n| (1..=20).contains(n))
                .ok_or_else(|| rpc_err(1002, "limit must be 1–20", "INVALID_PARAMS"))?
                as usize,
        };
        let mut page = crate::session_search::search_with_memory_scope(
            db,
            search_query,
            0,
            Some(&roots),
            memory_project.as_deref(),
        )
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
        let has_more = page.next_offset.is_some() || page.hits.len() > limit;
        page.hits.truncate(limit);
        let hits: Vec<Value> = page
            .hits
            .into_iter()
            .map(|hit| {
                json!({
                    "sessionId": hit.session.id, "title": hit.session.title,
                    "projectPath": hit.session.project_path, "messageCount": hit.message_count,
                    "matches": hit.matches,
                })
            })
            .collect();
        return Ok(json!({"hits": hits, "hasMore": has_more}));
    }
    let target_id = field(params, "targetSessionId")?;
    if let Some(id) = &memory_project {
        if db
            .project_memory_space_session(target_id)
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
            .as_ref()
            != Some(id)
        {
            return Err(rpc_err(
                1007,
                "history source not found in this project",
                "NOT_FOUND",
            ));
        }
    }
    let target = sessions::get_session(db, target_id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .filter(|s| {
            s.summary
                .project_path
                .as_ref()
                .is_some_and(|p| roots.contains(p))
        })
        .ok_or_else(|| {
            rpc_err(
                1007,
                "history source not found in this project",
                "NOT_FOUND",
            )
        })?;
    let message_id = field(params, "messageId")?;
    let context = crate::session_search::context(db, target_id, message_id, "around", search_query)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .ok_or_else(|| rpc_err(1007, "message not found", "NOT_FOUND"))?;
    let messages: Vec<_> = context
        .messages
        .into_iter()
        .filter(|m| matches!(m.role.as_str(), "user" | "assistant"))
        .collect();
    let position = messages
        .iter()
        .position(|m| m.id == message_id)
        .ok_or_else(|| {
            rpc_err(
                1007,
                "message is not user or assistant context",
                "NOT_FOUND",
            )
        })?;
    let start = position.saturating_sub(2);
    let end = (position + 3).min(messages.len());
    let mut truncated =
        context.has_more_before || context.has_more_after || start > 0 || end < messages.len();
    let bounded: Vec<_> = messages
        .into_iter()
        .skip(start)
        .take(end - start)
        .map(|mut m| {
            if m.content.chars().count() > 2000 {
                m.content = m.content.chars().take(2000).collect();
                truncated = true;
            }
            json!({"id": m.id, "role": m.role, "createdAt": m.created_at, "content": m.content})
        })
        .collect();
    Ok(
        json!({"sessionId": target_id, "title": target.summary.title,
        "messages": bounded, "truncated": truncated}),
    )
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, JsonRpcError> {
    // Authenticate the caller before doing unlocked Git discovery.
    let (session_id, path) = {
        let st = state.lock().await;
        scope(&st.db, &params)?;
        let session_id = field(&params, "sessionId")?.to_owned();
        let path = field(&params, "boundPath")?.to_owned();
        (session_id, path)
    };
    let prepared = crate::project_memory_owner::prepare(&path).await;
    let st = state.lock().await;
    scope(&st.db, &params)?;
    match project_memory_projects::register(&st.db, Some(&path), prepared.as_ref()) {
        Ok(Some(project)) => {
            st.db
                .bind_project_memory_space_session(&session_id, &project.id)
                .map_err(|_| rpc_err(1008, "session project changed", "PROJECT_CHANGED"))?;
        }
        Ok(None) => {
            if Path::new(&path).exists()
                && st
                    .db
                    .project_memory_space_session(&session_id)
                    .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
                    .is_some()
            {
                return Err(rpc_err(1008, "session project changed", "PROJECT_CHANGED"));
            }
        }
        Err(error) => return Err(error),
    }
    query(&st.db, method, &params)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(db: &Database, path: &str) -> String {
        sessions::create_session(
            db,
            Some("History".into()),
            Some("agent".into()),
            None,
            None,
            Some(path.into()),
        )
        .unwrap()
        .id
    }
    fn append(db: &Database, id: &str, message_id: &str, text: &str) {
        let message: UiMessage = serde_json::from_value(json!({"id": message_id,
            "role": "user", "content": text, "createdAt": "2026-10-08T00:00:00Z"}))
        .unwrap();
        sessions::append_message(db, id, &message, None).unwrap();
    }

    #[test]
    fn history_user_path_search_read_restart_and_project_isolation() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("pi.sqlite");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let path = first.to_str().unwrap();
        let other_path = second.to_str().unwrap();
        let db = Database::open(&database).unwrap();
        let old = session(&db, path);
        let caller = session(&db, path);
        append(
            &db,
            &old,
            "saved-note",
            "Use pnpm and retain the verification evidence.",
        );
        // More than one global page of unrelated hits cannot crowd out this project.
        for n in 0..35 {
            let other = session(&db, other_path);
            append(
                &db,
                &other,
                &format!("unrelated-{n}"),
                "pnpm unrelated private context",
            );
        }
        drop(db);
        let db = Database::open(&database).unwrap();
        let hits = query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": path, "query": "pnpm", "limit": 10}),
        )
        .unwrap();
        assert_eq!(hits["hits"].as_array().unwrap().len(), 1);
        assert_eq!(hits["hits"][0]["sessionId"], old);
        let read = query(
            &db,
            "project.history.context",
            &json!({"sessionId": caller,
            "boundPath": path, "targetSessionId": old, "messageId": "saved-note"}),
        )
        .unwrap();
        assert_eq!(
            read["messages"][0]["content"],
            "Use pnpm and retain the verification evidence."
        );
        let other = session(&db, other_path);
        append(&db, &other, "private", "private");
        assert!(query(
            &db,
            "project.history.context",
            &json!({"sessionId": caller,
            "boundPath": path, "targetSessionId": other, "messageId": "private"})
        )
        .is_err());
        assert!(query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": other_path, "query": "pnpm"})
        )
        .is_err());
    }

    #[test]
    fn group_roots_share_history_but_detached_and_deleted_sources_do_not() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("pi.sqlite")).unwrap();
        let paths: Vec<String> = ["root", "assets", "outside"]
            .iter()
            .map(|p| {
                let path = temp.path().join(p);
                std::fs::create_dir_all(&path).unwrap();
                path.to_str().unwrap().to_string()
            })
            .collect();
        db.create_project_group("Site", &paths[..2]).unwrap();
        let caller = session(&db, &paths[0]);
        let sibling = session(&db, &paths[1]);
        append(&db, &sibling, "group-note", "项目约定");
        let result = query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": paths[0], "query": "约"}),
        )
        .unwrap();
        assert_eq!(result["hits"][0]["sessionId"], sibling);
        db.conn()
            .execute(
                "UPDATE sessions SET deleted_at = 1 WHERE id = ?1",
                [&sibling],
            )
            .unwrap();
        let result = query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": paths[0], "query": "约"}),
        )
        .unwrap();
        assert!(result["hits"].as_array().unwrap().is_empty());
        assert!(query(
            &db,
            "project.history.context",
            &json!({"sessionId": caller,
            "boundPath": paths[0], "targetSessionId": sibling, "messageId": "group-note"})
        )
        .is_err());
    }

    #[test]
    fn history_limits_and_unicode_context_are_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("pi.sqlite")).unwrap();
        let path = temp.path().to_str().unwrap();
        let caller = session(&db, path);
        append(&db, &caller, "long", &"项目记忆".repeat(4000));
        let params = json!({"sessionId": caller, "boundPath": path, "targetSessionId": caller,
            "messageId": "long"});
        let result = query(&db, "project.history.context", &params).unwrap();
        assert!(result["truncated"].as_bool().unwrap());
        assert_eq!(
            result["messages"][0]["content"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            2000
        );
        assert!(query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": path, "query": "项目", "limit": 0})
        )
        .is_err());
        assert!(query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": path, "query": "x".repeat(501)})
        )
        .is_err());
    }

    #[test]
    fn history_cannot_bypass_confirmed_expert_tool_subset() {
        let temp = tempfile::tempdir().unwrap();
        let db = Database::open(&temp.path().join("pi.sqlite")).unwrap();
        let path = temp.path().to_str().unwrap();
        let caller = session(&db, path);
        append(&db, &caller, "note", "pnpm");
        db.kv_set(
            crate::team::expert_config::MEMBER_CONFIG_NS,
            &caller,
            &json!({"presetId": "reviewer", "tools": ["Read", "Grep"]}),
        )
        .unwrap();
        let failure = query(
            &db,
            "project.history.search",
            &json!({"sessionId": caller,
            "boundPath": path, "query": "pnpm"}),
        )
        .unwrap_err();
        assert_eq!(failure.data.unwrap()["errorCode"], "TEAM_UNAUTHORIZED");
    }
}

#[cfg(test)]
#[path = "project_worktree_history_tests.rs"]
mod project_worktree_history_tests;
