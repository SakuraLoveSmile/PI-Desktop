use crate::activation::ActivationScope;
use anyhow::{bail, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// MCP servers the user configured themselves, with no plugin around them.
///
/// ADR 0038 put MCP behind a plugin manifest because a plugin's endpoints should
/// be reviewable text rather than a runtime decision. That reasoning holds for
/// third-party code and not for the user's own configuration: someone who types
/// a command and a URL has already made the decision the manifest review exists
/// to obtain. So this registry is the same record shape without the plugin —
/// host-core owns the persistence, Electron main owns the connection, and both
/// kinds of server reach the agent through one client implementation.
const MAX_SERVERS: usize = 32;
const MAX_ARGS: usize = 64;
const MAX_ENV_ENTRIES: usize = 64;
const MAX_HEADERS: usize = 32;
const MAX_VALUE_BYTES: usize = 4096;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRecord {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `stdio` or `http`; the transport decides which half of the record is set.
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
    pub enabled: bool,
    #[serde(default)]
    pub scope: ActivationScope,
    pub created_at: String,
    pub updated_at: String,
}

/// What `mcp.upsert` accepts. Absent optional fields on an edit keep the stored
/// value, so the UI can patch a single field without resending the record.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    pub id: String,
    pub label: Option<String>,
    pub description: Option<String>,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub enabled: Option<bool>,
    pub scope: Option<ActivationScope>,
}

pub struct McpServerRegistry {
    data_dir: PathBuf,
    servers: Vec<McpServerRecord>,
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    if id.len() > 64 {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn valid_header_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Loopback endpoints may use plain http; anything else must be https, so a
/// server that receives tool arguments cannot be configured to receive them in
/// the clear across a network.
fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']').to_lowercase();
    if host == "localhost" || host == "::1" || host == "0:0:0:0:0:0:0:1" {
        return true;
    }
    let mut parts = host.split('.');
    let first = parts.next();
    if first != Some("127") {
        return false;
    }
    let rest: Vec<&str> = parts.collect();
    rest.len() == 3
        && rest
            .iter()
            .all(|part| !part.is_empty() && part.len() <= 3 && part.chars().all(|c| c.is_ascii_digit()))
}

/// Split `scheme://host[:port]/rest` far enough to check the scheme and host.
/// A dependency-free check is enough here: the client in Electron main parses
/// the URL properly, and this only has to refuse the shapes we never accept.
fn check_url(url: &str) -> Result<()> {
    let lower = url.trim().to_lowercase();
    let (scheme, rest) = match lower.split_once("://") {
        Some(pair) => pair,
        None => bail!("MCP_INVALID: url must be absolute"),
    };
    if rest.is_empty() {
        bail!("MCP_INVALID: url must include a host");
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        bail!("MCP_INVALID: url must include a host");
    }
    // Strip credentials and the port; an IPv6 literal keeps its brackets.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(end) = host_port.find(']') {
        &host_port[..=end]
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };
    match scheme {
        "https" => Ok(()),
        "http" => {
            if is_loopback_host(host) {
                Ok(())
            } else {
                bail!("MCP_INVALID: url must use https outside loopback")
            }
        }
        _ => bail!("MCP_INVALID: url must use http or https"),
    }
}

fn check_len(field: &str, value: &str) -> Result<()> {
    if value.len() > MAX_VALUE_BYTES {
        bail!("MCP_INVALID: {field} is too long");
    }
    Ok(())
}

impl McpServerRegistry {
    pub fn new(data_dir: &std::path::Path) -> Self {
        let mut registry = Self {
            data_dir: data_dir.to_path_buf(),
            servers: Vec::new(),
        };
        let _ = registry.reload_from_disk();
        registry
    }

    fn registry_path(&self) -> PathBuf {
        self.data_dir.join("mcp/servers.json")
    }

    pub fn reload_from_disk(&mut self) -> Result<()> {
        let path = self.registry_path();
        if !path.exists() {
            self.servers.clear();
            return Ok(());
        }
        let raw = fs::read_to_string(path)?;
        self.servers = serde_json::from_str(&raw).unwrap_or_default();
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let path = self.registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(&self.servers)?)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<McpServerRecord> {
        let mut servers = self.servers.clone();
        servers.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()).then(a.id.cmp(&b.id)));
        servers
    }

    pub fn get(&self, id: &str) -> Option<McpServerRecord> {
        self.servers.iter().find(|s| s.id == id).cloned()
    }

    /// Create or edit one server. Validation is total: a stored record is always
    /// one the client can attempt to connect to.
    pub fn upsert(&mut self, input: McpServerInput) -> Result<McpServerRecord> {
        let id = input.id.trim().to_string();
        if !valid_id(&id) {
            bail!("MCP_INVALID: id must match [a-zA-Z][a-zA-Z0-9_-]{{0,63}}");
        }
        let existing = self.get(&id);
        if existing.is_none() && self.servers.len() >= MAX_SERVERS {
            bail!("MCP_INVALID: at most {MAX_SERVERS} MCP servers");
        }
        let transport = input
            .transport
            .clone()
            .or_else(|| existing.as_ref().map(|e| e.transport.clone()))
            .unwrap_or_default();
        if transport != "stdio" && transport != "http" {
            bail!("MCP_INVALID: transport must be \"stdio\" or \"http\"");
        }
        // A transport change must not leave the other transport's fields behind,
        // so each branch reads only its own half of the previous record.
        let same_transport = existing
            .as_ref()
            .map(|e| e.transport == transport)
            .unwrap_or(false);
        let previous = if same_transport {
            existing.as_ref()
        } else {
            None
        };

        let mut record = McpServerRecord {
            id: id.clone(),
            label: input
                .label
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .or_else(|| existing.as_ref().map(|e| e.label.clone()))
                .unwrap_or_else(|| id.clone()),
            description: input
                .description
                .map(|d| d.trim().to_string())
                .filter(|d| !d.is_empty())
                .or_else(|| existing.as_ref().and_then(|e| e.description.clone())),
            transport: transport.clone(),
            command: None,
            args: Vec::new(),
            env: BTreeMap::new(),
            url: None,
            headers: BTreeMap::new(),
            enabled: input
                .enabled
                .or_else(|| existing.as_ref().map(|e| e.enabled))
                .unwrap_or(true),
            scope: input
                .scope
                .or_else(|| existing.as_ref().map(|e| e.scope.clone()))
                .unwrap_or_default()
                .normalized(),
            created_at: existing
                .as_ref()
                .map(|e| e.created_at.clone())
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            updated_at: Utc::now().to_rfc3339(),
        };
        check_len("label", &record.label)?;
        if let Some(description) = &record.description {
            check_len("description", description)?;
        }

        if transport == "stdio" {
            if input.url.is_some() || input.headers.is_some() {
                bail!("MCP_INVALID: a stdio server must not set url or headers");
            }
            let command = input
                .command
                .map(|c| c.trim().to_string())
                .filter(|c| !c.is_empty())
                .or_else(|| previous.and_then(|e| e.command.clone()));
            let Some(command) = command else {
                bail!("MCP_INVALID: a stdio server requires command");
            };
            check_len("command", &command)?;
            if command.split(['/', '\\']).any(|part| part == "..") {
                bail!("MCP_INVALID: command must not contain \"..\"");
            }
            record.command = Some(command);
            let args = input
                .args
                .or_else(|| previous.map(|e| e.args.clone()))
                .unwrap_or_default();
            if args.len() > MAX_ARGS {
                bail!("MCP_INVALID: at most {MAX_ARGS} args");
            }
            for arg in &args {
                check_len("args", arg)?;
            }
            record.args = args;
            let env = input
                .env
                .or_else(|| previous.map(|e| e.env.clone()))
                .unwrap_or_default();
            if env.len() > MAX_ENV_ENTRIES {
                bail!("MCP_INVALID: at most {MAX_ENV_ENTRIES} env entries");
            }
            for (key, value) in &env {
                if !valid_env_key(key) {
                    bail!("MCP_INVALID: env key \"{key}\" is not allowed");
                }
                check_len("env", value)?;
            }
            record.env = env;
        } else {
            if input.command.is_some() || input.args.is_some() || input.env.is_some() {
                bail!("MCP_INVALID: an http server must not set command, args or env");
            }
            let url = input
                .url
                .map(|u| u.trim().to_string())
                .filter(|u| !u.is_empty())
                .or_else(|| previous.and_then(|e| e.url.clone()));
            let Some(url) = url else {
                bail!("MCP_INVALID: an http server requires url");
            };
            check_len("url", &url)?;
            check_url(&url)?;
            record.url = Some(url);
            let headers = input
                .headers
                .or_else(|| previous.map(|e| e.headers.clone()))
                .unwrap_or_default();
            if headers.len() > MAX_HEADERS {
                bail!("MCP_INVALID: at most {MAX_HEADERS} headers");
            }
            for (key, value) in &headers {
                if !valid_header_key(key) {
                    bail!("MCP_INVALID: header key \"{key}\" is not allowed");
                }
                check_len("headers", value)?;
            }
            record.headers = headers;
        }

        self.servers.retain(|s| s.id != id);
        self.servers.push(record.clone());
        self.save()?;
        Ok(record)
    }

    pub fn remove(&mut self, id: &str) -> Result<bool> {
        let before = self.servers.len();
        self.servers.retain(|s| s.id != id);
        let removed = self.servers.len() != before;
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Option<McpServerRecord>> {
        let Some(server) = self.servers.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        server.enabled = enabled;
        server.updated_at = Utc::now().to_rfc3339();
        let updated = server.clone();
        self.save()?;
        Ok(Some(updated))
    }

    pub fn set_scope(&mut self, id: &str, scope: ActivationScope) -> Result<Option<McpServerRecord>> {
        let Some(server) = self.servers.iter_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        server.scope = scope.normalized();
        server.updated_at = Utc::now().to_rfc3339();
        let updated = server.clone();
        self.save()?;
        Ok(Some(updated))
    }

    /// Servers that apply to a session opened on `project_path`.
    pub fn active_for(&self, project_path: Option<&str>) -> Vec<McpServerRecord> {
        self.list()
            .into_iter()
            .filter(|s| s.enabled && s.scope.matches(project_path))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::ActivationMode;

    fn registry() -> (tempfile::TempDir, McpServerRegistry) {
        let dir = tempfile::tempdir().unwrap();
        let registry = McpServerRegistry::new(dir.path());
        (dir, registry)
    }

    fn stdio(id: &str) -> McpServerInput {
        McpServerInput {
            id: id.into(),
            transport: Some("stdio".into()),
            command: Some("npx".into()),
            args: Some(vec!["-y".into(), "server".into()]),
            ..Default::default()
        }
    }

    #[test]
    fn upsert_defaults_to_enabled_and_global() {
        let (_dir, mut registry) = registry();
        let record = registry.upsert(stdio("files")).unwrap();
        assert!(record.enabled);
        assert_eq!(record.scope.mode, ActivationMode::Global);
        assert_eq!(record.label, "files");
        assert_eq!(registry.list().len(), 1);
    }

    #[test]
    fn upsert_survives_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut registry = McpServerRegistry::new(dir.path());
            registry.upsert(stdio("files")).unwrap();
        }
        let reopened = McpServerRegistry::new(dir.path());
        assert_eq!(reopened.list().len(), 1);
        assert_eq!(reopened.get("files").unwrap().command.as_deref(), Some("npx"));
    }

    #[test]
    fn a_patch_keeps_unsent_fields() {
        let (_dir, mut registry) = registry();
        registry.upsert(stdio("files")).unwrap();
        let patched = registry
            .upsert(McpServerInput {
                id: "files".into(),
                label: Some("Files".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(patched.label, "Files");
        assert_eq!(patched.command.as_deref(), Some("npx"));
        assert_eq!(patched.args, vec!["-y".to_string(), "server".to_string()]);
    }

    #[test]
    fn changing_transport_drops_the_other_transports_fields() {
        let (_dir, mut registry) = registry();
        registry.upsert(stdio("files")).unwrap();
        let switched = registry
            .upsert(McpServerInput {
                id: "files".into(),
                transport: Some("http".into()),
                url: Some("https://mcp.example.com/sse".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(switched.command, None);
        assert!(switched.args.is_empty());
        assert_eq!(switched.url.as_deref(), Some("https://mcp.example.com/sse"));
    }

    #[test]
    fn transports_may_not_mix_fields() {
        let (_dir, mut registry) = registry();
        let err = registry
            .upsert(McpServerInput {
                id: "mixed".into(),
                transport: Some("stdio".into()),
                command: Some("npx".into()),
                url: Some("https://example.com".into()),
                ..Default::default()
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("must not set url"), "{err}");
    }

    #[test]
    fn remote_urls_must_be_https_outside_loopback() {
        let (_dir, mut registry) = registry();
        let err = registry
            .upsert(McpServerInput {
                id: "remote".into(),
                transport: Some("http".into()),
                url: Some("http://mcp.example.com/sse".into()),
                ..Default::default()
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("https"), "{err}");
        assert!(registry
            .upsert(McpServerInput {
                id: "local".into(),
                transport: Some("http".into()),
                url: Some("http://127.0.0.1:3000/mcp".into()),
                ..Default::default()
            })
            .is_ok());
        assert!(registry
            .upsert(McpServerInput {
                id: "loopname".into(),
                transport: Some("http".into()),
                url: Some("http://localhost:3000/mcp".into()),
                ..Default::default()
            })
            .is_ok());
    }

    #[test]
    fn ids_are_constrained() {
        let (_dir, mut registry) = registry();
        for bad in ["", "1files", "files/../etc", "with space"] {
            assert!(registry
                .upsert(McpServerInput {
                    id: bad.into(),
                    transport: Some("stdio".into()),
                    command: Some("npx".into()),
                    ..Default::default()
                })
                .is_err());
        }
    }

    #[test]
    fn env_keys_are_constrained() {
        let (_dir, mut registry) = registry();
        let mut env = BTreeMap::new();
        env.insert("BAD-KEY".to_string(), "x".to_string());
        let err = registry
            .upsert(McpServerInput {
                id: "files".into(),
                transport: Some("stdio".into()),
                command: Some("npx".into()),
                env: Some(env),
                ..Default::default()
            })
            .unwrap_err()
            .to_string();
        assert!(err.contains("env key"), "{err}");
    }

    #[test]
    fn active_for_honours_enabled_and_scope() {
        let (_dir, mut registry) = registry();
        registry.upsert(stdio("everywhere")).unwrap();
        registry.upsert(stdio("scoped")).unwrap();
        registry.upsert(stdio("off")).unwrap();
        registry.set_enabled("off", false).unwrap();
        registry
            .set_scope(
                "scoped",
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
        assert_eq!(ids(None), vec!["everywhere"]);
    }

    #[test]
    fn remove_reports_whether_it_matched() {
        let (_dir, mut registry) = registry();
        registry.upsert(stdio("files")).unwrap();
        assert!(registry.remove("files").unwrap());
        assert!(!registry.remove("files").unwrap());
    }
}
