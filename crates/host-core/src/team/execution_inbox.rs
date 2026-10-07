//! Incoming Team mail consumed by the original approved Lead execution.
//! Consumption is recorded separately: the user execution must never acquire
//! mailbox provenance or become the settlement owner of multiple messages.
use super::{TeamLaunchReview, TeamMessage};
use crate::{db::Database, sessions};
use anyhow::{anyhow, Result};
use rusqlite::params;
use serde::Serialize;
const INBOX_NS: &str = "team-execution-inbox-v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadExecutionState {
    pub active: bool,
    pub turn_id: Option<String>,
    pub review_status: Option<String>,
}

fn active_review(
    db: &Database,
    team: &str,
    caller: &str,
    expected: &str,
) -> Result<Option<TeamLaunchReview>> {
    super::validate_team_lead(db, team)?;
    if caller != team {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the Lead may read execution inbox"
        ));
    }
    if sessions::running_turn_id(db, team)?.as_deref() != Some(expected)
        || !super::authority::review_belongs_to_current_scope(db, team, expected)?
    {
        return Ok(None);
    }
    // A still-running approval row cannot authorize a subsequent ordinary turn.
    // Both execution kinds require the trusted dispatcher's exact turn proof.
    let approved: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM plan_approvals p WHERE p.session_id=?1
         AND p.status='approved' AND p.execution_state='running'
         AND ((COALESCE(p.execution_kind,p.kind)='plan' AND EXISTS(
           SELECT 1 FROM kv k WHERE k.ns=?3 AND k.key=p.execution_id
             AND json_extract(k.value_json,'$.sessionId')=?1
             AND json_extract(k.value_json,'$.turnId')=?2)) OR EXISTS(
           SELECT 1 FROM goal_reports r WHERE r.execution_id=p.execution_id AND r.turn_id=?2)))",
        params![team, expected, crate::plans::EXECUTION_TURN_NS],
        |r| r.get(0),
    )?;
    if !approved {
        return Ok(None);
    }
    Ok(super::get_launch_review(db, team, None)?.filter(|review| {
        review.lead_turn_id == expected
            && review.launch_policy.as_deref().unwrap_or("user_confirmed") == "user_confirmed"
            && review.strategy.as_deref().unwrap_or("delegate") == "delegate"
            && !review.members.is_empty()
    }))
}

pub fn state(
    db: &Database,
    team: &str,
    caller: &str,
    expected: &str,
) -> Result<LeadExecutionState> {
    let review = active_review(db, team, caller, expected)?;
    Ok(LeadExecutionState {
        active: review.is_some(),
        turn_id: review.as_ref().map(|_| expected.into()),
        review_status: review.map(|r| r.status),
    })
}

pub fn read(db: &Database, team: &str, caller: &str, expected: &str) -> Result<Vec<TeamMessage>> {
    let review = active_review(db, team, caller, expected)?
        .ok_or_else(|| anyhow!("TEAM_PLANNING_STALE: approved execution turn changed"))?;
    if review.status != "confirmed" {
        return Ok(vec![]);
    }
    super::authority::require_confirmed_strategy(db, team)?;
    let decision = super::get_execution_decision(db, team, expected)?
        .ok_or_else(|| anyhow!("TEAM_APPROVAL_REQUIRED: current execution decision missing"))?;
    let key = format!("{team}:{expected}");
    let mut consumed: Vec<String> = db
        .kv_get(INBOX_NS, &key)?
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let messages = super::list_member_messages(db, team, team)?;
    let tx = db.conn().unchecked_transaction()?;
    for message in &messages {
        if message.target_session_id != team
            || message.turn_id.is_some()
            || message.status != "queued"
        {
            continue;
        }
        let confirmation: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM session_collaboration_messages WHERE id=?1 AND idempotency_key=?2)",
            params![message.id, format!("team-review:{}:confirmed", review.review_id)], |r| r.get(0))?;
        if !(confirmation && decision.message_ids.contains(&message.id))
            && !current_expert_result(db, &decision, message)?
        {
            continue;
        }
        tx.execute("UPDATE session_collaboration_messages SET status='completed', updated_at=?2 WHERE id=?1 AND status='queued' AND turn_id IS NULL", params![message.id, crate::db::now_ms()])?;
        // Any durable receipt left by pre-consumption recovery is retired here;
        // Main removes its corresponding live queue entry on the notification.
        tx.execute(
            "DELETE FROM turn_queue WHERE session_message_id=?1 AND session_id=?2",
            params![message.id, team],
        )?;
        consumed.push(message.id.clone());
    }
    tx.execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(ns,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        params![INBOX_NS, key, serde_json::to_string(&consumed)?, crate::db::now_ms()])?;
    tx.commit()?;
    Ok(messages
        .into_iter()
        .filter(|m| consumed.contains(&m.id))
        .map(|mut m| {
            m.status = "completed".into();
            m.delivery_status = "completed".into();
            m
        })
        .collect())
}

/// An approved execution cannot complete while its experts or incoming results
/// still belong to it. Participation alone only grants substantive tools.
pub(super) fn require_settled(
    db: &Database,
    decision: &super::TeamExecutionDecision,
) -> Result<()> {
    for dispatch in &decision.message_ids {
        let pending: bool = db.conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM session_collaboration_messages m
             LEFT JOIN turns t ON t.id=m.turn_id AND t.session_id=m.target_session_id
             WHERE m.id=?1 AND m.source_session_id=?2 AND m.target_session_id<>?2
             AND (m.status='queued' OR t.status='running'))",
            params![dispatch, decision.team_session_id],
            |r| r.get(0),
        )?;
        if pending {
            return Err(anyhow!("TEAM_APPROVAL_REQUIRED: await assigned experts and consume their full results with wait_for_updates before completing approved execution"));
        }
    }
    for message in
        super::list_member_messages(db, &decision.team_session_id, &decision.team_session_id)?
    {
        if message.status == "queued" && current_expert_result(db, decision, &message)? {
            return Err(anyhow!("TEAM_APPROVAL_REQUIRED: consume the current approved experts' full results with wait_for_updates"));
        }
    }
    Ok(())
}
fn current_expert_result(
    db: &Database,
    decision: &super::TeamExecutionDecision,
    message: &TeamMessage,
) -> Result<bool> {
    if message.target_session_id != decision.team_session_id
        || !decision
            .member_session_ids
            .contains(&message.source_session_id)
    {
        return Ok(false);
    }
    let source = db
        .kv_get("team-message-source-turn-v1", &message.id)?
        .and_then(|v| v.as_str().map(str::to_owned));
    let Some(source) = source else {
        return Ok(false);
    };
    for dispatch in &decision.message_ids {
        let matches: bool = db.conn().query_row("SELECT EXISTS(SELECT 1 FROM session_collaboration_messages m JOIN turns t ON t.id=m.turn_id AND t.session_id=m.target_session_id
            WHERE m.id=?1 AND m.turn_id=?2 AND m.source_session_id=?3 AND m.target_session_id=?4 AND t.status IN ('running','completed'))",
            params![dispatch, source, decision.team_session_id, message.source_session_id], |r|r.get(0))?;
        if matches {
            return Ok(true);
        }
    }
    Ok(false)
}
