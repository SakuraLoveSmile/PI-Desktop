//! Dedicated, versioned cache; never touches pi.sqlite or user history.
use super::{scanner::Scan, CodeIndexMetadata};
use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;

const SCHEMA_VERSION: i64 = 1;
const SCHEMA: &str = r#"
    CREATE TABLE IF NOT EXISTS code_index_roots (
        root TEXT PRIMARY KEY, file_count INTEGER NOT NULL,
        indexed_bytes INTEGER NOT NULL, skipped_files INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('fresh','partial'))
    );
    CREATE TABLE IF NOT EXISTS code_index_files (
        root TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL,
        ascii_body INTEGER NOT NULL, PRIMARY KEY(root,path)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS code_index_fts USING fts5(
        root UNINDEXED, path UNINDEXED, body, tokenize='trigram'
    );
    PRAGMA user_version=1;
"#;

pub(super) fn open(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path).context("open code index cache")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA journal_mode=WAL;")?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version != 0 && version != SCHEMA_VERSION {
        bail!("unsupported code index cache version {version}; clear the rebuildable index cache");
    }
    connection
        .execute_batch(SCHEMA)
        .context("initialize code index cache")?;
    Ok(connection)
}

pub(super) fn reconcile(connection: &mut Connection, root: &Path, scan: &Scan) -> Result<()> {
    let root = root.to_string_lossy();
    let transaction = connection.transaction()?;
    let mut existing: HashMap<String, String> = {
        let mut statement =
            transaction.prepare("SELECT path,hash FROM code_index_files WHERE root=?1")?;
        let rows = statement.query_map([root.as_ref()], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for file in &scan.files {
        if existing.remove(&file.path).as_deref() == Some(&file.hash) {
            continue;
        }
        transaction.execute(
            "DELETE FROM code_index_fts WHERE root=?1 AND path=?2",
            params![root.as_ref(), file.path],
        )?;
        transaction.execute("INSERT OR REPLACE INTO code_index_files(root,path,hash,ascii_body) VALUES(?1,?2,?3,?4)", params![root.as_ref(), file.path, file.hash, file.body.is_ascii()])?;
        transaction.execute(
            "INSERT INTO code_index_fts(root,path,body) VALUES(?1,?2,?3)",
            params![root.as_ref(), file.path, file.body.to_ascii_lowercase()],
        )?;
    }
    // Remove deleted, ignored, renamed, over-budget, and no-longer-readable
    // entries. Partial scans never leave old content searchable as fresh.
    for path in existing.keys() {
        transaction.execute(
            "DELETE FROM code_index_fts WHERE root=?1 AND path=?2",
            params![root.as_ref(), path],
        )?;
        transaction.execute(
            "DELETE FROM code_index_files WHERE root=?1 AND path=?2",
            params![root.as_ref(), path],
        )?;
    }
    let metadata = scan.metadata();
    transaction.execute("INSERT OR REPLACE INTO code_index_roots(root,file_count,indexed_bytes,skipped_files,status) VALUES(?1,?2,?3,?4,?5)", params![root.as_ref(), i64::try_from(metadata.file_count)?, i64::try_from(metadata.indexed_bytes)?, i64::try_from(metadata.skipped_files)?, metadata.status])?;
    transaction
        .commit()
        .context("persist reconciled code index")
}

pub(super) struct Candidate {
    pub path: String,
    pub hash: String,
}

pub(super) fn candidates(
    connection: &Connection,
    root: &Path,
    query: &str,
) -> Result<Vec<Candidate>> {
    let root = root.to_string_lossy();
    let from_row = |row: &rusqlite::Row<'_>| {
        Ok(Candidate {
            path: row.get(0)?,
            hash: row.get(1)?,
        })
    };
    // Trigram FTS cannot prove Unicode case equivalence or match short words.
    // Non-ASCII files always join the candidate set, even for ASCII queries
    // (e.g. Unicode long s matches S). Live matching is the authority.
    if query.is_ascii() && query.len() >= 3 {
        let literal = format!("\"{}\"", query.to_ascii_lowercase().replace('"', "\"\""));
        let mut statement = connection.prepare("SELECT f.path,f.hash FROM code_index_files f WHERE f.root=?1 AND (f.ascii_body=0 OR f.path IN (SELECT path FROM code_index_fts WHERE root=?1 AND code_index_fts MATCH ?2)) ORDER BY f.path")?;
        let result = statement
            .query_map(params![root.as_ref(), literal], from_row)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(result)
    } else {
        let mut statement = connection
            .prepare("SELECT path,hash FROM code_index_files WHERE root=?1 ORDER BY path")?;
        let result = statement
            .query_map([root.as_ref()], from_row)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(result)
    }
}

pub(super) fn status(connection: &Connection, root: &Path) -> Result<CodeIndexMetadata> {
    let values = connection.query_row("SELECT file_count,indexed_bytes,skipped_files,status FROM code_index_roots WHERE root=?1", [root.to_string_lossy().as_ref()], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, String>(3)?))).optional()?;
    match values {
        Some((files, bytes, skipped, status)) => Ok(CodeIndexMetadata {
            file_count: usize::try_from(files)?,
            indexed_bytes: u64::try_from(bytes)?,
            skipped_files: usize::try_from(skipped)?,
            status,
        }),
        None => Ok(CodeIndexMetadata {
            file_count: 0,
            indexed_bytes: 0,
            skipped_files: 0,
            status: "missing".into(),
        }),
    }
}

pub(super) fn set_partial(connection: &Connection, root: &Path, skipped: usize) -> Result<()> {
    connection.execute(
        "UPDATE code_index_roots SET status='partial',skipped_files=?2 WHERE root=?1",
        params![root.to_string_lossy().as_ref(), i64::try_from(skipped)?],
    )?;
    Ok(())
}

pub(super) fn clear(connection: &mut Connection, root: &Path) -> Result<()> {
    let transaction = connection.transaction()?;
    for table in ["code_index_fts", "code_index_files", "code_index_roots"] {
        transaction.execute(
            &format!("DELETE FROM {table} WHERE root=?1"),
            [root.to_string_lossy().as_ref()],
        )?;
    }
    transaction.commit().context("clear code index cache")
}
