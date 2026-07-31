use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::Result;

use crate::db::Database;
use crate::permissions::PermissionManager;
use crate::plans::PlanManager;
use crate::plugins::PluginManager;
use crate::secrets::SecretStore;
use crate::workspace::WorkspaceState;

pub const PROTOCOL_VERSION: u32 = 9;
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");
const BASH_ABORT_TOMBSTONE_TTL: Duration = Duration::from_secs(60);
const MAX_BASH_ABORT_TOMBSTONES: usize = 1024;

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
    /// (session_id, tool_call_id) -> cancellation signal for an active Bash
    /// process. The signal is removed by the execution owner in all outcomes.
    pub active_bash_cancellations:
        HashMap<(String, String), tokio::sync::watch::Sender<bool>>,
    /// Abort can race ahead of tools.execute because host RPC requests run in
    /// separate tasks. A short-lived tombstone makes the later request start
    /// already cancelled instead of executing after Stop was acknowledged.
    pending_bash_aborts: HashMap<(String, String), Instant>,
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
            active_bash_cancellations: HashMap::new(),
            pending_bash_aborts: HashMap::new(),
        })
    }

    fn prune_bash_abort_tombstones(&mut self) {
        self.pending_bash_aborts
            .retain(|_, requested_at| requested_at.elapsed() < BASH_ABORT_TOMBSTONE_TTL);
        while self.pending_bash_aborts.len() > MAX_BASH_ABORT_TOMBSTONES {
            let Some(oldest) = self
                .pending_bash_aborts
                .iter()
                .min_by_key(|(_, requested_at)| **requested_at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.pending_bash_aborts.remove(&oldest);
        }
    }

    pub fn register_bash_cancellation(
        &mut self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Result<tokio::sync::watch::Receiver<bool>, String> {
        self.prune_bash_abort_tombstones();
        let key = (session_id.to_string(), tool_call_id.to_string());
        if self.active_bash_cancellations.contains_key(&key) {
            return Err("TOOL_BUSY".into());
        }
        let initially_aborted = self.pending_bash_aborts.remove(&key).is_some();
        let (sender, receiver) = tokio::sync::watch::channel(initially_aborted);
        self.active_bash_cancellations.insert(key, sender);
        Ok(receiver)
    }

    pub fn abort_or_queue_bash(
        &mut self,
        session_id: &str,
        tool_call_id: &str,
    ) -> (bool, bool) {
        self.prune_bash_abort_tombstones();
        let key = (session_id.to_string(), tool_call_id.to_string());
        let active = self
            .active_bash_cancellations
            .get(&key)
            .is_some_and(|sender| sender.send(true).is_ok());
        if active {
            (true, false)
        } else {
            self.pending_bash_aborts.insert(key, Instant::now());
            (false, true)
        }
    }

    pub fn clear_bash_cancellation(&mut self, session_id: &str, tool_call_id: &str) {
        let key = (session_id.to_string(), tool_call_id.to_string());
        self.active_bash_cancellations.remove(&key);
        self.pending_bash_aborts.remove(&key);
    }

    pub fn uptime_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}
