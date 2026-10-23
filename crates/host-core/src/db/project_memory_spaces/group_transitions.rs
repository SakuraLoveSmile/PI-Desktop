//! Explicit project edits preserve, copy, or reject memory ownership atomically.
use super::super::{project_memory_editor, repositories};
use super::*;

impl Database {
    fn attach_group_memory_roots(
        &self,
        group: &ProjectGroupRecord,
        space: &mut MemorySpace,
        previous_space: Option<&str>,
        replaced_primary: bool,
    ) -> Result<()> {
        let id = space.project.id.clone();
        for root in &group.roots {
            if let Some(existing) = self.project_memory_space_for_path(&root.path)? {
                if existing.id != id
                    && Some(existing.id.as_str()) != previous_space
                    && !(replaced_primary && root.path == group.primary_path)
                {
                    return Err(anyhow!("project memory space conflict: selected folder already belongs to another memory project"));
                }
            }
        }
        let mut entries =
            project_memory_editor::memory_entries(&self.get_memory_space_content(&id)?);
        let mut added = false;
        for root in &group.roots {
            // Unassociated new roots may bring their existing collection. Old
            // checkout mappings need their own fresh evidence, not path reuse.
            if self.project_memory_space_for_path(&root.path)?.is_none()
                && !self.project_memory_space_path_revoked(&root.path)?
            {
                let root_group = self.project_group_for_path(&root.path)?;
                let owner = root_group
                    .filter(|group| !group.legacy)
                    .map(|group| format!("group:{}", group.id))
                    .unwrap_or_else(|| format!("path:{}", root.path));
                if self.kv_get(SOURCES, &owner)?.is_none() {
                    let incoming = self.get_project_memory_readonly(&root.path)?;
                    for mut entry in project_memory_editor::memory_entries(&incoming) {
                        if !entries.iter().any(|stored| {
                            stored.content == entry.content && stored.title == entry.title
                        }) {
                            entry.id =
                                format!("imported:{}:{}", &identity_key(&owner)[..16], entry.id);
                            entries.push(entry);
                            added = true;
                        }
                    }
                    space.imported_sources.push(owner.clone());
                    self.set_memory_value_if_changed(SOURCES, &owner, &serde_json::json!(id))?;
                }
            }
            if !space.project.paths.contains(&root.path) {
                space.project.paths.push(root.path.clone());
            }
            let previous = self
                .kv_get(CHECKOUTS, &root.path)?
                .or(self.kv_get(REVOKED, &root.path)?)
                .and_then(|value| value.as_str().map(str::to_owned));
            self.bind_unrecorded_memory_sessions(&root.path, previous.as_deref().unwrap_or(&id))?;
            if let Some(previous_space) = previous_space {
                let mut statement = self.conn.prepare_cached(
                    "SELECT s.id FROM sessions s JOIN projects p ON p.id=s.project_id WHERE p.path=?1"
                )?;
                let sessions =
                    statement.query_map(params![root.path], |row| row.get::<_, String>(0))?;
                for session in sessions {
                    let session = session?;
                    if self.project_memory_space_session(&session)?.as_deref()
                        == Some(previous_space)
                    {
                        self.set_memory_value_if_changed(
                            SESSIONS,
                            &session,
                            &serde_json::json!(id),
                        )?;
                    }
                }
            }
            self.set_memory_value_if_changed(CHECKOUTS, &root.path, &serde_json::json!(id))?;
            self.kv_delete(REVOKED, &root.path)?;
        }
        if added {
            if repositories::render_project_memory_entries(&entries).len()
                > MAX_PROJECT_MEMORY_BYTES
            {
                return Err(ProjectMemoryMigrationRequired.into());
            }
            self.set_memory_space_content(&id, &serde_json::to_value(entries)?)?;
        }
        Ok(())
    }

    /// Called inside the user's group-edit transaction, with fresh evidence
    /// prepared before acquiring the Host lock. Reads never infer this move.
    pub(crate) fn transition_project_group_memory(
        &self,
        group: &ProjectGroupRecord,
        prepared: Option<&PreparedMemoryProject>,
    ) -> Result<()> {
        let affinity = format!("explicit-group:{}", group.id);
        let group_key = identity_key(&affinity);
        // Once explicit, even a one-root group retains its logical identity.
        if let Some(id) = self
            .kv_get(REPOSITORIES, &group_key)?
            .and_then(|value| value.as_str().map(str::to_owned))
        {
            let mut space = self
                .stored_memory_space(&id)?
                .ok_or_else(|| anyhow!("project memory identity missing"))?;
            space.project.name = group.name.clone();
            space.project.primary_path = group.primary_path.clone();
            self.attach_group_memory_roots(group, &mut space, None, false)?;
            self.set_memory_value_if_changed(SPACES, &id, &serde_json::to_value(space)?)?;
            return Ok(());
        }
        if group.roots.len() < 2 {
            return Ok(());
        }
        let project = self.project_memory_space_for_path(&group.primary_path)?;
        let project = match project {
            Some(project) => Some(project),
            None => self
                .kv_get(REVOKED, &group.primary_path)?
                .and_then(|value| value.as_str().map(str::to_owned))
                .map(|id| self.stored_memory_space(&id))
                .transpose()?
                .flatten()
                .map(|space| space.project),
        };
        let Some(project) = project else {
            // An unassociated new primary is not authority to absorb an
            // independently used secondary root's live memory or history.
            for root in &group.roots {
                if self.project_memory_space_for_path(&root.path)?.is_some() {
                    return Err(anyhow!("project memory space conflict: selected folder already belongs to another memory project"));
                }
            }
            return Ok(());
        };
        let Some(prepared) =
            prepared.filter(|prepared| prepared.requested_path == group.primary_path)
        else {
            return Err(anyhow!(
                "project group edit requires fresh memory identity evidence"
            ));
        };
        let Some(mut source) = self.stored_memory_space(&project.id)? else {
            return Ok(());
        };
        // A replaced checkout or another explicit group is never authority for
        // importing its old memory, even when the selected path is unchanged.
        let physical_source = source.repository_identity == prepared.repository_identity;
        let copy_source = physical_source
            || source
                .verified_repository_identities
                .contains(&prepared.repository_identity);
        // A different explicit group can only be copied by this user edit into
        // a fresh UUID. It can never be promoted or merged through shared Git.
        let preserve_id = physical_source && prepared.primary_path == group.primary_path;
        let id = if preserve_id {
            project.id.clone()
        } else {
            Uuid::new_v4().to_string()
        };
        let mut space = MemorySpace {
            project: MemoryProject {
                id: id.clone(),
                name: group.name.clone(),
                primary_path: group.primary_path.clone(),
                paths: if preserve_id {
                    project.paths.clone()
                } else {
                    Vec::new()
                },
            },
            repository_identity: affinity,
            verified_repository_identities: vec![prepared.repository_identity.clone()],
            git_common_dir: prepared.git_common_dir.clone(),
            imported_sources: if preserve_id {
                source.imported_sources.clone()
            } else {
                Vec::new()
            },
            auto_record_enabled: copy_source && source.auto_record_enabled,
        };
        if copy_source && !preserve_id {
            if let Some(content) = self.kv_get(CONTENT, &project.id)? {
                self.set_memory_value_if_changed(CONTENT, &id, &content)?;
            }
        }
        self.attach_group_memory_roots(
            group,
            &mut space,
            (copy_source && !preserve_id).then_some(project.id.as_str()),
            !copy_source,
        )?;
        // The group record's legacy merge is only a compatibility copy. It
        // must not re-import stale pre-sharing notes over the live collection.
        let owner = format!("group:{}", group.id);
        if !space.imported_sources.contains(&owner) {
            space.imported_sources.push(owner.clone());
        }
        self.set_memory_value_if_changed(SOURCES, &owner, &serde_json::json!(id))?;
        self.set_memory_value_if_changed(SPACES, &id, &serde_json::to_value(&space)?)?;
        self.set_memory_value_if_changed(REPOSITORIES, &group_key, &serde_json::json!(id))?;
        if preserve_id {
            self.kv_delete(REPOSITORIES, &identity_key(&prepared.repository_identity))?;
        } else if copy_source {
            source
                .project
                .paths
                .retain(|path| !group.roots.iter().any(|root| &root.path == path));
            self.set_memory_value_if_changed(SPACES, &project.id, &serde_json::to_value(source)?)?;
        }
        Ok(())
    }
}
