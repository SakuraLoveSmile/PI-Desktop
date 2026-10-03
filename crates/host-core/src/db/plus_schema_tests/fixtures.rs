//! Database shapes and assertions shared by the Plus schema tests.

use crate::db::plus_schema::{
    plus_backup_path, read_meta, PlusMeta, FORK_SHARED_BASELINE, PLUS_COLUMNS, PLUS_SCHEMA_VERSION,
    PLUS_TABLES,
};
use crate::db::*;

pub(super) fn user_version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap()
}

pub(super) fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        params![name],
        |row| row.get(0),
    )
    .unwrap()
}

pub(super) fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
        params![table, column],
        |row| row.get(0),
    )
    .unwrap()
}

pub(super) fn meta(conn: &Connection) -> Option<PlusMeta> {
    read_meta(conn).unwrap()
}

pub(super) fn plus_meta(upstream_version: i64) -> PlusMeta {
    PlusMeta {
        plus_version: PLUS_SCHEMA_VERSION,
        upstream_version,
    }
}

/// Names of every backup artifact next to the database, sorted.
pub(super) fn backup_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".bak"))
        .collect();
    names.sort();
    names
}

/// Sorted backup names a database leaves behind: one per Plus `label`, plus
/// the shared chain's own `v{N}.bak` for every step it took from `chain_from`
/// up to `SCHEMA_VERSION`.
pub(super) fn expected_backups(plus_labels: &[&str], chain_from: i64) -> Vec<String> {
    let mut names: Vec<String> = plus_labels
        .iter()
        .map(|label| format!("pi.sqlite.{label}.bak"))
        .collect();
    names.extend((chain_from..SCHEMA_VERSION).map(|version| format!("pi.sqlite.v{version}.bak")));
    names.sort();
    names
}

/// Opens the Plus backup `label`, checks it is intact and carries `version`,
/// and returns the connection for further inspection.
pub(super) fn open_plus_backup(path: &Path, label: &str, version: i64) -> Connection {
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

pub(super) fn assert_all_plus_structures(conn: &Connection) {
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

pub(super) fn open_error(path: &Path) -> String {
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

/// Structures one upstream step above the fork baseline creates.
pub(super) struct UpstreamStep {
    /// `user_version` the step produces.
    pub(super) version: i64,
    tables: &'static [&'static str],
    columns: &'static [(&'static str, &'static str)],
}

/// Every shared-chain step above [`FORK_SHARED_BASELINE`], in order. Released
/// fork databases predate all of them, so fixtures standing at the baseline or
/// at a legacy number must not carry these yet. Add an entry (possibly empty)
/// with each upstream sync that raises `SCHEMA_VERSION`.
pub(super) const UPSTREAM_STEPS: [UpstreamStep; 2] = [
    // v20: queued turns keep user-message identity and Live Voice provenance.
    UpstreamStep {
        version: 20,
        tables: &[],
        columns: &[
            ("turn_queue", "user_message_id"),
            ("turn_queue", "voice_origin_json"),
        ],
    },
    // v21: the per-session Todo checklist.
    UpstreamStep {
        version: 21,
        tables: &["session_todo"],
        columns: &[
            ("sessions", "todo_revision"),
            ("sessions", "todo_updated_at"),
        ],
    },
];

/// Drops what the upstream steps above `version` create, so a fixture
/// standing at `version` looks like a database that old.
pub(super) fn strip_upstream_steps_above(conn: &Connection, version: i64) {
    for step in UPSTREAM_STEPS
        .iter()
        .rev()
        .filter(|step| step.version > version)
    {
        drop_tables(conn, step.tables);
        drop_columns(conn, step.columns);
    }
}

/// Every structure the upstream steps up to `version` create.
pub(super) fn assert_upstream_structures_through(conn: &Connection, version: i64) {
    for step in UPSTREAM_STEPS.iter().filter(|step| step.version <= version) {
        for table in step.tables {
            assert!(
                table_exists(conn, table),
                "missing table {table} of upstream v{}",
                step.version
            );
        }
        for (table, column) in step.columns {
            assert!(
                column_exists(conn, table, column),
                "missing {table}.{column} of upstream v{}",
                step.version
            );
        }
    }
}

/// Rows every fixture carries so a reconciliation can prove it keeps data.
pub(super) fn seed_rows(conn: &Connection) {
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
pub(super) enum LegacyShape {
    /// Unreleased v20 branch that only added `goal_reports`.
    V20GoalReports,
    /// Unreleased v20 branch that only added `artifact_workspace_kind`.
    V20WorkspaceKind,
    V21,
    V22,
    V23,
}

impl LegacyShape {
    pub(super) const ALL: [LegacyShape; 5] = [
        LegacyShape::V20GoalReports,
        LegacyShape::V20WorkspaceKind,
        LegacyShape::V21,
        LegacyShape::V22,
        LegacyShape::V23,
    ];

    pub(super) fn user_version(self) -> i64 {
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
/// Such a build predates every upstream step above the shared baseline, so the
/// file lacks their structures even though its number overlaps upstream's.
pub(super) fn create_legacy_fork_database(path: &Path, shape: LegacyShape) {
    let db = Database::open(path).unwrap();
    seed_rows(db.conn());
    db.conn()
        .execute_batch("DROP TABLE plus_schema_meta;")
        .unwrap();
    strip_upstream_steps_above(db.conn(), FORK_SHARED_BASELINE);
    shape.strip(db.conn());
    db.conn()
        .pragma_update(None, "user_version", shape.user_version())
        .unwrap();
}

/// A database that has no Plus structure at all (pre-Plus baseline), as old as
/// the shared chain's `version`.
pub(super) fn create_baseline_database(path: &Path, version: i64) {
    let db = Database::open(path).unwrap();
    seed_rows(db.conn());
    strip_all_plus_structures(db.conn());
    strip_upstream_steps_above(db.conn(), version);
    db.conn()
        .pragma_update(None, "user_version", version)
        .unwrap();
}

pub(super) fn plan_row(conn: &Connection, id: &str) -> (String, Option<String>) {
    conn.query_row(
        "SELECT plan_json, execution_kind FROM plan_approvals WHERE request_id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

pub(super) fn assert_seed_rows_survive(conn: &Connection, shape: Option<LegacyShape>) {
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
