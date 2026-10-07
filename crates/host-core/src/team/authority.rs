//! User-approved Team strategy authority. A normal user turn starts a new
//! scope; only Host-bound Team mailbox continuations inherit that scope.
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};

use super::{get_execution_decision, get_latest_execution_decision, get_launch_review};
use crate::{db::Database, sessions};

pub(crate) const SCOPE_NS: &str = "team-strategy-scope-v1";

pub(crate) fn record_user_turn(db: &Database, session: &str, turn: &str) -> Result<()> {
    if sessions::session_execution_profile(db, session)?.as_deref() == Some("team")
        && super::get_team_member_by_session_id(db, session)?.is_none()
    {
        db.kv_set(SCOPE_NS, session, &serde_json::json!(turn))?;
    }
    Ok(())
}

pub(crate) fn review_belongs_to_current_scope(
    db: &Database,
    team: &str,
    turn: &str,
) -> Result<bool> {
    Ok(db
        .kv_get(SCOPE_NS, team)?
        .and_then(|v| v.as_str().map(str::to_owned))
        .as_deref()
        == Some(turn))
}

pub(crate) fn validate_review_scope(db: &Database, team: &str, turn: &str) -> Result<()> {
    if !review_belongs_to_current_scope(db, team, turn)? {
        return Err(anyhow!(
            "TEAM_REVIEW_REVISION_CONFLICT: review does not belong to the current user turn"
        ));
    }
    Ok(())
}

/// Read-only discovery and review coordination remain usable before consent.
/// Unknown tools fail closed, including plugin and extension tools.
pub(crate) fn validate_lead_tool(db: &Database, session: &str, tool: &str) -> Result<()> {
    if sessions::session_execution_profile(db, session)?.as_deref() != Some("team")
        || super::get_team_member_by_session_id(db, session)?.is_some()
    {
        return Ok(());
    }
    // Goal keeps its existing negotiation contract; it has no Team strategy
    // declaration tool. Approval switches it to Agent, where consent applies.
    if !matches!(
        sessions::session_mode(db, session)?.as_deref(),
        Some("agent" | "plan")
    ) {
        return Ok(());
    }
    if matches!(
        tool,
        "Read"
            | "Glob"
            | "Grep"
            | "ToolSearch"
            | "AskUserQuestion"
            | "asktool"
            | "declare_team_strategy"
            | "team_status"
            | "task_list"
            | "task_get"
            | "wait_for_updates"
            | "interrupt_agent"
            | "EnterPlanMode"
            | "new_context"
    ) {
        return Ok(());
    }
    let decision = current_confirmed_decision(db, session)?;
    if matches!(
        tool,
        "spawn_teammate" | "task_create" | "task_update" | "send_message"
    ) {
        return Ok(());
    }
    require_expert_participation(db, &decision)
}

pub(crate) fn require_confirmed_strategy(db: &Database, team: &str) -> Result<()> {
    current_confirmed_decision(db, team).map(|_| ())
}

fn current_confirmed_decision(db: &Database, team: &str) -> Result<super::TeamExecutionDecision> {
    let deny = || {
        anyhow!(
            "TEAM_APPROVAL_REQUIRED: user confirmation of this turn's Team strategy is required"
        )
    };
    let Some(scope) = db
        .kv_get(SCOPE_NS, team)?
        .and_then(|v| v.as_str().map(str::to_owned))
    else {
        return Err(deny());
    };
    let Some(turn) = db
        .conn()
        .query_row(
            "SELECT id FROM turns WHERE session_id=?1 AND status='running'",
            [team],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    else {
        return Err(deny());
    };
    let direct = get_execution_decision(db, team, &turn)?;
    let decision = match direct {
        Some(decision) if decision.lead_turn_id == scope => decision,
        Some(_) => return Err(deny()),
        None => get_latest_execution_decision(db, team)?.ok_or_else(deny)?,
    };
    if decision.lead_turn_id != scope {
        return Err(deny());
    }
    let review_id = decision
        .review_ids
        .as_ref()
        .and_then(|ids| ids.last())
        .ok_or_else(deny)?;
    let review = get_launch_review(db, team, Some(review_id))?.ok_or_else(deny)?;
    let strategy = review.strategy.as_deref().unwrap_or("delegate");
    let expected_policy = if sessions::session_mode(db, team)?.as_deref() == Some("plan") {
        "automatic_plan"
    } else {
        "user_confirmed"
    };
    if review.launch_policy.as_deref().unwrap_or("user_confirmed") != expected_policy
        || review.status != "confirmed"
        || review.lead_turn_id != scope
        || decision.strategy.as_deref() != Some("delegate")
        || strategy != "delegate"
        || review.members.is_empty()
        || decision.member_session_ids.is_empty()
    {
        return Err(deny());
    }
    if turn == scope {
        return Ok(decision);
    }
    // A model cannot manufacture a continuation by supplying content or an
    // idempotency key: it must be the actual durable message bound to this turn.
    let message: Option<(String, String, String)> = db
        .conn()
        .query_row(
            "SELECT id, source_session_id, idempotency_key FROM session_collaboration_messages
         WHERE turn_id=?1 AND plugin_id=?2 AND target_session_id=?3
           AND kind='message' AND status='running'",
            params![turn, super::team_plugin_origin(team), team],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((message_id, source, key)) = message else {
        return Err(deny());
    };
    let confirmation = decision.message_ids.contains(&message_id)
        && key == format!("team-review:{review_id}:confirmed");
    if confirmation || decision.member_session_ids.contains(&source) {
        return Ok(decision);
    }
    Err(deny())
}

/// Do not turn an already approved mailbox continuation into another review.
pub(crate) fn reject_approved_continuation(db: &Database, team: &str, turn: &str) -> Result<()> {
    let scope = db
        .kv_get(SCOPE_NS, team)?
        .and_then(|v| v.as_str().map(str::to_owned));
    if scope.as_deref() == Some(turn) || !super::review::is_live_team_mail_turn(db, team, team)? {
        return Ok(());
    }
    let current: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND session_id=?2 AND status='running')",
        params![turn, team],
        |row| row.get(0),
    )?;
    if !current {
        return Ok(());
    }
    match require_confirmed_strategy(db, team) {
        Ok(()) => Err(anyhow!("TEAM_REVIEW_REVISION_CONFLICT: approved strategy already covers this continuation; continue authorized work without redeclaration")),
        Err(error) if error.to_string().starts_with("TEAM_APPROVAL_REQUIRED:") => Ok(()),
        Err(error) => Err(error),
    }
}

/// Only the current approved delegate roster permits expert dispatch or
/// assignment. Historical solo strategies and prior rosters never authorize it.
pub(crate) fn validate_current_expert(db: &Database, team: &str, target: &str) -> Result<()> {
    let decision = current_confirmed_decision(db, team)?;
    let member = match super::get_team_member_by_name(db, team, target)? {
        Some(member) => Some(member),
        None => super::get_team_member_by_session_id(db, target)?,
    };
    if decision.strategy.as_deref() == Some("delegate")
        && member.is_some_and(|member| {
            member.team_session_id == team
                && decision
                    .member_session_ids
                    .contains(&member.member_session_id)
        })
    {
        return Ok(());
    }
    Err(anyhow!(
        "TEAM_APPROVAL_REQUIRED: expert is not approved by this turn's delegate review"
    ))
}

pub(crate) fn record_dispatch(
    db: &Database,
    team: &str,
    message: &super::TeamMessage,
    existed: bool,
) -> Result<()> {
    let mut decision = current_confirmed_decision(db, team)?;
    if decision.message_ids.contains(&message.id) {
        return Ok(());
    }
    if existed
        || message.source_session_id != team
        || !decision
            .member_session_ids
            .contains(&message.target_session_id)
        || message.turn_id.is_some()
        || message.status != "queued"
    {
        return Err(anyhow!(
            "TEAM_APPROVAL_REQUIRED: dispatch must originate in the current approved expert scope"
        ));
    }
    decision.message_ids.push(message.id.clone());
    decision.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    db.kv_set(
        super::TEAM_EXECUTION_DECISION_NS,
        &format!("{team}:{}", decision.lead_turn_id),
        &serde_json::to_value(&decision)?,
    )?;
    Ok(())
}

fn require_expert_participation(
    db: &Database,
    decision: &super::TeamExecutionDecision,
) -> Result<()> {
    for message_id in &decision.message_ids {
        let participant: Option<String> = db
            .conn()
            .query_row(
                "SELECT m.target_session_id FROM session_collaboration_messages m
             JOIN turns t ON t.id=m.turn_id AND t.session_id=m.target_session_id
             WHERE m.id=?1 AND m.plugin_id=?2 AND m.source_session_id=?3 AND m.kind='message'
               AND m.status IN ('running','completed') AND t.status IN ('running','completed')",
                params![
                    message_id,
                    super::team_plugin_origin(&decision.team_session_id),
                    decision.team_session_id
                ],
                |row| row.get(0),
            )
            .optional()?;
        if participant.is_some_and(|member| decision.member_session_ids.contains(&member)) {
            return Ok(());
        }
    }
    Err(anyhow!("TEAM_APPROVAL_REQUIRED: dispatch an approved expert and wait for its turn to start before substantive Lead work"))
}
