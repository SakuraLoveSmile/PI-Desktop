use super::plus_schema::{
    plus_backup_path, read_meta, run_steps, PlusMeta, PLUS_COLUMNS, PLUS_SCHEMA_VERSION,
    PLUS_TABLES,
};
use super::*;
use std::collections::BTreeSet;

fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![name],
        |row| row.get(0),
    )
    .unwrap()
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        params![table, column],
        |row| row.get(0),
    )
    .unwrap()
}

fn meta(conn: &Connection) -> Option<PlusMeta> {
    read_meta(conn).unwrap()
}

fn plus_meta(upstream_version: i64) -> PlusMeta {
    PlusMeta {
        plus_version: PLUS_SCHEMA_VERSION,
        upstream_version,
    }
}

/// Names of every backup artifact next to the database, sorted.
fn backup_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".bak"))
        .collect();
    names.sort();
    names
}

/// Opens the Plus backup `label`, checks it is intact and carries `version`,
/// and returns the connection for further inspection.
fn open_plus_backup(path: &Path, label: &str, version: i64) -> Connection {
    let backup_path = plus_backup_path(path, label);
    assert!(
        backup_path.exists(),
        "missing {} backup",
        backup_path.display()
    );
    let backup = Connection::open(&backup_path).unwrap();
    assert_eq!(user_version(&backup), version);
    let integrity: String = backup
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
    backup
}

fn assert_all_plus_structures(conn: &Connection) {
    for table in PLUS_TABLES {
        assert!(table_exists(conn, table), "missing table {table}");
    }
    for (table, column) in PLUS_COLUMNS {
        assert!(
            column_exists(conn, table, column),
            "missing {table}.{column}"
        );
    }
}

fn open_error(path: &Path) -> String {
    match Database::open(path) {
        Ok(db) => {
            drop(db);
            panic!("open unexpectedly succeeded")
        }
        Err(error) => format!("{error:#}"),
    }
}

fn drop_tables(conn: &Connection, tables: &[&str]) {
    for table in tables {
        conn.execute_batch(&format!("DROP TABLE {table};")).unwrap();
    }
}

fn drop_columns(conn: &Connection, columns: &[(&str, &str)]) {
    for (table, column) in columns {
        conn.execute_batch(&format!("ALTER TABLE {table} DROP COLUMN {column};"))
            .unwrap();
    }
}

fn strip_all_plus_structures(conn: &Connection) {
    drop_tables(
        conn,
        &[
            "team_tasks",
            "team_members",
            "teams",
            "plan_execution_schedules",
            "goal_reports",
            "plus_schema_meta",
        ],
    );
    drop_columns(conn, &PLUS_COLUMNS);
}

/// Rows every fixture carries so a reconciliation can prove it keeps data.
fn seed_rows(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO sessions (id, created_at, updated_at) VALUES ('s1', 1, 1);
         INSERT INTO sessions (id, execution_profile, created_at, updated_at)
           VALUES ('s2', 'team', 2, 2);
         INSERT INTO teams (team_session_id, created_at, updated_at) VALUES ('s2', 2, 2);
         INSERT INTO plan_approvals (
           request_id, session_id, turn_id, tool_call_id, kind, plan_json, status,
           created_at, updated_at, execution_id, execution_kind
         ) VALUES ('p1', 's1', 't1', 'c1', 'plan', '# Saved plan', 'approved', 1, 1, 'e1', 'plan');
         INSERT INTO plan_approvals (
           request_id, session_id, turn_id, tool_call_id, kind, plan_json, status,
           created_at, updated_at, execution_id, execution_kind
         ) VALUES ('p2', 's1', 't2', 'c2', 'goal', '# Saved goal', 'approved', 2, 2, 'e2', 'goal');
         INSERT INTO plan_approvals (
           request_id, session_id, turn_id, tool_call_id, kind, plan_json, status,
           created_at, updated_at
         ) VALUES ('p3', 's1', 't3', 'c3', 'plan', '# Pending plan', 'pending', 3, 3);",
    )
    .unwrap();
}

/// Database shapes released fork builds produced while they used v20..=v23 of
/// the shared `user_version` chain for Plus-only changes.
#[derive(Clone, Copy, Debug)]
enum LegacyShape {
    /// Unreleased v20 branch that only added `goal_reports`.
    V20GoalReports,
    /// Unreleased v20 branch that only added `artifact_workspace_kind`.
    V20WorkspaceKind,
    V21,
    V22,
    V23,
}

impl LegacyShape {
    const ALL: [LegacyShape; 5] = [
        LegacyShape::V20GoalReports,
        LegacyShape::V20WorkspaceKind,
        LegacyShape::V21,
        LegacyShape::V22,
        LegacyShape::V23,
    ];

    fn user_version(self) -> i64 {
        match self {
            LegacyShape::V20GoalReports | LegacyShape::V20WorkspaceKind => 20,
            LegacyShape::V21 => 21,
            LegacyShape::V22 => 22,
            LegacyShape::V23 => 23,
        }
    }

    fn removes_team(self) -> bool {
        matches!(
            self,
            LegacyShape::V20GoalReports | LegacyShape::V20WorkspaceKind
        )
    }

    /// Plus structures this shape did not have yet.
    fn strip(self, conn: &Connection) {
        const PLAN_SCHEDULES_AND_BINDING: [(&str, &str); 6] = [
            ("plan_approvals", "execution_provider_id"),
            ("plan_approvals", "execution_model_id"),
            ("plan_approvals", "revision_intent_json"),
            ("plan_approvals", "revision_state"),
            ("plan_approvals", "revision_turn_id"),
            ("plan_approvals", "revision_error_code"),
        ];
        if self.removes_team() {
            drop_tables(conn, &["team_tasks", "team_members", "teams"]);
            drop_columns(conn, &[("sessions", "execution_profile")]);
        }
        match self {
            LegacyShape::V20GoalReports => {
                drop_tables(conn, &["plan_execution_schedules"]);
                drop_columns(conn, &PLAN_SCHEDULES_AND_BINDING);
                drop_columns(
                    conn,
                    &[
                        ("plan_approvals", "execution_kind"),
                        ("plan_approvals", "artifact_workspace_kind"),
                    ],
                );
            }
            LegacyShape::V20WorkspaceKind => {
                drop_tables(conn, &["plan_execution_schedules", "goal_reports"]);
                drop_columns(conn, &PLAN_SCHEDULES_AND_BINDING);
                drop_columns(conn, &[("plan_approvals", "execution_kind")]);
            }
            LegacyShape::V21 => {
                drop_tables(conn, &["plan_execution_schedules"]);
                drop_columns(conn, &PLAN_SCHEDULES_AND_BINDING);
                drop_columns(conn, &[("plan_approvals", "execution_kind")]);
            }
            LegacyShape::V22 => drop_columns(conn, &[("plan_approvals", "execution_kind")]),
            LegacyShape::V23 => {}
        }
    }
}

/// A database as an older fork build left it: Plus structures on the shared
/// chain, no `plus_schema_meta`, `user_version` in the fork's v20..=v23 range.
fn create_legacy_fork_database(path: &Path, shape: LegacyShape) {
    let db = Database::open(path).unwrap();
    seed_rows(db.conn());
    db.conn()
        .execute_batch("DROP TABLE plus_schema_meta;")
        .unwrap();
    shape.strip(db.conn());
    db.conn()
        .pragma_update(None, "user_version", shape.user_version())
        .unwrap();
}

/// A database that has no Plus structure at all (pre-Plus baseline).
fn create_baseline_database(path: &Path, version: i64) {
    let db = Database::open(path).unwrap();
    seed_rows(db.conn());
    strip_all_plus_structures(db.conn());
    db.conn()
        .pragma_update(None, "user_version", version)
        .unwrap();
}

fn plan_row(conn: &Connection, id: &str) -> (String, Option<String>) {
    conn.query_row(
        "SELECT plan_json, execution_kind FROM plan_approvals WHERE request_id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn assert_seed_rows_survive(conn: &Connection, shape: Option<LegacyShape>) {
    assert_eq!(
        plan_row(conn, "p1"),
        ("# Saved plan".into(), Some("plan".into()))
    );
    assert_eq!(
        plan_row(conn, "p2"),
        ("# Saved goal".into(), Some("goal".into()))
    );
    assert_eq!(plan_row(conn, "p3"), ("# Pending plan".into(), None));
    let workspace_kind: String = conn
        .query_row(
            "SELECT artifact_workspace_kind FROM plan_approvals WHERE request_id = 'p1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(workspace_kind, "project");
    // Shapes that already carried the Team tables keep their rows.
    let keeps_team = shape.is_some_and(|shape| !shape.removes_team());
    let (profile, teams): (String, i64) = conn
        .query_row(
            "SELECT (SELECT execution_profile FROM sessions WHERE id = 's2'),
                    (SELECT COUNT(*) FROM teams)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(profile, if keeps_team { "team" } else { "standard" });
    assert_eq!(teams, i64::from(keeps_team));
}

#[test]
fn fresh_database_is_stamped_on_the_plus_track() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();

    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    assert!(backup_files(dir.path()).is_empty());
}

#[test]
fn reopening_a_current_database_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    drop(Database::open(&path).unwrap());
    let written_at = |conn: &Connection| -> i64 {
        conn.query_row("SELECT updated_at FROM plus_schema_meta", [], |row| {
            row.get(0)
        })
        .unwrap()
    };
    let first = Connection::open(&path).unwrap();
    let stamped = written_at(&first);
    drop(first);
    std::thread::sleep(std::time::Duration::from_millis(5));

    let db = Database::open(&path).unwrap();
    assert_eq!(written_at(db.conn()), stamped);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert!(backup_files(dir.path()).is_empty());
}

#[test]
fn baseline_database_gains_the_plus_structures_and_keeps_its_rows() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    create_baseline_database(&path, SCHEMA_VERSION);

    let db = Database::open(&path).unwrap();
    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    let workspace_kind: String = db
        .conn()
        .query_row(
            "SELECT artifact_workspace_kind FROM plan_approvals WHERE request_id = 'p1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(workspace_kind, "project");
    let profile: String = db
        .conn()
        .query_row(
            "SELECT execution_profile FROM sessions WHERE id = 's2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(profile, "standard");
    // `execution_kind` is backfilled for approved proposals only.
    assert_eq!(plan_row(db.conn(), "p1").1.as_deref(), Some("plan"));
    assert_eq!(plan_row(db.conn(), "p2").1.as_deref(), Some("goal"));
    assert_eq!(plan_row(db.conn(), "p3").1, None);

    // The pre-Plus state stays recoverable under the Plus backup name, and the
    // shared chain's `v{N}.bak` namespace is untouched.
    assert_eq!(backup_files(dir.path()), vec!["pi.sqlite.plus-v0.bak"]);
    let backup = open_plus_backup(&path, "plus-v0", SCHEMA_VERSION);
    assert!(!table_exists(&backup, "teams"));
    assert!(!column_exists(&backup, "sessions", "execution_profile"));
}

#[test]
fn legacy_fork_databases_move_onto_the_plus_track() {
    for shape in LegacyShape::ALL {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        create_legacy_fork_database(&path, shape);

        let db = Database::open(&path).unwrap_or_else(|error| panic!("{shape:?}: {error:#}"));
        assert_eq!(user_version(db.conn()), SCHEMA_VERSION, "{shape:?}");
        assert_eq!(
            meta(db.conn()),
            Some(plus_meta(SCHEMA_VERSION)),
            "{shape:?}"
        );
        assert_all_plus_structures(db.conn());
        assert_seed_rows_survive(db.conn(), Some(shape));

        let label = format!("legacy-v{}", shape.user_version());
        let backups = vec![format!("pi.sqlite.{label}.bak")];
        assert_eq!(backup_files(dir.path()), backups, "{shape:?}");
        drop(db);

        // Once reconciled the next open is a plain steady-state open.
        let db = Database::open(&path).unwrap();
        assert_eq!(user_version(db.conn()), SCHEMA_VERSION, "{shape:?}");
        assert_eq!(backup_files(dir.path()), backups, "{shape:?}");
        drop(db);

        // The backup is the untouched legacy file.
        let backup = open_plus_backup(&path, &label, shape.user_version());
        let saved: String = backup
            .query_row(
                "SELECT plan_json FROM plan_approvals WHERE request_id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(saved, "# Saved plan", "{shape:?}");
        assert!(!table_exists(&backup, "plus_schema_meta"), "{shape:?}");
    }
}

#[test]
fn an_older_fork_build_bumping_user_version_is_undone_on_the_next_open() {
    for bumped in 20..=23 {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        {
            let db = Database::open(&path).unwrap();
            seed_rows(db.conn());
            // An older fork build opens a Plus-track database as its own v19 and
            // replays its idempotent v19..=v23 steps, ending on its own number.
            db.conn()
                .pragma_update(None, "user_version", bumped)
                .unwrap();
        }

        let db = Database::open(&path).unwrap();
        assert_eq!(
            user_version(db.conn()),
            SCHEMA_VERSION,
            "bumped to {bumped}"
        );
        assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
        assert_seed_rows_survive(db.conn(), Some(LegacyShape::V23));
        open_plus_backup(&path, &format!("repair-v{bumped}"), bumped);
        assert_eq!(backup_files(dir.path()).len(), 1);
    }
}

#[test]
fn a_database_from_a_newer_plus_track_is_refused_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        db.conn()
            .execute(
                "UPDATE plus_schema_meta SET plus_version = ?1",
                params![PLUS_SCHEMA_VERSION + 1],
            )
            .unwrap();
    }

    let error = open_error(&path);
    assert!(
        error.contains(&format!(
            "Plus schema version {} is newer than supported {PLUS_SCHEMA_VERSION}",
            PLUS_SCHEMA_VERSION + 1
        )),
        "{error}"
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), SCHEMA_VERSION);
    assert_eq!(
        meta(&conn),
        Some(PlusMeta {
            plus_version: PLUS_SCHEMA_VERSION + 1,
            upstream_version: SCHEMA_VERSION
        })
    );
    assert!(backup_files(dir.path()).is_empty());
}

#[test]
fn databases_from_a_newer_shared_chain_are_refused_untouched() {
    let too_new = |version: i64| {
        format!("database schema version {version} is newer than supported {SCHEMA_VERSION}")
    };

    // No Plus structure and no meta: not a fork database, so never repaired.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    create_baseline_database(&path, 21);
    assert!(open_error(&path).contains(&too_new(21)));
    assert_eq!(user_version(&Connection::open(&path).unwrap()), 21);
    assert!(backup_files(dir.path()).is_empty());

    // A newer Plus-aware build stamped the file: its number is legitimate.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        db.conn()
            .execute_batch("UPDATE plus_schema_meta SET upstream_version = 21;")
            .unwrap();
        db.conn().pragma_update(None, "user_version", 21).unwrap();
    }
    assert!(open_error(&path).contains(&too_new(21)));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), 21);
    assert_eq!(meta(&conn), Some(plus_meta(21)));
    assert!(backup_files(dir.path()).is_empty());

    // Outside the range the fork ever used: never a legacy leftover.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        db.conn().pragma_update(None, "user_version", 24).unwrap();
    }
    assert!(open_error(&path).contains(&too_new(24)));
    assert_eq!(user_version(&Connection::open(&path).unwrap()), 24);
    assert!(backup_files(dir.path()).is_empty());
}

#[test]
fn an_upstream_chain_step_cannot_drop_plus_columns_for_good() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        // The v18 -> v19 step rebuilds `sessions` with an explicit column list.
        db.conn().pragma_update(None, "user_version", 18).unwrap();
    }

    let db = Database::open(&path).unwrap();
    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    let rejected = db.conn().execute(
        "INSERT INTO sessions (id, execution_profile, created_at, updated_at)
         VALUES ('bad', 'bogus', 1, 1)",
        [],
    );
    assert!(rejected.is_err(), "execution_profile lost its CHECK");
    // Re-verification of structures already applied needs no Plus backup.
    assert_eq!(backup_files(dir.path()), vec!["pi.sqlite.v18.bak"]);
}

#[test]
fn a_meta_that_disagrees_with_user_version_triggers_reverification() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        // A foreign build moved the shared version and left the Plus meta behind.
        db.conn()
            .execute_batch(
                "UPDATE plus_schema_meta SET upstream_version = 17;
                 DROP TABLE plan_execution_schedules;",
            )
            .unwrap();
    }

    let db = Database::open(&path).unwrap();
    assert!(table_exists(db.conn(), "plan_execution_schedules"));
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert!(backup_files(dir.path()).is_empty());
}

#[test]
fn a_failing_plus_step_leaves_the_database_as_it_was() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    create_baseline_database(&path, SCHEMA_VERSION);
    {
        // User-created table that blocks step P2's `idx_team_members_session`.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE team_members (unrelated TEXT);")
            .unwrap();
    }

    let error = open_error(&path);
    assert!(error.contains("Plus schema step P2"), "{error}");
    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), SCHEMA_VERSION);
    assert!(!table_exists(&conn, "plus_schema_meta"));
    // P1 ran in the same transaction and must have been rolled back with it.
    assert!(!column_exists(
        &conn,
        "plan_approvals",
        "artifact_workspace_kind"
    ));
    assert!(!table_exists(&conn, "goal_reports"));
    open_plus_backup(&path, "plus-v0", SCHEMA_VERSION);
}

#[test]
fn a_failing_reconciliation_keeps_the_legacy_version_and_its_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    create_legacy_fork_database(&path, LegacyShape::V22);
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "DROP TABLE plan_execution_schedules;
             CREATE TABLE plan_execution_schedules (unrelated TEXT);",
        )
        .unwrap();
    }

    let error = open_error(&path);
    assert!(error.contains("Plus schema step P3"), "{error}");
    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), 22);
    assert!(!table_exists(&conn, "plus_schema_meta"));
    open_plus_backup(&path, "legacy-v22", 22);
}

/// Tables and columns of a database holding only the shared baseline schema.
fn baseline_structures(conn: &Connection) -> (BTreeSet<String>, BTreeSet<(String, String)>) {
    let tables: BTreeSet<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let mut columns = BTreeSet::new();
    for table in &tables {
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info(?1)")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map(params![table], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        columns.extend(names.into_iter().map(|name| (table.clone(), name)));
    }
    (tables, columns)
}

fn baseline_connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    conn.execute_batch(SCHEMA_LATEST).unwrap();
    conn.execute_batch(PLAN_APPROVALS_SCHEMA).unwrap();
    conn.execute_batch(crate::session_collaboration::SCHEMA)
        .unwrap();
    conn
}

#[test]
fn plus_markers_list_exactly_what_the_steps_add() {
    let conn = baseline_connection();
    let (tables_before, columns_before) = baseline_structures(&conn);
    run_steps(&conn).unwrap();
    let (tables_after, columns_after) = baseline_structures(&conn);

    let added_tables: BTreeSet<&str> = tables_after
        .difference(&tables_before)
        .map(String::as_str)
        .collect();
    assert_eq!(added_tables, BTreeSet::from(PLUS_TABLES));

    // Columns of the new tables belong to them; only added columns of
    // pre-existing tables are markers on their own.
    let added_columns: BTreeSet<(&str, &str)> = columns_after
        .difference(&columns_before)
        .filter(|(table, _)| tables_before.contains(table))
        .map(|(table, column)| (table.as_str(), column.as_str()))
        .collect();
    assert_eq!(added_columns, BTreeSet::from(PLUS_COLUMNS));
}

#[test]
fn plus_steps_are_idempotent() {
    let conn = baseline_connection();
    run_steps(&conn).unwrap();
    let snapshot = |conn: &Connection| -> Vec<(String, String)> {
        conn.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    let before = snapshot(&conn);
    run_steps(&conn).unwrap();
    assert_eq!(snapshot(&conn), before);
}

#[test]
fn plus_columns_keep_their_constraints() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    seed_rows(db.conn());
    for (column, bogus) in [
        ("artifact_workspace_kind", "bogus"),
        ("execution_kind", "bogus"),
        ("revision_state", "bogus"),
    ] {
        let rejected = db.conn().execute(
            &format!("UPDATE plan_approvals SET {column} = ?1 WHERE request_id = 'p1'"),
            params![bogus],
        );
        assert!(rejected.is_err(), "{column} accepted {bogus:?}");
    }
    let rejected = db.conn().execute(
        "UPDATE sessions SET execution_profile = 'bogus' WHERE id = 's1'",
        [],
    );
    assert!(rejected.is_err(), "execution_profile accepted 'bogus'");
    let rejected = db.conn().execute(
        "INSERT INTO plan_execution_schedules (proposal_id, scheduled_for, timezone, state, updated_at)
         VALUES ('p1', 1, 'UTC', 'bogus', 1)",
        [],
    );
    assert!(
        rejected.is_err(),
        "plan_execution_schedules accepted state 'bogus'"
    );
}
