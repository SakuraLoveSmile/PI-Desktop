//! Plus schema track (ADR `plus-schema-version-track`).
//!
//! `PRAGMA user_version` belongs to the migration chain shared with upstream
//! PI-Desktop, so the fork must not claim version numbers on it. Everything
//! the Plus fork adds to the database runs on a second, independent track:
//!
//! - `plus_schema_meta` records the Plus version applied to the file and the
//!   `user_version` the last Plus-aware open left behind;
//! - every step is additive and idempotent, so a pass may replay all of them
//!   on an up-to-date database;
//! - two hooks in `Database::open` drive the track. [`reconcile_before_upstream_chain`]
//!   runs before the upstream dispatch and fixes the version numbers a
//!   legacy fork build left on the shared chain. [`apply_pending`] runs after
//!   the upstream chain and applies or re-verifies the Plus steps.

use super::*;
use std::ops::RangeInclusive;

/// Plus track version produced by this build. Add the step to [`STEPS`]
/// together with every bump.
pub(crate) const PLUS_SCHEMA_VERSION: i64 = 4;

/// `user_version` a legacy fork database is reset to: the last number the
/// fork shared with upstream before it used v20..=v23 for Plus-only changes.
const FORK_SHARED_BASELINE: i64 = 19;

/// `user_version` values released fork builds used for Plus-only changes.
const LEGACY_FORK_VERSIONS: RangeInclusive<i64> = 20..=23;

/// Tables only the Plus track creates. Their presence proves a Plus build
/// touched the file; keep in sync with [`STEPS`] (a test enforces it).
pub(super) const PLUS_TABLES: [&str; 5] = [
    "goal_reports",
    "plan_execution_schedules",
    "team_members",
    "team_tasks",
    "teams",
];

/// Columns only the Plus track adds, as `(table, column)`. Same contract as
/// [`PLUS_TABLES`].
pub(super) const PLUS_COLUMNS: [(&str, &str); 9] = [
    ("plan_approvals", "artifact_workspace_kind"),
    ("plan_approvals", "execution_kind"),
    ("plan_approvals", "execution_model_id"),
    ("plan_approvals", "execution_provider_id"),
    ("plan_approvals", "revision_error_code"),
    ("plan_approvals", "revision_intent_json"),
    ("plan_approvals", "revision_state"),
    ("plan_approvals", "revision_turn_id"),
    ("sessions", "execution_profile"),
];

const META_SCHEMA: &str = "CREATE TABLE IF NOT EXISTS plus_schema_meta (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  plus_version     INTEGER NOT NULL,
  upstream_version INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);";

type Step = fn(&Connection) -> Result<()>;

/// `STEPS[n]` takes the Plus track from version `n` to `n + 1`. P1..P4 are
/// the Plus-only changes that earlier fork builds shipped as v20..=v23 of the
/// shared chain. Every step must stay idempotent: [`apply_pending`] replays
/// all of them to re-verify a database an upstream step may have rebuilt.
const STEPS: [Step; PLUS_SCHEMA_VERSION as usize] = [step_p1, step_p2, step_p3, step_p4];

/// Meta row of a database a Plus-aware build has opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PlusMeta {
    pub plus_version: i64,
    /// `user_version` observed when the last Plus-aware open finished.
    pub upstream_version: i64,
}

pub(super) fn plus_backup_path(path: &Path, label: &str) -> PathBuf {
    path.with_extension(format!("sqlite.{label}.bak"))
}

/// P1: scratch-origin contract checkpoints and Goal completion reports.
fn step_p1(conn: &Connection) -> Result<()> {
    add_column_if_missing(
        conn,
        "plan_approvals",
        "artifact_workspace_kind",
        "TEXT NOT NULL DEFAULT 'project' CHECK (artifact_workspace_kind IN ('project', 'scratch'))",
    )?;
    conn.execute_batch(crate::goal_reports::SCHEMA)?;
    Ok(())
}

/// P2: session execution profiles and the Expert Team tables.
fn step_p2(conn: &Connection) -> Result<()> {
    add_column_if_missing(
        conn,
        "sessions",
        "execution_profile",
        "TEXT NOT NULL DEFAULT 'standard' CHECK (execution_profile IN ('standard', 'team'))",
    )?;
    conn.execute_batch(crate::team::SCHEMA)?;
    Ok(())
}

/// P3: approved execution model binding, Plan revisions, and one-time
/// execution schedules.
fn step_p3(conn: &Connection) -> Result<()> {
    for (column, definition) in [
        ("execution_provider_id", "TEXT"),
        ("execution_model_id", "TEXT"),
        ("revision_intent_json", "TEXT"),
        (
            "revision_state",
            "TEXT CHECK (revision_state IN ('ready', 'started', 'failed', 'submitted'))",
        ),
        ("revision_turn_id", "TEXT"),
        ("revision_error_code", "TEXT"),
    ] {
        add_column_if_missing(conn, "plan_approvals", column, definition)?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plan_execution_schedules (
           proposal_id TEXT PRIMARY KEY REFERENCES plan_approvals(request_id) ON DELETE CASCADE,
           scheduled_for INTEGER NOT NULL,
           timezone TEXT NOT NULL,
           state TEXT NOT NULL CHECK (state IN ('scheduled', 'missed', 'claimed', 'cancelled')),
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_plan_execution_schedules_due
           ON plan_execution_schedules(state, scheduled_for);",
    )?;
    Ok(())
}

/// P4: effective execution kind (`plan` | `goal`) of approved proposals.
fn step_p4(conn: &Connection) -> Result<()> {
    let added = add_column_if_missing(
        conn,
        "plan_approvals",
        "execution_kind",
        "TEXT CHECK (execution_kind IN ('plan', 'goal'))",
    )?;
    if added {
        conn.execute_batch(
            "UPDATE plan_approvals SET execution_kind = kind
             WHERE (execution_id IS NOT NULL OR status = 'approved')
               AND execution_kind IS NULL;",
        )?;
    }
    Ok(())
}

pub(super) fn run_steps(conn: &Connection) -> Result<()> {
    for (index, step) in STEPS.iter().enumerate() {
        step(conn).with_context(|| format!("apply Plus schema step P{}", index + 1))?;
    }
    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![table],
        |row| row.get(0),
    )?)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        params![table, column],
        |row| row.get(0),
    )?)
}

/// Returns whether the column had to be added.
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<bool> {
    if column_exists(conn, table, column)? {
        return Ok(false);
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition};"
    ))
    .with_context(|| format!("add column {table}.{column}"))?;
    Ok(true)
}

/// Whether any Plus-only table or column exists.
fn has_plus_structures(conn: &Connection) -> Result<bool> {
    for table in PLUS_TABLES {
        if table_exists(conn, table)? {
            return Ok(true);
        }
    }
    for (table, column) in PLUS_COLUMNS {
        if column_exists(conn, table, column)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn read_meta(conn: &Connection) -> Result<Option<PlusMeta>> {
    if !table_exists(conn, "plus_schema_meta")? {
        return Ok(None);
    }
    conn.query_row(
        "SELECT plus_version, upstream_version FROM plus_schema_meta WHERE id = 1",
        [],
        |row| {
            Ok(PlusMeta {
                plus_version: row.get(0)?,
                upstream_version: row.get(1)?,
            })
        },
    )
    .optional()
    .context("read plus_schema_meta")
}

fn write_meta(conn: &Connection, plus_version: i64, upstream_version: i64) -> Result<()> {
    conn.execute_batch(META_SCHEMA)?;
    conn.execute(
        "INSERT INTO plus_schema_meta (id, plus_version, upstream_version, updated_at)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
           plus_version = excluded.plus_version,
           upstream_version = excluded.upstream_version,
           updated_at = excluded.updated_at",
        params![plus_version, upstream_version, now_ms()],
    )?;
    Ok(())
}

fn reject_newer_plus_version(plus_version: i64) -> Result<()> {
    if plus_version > PLUS_SCHEMA_VERSION {
        return Err(anyhow!(
            "Plus schema version {plus_version} is newer than supported {PLUS_SCHEMA_VERSION}"
        ));
    }
    Ok(())
}

/// Hook 1, before the upstream `user_version` dispatch. Returns the version
/// the dispatch must use.
///
/// - A database that is newer on the Plus track than this build is refused.
/// - A legacy fork database (Plus structures, no meta, `user_version` in the
///   fork's former v20..=v23 range) is backed up, completed through every
///   Plus step, stamped on the Plus track, and reset to the shared baseline.
/// - A reconciled database an older fork build bumped back into that range
///   (meta present, `user_version` above this build's chain) is backed up and
///   restored to the `user_version` the meta recorded.
///
/// Every other number is returned unchanged; the caller refuses what it does
/// not support.
pub(super) fn reconcile_before_upstream_chain(
    conn: &Connection,
    path: &Path,
    version: i64,
) -> Result<i64> {
    let meta = read_meta(conn)?;
    if let Some(meta) = meta {
        reject_newer_plus_version(meta.plus_version)?;
    }
    if !LEGACY_FORK_VERSIONS.contains(&version) {
        return Ok(version);
    }
    match meta {
        None if has_plus_structures(conn)? => reconcile_legacy_fork_database(conn, path, version),
        Some(meta)
            if version > SCHEMA_VERSION
                && (FORK_SHARED_BASELINE..=SCHEMA_VERSION).contains(&meta.upstream_version) =>
        {
            restore_recorded_upstream_version(conn, path, version, meta)
        }
        _ => Ok(version),
    }
}

fn reconcile_legacy_fork_database(conn: &Connection, path: &Path, version: i64) -> Result<i64> {
    let backup = create_migration_backup_at(
        conn,
        path,
        plus_backup_path(path, &format!("legacy-v{version}")),
        version,
    )?;
    tracing::warn!(
        version,
        backup = %backup.display(),
        "moving a legacy fork database onto the Plus schema track"
    );
    let tx = conn.unchecked_transaction()?;
    run_steps(&tx)?;
    write_meta(&tx, PLUS_SCHEMA_VERSION, FORK_SHARED_BASELINE)?;
    tx.pragma_update(None, "user_version", FORK_SHARED_BASELINE)?;
    tx.commit().with_context(|| {
        format!(
            "commit Plus schema reconciliation; backup {} remains",
            backup.display()
        )
    })?;
    Ok(FORK_SHARED_BASELINE)
}

fn restore_recorded_upstream_version(
    conn: &Connection,
    path: &Path,
    version: i64,
    meta: PlusMeta,
) -> Result<i64> {
    let backup = create_migration_backup_at(
        conn,
        path,
        plus_backup_path(path, &format!("repair-v{version}")),
        version,
    )?;
    tracing::warn!(
        version,
        restored = meta.upstream_version,
        backup = %backup.display(),
        "an older fork build advanced user_version on a Plus-track database; restoring it"
    );
    conn.pragma_update(None, "user_version", meta.upstream_version)
        .with_context(|| {
            format!(
                "restore schema version {}; backup {} remains",
                meta.upstream_version,
                backup.display()
            )
        })?;
    Ok(meta.upstream_version)
}

/// Hook 2, after the upstream chain. `chain_started_at` is the version the
/// chain dispatched on; `fresh` marks a database created by this open.
///
/// Applies pending Plus steps, and replays them as a re-verification when the
/// shared version moved since the meta was written (an upstream step may have
/// rebuilt a table that carries Plus columns). The meta is then re-synced so
/// at rest any difference between it and `user_version` means a foreign build
/// changed the file.
pub(super) fn apply_pending(
    conn: &Connection,
    path: &Path,
    fresh: bool,
    chain_started_at: i64,
) -> Result<()> {
    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let meta = read_meta(conn)?;
    if let Some(meta) = meta {
        reject_newer_plus_version(meta.plus_version)?;
        if meta.plus_version == PLUS_SCHEMA_VERSION
            && meta.upstream_version == user_version
            && chain_started_at == user_version
        {
            return Ok(());
        }
    }
    let from = meta.map_or(0, |meta| meta.plus_version.max(0));
    // Steps are about to change the file only when the track is behind; a
    // pure re-verification replays steps that are already applied.
    let backup = if !fresh && from < PLUS_SCHEMA_VERSION {
        Some(create_migration_backup_at(
            conn,
            path,
            plus_backup_path(path, &format!("plus-v{from}")),
            user_version,
        )?)
    } else {
        None
    };
    let tx = conn.unchecked_transaction()?;
    run_steps(&tx)?;
    write_meta(&tx, PLUS_SCHEMA_VERSION, user_version)?;
    tx.commit().with_context(|| match &backup {
        Some(backup) => format!(
            "commit Plus schema v{from} to v{PLUS_SCHEMA_VERSION}; backup {} remains",
            backup.display()
        ),
        None => "commit Plus schema verification".to_string(),
    })?;
    Ok(())
}
