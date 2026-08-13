use anyhow::{anyhow, bail, Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use crate::activation::ActivationScope;

const MAX_PACKAGE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PACKAGE_FILES: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    /// Where the plugin's contributions apply. Absent in registries written
    /// before scopes existed, and `default()` is global — which is what those
    /// installs already did.
    #[serde(default)]
    pub scope: ActivationScope,
    pub source: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub permissions: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marketplace: Option<PluginMarketplaceMeta>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_update: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_available: Option<PluginUpdateInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<PluginUiMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMarketplaceMeta {
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shasum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdateInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
    pub shasum: String,
    pub url: String,
    #[serde(default)]
    pub permission_diff: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginUiMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub main: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub contributes: Option<Value>,
    #[serde(default)]
    pub ui: Option<PluginUiMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPluginSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    pub latest_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    pub updated_at: String,
    #[serde(default)]
    pub categories: Vec<String>,
    pub permission_summary: Vec<String>,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(default)]
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketPluginDetail {
    #[serde(flatten)]
    pub summary: MarketPluginSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readme_markdown: Option<String>,
    pub versions: Vec<MarketVersion>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safety_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketVersion {
    pub version: String,
    pub published_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_pi_desktop: Option<String>,
    pub shasum: String,
    pub url: String,
    pub size_bytes: u64,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketDownloadInfo {
    pub plugin_id: String,
    pub version: String,
    pub url: String,
    pub size_bytes: u64,
    pub shasum: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_alg: Option<String>,
    pub published_at: String,
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MarketCatalogEntry {
    id: String,
    name: String,
    description: String,
    author: String,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    readme_markdown: Option<String>,
    #[serde(default)]
    safety_notes: Option<String>,
    versions: Vec<MarketVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MarketCatalogFile {
    #[serde(default = "default_provider_id")]
    provider_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    plugins: Vec<MarketCatalogEntry>,
}

fn default_provider_id() -> String {
    "official".into()
}

#[derive(Debug, Clone)]
pub struct InstallOptions {
    pub source: String,
    pub enable: bool,
    pub marketplace: Option<PluginMarketplaceMeta>,
    pub expected_shasum: Option<String>,
    pub auto_update: bool,
    pub granted_permissions: Option<Vec<String>>,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            source: "installed".into(),
            enable: true,
            marketplace: None,
            expected_shasum: None,
            auto_update: false,
            granted_permissions: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub plugin: PluginSummary,
    pub upgraded: bool,
    #[serde(default)]
    pub permission_diff: Vec<String>,
}

pub struct PluginManager {
    data_dir: PathBuf,
    runtime: Vec<PluginSummary>,
}

impl PluginManager {
    pub fn new(data_dir: &Path) -> Self {
        let mut mgr = Self {
            data_dir: data_dir.to_path_buf(),
            runtime: Vec::new(),
        };
        let _ = mgr.ensure_dirs();
        let _ = mgr.ensure_default_catalog();
        let _ = mgr.reload_from_disk();
        mgr
    }

    fn ensure_dirs(&self) -> Result<()> {
        for rel in [
            "plugins/installed",
            "plugins/disabled",
            "plugins/data",
            "plugins/logs",
            "plugins/cache/download",
            "plugins/cache/backup",
            "plugins/market",
        ] {
            fs::create_dir_all(self.data_dir.join(rel))?;
        }
        Ok(())
    }

    fn registry_path(&self) -> PathBuf {
        self.data_dir.join("plugins/registry.json")
    }

    fn catalog_path(&self) -> PathBuf {
        self.data_dir.join("plugins/market/catalog.json")
    }

    fn installed_dir(&self, id: &str) -> PathBuf {
        self.data_dir
            .join("plugins/installed")
            .join(sanitize_id(id))
    }

    fn data_dir_for(&self, id: &str) -> PathBuf {
        self.data_dir.join("plugins/data").join(sanitize_id(id))
    }

    pub fn list(&self) -> Vec<PluginSummary> {
        self.runtime.clone()
    }

    pub fn get(&self, id: &str) -> Option<PluginSummary> {
        self.runtime.iter().find(|p| p.id == id).cloned()
    }

    pub fn reload_from_disk(&mut self) -> Result<()> {
        let path = self.registry_path();
        if !path.exists() {
            self.runtime.clear();
            return Ok(());
        }
        let raw = fs::read_to_string(path)?;
        self.runtime = serde_json::from_str(&raw).unwrap_or_default();
        Ok(())
    }

    fn save(&self) -> Result<()> {
        let path = self.registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_string_pretty(&self.runtime)?)?;
        Ok(())
    }

    fn read_manifest(path: &Path) -> Result<PluginManifest> {
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            bail!("PLUGIN_INVALID: manifest.json missing");
        }
        let raw = fs::read_to_string(&manifest_path)
            .with_context(|| format!("read manifest {}", manifest_path.display()))?;
        let manifest: PluginManifest =
            serde_json::from_str(&raw).map_err(|e| anyhow!("PLUGIN_INVALID: {e}"))?;
        if manifest.id.trim().is_empty() || manifest.main.trim().is_empty() {
            bail!("PLUGIN_INVALID: id/main required");
        }
        if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
            bail!("PLUGIN_INVALID: name/version required");
        }
        let main_path = path.join(&manifest.main);
        if !main_path.exists() {
            bail!("PLUGIN_LOAD_FAILED: main entry missing");
        }
        if let Some(ui) = &manifest.ui {
            if let Some(panel) = &ui.panel {
                let panel_path = path.join(panel);
                if !panel_path.exists() {
                    bail!("PLUGIN_INVALID: ui.panel missing");
                }
            }
        }
        validate_contributions(path, &manifest)?;
        Ok(manifest)
    }

    fn upsert_summary(&mut self, summary: PluginSummary) -> Result<PluginSummary> {
        self.runtime.retain(|p| p.id != summary.id);
        self.runtime.push(summary.clone());
        self.save()?;
        Ok(summary)
    }

    pub fn load_dev(&mut self, plugin_path: &str) -> Result<PluginSummary> {
        let path = PathBuf::from(plugin_path);
        let manifest = Self::read_manifest(&path)?;
        let now = Utc::now().to_rfc3339();
        let summary = PluginSummary {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            enabled: true,
            scope: ActivationScope::default(),
            source: "dev".into(),
            status: "ready".into(),
            error_message: None,
            permissions: manifest.permissions.clone(),
            path: Some(path.to_string_lossy().to_string()),
            capabilities: derive_capabilities(&manifest),
            description: manifest.description.clone(),
            author: manifest.author.clone(),
            installed_at: Some(now.clone()),
            updated_at: Some(now),
            marketplace: None,
            auto_update: Some(false),
            update_available: None,
            ui: manifest.ui.clone(),
        };
        self.upsert_summary(summary)
    }

    pub fn install_from_path(
        &mut self,
        source_path: &str,
        opts: InstallOptions,
    ) -> Result<InstallResult> {
        let source = PathBuf::from(source_path);
        if !source.exists() {
            bail!("PLUGIN_INVALID: package path missing");
        }

        let stage = self
            .data_dir
            .join("plugins/cache/download")
            .join(format!("stage-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&stage)?;
        let cleanup_stage = stage.clone();
        let result = (|| -> Result<InstallResult> {
            let extracted_root = if source.is_dir() {
                copy_dir_filtered(&source, &stage.join("content"))?;
                stage.join("content")
            } else {
                let bytes = fs::read(&source)
                    .with_context(|| format!("read package {}", source.display()))?;
                if bytes.len() as u64 > MAX_PACKAGE_BYTES {
                    bail!("PLUGIN_INVALID: package exceeds 50MB limit");
                }
                if let Some(expected) = &opts.expected_shasum {
                    let actual = sha256_hex(&bytes);
                    if !actual.eq_ignore_ascii_case(expected) {
                        bail!("PLUGIN_INTEGRITY: checksum mismatch");
                    }
                }
                let extract_dir = stage.join("extract");
                fs::create_dir_all(&extract_dir)?;
                extract_zip_bytes(&bytes, &extract_dir)?;
                find_plugin_root(&extract_dir)?
            };

            let manifest = Self::read_manifest(&extracted_root)?;
            let existing = self.get(&manifest.id);
            let upgraded = existing
                .as_ref()
                .map(|p| p.version != manifest.version)
                .unwrap_or(false);
            let permission_diff = permission_diff(
                existing
                    .as_ref()
                    .map(|p| p.permissions.as_slice())
                    .unwrap_or(&[]),
                &manifest.permissions,
            );

            if upgraded {
                if let Some(prev) = &existing {
                    if let Some(prev_path) = prev.path.as_ref() {
                        let backup = self
                            .data_dir
                            .join("plugins/cache/backup")
                            .join(sanitize_id(&prev.id))
                            .join(&prev.version);
                        let _ = fs::remove_dir_all(&backup);
                        if PathBuf::from(prev_path).exists() {
                            copy_dir_filtered(Path::new(prev_path), &backup)?;
                        }
                    }
                }
            }

            let target = self.installed_dir(&manifest.id);
            if target.exists() {
                fs::remove_dir_all(&target)?;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            copy_dir_filtered(&extracted_root, &target)?;
            fs::create_dir_all(self.data_dir_for(&manifest.id))?;

            let now = Utc::now().to_rfc3339();
            let granted = opts
                .granted_permissions
                .clone()
                .unwrap_or_else(|| manifest.permissions.clone());
            for required in &manifest.permissions {
                if !granted.iter().any(|g| g == required) {
                    bail!("PLUGIN_PERMISSION_DENIED: missing grant for {required}");
                }
            }

            let summary = PluginSummary {
                id: manifest.id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                enabled: opts.enable,
                // An update must not silently widen a project-scoped plugin
                // back to every project.
                scope: existing
                    .as_ref()
                    .map(|p| p.scope.clone())
                    .unwrap_or_default(),
                source: opts.source.clone(),
                status: if opts.enable {
                    "ready".into()
                } else {
                    "disabled".into()
                },
                error_message: None,
                permissions: granted,
                path: Some(target.to_string_lossy().to_string()),
                capabilities: derive_capabilities(&manifest),
                description: manifest.description.clone(),
                author: manifest.author.clone(),
                installed_at: existing
                    .as_ref()
                    .and_then(|p| p.installed_at.clone())
                    .or_else(|| Some(now.clone())),
                updated_at: Some(now),
                marketplace: opts
                    .marketplace
                    .clone()
                    .or_else(|| existing.as_ref().and_then(|p| p.marketplace.clone())),
                auto_update: Some(
                    opts.auto_update
                        || existing
                            .as_ref()
                            .and_then(|p| p.auto_update)
                            .unwrap_or(false),
                ),
                update_available: None,
                ui: manifest.ui.clone(),
            };
            let plugin = self.upsert_summary(summary)?;
            Ok(InstallResult {
                plugin,
                upgraded,
                permission_diff,
            })
        })();

        let _ = fs::remove_dir_all(cleanup_stage);
        result
    }

    pub fn install_from_package(
        &mut self,
        package_path: &str,
        opts: InstallOptions,
    ) -> Result<InstallResult> {
        self.install_from_path(package_path, opts)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<Option<PluginSummary>> {
        if let Some(plugin) = self.runtime.iter_mut().find(|p| p.id == id) {
            plugin.enabled = enabled;
            plugin.status = if enabled {
                "ready".into()
            } else {
                "disabled".into()
            };
            plugin.updated_at = Some(Utc::now().to_rfc3339());
            let out = plugin.clone();
            self.save()?;
            return Ok(Some(out));
        }
        Ok(None)
    }

    /// Move a plugin between "everywhere" and "these projects". Kept separate
    /// from `set_enabled` so switching a plugin off never discards its list.
    pub fn set_scope(&mut self, id: &str, scope: ActivationScope) -> Result<Option<PluginSummary>> {
        if let Some(plugin) = self.runtime.iter_mut().find(|p| p.id == id) {
            plugin.scope = scope.normalized();
            plugin.updated_at = Some(Utc::now().to_rfc3339());
            let out = plugin.clone();
            self.save()?;
            return Ok(Some(out));
        }
        Ok(None)
    }

    pub fn set_auto_update(&mut self, id: &str, enabled: bool) -> Result<Option<PluginSummary>> {
        if let Some(plugin) = self.runtime.iter_mut().find(|p| p.id == id) {
            plugin.auto_update = Some(enabled);
            plugin.updated_at = Some(Utc::now().to_rfc3339());
            let out = plugin.clone();
            self.save()?;
            return Ok(Some(out));
        }
        Ok(None)
    }

    pub fn uninstall(&mut self, id: &str) -> Result<bool> {
        let existing = self.get(id);
        let before = self.runtime.len();
        self.runtime.retain(|p| p.id != id);
        self.save()?;
        if let Some(plugin) = existing {
            if plugin.source != "dev" {
                let installed = self.installed_dir(id);
                if installed.exists() {
                    let _ = fs::remove_dir_all(installed);
                }
            }
            // Default policy: delete plugin private data on uninstall.
            let data = self.data_dir_for(id);
            if data.exists() {
                let _ = fs::remove_dir_all(data);
            }
            let log = self
                .data_dir
                .join("plugins/logs")
                .join(format!("{}.log", sanitize_id(id)));
            let _ = fs::remove_file(log);
        }
        Ok(self.runtime.len() < before)
    }

    pub fn grant_permissions(
        &mut self,
        id: &str,
        permissions: Vec<String>,
    ) -> Result<Option<PluginSummary>> {
        if let Some(plugin) = self.runtime.iter_mut().find(|p| p.id == id) {
            for perm in permissions {
                if !plugin.permissions.iter().any(|p| p == &perm) {
                    plugin.permissions.push(perm);
                }
            }
            plugin.updated_at = Some(Utc::now().to_rfc3339());
            let out = plugin.clone();
            self.save()?;
            return Ok(Some(out));
        }
        Ok(None)
    }

    pub fn revoke_permissions(
        &mut self,
        id: &str,
        permissions: Vec<String>,
    ) -> Result<Option<PluginSummary>> {
        if let Some(plugin) = self.runtime.iter_mut().find(|p| p.id == id) {
            plugin
                .permissions
                .retain(|p| !permissions.iter().any(|x| x == p));
            plugin.updated_at = Some(Utc::now().to_rfc3339());
            let out = plugin.clone();
            self.save()?;
            return Ok(Some(out));
        }
        Ok(None)
    }

    fn market_source_url() -> String {
        std::env::var("PI_DESKTOP_PLUGIN_MARKET_URL").unwrap_or_else(|_| {
            "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json"
                .to_string()
        })
    }

    fn market_cache_meta_path(&self) -> PathBuf {
        self.data_dir.join("plugins/market/cache-meta.json")
    }

    fn ensure_default_catalog(&self) -> Result<()> {
        let path = self.catalog_path();
        if path.exists() {
            return Ok(());
        }
        // Prefer the official remote marketplace repo; fall back to bundled demos.
        match self.refresh_catalog_from_remote(false) {
            Ok(_) => Ok(()),
            Err(remote_err) => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let catalog = built_in_catalog();
                fs::write(&path, serde_json::to_string_pretty(&catalog)?)?;
                self.materialize_local_package_urls(&catalog)?;
                let _ = remote_err;
                Ok(())
            }
        }
    }

    fn materialize_local_package_urls(&self, catalog: &MarketCatalogFile) -> Result<()> {
        for plugin in &catalog.plugins {
            for version in &plugin.versions {
                if let Some(local) = version.url.strip_prefix("file://") {
                    let target = PathBuf::from(local);
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    if !target.exists() {
                        if let Some(bytes) = bundled_package_bytes(&plugin.id, &version.version) {
                            fs::write(&target, bytes)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn resolve_package_url(catalog_url: &str, package_url: &str) -> String {
        if package_url.starts_with("http://")
            || package_url.starts_with("https://")
            || package_url.starts_with("file://")
        {
            return package_url.to_string();
        }
        // Relative package paths resolve against the catalog URL directory.
        if let Some(idx) = catalog_url.rfind('/') {
            format!(
                "{}{}",
                &catalog_url[..=idx],
                package_url.trim_start_matches('/')
            )
        } else {
            package_url.to_string()
        }
    }

    fn rewrite_catalog_urls(
        catalog_url: &str,
        mut catalog: MarketCatalogFile,
    ) -> MarketCatalogFile {
        for plugin in &mut catalog.plugins {
            for version in &mut plugin.versions {
                version.url = Self::resolve_package_url(catalog_url, &version.url);
            }
        }
        catalog
    }

    fn refresh_catalog_from_remote(&self, force: bool) -> Result<MarketCatalogFile> {
        let catalog_url = Self::market_source_url();
        let cache_path = self.catalog_path();
        let meta_path = self.market_cache_meta_path();
        if !force && cache_path.exists() {
            if let Ok(meta_raw) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<Value>(&meta_raw) {
                    let fetched_at = meta.get("fetchedAt").and_then(|v| v.as_str()).unwrap_or("");
                    if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(fetched_at) {
                        let age = Utc::now().signed_duration_since(ts.with_timezone(&Utc));
                        if age.num_seconds() < 300 {
                            // Fresh enough; use cache.
                            let raw = fs::read_to_string(&cache_path)?;
                            let catalog: MarketCatalogFile = serde_json::from_str(&raw)
                                .map_err(|e| anyhow!("PLUGIN_MARKET_INVALID: {e}"))?;
                            return Ok(catalog);
                        }
                    }
                }
            }
        }

        let bytes = download_url(&catalog_url)
            .map_err(|e| anyhow!("PLUGIN_NETWORK: failed to fetch marketplace catalog: {e}"))?;
        let raw = String::from_utf8(bytes)
            .map_err(|_| anyhow!("PLUGIN_MARKET_INVALID: catalog is not utf8"))?;
        let parsed: MarketCatalogFile =
            serde_json::from_str(&raw).map_err(|e| anyhow!("PLUGIN_MARKET_INVALID: {e}"))?;
        if parsed.plugins.is_empty() {
            bail!("PLUGIN_MARKET_INVALID: remote catalog has no plugins");
        }
        let catalog = Self::rewrite_catalog_urls(&catalog_url, parsed);
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&cache_path, serde_json::to_string_pretty(&catalog)?)?;
        let meta = json!({
            "sourceUrl": catalog_url,
            "providerId": catalog.provider_id,
            "fetchedAt": Utc::now().to_rfc3339(),
            "pluginCount": catalog.plugins.len(),
        });
        fs::write(meta_path, serde_json::to_string_pretty(&meta)?)?;
        Ok(catalog)
    }

    pub fn refresh_market(&self, force: bool) -> Result<Value> {
        let catalog = self.refresh_catalog_from_remote(force)?;
        Ok(json!({
            "providerId": catalog.provider_id,
            "name": catalog.name,
            "homepage": catalog.homepage,
            "updatedAt": catalog.updated_at,
            "pluginCount": catalog.plugins.len(),
            "sourceUrl": Self::market_source_url(),
        }))
    }

    fn load_catalog(&self) -> Result<MarketCatalogFile> {
        // Always try a cheap refresh; on failure fall back to cache / bundled demos.
        match self.refresh_catalog_from_remote(false) {
            Ok(catalog) => Ok(catalog),
            Err(_) => {
                self.ensure_default_catalog()?;
                let raw = fs::read_to_string(self.catalog_path())?;
                let mut catalog: MarketCatalogFile = serde_json::from_str(&raw)
                    .map_err(|e| anyhow!("PLUGIN_MARKET_INVALID: {e}"))?;
                if catalog.plugins.is_empty() {
                    catalog = built_in_catalog();
                    self.materialize_local_package_urls(&catalog)?;
                }
                Ok(catalog)
            }
        }
    }

    pub fn market_search(
        &self,
        query: Option<&str>,
        category: Option<&str>,
    ) -> Result<Vec<MarketPluginSummary>> {
        let catalog = self.load_catalog()?;
        let q = query.unwrap_or("").trim().to_lowercase();
        let mut out = Vec::new();
        for entry in catalog.plugins {
            if let Some(cat) = category {
                if !cat.is_empty() && !entry.categories.iter().any(|c| c.eq_ignore_ascii_case(cat))
                {
                    continue;
                }
            }
            if !q.is_empty() {
                let hay = format!(
                    "{} {} {} {}",
                    entry.id, entry.name, entry.description, entry.author
                )
                .to_lowercase();
                if !hay.contains(&q) {
                    continue;
                }
            }
            out.push(self.to_market_summary(&entry));
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    pub fn market_get(&self, plugin_id: &str) -> Result<MarketPluginDetail> {
        let catalog = self.load_catalog()?;
        let entry = catalog
            .plugins
            .into_iter()
            .find(|p| p.id == plugin_id)
            .ok_or_else(|| anyhow!("PLUGIN_NOT_FOUND: {plugin_id}"))?;
        let summary = self.to_market_summary(&entry);
        let permissions = entry
            .versions
            .first()
            .map(|v| v.permissions.clone())
            .unwrap_or_default();
        Ok(MarketPluginDetail {
            summary,
            readme_markdown: entry.readme_markdown,
            versions: entry.versions,
            screenshots: vec![],
            homepage: entry.homepage,
            repository: entry.repository,
            permissions,
            safety_notes: entry.safety_notes,
        })
    }

    pub fn market_download_info(
        &self,
        plugin_id: &str,
        version: Option<&str>,
    ) -> Result<MarketDownloadInfo> {
        let detail = self.market_get(plugin_id)?;
        let selected = if let Some(version) = version {
            detail
                .versions
                .iter()
                .find(|v| v.version == version)
                .cloned()
        } else {
            detail.versions.first().cloned()
        }
        .ok_or_else(|| anyhow!("PLUGIN_NOT_FOUND: version missing"))?;
        Ok(MarketDownloadInfo {
            plugin_id: plugin_id.to_string(),
            version: selected.version,
            url: selected.url,
            size_bytes: selected.size_bytes,
            shasum: selected.shasum,
            signature: None,
            signature_alg: None,
            published_at: selected.published_at,
            permissions: selected.permissions,
            changelog: selected.changelog,
        })
    }

    pub fn check_updates(&mut self) -> Result<Vec<PluginUpdateInfo>> {
        let catalog = self.load_catalog()?;
        let mut updates = Vec::new();
        for plugin in self.runtime.iter_mut() {
            let Some(entry) = catalog.plugins.iter().find(|p| p.id == plugin.id) else {
                plugin.update_available = None;
                continue;
            };
            let Some(latest) = entry.versions.first() else {
                plugin.update_available = None;
                continue;
            };
            if latest.version == plugin.version {
                plugin.update_available = None;
                continue;
            }
            let diff = permission_diff(&plugin.permissions, &latest.permissions);
            let info = PluginUpdateInfo {
                version: latest.version.clone(),
                changelog: latest.changelog.clone(),
                shasum: latest.shasum.clone(),
                url: latest.url.clone(),
                permission_diff: diff,
            };
            plugin.update_available = Some(info.clone());
            updates.push(info);
        }
        self.save()?;
        Ok(updates)
    }

    pub fn install_from_market(
        &mut self,
        plugin_id: &str,
        version: Option<&str>,
        enable: bool,
        auto_update: bool,
        granted_permissions: Option<Vec<String>>,
    ) -> Result<InstallResult> {
        let info = self.market_download_info(plugin_id, version)?;
        let package_path = self.download_market_package(&info)?;
        let result = self.install_from_path(
            &package_path.to_string_lossy(),
            InstallOptions {
                source: "marketplace".into(),
                enable,
                marketplace: Some(PluginMarketplaceMeta {
                    provider_id: "official".into(),
                    shasum: Some(info.shasum.clone()),
                    publisher_id: Some("pi-desktop".into()),
                }),
                expected_shasum: Some(info.shasum),
                auto_update,
                granted_permissions,
            },
        );
        let _ = fs::remove_file(package_path);
        result
    }

    pub fn apply_updates(&mut self, only_auto: bool) -> Result<Vec<InstallResult>> {
        let _ = self.check_updates()?;
        let pending: Vec<(String, PluginUpdateInfo, bool, Vec<String>)> = self
            .runtime
            .iter()
            .filter_map(|p| {
                let update = p.update_available.clone()?;
                if only_auto && !p.auto_update.unwrap_or(false) {
                    return None;
                }
                // Auto-update refuses silent permission expansion.
                if only_auto && !update.permission_diff.is_empty() {
                    return None;
                }
                Some((
                    p.id.clone(),
                    update,
                    p.auto_update.unwrap_or(false),
                    p.permissions.clone(),
                ))
            })
            .collect();

        let mut results = Vec::new();
        for (id, update, auto_update, current_permissions) in pending {
            let mut granted = current_permissions;
            for perm in &update.permission_diff {
                if !granted.iter().any(|p| p == perm) {
                    granted.push(perm.clone());
                }
            }
            let installed = self.install_from_market(
                &id,
                Some(&update.version),
                true,
                auto_update,
                Some(granted),
            )?;
            results.push(installed);
        }
        Ok(results)
    }

    fn download_market_package(&self, info: &MarketDownloadInfo) -> Result<PathBuf> {
        let cache = self.data_dir.join("plugins/cache/download").join(format!(
            "{}-{}.piplug",
            sanitize_id(&info.plugin_id),
            sanitize_id(&info.version)
        ));
        if let Some(parent) = cache.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = if let Some(path) = info.url.strip_prefix("file://") {
            fs::read(path).with_context(|| format!("read market package {path}"))?
        } else if info.url.starts_with("http://") || info.url.starts_with("https://") {
            download_url(&info.url)?
        } else {
            // Allow bare local paths in catalogs.
            fs::read(&info.url).with_context(|| format!("read market package {}", info.url))?
        };
        if bytes.len() as u64 > MAX_PACKAGE_BYTES {
            bail!("PLUGIN_INVALID: package exceeds 50MB limit");
        }
        let actual = sha256_hex(&bytes);
        if !actual.eq_ignore_ascii_case(&info.shasum) {
            bail!("PLUGIN_INTEGRITY: checksum mismatch");
        }
        fs::write(&cache, &bytes)?;
        Ok(cache)
    }

    fn to_market_summary(&self, entry: &MarketCatalogEntry) -> MarketPluginSummary {
        let latest = entry
            .versions
            .first()
            .map(|v| v.version.clone())
            .unwrap_or_else(|| "0.0.0".into());
        let installed = self.get(&entry.id);
        MarketPluginSummary {
            id: entry.id.clone(),
            name: entry.name.clone(),
            description: entry.description.clone(),
            author: entry.author.clone(),
            icon_url: entry.icon_url.clone(),
            latest_version: latest.clone(),
            downloads: entry.downloads,
            updated_at: entry
                .versions
                .first()
                .map(|v| v.published_at.clone())
                .unwrap_or_else(|| Utc::now().to_rfc3339()),
            categories: entry.categories.clone(),
            permission_summary: entry
                .versions
                .first()
                .map(|v| v.permissions.clone())
                .unwrap_or_default(),
            verified: entry.verified,
            installed: installed.is_some(),
            installed_version: installed.as_ref().map(|p| p.version.clone()),
            update_available: installed
                .as_ref()
                .map(|p| p.version != latest)
                .unwrap_or(false),
        }
    }
}

fn built_in_catalog() -> MarketCatalogFile {
    let data_dir = std::env::var("PI_DESKTOP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".pi-desktop")
        });
    let package_dir = data_dir.join("plugins/market/packages");
    let hello_path = package_dir.join("demo.hello-0.2.0.piplug");
    let notes_path = package_dir.join("demo.workspace-notes-0.1.0.piplug");
    let hello_bytes = bundled_package_bytes("demo.hello", "0.2.0").unwrap_or_default();
    let notes_bytes = bundled_package_bytes("demo.workspace-notes", "0.1.0").unwrap_or_default();
    MarketCatalogFile {
        provider_id: "official".into(),
        name: Some("PI-Desktop Official Plugins (bundled fallback)".into()),
        homepage: Some("https://github.com/vastsa/pi-desktop-plugins".into()),
        updated_at: Some("2026-07-28T00:00:00Z".into()),
        plugins: vec![
            MarketCatalogEntry {
                id: "demo.hello".into(),
                name: "Hello".into(),
                description: "Official sample plugin with panel, command, and echo tool.".into(),
                author: "PI-Desktop".into(),
                icon_url: None,
                categories: vec!["demo".into(), "official".into()],
                verified: true,
                downloads: Some(1280),
                homepage: Some("https://github.com/vastsa/PI-Desktop".into()),
                repository: Some("https://github.com/vastsa/PI-Desktop".into()),
                readme_markdown: Some(
                    "# Hello\n\nOfficial demo plugin used by the local marketplace provider.".into(),
                ),
                safety_notes: Some("Low risk demo. Registers one agent tool and one panel.".into()),
                versions: vec![MarketVersion {
                    version: "0.2.0".into(),
                    published_at: "2026-07-28T00:00:00Z".into(),
                    changelog: Some("Marketplace package with isolated panel bridge.".into()),
                    min_pi_desktop: Some(">=0.2.0".into()),
                    shasum: sha256_hex(&hello_bytes),
                    url: format!("file://{}", hello_path.to_string_lossy()),
                    size_bytes: hello_bytes.len() as u64,
                    permissions: vec![
                        "ui.panel".into(),
                        "agent.tool.register".into(),
                        "notify".into(),
                    ],
                }],
            },
            MarketCatalogEntry {
                id: "demo.workspace-notes".into(),
                name: "Workspace Notes".into(),
                description: "Read/write a notes file in the current workspace and fetch optional snippets.".into(),
                author: "PI-Desktop".into(),
                icon_url: None,
                categories: vec!["productivity".into(), "official".into()],
                verified: true,
                downloads: Some(420),
                homepage: None,
                repository: None,
                readme_markdown: Some(
                    "# Workspace Notes\n\nDemonstrates high-risk plugin capabilities with explicit grants.".into(),
                ),
                safety_notes: Some(
                    "Requests workspace write and network access. Review permissions before install.".into(),
                ),
                versions: vec![MarketVersion {
                    version: "0.1.0".into(),
                    published_at: "2026-07-28T00:00:00Z".into(),
                    changelog: Some("Initial marketplace release.".into()),
                    min_pi_desktop: Some(">=0.2.0".into()),
                    shasum: sha256_hex(&notes_bytes),
                    url: format!("file://{}", notes_path.to_string_lossy()),
                    size_bytes: notes_bytes.len() as u64,
                    permissions: vec![
                        "ui.panel".into(),
                        "fs.read.workspace".into(),
                        "fs.write.workspace".into(),
                        "net.fetch".into(),
                        "shell.openExternal".into(),
                        "clipboard.read".into(),
                        "clipboard.write".into(),
                        "notify".into(),
                        "agent.tool.register".into(),
                    ],
                }],
            },
        ],
    }
}

fn bundled_package_bytes(plugin_id: &str, version: &str) -> Option<Vec<u8>> {
    match (plugin_id, version) {
        ("demo.hello", "0.2.0") => Some(make_zip(&[
            (
                "manifest.json",
                br#"{
  "schemaVersion": 1,
  "id": "demo.hello",
  "name": "Hello",
  "version": "0.2.0",
  "description": "Official sample plugin with panel, command, and echo tool.",
  "author": "PI-Desktop",
  "main": "main.js",
  "ui": {
    "panel": "renderer/index.html",
    "width": 420,
    "height": 320,
    "title": "Hello Plugin"
  },
  "contributes": {
    "commands": [
      {
        "id": "hello.open",
        "title": "Hello: Open Panel",
        "keywords": ["hello", "demo"],
        "category": "Demo"
      }
    ],
    "agentTools": [
      {
        "name": "echo_text",
        "description": "Echo text back to the agent",
        "risk": "low",
        "schema": {
          "type": "object",
          "properties": { "text": { "type": "string" } },
          "required": ["text"]
        }
      }
    ],
    "settings": [
      {
        "key": "greeting",
        "type": "string",
        "default": "Hello from marketplace",
        "title": "Greeting"
      }
    ]
  },
  "permissions": ["ui.panel", "agent.tool.register", "notify"]
}"#,
            ),
            (
                "main.js",
                br#"async function onLoad() {
  const settings = await pi.plugin.getSettings();
  await pi.commands.register({
    id: "hello.open",
    title: "Hello: Open Panel",
    keywords: ["hello", "demo"],
    run: async () => {
      await pi.ui.openPanel({ title: "Hello Plugin" });
      await pi.ui.showToast(settings.greeting || "Hello from marketplace");
    },
  });
  await pi.agent.registerTool({
    name: "echo_text",
    description: "Echo text back to the agent",
    risk: "low",
    schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => ({
      ok: true,
      echo: String(args?.text ?? ""),
      pluginId: pi.plugin.getId(),
    }),
  });
}
async function onUnload() {
  await pi.commands.unregister("hello.open");
  await pi.agent.unregisterTool("echo_text");
}
module.exports = { onLoad, onUnload };
"#,
            ),
            (
                "renderer/index.html",
                br#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hello Plugin</title>
    <style>
      body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 16px; background: #0b1020; color: #e8eefc; }
      .card { border: 1px solid #24304d; border-radius: 12px; padding: 16px; background: #121a2f; }
      button { margin-top: 12px; border: 0; border-radius: 8px; padding: 8px 12px; background: #4f7cff; color: white; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Hello Plugin</h2>
      <p>Isolated marketplace panel with host bridge.</p>
      <button id="ping">Toast Ping</button>
    </div>
    <script>
      document.getElementById("ping").addEventListener("click", async () => {
        if (window.pluginBridge?.invoke) {
          await window.pluginBridge.invoke("ui.showToast", { message: "Hello panel bridge" });
        }
      });
    </script>
  </body>
</html>
"#,
            ),
        ])),
        ("demo.workspace-notes", "0.1.0") => Some(make_zip(&[
            (
                "manifest.json",
                br#"{
  "schemaVersion": 1,
  "id": "demo.workspace-notes",
  "name": "Workspace Notes",
  "version": "0.1.0",
  "description": "Read/write workspace notes and fetch remote snippets with explicit high-risk grants.",
  "author": "PI-Desktop",
  "main": "main.js",
  "ui": {
    "panel": "renderer/index.html",
    "width": 480,
    "height": 420,
    "title": "Workspace Notes"
  },
  "contributes": {
    "commands": [
      {
        "id": "notes.open",
        "title": "Notes: Open Panel",
        "keywords": ["notes", "workspace"],
        "category": "Productivity"
      }
    ],
    "agentTools": [
      {
        "name": "save_note",
        "description": "Append a note to NOTES.md in the workspace",
        "risk": "high",
        "schema": {
          "type": "object",
          "properties": { "text": { "type": "string" } },
          "required": ["text"]
        }
      }
    ]
  },
  "permissions": [
    "ui.panel",
    "fs.read.workspace",
    "fs.write.workspace",
    "net.fetch",
    "shell.openExternal",
    "clipboard.read",
    "clipboard.write",
    "notify",
    "agent.tool.register"
  ]
}"#,
            ),
            (
                "main.js",
                br#"const NOTE_FILE = "NOTES.md";
async function onLoad() {
  await pi.commands.register({
    id: "notes.open",
    title: "Notes: Open Panel",
    keywords: ["notes", "workspace"],
    run: async () => {
      await pi.ui.openPanel({ title: "Workspace Notes" });
    },
  });
  await pi.agent.registerTool({
    name: "save_note",
    description: "Append a note to NOTES.md in the workspace",
    risk: "high",
    schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => {
      const text = String(args?.text ?? "").trim();
      let current = "";
      try { current = await pi.fs.readText(NOTE_FILE); } catch {}
      const next = current ? `${current.trimEnd()}\n- ${text}\n` : `# Notes\n\n- ${text}\n`;
      await pi.fs.writeText(NOTE_FILE, next);
      await pi.ui.notify({ title: "Note saved", body: text.slice(0, 80) });
      return { ok: true, path: NOTE_FILE, bytes: next.length };
    },
  });
}
async function onUnload() {
  await pi.commands.unregister("notes.open");
  await pi.agent.unregisterTool("save_note");
}
module.exports = { onLoad, onUnload };
"#,
            ),
            (
                "renderer/index.html",
                br#"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Workspace Notes</title>
  <style>
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1020; color: #e8eefc; padding: 16px; }
    textarea { width: 100%; min-height: 180px; border-radius: 10px; border: 1px solid #24304d; background: #121a2f; color: inherit; padding: 10px; box-sizing: border-box; }
    .row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 8px 12px; background: #4f7cff; color: white; cursor: pointer; }
    button.secondary { background: #24304d; }
    .meta { color: #9db0d4; font-size: 12px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="meta">High-risk demo: workspace files, clipboard, network, external links.</div>
  <textarea id="notes" placeholder="Workspace NOTES.md"></textarea>
  <div class="row">
    <button id="reload">Reload</button>
    <button id="save">Save</button>
    <button class="secondary" id="clip">Copy</button>
    <button class="secondary" id="fetch">Fetch sample</button>
    <button class="secondary" id="docs">Open docs</button>
  </div>
  <script>
    const notes = document.getElementById('notes');
    async function reload() {
      try { notes.value = await window.pluginBridge.invoke('fs.readText', { path: 'NOTES.md' }); }
      catch { notes.value = '# Notes\n\n'; }
    }
    document.getElementById('reload').onclick = reload;
    document.getElementById('save').onclick = async () => {
      await window.pluginBridge.invoke('fs.writeText', { path: 'NOTES.md', content: notes.value });
      await window.pluginBridge.invoke('ui.showToast', { message: 'Saved NOTES.md' });
    };
    document.getElementById('clip').onclick = async () => {
      await window.pluginBridge.invoke('clipboard.writeText', { text: notes.value });
      await window.pluginBridge.invoke('ui.showToast', { message: 'Copied to clipboard' });
    };
    document.getElementById('fetch').onclick = async () => {
      const res = await window.pluginBridge.invoke('net.fetch', {
        url: 'https://example.com',
        method: 'GET',
        timeoutMs: 8000,
      });
      notes.value = `${notes.value.trim()}\n\n<!-- fetched status ${res.status} -->\n`;
    };
    document.getElementById('docs').onclick = async () => {
      await window.pluginBridge.invoke('shell.openExternal', { url: 'https://example.com' });
    };
    reload();
  </script>
</body>
</html>
"#,
            ),
        ])),
        _ => None,
    }
}

fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut offset: u32 = 0;
    let mut central = Vec::new();
    let mut entries = 0u16;
    for (name, data) in files {
        let name_bytes = name.as_bytes();
        let crc = crc32(data);
        let mut local = Vec::new();
        local.extend_from_slice(&0x04034b50u32.to_le_bytes());
        local.extend_from_slice(&20u16.to_le_bytes()); // version needed
        local.extend_from_slice(&0u16.to_le_bytes()); // flags
        local.extend_from_slice(&0u16.to_le_bytes()); // method store
        local.extend_from_slice(&0u16.to_le_bytes()); // time
        local.extend_from_slice(&0u16.to_le_bytes()); // date
        local.extend_from_slice(&crc.to_le_bytes());
        local.extend_from_slice(&(data.len() as u32).to_le_bytes());
        local.extend_from_slice(&(data.len() as u32).to_le_bytes());
        local.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes()); // extra
        local.extend_from_slice(name_bytes);
        local.extend_from_slice(data);
        out.extend_from_slice(&local);

        let mut cen = Vec::new();
        cen.extend_from_slice(&0x02014b50u32.to_le_bytes());
        cen.extend_from_slice(&20u16.to_le_bytes());
        cen.extend_from_slice(&20u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&crc.to_le_bytes());
        cen.extend_from_slice(&(data.len() as u32).to_le_bytes());
        cen.extend_from_slice(&(data.len() as u32).to_le_bytes());
        cen.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u16.to_le_bytes());
        cen.extend_from_slice(&0u32.to_le_bytes());
        cen.extend_from_slice(&offset.to_le_bytes());
        cen.extend_from_slice(name_bytes);
        central.extend_from_slice(&cen);
        offset += local.len() as u32;
        entries += 1;
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    let central_size = central.len() as u32;
    out.extend_from_slice(&0x06054b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn extract_zip_bytes(bytes: &[u8], dest: &Path) -> Result<()> {
    if bytes.len() < 22 {
        bail!("PLUGIN_INVALID: zip too small");
    }
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    let mut offset = 0usize;
    while offset + 30 <= bytes.len() {
        let sig = read_u32(bytes, offset)?;
        if sig == 0x02014b50 || sig == 0x06054b50 {
            break;
        }
        if sig != 0x04034b50 {
            bail!("PLUGIN_INVALID: bad zip local header");
        }
        let method = read_u16(bytes, offset + 8)?;
        let comp_size = read_u32(bytes, offset + 18)? as usize;
        let uncomp_size = read_u32(bytes, offset + 22)? as u64;
        let name_len = read_u16(bytes, offset + 26)? as usize;
        let extra_len = read_u16(bytes, offset + 28)? as usize;
        let name_start = offset + 30;
        let name_end = name_start + name_len;
        if name_end + extra_len + comp_size > bytes.len() {
            bail!("PLUGIN_INVALID: zip entry truncated");
        }
        let name = std::str::from_utf8(&bytes[name_start..name_end])
            .map_err(|_| anyhow!("PLUGIN_INVALID: zip name not utf8"))?;
        if method != 0 {
            bail!("PLUGIN_INVALID: only store-compressed piplug supported");
        }
        let data_start = name_end + extra_len;
        let data_end = data_start + comp_size;
        let data = &bytes[data_start..data_end];
        total_bytes += uncomp_size;
        if total_bytes > MAX_PACKAGE_BYTES {
            bail!("PLUGIN_INVALID: package exceeds 50MB limit");
        }
        file_count += 1;
        if file_count > MAX_PACKAGE_FILES {
            bail!("PLUGIN_INVALID: too many files in package");
        }
        if name.ends_with('/') {
            let dir = safe_join(dest, name)?;
            fs::create_dir_all(dir)?;
        } else {
            let path = safe_join(dest, name)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, data)?;
        }
        offset = data_end;
    }
    Ok(())
}

fn find_plugin_root(extract_dir: &Path) -> Result<PathBuf> {
    let direct = extract_dir.join("manifest.json");
    if direct.exists() {
        return Ok(extract_dir.to_path_buf());
    }
    for entry in fs::read_dir(extract_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let candidate = entry.path();
            if candidate.join("manifest.json").exists() {
                return Ok(candidate);
            }
        }
    }
    bail!("PLUGIN_INVALID: manifest.json missing in package")
}

fn copy_dir_filtered(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    fn walk(from: &Path, to: &Path, file_count: &mut usize, total_bytes: &mut u64) -> Result<()> {
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == ".git" || name_str == "node_modules" {
                continue;
            }
            let target = to.join(&name);
            if file_type.is_symlink() {
                bail!("PLUGIN_INVALID: symlinks are not allowed");
            } else if file_type.is_dir() {
                fs::create_dir_all(&target)?;
                walk(&entry.path(), &target, file_count, total_bytes)?;
            } else if file_type.is_file() {
                *file_count += 1;
                if *file_count > MAX_PACKAGE_FILES {
                    bail!("PLUGIN_INVALID: too many files in package");
                }
                let meta = entry.metadata()?;
                *total_bytes += meta.len();
                if *total_bytes > MAX_PACKAGE_BYTES {
                    bail!("PLUGIN_INVALID: package exceeds 50MB limit");
                }
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(entry.path(), &target)?;
            }
        }
        Ok(())
    }
    walk(src, dest, &mut file_count, &mut total_bytes)
}

fn safe_join(base: &Path, rel: &str) -> Result<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.starts_with('/') || rel.contains(':') {
        bail!("PLUGIN_INVALID: absolute paths are not allowed");
    }
    let mut out = base.to_path_buf();
    for comp in Path::new(&rel).components() {
        match comp {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            Component::ParentDir => bail!("PLUGIN_INVALID: path traversal is not allowed"),
            _ => bail!("PLUGIN_INVALID: unsupported path component"),
        }
    }
    if !out.starts_with(base) {
        bail!("PLUGIN_INVALID: path escaped package root");
    }
    Ok(out)
}

/// Validate the contribution kinds the host activates.
///
/// Paths must stay inside the plugin directory and exist, MCP endpoints must be
/// launchable/reachable without shell interpretation, and every new capability
/// must be backed by its declared permission. `skills` predates the permission
/// gate, so a missing `agent.prompt.inject` only stops activation at runtime.
fn validate_contributions(root: &Path, manifest: &PluginManifest) -> Result<()> {
    let Some(contributes) = manifest.contributes.as_ref() else {
        return Ok(());
    };
    if contributes.is_null() {
        return Ok(());
    }
    let Some(map) = contributes.as_object() else {
        bail!("PLUGIN_INVALID: contributes must be an object");
    };

    if let Some(skills) = map.get("skills") {
        let entries = array_of(skills, "contributes.skills")?;
        for entry in entries {
            let path = match entry {
                Value::String(s) => s.as_str(),
                Value::Object(obj) => obj.get("path").and_then(Value::as_str).ok_or_else(|| {
                    anyhow!("PLUGIN_INVALID: contributes.skills entry needs path")
                })?,
                _ => bail!("PLUGIN_INVALID: contributes.skills entry must be a string or object"),
            };
            let resolved = safe_join(root, path)?;
            if !resolved.exists() {
                bail!("PLUGIN_INVALID: skill file missing: {path}");
            }
        }
    }

    if let Some(themes) = map.get("themes") {
        let entries = array_of(themes, "contributes.themes")?;
        if !entries.is_empty() {
            require_permission(manifest, "ui.theme", "themes")?;
        }
        let mut seen: Vec<&str> = Vec::new();
        for entry in entries {
            let obj = entry.as_object().ok_or_else(|| {
                anyhow!("PLUGIN_INVALID: contributes.themes entry must be an object")
            })?;
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| is_contrib_id(id))
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: theme id is missing or invalid"))?;
            if seen.contains(&id) {
                bail!("PLUGIN_INVALID: duplicate theme id {id}");
            }
            seen.push(id);
            if obj
                .get("label")
                .and_then(Value::as_str)
                .map(|l| l.trim().is_empty())
                .unwrap_or(true)
            {
                bail!("PLUGIN_INVALID: theme {id} requires a label");
            }
            let path = obj
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: theme {id} requires a path"))?;
            if !path.to_ascii_lowercase().ends_with(".css") {
                bail!("PLUGIN_INVALID: theme {id} path must be a .css file");
            }
            let resolved = safe_join(root, path)?;
            if !resolved.exists() {
                bail!("PLUGIN_INVALID: theme css missing: {path}");
            }
            match obj.get("base").and_then(Value::as_str) {
                None | Some("light") | Some("dark") => {}
                Some(other) => bail!("PLUGIN_INVALID: theme {id} base {other} is not supported"),
            }
        }
    }

    if let Some(servers) = map.get("mcpServers") {
        let entries = array_of(servers, "contributes.mcpServers")?;
        let mut seen: Vec<&str> = Vec::new();
        for entry in entries {
            let obj = entry.as_object().ok_or_else(|| {
                anyhow!("PLUGIN_INVALID: contributes.mcpServers entry must be an object")
            })?;
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| is_contrib_id(id))
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: mcp server id is missing or invalid"))?;
            if seen.contains(&id) {
                bail!("PLUGIN_INVALID: duplicate mcp server id {id}");
            }
            seen.push(id);
            match obj.get("transport").and_then(Value::as_str) {
                Some("stdio") => {
                    require_permission(manifest, "mcp.server.local", "stdio mcp servers")?;
                    if obj.contains_key("url") || obj.contains_key("headers") {
                        bail!("PLUGIN_INVALID: mcp server {id} must not set url or headers");
                    }
                    let command = obj
                        .get("command")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|c| !c.is_empty())
                        .ok_or_else(|| {
                            anyhow!("PLUGIN_INVALID: mcp server {id} requires command")
                        })?;
                    if command.contains('/') || command.contains('\\') {
                        let resolved = safe_join(root, command)?;
                        if !resolved.exists() {
                            bail!("PLUGIN_INVALID: mcp server {id} command missing: {command}");
                        }
                    } else if !command
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
                    {
                        bail!("PLUGIN_INVALID: mcp server {id} command is not an executable name");
                    }
                    if let Some(args) = obj.get("args") {
                        for arg in array_of(args, "mcp server args")? {
                            if !arg.is_string() {
                                bail!("PLUGIN_INVALID: mcp server {id} args must be strings");
                            }
                        }
                    }
                }
                Some("http") => {
                    require_permission(manifest, "mcp.server.remote", "remote mcp servers")?;
                    if obj.contains_key("command")
                        || obj.contains_key("args")
                        || obj.contains_key("env")
                    {
                        bail!("PLUGIN_INVALID: mcp server {id} must not set command, args or env");
                    }
                    let url = obj
                        .get("url")
                        .and_then(Value::as_str)
                        .ok_or_else(|| anyhow!("PLUGIN_INVALID: mcp server {id} requires url"))?;
                    validate_mcp_url(id, url)?;
                }
                _ => bail!("PLUGIN_INVALID: mcp server {id} transport must be stdio or http"),
            }
        }
    }

    if let Some(services) = map.get("services") {
        let entries = array_of(services, "contributes.services")?;
        if !entries.is_empty() {
            require_permission(manifest, "background.service", "background services")?;
        }
        let mut seen: Vec<&str> = Vec::new();
        for entry in entries {
            let obj = entry.as_object().ok_or_else(|| {
                anyhow!("PLUGIN_INVALID: contributes.services entry must be an object")
            })?;
            let id = obj
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| is_contrib_id(id))
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: service id is missing or invalid"))?;
            if seen.contains(&id) {
                bail!("PLUGIN_INVALID: duplicate service id {id}");
            }
            seen.push(id);
        }
    }

    if let Some(bus) = map.get("bus") {
        let obj = bus
            .as_object()
            .ok_or_else(|| anyhow!("PLUGIN_INVALID: contributes.bus must be an object"))?;
        let publish = obj
            .get("publish")
            .map(|v| array_of(v, "contributes.bus.publish"))
            .transpose()?;
        let subscribe = obj
            .get("subscribe")
            .map(|v| array_of(v, "contributes.bus.subscribe"))
            .transpose()?;
        if publish.map(|p| !p.is_empty()).unwrap_or(false) {
            require_permission(manifest, "bus.publish", "bus publishing")?;
        }
        if subscribe.map(|s| !s.is_empty()).unwrap_or(false) {
            require_permission(manifest, "bus.subscribe", "bus subscriptions")?;
        }
        for topic in publish.unwrap_or(&[]) {
            let topic = topic
                .as_str()
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: bus publish topics must be strings"))?;
            if !is_bus_topic(topic, false) {
                bail!("PLUGIN_INVALID: bus publish topic {topic} is not a valid topic");
            }
        }
        for pattern in subscribe.unwrap_or(&[]) {
            let pattern = pattern
                .as_str()
                .ok_or_else(|| anyhow!("PLUGIN_INVALID: bus subscribe patterns must be strings"))?;
            if !is_bus_topic(pattern, true) {
                bail!("PLUGIN_INVALID: bus subscribe pattern {pattern} is not valid");
            }
        }
    }

    Ok(())
}

/// Capability tokens the UI renders as badges.
fn derive_capabilities(manifest: &PluginManifest) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if manifest
        .ui
        .as_ref()
        .and_then(|ui| ui.panel.as_ref())
        .is_some()
    {
        out.push("panel".into());
    }
    let map = manifest.contributes.as_ref().and_then(Value::as_object);
    let has = |key: &str| -> bool {
        map.and_then(|m| m.get(key))
            .and_then(Value::as_array)
            .map(|a| !a.is_empty())
            .unwrap_or(false)
    };
    if has("commands") {
        out.push("commands".into());
    }
    if has("agentTools") {
        out.push("tools".into());
    }
    if has("skills") {
        out.push("skills".into());
    }
    if has("themes") {
        out.push("themes".into());
    }
    if has("mcpServers") {
        out.push("mcp".into());
    }
    if has("services") {
        out.push("services".into());
    }
    let bus_declared = map
        .and_then(|m| m.get("bus"))
        .and_then(Value::as_object)
        .map(|bus| {
            ["publish", "subscribe"].iter().any(|key| {
                bus.get(*key)
                    .and_then(Value::as_array)
                    .map(|a| !a.is_empty())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if bus_declared {
        out.push("bus".into());
    }
    out
}

fn array_of<'a>(value: &'a Value, field: &str) -> Result<&'a [Value]> {
    value
        .as_array()
        .map(|a| a.as_slice())
        .ok_or_else(|| anyhow!("PLUGIN_INVALID: {field} must be an array"))
}

fn require_permission(manifest: &PluginManifest, permission: &str, what: &str) -> Result<()> {
    if manifest.permissions.iter().any(|p| p == permission) {
        return Ok(());
    }
    bail!("PLUGIN_INVALID: {what} require the {permission} permission")
}

fn is_contrib_id(value: &str) -> bool {
    if value.is_empty() || value.len() > 64 {
        return false;
    }
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Shares the topic grammar with `matchesBusTopic` in the plugin SDK.
fn is_bus_topic(value: &str, allow_wildcards: bool) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    let segments: Vec<&str> = value.split('.').collect();
    if segments.len() > 8 {
        return false;
    }
    segments.iter().enumerate().all(|(index, segment)| {
        if allow_wildcards && *segment == "*" {
            return true;
        }
        if allow_wildcards && *segment == "**" {
            return index == segments.len() - 1;
        }
        let mut chars = segment.chars();
        match chars.next() {
            Some(c) if c.is_ascii_alphanumeric() => {}
            _ => return false,
        }
        chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    })
}

fn validate_mcp_url(id: &str, url: &str) -> Result<()> {
    let lower = url.trim().to_ascii_lowercase();
    let (rest, plain_http) = if let Some(rest) = lower.strip_prefix("https://") {
        (rest, false)
    } else if let Some(rest) = lower.strip_prefix("http://") {
        (rest, true)
    } else {
        bail!("PLUGIN_INVALID: mcp server {id} url must use http or https");
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        bail!("PLUGIN_INVALID: mcp server {id} url is missing a host");
    }
    if authority.contains('@') {
        bail!("PLUGIN_INVALID: mcp server {id} url must not embed credentials");
    }
    let host = if let Some(stripped) = authority.strip_prefix('[') {
        match stripped.find(']') {
            Some(close) => &stripped[..close],
            None => bail!("PLUGIN_INVALID: mcp server {id} url host is malformed"),
        }
    } else {
        authority.split(':').next().unwrap_or(authority)
    };
    if host.is_empty() {
        bail!("PLUGIN_INVALID: mcp server {id} url is missing a host");
    }
    if plain_http && !is_loopback_host(host) {
        bail!("PLUGIN_INVALID: mcp server {id} url must use https outside loopback");
    }
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    host == "localhost" || host == "::1" || host == "0:0:0:0:0:0:0:1" || host.starts_with("127.")
}

fn permission_diff(old: &[String], new: &[String]) -> Vec<String> {
    new.iter()
        .filter(|p| !old.iter().any(|o| o == *p))
        .cloned()
        .collect()
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for b in data {
        crc ^= u32::from(*b);
        for _ in 0..8 {
            let mask = (!(crc & 1)).wrapping_add(1);
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| anyhow!("PLUGIN_INVALID: zip truncated"))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| anyhow!("PLUGIN_INVALID: zip truncated"))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn download_url(url: &str) -> Result<Vec<u8>> {
    if let Some(path) = url.strip_prefix("file://") {
        return fs::read(path).with_context(|| format!("read local url {path}"));
    }

    // Prefer curl for robust HTTPS support on developer and CI machines.
    if let Ok(output) = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--location",
            "--fail",
            "--max-time",
            "30",
            "--user-agent",
            "pi-desktop-host-core",
            url,
        ])
        .output()
    {
        if output.status.success() {
            if output.stdout.len() as u64 > MAX_PACKAGE_BYTES {
                bail!("PLUGIN_INVALID: package exceeds 50MB limit");
            }
            return Ok(output.stdout);
        }
        let err = String::from_utf8_lossy(&output.stderr);
        // Fall through to raw HTTP only for http:// URLs.
        if url.starts_with("https://") {
            bail!("PLUGIN_NETWORK: curl failed for {url}: {err}");
        }
    } else if url.starts_with("https://") {
        bail!("PLUGIN_NETWORK: curl is required to fetch https marketplace urls");
    }

    if let Some(rest) = url.strip_prefix("http://") {
        let (host_port, path) = rest.split_once('/').unwrap_or((rest, ""));
        let path = if path.is_empty() {
            "/".to_string()
        } else {
            format!("/{path}")
        };
        let host = host_port.split(':').next().unwrap_or(host_port);
        let port: u16 = host_port
            .split(':')
            .nth(1)
            .and_then(|p| p.parse().ok())
            .unwrap_or(80);
        let mut stream = std::net::TcpStream::connect((host, port))
            .with_context(|| format!("connect {host}:{port}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(15)))?;
        stream.set_write_timeout(Some(Duration::from_secs(15)))?;
        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nUser-Agent: pi-desktop-host-core\r\nAccept: */*\r\n\r\n"
        );
        stream.write_all(req.as_bytes())?;
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf)?;
        let text = String::from_utf8_lossy(&buf);
        let Some(idx) = text.find("\r\n\r\n") else {
            bail!("PLUGIN_NETWORK: invalid HTTP response");
        };
        let body = buf[idx + 4..].to_vec();
        if body.len() as u64 > MAX_PACKAGE_BYTES {
            bail!("PLUGIN_INVALID: package exceeds 50MB limit");
        }
        return Ok(body);
    }

    bail!("PLUGIN_NETWORK: unsupported marketplace url: {url}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activation::ActivationMode;
    use tempfile::tempdir;

    fn with_local_market<T>(f: impl FnOnce() -> T) -> T {
        // Force offline/local fallback path for deterministic unit tests.
        // Safety: test-only process env mutation.
        unsafe {
            std::env::set_var(
                "PI_DESKTOP_PLUGIN_MARKET_URL",
                "file:///nope/does-not-exist-catalog.json",
            );
        }
        let out = f();
        unsafe {
            std::env::remove_var("PI_DESKTOP_PLUGIN_MARKET_URL");
        }
        out
    }

    #[test]
    fn install_market_package_and_check_update_metadata() {
        with_local_market(|| {
            let dir = tempdir().unwrap();
            unsafe {
                std::env::set_var("PI_DESKTOP_DATA_DIR", dir.path());
            }
            let mut mgr = PluginManager::new(dir.path());
            let search = mgr.market_search(Some("hello"), None).unwrap();
            assert!(!search.is_empty());
            let installed = mgr
                .install_from_market("demo.hello", None, true, true, None)
                .unwrap();
            assert_eq!(installed.plugin.id, "demo.hello");
            assert!(installed.plugin.path.unwrap().contains("installed"));
            assert_eq!(installed.plugin.source, "marketplace");
            let listed = mgr.list();
            assert_eq!(listed.len(), 1);
            unsafe {
                std::env::remove_var("PI_DESKTOP_DATA_DIR");
            }
        });
    }

    #[test]
    fn package_path_traversal_rejected() {
        let dir = tempdir().unwrap();
        unsafe {
            std::env::set_var("PI_DESKTOP_DATA_DIR", dir.path());
        }
        let bad = make_zip(&[("../evil.js", b"alert(1)")]);
        let pkg = dir.path().join("bad.piplug");
        fs::write(&pkg, bad).unwrap();
        let mut mgr = PluginManager::new(dir.path());
        let err = mgr
            .install_from_package(
                pkg.to_str().unwrap(),
                InstallOptions {
                    source: "installed".into(),
                    enable: true,
                    marketplace: None,
                    expected_shasum: None,
                    auto_update: false,
                    granted_permissions: None,
                },
            )
            .unwrap_err()
            .to_string();
        assert!(err.contains("path traversal") || err.contains("PLUGIN_INVALID"));
        unsafe {
            std::env::remove_var("PI_DESKTOP_DATA_DIR");
        }
    }

    #[test]
    fn high_risk_permissions_roundtrip_on_notes_plugin() {
        with_local_market(|| {
            let dir = tempdir().unwrap();
            unsafe {
                std::env::set_var("PI_DESKTOP_DATA_DIR", dir.path());
            }
            // Clean up any existing packages to ensure fresh generation
            let packages_dir = dir.path().join("plugins/market/packages");
            if packages_dir.exists() {
                let _ = fs::remove_dir_all(&packages_dir);
            }
            let mut mgr = PluginManager::new(dir.path());
            let installed = mgr
                .install_from_market("demo.workspace-notes", None, true, false, None)
                .unwrap();
            assert!(installed
                .plugin
                .permissions
                .iter()
                .any(|p| p == "fs.write.workspace"));
            assert!(installed
                .plugin
                .permissions
                .iter()
                .any(|p| p == "net.fetch"));
            unsafe {
                std::env::remove_var("PI_DESKTOP_DATA_DIR");
            }
        });
    }

    #[test]
    fn resolve_relative_package_urls_against_catalog() {
        let resolved = PluginManager::resolve_package_url(
            "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json",
            "packages/demo.hello-0.2.0.piplug",
        );
        assert_eq!(
            resolved,
            "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/packages/demo.hello-0.2.0.piplug"
        );
    }

    #[test]
    fn refresh_catalog_from_official_repo_when_network_available() {
        // Skip cleanly if offline / rate-limited.
        let url = "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json";
        if download_url(url).is_err() {
            return;
        }
        let dir = tempdir().unwrap();
        unsafe {
            std::env::set_var("PI_DESKTOP_DATA_DIR", dir.path());
            std::env::set_var("PI_DESKTOP_PLUGIN_MARKET_URL", url);
        }
        let mgr = PluginManager::new(dir.path());
        let meta = mgr.refresh_market(true).expect("remote catalog");
        assert_eq!(meta["providerId"], "official");
        assert!(meta["pluginCount"].as_u64().unwrap_or(0) >= 1);
        assert!(meta["sourceUrl"]
            .as_str()
            .unwrap_or("")
            .contains("pi-desktop-plugins"));
        let search = mgr.market_search(Some("hello"), None).unwrap();
        assert!(search.iter().any(|p| p.id == "demo.hello"));
        unsafe {
            std::env::remove_var("PI_DESKTOP_DATA_DIR");
            std::env::remove_var("PI_DESKTOP_PLUGIN_MARKET_URL");
        }
    }

    fn write_plugin(root: &Path, manifest: Value, extra: &[(&str, &str)]) {
        fs::create_dir_all(root).unwrap();
        fs::write(root.join("main.js"), "export function onLoad() {}").unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        for (rel, contents) in extra {
            let path = root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
    }

    fn capability_manifest(contributes: Value, permissions: Value) -> Value {
        json!({
            "schemaVersion": 1,
            "id": "demo.caps",
            "name": "Caps",
            "version": "0.1.0",
            "main": "main.js",
            "contributes": contributes,
            "permissions": permissions,
        })
    }

    fn read_manifest_err(root: &Path) -> String {
        PluginManager::read_manifest(root)
            .expect_err("manifest should be rejected")
            .to_string()
    }

    #[test]
    fn accepts_and_summarizes_new_contributions() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("plugin");
        write_plugin(
            &root,
            json!({
                "schemaVersion": 1,
                "id": "demo.caps",
                "name": "Caps",
                "version": "0.1.0",
                "main": "main.js",
                "ui": { "panel": "renderer/index.html" },
                "contributes": {
                    "commands": [{ "id": "a", "title": "A" }],
                    "agentTools": [{ "name": "t", "description": "d" }],
                    "skills": ["./skills/a.md", { "path": "skills/b.md", "id": "b" }],
                    "themes": [{ "id": "midnight", "label": "Midnight", "path": "themes/m.css", "base": "dark" }],
                    "mcpServers": [
                        { "id": "local", "transport": "stdio", "command": "mcp-files", "args": ["--root", "."] },
                        { "id": "remote", "transport": "http", "url": "https://example.com/mcp" }
                    ],
                    "services": [{ "id": "watcher" }],
                    "bus": { "publish": ["notes.created"], "subscribe": ["notes.**"] }
                },
                "permissions": [
                    "ui.panel",
                    "ui.theme",
                    "agent.tool.register",
                    "mcp.server.local",
                    "mcp.server.remote",
                    "background.service",
                    "bus.publish",
                    "bus.subscribe"
                ],
            }),
            &[
                ("renderer/index.html", "<html></html>"),
                ("skills/a.md", "---\nname: A\n---\nbody"),
                ("skills/b.md", "body"),
                ("themes/m.css", ":root { --ds-bg: #000; }"),
            ],
        );
        let manifest = PluginManager::read_manifest(&root).unwrap();
        assert_eq!(
            derive_capabilities(&manifest),
            vec!["panel", "commands", "tools", "skills", "themes", "mcp", "services", "bus"]
        );

        let data = tempdir().unwrap();
        unsafe {
            std::env::set_var("PI_DESKTOP_DATA_DIR", data.path());
        }
        let mut mgr = PluginManager::new(data.path());
        let summary = mgr.load_dev(root.to_str().unwrap()).unwrap();
        assert!(summary.capabilities.contains(&"mcp".to_string()));
        assert!(summary.capabilities.contains(&"bus".to_string()));
        unsafe {
            std::env::remove_var("PI_DESKTOP_DATA_DIR");
        }
    }

    #[test]
    fn missing_contributed_files_are_rejected() {
        let dir = tempdir().unwrap();
        let skill_root = dir.path().join("skill");
        write_plugin(
            &skill_root,
            capability_manifest(json!({ "skills": ["skills/gone.md"] }), json!([])),
            &[],
        );
        assert!(read_manifest_err(&skill_root).contains("skill file missing"));

        let theme_root = dir.path().join("theme");
        write_plugin(
            &theme_root,
            capability_manifest(
                json!({ "themes": [{ "id": "a", "label": "A", "path": "themes/gone.css" }] }),
                json!(["ui.theme"]),
            ),
            &[],
        );
        assert!(read_manifest_err(&theme_root).contains("theme css missing"));
    }

    #[test]
    fn contributed_paths_must_stay_inside_the_plugin() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("plugin");
        write_plugin(
            &root,
            capability_manifest(json!({ "skills": ["../outside.md"] }), json!([])),
            &[],
        );
        assert!(read_manifest_err(&root).contains("traversal"));
    }

    #[test]
    fn theme_contributions_require_permission_and_css() {
        let dir = tempdir().unwrap();
        let no_perm = dir.path().join("no-perm");
        write_plugin(
            &no_perm,
            capability_manifest(
                json!({ "themes": [{ "id": "a", "label": "A", "path": "themes/a.css" }] }),
                json!([]),
            ),
            &[("themes/a.css", ":root {}")],
        );
        assert!(read_manifest_err(&no_perm).contains("ui.theme permission"));

        let wrong_ext = dir.path().join("wrong-ext");
        write_plugin(
            &wrong_ext,
            capability_manifest(
                json!({ "themes": [{ "id": "a", "label": "A", "path": "themes/a.json" }] }),
                json!(["ui.theme"]),
            ),
            &[("themes/a.json", "{}")],
        );
        assert!(read_manifest_err(&wrong_ext).contains(".css file"));
    }

    #[test]
    fn stdio_mcp_commands_may_not_escape_the_plugin() {
        let dir = tempdir().unwrap();
        for (name, command, expected) in [
            ("absolute", "/usr/bin/evil", "absolute"),
            ("traversal", "../evil.js", "traversal"),
            ("shell", "sh -c evil", "executable name"),
        ] {
            let root = dir.path().join(name);
            write_plugin(
                &root,
                capability_manifest(
                    json!({ "mcpServers": [{ "id": "s", "transport": "stdio", "command": command }] }),
                    json!(["mcp.server.local"]),
                ),
                &[],
            );
            assert!(
                read_manifest_err(&root).contains(expected),
                "command {command} should be rejected"
            );
        }
    }

    #[test]
    fn remote_mcp_urls_must_use_https_outside_loopback() {
        let dir = tempdir().unwrap();
        let remote = dir.path().join("remote");
        write_plugin(
            &remote,
            capability_manifest(
                json!({ "mcpServers": [{ "id": "s", "transport": "http", "url": "http://example.com/mcp" }] }),
                json!(["mcp.server.remote"]),
            ),
            &[],
        );
        assert!(read_manifest_err(&remote).contains("https outside loopback"));

        let credentials = dir.path().join("credentials");
        write_plugin(
            &credentials,
            capability_manifest(
                json!({ "mcpServers": [{ "id": "s", "transport": "http", "url": "https://u:p@example.com/mcp" }] }),
                json!(["mcp.server.remote"]),
            ),
            &[],
        );
        assert!(read_manifest_err(&credentials).contains("credentials"));

        let loopback = dir.path().join("loopback");
        write_plugin(
            &loopback,
            capability_manifest(
                json!({ "mcpServers": [{ "id": "s", "transport": "http", "url": "http://127.0.0.1:8931/mcp" }] }),
                json!(["mcp.server.remote"]),
            ),
            &[],
        );
        assert!(PluginManager::read_manifest(&loopback).is_ok());
    }

    #[test]
    fn services_and_bus_declarations_are_checked() {
        let dir = tempdir().unwrap();
        let service = dir.path().join("service");
        write_plugin(
            &service,
            capability_manifest(json!({ "services": [{ "id": "watcher" }] }), json!([])),
            &[],
        );
        assert!(read_manifest_err(&service).contains("background.service permission"));

        let topic = dir.path().join("topic");
        write_plugin(
            &topic,
            capability_manifest(
                json!({ "bus": { "publish": ["notes.*"] } }),
                json!(["bus.publish"]),
            ),
            &[],
        );
        assert!(read_manifest_err(&topic).contains("not a valid topic"));

        let pattern = dir.path().join("pattern");
        write_plugin(
            &pattern,
            capability_manifest(
                json!({ "bus": { "subscribe": ["notes.**.x"] } }),
                json!(["bus.subscribe"]),
            ),
            &[],
        );
        assert!(read_manifest_err(&pattern).contains("not valid"));
    }

    /// A scope is a user decision about reach, so it has to survive the two
    /// things that rewrite a plugin record: a restart and a reinstall.
    #[test]
    fn a_project_scope_survives_a_reload_and_a_reinstall() {
        let dir = tempdir().unwrap();
        unsafe {
            std::env::set_var("PI_DESKTOP_DATA_DIR", dir.path());
        }

        let source = dir.path().join("src");
        write_plugin(
            &source,
            json!({
                "schemaVersion": 1,
                "id": "demo.scoped",
                "name": "Scoped",
                "version": "0.1.0",
                "main": "main.js",
            }),
            &[],
        );

        let mut mgr = PluginManager::new(dir.path());
        let installed = mgr
            .install_from_path(
                source.to_str().unwrap(),
                InstallOptions {
                    source: "installed".into(),
                    enable: true,
                    ..Default::default()
                },
            )
            .unwrap();
        // Anything installed before scopes existed reads as global, so that is
        // also what a fresh install has to be.
        assert_eq!(installed.plugin.scope.mode, ActivationMode::Global);

        let scoped = mgr
            .set_scope(
                "demo.scoped",
                ActivationScope {
                    mode: ActivationMode::Projects,
                    projects: vec!["/work/api".into()],
                },
            )
            .unwrap()
            .expect("plugin missing");
        assert_eq!(scoped.scope.projects, vec!["/work/api".to_string()]);

        // Off is a separate switch: it must not consume the project list.
        let disabled = mgr.set_enabled("demo.scoped", false).unwrap().unwrap();
        assert!(!disabled.enabled);
        assert_eq!(disabled.scope.projects, vec!["/work/api".to_string()]);

        let reloaded = PluginManager::new(dir.path());
        let after = reloaded.get("demo.scoped").expect("plugin missing");
        assert_eq!(after.scope.mode, ActivationMode::Projects);
        assert_eq!(after.scope.projects, vec!["/work/api".to_string()]);

        // Reinstalling over the top is an update, not a reset: widening a
        // project-scoped plugin back to everywhere would hand it reach the user
        // never granted.
        let mut mgr = PluginManager::new(dir.path());
        let again = mgr
            .install_from_path(
                source.to_str().unwrap(),
                InstallOptions {
                    source: "installed".into(),
                    enable: true,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(again.plugin.scope.mode, ActivationMode::Projects);
        assert_eq!(again.plugin.scope.projects, vec!["/work/api".to_string()]);

        unsafe {
            std::env::remove_var("PI_DESKTOP_DATA_DIR");
        }
    }
}
