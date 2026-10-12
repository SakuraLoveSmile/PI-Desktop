//! Explicit Team services keep the existing Bash process owner and shell permit.
//! Durable ownership is not a PID claim and never causes a process to be replayed.
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::{db::Database, state::AppState};

mod admission;
mod lifecycle;
#[cfg(test)]
mod tests;
pub(crate) use admission::{capture, revalidate, LaunchScope};
pub(crate) use lifecycle::{request_team, sweep};

pub(crate) const TTL_MS: i64 = 6 * 60 * 60 * 1000;
const STOP_MODE_NS: &str = "background-service-stop-mode-v1";
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
    /// The actual platform shutdown mechanism, never a promise of graceful exit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_stop_escalated: Option<bool>,
}

#[derive(Debug, Clone)]
pub(crate) struct StopRequest {
    pub reason: String,
    pub at: i64,
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
                // Historical ownership has no platform mechanism evidence.
                // Never infer a former stop mechanism from the current host.
                stop_mode: db
                    .kv_get(STOP_MODE_NS, id)?
                    .and_then(|value| value.as_str().map(str::to_owned)),
                service_stop_escalated: escalated,
            })
        })
        .transpose()
}

pub(crate) fn persist_owner(db: &Database, id: &str, scope: &LaunchScope, now: i64) -> Result<()> {
    db.conn().execute("INSERT INTO background_service_ownership(process_id,team_session_id,team_run_id,launch_turn_id,deadline_at,owner_project_path,goal_execution_id) VALUES(?1,?2,?3,?4,?5,(SELECT project.path FROM background_processes process JOIN sessions session ON session.id=process.session_id LEFT JOIN projects project ON project.id=session.project_id WHERE process.id=?1),(SELECT a.execution_id FROM plan_approvals a JOIN goal_reports g ON g.execution_id=a.execution_id WHERE a.session_id=?2 AND g.turn_id=?3 AND COALESCE(a.execution_kind,a.kind)='goal' AND a.execution_state='running' ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1))",
        params![id,scope.team_session_id,scope.team_run_id,scope.turn_id,now.saturating_add(TTL_MS)])?;
    db.kv_set(
        STOP_MODE_NS,
        id,
        &serde_json::json!(if cfg!(windows) {
            "windows-job-force"
        } else {
            "unix-term-then-kill"
        }),
    )?;
    Ok(())
}

pub(crate) fn persist_stop(db: &Database, id: &str, request: &StopRequest) -> Result<()> {
    db.conn().execute("UPDATE background_service_ownership SET stop_reason=COALESCE(stop_reason,?2),stop_requested_at=COALESCE(stop_requested_at,?3) WHERE process_id=?1",
        params![id,request.reason,request.at])?;
    Ok(())
}

pub(crate) fn recorded_stop(db: &Database, id: &str) -> Result<Option<StopRequest>> {
    let request = db.conn().query_row("SELECT stop_reason,stop_requested_at FROM background_service_ownership WHERE process_id=?1",[id],|row| {
        let reason: Option<String> = row.get(0)?;
        let at: Option<i64> = row.get(1)?;
        Ok(reason.zip(at).map(|(reason,at)|StopRequest {reason,at}))
    }).optional()?.flatten();
    Ok(request)
}

/// An explicit stop reaches the live owner even if the request cannot be saved.
pub(crate) fn request_stop(st: &AppState, id: &str, reason: &str, now: i64) -> Result<()> {
    if st.pending_background_finalizations.contains_key(id) {
        return Ok(());
    }
    let Some(process) = st.db.conn().query_row(
        "SELECT p.session_id,p.tool_call_id FROM background_processes p JOIN background_service_ownership s ON s.process_id=p.id WHERE p.id=?1 AND p.status IN ('starting','running','stopping')",
        [id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)),
    ).optional()? else { return Ok(()); };
    let sender = st
        .active_bash_cancellations
        .get(&process)
        .ok_or_else(|| anyhow!("background service owner unavailable"))?;
    let output = st
        .background_outputs
        .get(id)
        .ok_or_else(|| anyhow!("background service output owner unavailable"))?;
    let request = output
        .lock()
        .map_err(|_| anyhow!("background output lock poisoned"))?
        .request_service_stop(StopRequest {
            reason: reason.into(),
            at: now,
        });
    sender.send_replace(true);
    persist_stop(&st.db, id, &request)?;
    st.db.conn().execute("UPDATE background_processes SET status='stopping' WHERE id=?1 AND status IN ('starting','running')", [id])?;
    Ok(())
}

/// Startup recovery records lost ownership; it never searches for or adopts a PID.
pub(crate) fn recover(db: &Database, now: i64) -> Result<()> {
    db.conn().execute("UPDATE background_service_ownership SET stop_reason=COALESCE(stop_reason,'host_restart'),stop_requested_at=COALESCE(stop_requested_at,?1) WHERE process_id IN (SELECT id FROM background_processes WHERE status IN ('starting','running','stopping'))", [now])?;
    Ok(())
}

pub(crate) fn request_all(st: &AppState, reason: &str, now: i64) -> Result<()> {
    let ids = lifecycle::active_ids(&st.db)?;
    let mut failure = None;
    for id in ids {
        if let Err(error) = request_stop(st, &id, reason, now) {
            failure.get_or_insert(error);
        }
    }
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
