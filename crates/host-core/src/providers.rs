use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::{ms_to_ts, now_ms, Database};
use crate::secrets::{secret_ref_for_provider, SecretStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPublic {
    pub id: String,
    pub name: String,
    pub vendor_key: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub protocol: String,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub auth_kind: String,
    pub has_secret: bool,
    pub default_model_id: Option<String>,
    pub api_style: Option<String>,
    /// Explicit provider-level reasoning override.  `None` means the model
    /// catalog resolver should infer capability from the selected model.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_reasoning: Option<bool>,
    /// Optional sparse thinking-level override for custom/compatible models.
    /// `None` keeps catalog/default level resolution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported_thinking_levels: Option<Vec<String>>,
    /// Model context window override in tokens. `None` uses the runtime default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// Max output tokens override. `None` uses the runtime default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    /// Sampling temperature override. `None` leaves the provider default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCreateInput {
    pub name: String,
    pub vendor_key: Option<String>,
    #[serde(rename = "type")]
    pub provider_type: Option<String>,
    pub protocol: Option<String>,
    pub base_url: Option<String>,
    pub auth_kind: Option<String>,
    pub default_model_id: Option<String>,
    pub secret_value: Option<String>,
    pub api_style: Option<String>,
    pub supports_reasoning: Option<bool>,
    pub supported_thinking_levels: Option<Vec<String>>,
    /// Zero (or negative temperature) clears a stored override.
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdateInput {
    pub id: String,
    pub name: Option<String>,
    pub vendor_key: Option<String>,
    #[serde(rename = "type")]
    pub provider_type: Option<String>,
    pub protocol: Option<String>,
    pub base_url: Option<String>,
    pub auth_kind: Option<String>,
    pub default_model_id: Option<String>,
    pub secret_value: Option<String>,
    pub api_style: Option<String>,
    pub supports_reasoning: Option<bool>,
    pub supported_thinking_levels: Option<Vec<String>>,
    /// Zero (or negative temperature) clears a stored override.
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogItem {
    pub provider_id: String,
    pub model_id: String,
    pub display_name: String,
    pub source: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModelInput {
    pub model_id: String,
    pub display_name: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub context_window: Option<u32>,
}

const PROVIDER_SELECT: &str =
    "SELECT id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, secret_ref,
            default_model_id, api_style, config_json, created_at, updated_at
     FROM providers";

const CANONICAL_THINKING_LEVELS: &[&str] =
    &["off", "minimal", "low", "medium", "high", "xhigh", "max"];

fn config_value(raw: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Value>(raw).ok()
}

fn config_reasoning_override(raw: &str) -> Option<bool> {
    config_value(raw).and_then(|v| v.get("compatibility")?.get("supportsReasoning")?.as_bool())
}

fn normalize_thinking_levels(levels: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for level in levels {
        let trimmed = level.trim();
        if !CANONICAL_THINKING_LEVELS.contains(&trimmed) {
            continue;
        }
        if !out.iter().any(|existing| existing == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn config_thinking_levels_override(raw: &str) -> Option<Vec<String>> {
    let levels = config_value(raw)?
        .get("compatibility")?
        .get("supportedThinkingLevels")?
        .as_array()
        .cloned()?;
    let parsed: Vec<String> = levels
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect();
    let normalized = normalize_thinking_levels(&parsed);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn config_limit_u32(raw: &str, key: &str) -> Option<u32> {
    let value = config_value(raw)?.get("limits")?.get(key)?.as_u64()?;
    u32::try_from(value).ok().filter(|v| *v > 0)
}

fn config_limit_f64(raw: &str, key: &str) -> Option<f64> {
    config_value(raw)?.get("limits")?.get(key)?.as_f64()
}

fn ensure_config_object(raw: &str) -> Result<serde_json::Value> {
    let config: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| anyhow::anyhow!("provider config_json is invalid: {e}"))?;
    if !config.is_object() {
        return Err(anyhow::anyhow!(
            "provider config_json must be a JSON object"
        ));
    }
    Ok(config)
}

fn compatibility_object(
    config: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>> {
    let object = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("provider config_json must be a JSON object"))?;
    let compatibility = object
        .entry("compatibility")
        .or_insert_with(|| serde_json::json!({}));
    compatibility
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("provider config_json.compatibility must be a JSON object"))
}

fn limits_object(
    config: &mut serde_json::Value,
) -> Result<&mut serde_json::Map<String, serde_json::Value>> {
    let object = config
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("provider config_json must be a JSON object"))?;
    let limits = object
        .entry("limits")
        .or_insert_with(|| serde_json::json!({}));
    limits
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("provider config_json.limits must be a JSON object"))
}

/// Set or clear a `limits.<key>` override. `None` removes the key so runtime
/// defaults apply again.
fn config_with_limit(raw: &str, key: &str, value: Option<serde_json::Value>) -> Result<String> {
    let mut config = ensure_config_object(raw)?;
    let limits = limits_object(&mut config)?;
    match value {
        Some(value) => {
            limits.insert(key.to_string(), value);
        }
        None => {
            limits.remove(key);
        }
    }
    Ok(config.to_string())
}

/// UI clear sentinel: zero context/output tokens or a non-positive temperature
/// drop the override instead of storing a meaningless value.
fn limit_u32_value(value: u32) -> Option<serde_json::Value> {
    (value > 0).then(|| serde_json::json!(value))
}

fn limit_temperature_value(value: f64) -> Option<serde_json::Value> {
    (value > 0.0 && value.is_finite()).then(|| serde_json::json!(value))
}

fn config_with_reasoning_override(raw: &str, value: bool) -> Result<String> {
    let mut config = ensure_config_object(raw)?;
    compatibility_object(&mut config)?.insert("supportsReasoning".into(), serde_json::json!(value));
    Ok(config.to_string())
}

fn config_with_thinking_levels_override(raw: &str, levels: Option<&[String]>) -> Result<String> {
    let mut config = ensure_config_object(raw)?;
    let compatibility = compatibility_object(&mut config)?;
    match levels {
        Some(levels) => {
            let normalized = normalize_thinking_levels(levels);
            if normalized.is_empty() {
                compatibility.remove("supportedThinkingLevels");
            } else {
                compatibility.insert(
                    "supportedThinkingLevels".into(),
                    serde_json::json!(normalized),
                );
            }
        }
        None => {
            compatibility.remove("supportedThinkingLevels");
        }
    }
    Ok(config.to_string())
}

struct LimitOverrides {
    context_window: Option<u32>,
    max_output_tokens: Option<u32>,
    temperature: Option<f64>,
}

fn build_provider_config_json(
    supports_reasoning: Option<bool>,
    supported_thinking_levels: Option<&[String]>,
    limits: &LimitOverrides,
) -> Result<String> {
    let mut config = serde_json::json!({});
    if let Some(value) = supports_reasoning {
        compatibility_object(&mut config)?
            .insert("supportsReasoning".into(), serde_json::json!(value));
    }
    if let Some(levels) = supported_thinking_levels {
        let normalized = normalize_thinking_levels(levels);
        if !normalized.is_empty() {
            compatibility_object(&mut config)?.insert(
                "supportedThinkingLevels".into(),
                serde_json::json!(normalized),
            );
        }
    }
    if let Some(value) = limits.context_window.and_then(limit_u32_value) {
        limits_object(&mut config)?.insert("contextWindow".into(), value);
    }
    if let Some(value) = limits.max_output_tokens.and_then(limit_u32_value) {
        limits_object(&mut config)?.insert("maxOutputTokens".into(), value);
    }
    if let Some(value) = limits.temperature.and_then(limit_temperature_value) {
        limits_object(&mut config)?.insert("temperature".into(), value);
    }
    Ok(config.to_string())
}

fn merge_provider_config_overrides(
    raw: &str,
    supports_reasoning: Option<bool>,
    supported_thinking_levels: Option<Option<Vec<String>>>,
    limits: &LimitOverrides,
) -> Result<Option<String>> {
    if supports_reasoning.is_none()
        && supported_thinking_levels.is_none()
        && limits.context_window.is_none()
        && limits.max_output_tokens.is_none()
        && limits.temperature.is_none()
    {
        return Ok(None);
    }
    let mut next = raw.to_string();
    if let Some(value) = supports_reasoning {
        next = config_with_reasoning_override(&next, value)?;
    }
    if let Some(levels) = supported_thinking_levels {
        next = config_with_thinking_levels_override(&next, levels.as_deref())?;
    }
    if let Some(value) = limits.context_window {
        next = config_with_limit(&next, "contextWindow", limit_u32_value(value))?;
    }
    if let Some(value) = limits.max_output_tokens {
        next = config_with_limit(&next, "maxOutputTokens", limit_u32_value(value))?;
    }
    if let Some(value) = limits.temperature {
        next = config_with_limit(&next, "temperature", limit_temperature_value(value))?;
    }
    Ok(Some(next))
}

fn provider_from_row(
    row: &rusqlite::Row<'_>,
    secrets: &SecretStore,
) -> rusqlite::Result<ProviderPublic> {
    let secret_ref: Option<String> = row.get(8)?;
    Ok(ProviderPublic {
        id: row.get(0)?,
        name: row.get(1)?,
        vendor_key: row.get(2)?,
        provider_type: row.get(3)?,
        protocol: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        base_url: row.get(6)?,
        auth_kind: row.get(7)?,
        has_secret: secret_ref.as_ref().map(|r| secrets.has(r)).unwrap_or(false),
        default_model_id: row.get(9)?,
        api_style: row.get(10)?,
        supports_reasoning: row
            .get::<_, String>(11)
            .ok()
            .and_then(|raw| config_reasoning_override(&raw)),
        supported_thinking_levels: row
            .get::<_, String>(11)
            .ok()
            .and_then(|raw| config_thinking_levels_override(&raw)),
        context_window: row
            .get::<_, String>(11)
            .ok()
            .and_then(|raw| config_limit_u32(&raw, "contextWindow")),
        max_output_tokens: row
            .get::<_, String>(11)
            .ok()
            .and_then(|raw| config_limit_u32(&raw, "maxOutputTokens")),
        temperature: row
            .get::<_, String>(11)
            .ok()
            .and_then(|raw| config_limit_f64(&raw, "temperature")),
        created_at: ms_to_ts(row.get(12)?),
        updated_at: ms_to_ts(row.get(13)?),
    })
}

fn upsert_secret_meta(
    db: &Database,
    secret_ref: &str,
    provider_id: &str,
    backend: &str,
) -> Result<()> {
    db.conn()
        .prepare_cached(
            "INSERT INTO secrets_meta (secret_ref, owner_kind, owner_id, kind, backend, updated_at)
             VALUES (?1, 'provider', ?2, 'api_key', ?3, ?4)
             ON CONFLICT(secret_ref) DO UPDATE SET
               updated_at = excluded.updated_at, backend = excluded.backend",
        )?
        .execute(params![secret_ref, provider_id, backend, now_ms()])?;
    Ok(())
}

pub fn list_providers(
    db: &Database,
    secrets: &SecretStore,
    include_disabled: bool,
) -> Result<Vec<ProviderPublic>> {
    let sql = if include_disabled {
        format!("{PROVIDER_SELECT} ORDER BY created_at ASC")
    } else {
        format!("{PROVIDER_SELECT} WHERE enabled = 1 ORDER BY created_at ASC")
    };
    let mut stmt = db.conn().prepare_cached(&sql)?;
    let rows = stmt.query_map([], |row| provider_from_row(row, secrets))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_models(db: &Database, provider_id: Option<&str>) -> Result<Vec<ModelCatalogItem>> {
    let (sql, bind_provider) = match provider_id {
        Some(id) => (
            "SELECT provider_id, model_id, display_name, source,
                    capabilities_json, context_window
             FROM models
             WHERE provider_id = ?1
             ORDER BY display_name COLLATE NOCASE, model_id",
            Some(id),
        ),
        None => (
            "SELECT provider_id, model_id, display_name, source,
                    capabilities_json, context_window
             FROM models
             ORDER BY provider_id, display_name COLLATE NOCASE, model_id",
            None,
        ),
    };
    let mut stmt = db.conn().prepare_cached(sql)?;
    let parse = |row: &rusqlite::Row<'_>| -> rusqlite::Result<ModelCatalogItem> {
        let raw_capabilities: String = row.get(4)?;
        let capabilities = serde_json::from_str(&raw_capabilities).unwrap_or_default();
        Ok(ModelCatalogItem {
            provider_id: row.get(0)?,
            model_id: row.get(1)?,
            display_name: row.get(2)?,
            source: row.get(3)?,
            capabilities,
            context_window: row
                .get::<_, Option<i64>>(5)?
                .and_then(|value| u32::try_from(value).ok()),
        })
    };
    let rows = if let Some(id) = bind_provider {
        stmt.query_map(params![id], parse)?
    } else {
        stmt.query_map([], parse)?
    };
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Merge live discovery results into the durable catalog cache. User-created
/// rows are authoritative and stale cache remains available if discovery fails.
pub fn cache_discovered_models(
    db: &Database,
    provider_id: &str,
    models: &[DiscoveredModelInput],
) -> Result<usize> {
    let tx = db.conn().unchecked_transaction()?;
    let now = now_ms();
    let mut changed = 0;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO models (
                provider_id, model_id, display_name, source,
                capabilities_json, context_window, updated_at
             ) VALUES (?1, ?2, ?3, 'discovered', ?4, ?5, ?6)
             ON CONFLICT(provider_id, model_id) DO UPDATE SET
                display_name = excluded.display_name,
                capabilities_json = excluded.capabilities_json,
                context_window = excluded.context_window,
                updated_at = excluded.updated_at
             WHERE models.source != 'user'",
        )?;
        for model in models {
            let model_id = model.model_id.trim();
            if model_id.is_empty() {
                continue;
            }
            let display_name = model.display_name.trim();
            let display_name = if display_name.is_empty() {
                model_id
            } else {
                display_name
            };
            changed += stmt.execute(params![
                provider_id,
                model_id,
                display_name,
                serde_json::to_string(&model.capabilities)?,
                model.context_window,
                now,
            ])?;
        }
    }
    tx.commit()?;
    Ok(changed)
}

pub fn create_provider(
    db: &Database,
    secrets: &SecretStore,
    input: ProviderCreateInput,
) -> Result<ProviderPublic> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let secret_ref = secret_ref_for_provider(&id);
    let mut backend = None;
    if let Some(secret) = input.secret_value.as_ref().filter(|s| !s.is_empty()) {
        let b = secrets.set(&secret_ref, secret)?;
        upsert_secret_meta(db, &secret_ref, &id, &b)?;
        backend = Some(b);
    }

    let vendor_key = input.vendor_key.unwrap_or_else(|| "custom".into());
    let provider_type = input
        .provider_type
        .unwrap_or_else(|| "openai_compatible".into());
    let protocol = input.protocol.unwrap_or_else(|| "openai_compatible".into());
    let auth_kind = input
        .auth_kind
        .unwrap_or_else(|| "api_key_and_base_url".into());
    let config_json = build_provider_config_json(
        input.supports_reasoning,
        input.supported_thinking_levels.as_deref(),
        &LimitOverrides {
            context_window: input.context_window,
            max_output_tokens: input.max_output_tokens,
            temperature: input.temperature,
        },
    )?;

    db.conn()
        .prepare_cached(
            "INSERT INTO providers (
                id, name, vendor_key, type, protocol, enabled, base_url, auth_kind, secret_ref,
                api_style, default_model_id, config_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        )?
        .execute(params![
            id,
            input.name,
            vendor_key,
            provider_type,
            protocol,
            input.base_url,
            auth_kind,
            if backend.is_some() {
                Some(secret_ref.clone())
            } else {
                None
            },
            input.api_style,
            input.default_model_id,
            config_json.to_string(),
            now,
        ])?;

    get_provider(db, secrets, &id)?.ok_or_else(|| anyhow::anyhow!("provider missing after create"))
}

pub fn update_provider(
    db: &Database,
    secrets: &SecretStore,
    input: ProviderUpdateInput,
) -> Result<Option<ProviderPublic>> {
    let existing = get_provider(db, secrets, &input.id)?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let mut secret_ref = existing
        .has_secret
        .then(|| secret_ref_for_provider(&input.id));

    if let Some(secret) = input.secret_value.as_ref().filter(|s| !s.is_empty()) {
        let sref = secret_ref_for_provider(&input.id);
        let backend = secrets.set(&sref, secret)?;
        upsert_secret_meta(db, &sref, &input.id, &backend)?;
        secret_ref = Some(sref);
    }
    let raw_config: String = db.conn().query_row(
        "SELECT config_json FROM providers WHERE id = ?1",
        params![input.id],
        |row| row.get(0),
    )?;
    // `Some(None)` clears an explicit levels override; plain `None` leaves it.
    let levels_update = if input.supported_thinking_levels.is_some() {
        Some(input.supported_thinking_levels.clone())
    } else {
        None
    };
    let config_json = merge_provider_config_overrides(
        &raw_config,
        input.supports_reasoning,
        levels_update,
        &LimitOverrides {
            context_window: input.context_window,
            max_output_tokens: input.max_output_tokens,
            temperature: input.temperature,
        },
    )?;

    db.conn()
        .prepare_cached(
            "UPDATE providers SET
                name = COALESCE(?1, name),
                vendor_key = COALESCE(?2, vendor_key),
                type = COALESCE(?3, type),
                protocol = COALESCE(?4, protocol),
                base_url = COALESCE(?5, base_url),
                auth_kind = COALESCE(?6, auth_kind),
                default_model_id = COALESCE(?7, default_model_id),
                api_style = COALESCE(?8, api_style),
                enabled = COALESCE(?9, enabled),
                secret_ref = COALESCE(?10, secret_ref),
                config_json = COALESCE(?11, config_json),
                updated_at = ?12
             WHERE id = ?13",
        )?
        .execute(params![
            input.name,
            input.vendor_key,
            input.provider_type,
            input.protocol,
            input.base_url,
            input.auth_kind,
            input.default_model_id,
            input.api_style,
            input.enabled.map(|b| if b { 1 } else { 0 }),
            secret_ref,
            config_json,
            now_ms(),
            input.id
        ])?;
    get_provider(db, secrets, &input.id)
}

pub fn delete_provider(db: &Database, secrets: &SecretStore, id: &str) -> Result<bool> {
    let sref = secret_ref_for_provider(id);
    let _ = secrets.delete(&sref);
    db.conn()
        .prepare_cached("DELETE FROM secrets_meta WHERE secret_ref = ?1")?
        .execute(params![sref])?;
    let n = db
        .conn()
        .prepare_cached("DELETE FROM providers WHERE id = ?1")?
        .execute(params![id])?;
    Ok(n > 0)
}

pub fn get_provider(
    db: &Database,
    secrets: &SecretStore,
    id: &str,
) -> Result<Option<ProviderPublic>> {
    let sql = format!("{PROVIDER_SELECT} WHERE id = ?1");
    db.conn()
        .prepare_cached(&sql)?
        .query_row(params![id], |row| provider_from_row(row, secrets))
        .optional()
        .map_err(Into::into)
}

pub fn get_secret_for_provider(
    db: &Database,
    secrets: &SecretStore,
    provider_id: &str,
) -> Result<Option<String>> {
    let secret_ref: Option<String> = db
        .conn()
        .prepare_cached("SELECT secret_ref FROM providers WHERE id = ?1")?
        .query_row(params![provider_id], |row| row.get(0))
        .optional()?
        .flatten();
    if let Some(sref) = secret_ref {
        secrets.get(&sref)
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_context() -> (tempfile::TempDir, Database, SecretStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let secrets = SecretStore::open(dir.path()).unwrap();
        (dir, db, secrets)
    }

    #[test]
    fn reasoning_override_roundtrips_and_preserves_provider_config() {
        let (_dir, db, secrets) = test_context();
        let provider = create_provider(
            &db,
            &secrets,
            ProviderCreateInput {
                name: "Custom".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: Some("none".into()),
                default_model_id: Some("model-1".into()),
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: Some(true),
                supported_thinking_levels: Some(vec!["off".into(), "high".into()]),
            },
        )
        .unwrap();
        assert_eq!(provider.supports_reasoning, Some(true));
        assert_eq!(
            provider.supported_thinking_levels.as_deref(),
            Some(["off".to_string(), "high".to_string()].as_slice())
        );

        db.conn()
            .execute(
                "UPDATE providers
                 SET config_json = ?1
                 WHERE id = ?2",
                params![
                    json!({
                        "headers": { "x-demo": "keep" },
                        "compatibility": { "supportsTools": true },
                        "custom": { "nested": 42 }
                    })
                    .to_string(),
                    provider.id
                ],
            )
            .unwrap();

        let updated = update_provider(
            &db,
            &secrets,
            ProviderUpdateInput {
                id: provider.id.clone(),
                name: None,
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: None,
                default_model_id: None,
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: Some(false),
                supported_thinking_levels: Some(vec!["off".into(), "low".into()]),
                enabled: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.supports_reasoning, Some(false));
        assert_eq!(
            updated.supported_thinking_levels.as_deref(),
            Some(["off".to_string(), "low".to_string()].as_slice())
        );

        let raw: String = db
            .conn()
            .query_row(
                "SELECT config_json FROM providers WHERE id = ?1",
                params![provider.id],
                |row| row.get(0),
            )
            .unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(config["headers"]["x-demo"], "keep");
        assert_eq!(config["compatibility"]["supportsTools"], true);
        assert_eq!(config["compatibility"]["supportsReasoning"], false);
        assert_eq!(
            config["compatibility"]["supportedThinkingLevels"],
            json!(["off", "low"])
        );
        assert_eq!(config["custom"]["nested"], 42);

        // An update without the field leaves the explicit override intact.
        let unchanged = update_provider(
            &db,
            &secrets,
            ProviderUpdateInput {
                id: provider.id,
                name: Some("Renamed".into()),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: None,
                default_model_id: None,
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
                enabled: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(unchanged.supports_reasoning, Some(false));
        assert_eq!(
            unchanged.supported_thinking_levels.as_deref(),
            Some(["off".to_string(), "low".to_string()].as_slice())
        );
    }

    #[test]
    fn limit_overrides_roundtrip_and_clear_with_zero() {
        let (_dir, db, secrets) = test_context();
        let provider = create_provider(
            &db,
            &secrets,
            ProviderCreateInput {
                name: "Limits".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: Some("none".into()),
                default_model_id: Some("model-1".into()),
                secret_value: None,
                api_style: None,
                context_window: Some(200_000),
                max_output_tokens: Some(32_000),
                temperature: Some(0.7),
                supports_reasoning: None,
                supported_thinking_levels: None,
            },
        )
        .unwrap();
        assert_eq!(provider.context_window, Some(200_000));
        assert_eq!(provider.max_output_tokens, Some(32_000));
        assert_eq!(provider.temperature, Some(0.7));

        // Absent fields leave overrides intact; zero / non-positive clears.
        let updated = update_provider(
            &db,
            &secrets,
            ProviderUpdateInput {
                id: provider.id.clone(),
                name: None,
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: None,
                default_model_id: None,
                secret_value: None,
                api_style: None,
                context_window: Some(131_072),
                max_output_tokens: None,
                temperature: Some(0.0),
                supports_reasoning: None,
                supported_thinking_levels: None,
                enabled: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.context_window, Some(131_072));
        assert_eq!(updated.max_output_tokens, Some(32_000));
        assert_eq!(updated.temperature, None);
    }

    #[test]
    fn provider_without_override_omits_reasoning_capability() {
        let (_dir, db, secrets) = test_context();
        let provider = create_provider(
            &db,
            &secrets,
            ProviderCreateInput {
                name: "No override".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: Some("none".into()),
                default_model_id: None,
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
            },
        )
        .unwrap();
        assert_eq!(provider.supports_reasoning, None);
        assert_eq!(provider.supported_thinking_levels, None);
        let wire = serde_json::to_value(provider).unwrap();
        assert!(wire.get("supportsReasoning").is_none());
        assert!(wire.get("supportedThinkingLevels").is_none());
    }

    #[test]
    fn thinking_levels_override_normalizes_and_can_clear() {
        let (_dir, db, secrets) = test_context();
        let provider = create_provider(
            &db,
            &secrets,
            ProviderCreateInput {
                name: "Sparse".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: Some("none".into()),
                default_model_id: Some("mimo-v2.5".into()),
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: Some(true),
                supported_thinking_levels: Some(vec![
                    "high".into(),
                    "off".into(),
                    "bogus".into(),
                    "high".into(),
                ]),
            },
        )
        .unwrap();
        // Keep first-seen order after filtering invalid entries.
        assert_eq!(
            provider.supported_thinking_levels.as_deref(),
            Some(["high".to_string(), "off".to_string()].as_slice())
        );

        let cleared = update_provider(
            &db,
            &secrets,
            ProviderUpdateInput {
                id: provider.id.clone(),
                name: None,
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: None,
                auth_kind: None,
                default_model_id: None,
                secret_value: None,
                api_style: None,
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: None,
                supported_thinking_levels: Some(vec![]),
                enabled: None,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(cleared.supported_thinking_levels, None);

        let raw: String = db
            .conn()
            .query_row(
                "SELECT config_json FROM providers WHERE id = ?1",
                params![provider.id],
                |row| row.get(0),
            )
            .unwrap();
        let config: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(config["compatibility"]
            .get("supportedThinkingLevels")
            .is_none());
    }

    #[test]
    fn discovered_models_are_cached_without_overwriting_user_rows() {
        let (_dir, db, secrets) = test_context();
        let provider = create_provider(
            &db,
            &secrets,
            ProviderCreateInput {
                name: "Catalog".into(),
                vendor_key: None,
                provider_type: None,
                protocol: None,
                base_url: Some("http://localhost:11434/v1".into()),
                auth_kind: Some("none".into()),
                default_model_id: Some("model-a".into()),
                secret_value: None,
                api_style: Some("chat_completions".into()),
                context_window: None,
                max_output_tokens: None,
                temperature: None,
                supports_reasoning: None,
                supported_thinking_levels: None,
            },
        )
        .unwrap();
        db.conn()
            .execute(
                "INSERT INTO models (
                    provider_id, model_id, display_name, source,
                    capabilities_json, updated_at
                 ) VALUES (?1, 'user-model', 'Custom label', 'user', '[\"tools\"]', ?2)",
                params![provider.id, now_ms()],
            )
            .unwrap();

        let changed = cache_discovered_models(
            &db,
            &provider.id,
            &[
                DiscoveredModelInput {
                    model_id: "model-b".into(),
                    display_name: "Beta".into(),
                    capabilities: vec!["text".into()],
                    context_window: None,
                },
                DiscoveredModelInput {
                    model_id: "model-a".into(),
                    display_name: "Alpha".into(),
                    capabilities: vec!["text".into()],
                    context_window: Some(128_000),
                },
            ],
        )
        .unwrap();
        assert_eq!(changed, 2);

        cache_discovered_models(
            &db,
            &provider.id,
            &[
                DiscoveredModelInput {
                    model_id: "model-a".into(),
                    display_name: "Alpha updated".into(),
                    capabilities: vec!["text".into(), "reasoning".into()],
                    context_window: Some(256_000),
                },
                DiscoveredModelInput {
                    model_id: "user-model".into(),
                    display_name: "Remote label".into(),
                    capabilities: vec!["text".into()],
                    context_window: None,
                },
            ],
        )
        .unwrap();

        let models = list_models(&db, Some(&provider.id)).unwrap();
        assert_eq!(models.len(), 3);
        let alpha = models
            .iter()
            .find(|model| model.model_id == "model-a")
            .unwrap();
        assert_eq!(alpha.display_name, "Alpha updated");
        assert_eq!(alpha.capabilities, vec!["text", "reasoning"]);
        assert_eq!(alpha.context_window, Some(256_000));
        assert!(models.iter().any(|model| model.model_id == "model-b"));
        let custom = models
            .iter()
            .find(|model| model.model_id == "user-model")
            .unwrap();
        assert_eq!(custom.display_name, "Custom label");
        assert_eq!(custom.source, "user");
        assert_eq!(custom.capabilities, vec!["tools"]);
    }
}
