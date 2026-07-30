use std::collections::HashMap;
use std::time::Instant;

use anyhow::Result;

use crate::db::Database;
use crate::permissions::PermissionManager;
use crate::plans::PlanManager;
use crate::plugins::PluginManager;
use crate::secrets::SecretStore;
use crate::workspace::WorkspaceState;

pub const PROTOCOL_VERSION: u32 = 7;
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct AppState {
    pub data_dir: std::path::PathBuf,
    pub db: Database,
    pub secrets: SecretStore,
    pub workspace: WorkspaceState,
    pub permissions: PermissionManager,
    pub plans: PlanManager,
    pub plugins: PluginManager,
    pub started_at: Instant,
    pub handshook: bool,
    /// session_id -> toolName grants
    pub session_grants: HashMap<String, Vec<String>>,
    /// executionId -> responder for plugin tool dispatches awaiting the
    /// desktop runner (Electron main executes the plugin JS and resolves).
    pub plugin_execs: HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>,
}

impl AppState {
    pub fn open(data_dir: &std::path::Path) -> Result<Self> {
        let db = Database::open_in_dir(data_dir)?;
        let secrets = SecretStore::open(data_dir)?;
        let plugins = PluginManager::new(data_dir);
        Ok(Self {
            data_dir: data_dir.to_path_buf(),
            db,
            secrets,
            workspace: WorkspaceState::default(),
            permissions: PermissionManager::default(),
            plans: PlanManager::default(),
            plugins,
            started_at: Instant::now(),
            handshook: false,
            session_grants: HashMap::new(),
            plugin_execs: HashMap::new(),
        })
    }

    pub fn uptime_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}
