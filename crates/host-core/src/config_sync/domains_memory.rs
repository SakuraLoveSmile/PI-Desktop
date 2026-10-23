//! Portable memory content uses existing mapped project identities. Memory
//! space identities, checkout bindings and recording preferences stay local.
use super::*;
use crate::db::{Database, MemoryProject};
use std::collections::HashSet;

fn shared_entity(
    st: &mut AppState,
    space: &MemoryProject,
    identities: &ProjectIdentityOverrides,
) -> Result<PortableEntity> {
    // An imported logical mapping may target any checkout in this space. Keep
    // that portable identity instead of inventing a second entity for its main.
    let mut mapped_group = None;
    let mut mapped_project = None;
    let mut representative = None;
    for path in &space.paths {
        if st
            .db
            .project_memory_space_for_path(path)?
            .is_none_or(|current| current.id != space.id)
        {
            continue;
        }
        if representative.is_none() || path == &space.primary_path {
            representative = Some(path);
        }
        mapped_group = mapped_group.or_else(|| identities.group_ids.get(path));
        mapped_project = mapped_project.or_else(|| identities.project_ids.get(path));
    }
    let (logical_id, is_group) = if let Some(id) = mapped_group {
        (id.clone(), true)
    } else if let Some(id) = mapped_project {
        (id.clone(), false)
    } else {
        let (project_id, group_id, _) = project_scope(
            st,
            representative.unwrap_or(&space.primary_path),
            identities,
        )?;
        match group_id {
            Some(id) => (id, true),
            None => (project_id, false),
        }
    };
    let memory = st.db.get_memory_space_content(&space.id)?;
    let payload = if is_group {
        json!({
            "projectGroupLogicalId": logical_id,
            "projectGroupName": space.name,
            "memory": memory,
        })
    } else {
        json!({"projectLogicalId": logical_id, "memory": memory})
    };
    Ok(entity(
        DOMAIN_MEMORY,
        format!("memory:{logical_id}"),
        space.name.clone(),
        payload,
        false,
        true,
        true,
        Vec::new(),
    ))
}

pub(crate) fn capture_memory(
    st: &mut AppState,
    identities: &ProjectIdentityOverrides,
) -> Result<Vec<PortableEntity>> {
    let mut result = Vec::new();
    let mut shared = HashSet::new();
    for project in st.db.list_projects()? {
        if let Some(space) = st.db.project_memory_space_for_path(&project.path)? {
            if shared.insert(space.id.clone()) {
                result.push(shared_entity(st, &space, identities)?);
            }
            continue;
        }
        let memory = st.db.get_project_memory(&project.path)?;
        if memory.content.trim().is_empty() && memory.entries.is_none() {
            continue;
        }
        let (project_id, group_id, root_position) = project_scope(st, &project.path, identities)?;
        let mut payload = json!({
            "projectLogicalId": project_id.clone(),
            "memory": memory,
        });
        if let Some(object) = payload.as_object_mut() {
            if let Some(group_id) = group_id {
                object.insert("projectGroupLogicalId".into(), Value::String(group_id));
            }
            if let Some(position) = root_position {
                object.insert("projectRootPosition".into(), json!(position));
            }
        }
        result.push(entity(
            DOMAIN_MEMORY,
            format!("memory:{project_id}"),
            project.name,
            payload,
            false,
            true,
            true,
            Vec::new(),
        ));
    }
    for group in st.db.list_project_groups()? {
        if group.legacy {
            continue;
        }
        if let Some(space) = st.db.project_memory_space_for_path(&group.primary_path)? {
            if shared.insert(space.id.clone()) {
                result.push(shared_entity(st, &space, identities)?);
            }
            continue;
        }
        let memory = st.db.get_project_group_memory(&group.id)?;
        if memory.content.trim().is_empty() && memory.entries.is_none() {
            continue;
        }
        let logical_id = project_group_logical_id(st, &group)?;
        result.push(entity(
            DOMAIN_MEMORY,
            format!("memory:{logical_id}"),
            group.name.clone(),
            json!({
                "projectGroupLogicalId": logical_id,
                "projectGroupName": group.name,
                "memory": memory,
            }),
            false,
            true,
            true,
            Vec::new(),
        ));
    }
    Ok(result)
}

/// Only routes an already associated local folder. Portable payloads cannot
/// create/rebind a memory space or change its device-local recording opt-in.
pub(crate) fn apply_shared_memory(
    db: &Database,
    path: &str,
    memory: Option<&Value>,
    deleted: bool,
) -> Result<bool> {
    let Some(space) = db.project_memory_space_for_path(path)? else {
        return Ok(false);
    };
    if deleted {
        db.set_memory_space_content(&space.id, &json!([]))?;
    } else if let Some(memory) = memory {
        if let Some(entries) = memory.get("entries") {
            db.set_memory_space_content(&space.id, entries)?;
        } else {
            db.set_memory_space_legacy_content(
                &space.id,
                memory
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )?;
        }
    }
    Ok(true)
}
