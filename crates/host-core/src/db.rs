use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

/// Storage schema v7 (docs/spec/03-runtime/04-data-storage.md): SQLite holds
/// index data only; transcript content lives in per-session JSONL files
/// (D119, `transcripts.rs`).
pub const SCHEMA_VERSION: i64 = 7;

/// Audit rows older than this are pruned at boot.
const AUDIT_RETENTION_MS: i64 = 90 * 24 * 3600 * 1000;
/// task_runs kept per task after the boot prune.
const TASK_RUNS_KEEP: i64 = 100;
/// Durable notification rows kept globally.
pub const NOTIFICATION_KEEP: i64 = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub pinned: bool,
    pub created_at: i64,
    pub last_opened_at: i64,
}

fn normalize_project_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut normalized = trimmed.replace('\\', "/");
    while normalized.len() > 1
        && normalized.ends_with('/')
        && !normalized
            .strip_suffix('/')
            .is_some_and(|prefix| prefix.ends_with(':'))
    {
        normalized.pop();
    }
    Some(normalized)
}

/// Canonical storage spelling of a project path: resolve symlinks when the
/// directory exists (matching `WorkspaceState::set`), then normalize
/// separators/trailing slashes.
fn canonical_project_path(path: &str) -> Option<String> {
    let canonical = std::path::Path::new(path)
        .canonicalize()
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    normalize_project_path(canonical.as_deref().unwrap_or(path))
}

fn project_display_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("workspace")
        .to_string()
}

/// Upsert a projects row by raw path on any connection (used by live code and
/// the v1 migration alike). Returns None for blank paths.
fn upsert_project_row(conn: &Connection, raw: &str, touch: bool) -> Result<Option<i64>> {
    let Some(path) = canonical_project_path(raw) else {
        return Ok(None);
    };
    let name = project_display_name(&path);
    let now = now_ms();
    let mut stmt = conn.prepare_cached(
        "INSERT INTO projects (path, name, created_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(path) DO UPDATE SET
           last_opened_at = CASE WHEN ?4 THEN excluded.last_opened_at
                                 ELSE projects.last_opened_at END
         RETURNING id",
    )?;
    let id: i64 = stmt.query_row(params![path, name, now, touch], |r| r.get(0))?;
    Ok(Some(id))
}

const SCHEMA_LATEST: &str = r#"
CREATE TABLE kv (
  ns         TEXT NOT NULL,
  key        TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ns, key)
) WITHOUT ROWID;

CREATE TABLE projects (
  id             INTEGER PRIMARY KEY,
  path           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  pinned         INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL
);

CREATE TABLE providers (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  vendor_key       TEXT NOT NULL DEFAULT 'custom',
  type             TEXT NOT NULL DEFAULT 'openai_compatible',
  protocol         TEXT NOT NULL DEFAULT 'openai_compatible',
  api_style        TEXT,
  auth_kind        TEXT NOT NULL DEFAULT 'api_key_and_base_url',
  base_url         TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  secret_ref       TEXT,
  default_model_id TEXT,
  config_json      TEXT NOT NULL DEFAULT '{}',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE models (
  provider_id       TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'user',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  context_window    INTEGER,
  max_output_tokens INTEGER,
  deprecated        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_id)
) WITHOUT ROWID;

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  provider_id TEXT,
  model_id    TEXT,
  mode        TEXT NOT NULL DEFAULT 'agent',
  thinking_level TEXT NOT NULL DEFAULT 'off'
                CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium',
                                          'high', 'xhigh', 'max')),
  permission_mode TEXT NOT NULL DEFAULT 'inherit'
                CHECK (permission_mode IN ('inherit', 'ask', 'accept-edits', 'auto')),
  source      TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_project ON sessions(project_id) WHERE project_id IS NOT NULL;

CREATE TABLE turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'running',
  provider_id   TEXT,
  model_id      TEXT,
  error_code    TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_json    TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX idx_turns_session ON turns(session_id, started_at DESC);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('task.completed', 'task.failed')),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_title TEXT NOT NULL,
  turn_id    TEXT NOT NULL UNIQUE,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread
  ON notifications(created_at DESC) WHERE read_at IS NULL;

CREATE TABLE messages (
  mid          INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id      TEXT REFERENCES turns(id) ON DELETE SET NULL,
  seq          INTEGER NOT NULL,
  role         TEXT NOT NULL,
  tool_name    TEXT,
  is_error     INTEGER NOT NULL DEFAULT 0,
  text         TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages', content_rowid='mid',
  tokenize='trigram'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages WHEN new.text IS NOT NULL
  BEGIN INSERT INTO messages_fts(rowid, text) VALUES (new.mid, new.text); END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages WHEN old.text IS NOT NULL
  BEGIN INSERT INTO messages_fts(messages_fts, rowid, text)
        VALUES ('delete', old.mid, old.text); END;
CREATE TRIGGER messages_au AFTER UPDATE OF text ON messages
  BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text)
      SELECT 'delete', old.mid, old.text WHERE old.text IS NOT NULL;
    INSERT INTO messages_fts(rowid, text)
      SELECT new.mid, new.text WHERE new.text IS NOT NULL;
  END;

CREATE TABLE artifacts (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  op         TEXT NOT NULL,
  turn_id    TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, path)
) WITHOUT ROWID;
CREATE INDEX idx_artifacts_time ON artifacts(updated_at DESC);

CREATE TABLE message_revisions (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  root_user_id    TEXT NOT NULL,
  revision_index  INTEGER NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 0,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE (session_id, root_user_id, revision_index)
);
CREATE INDEX idx_message_revisions_root
  ON message_revisions(session_id, root_user_id, revision_index);

CREATE TABLE scheduled_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  cadence     TEXT NOT NULL DEFAULT 'manual',
  enabled     INTEGER NOT NULL DEFAULT 1,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_run_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE task_runs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status     TEXT NOT NULL DEFAULT 'running',
  error_code TEXT,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX idx_task_runs ON task_runs(task_id, started_at DESC);

CREATE TABLE secrets_meta (
  secret_ref TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL DEFAULT 'provider',
  owner_id   TEXT,
  kind       TEXT NOT NULL DEFAULT 'api_key',
  backend    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  ts           INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  session_id   TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_session ON audit_log(session_id, ts) WHERE session_id IS NOT NULL;
"#;

pub struct Database {
    conn: Connection,
    /// App data directory (the sqlite file's parent); transcript files live
    /// under `<data_dir>/sessions/` (D119).
    data_dir: std::path::PathBuf,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Parse an RFC3339 timestamp into epoch ms, falling back to `now`.
pub fn ts_to_ms(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|_| now_ms())
}

/// Epoch ms → RFC3339 (UTC, `Z` suffix) for the wire format.
pub fn ms_to_ts(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Database {
    /// Open (creating as needed) the app database inside `data_dir`.
    pub fn open_in_dir(data_dir: &Path) -> Result<Self> {
        Self::open(&data_dir.join("pi.sqlite"))
    }

    /// Open a specific database file, bootstrapping the latest schema on a
    /// fresh file. A pre-v7 file is archived and replaced by a fresh one
    /// (D119 breaking reset — content moved to transcript files, no data
    /// migration); files with an unknown newer schema fail.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let data_dir = match path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
            _ => std::path::PathBuf::from("."),
        };
        let conn = Connection::open(path).context("open sqlite")?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -16000;
            PRAGMA trusted_schema = ON;
            "#,
        )?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        match version {
            0 => {
                let has_tables: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
                    [],
                    |r| r.get(0),
                )?;
                if has_tables > 0 {
                    return Err(anyhow!(
                        "database {} has tables but no schema version; refusing to touch it",
                        path.display()
                    ));
                }
                // auto_vacuum must be set before the first table exists.
                conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL;")?;
                let tx = conn.unchecked_transaction()?;
                tx.execute_batch(SCHEMA_LATEST)?;
                tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
                tx.commit()?;
            }
            legacy @ 1..=6 => {
                let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                drop(conn);
                archive_legacy_db(path, legacy)?;
                return Self::open(path);
            }
            SCHEMA_VERSION => {}
            other => {
                return Err(anyhow!(
                    "database schema version {other} is newer than supported {SCHEMA_VERSION}"
                ));
            }
        }
        let db = Self { conn, data_dir };
        db.boot_maintenance()?;
        Ok(db)
    }

    /// App data directory hosting the DB and the transcript file store.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Crash recovery + retention, run once per process at open.
    fn boot_maintenance(&self) -> Result<()> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE turns SET status = 'aborted', ended_at = ?1 WHERE status = 'running'",
            params![now],
        )?;
        self.conn.execute(
            "UPDATE task_runs SET status = 'aborted', ended_at = ?1 WHERE status = 'running'",
            params![now],
        )?;
        self.conn.execute(
            "DELETE FROM audit_log WHERE ts < ?1",
            params![now - AUDIT_RETENTION_MS],
        )?;
        self.conn.execute(
            "DELETE FROM task_runs WHERE id IN (
               SELECT id FROM (
                 SELECT id, ROW_NUMBER() OVER (
                   PARTITION BY task_id ORDER BY started_at DESC
                 ) AS rn FROM task_runs
               ) WHERE rn > ?1
             )",
            params![TASK_RUNS_KEEP],
        )?;
        self.conn.execute(
            "DELETE FROM notifications
             WHERE id IN (
               SELECT id FROM notifications
               ORDER BY created_at DESC, id DESC
               LIMIT -1 OFFSET ?1
             )",
            params![NOTIFICATION_KEEP],
        )?;
        let _ = self.conn.execute_batch("PRAGMA incremental_vacuum;");
        self.migrate_chat_sessions_to_agent()?;
        Ok(())
    }

    /// D188 fix-up: the desktop UI no longer offers a mode switch, so a
    /// session left on the old `chat` profile could never be switched back to
    /// `agent`. Move those rows (and the stored `defaultMode`) to `agent`
    /// once, at open. Idempotent: after the first run nothing matches.
    fn migrate_chat_sessions_to_agent(&self) -> Result<()> {
        self.conn
            .execute("UPDATE sessions SET mode = 'agent' WHERE mode = 'chat'", [])?;
        self.conn.execute(
            "UPDATE kv SET value_json = json_set(value_json, '$.defaultMode', 'agent')
             WHERE ns = 'app' AND key = 'app'
               AND json_valid(value_json)
               AND json_extract(value_json, '$.defaultMode') = 'chat'",
            [],
        )?;
        Ok(())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    // ---- kv --------------------------------------------------------------

    pub fn kv_get(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2")?;
        let mut rows = stmt.query(params![ns, key])?;
        if let Some(row) = rows.next()? {
            let raw: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&raw)?))
        } else {
            Ok(None)
        }
    }

    pub fn kv_set(&self, ns: &str, key: &str, value: &Value) -> Result<()> {
        let mut stmt = self.conn.prepare_cached(
            "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(ns, key) DO UPDATE SET
               value_json = excluded.value_json, updated_at = excluded.updated_at",
        )?;
        stmt.execute(params![ns, key, value.to_string(), now_ms()])?;
        Ok(())
    }

    pub fn kv_delete(&self, ns: &str, key: &str) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare_cached("DELETE FROM kv WHERE ns = ?1 AND key = ?2")?;
        stmt.execute(params![ns, key])?;
        Ok(())
    }

    // ---- settings compatibility shims (kv ns='app') -----------------------

    pub fn get_setting(&self, key: &str) -> Result<Option<Value>> {
        self.kv_get("app", key)
    }

    pub fn set_setting(&self, key: &str, value: &Value) -> Result<()> {
        self.kv_set("app", key, value)
    }

    // ---- projects ----------------------------------------------------------

    /// Upsert a project row by path, returning its id. Also bumps
    /// last_opened_at when `touch` is set. The path is canonicalized when it
    /// exists on disk (matching `WorkspaceState::set`) so symlinked spellings
    /// of the same directory share one row.
    pub fn ensure_project(&self, path: &str, touch: bool) -> Result<i64> {
        upsert_project_row(&self.conn, path, touch)?
            .ok_or_else(|| anyhow!("project path must not be blank"))
    }

    pub fn project_path(&self, id: i64) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT path FROM projects WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;
        Ok(rows.next()?.map(|r| r.get(0)).transpose()?)
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectRecord>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT id, path, name, pinned, created_at, last_opened_at
             FROM projects
             ORDER BY pinned DESC, last_opened_at DESC, name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                pinned: row.get(3)?,
                created_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

// ---- legacy database reset ----------------------------------------------

/// Breaking reset for pre-v7 files (D119): transcript content moved out of
/// SQLite and old schemas get no data migration. The file (WAL folded back in
/// by the caller) is archived next to itself for manual recovery; `-wal` /
/// `-shm` leftovers are removed so the fresh database starts clean.
fn archive_legacy_db(path: &Path, version: i64) -> Result<()> {
    let bak = path.with_extension("sqlite.v6.bak");
    // Keep the newest archive if several legacy files are opened in sequence.
    let _ = std::fs::remove_file(&bak);
    std::fs::rename(path, &bak)
        .with_context(|| format!("archive {} -> {}", path.display(), bak.display()))?;
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
    tracing::warn!(
        from_version = version,
        archived = %bak.display(),
        "pre-v7 database archived; starting fresh (D119 transcript-file reset)"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    #[test]
    fn fresh_open_creates_latest_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let version: i64 = db
            .conn()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        for table in [
            "kv",
            "projects",
            "providers",
            "models",
            "sessions",
            "turns",
            "notifications",
            "messages",
            "message_revisions",
            "artifacts",
            "scheduled_tasks",
            "task_runs",
            "secrets_meta",
            "audit_log",
        ] {
            assert!(table_exists(db.conn(), table), "missing {table}");
        }
        let thinking_column: (String, String) = db
            .conn()
            .query_row(
                "SELECT name, dflt_value
                 FROM pragma_table_info('sessions')
                 WHERE name = 'thinking_level'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(thinking_column, ("thinking_level".into(), "'off'".into()));

        // v7: transcript payloads live in per-session files, not columns.
        for (table, column) in [
            ("messages", "content_json"),
            ("messages", "meta_json"),
            ("message_revisions", "messages_json"),
        ] {
            let n: i64 = db
                .conn()
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"
                    ),
                    params![column],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "{table}.{column} must not exist in v7");
        }
    }

    #[test]
    fn archives_pre_v7_database_and_starts_fresh() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (id TEXT PRIMARY KEY);
                 INSERT INTO sessions (id) VALUES ('legacy');",
            )
            .unwrap();
            conn.pragma_update(None, "user_version", 6).unwrap();
        }

        let db = Database::open(&path).unwrap();
        let version: i64 = db
            .conn()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let sessions: i64 = db
            .conn()
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sessions, 0, "fresh database starts empty");

        let bak = dir.path().join("pi.sqlite.v6.bak");
        assert!(bak.exists(), "legacy file is archived for manual recovery");
        let old = Connection::open(&bak).unwrap();
        let preserved: i64 = old
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(preserved, 1, "archive keeps the legacy data");

        // Reopening the fresh v7 file is a plain open, not another reset.
        drop(db);
        let db = Database::open(&path).unwrap();
        let version: i64 = db
            .conn()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(table_exists(db.conn(), "messages"));
    }

    #[test]
    fn boot_moves_legacy_chat_sessions_and_default_to_agent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        {
            let db = Database::open(&path).unwrap();
            db.conn()
                .execute(
                    "INSERT INTO sessions (id, title, mode, created_at, updated_at)
                     VALUES ('s-chat', 'Legacy', 'chat', 1, 1),
                            ('s-agent', 'Agent', 'agent', 1, 1)",
                    [],
                )
                .unwrap();
            db.set_setting(
                "app",
                &serde_json::json!({ "defaultMode": "chat", "theme": "dark" }),
            )
            .unwrap();
        }

        let db = Database::open(&path).unwrap();
        let modes: Vec<String> = db
            .conn()
            .prepare("SELECT mode FROM sessions ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(modes, vec!["agent".to_string(), "agent".to_string()]);
        let settings = db.get_setting("app").unwrap().unwrap();
        assert_eq!(settings["defaultMode"], "agent");
        assert_eq!(settings["theme"], "dark", "unrelated keys survive");
    }

    #[test]
    fn kv_roundtrip_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        db.kv_set("plugin:demo", "cfg", &serde_json::json!({ "on": true }))
            .unwrap();
        assert_eq!(
            db.kv_get("plugin:demo", "cfg").unwrap().unwrap(),
            serde_json::json!({ "on": true })
        );
        db.kv_delete("plugin:demo", "cfg").unwrap();
        assert!(db.kv_get("plugin:demo", "cfg").unwrap().is_none());
    }

    #[test]
    fn ensure_project_upserts_by_path() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let a = db.ensure_project("/tmp/demo", true).unwrap();
        let b = db.ensure_project("/tmp/demo/", false).unwrap();
        assert_eq!(a, b);
        assert_eq!(db.project_path(a).unwrap().as_deref(), Some("/tmp/demo"));
        let projects = db.list_projects().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].path, "/tmp/demo");
        assert_eq!(projects[0].name, "demo");

        let windows = db.ensure_project("C:\\work\\project\\", false).unwrap();
        assert_eq!(
            db.project_path(windows).unwrap().as_deref(),
            Some("C:/work/project")
        );
    }

    #[test]
    fn list_projects_propagates_row_decode_errors() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        db.conn()
            .execute(
                "INSERT INTO projects
                    (path, name, pinned, created_at, last_opened_at)
                 VALUES ('/tmp/broken', 'broken', 'not-a-number', 1, 1)",
                [],
            )
            .unwrap();

        assert!(db.list_projects().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ensure_project_dedupes_symlinked_spellings() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real-project");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.path().join("link-project");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let a = db.ensure_project(&real.to_string_lossy(), true).unwrap();
        let b = db.ensure_project(&link.to_string_lossy(), true).unwrap();
        assert_eq!(a, b, "symlinked path spellings must share one project row");
        assert_eq!(db.list_projects().unwrap().len(), 1);
    }

}
