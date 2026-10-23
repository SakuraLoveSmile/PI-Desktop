//! Verified memory ownership; never a workspace or filesystem-access resolver.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tokio::io::AsyncReadExt;

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_SLOTS: usize = 4096;
const TIMEOUT: Duration = Duration::from_secs(5);

/// Git evidence is prepared outside Host/database locks and consumed only by
/// memory ownership. It must never be used to extend a workspace's tool roots.
#[derive(Debug, Clone)]
pub(crate) struct PreparedMemoryProject {
    pub requested_path: String,
    pub primary_path: String,
    pub git_common_dir: String,
    pub repository_identity: String,
    pub paths: Vec<String>,
}

pub(crate) fn directory_identity(path: &Path, metadata: &std::fs::Metadata) -> Option<String> {
    directory_identity_with_created(path, metadata, metadata.created().ok())
}

fn directory_identity_with_created(
    _path: &Path,
    metadata: &std::fs::Metadata,
    created: Option<std::time::SystemTime>,
) -> Option<String> {
    // dev/ino alone can be reused after deletion. Unsupported birthtime must
    // fail closed instead of disclosing the previous repository's memory.
    let created = created?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(format!(
            "unix:{}:{}:{created}",
            metadata.dev(),
            metadata.ino()
        ))
    }
    #[cfg(not(unix))]
    {
        // Platforms without a portable file id keep the canonical location as
        // part of the evidence. Moving one requires an explicit re-association.
        Some(format!("directory:{}:{created}", _path.to_str()?))
    }
}

async fn registered_repository(path: &str) -> Result<Option<PreparedMemoryProject>, &'static str> {
    let requested = system_path(Path::new(path))?;
    if canonical(&requested).await? != requested
        || git_path(&requested, "--show-toplevel").await? != requested
    {
        return Ok(None);
    }
    let common = git_path(&requested, "--git-common-dir").await?;
    let git_dir = git_path(&requested, "--absolute-git-dir").await?;
    if git_dir != common {
        let back_pointer = tokio::fs::read_to_string(git_dir.join("gitdir"))
            .await
            .map_err(|_| "worktree back-pointer unavailable")?;
        if canonical(Path::new(back_pointer.trim_end_matches(['\r', '\n']))).await?
            != canonical(&requested.join(".git")).await?
        {
            return Err("worktree back-pointer mismatch");
        }
    }
    let metadata = tokio::fs::metadata(&common)
        .await
        .map_err(|_| "Git identity unavailable")?;
    let identity = directory_identity(&common, &metadata).ok_or("Git identity unavailable")?;
    let list = git(&requested, &["worktree", "list", "--porcelain", "-z"]).await?;
    let mut paths = Vec::new();
    for record in list.split("\0\0").filter(|record| !record.is_empty()) {
        let Some(raw) = record
            .split('\0')
            .next()
            .and_then(|field| field.strip_prefix("worktree "))
        else {
            continue;
        };
        let root = system_path(Path::new(raw))?;
        // Prunable/deleted entries are historical evidence only, never fresh
        // authority to read a replacement repository at the same location.
        if !root.is_dir() {
            continue;
        }
        if canonical(&root).await? == root
            && git_path(&root, "--show-toplevel").await? == root
            && git_path(&root, "--git-common-dir").await? == common
        {
            paths.push(root.to_str().ok_or("non UTF-8 checkout")?.to_owned());
        }
    }
    let requested_path = requested.to_str().ok_or("non UTF-8 checkout")?.to_owned();
    if !paths.contains(&requested_path) {
        return Err("checkout not registered");
    }
    let primary_path = paths.first().cloned().ok_or("missing primary checkout")?;
    Ok(Some(PreparedMemoryProject {
        requested_path,
        primary_path,
        git_common_dir: common.to_str().ok_or("non UTF-8 Git directory")?.to_owned(),
        repository_identity: identity,
        paths,
    }))
}

pub(crate) async fn prepare(path: &str) -> Option<PreparedMemoryProject> {
    match tokio::time::timeout(TIMEOUT, registered_repository(path)).await {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(reason)) => {
            tracing::debug!(
                reason,
                "shared project memory unavailable; retaining project scope"
            );
            None
        }
        Err(_) => {
            tracing::warn!("shared project memory validation timed out; retaining project scope");
            None
        }
    }
}

#[derive(Debug)]
pub(crate) struct MemoryOwner {
    pub requested_path: String,
    pub owner_path: String,
    pub is_alias: bool,
}
#[derive(Deserialize)]
struct Projection {
    schema_version: u32,
    updated_at: String,
    worktrees_root: PathBuf,
    slots: Vec<Slot>,
}
#[derive(Deserialize)]
struct Slot {
    slot_id: String,
    path: PathBuf,
    repository: PathBuf,
    git_common_dir: PathBuf,
    repo_key: String,
    state: String,
}

// No environment/RPC override: only tests can inject another projection.
fn projection_path() -> Option<PathBuf> {
    #[cfg(test)]
    if let Ok(path) = TEST_PROJECTION.try_with(Clone::clone) {
        return Some(path);
    }
    Some(dirs::home_dir()?.join("Library/Application Support/KaneoPilot/worktree-slots.json"))
}

fn clean_absolute(path: &Path) -> bool {
    path.is_absolute()
        && !path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        && !path
            .as_os_str()
            .to_string_lossy()
            .split('/')
            .any(|part| part == "." || part == "..")
}

/// Only normalize macOS's system aliases, never arbitrary user-created links.
fn system_path(path: &Path) -> Result<PathBuf, &'static str> {
    if !clean_absolute(path) {
        return Err("invalid absolute path");
    }
    #[cfg(target_os = "macos")]
    for prefix in ["/var", "/tmp", "/etc"] {
        if let Ok(suffix) = path.strip_prefix(prefix) {
            return Ok(Path::new("/private")
                .join(prefix.trim_start_matches('/'))
                .join(suffix));
        }
    }
    Ok(path.to_path_buf())
}
async fn canonical(path: &Path) -> Result<PathBuf, &'static str> {
    tokio::fs::canonicalize(path)
        .await
        .map_err(|_| "path unavailable")
}
async fn git(path: &Path, args: &[&str]) -> Result<String, &'static str> {
    use crate::git_workspaces::command::{command, run};
    run(command(path, &[], args), TIMEOUT)
        .await
        .map_err(|_| "Git metadata unavailable")?
        .checked()
        .map_err(|_| "Git metadata rejected")?
        .text()
        .map_err(|_| "invalid Git metadata")
}
async fn git_path(path: &Path, arg: &str) -> Result<PathBuf, &'static str> {
    let text = git(path, &["rev-parse", "--path-format=absolute", arg]).await?;
    canonical(Path::new(text.trim_end_matches(['\r', '\n']))).await
}

async fn alias(path: &str, projection: &Path) -> Result<Option<String>, &'static str> {
    let metadata = tokio::fs::metadata(projection)
        .await
        .map_err(|_| "projection unavailable")?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("projection size/type rejected");
    }
    let mut bytes = Vec::new();
    tokio::fs::File::open(projection)
        .await
        .map_err(|_| "projection unavailable")?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "projection read failed")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("projection size rejected");
    }
    let data: Projection =
        serde_json::from_slice(&bytes).map_err(|_| "projection format rejected")?;
    if data.schema_version != 1 || data.updated_at.is_empty() || data.slots.len() > MAX_SLOTS {
        return Err("projection version/count rejected");
    }
    let root = system_path(&data.worktrees_root)?;
    let requested = system_path(Path::new(path))?;
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    let mut selected = None;
    for slot in &data.slots {
        let registered = system_path(&slot.path)?;
        system_path(&slot.repository)?;
        system_path(&slot.git_common_dir)?;
        if slot.slot_id.is_empty()
            || slot.state.is_empty()
            || !paths.insert(registered.clone())
            || !ids.insert(&slot.slot_id)
        {
            return Err("duplicate/invalid slot registration");
        }
        if registered == requested {
            selected = Some(slot);
        }
    }
    let Some(slot) = selected else {
        return Ok(None);
    };
    let suffix = requested
        .strip_prefix(root.join("pool"))
        .map_err(|_| "slot outside pool")?;
    let parts: Vec<_> = suffix.components().collect();
    if parts.len() != 2 || parts[0].as_os_str() != slot.repo_key.as_str() {
        return Err("slot shape rejected");
    }
    let number = parts[1]
        .as_os_str()
        .to_str()
        .and_then(|value| value.strip_prefix("slot-"))
        .ok_or("slot shape rejected")?;
    if number.is_empty()
        || number.starts_with('0')
        || !number.bytes().all(|value| value.is_ascii_digit())
    {
        return Err("slot number rejected");
    }
    // Inspect each pool component before canonicalization, so links within the
    // pool cannot pass merely because they resolve into a registered worktree.
    let mut current = root.clone();
    for component in Path::new("pool").join(suffix).components() {
        current.push(component);
        if tokio::fs::symlink_metadata(&current)
            .await
            .map_err(|_| "slot unavailable")?
            .file_type()
            .is_symlink()
        {
            return Err("slot symlink rejected");
        }
    }
    if canonical(&root).await? != root || canonical(&requested).await? != requested {
        return Err("pool path alias rejected");
    }
    let common = canonical(&slot.git_common_dir).await?;
    let key = hex::encode(Sha256::digest(
        common
            .to_str()
            .ok_or("non UTF-8 common directory")?
            .as_bytes(),
    ));
    if slot.repo_key != key[..16] {
        return Err("repository key mismatch");
    }
    #[cfg(test)]
    if let Ok((entered, release)) = TEST_VALIDATION_GATE.try_with(Clone::clone) {
        entered.notify_one();
        release.notified().await;
    }
    if git_path(&requested, "--show-toplevel").await? != requested
        || git_path(&requested, "--git-common-dir").await? != common
    {
        return Err("slot Git identity mismatch");
    }
    if git(&requested, &["rev-parse", "--abbrev-ref", "HEAD"])
        .await?
        .trim()
        != "HEAD"
    {
        return Err("slot HEAD is not detached");
    }
    let owner = canonical(&slot.repository).await?;
    if git_path(&owner, "--show-toplevel").await? != owner
        || git_path(&owner, "--git-common-dir").await? != common
    {
        return Err("owner Git identity mismatch");
    }
    let list = git(&owner, &["worktree", "list", "--porcelain", "-z"]).await?;
    let records: Vec<_> = list
        .split("\0\0")
        .filter(|record| !record.is_empty())
        .collect();
    let first = records
        .first()
        .and_then(|record| record.split('\0').next())
        .and_then(|line| line.strip_prefix("worktree "))
        .ok_or("missing main worktree")?;
    if canonical(Path::new(first)).await? != owner {
        return Err("owner is not main worktree");
    }
    let mut detached = false;
    for record in records {
        let mut fields = record.split('\0');
        let Some(root) = fields
            .next()
            .and_then(|field| field.strip_prefix("worktree "))
        else {
            continue;
        };
        if system_path(Path::new(root))? == requested {
            detached = fields.any(|field| field == "detached");
        }
    }
    if !detached {
        return Err("slot not registered detached worktree");
    }
    Ok(Some(owner.to_str().ok_or("non UTF-8 owner")?.to_owned()))
}

pub(crate) async fn resolve(path: &str) -> MemoryOwner {
    let mut result = MemoryOwner {
        requested_path: path.into(),
        owner_path: path.into(),
        is_alias: false,
    };
    let Some(projection) = projection_path() else {
        return result;
    };
    match tokio::time::timeout(TIMEOUT, alias(path, &projection)).await {
        Ok(Ok(Some(owner))) => {
            result.owner_path = owner;
            result.is_alias = true;
        }
        Ok(Ok(None)) => {}
        // Fixed diagnostic reasons exclude projection bodies, paths and Git stderr.
        Ok(Err(reason)) => tracing::debug!(
            reason,
            "memory alias unavailable; retaining requested project"
        ),
        Err(_) => tracing::warn!("memory alias validation timed out; retaining requested project"),
    }
    result
}

#[cfg(test)]
tokio::task_local! { pub(crate) static TEST_PROJECTION: PathBuf; }
#[cfg(test)]
tokio::task_local! {
    pub(crate) static TEST_VALIDATION_GATE: (std::sync::Arc<tokio::sync::Notify>, std::sync::Arc<tokio::sync::Notify>);
}
#[cfg(test)]
#[path = "project_memory_owner_tests.rs"]
pub(crate) mod tests;
