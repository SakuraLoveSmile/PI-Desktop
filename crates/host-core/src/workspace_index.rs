//! On-demand, host-owned code search and rebuildable SQLite content cache.
//!
//! The separate index.db, trigram FTS storage, resource limits, and ignore-rule
//! reuse follow upstream PR #697 (vastsa/PI-Desktop). Search reconciliation and
//! live verification are deliberately independent of the existing Grep tool.

use anyhow::{bail, Context, Result};
use regex::RegexBuilder;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

mod scanner;
mod store;
#[cfg(test)]
mod tests;

const MAX_HITS: usize = 50;
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const MAX_LINE_CHARS: usize = 240;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexMetadata {
    pub file_count: usize,
    pub indexed_bytes: u64,
    pub skipped_files: usize,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSearchResult {
    pub hits: Vec<CodeSearchHit>,
    pub truncated: bool,
    pub index: CodeIndexMetadata,
}

#[derive(Debug, Clone, Copy)]
struct Limits {
    files: usize,
    file_bytes: u64,
    total_bytes: u64,
    duration: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            files: 10_000,
            file_bytes: 1024 * 1024,
            total_bytes: 64 * 1024 * 1024,
            duration: Duration::from_secs(5),
        }
    }
}

/// No watchers, background jobs, or application-database migrations. Opening
/// the store is lazy at the RPC boundary; database failures remain observable.
pub struct IndexStore {
    database_path: PathBuf,
}

type RootLocks = Mutex<HashMap<(PathBuf, PathBuf), Weak<Mutex<()>>>>;
static ROOT_LOCKS: OnceLock<RootLocks> = OnceLock::new();

impl IndexStore {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let directory = data_dir.join("index");
        std::fs::create_dir_all(&directory).context("create code index directory")?;
        let database_path = crate::workspace::simple_canonicalize(&directory)?.join("index.db");
        store::open(&database_path)?;
        Ok(Self { database_path })
    }

    /// `root` must already be authorized against the real session by the RPC
    /// caller. A tool-supplied path must never become this authority.
    pub fn search(
        &self,
        root: &Path,
        query: &str,
        limit: Option<usize>,
    ) -> Result<CodeSearchResult> {
        self.search_with_limits(root, query, limit, Limits::default())
    }

    pub fn status(&self, root: &Path) -> Result<CodeIndexMetadata> {
        let root = canonical_root(root)?;
        let lock = self.root_lock(&root)?;
        let _guard = lock
            .lock()
            .map_err(|_| anyhow::anyhow!("code index root lock poisoned"))?;
        store::status(&store::open(&self.database_path)?, &root)
    }

    pub fn clear(&self, root: &Path) -> Result<()> {
        let root = canonical_root(root)?;
        let lock = self.root_lock(&root)?;
        let _guard = lock
            .lock()
            .map_err(|_| anyhow::anyhow!("code index root lock poisoned"))?;
        store::clear(&mut store::open(&self.database_path)?, &root)
    }

    fn root_lock(&self, root: &Path) -> Result<Arc<Mutex<()>>> {
        // Include the database identity: unrelated isolated profiles do not
        // contend, and separately opened stores still coordinate one root.
        let key = (self.database_path.clone(), root.to_path_buf());
        let mut locks = ROOT_LOCKS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| anyhow::anyhow!("code index lock registry poisoned"))?;
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            return Ok(lock);
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(key, Arc::downgrade(&lock));
        Ok(lock)
    }

    fn search_with_limits(
        &self,
        root: &Path,
        query: &str,
        limit: Option<usize>,
        limits: Limits,
    ) -> Result<CodeSearchResult> {
        let count = query.chars().count();
        if !(1..=500).contains(&count) || query.contains('\0') {
            bail!("query must contain 1–500 characters and no NUL bytes");
        }
        let limit = limit.unwrap_or(20);
        if !(1..=MAX_HITS).contains(&limit) {
            bail!("limit must be an integer from 1 to 50");
        }
        let root = canonical_root(root)?;
        let lock = self.root_lock(&root)?;
        let _guard = lock
            .lock()
            .map_err(|_| anyhow::anyhow!("code index root lock poisoned"))?;
        let started = Instant::now();
        let scan = scanner::scan(&root, limits, started)?;
        let mut connection = store::open(&self.database_path)?;
        store::reconcile(&mut connection, &root, &scan)?;
        let candidates = store::candidates(&connection, &root, query)?;
        let matcher = RegexBuilder::new(&regex::escape(query))
            .case_insensitive(true)
            .build()?;
        let mut result = CodeSearchResult {
            hits: Vec::new(),
            truncated: scan.partial,
            index: scan.metadata(),
        };
        let mut output_capped = false;
        for candidate in candidates {
            if started.elapsed() >= limits.duration {
                result.truncated = true;
                result.index.status = "partial".into();
                break;
            }
            let body = match scanner::read_text(&root, &candidate.path, limits.file_bytes) {
                Ok(Some(body)) => body,
                Ok(None) | Err(_) => {
                    result.truncated = true;
                    result.index.status = "partial".into();
                    result.index.skipped_files += 1;
                    continue;
                }
            };
            if scanner::content_hash(&body) != candidate.hash {
                // Concurrent edits are searchable, but a non-atomic filesystem
                // walk must never be represented as a consistent snapshot.
                result.truncated = true;
                result.index.status = "partial".into();
            }
            for (line, text) in body.lines().enumerate() {
                let Some(found) = matcher.find(text) else {
                    continue;
                };
                if result.hits.len() >= limit {
                    result.truncated = true;
                    output_capped = true;
                    break;
                }
                result.hits.push(CodeSearchHit {
                    path: candidate.path.clone(),
                    line: line + 1,
                    text: excerpt(text, found.start()),
                });
                if serde_json::to_vec(&result)?.len() > MAX_OUTPUT_BYTES {
                    result.hits.pop();
                    result.truncated = true;
                    output_capped = true;
                    break;
                }
            }
            if output_capped {
                // The limit is an output bound, not a declaration that the
                // repository contains exactly this number of matching lines.
                result.truncated = true;
                break;
            }
        }
        if scan.changed() {
            result.truncated = true;
            result.index.status = "partial".into();
        }
        if result.index.status == "partial" {
            store::set_partial(&connection, &root, result.index.skipped_files)?;
        }
        Ok(result)
    }
}

fn canonical_root(root: &Path) -> Result<PathBuf> {
    let root = crate::workspace::simple_canonicalize(root).context("resolve code search root")?;
    if !root.is_dir() {
        bail!("code search root is not a directory");
    }
    Ok(root)
}

fn excerpt(text: &str, match_start: usize) -> String {
    let prefix = text[..match_start].chars().count();
    let start = prefix.saturating_sub(60);
    text.chars().skip(start).take(MAX_LINE_CHARS).collect()
}
