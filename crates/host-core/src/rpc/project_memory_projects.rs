//! Memory associations used for presentation and recall, never tool containment.
use super::*;
use crate::db::{Database, MemoryProject};
use crate::project_memory_owner::{self, PreparedMemoryProject};

pub(super) fn register(
    db: &Database,
    path: Option<&str>,
    prepared: Option<&PreparedMemoryProject>,
) -> Result<Option<MemoryProject>, JsonRpcError> {
    let project = match prepared {
        Some(prepared) => db.ensure_project_memory_space(prepared).map(Some),
        None => path
            .map(|path| db.ensure_explicit_group_memory_space(path))
            .transpose()
            .map(Option::flatten),
    }
    .map_err(|error| {
        rpc_err(
            1008,
            error.to_string(),
            if error.is::<crate::db::ProjectMemoryMigrationRequired>() {
                "PROJECT_MEMORY_MIGRATION_REQUIRED"
            } else {
                "PROJECT_MEMORY_UNAVAILABLE"
            },
        )
    })?;
    if project.is_none() {
        if let Some(path) = path {
            db.clear_project_memory_space_path(path)
                .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            if Path::new(path).exists()
                && db
                    .project_memory_space_path_revoked(path)
                    .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
            {
                return Err(rpc_err(
                    1008,
                    "checkout identity unavailable; original project history remains preserved",
                    "PROJECT_CHANGED",
                ));
            }
        }
    }
    Ok(project)
}

pub(super) async fn list(state: Arc<Mutex<AppState>>) -> Result<Value, JsonRpcError> {
    let groups = {
        let st = state.lock().await;
        st.db
            .list_project_groups()
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
    };
    let mut validated = std::collections::HashSet::new();
    let mut unavailable = std::collections::HashSet::new();
    for group in &groups {
        if validated.contains(&group.primary_path) {
            continue;
        }
        // Git subprocesses run outside both the Host mutex and SQLite transactions.
        let prepared = project_memory_owner::prepare(&group.primary_path).await;
        let st = state.lock().await;
        match register(&st.db, Some(&group.primary_path), prepared.as_ref()) {
            Ok(Some(project)) => {
                if let Some(prepared) = prepared {
                    validated.extend(
                        prepared
                            .paths
                            .into_iter()
                            .filter(|path| project.paths.contains(path)),
                    );
                }
            }
            Ok(None) => {
                if Path::new(&group.primary_path).exists() {
                    unavailable.insert(group.primary_path.clone());
                }
            }
            Err(_) => {
                unavailable.insert(group.primary_path.clone());
                tracing::warn!(
                    "shared project memory needs review; retaining separate project entries"
                );
            }
        }
    }
    let mut result = Vec::with_capacity(groups.len());
    for group in groups {
        let mut row = serde_json::to_value(&group)
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
        if !unavailable.contains(&group.primary_path) {
            let st = state.lock().await;
            if let Some(project) = st
                .db
                .project_memory_space_for_path(&group.primary_path)
                .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
            {
                row["memoryProject"] = serde_json::to_value(project)
                    .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            }
        }
        result.push(row);
    }
    Ok(json!({"groups": result}))
}

pub(super) async fn group_memory(
    state: Arc<Mutex<AppState>>,
    params: Value,
    writing: bool,
) -> Result<Value, JsonRpcError> {
    let id = params
        .get("groupId")
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, "groupId required", "INVALID_PARAMS"))?;
    let path = {
        let st = state.lock().await;
        st.db
            .list_project_groups()
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
            .into_iter()
            .find(|group| group.id == id)
            .ok_or_else(|| rpc_err(1007, "project not found", "NOT_FOUND"))?
            .primary_path
    };
    let prepared = project_memory_owner::prepare(&path).await;
    let st = state.lock().await;
    if st
        .db
        .project_group_for_path(&path)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
        .is_none_or(|group| group.id != id)
    {
        return Err(rpc_err(
            1008,
            "project changed; reload before saving",
            "PROJECT_CHANGED",
        ));
    }
    let project = register(&st.db, Some(&path), prepared.as_ref())?;
    let memory = if writing {
        let entries = params
            .get("entries")
            .ok_or_else(|| rpc_err(1002, "entries required", "INVALID_PARAMS"))?;
        project_auto_memory::ensure_legacy_write_allowed(&st.db, &path)?;
        match project {
            Some(project) => st.db.set_memory_space_content(&project.id, entries),
            None => st.db.set_project_group_memory(id, entries),
        }
    } else {
        match project {
            Some(project) => st.db.get_memory_space_content(&project.id),
            None => st.db.get_project_group_memory(id),
        }
    }
    .map_err(|error| rpc_err(1002, error.to_string(), "INVALID_PARAMS"))?;
    Ok(json!({"memory": memory}))
}

pub(super) fn session_value(
    db: &Database,
    session: &sessions::SessionSummary,
) -> Result<Value, JsonRpcError> {
    let mut value = serde_json::to_value(session)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
    if let Some(id) = db
        .project_memory_space_session(&session.id)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
    {
        value["memoryProjectId"] = json!(id);
    }
    Ok(value)
}

pub(super) fn session_detail_value(
    db: &Database,
    session: &sessions::SessionDetail,
) -> Result<Value, JsonRpcError> {
    let mut value = serde_json::to_value(session)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
    if let Some(id) = db
        .project_memory_space_session(&session.summary.id)
        .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
    {
        value["memoryProjectId"] = json!(id);
    }
    Ok(value)
}
