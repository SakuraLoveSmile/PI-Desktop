use super::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::model::ProjectMemoryEntryRecord;

const NAMESPACE: &str = "projectAutoMemory";

// Older preview builds kept AI notes apart from project memory. Read those
// records until their contents have safely joined the existing memory store.
#[derive(Deserialize, Serialize)]
struct LegacyEntry {
    id: String,
    title: String,
    content: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyAutoMemory {
    enabled: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    entries: Vec<LegacyEntry>,
}

impl Database {
    fn auto_memory_key(&self, path: &str) -> Result<String> {
        let path = canonical_project_path(path).ok_or_else(|| anyhow!("project path required"))?;
        let group = self
            .project_group_for_path(&path)?
            .ok_or_else(|| anyhow!("project not found"))?;
        Ok(if group.legacy {
            format!("path:{path}")
        } else {
            format!("group:{}", group.id)
        })
    }

    fn legacy_auto_memory(&self, key: &str) -> Result<LegacyAutoMemory> {
        Ok(self
            .kv_get(NAMESPACE, key)?
            .map(serde_json::from_value)
            .transpose()?
            .unwrap_or_default())
    }

    pub(crate) fn migrate_legacy_auto_entries(&self, path: &str) -> Result<()> {
        let key = self.auto_memory_key(path)?;
        let old = self.legacy_auto_memory(&key)?;
        if old.entries.is_empty() {
            return Ok(());
        }
        let transaction = self
            .conn
            .is_autocommit()
            .then(|| self.conn.unchecked_transaction())
            .transpose()?;
        let group = self
            .project_group_for_path(path)?
            .ok_or_else(|| anyhow!("project not found"))?;
        let existing = if group.legacy {
            self.get_project_memory(path)?
        } else {
            self.get_project_group_memory(&group.id)?
        };
        let mut entries = existing.entries.unwrap_or_else(|| {
            if existing.content.is_empty() {
                Vec::new()
            } else {
                vec![ProjectMemoryEntryRecord {
                    id: "legacy-project-memory".to_string(),
                    title: String::new(),
                    content: existing.content,
                }]
            }
        });
        for mut entry in old.entries {
            if entries.iter().any(|stored| stored.id == entry.id) {
                entry.id = Uuid::new_v4().to_string();
            }
            entries.push(ProjectMemoryEntryRecord {
                id: entry.id,
                title: entry.title,
                content: entry.content,
            });
        }
        // The same setter validates the 32 KiB limit and persists the content
        // used by existing project-memory sync. No old record is cleared on error.
        let raw_entries = serde_json::to_value(&entries)?;
        if group.legacy {
            self.set_project_memory_entries(path, &raw_entries)?;
        } else {
            self.set_project_group_memory(&group.id, &raw_entries)?;
        }
        self.kv_set(
            NAMESPACE,
            &key,
            &serde_json::json!({ "enabled": old.enabled }),
        )?;
        if let Some(transaction) = transaction {
            transaction.commit()?;
        }
        Ok(())
    }

    /// Resolve an already validated memory owner without preview migration or
    /// writes. This method must never perform filesystem/Git I/O.
    pub(crate) fn get_project_memory_readonly(&self, path: &str) -> Result<ProjectMemoryRecord> {
        let group = self.project_group_for_path(path)?;
        let mut memory = match group.as_ref().filter(|group| !group.legacy) {
            Some(group) => self.get_project_group_memory(&group.id)?,
            None => self.get_project_memory(path)?,
        };
        let Some(group) = group else {
            return Ok(memory);
        };
        let key = if group.legacy {
            format!(
                "path:{}",
                canonical_project_path(path).ok_or_else(|| anyhow!("project path required"))?
            )
        } else {
            format!("group:{}", group.id)
        };
        let old = self.legacy_auto_memory(&key)?;
        if !old.entries.is_empty() {
            let mut entries = super::project_memory_editor::memory_entries(&memory);
            for old in old.entries {
                let mut id = old.id;
                while entries.iter().any(|entry| entry.id == id) {
                    id = format!("legacy-auto:{id}");
                }
                entries.push(ProjectMemoryEntryRecord {
                    id,
                    title: old.title,
                    content: old.content,
                });
            }
            memory.content = super::repositories::render_project_memory_entries(&entries);
            if memory.content.len() > MAX_PROJECT_MEMORY_BYTES {
                return Err(anyhow!(
                    "project memory exceeds {MAX_PROJECT_MEMORY_BYTES} bytes"
                ));
            }
            memory.entries = Some(entries);
        }
        Ok(memory)
    }

    pub(crate) fn get_auto_record_enabled_readonly(&self, path: &str) -> Result<bool> {
        if self.project_group_for_path(path)?.is_none() {
            return Ok(false);
        }
        Ok(self
            .legacy_auto_memory(&self.auto_memory_key(path)?)?
            .enabled)
    }

    pub fn get_auto_record_enabled(&self, path: &str) -> Result<bool> {
        if let Some(space) = self.project_memory_space_for_path(path)? {
            return self.get_memory_space_auto_record_enabled(&space.id);
        }
        self.migrate_legacy_auto_entries(path)?;
        Ok(self
            .legacy_auto_memory(&self.auto_memory_key(path)?)?
            .enabled)
    }

    pub fn set_auto_memory_enabled(&self, path: &str, enabled: bool) -> Result<bool> {
        if let Some(space) = self.project_memory_space_for_path(path)? {
            return self.set_memory_space_auto_record_enabled(&space.id, enabled);
        }
        self.migrate_legacy_auto_entries(path)?;
        self.kv_set(
            NAMESPACE,
            &self.auto_memory_key(path)?,
            &serde_json::json!({ "enabled": enabled }),
        )?;
        Ok(enabled)
    }

    pub(crate) fn merge_auto_memory_into_group(
        &self,
        paths: &[String],
        group_id: &str,
    ) -> Result<()> {
        let group_key = format!("group:{group_id}");
        let mut state = self.legacy_auto_memory(&group_key)?;
        for path in paths {
            let old_key = format!(
                "path:{}",
                canonical_project_path(path).ok_or_else(|| anyhow!("project path required"))?
            );
            if let Some(value) = self.kv_get(NAMESPACE, &old_key)? {
                let old: LegacyAutoMemory = serde_json::from_value(value)?;
                state.enabled |= old.enabled;
                state.entries.extend(old.entries);
                self.kv_delete(NAMESPACE, &old_key)?;
            }
        }
        self.kv_set(NAMESPACE, &group_key, &serde_json::to_value(state)?)?;
        Ok(())
    }

    pub(crate) fn delete_group_auto_memory(&self, id: &str) -> Result<()> {
        self.kv_delete(NAMESPACE, &format!("group:{id}"))
    }

    pub(crate) fn delete_path_auto_memory(&self, path: &str) -> Result<()> {
        if let Some(path) = canonical_project_path(path) {
            self.kv_delete(NAMESPACE, &format!("path:{path}"))?;
        }
        Ok(())
    }
}
