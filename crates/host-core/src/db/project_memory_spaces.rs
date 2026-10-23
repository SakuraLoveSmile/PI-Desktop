//! Versioned memory identities and checkout associations. No workspace roots.
use super::*;
use crate::project_memory_owner::PreparedMemoryProject;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

mod group_transitions;

const SPACES: &str = "projectMemorySpaces/v1";
const REPOSITORIES: &str = "projectMemoryRepositories/v1";
const CHECKOUTS: &str = "projectMemoryCheckouts/v1";
const SESSIONS: &str = "projectMemorySessions/v1";
const CONTENT: &str = "projectMemorySpaceContent/v1";
const REVOKED: &str = "projectMemoryRevokedCheckouts/v1";
const SOURCES: &str = "projectMemoryImportedSources/v1";

#[derive(Debug, thiserror::Error)]
#[error("Existing project memories exceed the shared 32 KiB limit. Original collections are preserved; shorten or export them before combining.")]
pub(crate) struct ProjectMemoryMigrationRequired;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryProject {
    pub id: String,
    pub name: String,
    pub primary_path: String,
    pub paths: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemorySpace {
    #[serde(flatten)]
    project: MemoryProject,
    repository_identity: String,
    #[serde(default)]
    verified_repository_identities: Vec<String>,
    git_common_dir: String,
    #[serde(default)]
    imported_sources: Vec<String>,
    auto_record_enabled: bool,
}

fn identity_key(identity: &str) -> String {
    hex::encode(Sha256::digest(identity.as_bytes()))
}

impl Database {
    fn bind_unrecorded_memory_sessions(&self, path: &str, space_id: &str) -> Result<()> {
        let mut statement = self.conn.prepare_cached(
            "SELECT s.id FROM sessions s JOIN projects p ON p.id = s.project_id WHERE p.path = ?1",
        )?;
        let rows = statement.query_map(params![path], |row| row.get::<_, String>(0))?;
        for session_id in rows {
            let session_id = session_id?;
            if self.project_memory_space_session(&session_id)?.is_none() {
                self.set_memory_value_if_changed(
                    SESSIONS,
                    &session_id,
                    &serde_json::json!(space_id),
                )?;
            }
        }
        Ok(())
    }

    fn set_memory_value_if_changed(&self, namespace: &str, key: &str, value: &Value) -> Result<()> {
        if self.kv_get(namespace, key)?.as_ref() != Some(value) {
            self.kv_set(namespace, key, value)?;
        }
        Ok(())
    }
    fn stored_memory_space(&self, id: &str) -> Result<Option<MemorySpace>> {
        self.kv_get(SPACES, id)?
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }

    pub(crate) fn project_memory_space_for_path(
        &self,
        path: &str,
    ) -> Result<Option<MemoryProject>> {
        let Some(path) = canonical_project_path(path) else {
            return Ok(None);
        };
        let Some(id) = self
            .kv_get(CHECKOUTS, &path)?
            .and_then(|value| value.as_str().map(str::to_owned))
        else {
            return Ok(None);
        };
        Ok(self.stored_memory_space(&id)?.map(|space| space.project))
    }

    pub(crate) fn project_memory_space_paths(&self, id: &str) -> Result<Vec<String>> {
        Ok(self
            .stored_memory_space(id)?
            .map(|space| space.project.paths)
            .unwrap_or_default())
    }

    pub(crate) fn clear_project_memory_space_path(&self, path: &str) -> Result<()> {
        if let Some(path) = canonical_project_path(path) {
            if let Some(previous) = self
                .kv_get(CHECKOUTS, &path)?
                .and_then(|value| value.as_str().map(str::to_owned))
            {
                self.bind_unrecorded_memory_sessions(&path, &previous)?;
                self.kv_delete(CHECKOUTS, &path)?;
                self.set_memory_value_if_changed(REVOKED, &path, &serde_json::json!(previous))?;
            }
        }
        Ok(())
    }

    pub(crate) fn project_memory_space_path_revoked(&self, path: &str) -> Result<bool> {
        let path = canonical_project_path(path).ok_or_else(|| anyhow!("project path required"))?;
        Ok(self.kv_get(REVOKED, &path)?.is_some())
    }

    pub(crate) fn project_memory_space_session(&self, session_id: &str) -> Result<Option<String>> {
        Ok(self
            .kv_get(SESSIONS, session_id)?
            .and_then(|value| value.as_str().map(str::to_owned)))
    }

    pub(crate) fn bind_project_memory_space_session(
        &self,
        session_id: &str,
        space_id: &str,
    ) -> Result<()> {
        if self.stored_memory_space(space_id)?.is_none() {
            return Err(anyhow!("project memory identity not found"));
        }
        if self
            .project_memory_space_session(session_id)?
            .is_some_and(|current| current != space_id)
        {
            return Err(anyhow!(
                "session memory project changed; move or reopen this session before continuing"
            ));
        }
        self.set_memory_value_if_changed(SESSIONS, session_id, &serde_json::json!(space_id))
    }

    /// Only an explicit session move may replace the memory identity captured
    /// when that conversation was created or first migrated.
    pub(crate) fn replace_project_memory_space_session(
        &self,
        session_id: &str,
        space_id: Option<&str>,
    ) -> Result<()> {
        match space_id {
            Some(id) => {
                if self.stored_memory_space(id)?.is_none() {
                    return Err(anyhow!("project memory identity not found"));
                }
                self.set_memory_value_if_changed(SESSIONS, session_id, &serde_json::json!(id))
            }
            None => self.kv_delete(SESSIONS, session_id),
        }
    }

    fn explicit_memory_group(&self, group: &ProjectGroupRecord) -> Result<bool> {
        Ok(!group.legacy
            && (group.roots.len() > 1
                || self
                    .kv_get(
                        REPOSITORIES,
                        &identity_key(&format!("explicit-group:{}", group.id)),
                    )?
                    .is_some()))
    }

    /// Explicit group membership is authoritative even for non-Git roots. It
    /// identifies memory only and never changes filesystem/tool permissions.
    pub(crate) fn ensure_explicit_group_memory_space(
        &self,
        path: &str,
    ) -> Result<Option<MemoryProject>> {
        let Some(group) = self.project_group_for_path(path)? else {
            return Ok(None);
        };
        if !self.explicit_memory_group(&group)? {
            return Ok(None);
        }
        let prepared = PreparedMemoryProject {
            requested_path: canonical_project_path(path)
                .ok_or_else(|| anyhow!("project path required"))?,
            primary_path: group.primary_path.clone(),
            git_common_dir: String::new(),
            repository_identity: format!("explicit-group:{}", group.id),
            paths: group.roots.iter().map(|root| root.path.clone()).collect(),
        };
        self.ensure_project_memory_space(&prepared).map(Some)
    }

    /// Receives fresh Git evidence or an explicit Host group projection. All
    /// source imports and aliases commit together; overflow rolls back fully.
    pub(crate) fn ensure_project_memory_space(
        &self,
        prepared: &PreparedMemoryProject,
    ) -> Result<MemoryProject> {
        let transaction = self.conn.unchecked_transaction()?;
        let primary_group = self.project_group_for_path(&prepared.primary_path)?;
        // An explicit multi-root group remains a deliberate product boundary.
        // Do not take roots belonging to a different such group into this space.
        let requested_group = self.project_group_for_path(&prepared.requested_path)?;
        let primary_boundary = match primary_group.as_ref() {
            Some(group) if self.explicit_memory_group(group)? => Some(group),
            _ => None,
        };
        let requested_boundary = match requested_group.as_ref() {
            Some(group) if self.explicit_memory_group(group)? => Some(group),
            _ => None,
        };
        let boundary = requested_boundary.or(primary_boundary);
        let allowed_group = boundary.map(|group| group.id.as_str());
        let affinity = boundary
            .map(|group| format!("explicit-group:{}", group.id))
            .unwrap_or_else(|| prepared.repository_identity.clone());
        let separate_boundary = requested_boundary
            .is_some_and(|group| primary_boundary.is_none_or(|primary| primary.id != group.id));
        let key = identity_key(&affinity);
        let existing = self
            .kv_get(REPOSITORIES, &key)?
            .and_then(|value| value.as_str().map(str::to_owned));
        let mut space = if let Some(id) = existing {
            self.stored_memory_space(&id)?
                .ok_or_else(|| anyhow!("project memory identity missing"))?
        } else {
            MemorySpace {
                project: MemoryProject {
                    id: Uuid::new_v4().to_string(),
                    name: boundary
                        .or(primary_group.as_ref())
                        .map(|group| group.name.clone())
                        .unwrap_or_else(|| project_display_name(&prepared.primary_path)),
                    primary_path: boundary
                        .map(|group| group.primary_path.clone())
                        .unwrap_or_else(|| prepared.primary_path.clone()),
                    paths: Vec::new(),
                },
                repository_identity: affinity.clone(),
                verified_repository_identities: Vec::new(),
                git_common_dir: prepared.git_common_dir.clone(),
                imported_sources: Vec::new(),
                auto_record_enabled: self.get_auto_record_enabled_readonly(
                    boundary
                        .map(|group| group.primary_path.as_str())
                        .unwrap_or(&prepared.primary_path),
                )?,
            }
        };
        if space.repository_identity != affinity {
            return Err(anyhow!("project memory repository changed"));
        }
        let mut entries = super::project_memory_editor::memory_entries(
            &self.get_memory_space_content(&space.project.id)?,
        );
        let mut changed = false;
        let mut candidate_paths = prepared.paths.clone();
        if let Some(group) = boundary {
            for root in &group.roots {
                if !candidate_paths.contains(&root.path) {
                    candidate_paths.push(root.path.clone());
                }
            }
        }
        for path in &candidate_paths {
            let group = self.project_group_for_path(path)?;
            if separate_boundary
                && group
                    .as_ref()
                    .is_none_or(|group| Some(group.id.as_str()) != allowed_group)
            {
                continue;
            }
            if let Some(group) = group.as_ref() {
                if self.explicit_memory_group(group)? && Some(group.id.as_str()) != allowed_group {
                    continue;
                }
            }
            let owner = match group.as_ref().filter(|group| !group.legacy) {
                Some(group) => format!("group:{}", group.id),
                None => format!("path:{path}"),
            };
            let source_space = self
                .kv_get(SOURCES, &owner)?
                .and_then(|value| value.as_str().map(str::to_owned));
            let previous_path_space = self
                .kv_get(CHECKOUTS, path)?
                .or(self.kv_get(REVOKED, path)?)
                .and_then(|value| value.as_str().map(str::to_owned));
            let source_is_current = source_space
                .as_deref()
                .is_none_or(|id| id == space.project.id)
                && previous_path_space
                    .as_deref()
                    .is_none_or(|id| id == space.project.id);
            if !space.imported_sources.contains(&owner) && source_is_current {
                let memory = self.get_project_memory_readonly(path)?;
                for entry in super::project_memory_editor::memory_entries(&memory) {
                    if entries.iter().any(|stored| {
                        stored.content == entry.content
                            && (stored.title == entry.title
                                || stored.title.ends_with(&format!("] {}", entry.title)))
                    }) {
                        continue;
                    }
                    let source = &identity_key(&owner)[..16];
                    let id = format!("imported:{source}:{}", entry.id);
                    let title = if path == &prepared.primary_path {
                        entry.title
                    } else {
                        format!("[{}] {}", path, entry.title)
                    };
                    entries.push(ProjectMemoryEntryRecord {
                        id,
                        title,
                        content: entry.content,
                    });
                    changed = true;
                }
                space.imported_sources.push(owner);
                self.set_memory_value_if_changed(
                    SOURCES,
                    space
                        .imported_sources
                        .last()
                        .ok_or_else(|| anyhow!("memory import source missing"))?,
                    &serde_json::json!(space.project.id),
                )?;
            }
            if !space.project.paths.contains(path) {
                space.project.paths.push(path.clone());
            }
            let previous = self
                .kv_get(CHECKOUTS, path)?
                .or(self.kv_get(REVOKED, path)?)
                .and_then(|value| value.as_str().map(str::to_owned));
            self.bind_unrecorded_memory_sessions(
                path,
                previous.as_deref().unwrap_or(&space.project.id),
            )?;
            self.set_memory_value_if_changed(
                CHECKOUTS,
                path,
                &serde_json::json!(space.project.id),
            )?;
            self.kv_delete(REVOKED, path)?;
        }
        if !space.project.paths.contains(&prepared.requested_path) {
            return Err(anyhow!("checkout is outside this memory project"));
        }
        if super::repositories::render_project_memory_entries(&entries).len()
            > MAX_PROJECT_MEMORY_BYTES
        {
            return Err(ProjectMemoryMigrationRequired.into());
        }
        if changed {
            self.set_memory_space_content(&space.project.id, &serde_json::to_value(&entries)?)?;
        }
        if let Some(group) = boundary {
            space.project.name = group.name.clone();
        }
        space.project.primary_path = boundary
            .map(|group| group.primary_path.clone())
            .unwrap_or_else(|| prepared.primary_path.clone());
        if !prepared.git_common_dir.is_empty() {
            space.git_common_dir = prepared.git_common_dir.clone();
            if !space
                .verified_repository_identities
                .contains(&prepared.repository_identity)
            {
                space
                    .verified_repository_identities
                    .push(prepared.repository_identity.clone());
            }
        }
        self.set_memory_value_if_changed(
            SPACES,
            &space.project.id,
            &serde_json::to_value(&space)?,
        )?;
        self.set_memory_value_if_changed(REPOSITORIES, &key, &serde_json::json!(space.project.id))?;
        let project = space.project;
        transaction.commit()?;
        Ok(project)
    }

    pub(crate) fn get_memory_space_content(&self, id: &str) -> Result<ProjectMemoryRecord> {
        let value = self.kv_get(CONTENT, id)?;
        let entries = value
            .as_ref()
            .and_then(|value| value.get("entries"))
            .map(super::repositories::normalize_project_memory_entries)
            .transpose()?;
        Ok(ProjectMemoryRecord {
            content: value
                .as_ref()
                .and_then(|value| value.get("content"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            entries: if value.is_some() {
                entries
            } else {
                Some(Vec::new())
            },
            updated_at: value
                .as_ref()
                .and_then(|value| value.get("updatedAt"))
                .and_then(Value::as_i64)
                .unwrap_or_default(),
        })
    }

    pub(crate) fn set_memory_space_content(
        &self,
        id: &str,
        raw: &Value,
    ) -> Result<ProjectMemoryRecord> {
        let entries = super::repositories::normalize_project_memory_entries(raw)?;
        let content = super::repositories::render_project_memory_entries(&entries);
        if content.len() > MAX_PROJECT_MEMORY_BYTES {
            return Err(anyhow!(
                "project memory exceeds {MAX_PROJECT_MEMORY_BYTES} bytes"
            ));
        }
        let updated_at = now_ms();
        self.kv_set(
            CONTENT,
            id,
            &serde_json::json!({"content": content, "entries":entries, "updatedAt":updated_at}),
        )?;
        Ok(ProjectMemoryRecord {
            content,
            entries: Some(entries),
            updated_at,
        })
    }

    pub(crate) fn set_memory_space_legacy_content(
        &self,
        id: &str,
        content: &str,
    ) -> Result<ProjectMemoryRecord> {
        if content.len() > MAX_PROJECT_MEMORY_BYTES {
            return Err(anyhow!(
                "project memory exceeds {MAX_PROJECT_MEMORY_BYTES} bytes"
            ));
        }
        let updated_at = now_ms();
        self.kv_set(
            CONTENT,
            id,
            &serde_json::json!({"content":content,"updatedAt":updated_at}),
        )?;
        Ok(ProjectMemoryRecord {
            content: content.to_owned(),
            entries: None,
            updated_at,
        })
    }

    pub(crate) fn get_memory_space_auto_record_enabled(&self, id: &str) -> Result<bool> {
        Ok(self
            .stored_memory_space(id)?
            .ok_or_else(|| anyhow!("project memory identity not found"))?
            .auto_record_enabled)
    }

    pub(crate) fn set_memory_space_auto_record_enabled(
        &self,
        id: &str,
        enabled: bool,
    ) -> Result<bool> {
        let mut space = self
            .stored_memory_space(id)?
            .ok_or_else(|| anyhow!("project memory identity not found"))?;
        space.auto_record_enabled = enabled;
        self.set_memory_value_if_changed(SPACES, id, &serde_json::to_value(space)?)?;
        Ok(enabled)
    }
}
