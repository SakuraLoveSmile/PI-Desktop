use super::*;
use rusqlite::{params, OptionalExtension};

use crate::db::{now_ms, Database};
use crate::providers::{self, delete_provider_row, provider_owner_plugin, ModelBinding};
use crate::secrets::SecretStore;

/// Upper bound on `contributes.providers` entries. Matches the SDK constant.
pub(crate) const MAX_PLUGIN_PROVIDERS: usize = 8;
/// Upper bound on one declaration's model list.
pub(crate) const MAX_PLUGIN_PROVIDER_MODELS: usize = 64;

/// Provider ids created from a manifest carry this prefix so a plugin row is
/// recognizable without a database read (ADR 0257). A user-created provider id
/// is a UUID and can never collide with it.
pub(crate) const PLUGIN_PROVIDER_ID_PREFIX: &str = "plugin:";

/// Wire styles a manifest may declare. Mirrors the `apiStyle` enum of the
/// provider config schema; an unknown value fails manifest validation.
const PLUGIN_API_STYLES: [&str; 7] = [
    "chat_completions",
    "opencode_go",
    "responses",
    "anthropic_messages",
    "google_generative_ai",
    "openai_codex_responses",
    "pi_messages",
];

/// Auth kinds a manifest may declare today. `oauth` is deliberately absent: a
/// plugin OAuth broker needs a Host-owned login flow that does not exist yet,
/// so a declaration that asks for one is refused instead of materializing a
/// row nobody can sign in to.
const PLUGIN_AUTH_KINDS: [&str; 2] = ["api_key", "none"];

pub(crate) fn is_known_api_style(value: &str) -> bool {
    PLUGIN_API_STYLES.contains(&value)
}

pub(crate) fn is_known_auth_kind(value: &str) -> bool {
    PLUGIN_AUTH_KINDS.contains(&value)
}

/// `providers.protocol` for a declared wire style, kept in step with the
/// mapping Electron main uses for vendor accounts (`protocolForApiStyle`).
fn protocol_for_api_style(api_style: &str) -> &'static str {
    match api_style {
        "anthropic_messages" => "anthropic",
        "responses" | "openai_codex_responses" => "openai",
        "google_generative_ai" => "google",
        "pi_messages" => "custom_http",
        _ => "openai_compatible",
    }
}

/// One provider a plugin declared in `contributes.providers`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeclaredPluginProvider {
    pub id: String,
    pub name: String,
    pub vendor_key: String,
    pub base_url: Option<String>,
    pub api_style: String,
    pub auth_kind: String,
    pub models: Vec<ModelBinding>,
}

/// The provider row id a declaration materializes as.
pub(crate) fn plugin_provider_row_id(plugin_id: &str, declared_id: &str) -> String {
    format!("{PLUGIN_PROVIDER_ID_PREFIX}{plugin_id}:{declared_id}")
}
/// Read `contributes.providers` off a manifest that has already passed
/// `validate_contributions`. Shapes that validation rejects are skipped here
/// rather than re-reported: this function runs on every load and must not be
/// the place a plugin learns about a manifest error.
pub(crate) fn declared_providers(manifest: &PluginManifest) -> Vec<DeclaredPluginProvider> {
    let Some(entries) = manifest
        .contributes
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|map| map.get("providers"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    entries
        .iter()
        .take(MAX_PLUGIN_PROVIDERS)
        .filter_map(|entry| {
            let obj = entry.as_object()?;
            let id = obj.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let api_style = obj
                .get("apiStyle")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| is_known_api_style(value))
                .unwrap_or("chat_completions")
                .to_string();
            let auth_kind = obj
                .get("authKind")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| is_known_auth_kind(value))
                .unwrap_or("api_key")
                .to_string();
            let models = obj
                .get("models")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .take(MAX_PLUGIN_PROVIDER_MODELS)
                        .filter_map(|item| {
                            let model = item.as_object()?;
                            let model_id = model.get("id")?.as_str()?.trim().to_string();
                            if model_id.is_empty() {
                                return None;
                            }
                            Some(ModelBinding {
                                id: model_id,
                                alias: model
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .map(str::trim)
                                    .filter(|value| !value.is_empty())
                                    .map(str::to_string),
                                context_window: model
                                    .get("contextWindow")
                                    .and_then(Value::as_u64)
                                    .and_then(|value| u32::try_from(value).ok())
                                    .unwrap_or(0),
                                max_tokens: model
                                    .get("maxTokens")
                                    .and_then(Value::as_u64)
                                    .and_then(|value| u32::try_from(value).ok())
                                    .unwrap_or(0),
                                thinking_levels: Vec::new(),
                                default_thinking_level: None,
                                supports_images: model
                                    .get("supportsImages")
                                    .and_then(Value::as_bool),
                                supports_documents: None,
                                available_for_subagents: None,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(DeclaredPluginProvider {
                id,
                name: obj
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        obj.get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    }),
                vendor_key: obj
                    .get("vendorKey")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| "custom".to_string()),
                base_url: obj
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                api_style,
                auth_kind,
                models,
            })
        })
        .collect()
}

/// Materialize a plugin's declared providers as rows owned by that plugin.
///
/// The declaration is authoritative for its own fields, so every load refreshes
/// them; what the *user* or the plugin's login flow wrote — the OAuth account
/// label, stored headers, and a default model that is still declared — is
/// carried across. A declaration the manifest no longer makes is dropped
/// together with both of its credential references, so a later re-declaration
/// can never inherit a stale token. Rows belonging to another plugin are never
/// touched.
pub(crate) fn sync_plugin_providers(
    db: &Database,
    secrets: &SecretStore,
    plugin_id: &str,
    declared: &[DeclaredPluginProvider],
    enabled: bool,
) -> Result<usize> {
    let now = now_ms();
    let mut written = 0usize;
    for provider in declared {
        let row_id = plugin_provider_row_id(plugin_id, &provider.id);
        if let Some(owner) = provider_owner_plugin(db, &row_id)? {
            if owner != plugin_id {
                bail!(
                    "PLUGIN_INVALID: provider {row_id} is owned by plugin {owner}, not {plugin_id}"
                );
            }
        }
        let existing_config: String = db
            .conn()
            .query_row(
                "SELECT config_json FROM providers WHERE id = ?1",
                params![row_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(|| "{}".to_string());
        let models = providers::normalize_model_bindings(&provider.models);
        // The merge replaces only the model bindings: headers and the OAuth
        // account label a login flow wrote are not this function's to drop.
        let config = providers::config_with_model_bindings(&existing_config, &models)?;
        // The public projection derives the default from the first binding, so
        // the declared order is the plugin's choice of default.
        let default_model_id = models.first().map(|model| model.id.clone());
        db.conn()
            .prepare_cached(
                "INSERT INTO providers (
                    id, name, vendor_key, type, protocol, enabled, base_url, auth_kind,
                    api_style, default_model_id, config_json, owner_plugin_id,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'openai_compatible', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    vendor_key = excluded.vendor_key,
                    protocol = excluded.protocol,
                    enabled = excluded.enabled,
                    base_url = excluded.base_url,
                    auth_kind = excluded.auth_kind,
                    api_style = excluded.api_style,
                    default_model_id = excluded.default_model_id,
                    config_json = excluded.config_json,
                    owner_plugin_id = excluded.owner_plugin_id,
                    updated_at = excluded.updated_at
                 WHERE providers.owner_plugin_id = excluded.owner_plugin_id",
            )?
            .execute(params![
                row_id,
                provider.name,
                provider.vendor_key,
                protocol_for_api_style(&provider.api_style),
                if enabled { 1 } else { 0 },
                provider.base_url,
                provider.auth_kind,
                provider.api_style,
                default_model_id,
                config,
                plugin_id,
                now
            ])?;
        written += 1;
    }
    let declared_rows: Vec<String> = declared
        .iter()
        .map(|provider| plugin_provider_row_id(plugin_id, &provider.id))
        .collect();
    for row_id in owned_provider_ids(db, plugin_id)? {
        if !declared_rows.contains(&row_id) {
            delete_provider_row(db, secrets, &row_id)?;
        }
    }
    Ok(written)
}

/// Turn every row a plugin owns off, keeping the credential and the user's
/// selections for the moment the plugin is enabled again.
pub(crate) fn set_plugin_providers_enabled(
    db: &Database,
    plugin_id: &str,
    enabled: bool,
) -> Result<usize> {
    let changed = db
        .conn()
        .prepare_cached(
            "UPDATE providers SET enabled = ?2, updated_at = ?3
             WHERE owner_plugin_id = ?1",
        )?
        .execute(params![plugin_id, if enabled { 1 } else { 0 }, now_ms()])?;
    Ok(changed)
}

/// Every provider row id a plugin owns.
pub(crate) fn owned_provider_ids(db: &Database, plugin_id: &str) -> Result<Vec<String>> {
    let mut stmt = db
        .conn()
        .prepare_cached("SELECT id FROM providers WHERE owner_plugin_id = ?1")?;
    let rows = stmt.query_map(params![plugin_id], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
}

/// Drop every row a plugin owns and both of its credential references. Used on
/// uninstall, where the declaration is gone for good.
pub(crate) fn remove_plugin_providers(
    db: &Database,
    secrets: &SecretStore,
    plugin_id: &str,
) -> Result<usize> {
    let ids = owned_provider_ids(db, plugin_id)?;
    for id in &ids {
        delete_provider_row(db, secrets, id)?;
    }
    Ok(ids.len())
}

/// Bring the database in line with what one plugin declares.
///
/// Callers treat a failure as a warning: the plugin's enablement has already
/// been decided, and a provider sync must never undo it.
pub(crate) fn reconcile_plugin(
    db: &Database,
    secrets: &SecretStore,
    plugins: &PluginManager,
    plugin_id: &str,
    enabled: bool,
) -> Result<usize> {
    let declared = match plugins.manifest_for(plugin_id)? {
        Some(manifest) => declared_providers(&manifest),
        None => Vec::new(),
    };
    sync_plugin_providers(db, secrets, plugin_id, &declared, enabled)
}

/// The same reconciliation for every registered plugin, used once at startup so
/// the provider table reflects the registry whatever path enabled a plugin.
pub(crate) fn reconcile_all(
    db: &Database,
    secrets: &SecretStore,
    plugins: &PluginManager,
) -> Result<usize> {
    let mut written = 0usize;
    for plugin in plugins.list() {
        let declared = match plugins.manifest_for(&plugin.id) {
            Ok(Some(manifest)) => declared_providers(&manifest),
            Ok(None) => Vec::new(),
            Err(error) => {
                tracing::warn!(plugin = %plugin.id, %error, "plugin manifest unreadable; providers left as they are");
                continue;
            }
        };
        written += sync_plugin_providers(db, secrets, &plugin.id, &declared, plugin.enabled)?;
    }
    Ok(written)
}

impl PluginManager {
    /// The manifest of a registered plugin, re-read from disk.
    ///
    /// The declaration on disk is the source of truth for contributions, so a
    /// provider sync reads it rather than a copy captured at install time.
    pub(crate) fn manifest_for(&self, id: &str) -> Result<Option<PluginManifest>> {
        let Some(plugin) = self.runtime.iter().find(|p| p.id == id) else {
            return Ok(None);
        };
        let path = match plugin.path.as_deref() {
            Some(path) => PathBuf::from(path),
            // An installed plugin that never recorded a path lives in the
            // standard install directory.
            None => self.installed_dir(id),
        };
        if !path.is_dir() {
            return Ok(None);
        }
        Ok(Some(Self::read_manifest(&path)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SCHEMA_VERSION;
    use serde_json::json;
    use std::fs;

    fn test_context() -> (tempfile::TempDir, Database, SecretStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let secrets = SecretStore::open(dir.path()).unwrap();
        (dir, db, secrets)
    }

    /// A manifest that declares one API-key provider with two models.
    fn manifest() -> PluginManifest {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "id": "demo.provider",
            "name": "Demo provider",
            "version": "0.1.0",
            "main": "main.js",
            "permissions": ["provider.register"],
            "contributes": {
                "providers": [{
                    "id": "demo",
                    "name": "Demo",
                    "baseUrl": "https://api.example.com/v1",
                    "apiStyle": "chat_completions",
                    "authKind": "api_key",
                    "models": [
                        { "id": "demo-large", "name": "Demo Large", "contextWindow": 200000, "maxTokens": 8192 },
                        { "id": "demo-small" }
                    ]
                }]
            }
        }))
        .unwrap()
    }

    fn write_plugin(root: &std::path::Path, manifest: Value) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("main.js"), "export function onLoad() {}").unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    fn read_manifest_err(root: &std::path::Path) -> String {
        PluginManager::read_manifest(root)
            .expect_err("manifest should be rejected")
            .to_string()
    }

    fn declaration_manifest(providers: Value, permissions: Value) -> Value {
        json!({
            "schemaVersion": 1,
            "id": "demo.declared",
            "name": "Declared",
            "version": "0.1.0",
            "main": "main.js",
            "contributes": { "providers": providers },
            "permissions": permissions,
        })
    }

    #[test]
    fn schema_is_v17_with_the_owner_column() {
        let (_dir, db, _secrets) = test_context();
        assert_eq!(SCHEMA_VERSION, 17);
        let version: i64 = db
            .conn()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 17);
        let has_owner: bool = db
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('providers') WHERE name = 'owner_plugin_id')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_owner);
    }

    #[test]
    fn declared_providers_reads_the_manifest() {
        let declared = declared_providers(&manifest());
        assert_eq!(declared.len(), 1);
        let provider = &declared[0];
        assert_eq!(provider.id, "demo");
        assert_eq!(provider.api_style, "chat_completions");
        assert_eq!(provider.auth_kind, "api_key");
        assert_eq!(
            provider.base_url.as_deref(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(
            provider
                .models
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            ["demo-large", "demo-small"]
        );
        assert_eq!(provider.models[0].context_window, 200_000);
        // A model that declares no limits falls back to the runtime default
        // instead of storing a zero window.
        assert_eq!(provider.models[1].context_window, 0);
    }

    #[test]
    fn sync_writes_rows_owned_by_the_plugin() {
        let (_dir, db, secrets) = test_context();
        let declared = declared_providers(&manifest());
        assert_eq!(
            sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap(),
            1
        );
        let listed = providers::list_providers(&db, &secrets, true).unwrap();
        assert_eq!(listed.len(), 1);
        let row = &listed[0];
        assert_eq!(row.id, "plugin:demo.provider:demo");
        assert_eq!(row.owner_plugin_id.as_deref(), Some("demo.provider"));
        assert_eq!(row.auth_kind, "api_key");
        assert_eq!(row.name, "Demo");
        assert!(row.enabled);
        assert_eq!(row.default_model_id.as_deref(), Some("demo-large"));
        assert_eq!(row.models.len(), 2);
        assert_eq!(row.models[0].id, "demo-large");
        // A plugin row carries no declared API key: the credential is the
        // user's, stored under the same provider-scoped refs as any other row.
        assert!(!row.has_secret);
    }

    #[test]
    fn sync_is_declarative_and_drops_a_removed_declaration() {
        let (_dir, db, secrets) = test_context();
        let declared = declared_providers(&manifest());
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        let key_ref = crate::secrets::secret_ref_for_provider("plugin:demo.provider:demo");
        secrets.set(&key_ref, "sk-demo").unwrap();
        // A plugin update that stops declaring the provider must not leave the
        // row (or its credential) behind.
        sync_plugin_providers(&db, &secrets, "demo.provider", &[], true).unwrap();
        assert!(
            providers::get_provider(&db, &secrets, "plugin:demo.provider:demo")
                .unwrap()
                .is_none()
        );
        assert!(!secrets.has(&key_ref));
    }

    #[test]
    fn sync_keeps_provider_config_it_does_not_own() {
        let (_dir, db, secrets) = test_context();
        let declared = declared_providers(&manifest());
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        db.conn()
            .execute(
                "UPDATE providers SET config_json = ?1 WHERE id = 'plugin:demo.provider:demo'",
                params![json!({ "oauth": { "accountLabel": "kept" } }).to_string()],
            )
            .unwrap();
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        let row = providers::get_provider(&db, &secrets, "plugin:demo.provider:demo")
            .unwrap()
            .unwrap();
        // The merge replaces only the model bindings it owns, so a value the
        // plugin's own login flow stored survives the next load.
        assert_eq!(row.oauth_account_label.as_deref(), Some("kept"));
        assert_eq!(
            row.models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["demo-large", "demo-small"]
        );
    }

    #[test]
    fn disabling_and_removing_a_plugin_take_its_rows_with_it() {
        let (_dir, db, secrets) = test_context();
        let declared = declared_providers(&manifest());
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        assert_eq!(
            set_plugin_providers_enabled(&db, "demo.provider", false).unwrap(),
            1
        );
        assert!(
            !providers::get_provider(&db, &secrets, "plugin:demo.provider:demo")
                .unwrap()
                .unwrap()
                .enabled
        );
        let key_ref = crate::secrets::secret_ref_for_provider("plugin:demo.provider:demo");
        secrets.set(&key_ref, "sk-demo").unwrap();
        assert_eq!(
            remove_plugin_providers(&db, &secrets, "demo.provider").unwrap(),
            1
        );
        assert!(
            providers::get_provider(&db, &secrets, "plugin:demo.provider:demo")
                .unwrap()
                .is_none()
        );
        assert!(!secrets.has(&key_ref));
    }

    #[test]
    fn a_user_row_is_never_adopted_or_removed() {
        let (_dir, db, secrets) = test_context();
        let user = providers::create_provider(
            &db,
            &secrets,
            providers::ProviderCreateInput {
                name: "Mine".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: Some("none".into()),
                models: None,
                default_model_id: Some("model-1".into()),
                secret_value: None,
                api_style: None,
                oauth_account_label: None,
                headers: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
            },
        )
        .unwrap();
        let declared = declared_providers(&manifest());
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        assert_eq!(
            remove_plugin_providers(&db, &secrets, "demo.provider").unwrap(),
            1
        );
        assert!(providers::get_provider(&db, &secrets, &user.id)
            .unwrap()
            .is_some());
        assert_eq!(
            providers::list_providers(&db, &secrets, true)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn the_user_path_refuses_a_plugin_owned_row() {
        let (_dir, db, secrets) = test_context();
        let declared = declared_providers(&manifest());
        sync_plugin_providers(&db, &secrets, "demo.provider", &declared, true).unwrap();
        let id = "plugin:demo.provider:demo";
        let delete_error = providers::delete_provider(&db, &secrets, id)
            .expect_err("the user path cannot delete a plugin row")
            .to_string();
        assert!(delete_error.contains("PROVIDER_OWNED_BY_PLUGIN"));
        let update_error = providers::update_provider(
            &db,
            &secrets,
            providers::ProviderUpdateInput {
                id: id.into(),
                name: Some("Renamed".into()),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: None,
                models: None,
                default_model_id: None,
                secret_value: None,
                api_style: None,
                oauth_account_label: None,
                headers: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                enabled: None,
            },
        )
        .expect_err("the user path cannot edit a plugin row")
        .to_string();
        assert!(update_error.contains("PROVIDER_OWNED_BY_PLUGIN"));
        let row = providers::get_provider(&db, &secrets, id).unwrap().unwrap();
        assert_eq!(row.name, "Demo");
    }

    #[test]
    fn the_declaration_requires_the_permission() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("plugin");
        let providers = json!([{
            "id": "demo",
            "name": "Demo",
            "baseUrl": "https://api.example.com/v1",
            "models": [{ "id": "demo-large" }]
        }]);
        write_plugin(&root, declaration_manifest(providers.clone(), json!([])));
        assert!(read_manifest_err(&root).contains("provider.register"));
        write_plugin(
            &root,
            declaration_manifest(providers, json!(["provider.register"])),
        );
        assert!(PluginManager::read_manifest(&root).is_ok());
    }

    #[test]
    fn the_declaration_shape_is_validated() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("plugin");
        let permissions = json!(["provider.register"]);

        // An endpoint the runtime would reach must be an absolute http(s) URL.
        write_plugin(
            &root,
            declaration_manifest(
                json!([{ "id": "demo", "name": "Demo", "baseUrl": "file:///etc/passwd",
                         "models": [{ "id": "m" }] }]),
                permissions.clone(),
            ),
        );
        assert!(read_manifest_err(&root).contains("http(s) URL"));

        // A model list is required and bounded.
        write_plugin(
            &root,
            declaration_manifest(
                json!([{ "id": "demo", "name": "Demo", "models": [] }]),
                permissions.clone(),
            ),
        );
        assert!(read_manifest_err(&root).contains("1 to 64 models"));

        write_plugin(
            &root,
            declaration_manifest(
                json!([{ "id": "demo", "name": "Demo",
                         "models": [{ "id": "m" }, { "id": "m" }] }]),
                permissions.clone(),
            ),
        );
        assert!(read_manifest_err(&root).contains("declares model m twice"));

        // OAuth needs the Host-owned login flow, which does not exist yet.
        write_plugin(
            &root,
            declaration_manifest(
                json!([{ "id": "demo", "name": "Demo", "authKind": "oauth",
                         "models": [{ "id": "m" }] }]),
                permissions,
            ),
        );
        assert!(read_manifest_err(&root).contains("unsupported authKind oauth"));

        write_plugin(
            &root,
            declaration_manifest(
                json!([{ "id": "demo", "name": "Demo", "authKind": "oauth",
                         "oauth": { "label": "Demo" }, "models": [{ "id": "m" }] }]),
                json!(["provider.register"]),
            ),
        );
        assert!(read_manifest_err(&root).contains("not supported in this release"));
    }
}
