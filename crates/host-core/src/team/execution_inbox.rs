//! Incoming Team mail consumed by the original approved Lead execution.
//! Consumption is recorded separately: the user execution must never acquire
//! mailbox provenance or become the settlement owner of multiple messages.
use super::{TeamLaunchReview, TeamMessage};
use crate::{db::Database, sessions};
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
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
    let first = crate::goal_holds::active_resume_scope(db, team)?;
    let scope = first.as_deref().unwrap_or(expected);
    if sessions::running_turn_id(db, team)?.as_deref() != Some(expected)
        || !super::authority::review_belongs_to_current_scope(db, team, scope)?
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
    let review_id = if first.is_some() {
        super::get_execution_decision(db, team, scope)?
            .and_then(|decision| decision.review_ids.and_then(|ids| ids.last().cloned()))
    } else {
        None
    };
    if first.is_some() && review_id.is_none() {
        return Ok(None);
    }
    Ok(
        super::get_launch_review(db, team, review_id.as_deref())?.filter(|review| {
            review.lead_turn_id == scope
                && review.launch_policy.as_deref().unwrap_or("user_confirmed") == "user_confirmed"
                && review.strategy.as_deref().unwrap_or("delegate") == "delegate"
                && !review.members.is_empty()
        }),
    )
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

/// Called inside task creation's savepoint so undispatched Lead work has the
/// same exact execution identity as dispatched work, without timestamp inference.
pub(super) fn enrol_task(db: &Database, team: &str, caller: &str, task: &str) -> Result<()> {
    if caller != team {
        return Ok(());
    }
    let Some(turn) = sessions::running_turn_id(db, team)? else {
        return Ok(());
    };
    let Some(review) = active_review(db, team, team, &turn)? else {
        return Ok(());
    };
    let scope = review.lead_turn_id;
    let mut decision = super::get_execution_decision(db, team, &scope)?
        .ok_or_else(|| anyhow!("TEAM_APPROVAL_REQUIRED: current execution decision missing"))?;
    if !decision.task_ids.iter().any(|id| id == task) {
        decision.task_ids.push(task.into());
        decision.updated_at =
            chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        db.kv_set(
            super::TEAM_EXECUTION_DECISION_NS,
            &format!("{team}:{scope}"),
            &serde_json::to_value(decision)?,
        )?;
    }
    Ok(())
}

pub fn read(db: &Database, team: &str, caller: &str, expected: &str) -> Result<Vec<TeamMessage>> {
    let review = active_review(db, team, caller, expected)?
        .ok_or_else(|| anyhow!("TEAM_PLANNING_STALE: approved execution turn changed"))?;
    if review.status != "confirmed" {
        return Ok(vec![]);
    }
    super::authority::require_confirmed_strategy(db, team)?;
    let decision = super::get_execution_decision(db, team, &review.lead_turn_id)?
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
            && !super::run_limits::is_soft_notice(db, team, &message.id)?
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

/// An approved execution cannot complete while its tasks, experts or incoming
/// results still belong to it. Participation alone only grants substantive tools.
pub(crate) fn require_settled(
    db: &Database,
    decision: &super::TeamExecutionDecision,
) -> Result<()> {
    let tasks = super::list_team_tasks(db, &decision.team_session_id)?;
    let open_tasks = open_decision_tasks(db, decision)?
        .iter()
        .map(|task| {
            format!(
                "{} ({})",
                task.owner_member_name
                    .as_deref()
                    .or(task.owner_session_id.as_deref())
                    .unwrap_or("unassigned"),
                task.task_id
            )
        })
        .collect::<Vec<_>>();
    let describe = |member: &str, session: &str| {
        let owned = tasks
            .iter()
            .filter(|task| {
                task.owner_session_id.as_deref() == Some(session)
                    && matches!(task.status.as_str(), "pending" | "in_progress")
            })
            .map(|task| task.task_id.as_str())
            .collect::<Vec<_>>();
        if owned.is_empty() {
            member.to_owned()
        } else {
            format!("{member} (tasks {})", owned.join(", "))
        }
    };
    let mut pending = Vec::new();
    for dispatch in &decision.message_ids {
        let row: Option<(String, String, String)> = db.conn().query_row(
            "SELECT COALESCE(member.name,m.target_session_id), m.target_session_id,
                    CASE WHEN t.status='running' THEN 'running' ELSE 'queued' END
             FROM session_collaboration_messages m
             LEFT JOIN turns t ON t.id=m.turn_id AND t.session_id=m.target_session_id
             LEFT JOIN team_members member ON member.team_session_id=?2 AND member.member_session_id=m.target_session_id
             WHERE m.id=?1 AND m.source_session_id=?2 AND m.target_session_id<>?2
             AND (m.status='queued' OR t.status='running')",
            params![dispatch, decision.team_session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional()?;
        if let Some((member, session, status)) = row {
            pending.push(format!(
                "{dispatch} {status}: {}",
                describe(&member, &session)
            ));
        }
    }
    let mut unconsumed = Vec::new();
    for message in
        super::list_member_messages(db, &decision.team_session_id, &decision.team_session_id)?
    {
        if message.status == "queued" && current_expert_result(db, decision, &message)? {
            unconsumed.push(format!(
                "{}: {}",
                message.id,
                describe(&message.source_member_name, &message.source_session_id)
            ));
        }
    }
    if !pending.is_empty() || !unconsumed.is_empty() || !open_tasks.is_empty() {
        return Err(anyhow!("TEAM_APPROVAL_REQUIRED: pending dispatches [{}]; {} unconsumed expert results [{}]; open decision tasks [{}]; await assigned experts and consume their full results with wait_for_updates before completing approved execution. Dispatch open tasks with send_message, or use task_update to mark them cancelled/failed with a reason, then retry",
            pending.join("; "), unconsumed.len(), unconsumed.join("; "), open_tasks.join("; ")));
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
            WHERE m.id=?1 AND m.turn_id=?2 AND m.source_session_id=?3 AND m.target_session_id=?4 AND (t.status IN ('running','completed') OR (t.status='error' AND EXISTS(
              SELECT 1 FROM kv k WHERE k.ns=?5 AND k.key=?6 AND json_extract(k.value_json,'$')=t.id))))",
            params![dispatch, source, decision.team_session_id, message.source_session_id, super::member_failure::PROOF_NS, message.id], |r|r.get(0))?;
        if matches {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(crate) fn open_decision_tasks(
    db: &Database,
    decision: &super::TeamExecutionDecision,
) -> Result<Vec<super::TeamTask>> {
    Ok(super::list_team_tasks(db, &decision.team_session_id)?
        .into_iter()
        .filter(|task| {
            !task.deleted
                && decision.task_ids.contains(&task.task_id)
                && matches!(task.status.as_str(), "pending" | "in_progress")
        })
        .collect())
}
