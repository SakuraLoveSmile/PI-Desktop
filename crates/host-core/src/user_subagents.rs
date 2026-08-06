use crate::activation::ActivationScope;
use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Subagent definitions the user owns (D202, ADR 0063).
///
/// ADR 0062 gave a session two definition sources: the three inline builtins
/// and `<workspace>/.pi/agents/*.md`. Both are fine for a definition that
/// belongs to a repository and nothing else. Neither gives a user a delegate
/// they can carry across every project, and neither is reachable from the UI.
///
/// This registry is that third source, and it is the only one the UI writes:
/// `<data>/agents/registry.json` holds the metadata plus an activation scope,
/// and each definition is a plain `<data>/agents/<id>.md` document — the same
/// filename shape a project uses, so a definition can be copied between the two
/// unchanged.
///
/// Validation here is deliberately thin. `packages/shared/src/subagent-definition.ts`
/// is what decides whether a document loads; this module only refuses input that
/// could never load at all (no name, no description, no usable tool), so the UI
/// reports the problem at save time instead of leaving a dead file behind.
/// Matches `MAX_SUBAGENT_DEFINITIONS` in shared: past that the catalog stops
/// being a menu the model can reason about, so a definition the registry
/// accepted would silently never reach a session.
const MAX_USER_SUBAGENTS: usize = 16;
/// A definition body becomes a delegate's whole system prompt. Far smaller than
/// the skill cap (D174) because a prompt this long stops being a brief.
pub const MAX_SUBAGENT_BYTES: usize = 32 * 1024;
/// Mirrors `NAME_RE` in shared: the name is what the model types into `Task`.
const MAX_NAME_CHARS: usize = 40;
const MAX_DESCRIPTION_CHARS: usize = 400;
/// Mirrors `SUBAGENT_ASSIGNABLE_TOOLS`; a delegate is a bounded file/search/shell
/// worker, never a second session.
const ASSIGNABLE_TOOLS: [&str; 7] = [
    "Read",
    "Glob",
    "Grep",
    "BrowserPreview",
    "Bash",
    "Edit",
    "Write",
];
/// Mirrors `DEFAULT_SUBAGENT_TOOLS`: read-only unless the definition says more.
const DEFAULT_TOOLS: [&str; 3] = ["Read", "Glob", "Grep"];
/// Mirrors `MAX_SUBAGENT_MAX_TURNS`.
const MAX_TURNS_CEILING: u32 = 80;
/// Mirrors `THINKING_LEVELS`.
const THINKING_LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserSubagentRecord {
    /// Both the document filename and the frontmatter `name`, which is what the
    /// model passes to `Task`. Keeping the two identical is what lets the UI
    /// match a registry row against the catalog entry that won its name.
    pub id: String,
    pub name: String,
    /// Required: a definition without one tells the parent model nothing about
    /// when to delegate, and the shared parser rejects it.
    pub description: String,
    pub enabled: bool,
    #[serde(default)]
    pub scope: ActivationScope,
    /// Resolved tool list, never empty — the UI shows what is actually granted
    /// rather than what the document happened to omit.
    #[serde(default)]
    pub tools: Vec<String>,
    /// `<provider>/<model>` pin, resolved against configured providers in
    /// Electron main; stored verbatim because provider ids are not stable here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// Absolute path of the document, so the UI can reveal it.
    pub path: String,
    #[serde(default)]
    pub size_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
}

/// Create/update payload. Absent fields keep their stored value; an empty
/// string clears an optional one, which is how the editor removes a model pin.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSubagentInput {
    pub id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub body: Option<String>,
    pub tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub max_turns: Option<u32>,
    pub enabled: Option<bool>,
    pub scope: Option<ActivationScope>,
}

pub struct UserSubagentRegistry {
    data_dir: PathBuf,
    subagents: Vec<UserSubagentRecord>,
}

/// Normalize a typed name into the id the model will use. Mirrors
/// `normalizeSubagentName` in shared.
pub fn normalize_name(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !out.is_empty() && !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out.truncate(MAX_NAME_CHARS);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Mirrors `NAME_RE` in shared, applied after `normalize_name`.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Keep only tools a delegate may be granted, in the order given, deduped.
fn normalize_tools(tools: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tool in tools {
        let trimmed = tool.trim();
        if let Some(known) = ASSIGNABLE_TOOLS
            .iter()
            .find(|candidate| candidate.eq_ignore_ascii_case(trimmed))
        {
            if !out.iter().any(|existing| existing == known) {
                out.push((*known).to_string());
            }
        }
    }
    out
}

fn normalize_thinking_level(value: &str) -> Option<String> {
    let candidate = value.trim().to_lowercase();
    THINKING_LEVELS
        .iter()
        .find(|level| **level == candidate)
        .map(|level| (*level).to_string())
}

/// Strip the optional `---` front matter, leaving the body. The stored keys are
/// the registry's job; only the prompt has to survive a round trip.
fn strip_front_matter(raw: &str) -> String {
    let text = raw.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else {
        return text.trim().to_string();
    };
    let rest = match rest.split_once('\n') {
        Some((head, tail)) if head.trim().is_empty() => tail,
        _ => return text.trim().to_string(),
    };
    let mut consumed = 0usize;
    for line in rest.split_inclusive('\n') {
        consumed += line.len();
        if line.trim_end_matches(['\n', '\r']).trim() == "---" {
            return rest[consumed..].trim().to_string();
        }
    }
    // An unterminated block is text, not front matter.
    text.trim().to_string()
}

/// Serialize a definition the shared parser round-trips: front matter in the
/// spelling `parseSubagentDefinition` reads, then the prompt.
fn render_document(record: &UserSubagentRecord, body: &str) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", record.name));
    out.push_str(&format!(
        "description: {}\n",
        record.description.replace('\n', " ")
    ));
    out.push_str(&format!("tools: [{}]\n", record.tools.join(", ")));
    if let Some(model) = &record.model {
        out.push_str(&format!("model: {model}\n"));
    }
    if let Some(level) = &record.thinking_level {
        out.push_str(&format!("thinkingLevel: {level}\n"));
    }
    if let Some(max_turns) = record.max_turns {
        out.push_str(&format!("maxTurns: {max_turns}\n"));
    }
    out.push_str("---\n\n");
    out.push_str(body.trim());
    out.push('\n');
    out
}

fn default_body(name: &str) -> String {
    format!(
        "Do the work the task names, and report only what the parent needs.\n\n\
         - State the first thing you do, so `{name}` has a fixed starting point.\n\
         - Stay inside the task; do not widen it.\n\n\
         Report: the answer in one or two sentences, then the `path:line` \
         references that support it.\n"
    )
}

fn clip(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

impl UserSubagentRegistry {
    pub fn new(data_dir: &Path) -> Self {
        let mut registry = Self {
            data_dir: data_dir.to_path_buf(),
            subagents: Vec::new(),
        };
        let _ = registry.reload_from_disk();
        registry
    }

    fn agents_dir(&self) -> PathBuf {
        self.data_dir.join("agents")
    }

    fn registry_path(&self) -> PathBuf {
        self.agents_dir().join("registry.json")
    }

    /// One document per definition, named as a project's would be so a copy in
    /// either direction is a file copy.
    fn document_path(&self, id: &str) -> PathBuf {
        self.agents_dir().join(format!("{id}.md"))
    }

    pub fn reload_from_disk(&mut self) -> Result<()> {
        let path = self.registry_path();
        if !path.exists() {
            self.subagents.clear();
            return Ok(());
        }
        let raw = fs::read_to_string(path)?;
        self.subagents = serde_json::from_str(&raw).unwrap_or_default();
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let path = self.registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(&self.subagents)?)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<UserSubagentRecord> {
        let mut subagents = self.subagents.clone();
        subagents.sort_by(|a, b| a.name.cmp(&b.name));
        subagents
    }

    pub fn get(&self, id: &str) -> Option<UserSubagentRecord> {
        self.subagents.iter().find(|s| s.id == id).cloned()
    }

    /// Definitions that apply to a session opened on `project_path`. A
    /// definition scoped elsewhere must be invisible rather than merely
    /// refused: a delegate the model can see is one it will try to call.
    pub fn active_for(&self, project_path: Option<&str>) -> Vec<UserSubagentRecord> {
        self.list()
            .into_iter()
            .filter(|s| s.enabled && s.scope.matches(project_path))
            .collect()
    }

    /// Resolve the name a create/update is asking for.
    ///
    /// Unlike skills, a duplicate is not auto-suffixed. The name is the handle
    /// the model types, and two definitions answering to one name means one of
    /// them silently loses — better reported at save time.
    fn resolve_name(&self, requested: &str, current: Option<&str>) -> Result<String> {
        let name = normalize_name(requested);
        if name.is_empty() {
            bail!("SUBAGENT_INVALID: name is required");
        }
        if !valid_name(&name) {
            bail!(
                "SUBAGENT_INVALID: invalid name \"{name}\": use lowercase letters, digits and dashes (max {MAX_NAME_CHARS} chars)"
            );
        }
        if current != Some(name.as_str()) {
            if self.get(&name).is_some() {
                bail!("SUBAGENT_INVALID: a subagent named \"{name}\" already exists");
            }
            if self.document_path(&name).exists() {
                bail!("SUBAGENT_INVALID: {name}.md already exists");
            }
        }
        Ok(name)
    }

    fn resolve_description(&self, requested: Option<&str>) -> Result<String> {
        let description = clip(requested.unwrap_or_default(), MAX_DESCRIPTION_CHARS);
        if description.is_empty() {
            bail!("SUBAGENT_INVALID: description is required");
        }
        Ok(description)
    }

    fn resolve_tools(&self, requested: Option<&Vec<String>>) -> Result<Vec<String>> {
        let Some(requested) = requested else {
            return Ok(DEFAULT_TOOLS.iter().map(|t| (*t).to_string()).collect());
        };
        if requested.is_empty() {
            return Ok(DEFAULT_TOOLS.iter().map(|t| (*t).to_string()).collect());
        }
        let tools = normalize_tools(requested);
        if tools.is_empty() {
            bail!(
                "SUBAGENT_INVALID: tools must be drawn from {}",
                ASSIGNABLE_TOOLS.join(", ")
            );
        }
        Ok(tools)
    }

    fn resolve_max_turns(&self, requested: Option<u32>) -> Option<u32> {
        requested
            .filter(|turns| *turns > 0)
            .map(|turns| turns.min(MAX_TURNS_CEILING))
    }

    fn write_document(&self, record: &UserSubagentRecord, body: &str) -> Result<String> {
        if body.trim().is_empty() {
            bail!("SUBAGENT_INVALID: document body is empty (nothing to instruct)");
        }
        let document = render_document(record, body);
        if document.len() > MAX_SUBAGENT_BYTES {
            bail!("SUBAGENT_INVALID: document exceeds {MAX_SUBAGENT_BYTES} bytes");
        }
        let path = PathBuf::from(&record.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        }
        fs::write(&path, &document).with_context(|| format!("write {}", path.display()))?;
        Ok(document)
    }

    pub fn create(&mut self, input: UserSubagentInput) -> Result<UserSubagentRecord> {
        if self.subagents.len() >= MAX_USER_SUBAGENTS {
            bail!("SUBAGENT_INVALID: at most {MAX_USER_SUBAGENTS} subagents");
        }
        let requested = input
            .id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .or(input.name.as_deref())
            .unwrap_or_default();
        let name = self.resolve_name(requested, None)?;
        let description = self.resolve_description(input.description.as_deref())?;
        let tools = self.resolve_tools(input.tools.as_ref())?;
        let body = input
            .body
            .as_deref()
            .map(str::to_string)
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| default_body(&name));
        let now = Utc::now().to_rfc3339();
        let mut record = UserSubagentRecord {
            id: name.clone(),
            name,
            description,
            enabled: input.enabled.unwrap_or(true),
            scope: input.scope.unwrap_or_default().normalized(),
            tools,
            model: input
                .model
                .as_deref()
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(str::to_string),
            thinking_level: input
                .thinking_level
                .as_deref()
                .and_then(normalize_thinking_level),
            max_turns: self.resolve_max_turns(input.max_turns),
            path: String::new(),
            size_bytes: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        record.path = self
            .document_path(&record.id)
            .to_string_lossy()
            .to_string();
        let document = self.write_document(&record, &body)?;
        record.size_bytes = document.len() as u64;
        self.subagents.push(record.clone());
        self.save()?;
        Ok(record)
    }

    /// Edit a stored definition. Renaming moves the document, because the
    /// filename and the frontmatter name are the same handle.
    pub fn update(
        &mut self,
        id: &str,
        input: UserSubagentInput,
    ) -> Result<Option<UserSubagentRecord>> {
        let Some(index) = self.subagents.iter().position(|s| s.id == id) else {
            return Ok(None);
        };
        let current = self.subagents[index].clone();
        let name = match input.name.as_deref().filter(|n| !n.trim().is_empty()) {
            Some(requested) => self.resolve_name(requested, Some(&current.name))?,
            None => current.name.clone(),
        };
        let description = match input.description.as_deref() {
            Some(value) => self.resolve_description(Some(value))?,
            None => current.description.clone(),
        };
        let tools = match input.tools.as_ref() {
            Some(requested) => self.resolve_tools(Some(requested))?,
            None => current.tools.clone(),
        };
        let body = match input.body.as_deref() {
            Some(value) => value.to_string(),
            None => strip_front_matter(&fs::read_to_string(&current.path).unwrap_or_default()),
        };
        let mut record = UserSubagentRecord {
            id: name.clone(),
            name,
            description,
            enabled: input.enabled.unwrap_or(current.enabled),
            scope: input.scope.unwrap_or(current.scope.clone()).normalized(),
            tools,
            model: match input.model.as_deref().map(str::trim) {
                Some("") => None,
                Some(value) => Some(value.to_string()),
                None => current.model.clone(),
            },
            thinking_level: match input.thinking_level.as_deref().map(str::trim) {
                Some("") => None,
                Some(value) => normalize_thinking_level(value),
                None => current.thinking_level.clone(),
            },
            max_turns: match input.max_turns {
                Some(_) => self.resolve_max_turns(input.max_turns),
                None => current.max_turns,
            },
            path: current.path.clone(),
            size_bytes: current.size_bytes,
            created_at: current.created_at.clone(),
            updated_at: Utc::now().to_rfc3339(),
        };
        if record.id != current.id {
            record.path = self.document_path(&record.id).to_string_lossy().to_string();
        }
        let document = self.write_document(&record, &body)?;
        record.size_bytes = document.len() as u64;
        if record.path != current.path {
            self.remove_document(&current);
        }
        self.subagents[index] = record.clone();
        self.save()?;
        Ok(Some(record))
    }

    /// Read a stored document back, front matter stripped.
    pub fn read(&self, id: &str) -> Result<Option<(UserSubagentRecord, String)>> {
        let Some(record) = self.get(id) else {
            return Ok(None);
        };
        let raw =
            fs::read_to_string(&record.path).with_context(|| format!("read {}", record.path))?;
        if raw.len() > MAX_SUBAGENT_BYTES {
            bail!("SUBAGENT_INVALID: document exceeds {MAX_SUBAGENT_BYTES} bytes");
        }
        Ok(Some((record, strip_front_matter(&raw))))
    }

    /// Delete a document, but only inside the store, so a registry edited by
    /// hand cannot aim the removal at an arbitrary file.
    fn remove_document(&self, record: &UserSubagentRecord) {
        let path = PathBuf::from(&record.path);
        if path.starts_with(self.agents_dir()) && path.is_file() {
            let _ = fs::remove_file(path);
        }
    }

    pub fn remove(&mut self, id: &str) -> Result<bool> {
        let Some(index) = self.subagents.iter().position(|s| s.id == id) else {
            return Ok(false);
        };
        let record = self.subagents.remove(index);
        self.remove_document(&record);
        self.save()?;
        Ok(true)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Option<UserSubagentRecord>> {
        let Some(subagent) = self.subagents.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        subagent.enabled = enabled;
        subagent.updated_at = Utc::now().to_rfc3339();
        let updated = subagent.clone();
        self.save()?;
        Ok(Some(updated))
    }

    pub fn set_scope(
        &mut self,
        id: &str,
        scope: ActivationScope,
    ) -> Result<Option<UserSubagentRecord>> {
        let Some(subagent) = self.subagents.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        subagent.scope = scope.normalized();
        subagent.updated_at = Utc::now().to_rfc3339();
        let updated = subagent.clone();
        self.save()?;
        Ok(Some(updated))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::ActivationMode;
    use tempfile::tempdir;

    fn input(name: &str) -> UserSubagentInput {
        UserSubagentInput {
            name: Some(name.to_string()),
            description: Some("Search the workspace".into()),
            ..Default::default()
        }
    }

    #[test]
    fn create_writes_a_document_the_shared_parser_can_read() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let record = registry.create(input("Deep Explorer")).unwrap();
        assert_eq!(record.id, "deep-explorer");
        assert_eq!(record.name, "deep-explorer");
        assert_eq!(record.tools, vec!["Read", "Glob", "Grep"]);
        assert!(record.enabled);
        let raw = fs::read_to_string(&record.path).unwrap();
        assert!(raw.starts_with("---\nname: deep-explorer\n"));
        assert!(raw.contains("description: Search the workspace\n"));
        assert!(raw.contains("tools: [Read, Glob, Grep]\n"));
        assert!(!raw.contains("model:"));
        assert_eq!(record.size_bytes, raw.len() as u64);
        assert_eq!(
            PathBuf::from(&record.path),
            dir.path().join("agents/deep-explorer.md")
        );
    }

    #[test]
    fn create_renders_every_declared_key() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let record = registry
            .create(UserSubagentInput {
                tools: Some(vec!["Bash".into(), "read".into(), "Nope".into()]),
                model: Some("anthropic/claude-haiku-4-5".into()),
                thinking_level: Some("HIGH".into()),
                max_turns: Some(30),
                body: Some("Run the command the task names.".into()),
                ..input("runner")
            })
            .unwrap();
        assert_eq!(record.tools, vec!["Bash", "Read"]);
        assert_eq!(record.thinking_level.as_deref(), Some("high"));
        let raw = fs::read_to_string(&record.path).unwrap();
        assert!(raw.contains("tools: [Bash, Read]\n"));
        assert!(raw.contains("model: anthropic/claude-haiku-4-5\n"));
        assert!(raw.contains("thinkingLevel: high\n"));
        assert!(raw.contains("maxTurns: 30\n"));
        assert!(raw.ends_with("Run the command the task names.\n"));
    }

    #[test]
    fn a_name_is_required_and_normalized() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let err = registry.create(input("   ")).unwrap_err().to_string();
        assert!(err.contains("name is required"), "{err}");
        let record = registry.create(input("My_Test Runner")).unwrap();
        assert_eq!(record.id, "my-test-runner");
    }

    #[test]
    fn a_description_is_required() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let err = registry
            .create(UserSubagentInput {
                description: None,
                ..input("explorer")
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("description is required"), "{err}");
    }

    #[test]
    fn a_duplicate_name_is_refused_rather_than_suffixed() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        registry.create(input("explorer")).unwrap();
        let err = registry.create(input("explorer")).unwrap_err().to_string();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn tools_must_be_drawn_from_the_assignable_set() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let err = registry
            .create(UserSubagentInput {
                tools: Some(vec!["Task".into(), "Skill".into()]),
                ..input("explorer")
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("must be drawn from"), "{err}");
    }

    #[test]
    fn an_empty_tool_list_falls_back_to_read_only() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let record = registry
            .create(UserSubagentInput {
                tools: Some(vec![]),
                ..input("explorer")
            })
            .unwrap();
        assert_eq!(record.tools, vec!["Read", "Glob", "Grep"]);
    }

    #[test]
    fn max_turns_is_clamped_and_zero_clears_it() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let record = registry
            .create(UserSubagentInput {
                max_turns: Some(500),
                ..input("explorer")
            })
            .unwrap();
        assert_eq!(record.max_turns, Some(MAX_TURNS_CEILING));
        let cleared = registry
            .update(
                "explorer",
                UserSubagentInput {
                    max_turns: Some(0),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(cleared.max_turns, None);
        assert!(!fs::read_to_string(&cleared.path).unwrap().contains("maxTurns"));
    }

    #[test]
    fn the_registry_is_capped() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        for index in 0..MAX_USER_SUBAGENTS {
            registry.create(input(&format!("agent-{index}"))).unwrap();
        }
        let err = registry.create(input("one-more")).unwrap_err().to_string();
        assert!(err.contains("at most"), "{err}");
    }

    #[test]
    fn an_oversized_body_is_refused() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let err = registry
            .create(UserSubagentInput {
                body: Some("x".repeat(MAX_SUBAGENT_BYTES + 1)),
                ..input("explorer")
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("exceeds"), "{err}");
    }

    #[test]
    fn update_edits_metadata_and_keeps_the_body() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        registry
            .create(UserSubagentInput {
                body: Some("Original instructions.".into()),
                ..input("explorer")
            })
            .unwrap();
        let updated = registry
            .update(
                "explorer",
                UserSubagentInput {
                    description: Some("Now reviews diffs".into()),
                    tools: Some(vec!["Read".into(), "Edit".into()]),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(updated.description, "Now reviews diffs");
        assert_eq!(updated.tools, vec!["Read", "Edit"]);
        let (_, body) = registry.read("explorer").unwrap().unwrap();
        assert_eq!(body, "Original instructions.");
    }

    #[test]
    fn renaming_moves_the_document() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let created = registry.create(input("explorer")).unwrap();
        let renamed = registry
            .update(
                "explorer",
                UserSubagentInput {
                    name: Some("wide-explorer".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(renamed.id, "wide-explorer");
        assert!(!PathBuf::from(&created.path).exists());
        assert!(PathBuf::from(&renamed.path).exists());
        assert!(registry.get("explorer").is_none());
        assert!(fs::read_to_string(&renamed.path)
            .unwrap()
            .contains("name: wide-explorer"));
    }

    #[test]
    fn renaming_onto_another_definition_is_refused() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        registry.create(input("explorer")).unwrap();
        registry.create(input("reviewer")).unwrap();
        let err = registry
            .update(
                "reviewer",
                UserSubagentInput {
                    name: Some("explorer".into()),
                    ..Default::default()
                },
            )
            .unwrap_err()
            .to_string();
        assert!(err.contains("already exists"), "{err}");
        assert!(registry.get("reviewer").is_some());
    }

    #[test]
    fn update_clears_a_model_pin_with_an_empty_string() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        registry
            .create(UserSubagentInput {
                model: Some("anthropic/claude-haiku-4-5".into()),
                ..input("explorer")
            })
            .unwrap();
        let cleared = registry
            .update(
                "explorer",
                UserSubagentInput {
                    model: Some("  ".into()),
                    ..Default::default()
                },
            )
            .unwrap()
            .unwrap();
        assert_eq!(cleared.model, None);
        assert!(!fs::read_to_string(&cleared.path).unwrap().contains("model:"));
    }

    #[test]
    fn update_and_read_miss_on_an_unknown_id() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        assert!(registry.update("nope", Default::default()).unwrap().is_none());
        assert!(registry.read("nope").unwrap().is_none());
        assert!(!registry.remove("nope").unwrap());
        assert!(registry.set_enabled("nope", false).unwrap().is_none());
    }

    #[test]
    fn active_for_filters_by_enabled_and_scope() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        registry.create(input("global-agent")).unwrap();
        registry.create(input("scoped-agent")).unwrap();
        registry.create(input("off-agent")).unwrap();
        registry.set_enabled("off-agent", false).unwrap();
        registry
            .set_scope(
                "scoped-agent",
                ActivationScope {
                    mode: ActivationMode::Projects,
                    projects: vec!["/tmp/one".into()],
                },
            )
            .unwrap();
        let names: Vec<String> = registry
            .active_for(Some("/tmp/one"))
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["global-agent", "scoped-agent"]);
        let elsewhere: Vec<String> = registry
            .active_for(Some("/tmp/two"))
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(elsewhere, vec!["global-agent"]);
    }

    #[test]
    fn remove_deletes_the_document_and_survives_a_reload() {
        let dir = tempdir().unwrap();
        let mut registry = UserSubagentRegistry::new(dir.path());
        let record = registry.create(input("explorer")).unwrap();
        registry.create(input("reviewer")).unwrap();
        assert!(registry.remove("explorer").unwrap());
        assert!(!PathBuf::from(&record.path).exists());
        let reloaded = UserSubagentRegistry::new(dir.path());
        let names: Vec<String> = reloaded.list().into_iter().map(|s| s.id).collect();
        assert_eq!(names, vec!["reviewer"]);
    }

    #[test]
    fn strip_front_matter_handles_an_unterminated_block() {
        assert_eq!(strip_front_matter("---\nname: x\nbody"), "---\nname: x\nbody");
        assert_eq!(strip_front_matter("no front matter"), "no front matter");
        assert_eq!(strip_front_matter("---\nname: x\n---\n\nBody.\n"), "Body.");
    }
}
