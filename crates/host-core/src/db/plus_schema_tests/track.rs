//! The Plus track itself: stamping, reconciliation of legacy fork databases,
//! its own refusals, failure atomicity, and the shape of the steps.

use super::fixtures::{
    assert_all_plus_structures, assert_seed_rows_survive, assert_upstream_structures_through,
    backup_files, column_exists, create_baseline_database, create_legacy_fork_database,
    expected_backups, meta, open_error, open_plus_backup, plan_row, plus_meta, seed_rows,
    table_exists, user_version, LegacyShape,
};
use crate::db::plus_schema::{
    run_steps, PlusMeta, FORK_SHARED_BASELINE, PLUS_COLUMNS, PLUS_SCHEMA_VERSION, PLUS_TABLES,
};
use crate::db::*;
use std::collections::BTreeSet;

#[test]
fn fresh_database_is_stamped_on_the_plus_track() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let db = Database::open(&path).unwrap();

    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
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
        assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
        assert_seed_rows_survive(db.conn(), Some(shape));

        // Reconciliation resets to the shared baseline, so the shared chain
        // then takes every upstream step with its own backup.
        let label = format!("legacy-v{}", shape.user_version());
        let backups = expected_backups(&[&label], FORK_SHARED_BASELINE);
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
    // On the shared baseline, outside the legacy range: a user-created Plus
    // table at 20..=23 would classify the file as a legacy fork database.
    create_baseline_database(&path, FORK_SHARED_BASELINE);
    {
        // User-created table that blocks step P2's `idx_team_members_session`.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE team_members (unrelated TEXT);")
            .unwrap();
    }

    let error = open_error(&path);
    assert!(error.contains("Plus schema step P2"), "{error}");
    let conn = Connection::open(&path).unwrap();
    // Only the Plus transaction rolls back: the shared chain's steps ran
    // before it, each committed behind its own backup.
    assert_eq!(user_version(&conn), SCHEMA_VERSION);
    assert_eq!(
        backup_files(dir.path()),
        expected_backups(&["plus-v0"], FORK_SHARED_BASELINE)
    );
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
