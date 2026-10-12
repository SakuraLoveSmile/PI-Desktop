//! Read-only compatibility for historical managed services.
//! Lost ownership is recorded at startup; no PID is adopted and no command replayed.
use crate::db::Database;
use anyhow::{anyhow, Result};
use rusqlite::OptionalExtension;
use serde::Serialize;

pub(crate) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS background_service_ownership (
 process_id TEXT PRIMARY KEY REFERENCES background_processes(id) ON DELETE CASCADE,
 team_session_id TEXT NOT NULL, team_run_id TEXT NOT NULL,
 launch_turn_id TEXT NOT NULL, deadline_at INTEGER NOT NULL, goal_execution_id TEXT,
 owner_project_path TEXT,
 stop_reason TEXT, stop_requested_at INTEGER, stop_escalated INTEGER CHECK(stop_escalated IN (0,1)),
 CHECK ((stop_reason IS NULL) = (stop_requested_at IS NULL))
);
CREATE INDEX IF NOT EXISTS background_services_team ON background_service_ownership(team_session_id,team_run_id);
CREATE TRIGGER IF NOT EXISTS background_services_block_team_delete
BEFORE DELETE ON sessions
WHEN EXISTS (SELECT 1 FROM background_service_ownership s JOIN background_processes p ON p.id=s.process_id
 WHERE s.team_session_id=OLD.id AND p.status IN ('starting','running','stopping'))
BEGIN SELECT RAISE(ABORT, 'SESSION_HAS_BACKGROUND_SERVICES'); END;
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceMetadata {
    pub background_kind: &'static str,
    pub team_session_id: String,
    pub team_run_id: String,
    pub deadline_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_requested_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_stop_escalated: Option<bool>,
}

pub(crate) fn timestamp(at: i64) -> Result<String> {
    chrono::DateTime::from_timestamp_millis(at)
        .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .ok_or_else(|| anyhow!("service timestamp out of range"))
}

pub(crate) fn metadata(db: &Database, id: &str) -> Result<Option<ServiceMetadata>> {
    type StoredMetadata = (
        String,
        String,
        i64,
        Option<String>,
        Option<i64>,
        Option<bool>,
    );
    let stored: Option<StoredMetadata> = db.conn().query_row(
        "SELECT team_session_id,team_run_id,deadline_at,stop_reason,stop_requested_at,stop_escalated FROM background_service_ownership WHERE process_id=?1",
        [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
    ).optional()?;
    stored
        .map(|(team, run, deadline, reason, requested, escalated)| {
            Ok(ServiceMetadata {
                background_kind: "service",
                team_session_id: team,
                team_run_id: run,
                deadline_at: timestamp(deadline)?,
                stop_reason: reason,
                stop_requested_at: requested.map(timestamp).transpose()?,
                service_stop_escalated: escalated,
            })
        })
        .transpose()
}

/// Startup recovery records lost ownership; it never searches for or adopts a PID.
pub(crate) fn recover(db: &Database, now: i64) -> Result<()> {
    db.conn().execute("UPDATE background_service_ownership SET stop_reason=COALESCE(stop_reason,'host_restart'),stop_requested_at=COALESCE(stop_requested_at,?1) WHERE process_id IN (SELECT id FROM background_processes WHERE status IN ('starting','running','stopping'))", [now])?;
    Ok(())
}
