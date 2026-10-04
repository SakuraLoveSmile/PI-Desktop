//! How the Plus track meets upstream's shared `user_version` chain: steps the
//! chain takes above the fork baseline, numbers both lines have used, and
//! databases a newer build wrote.

use super::fixtures::{
    assert_all_plus_structures, assert_seed_rows_survive, assert_upstream_structures_through,
    backup_files, create_baseline_database, create_legacy_fork_database, expected_backups, meta,
    open_error, open_plus_backup, plan_row, plus_meta, seed_rows, strip_upstream_steps_above,
    table_exists, user_version, LegacyShape, UPSTREAM_STEPS,
};
use crate::db::plus_schema::{
    FORK_SHARED_BASELINE, LEGACY_FORK_VERSIONS, PLUS_COLUMNS, PLUS_TABLES,
};
use crate::db::*;
use rusqlite::types::Value as SqlValue;

/// Gives every Plus structure a value that differs from its default on top of
/// [`seed_rows`], so a rebuilt table that quietly re-adds a column shows up as
/// a changed value. Needs the newest Plus shape.
fn seed_plus_values(conn: &Connection) {
    let changed = conn
        .execute(
            "UPDATE plan_approvals SET
               artifact_workspace_kind = 'scratch',
               execution_provider_id = 'provider-1',
               execution_model_id = 'model-1',
               revision_intent_json = '{\"focus\":\"scope\"}',
               revision_state = 'failed',
               revision_turn_id = 'revision-turn-1',
               revision_error_code = 'revision_failed'
             WHERE request_id = 'p2'",
            [],
        )
        .unwrap();
    assert_eq!(changed, 1);
    let changed = conn
        .execute(
            "UPDATE teams SET revision = 4, paused = 1 WHERE team_session_id = 's2'",
            [],
        )
        .unwrap();
    assert_eq!(changed, 1);
    conn.execute_batch(
        "INSERT INTO sessions (id, execution_profile, created_at, updated_at)
           VALUES ('m1', 'team', 4, 4);
         INSERT INTO team_members (
           team_session_id, member_session_id, name, description, context_kind, phase,
           model_id, provider_id, created_at, updated_at
         ) VALUES ('s2', 'm1', 'reviewer', 'Reviews the diff', 'fork', 'running',
                   'model-1', 'provider-1', 4, 5);
         INSERT INTO team_tasks (
           team_session_id, task_id, revision, subject, description, status,
           owner_session_id, owner_member_name, blocked_by_json, write_scopes_json,
           created_at, updated_at
         ) VALUES ('s2', 'task-1', 3, 'Review', 'Review the change', 'in_progress',
                   'm1', 'reviewer', '[\"task-0\"]', '[\"src/\"]', 4, 6);
         INSERT INTO plan_execution_schedules (
           proposal_id, scheduled_for, timezone, state, updated_at
         ) VALUES ('p1', 1000, 'Asia/Shanghai', 'scheduled', 7);
         INSERT INTO goal_reports (
           execution_id, report_id, session_id, proposal_id, turn_id, status, integrity,
           verdict, summary, file_path, file_hash, file_size, durable_seq,
           created_at, updated_at
         ) VALUES ('e2', 'r1', 's1', 'p2', 't2', 'ready', 'structured', 'partial',
                   'Most criteria met', 'reports/r1.md', 'abc123', 42, 9, 8, 9);",
    )
    .unwrap();
}

fn dump_rows(conn: &Connection, sql: &str) -> Vec<Vec<SqlValue>> {
    let mut stmt = conn.prepare(sql).unwrap();
    let width = stmt.column_count();
    stmt.query_map([], |row| (0..width).map(|index| row.get(index)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

/// Everything the Plus track owns as comparable rows: the Plus tables in
/// full, and the Plus columns of the shared tables next to their row key.
fn plus_values(conn: &Connection) -> Vec<(String, Vec<Vec<SqlValue>>)> {
    let mut snapshot = Vec::new();
    for table in PLUS_TABLES {
        let rows = dump_rows(conn, &format!("SELECT * FROM {table} ORDER BY 1, 2"));
        snapshot.push((table.to_string(), rows));
    }
    let keyed_tables = [("plan_approvals", "request_id"), ("sessions", "id")];
    for (table, _) in PLUS_COLUMNS {
        assert!(
            keyed_tables.iter().any(|(keyed, _)| *keyed == table),
            "plus_values needs a row key for {table}"
        );
    }
    for (table, key) in keyed_tables {
        let columns: Vec<&str> = PLUS_COLUMNS
            .iter()
            .filter(|(owner, _)| *owner == table)
            .map(|(_, column)| *column)
            .collect();
        let rows = dump_rows(
            conn,
            &format!(
                "SELECT {key}, {} FROM {table} ORDER BY {key}",
                columns.join(", ")
            ),
        );
        snapshot.push((table.to_string(), rows));
    }
    snapshot
}

#[test]
fn upstream_fixture_steps_cover_the_shared_chain_above_the_fork_baseline() {
    let versions: Vec<i64> = UPSTREAM_STEPS.iter().map(|step| step.version).collect();
    assert_eq!(
        versions,
        ((FORK_SHARED_BASELINE + 1)..=SCHEMA_VERSION).collect::<Vec<_>>(),
        "list every upstream step above the fork baseline in UPSTREAM_STEPS"
    );
}

#[test]
fn upstream_only_databases_cross_the_shared_chain_before_gaining_the_plus_track() {
    for version in FORK_SHARED_BASELINE..SCHEMA_VERSION {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        create_baseline_database(&path, version);
        {
            // Queue state the upstream steps above `version` must carry over.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "INSERT INTO turn_queue (
                   id, session_id, principal, input_hash, content, permission_mode,
                   position, created_at
                 ) VALUES ('q1', 's1', 'desktop', 'hash', 'queued prompt', 'ask', 0, 1);",
            )
            .unwrap();
        }

        let db = Database::open(&path).unwrap_or_else(|error| panic!("v{version}: {error:#}"));
        assert_eq!(user_version(db.conn()), SCHEMA_VERSION, "v{version}");
        assert_eq!(
            meta(db.conn()),
            Some(plus_meta(SCHEMA_VERSION)),
            "v{version}"
        );
        assert_all_plus_structures(db.conn());
        assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
        let queued: (String, Option<String>, Option<String>) = db
            .conn()
            .query_row(
                "SELECT content, user_message_id, voice_origin_json FROM turn_queue WHERE id = 'q1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(queued, ("queued prompt".into(), None, None), "v{version}");
        assert_eq!(
            plan_row(db.conn(), "p1"),
            ("# Saved plan".into(), Some("plan".into())),
            "v{version}"
        );

        // The chain runs first, so the Plus backup already shows its result.
        assert_eq!(
            backup_files(dir.path()),
            expected_backups(&["plus-v0"], version),
            "v{version}"
        );
        let backup = open_plus_backup(&path, "plus-v0", SCHEMA_VERSION);
        assert_upstream_structures_through(&backup, SCHEMA_VERSION);
        assert!(!table_exists(&backup, "teams"), "v{version}");
    }
}

#[test]
fn joint_upstream_v20_v21_steps_and_plus_reconciliation_keep_every_plus_value() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    // The newest released fork shape: `user_version` 23, every Plus structure,
    // none of upstream's v20/v21 structures.
    create_legacy_fork_database(&path, LegacyShape::V23);
    let seeded = {
        let conn = Connection::open(&path).unwrap();
        seed_plus_values(&conn);
        plus_values(&conn)
    };

    let db = Database::open(&path).unwrap();
    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
    assert_eq!(
        plus_values(db.conn()),
        seeded,
        "reconciliation or an upstream step changed Plus values"
    );
    assert_seed_rows_survive(db.conn(), Some(LegacyShape::V23));
    // The new upstream columns start out empty on the rows that predate them.
    let todo: (i64, Option<i64>) = db
        .conn()
        .query_row(
            "SELECT todo_revision, todo_updated_at FROM sessions WHERE id = 's2'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(todo, (0, None));
    // One Plus backup of the released state, then the shared chain's own
    // backup for each of upstream's steps.
    assert_eq!(
        backup_files(dir.path()),
        expected_backups(&["legacy-v23"], FORK_SHARED_BASELINE)
    );
    drop(db);

    // Both tracks are settled: the next open is a plain steady-state open.
    let db = Database::open(&path).unwrap();
    assert_eq!(plus_values(db.conn()), seeded);
    assert_eq!(
        backup_files(dir.path()),
        expected_backups(&["legacy-v23"], FORK_SHARED_BASELINE)
    );
}

#[test]
fn an_older_fork_build_bumping_user_version_is_undone_on_the_next_open() {
    // Only numbers above this build's own chain can be told apart from a
    // genuine upstream version; the window closes as `SCHEMA_VERSION` reaches
    // the last number the fork used.
    for bumped in (SCHEMA_VERSION + 1)..=*LEGACY_FORK_VERSIONS.end() {
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
fn legacy_range_numbers_inside_the_shared_chain_are_migrated_not_repaired() {
    // 20 and 21 are upstream's own numbers now: a Plus-track database standing
    // there is a database upstream's chain advanced, so the chain finishes the
    // job instead of resetting it.
    for version in LEGACY_FORK_VERSIONS.filter(|version| *version <= SCHEMA_VERSION) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        {
            let db = Database::open(&path).unwrap();
            seed_rows(db.conn());
            strip_upstream_steps_above(db.conn(), version);
            db.conn()
                .execute(
                    "UPDATE plus_schema_meta SET upstream_version = ?1",
                    params![FORK_SHARED_BASELINE],
                )
                .unwrap();
            db.conn()
                .pragma_update(None, "user_version", version)
                .unwrap();
        }

        let db = Database::open(&path).unwrap_or_else(|error| panic!("v{version}: {error:#}"));
        assert_eq!(user_version(db.conn()), SCHEMA_VERSION, "v{version}");
        assert_eq!(
            meta(db.conn()),
            Some(plus_meta(SCHEMA_VERSION)),
            "v{version}"
        );
        assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
        assert_seed_rows_survive(db.conn(), Some(LegacyShape::V23));
        // Nothing but the shared chain's own steps ran: no repair backup.
        assert_eq!(
            backup_files(dir.path()),
            expected_backups(&[], version),
            "v{version}"
        );
    }
}

#[test]
fn databases_from_a_newer_shared_chain_are_refused_untouched() {
    let too_new = |version: i64| {
        format!("database schema version {version} is newer than supported {SCHEMA_VERSION}")
    };

    // The first number above this build's chain; while it lies inside the
    // fork's former range it is the ambiguous case the rules below settle.
    let newer = SCHEMA_VERSION + 1;

    // No Plus structure and no meta: not a fork database, so never repaired.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    create_baseline_database(&path, newer);
    assert!(open_error(&path).contains(&too_new(newer)));
    assert_eq!(user_version(&Connection::open(&path).unwrap()), newer);
    assert!(backup_files(dir.path()).is_empty());

    // A newer Plus-aware build stamped the file: its number is legitimate.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        db.conn()
            .execute(
                "UPDATE plus_schema_meta SET upstream_version = ?1",
                params![newer],
            )
            .unwrap();
        db.conn()
            .pragma_update(None, "user_version", newer)
            .unwrap();
    }
    assert!(open_error(&path).contains(&too_new(newer)));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(user_version(&conn), newer);
    assert_eq!(meta(&conn), Some(plus_meta(newer)));
    assert!(backup_files(dir.path()).is_empty());

    // Outside the range the fork ever used: never a legacy leftover.
    let beyond_fork_range = SCHEMA_VERSION.max(*LEGACY_FORK_VERSIONS.end()) + 1;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    {
        let db = Database::open(&path).unwrap();
        db.conn()
            .pragma_update(None, "user_version", beyond_fork_range)
            .unwrap();
    }
    assert!(open_error(&path).contains(&too_new(beyond_fork_range)));
    assert_eq!(
        user_version(&Connection::open(&path).unwrap()),
        beyond_fork_range
    );
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
    assert_eq!(backup_files(dir.path()), expected_backups(&[], 18));
}

#[test]
fn upstream_steps_above_the_fork_baseline_keep_plus_values() {
    // ADR plus-schema-version-track: a Plus column that an upstream step
    // rebuilds away comes back through the replay, but only its structure.
    // This pins that no step above the baseline loses values. When a sync
    // raises `SCHEMA_VERSION` and this fails, extend the rebuilding step's
    // column list instead of accepting the loss.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pi.sqlite");
    let seeded = {
        let db = Database::open(&path).unwrap();
        seed_rows(db.conn());
        seed_plus_values(db.conn());
        let seeded = plus_values(db.conn());
        // Stand on the shared baseline so every step above it really runs.
        strip_upstream_steps_above(db.conn(), FORK_SHARED_BASELINE);
        db.conn()
            .pragma_update(None, "user_version", FORK_SHARED_BASELINE)
            .unwrap();
        seeded
    };

    let db = Database::open(&path).unwrap();
    assert_eq!(user_version(db.conn()), SCHEMA_VERSION);
    assert_eq!(meta(db.conn()), Some(plus_meta(SCHEMA_VERSION)));
    assert_all_plus_structures(db.conn());
    assert_upstream_structures_through(db.conn(), SCHEMA_VERSION);
    assert_eq!(
        plus_values(db.conn()),
        seeded,
        "an upstream step lost Plus values"
    );
    assert_eq!(
        backup_files(dir.path()),
        expected_backups(&[], FORK_SHARED_BASELINE)
    );
}
