mod artifacts;
mod audit;
mod db;
mod notifications;
mod permissions;
mod plugins;
mod providers;
mod review;
mod rpc;
mod scheduled;
mod scratch;
mod secrets;
mod sessions;
mod state;
mod tools;
mod transcripts;
mod tool_budget;
mod workspace;

use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let data_dir = std::env::var("PI_DESKTOP_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".pi-desktop")
        });

    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(data_dir.join("logs"))?;
    std::fs::create_dir_all(data_dir.join("plugins/installed"))?;
    std::fs::create_dir_all(data_dir.join("plugins/data"))?;
    std::fs::create_dir_all(data_dir.join("plugins/market"))?;
    std::fs::create_dir_all(data_dir.join("plugins/cache/download"))?;
    std::fs::create_dir_all(data_dir.join("cache"))?;
    std::fs::create_dir_all(data_dir.join("scratch"))?;

    let state = Arc::new(Mutex::new(AppState::open(&data_dir)?));
    tracing::info!(path = %data_dir.display(), "host-core starting");
    {
        // Sweep orphaned/stale session scratch dirs left behind by crashes or
        // deletions that bypassed session.delete (D114).
        let st = state.lock().await;
        // Only sweep with a real session list: an empty fallback on a db
        // error would wipe scratch dirs of sessions that still exist.
        if let Ok(list) = sessions::list_sessions(&st.db) {
            let live: std::collections::HashSet<String> =
                list.into_iter().map(|s| s.id).collect();
            scratch::sweep(&data_dir, &live);
            review::sweep(&data_dir, &live);
        }
    }
    rpc::serve(state).await
}
