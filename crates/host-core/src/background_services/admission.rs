use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::{db::Database, session_collaboration::permissions, sessions, team};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LaunchScope {
    pub team_session_id: String,
    pub team_run_id: String,
    pub turn_id: String,
    pub permission_ceiling: String,
}

fn rank(mode: &str) -> u8 {
    match mode {
        "auto" => 2,
        "accept-edits" => 1,
        _ => 0,
    }
}

pub(crate) fn capture(
    db: &Database,
    session: &str,
    turn: Option<&str>,
    args: &Value,
    timeout_ms: Option<u64>,
    permission_scope: Option<&str>,
) -> Result<Option<LaunchScope>> {
    match args.get("backgroundKind") {
        None | Some(Value::String(_))
            if args
                .get("backgroundKind")
                .is_none_or(|kind| kind == "command") =>
        {
            return Ok(None)
        }
        Some(Value::String(kind)) if kind == "service" => (),
        _ => {
            return Err(anyhow!(
                "INVALID_PARAMS: backgroundKind must be command or service"
            ))
        }
    }
    if args.get("run_in_background").and_then(Value::as_bool) != Some(true) {
        return Err(anyhow!(
            "INVALID_PARAMS: service requires run_in_background=true"
        ));
    }
    if timeout_ms.is_some() || args.get("timeout").is_some() {
        return Err(anyhow!("INVALID_PARAMS: service has a Host-owned 6-hour TTL; use backgroundKind=command with timeout for a finite custom deadline"));
    }
    let turn = turn.ok_or_else(|| {
        anyhow!("TEAM_SERVICE_UNAUTHORIZED: service requires an active Agent turn")
    })?;
    let live: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND session_id=?2 AND status='running')",
        params![turn, session],
        |r| r.get(0),
    )?;
    if !live || sessions::session_mode(db, session)?.as_deref() != Some("agent") {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: service requires an active Agent turn"
        ));
    }
    let member = team::get_team_member_by_session_id(db, session)?;
    let team_id = member
        .as_ref()
        .map(|member| member.team_session_id.as_str())
        .unwrap_or(session);
    let roster = team::get_team(db, team_id)?.ok_or_else(|| {
        anyhow!("TEAM_SERVICE_UNAUTHORIZED: service requires an authenticated Team")
    })?;
    if roster.paused || sessions::session_mode(db, team_id)?.as_deref() != Some("agent") {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: service requires an unpaused Agent Team"
        ));
    }
    if team::planning::purpose(db, session)?
        .is_some_and(|purpose| purpose.work_purpose == "plan_research")
    {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: research members cannot launch services"
        ));
    }
    let budget = team::run_limits::state(db, team_id)?
        .ok_or_else(|| anyhow!("TEAM_SERVICE_UNAUTHORIZED: service requires a current Team run"))?;
    if budget.hard_reached_at.is_some()
        || !team::authority::review_belongs_to_current_scope(db, team_id, &budget.run_id)?
    {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: service run is no longer current"
        ));
    }
    let decision = team::get_execution_decision(db, team_id, &budget.run_id)?.ok_or_else(|| {
        anyhow!("TEAM_APPROVAL_REQUIRED: service requires a confirmed Team strategy")
    })?;
    let review_id = decision
        .review_ids
        .as_ref()
        .and_then(|ids| ids.last())
        .ok_or_else(|| {
            anyhow!("TEAM_APPROVAL_REQUIRED: service requires a confirmed Team review")
        })?;
    let review = team::get_launch_review(db, team_id, Some(review_id))?
        .ok_or_else(|| anyhow!("TEAM_APPROVAL_REQUIRED: service review is missing"))?;
    if review.status != "confirmed"
        || review.launch_policy.as_deref().unwrap_or("user_confirmed") != "user_confirmed"
        || review.lead_turn_id != budget.run_id
        || review.strategy != decision.strategy
    {
        return Err(anyhow!(
            "TEAM_APPROVAL_REQUIRED: service review is not confirmed for this run"
        ));
    }
    if member.is_some() {
        if !decision.member_session_ids.iter().any(|id| id == session) {
            return Err(anyhow!(
                "TEAM_SERVICE_UNAUTHORIZED: member is not authorized for the current run"
            ));
        }
        if team::replacements::replaced(db, team_id, session)? {
            return Err(anyhow!(
                "TEAM_SERVICE_UNAUTHORIZED: replaced members cannot launch services"
            ));
        }
        let selected = decision
            .member_session_ids
            .iter()
            .position(|id| id == session)
            .and_then(|index| review.members.get(index));
        let actor = sessions::get_session(db, session)?
            .ok_or_else(|| anyhow!("TEAM_SERVICE_UNAUTHORIZED: service owner missing"))?;
        if selected.is_some_and(|selected| {
            actor.summary.provider_id.as_deref() != Some(selected.selection.provider_id.as_str())
                || actor.summary.model_id.as_deref() != Some(selected.selection.model_id.as_str())
                || actor.summary.thinking_level != selected.selection.thinking_level
        }) {
            return Err(anyhow!("TEAM_SERVICE_UNAUTHORIZED: service owner's route no longer matches the current confirmed review"));
        }
        if selected.is_none() {
            // Host successor links extend immutable review slots; reuse their
            // canonical route and permission checks without historical reapproval.
            team::review::gate_team_member_turn(db, session, None, None)?;
        }
    } else {
        team::authority::validate_lead_tool(db, session, "Bash")?;
    }
    let mut ceiling = permissions::effective_mode(db, session)?;
    let message_ceiling: Option<String> = db.conn().query_row("SELECT permission_ceiling FROM session_collaboration_messages WHERE turn_id=?1 AND target_session_id=?2 AND kind='message' ORDER BY CASE permission_ceiling WHEN 'ask' THEN 0 WHEN 'accept-edits' THEN 1 ELSE 2 END LIMIT 1", params![turn,session], |row|row.get(0)).optional()?;
    if let Some(message_ceiling) = message_ceiling {
        if rank(&message_ceiling) < rank(&ceiling) {
            ceiling = message_ceiling;
        }
    }
    if permission_scope.is_some_and(|mode| {
        !sessions::is_valid_permission_mode(mode)
            || mode == "inherit"
            || rank(mode) > rank(&ceiling)
    }) {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: service permission scope exceeds the current turn ceiling"
        ));
    }
    if let Some(scope) = permission_scope {
        if rank(scope) < rank(&ceiling) {
            ceiling = scope.into();
        }
    }
    Ok(Some(LaunchScope {
        team_session_id: team_id.into(),
        team_run_id: budget.run_id,
        turn_id: turn.into(),
        permission_ceiling: ceiling,
    }))
}

/// Check again after permission/FIFO waits, under the same Host lock as insertion.
pub(crate) fn revalidate(
    db: &Database,
    session: &str,
    scope: &LaunchScope,
    args: &Value,
) -> Result<()> {
    let current = capture(
        db,
        session,
        Some(&scope.turn_id),
        args,
        None,
        Some(&scope.permission_ceiling),
    )?
    .ok_or_else(|| anyhow!("TEAM_SERVICE_UNAUTHORIZED: service declaration changed"))?;
    if current != *scope {
        return Err(anyhow!(
            "TEAM_SERVICE_UNAUTHORIZED: service authorization changed while waiting"
        ));
    }
    let (host,team,owner): (i64,i64,i64) = db.conn().query_row("SELECT COUNT(*),COALESCE(SUM(s.team_session_id=?1),0),COALESCE(SUM(p.session_id=?2),0) FROM background_service_ownership s JOIN background_processes p ON p.id=s.process_id WHERE p.status IN ('starting','running','stopping')",
        params![scope.team_session_id,session], |row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
    if host >= 2 || team >= 1 || owner >= 1 {
        return Err(anyhow!("TEAM_SERVICE_LIMIT_REACHED: at most 2 Host services, 1 per Team and 1 per session; services also hold the existing tool and shell permit"));
    }
    Ok(())
}
