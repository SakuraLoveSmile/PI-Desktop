use anyhow::Result;
use rusqlite::{params, OptionalExtension};

use super::{request_stop, StopRequest};
use crate::{db::Database, state::AppState, team};

pub(super) fn active_ids(db: &Database) -> Result<Vec<String>> {
    let mut statement = db.conn().prepare_cached("SELECT p.id FROM background_processes p JOIN background_service_ownership s ON s.process_id=p.id WHERE p.status IN ('starting','running','stopping')")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Lifecycle intent is committed with the authorized domain transition. The
/// scheduler reaches the exact live cancellation handle, never a stored PID.
pub(crate) fn request_team(db: &Database, team: &str, reason: &str, now: i64) -> Result<()> {
    db.conn().execute("UPDATE background_service_ownership SET stop_reason=COALESCE(stop_reason,?2),stop_requested_at=COALESCE(stop_requested_at,?3) WHERE team_session_id=?1 AND process_id IN (SELECT id FROM background_processes WHERE status IN ('starting','running','stopping'))",
        params![team,reason,now])?;
    Ok(())
}

fn substantive_activity(db: &Database, team: &str) -> Result<bool> {
    Ok(db.conn().query_row("SELECT
      EXISTS(SELECT 1 FROM turns WHERE status='running' AND (session_id=?1 OR session_id IN (SELECT member_session_id FROM team_members WHERE team_session_id=?1)))
      OR EXISTS(SELECT 1 FROM turn_queue WHERE session_id=?1 OR session_id IN (SELECT member_session_id FROM team_members WHERE team_session_id=?1))
      OR EXISTS(SELECT 1 FROM session_collaboration_messages WHERE plugin_id=?2 AND kind='message' AND status IN ('queued','running'))
      OR EXISTS(SELECT 1 FROM team_tasks WHERE team_session_id=?1 AND deleted=0 AND status IN ('pending','in_progress'))",
        params![team,team::team_plugin_origin(team)], |row|row.get(0))?)
}

pub(super) fn reason(db: &Database, id: &str, now: i64) -> Result<Option<StopRequest>> {
    let (session,workspace,team,run,deadline,stored_reason,requested): (String,Option<String>,String,String,i64,Option<String>,Option<i64>) = db.conn().query_row(
        "SELECT p.session_id,s.owner_project_path,s.team_session_id,s.team_run_id,s.deadline_at,s.stop_reason,s.stop_requested_at FROM background_service_ownership s JOIN background_processes p ON p.id=s.process_id WHERE s.process_id=?1",
        [id], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))?;
    if let Some(reason) = stored_reason {
        return Ok(Some(StopRequest {
            reason,
            at: requested.unwrap_or(now),
        }));
    }
    let roster = team::get_team(db, &team)?;
    let current_run = team::run_limits::state(db, &team)?;
    let actor_member = team::get_team_member_by_session_id(db, &session)?;
    let launch_aborted: bool = db.conn().query_row("SELECT EXISTS(SELECT 1 FROM turns t JOIN background_service_ownership s ON s.launch_turn_id=t.id WHERE s.process_id=?1 AND t.status='aborted')", [id], |r|r.get(0))?;
    let owner_workspace: Option<String> = db
        .conn()
        .query_row(
            "SELECT p.path FROM sessions s LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=?1",
            [&session],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    // Goal terminal state is authoritative; an expert's own completed turn is not.
    let goal_state: Option<String> = db.conn().query_row("SELECT a.execution_state FROM plan_approvals a JOIN background_service_ownership s ON s.goal_execution_id=a.execution_id WHERE s.process_id=?1", [id], |r|r.get(0)).optional()?;
    let reason = if launch_aborted {
        Some("owner_cancelled")
    } else if roster.is_none() {
        Some("team_ended")
    } else if roster.is_some_and(|team| team.paused) {
        Some("team_paused")
    } else if current_run.is_none_or(|current| current.run_id != run) {
        Some("run_replaced")
    } else if session != team
        && (actor_member.is_none_or(|member| member.team_session_id != team)
            || team::replacements::replaced(db, &team, &session)?)
    {
        Some("member_removed")
    } else if owner_workspace != workspace {
        Some("owner_workspace_changed")
    } else if goal_state
        .as_deref()
        .is_some_and(|state| matches!(state, "completed" | "failed" | "cancelled" | "interrupted"))
    {
        Some("goal_ended")
    } else if now >= deadline {
        Some("ttl_expired")
    } else if !substantive_activity(db, &team)? {
        Some("team_ended")
    } else {
        None
    };
    Ok(reason.map(|reason| StopRequest {
        reason: reason.into(),
        at: now,
    }))
}

pub(crate) fn sweep(st: &AppState, now: i64) -> Result<()> {
    let mut failure = None;
    for id in active_ids(&st.db)? {
        match reason(&st.db, &id, now) {
            Ok(Some(request)) => {
                if let Err(error) = request_stop(st, &id, &request.reason, request.at) {
                    failure.get_or_insert(error);
                }
            }
            Ok(None) => (),
            Err(error) => {
                failure.get_or_insert(error);
            }
        }
    }
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
