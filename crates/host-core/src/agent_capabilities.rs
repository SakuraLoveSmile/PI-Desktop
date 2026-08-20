use anyhow::{bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The only on-disk roots owned by user-facing agent capability management.
pub const AGENTS_DIR: &str = ".agents";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityLevel {
    Global,
    Project,
}

impl CapabilityLevel {
    pub fn parse(value: Option<&str>) -> Result<Self> {
        match value.unwrap_or("global") {
            "global" => Ok(Self::Global),
            "project" => Ok(Self::Project),
            other => bail!("CAPABILITY_INVALID: unknown level \"{other}\""),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Project => "project",
        }
    }
}

/// The application-local state file deliberately lives outside capability
/// directories. Capability documents remain portable and user-editable.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StateFile {
    #[serde(default)]
    values: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateKey {
    kind: String,
    level: String,
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
}

pub struct CapabilityState {
    path: PathBuf,
    values: BTreeMap<String, bool>,
}

impl CapabilityState {
    pub fn new(data_dir: &Path, kind: &str) -> Self {
        let path = data_dir
            .join("agent-capabilities")
            .join(format!("{kind}.json"));
        let values = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<StateFile>(&raw).ok())
            .map(|file| file.values)
            .unwrap_or_default();
        Self { path, values }
    }

    fn key(kind: &str, level: CapabilityLevel, id: &str, project_path: Option<&str>) -> String {
        serde_json::to_string(&StateKey {
            kind: kind.to_string(),
            level: level.as_str().to_string(),
            id: id.to_string(),
            project_path: project_path.map(normalize_project_path),
        })
        .expect("state key is serializable")
    }

    fn get(
        &self,
        kind: &str,
        level: CapabilityLevel,
        id: &str,
        project_path: Option<&str>,
    ) -> Option<bool> {
        self.values
            .get(&Self::key(kind, level, id, project_path))
            .copied()
    }

    /// Global records default on. A global record may have a per-project
    /// override, while a project record has one state for its owning project.
    pub fn enabled(
        &self,
        kind: &str,
        level: CapabilityLevel,
        id: &str,
        project_path: Option<&str>,
    ) -> bool {
        match level {
            CapabilityLevel::Global => project_path
                .and_then(|path| self.get(kind, level, id, Some(path)))
                .or_else(|| self.get(kind, level, id, None))
                .unwrap_or(true),
            CapabilityLevel::Project => self.get(kind, level, id, project_path).unwrap_or(true),
        }
    }

    pub fn set_enabled(
        &mut self,
        kind: &str,
        level: CapabilityLevel,
        id: &str,
        project_path: Option<&str>,
        enabled: bool,
    ) -> Result<()> {
        let path = project_path.map(normalize_project_path);
        let key = Self::key(kind, level, id, path.as_deref());
        match level {
            CapabilityLevel::Global if path.is_some() => {
                let global_default = self.get(kind, level, id, None).unwrap_or(true);
                if enabled == global_default {
                    self.values.remove(&key);
                } else {
                    self.values.insert(key, enabled);
                }
            }
            CapabilityLevel::Global => {
                if enabled {
                    self.values.remove(&key);
                } else {
                    self.values.insert(key, false);
                }
            }
            CapabilityLevel::Project => {
                if enabled {
                    self.values.remove(&key);
                } else {
                    self.values.insert(key, false);
                }
            }
        }
        self.save()
    }

    /// Remove state for records that disappeared from the selected directory.
    /// Other project selections remain untouched because they may still exist.
    pub fn prune(
        &mut self,
        kind: &str,
        level: CapabilityLevel,
        project_path: Option<&str>,
        ids: &std::collections::HashSet<String>,
    ) -> Result<()> {
        let normalized_project = project_path.map(normalize_project_path);
        let before = self.values.len();
        self.values.retain(|raw_key, _| {
            let Ok(key) = serde_json::from_str::<StateKey>(raw_key) else {
                return false;
            };
            if key.kind != kind || key.level != level.as_str() || ids.contains(&key.id) {
                return true;
            }
            match level {
                // A global file is the source for every project, so every
                // override for a missing global id is orphaned at once.
                CapabilityLevel::Global => false,
                // A project scan only has authority over the selected project;
                // overrides belonging to other projects may still be live.
                CapabilityLevel::Project => match (&key.project_path, &normalized_project) {
                    (Some(key_project), Some(selected)) => !same_path(key_project, selected),
                    _ => false,
                },
            }
        });
        if before != self.values.len() {
            self.save()?;
        }
        Ok(())
    }

    fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = StateFile {
            values: self.values.clone(),
        };
        fs::write(&self.path, serde_json::to_string_pretty(&file)?)?;
        Ok(())
    }
}

pub fn global_agents_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(AGENTS_DIR)
}

pub fn capability_dir(
    level: CapabilityLevel,
    project_path: Option<&str>,
    leaf: &str,
) -> Result<PathBuf> {
    match level {
        CapabilityLevel::Global => Ok(global_agents_dir().join(leaf)),
        CapabilityLevel::Project => {
            let path = project_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| anyhow::anyhow!("CAPABILITY_INVALID: projectPath is required"))?;
            Ok(PathBuf::from(path).join(AGENTS_DIR).join(leaf))
        }
    }
}

pub fn normalize_project_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut normalized = trimmed.replace('\\', "/");
    while normalized.len() > 1
        && normalized.ends_with('/')
        && !normalized
            .strip_suffix('/')
            .is_some_and(|prefix| prefix.ends_with(':'))
    {
        normalized.pop();
    }
    normalized
}

fn same_path(a: &str, b: &str) -> bool {
    normalize_project_path(a).to_lowercase() == normalize_project_path(b).to_lowercase()
}

pub fn parse_front_matter(raw: &str) -> (BTreeMap<String, String>, String) {
    let text = raw.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else {
        return (BTreeMap::new(), text.trim().to_string());
    };
    let Some((head, tail)) = rest.split_once('\n') else {
        return (BTreeMap::new(), text.trim().to_string());
    };
    if !head.trim().is_empty() {
        return (BTreeMap::new(), text.trim().to_string());
    }
    let mut fields = BTreeMap::new();
    let mut consumed = 0usize;
    for line in tail.split_inclusive('\n') {
        consumed += line.len();
        let trimmed = line.trim_end_matches(['\n', '\r']).trim_end();
        if trimmed.trim() == "---" {
            return (fields, tail[consumed..].trim().to_string());
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'').trim();
        if !value.is_empty() {
            fields.insert(key.trim().to_lowercase(), value.to_string());
        }
    }
    (BTreeMap::new(), text.trim().to_string())
}

pub fn slugify(value: &str, max_chars: usize) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !slug.is_empty() && !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug.truncate(max_chars);
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

pub fn file_timestamp(path: &Path) -> String {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(|time| DateTime::<Utc>::from(time).to_rfc3339())
        .unwrap_or_else(|| DateTime::<Utc>::from(SystemTime::UNIX_EPOCH).to_rfc3339())
}

pub fn sorted_files(dir: &Path, extension: &str) -> Vec<PathBuf> {
    let mut files = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(|entry| entry.ok().map(|item| item.path())))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn front_matter_and_body_round_trip() {
        let (fields, body) =
            parse_front_matter("---\nname: Review\ndescription: Check code\n---\n\nDo it.\n");
        assert_eq!(fields.get("name").map(String::as_str), Some("Review"));
        assert_eq!(
            fields.get("description").map(String::as_str),
            Some("Check code")
        );
        assert_eq!(body, "Do it.");
    }

    #[test]
    fn state_defaults_on_and_is_project_specific() {
        let dir = tempdir().unwrap();
        let mut state = CapabilityState::new(dir.path(), "skills");
        assert!(state.enabled("skills", CapabilityLevel::Global, "review", Some("/a")));
        state
            .set_enabled(
                "skills",
                CapabilityLevel::Global,
                "review",
                Some("/a"),
                false,
            )
            .unwrap();
        assert!(!state.enabled("skills", CapabilityLevel::Global, "review", Some("/a")));
        assert!(state.enabled("skills", CapabilityLevel::Global, "review", Some("/b")));
        let reopened = CapabilityState::new(dir.path(), "skills");
        assert!(!reopened.enabled("skills", CapabilityLevel::Global, "review", Some("/a")));

        let mut orphaned = reopened;
        orphaned
            .prune(
                "skills",
                CapabilityLevel::Global,
                None,
                &std::collections::HashSet::new(),
            )
            .unwrap();
        assert!(orphaned.enabled("skills", CapabilityLevel::Global, "review", Some("/a")));
    }
}
