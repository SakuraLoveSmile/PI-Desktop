use crate::activation::ActivationScope;
use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Skill documents the user owns.
///
/// Plugin skills (ADR 0039) proved the catalog-plus-`Skill`-tool path works; the
/// gap was that writing one meant authoring a plugin. A user skill is the same
/// document with no plugin around it: stored under `<data>/skills/<id>/SKILL.md`,
/// listed in the same prompt section, and loaded through the same tool. Because
/// it is the user's own text rather than third-party code, it needs no
/// permission grant — only an activation scope deciding where it applies.
const MAX_SKILLS: usize = 64;
/// Matches the plugin skill body cap so a first-party and a third-party skill
/// document have the same ceiling (D174).
pub const MAX_SKILL_BYTES: usize = 128 * 1024;
const MAX_NAME_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 400;
/// Files copied when importing a skill directory alongside its document.
const MAX_IMPORT_FILES: usize = 64;
const SKILL_FILE: &str = "SKILL.md";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSkillRecord {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    #[serde(default)]
    pub scope: ActivationScope,
    /// `created` wrote a template; `imported` copied an existing document.
    pub source: String,
    /// Absolute path of the document, so the UI can open or reveal it.
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSkillInput {
    /// Omitted on create: the slug is derived from the name.
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub body: Option<String>,
    pub enabled: Option<bool>,
    pub scope: Option<ActivationScope>,
}

pub struct UserSkillRegistry {
    data_dir: PathBuf,
    skills: Vec<UserSkillRecord>,
}

/// Slugify a name into a directory-safe id. The id is what the model types into
/// the `Skill` tool, so it stays lowercase and hyphenated.
pub fn slugify(value: &str) -> String {
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
    slug.truncate(64);
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.starts_with(|c: char| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Split the optional `---` front matter off a skill document. Mirrors
/// `parseSkillFrontmatter` in the plugin SDK, which reads the same files in
/// Electron main.
fn parse_front_matter(raw: &str) -> (Option<String>, Option<String>, String) {
    let text = raw.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else {
        return (None, None, text.trim().to_string());
    };
    let rest = match rest.split_once('\n') {
        Some((head, tail)) if head.trim().is_empty() => tail,
        _ => return (None, None, text.trim().to_string()),
    };
    let mut name = None;
    let mut description = None;
    let mut consumed = 0usize;
    let mut closed = false;
    for line in rest.split_inclusive('\n') {
        consumed += line.len();
        let trimmed = line.trim_end_matches(['\n', '\r']).trim_end();
        if trimmed.trim() == "---" {
            closed = true;
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'').trim();
        if value.is_empty() {
            continue;
        }
        match key.trim().to_lowercase().as_str() {
            "name" => name = Some(value.to_string()),
            "description" => description = Some(value.to_string()),
            _ => {}
        }
    }
    if !closed {
        return (None, None, text.trim().to_string());
    }
    (name, description, rest[consumed..].trim().to_string())
}

/// Serialize a skill document: front matter the parser round-trips, then body.
fn render_document(name: &str, description: Option<&str>, body: &str) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", name.replace('\n', " ")));
    if let Some(description) = description.filter(|d| !d.trim().is_empty()) {
        out.push_str(&format!("description: {}\n", description.replace('\n', " ")));
    }
    out.push_str("---\n\n");
    out.push_str(body.trim());
    out.push('\n');
    out
}

fn default_body(name: &str) -> String {
    format!(
        "# {name}\n\nDescribe the steps the agent should follow when this skill applies.\n\n\
         ## When to use\n\n- \n\n## Steps\n\n1. \n"
    )
}

fn clip(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

impl UserSkillRegistry {
    pub fn new(data_dir: &Path) -> Self {
        let mut registry = Self {
            data_dir: data_dir.to_path_buf(),
            skills: Vec::new(),
        };
        let _ = registry.reload_from_disk();
        registry
    }

    fn registry_path(&self) -> PathBuf {
        self.data_dir.join("skills/registry.json")
    }

    fn skill_dir(&self, id: &str) -> PathBuf {
        self.data_dir.join("skills").join(id)
    }

    pub fn reload_from_disk(&mut self) -> Result<()> {
        let path = self.registry_path();
        if !path.exists() {
            self.skills.clear();
            return Ok(());
        }
        let raw = fs::read_to_string(path)?;
        self.skills = serde_json::from_str(&raw).unwrap_or_default();
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let path = self.registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(&self.skills)?)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<UserSkillRecord> {
        let mut skills = self.skills.clone();
        skills.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
        skills
    }

    pub fn get(&self, id: &str) -> Option<UserSkillRecord> {
        self.skills.iter().find(|s| s.id == id).cloned()
    }

    /// Skills that apply to a session opened on `project_path`.
    pub fn active_for(&self, project_path: Option<&str>) -> Vec<UserSkillRecord> {
        self.list()
            .into_iter()
            .filter(|s| s.enabled && s.scope.matches(project_path))
            .collect()
    }

    /// Pick an id that is free both in the registry and on disk.
    fn allocate_id(&self, preferred: &str) -> Result<String> {
        let base = if valid_id(preferred) {
            preferred.to_string()
        } else {
            slugify(preferred)
        };
        let base = if base.is_empty() { "skill".to_string() } else { base };
        for suffix in 0..100 {
            let candidate = if suffix == 0 {
                base.clone()
            } else {
                format!("{base}-{suffix}")
            };
            if self.get(&candidate).is_none() && !self.skill_dir(&candidate).exists() {
                return Ok(candidate);
            }
        }
        bail!("SKILL_INVALID: could not allocate an id for \"{preferred}\"")
    }

    /// Write a new skill document from scratch.
    pub fn create(&mut self, input: UserSkillInput) -> Result<UserSkillRecord> {
        if self.skills.len() >= MAX_SKILLS {
            bail!("SKILL_INVALID: at most {MAX_SKILLS} skills");
        }
        let name = clip(input.name.as_deref().unwrap_or_default(), MAX_NAME_CHARS);
        if name.is_empty() {
            bail!("SKILL_INVALID: name is required");
        }
        let id = self.allocate_id(input.id.as_deref().unwrap_or(&name))?;
        let description = input
            .description
            .as_deref()
            .map(|d| clip(d, MAX_DESCRIPTION_CHARS))
            .filter(|d| !d.is_empty());
        let body = input
            .body
            .as_deref()
            .map(str::to_string)
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| default_body(&name));
        let document = render_document(&name, description.as_deref(), &body);
        if document.len() > MAX_SKILL_BYTES {
            bail!("SKILL_INVALID: document exceeds {MAX_SKILL_BYTES} bytes");
        }
        let dir = self.skill_dir(&id);
        fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
        let path = dir.join(SKILL_FILE);
        fs::write(&path, &document)?;
        let now = Utc::now().to_rfc3339();
        let record = UserSkillRecord {
            id,
            name,
            description,
            enabled: input.enabled.unwrap_or(true),
            scope: input.scope.unwrap_or_default().normalized(),
            source: "created".into(),
            path: path.to_string_lossy().to_string(),
            size_bytes: document.len() as u64,
            created_at: now.clone(),
            updated_at: now,
        };
        self.skills.push(record.clone());
        self.save()?;
        Ok(record)
    }

    /// Copy an existing document — or a directory holding one — into the store.
    ///
    /// Importing a directory brings its sibling files along, because a skill
    /// that references a checklist or a template is useless without them.
    pub fn import(&mut self, source: &str, input: UserSkillInput) -> Result<UserSkillRecord> {
        if self.skills.len() >= MAX_SKILLS {
            bail!("SKILL_INVALID: at most {MAX_SKILLS} skills");
        }
        let source_path = PathBuf::from(source);
        if !source_path.exists() {
            bail!("SKILL_INVALID: {source} does not exist");
        }
        let is_dir = source_path.is_dir();
        let document_path = if is_dir {
            let direct = source_path.join(SKILL_FILE);
            if direct.exists() {
                direct
            } else {
                // A single-markdown folder is a common shape; accept it when
                // there is exactly one candidate so the import is unambiguous.
                let mut candidates: Vec<PathBuf> = fs::read_dir(&source_path)?
                    .filter_map(|entry| entry.ok().map(|e| e.path()))
                    .filter(|path| {
                        path.is_file()
                            && path
                                .extension()
                                .and_then(|e| e.to_str())
                                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                    })
                    .collect();
                candidates.sort();
                match candidates.len() {
                    1 => candidates.remove(0),
                    0 => bail!("SKILL_INVALID: no SKILL.md or markdown file in {source}"),
                    _ => bail!("SKILL_INVALID: {source} holds several markdown files; add a SKILL.md"),
                }
            }
        } else {
            source_path.clone()
        };
        let raw = fs::read_to_string(&document_path)
            .with_context(|| format!("read {}", document_path.display()))?;
        if raw.len() > MAX_SKILL_BYTES {
            bail!("SKILL_INVALID: document exceeds {MAX_SKILL_BYTES} bytes");
        }
        let (front_name, front_description, body) = parse_front_matter(&raw);
        if body.trim().is_empty() {
            bail!("SKILL_INVALID: document is empty");
        }
        let fallback_name = document_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("skill")
            .to_string();
        let name = clip(
            input
                .name
                .as_deref()
                .filter(|n| !n.trim().is_empty())
                .or(front_name.as_deref())
                .unwrap_or(&fallback_name),
            MAX_NAME_CHARS,
        );
        let description = input
            .description
            .as_deref()
            .or(front_description.as_deref())
            .map(|d| clip(d, MAX_DESCRIPTION_CHARS))
            .filter(|d| !d.is_empty());
        let id = self.allocate_id(input.id.as_deref().unwrap_or(&name))?;
        let dir = self.skill_dir(&id);
        fs::create_dir_all(&dir)?;
        let document = render_document(&name, description.as_deref(), &body);
        let target = dir.join(SKILL_FILE);
        fs::write(&target, &document)?;
        if is_dir {
            self.copy_sidecar_files(&source_path, &document_path, &dir)?;
        }
        let now = Utc::now().to_rfc3339();
        let record = UserSkillRecord {
            id,
            name,
            description,
            enabled: input.enabled.unwrap_or(true),
            scope: input.scope.unwrap_or_default().normalized(),
            source: "imported".into(),
            path: target.to_string_lossy().to_string(),
            size_bytes: document.len() as u64,
            created_at: now.clone(),
            updated_at: now,
        };
        self.skills.push(record.clone());
        self.save()?;
        Ok(record)
    }

    /// Copy the imported directory's other files, one level deep. Nested trees,
    /// symlinks and oversized sets are skipped rather than followed: an import
    /// should never become an unbounded copy of whatever the folder points at.
    fn copy_sidecar_files(&self, source: &Path, document: &Path, target: &Path) -> Result<()> {
        let mut copied = 0usize;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let path = entry.path();
            if path == document {
                continue;
            }
            let metadata = entry.metadata()?;
            if !metadata.is_file() {
                continue;
            }
            if metadata.len() as usize > MAX_SKILL_BYTES {
                continue;
            }
            let Some(name) = path.file_name() else { continue };
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            if copied >= MAX_IMPORT_FILES {
                break;
            }
            fs::copy(&path, target.join(name))?;
            copied += 1;
        }
        Ok(())
    }

    /// Edit metadata and/or the body of a stored skill.
    pub fn update(&mut self, id: &str, input: UserSkillInput) -> Result<Option<UserSkillRecord>> {
        let Some(index) = self.skills.iter().position(|s| s.id == id) else {
            return Ok(None);
        };
        let current = self.skills[index].clone();
        let name = input
            .name
            .as_deref()
            .map(|n| clip(n, MAX_NAME_CHARS))
            .filter(|n| !n.is_empty())
            .unwrap_or(current.name.clone());
        let description = match input.description.as_deref() {
            // An explicit empty string clears the description; absent keeps it.
            Some(value) if value.trim().is_empty() => None,
            Some(value) => Some(clip(value, MAX_DESCRIPTION_CHARS)),
            None => current.description.clone(),
        };
        let path = PathBuf::from(&current.path);
        let body = match input.body.as_deref() {
            Some(value) => value.to_string(),
            None => {
                let raw = fs::read_to_string(&path).unwrap_or_default();
                parse_front_matter(&raw).2
            }
        };
        if body.trim().is_empty() {
            bail!("SKILL_INVALID: document is empty");
        }
        let document = render_document(&name, description.as_deref(), &body);
        if document.len() > MAX_SKILL_BYTES {
            bail!("SKILL_INVALID: document exceeds {MAX_SKILL_BYTES} bytes");
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, &document)?;
        let record = UserSkillRecord {
            name,
            description,
            enabled: input.enabled.unwrap_or(current.enabled),
            scope: input
                .scope
                .unwrap_or(current.scope.clone())
                .normalized(),
            size_bytes: document.len() as u64,
            updated_at: Utc::now().to_rfc3339(),
            ..current
        };
        self.skills[index] = record.clone();
        self.save()?;
        Ok(Some(record))
    }

    /// Read a stored document back, front matter stripped.
    pub fn read(&self, id: &str) -> Result<Option<(UserSkillRecord, String)>> {
        let Some(record) = self.get(id) else {
            return Ok(None);
        };
        let raw = fs::read_to_string(&record.path)
            .with_context(|| format!("read {}", record.path))?;
        if raw.len() > MAX_SKILL_BYTES {
            bail!("SKILL_INVALID: document exceeds {MAX_SKILL_BYTES} bytes");
        }
        let (_, _, body) = parse_front_matter(&raw);
        Ok(Some((record, body)))
    }

    pub fn remove(&mut self, id: &str) -> Result<bool> {
        let Some(index) = self.skills.iter().position(|s| s.id == id) else {
            return Ok(false);
        };
        let record = self.skills.remove(index);
        // Only ever delete inside the store, so a registry edited by hand cannot
        // aim the removal at an arbitrary directory.
        let dir = self.skill_dir(&record.id);
        if dir.starts_with(self.data_dir.join("skills")) && dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        self.save()?;
        Ok(true)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Option<UserSkillRecord>> {
        let Some(skill) = self.skills.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        skill.enabled = enabled;
        skill.updated_at = Utc::now().to_rfc3339();
        let updated = skill.clone();
        self.save()?;
        Ok(Some(updated))
    }

    pub fn set_scope(&mut self, id: &str, scope: ActivationScope) -> Result<Option<UserSkillRecord>> {
        let Some(skill) = self.skills.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        skill.scope = scope.normalized();
        skill.updated_at = Utc::now().to_rfc3339();
        let updated = skill.clone();
        self.save()?;
        Ok(Some(updated))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::ActivationMode;

    fn registry() -> (tempfile::TempDir, UserSkillRegistry) {
        let dir = tempfile::tempdir().unwrap();
        let registry = UserSkillRegistry::new(dir.path());
        (dir, registry)
    }

    fn named(name: &str) -> UserSkillInput {
        UserSkillInput {
            name: Some(name.into()),
            ..Default::default()
        }
    }

    #[test]
    fn create_slugifies_the_name_and_writes_front_matter() {
        let (_dir, mut registry) = registry();
        let record = registry
            .create(UserSkillInput {
                name: Some("Release Notes!".into()),
                description: Some("Draft a release note".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(record.id, "release-notes");
        let raw = fs::read_to_string(&record.path).unwrap();
        assert!(raw.starts_with("---\nname: Release Notes!\n"));
        assert!(raw.contains("description: Draft a release note"));
        let (name, description, body) = parse_front_matter(&raw);
        assert_eq!(name.as_deref(), Some("Release Notes!"));
        assert_eq!(description.as_deref(), Some("Draft a release note"));
        assert!(body.contains("Release Notes!"));
    }

    #[test]
    fn create_requires_a_name() {
        let (_dir, mut registry) = registry();
        assert!(registry.create(UserSkillInput::default()).is_err());
    }

    #[test]
    fn ids_never_collide() {
        let (_dir, mut registry) = registry();
        let first = registry.create(named("Review")).unwrap();
        let second = registry.create(named("Review")).unwrap();
        assert_eq!(first.id, "review");
        assert_eq!(second.id, "review-1");
    }

    #[test]
    fn update_rewrites_the_document_and_can_clear_the_description() {
        let (_dir, mut registry) = registry();
        let record = registry
            .create(UserSkillInput {
                name: Some("Review".into()),
                description: Some("old".into()),
                ..Default::default()
            })
            .unwrap();
        let updated = registry
            .update(
                &record.id,
                UserSkillInput {
                    description: Some("".into()),
                    body: Some("# New body".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(updated.description, None);
        let (_, body) = registry.read(&record.id).unwrap().unwrap();
        assert_eq!(body, "# New body");
    }

    #[test]
    fn update_without_a_body_keeps_the_existing_one() {
        let (_dir, mut registry) = registry();
        let record = registry.create(named("Review")).unwrap();
        let (_, before) = registry.read(&record.id).unwrap().unwrap();
        registry
            .update(&record.id, named("Renamed Review"))
            .unwrap()
            .unwrap();
        let (after_record, after) = registry.read(&record.id).unwrap().unwrap();
        assert_eq!(after_record.name, "Renamed Review");
        assert_eq!(after, before);
    }

    #[test]
    fn import_a_file_reads_its_front_matter() {
        let (dir, mut registry) = registry();
        let source = dir.path().join("incoming.md");
        fs::write(
            &source,
            "---\nname: Imported\ndescription: From a file\n---\n\nDo the thing.\n",
        )
        .unwrap();
        let record = registry
            .import(source.to_str().unwrap(), UserSkillInput::default())
            .unwrap();
        assert_eq!(record.name, "Imported");
        assert_eq!(record.description.as_deref(), Some("From a file"));
        assert_eq!(record.source, "imported");
        assert_eq!(record.id, "imported");
        let (_, body) = registry.read(&record.id).unwrap().unwrap();
        assert_eq!(body, "Do the thing.");
    }

    #[test]
    fn import_a_file_without_front_matter_falls_back_to_the_file_name() {
        let (dir, mut registry) = registry();
        let source = dir.path().join("Deploy Steps.md");
        fs::write(&source, "Step one.\n").unwrap();
        let record = registry
            .import(source.to_str().unwrap(), UserSkillInput::default())
            .unwrap();
        assert_eq!(record.name, "Deploy Steps");
        assert_eq!(record.id, "deploy-steps");
    }

    #[test]
    fn import_a_directory_brings_sidecar_files() {
        let (dir, mut registry) = registry();
        let source = dir.path().join("pack");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join(SKILL_FILE), "---\nname: Pack\n---\n\nUse the template.\n").unwrap();
        fs::write(source.join("template.md"), "template").unwrap();
        fs::write(source.join(".hidden"), "no").unwrap();
        let record = registry
            .import(source.to_str().unwrap(), UserSkillInput::default())
            .unwrap();
        let stored_dir = PathBuf::from(&record.path).parent().unwrap().to_path_buf();
        assert!(stored_dir.join("template.md").exists());
        assert!(!stored_dir.join(".hidden").exists());
    }

    #[test]
    fn import_rejects_an_ambiguous_directory() {
        let (dir, mut registry) = registry();
        let source = dir.path().join("ambiguous");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("a.md"), "a").unwrap();
        fs::write(source.join("b.md"), "b").unwrap();
        let err = registry
            .import(source.to_str().unwrap(), UserSkillInput::default())
            .unwrap_err()
            .to_string();
        assert!(err.contains("several markdown files"), "{err}");
    }

    #[test]
    fn import_rejects_an_empty_document() {
        let (dir, mut registry) = registry();
        let source = dir.path().join("empty.md");
        fs::write(&source, "---\nname: Empty\n---\n\n   \n").unwrap();
        assert!(registry
            .import(source.to_str().unwrap(), UserSkillInput::default())
            .is_err());
    }

    #[test]
    fn remove_deletes_the_stored_directory() {
        let (_dir, mut registry) = registry();
        let record = registry.create(named("Review")).unwrap();
        let stored_dir = PathBuf::from(&record.path).parent().unwrap().to_path_buf();
        assert!(registry.remove(&record.id).unwrap());
        assert!(!stored_dir.exists());
        assert!(!registry.remove(&record.id).unwrap());
    }

    #[test]
    fn active_for_honours_enabled_and_scope() {
        let (_dir, mut registry) = registry();
        registry.create(named("Everywhere")).unwrap();
        let scoped = registry.create(named("Scoped")).unwrap();
        let off = registry.create(named("Off")).unwrap();
        registry.set_enabled(&off.id, false).unwrap();
        registry
            .set_scope(
                &scoped.id,
                ActivationScope {
                    mode: ActivationMode::Projects,
                    projects: vec!["/repo".into()],
                },
            )
            .unwrap();
        let ids = |project: Option<&str>| {
            registry
                .active_for(project)
                .into_iter()
                .map(|s| s.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(Some("/repo/app")), vec!["everywhere", "scoped"]);
        assert_eq!(ids(Some("/other")), vec!["everywhere"]);
    }

    #[test]
    fn records_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut registry = UserSkillRegistry::new(dir.path());
            registry.create(named("Review")).unwrap();
        }
        let reopened = UserSkillRegistry::new(dir.path());
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.get("review").unwrap().name, "Review");
    }

    #[test]
    fn front_matter_without_a_closing_fence_is_body() {
        let (name, description, body) = parse_front_matter("---\nname: X\n\nnot closed");
        assert_eq!(name, None);
        assert_eq!(description, None);
        assert!(body.starts_with("---"));
    }

    #[test]
    fn slugify_handles_unicode_and_punctuation() {
        assert_eq!(slugify("  Hello, World!  "), "hello-world");
        assert_eq!(slugify("发布说明"), "");
        assert_eq!(slugify("v1.2 notes"), "v1-2-notes");
    }

    /// The cap is on the document, not the body the user typed, because the
    /// document is what a `Skill` call has to carry back into the turn.
    #[test]
    fn an_oversized_document_is_refused_on_create_and_on_update() {
        let (_dir, mut registry) = registry();
        let huge = "x".repeat(MAX_SKILL_BYTES);

        let err = registry
            .create(UserSkillInput {
                name: Some("Huge".into()),
                body: Some(huge.clone()),
                ..Default::default()
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("exceeds"), "{err}");
        // A refused create leaves nothing half-written behind.
        assert!(registry.list().is_empty());

        let record = registry.create(named("Review")).unwrap();
        let err = registry
            .update(
                &record.id,
                UserSkillInput {
                    body: Some(huge),
                    ..Default::default()
                },
            )
            .unwrap_err()
            .to_string();
        assert!(err.contains("exceeds"), "{err}");
        // The document that was already there is still readable and intact.
        let (_, body) = registry.read(&record.id).unwrap().unwrap();
        assert!(body.len() < MAX_SKILL_BYTES);

        // Just under the cap, front matter included, still goes through.
        let front_matter = render_document("Review", None, "").len();
        let fits = "y".repeat(MAX_SKILL_BYTES - front_matter);
        assert!(
            registry
                .update(
                    &record.id,
                    UserSkillInput {
                        body: Some(fits),
                        ..Default::default()
                    },
                )
                .is_ok()
        );
    }
}
