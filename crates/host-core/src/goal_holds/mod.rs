//! Durable, resumable Goal holds. Upstream execution encoding remains interrupted.
use crate::{
    audit,
    db::{now_ms, Database},
    goal_reports,
    plans::{self, PlanExecution},
};
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
mod evaluate;
#[cfg(test)]
pub(crate) mod tests;
pub(crate) const SCHEMA: &str = include_str!("schema.sql");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalSegment {
    pub turn_id: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoalBlock {
    pub at: i64,
    pub reasons: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoalHold {
    pub execution_id: String,
    pub session_id: String,
    pub state: String,
    pub reasons: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_turn_id: Option<String>,
    pub segments: Vec<GoalSegment>,
    pub blocks: Vec<GoalBlock>,
    pub resume_count: i64,
    pub paused_team: bool,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<crate::goal_progress::GoalProgressSnapshot>,
}

pub(crate) fn execution(db: &Database, execution_id: &str) -> Result<PlanExecution> {
    let query = format!(
        "SELECT {} FROM plan_approvals WHERE execution_id=?1",
        plans::PROPOSAL_COLUMNS
    );
    let proposal = db
        .conn()
        .query_row(&query, [execution_id], plans::proposal_from_row)
        .optional()?
        .ok_or_else(|| anyhow!("NOT_FOUND: goal execution not found"))?;
    let execution = plans::execution_from_proposal(&proposal)?
        .ok_or_else(|| anyhow!("NOT_FOUND: execution descriptor missing"))?;
    if execution.kind != "goal" {
        return Err(anyhow!("INVALID_ARGUMENT: execution is not a goal"));
    }
    Ok(execution)
}
fn owned_execution(db: &Database, session: &str, id: &str) -> Result<PlanExecution> {
    let execution = execution(db, id)?;
    if execution.session_id != session {
        return Err(anyhow!(
            "PERMISSION_DENIED: goal belongs to another session"
        ));
    }
    Ok(execution)
}

pub fn get_hold(db: &Database, session: &str, id: &str) -> Result<Option<GoalHold>> {
    let raw = db.conn().query_row("SELECT state,reasons_json,first_turn_id,segments_json,blocks_json,resume_count,paused_team,version,created_at,updated_at FROM goal_execution_holds WHERE execution_id=?1 AND session_id=?2", params![id,session], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,i64>(5)?,row.get::<_,bool>(6)?,row.get::<_,i64>(7)?,row.get::<_,i64>(8)?,row.get::<_,i64>(9)?))).optional()?;
    raw.map(|row| {
        Ok(GoalHold {
            execution_id: id.into(),
            session_id: session.into(),
            state: row.0,
            reasons: serde_json::from_str(&row.1)?,
            first_turn_id: row.2,
            segments: serde_json::from_str(&row.3)?,
            blocks: serde_json::from_str(&row.4)?,
            resume_count: row.5,
            paused_team: row.6,
            version: row.7,
            created_at: row.8,
            updated_at: row.9,
            draft: goal_reports::current_draft(db, id).ok().flatten(),
            progress: crate::goal_progress::get_progress(db, Some(session), id)?,
        })
    })
    .transpose()
}

pub fn get(db: &Database, session: &str, id: Option<&str>) -> Result<Value> {
    let selected = match id {
        Some(id) => Some(id.to_owned()),
        None => db.conn().query_row("SELECT execution_id FROM goal_execution_holds WHERE session_id=?1 AND state='blocked' ORDER BY updated_at DESC,execution_id LIMIT 1",[session],|row| row.get::<_,String>(0)).optional()?,
    };
    let Some(id) = selected else {
        return Ok(json!({}));
    };
    let mut execution = owned_execution(db, session, &id)?;
    let hold = get_hold(db, session, &id)?;
    execution.hold = hold.clone();
    let mut result = json!({"execution":execution});
    if let Some(hold) = hold {
        result["hold"] = json!(hold);
    }
    Ok(result)
}

fn append_segment(db: &Database, hold: &mut GoalHold, turn: &str, ended: bool) -> Result<()> {
    let timing: Option<(i64, Option<i64>)> = db
        .conn()
        .query_row(
            "SELECT started_at,ended_at FROM turns WHERE id=?1 AND session_id=?2",
            params![turn, hold.session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (started, end) = timing.unwrap_or((now_ms(), None));
    if let Some(segment) = hold
        .segments
        .iter_mut()
        .find(|segment| segment.turn_id == turn)
    {
        if ended {
            segment.ended_at = Some(end.unwrap_or_else(now_ms));
        }
    } else {
        hold.segments.push(GoalSegment {
            turn_id: turn.into(),
            started_at: started,
            ended_at: ended.then(|| end.unwrap_or_else(now_ms)),
        });
    }
    if hold.first_turn_id.is_none() {
        hold.first_turn_id = Some(turn.into());
    }
    Ok(())
}

pub(crate) fn bind_segment(db: &Database, id: &str, turn: &str) -> Result<()> {
    let session: Option<String> = db
        .conn()
        .query_row(
            "SELECT session_id FROM goal_execution_holds WHERE execution_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(session) = session else {
        return Ok(());
    };
    if let Some(mut hold) = get_hold(db, &session, id)? {
        if hold.state != "resumed" {
            return Err(anyhow!("CONFLICT: goal hold is not resumed"));
        }
        append_segment(db, &mut hold, turn, false)?;
        db.conn().execute("UPDATE goal_execution_holds SET first_turn_id=?2,segments_json=?3,updated_at=?4 WHERE execution_id=?1",params![id,hold.first_turn_id,serde_json::to_string(&hold.segments)?,now_ms()])?;
    }
    Ok(())
}

fn stamp_execution(
    tx: &Transaction<'_>,
    id: &str,
    from: &str,
    to: &str,
    code: Option<&str>,
    now: i64,
) -> Result<()> {
    if tx.execute("UPDATE plan_approvals SET execution_state=?3,error_code=?4,updated_at=?5,version=version+1 WHERE execution_id=?1 AND execution_state=?2",params![id,from,to,code,now])?!=1 { return Err(anyhow!("CONFLICT: goal execution changed")); }
    crate::goal_progress::invalidate_write_token_conn(tx, id)?;
    Ok(())
}
fn save_hold(tx: &Transaction<'_>, hold: &GoalHold) -> Result<()> {
    tx.execute("INSERT INTO goal_execution_holds(execution_id,session_id,state,reasons_json,first_turn_id,segments_json,blocks_json,resume_count,paused_team,version,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(execution_id) DO UPDATE SET state=excluded.state,reasons_json=excluded.reasons_json,segments_json=excluded.segments_json,blocks_json=excluded.blocks_json,resume_count=excluded.resume_count,paused_team=excluded.paused_team,version=excluded.version,updated_at=excluded.updated_at",params![hold.execution_id,hold.session_id,hold.state,serde_json::to_string(&hold.reasons)?,hold.first_turn_id,serde_json::to_string(&hold.segments)?,serde_json::to_string(&hold.blocks)?,hold.resume_count,hold.paused_team,hold.version,hold.created_at,hold.updated_at])?;
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct GoalSettlement<'a> {
    pub ended: &'a str,
    pub error_code: Option<&'a str>,
    pub stop_hint: Option<&'a str>,
    pub barrier_failed: bool,
    pub durable_seq: i64,
}

pub fn settle(db: &Database, session: &str, id: &str, input: GoalSettlement<'_>) -> Result<Value> {
    let tx = db.conn().unchecked_transaction()?;
    let result = settle_in_transaction(db, &tx, session, id, input)?;
    tx.commit()?;
    Ok(result)
}

pub(crate) fn settle_in_transaction(
    db: &Database,
    tx: &Transaction<'_>,
    session: &str,
    id: &str,
    input: GoalSettlement<'_>,
) -> Result<Value> {
    let GoalSettlement {
        ended,
        error_code,
        stop_hint,
        barrier_failed,
        durable_seq,
    } = input;
    if !matches!(ended, "agent_stopped" | "errored") {
        return Err(anyhow!(
            "INVALID_ARGUMENT: ended must be agent_stopped or errored"
        ));
    }
    let execution = owned_execution(db, session, id)?;
    // Idempotent settlement cannot alter a blocked, completed, or user-stopped execution.
    if !matches!(execution.state.as_str(), "queued" | "running") {
        return get(db, session, Some(id));
    }
    let mut reasons = evaluate::evaluate(db, id)?;
    if ended == "errored" {
        reasons.push(json!({"code":format!("agent_error:{}",error_code.unwrap_or("UNKNOWN"))}));
    }
    if stop_hint == Some("resume_failed") {
        reasons.push(json!({"code":"resume_failed"}));
    }
    if stop_hint == Some("team_unsettled")
        && !reasons
            .iter()
            .any(|reason| reason["code"] == "team_unsettled")
    {
        reasons.push(json!({"code":"team_unsettled"}));
    }
    let now = now_ms();
    let turn: Option<String> = db
        .conn()
        .query_row(
            "SELECT turn_id FROM goal_reports WHERE execution_id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let mut hold = get_hold(db, session, id)?.unwrap_or(GoalHold {
        execution_id: id.into(),
        session_id: session.into(),
        state: "blocked".into(),
        reasons: vec![],
        first_turn_id: None,
        segments: vec![],
        blocks: vec![],
        resume_count: 0,
        paused_team: false,
        version: 0,
        created_at: now,
        updated_at: now,
        draft: None,
        progress: None,
    });
    if let Some(turn) = &turn {
        append_segment(db, &mut hold, turn, true)?;
    }
    let complete = reasons.is_empty();
    stamp_execution(
        tx,
        id,
        &execution.state,
        if complete { "completed" } else { "interrupted" },
        if complete { None } else { Some("GOAL_BLOCKED") },
        now,
    )?;
    let mut report = None;
    if complete {
        // Retain segment history even though the last hold has been resumed.
        hold.state = "resumed".into();
        hold.version += 1;
        hold.updated_at = now;
        save_hold(tx, &hold)?;
        if barrier_failed {
            report = Some(goal_reports::mark_failed(
                db,
                session,
                id,
                "REPORT_PERSISTENCE_BARRIER_FAILED",
            )?);
        } else {
            report = Some(publication_result(
                db,
                session,
                id,
                goal_reports::finalize_report(db, id, durable_seq, None, None),
            )?);
        }
    } else {
        hold.state = "blocked".into();
        hold.reasons = reasons.clone();
        hold.blocks.push(GoalBlock { at: now, reasons });
        hold.version += 1;
        hold.updated_at = now;
        if let Some(team) = crate::team::get_team(db, session)? {
            if !team.paused {
                crate::team::pause_team(db, session)?;
                hold.paused_team = true;
            }
        }
        save_hold(tx, &hold)?;
        audit::append_tx(
            tx,
            "goal_execution_blocked",
            Some(session),
            json!({"executionId":id,"reasons":hold.reasons}),
        )?;
    }
    if let Some(turn) = turn {
        crate::notifications::insert_for_terminal_turn(
            tx,
            &turn,
            if complete { "completed" } else { "error" },
            if complete { None } else { Some("GOAL_BLOCKED") },
        )?;
    }
    let mut result = get(db, session, Some(id))?;
    if let Some(report) = report {
        result["report"] = json!(report);
    }
    Ok(result)
}

pub fn resume(
    db: &Database,
    session: &str,
    id: &str,
    expected_version: i64,
    model_override: Option<&Value>,
) -> Result<Value> {
    let approved = owned_execution(db, session, id)?;
    let mut hold =
        get_hold(db, session, id)?.ok_or_else(|| anyhow!("CONFLICT: goal is not blocked"))?;
    let tx = db.conn().unchecked_transaction()?;
    let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM goal_execution_holds h JOIN plan_approvals p ON p.execution_id=h.execution_id WHERE h.execution_id=?1 AND h.state='blocked' AND h.version=?2 AND p.execution_state='interrupted' AND p.error_code='GOAL_BLOCKED')",params![id,expected_version],|row|row.get(0))?;
    if !valid {
        return Err(anyhow!("CONFLICT: goal hold changed"));
    }
    if crate::sessions::session_has_running_turn(db,session)? || tx.query_row("SELECT EXISTS(SELECT 1 FROM turns t JOIN team_members m ON m.member_session_id=t.session_id WHERE m.team_session_id=?1 AND t.status='running')",[session],|row|row.get::<_,bool>(0))? || tx.query_row("SELECT EXISTS(SELECT 1 FROM plan_approvals WHERE session_id=?1 AND execution_state IN ('queued','running'))",[session],|row|row.get::<_,bool>(0))? {return Err(anyhow!("CONFLICT: session has active work"));}
    let now = now_ms();
    if let Some(model) = model_override {
        let provider = model
            .get("providerId")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| anyhow!("INVALID_ARGUMENT: providerId required"))?;
        let model_id = model
            .get("modelId")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| anyhow!("INVALID_ARGUMENT: modelId required"))?;
        tx.execute("UPDATE plan_approvals SET execution_provider_id=?2,execution_model_id=?3 WHERE execution_id=?1",params![id,provider,model_id])?;
    }
    tx.execute(
        "UPDATE sessions SET mode='agent',permission_mode=?2,updated_at=?3 WHERE id=?1",
        params![session, approved.target_permission_mode, now],
    )?;
    stamp_execution(&tx, id, "interrupted", "running", None, now)?;
    hold.state = "resumed".into();
    hold.resume_count += 1;
    hold.version += 1;
    hold.updated_at = now;
    // Invalidation is restricted to mutable draft/pending rows. Finalized history is never reopened.
    tx.execute("UPDATE goal_reports SET status='pending',integrity='fallback',updated_at=?2 WHERE execution_id=?1 AND status='draft'",params![id,now])?;
    save_hold(&tx, &hold)?;
    if hold.paused_team {
        crate::team::resume_team(db, session)?;
    }
    audit::append_tx(
        &tx,
        "goal_execution_resumed",
        Some(session),
        json!({"executionId":id,"segment":hold.resume_count+1,"modelOverride":model_override}),
    )?;
    tx.commit()?;
    if let Err(error) = goal_reports::invalidate_draft(db, id) {
        settle(
            db,
            session,
            id,
            crate::goal_holds::GoalSettlement {
                ended: "errored",
                error_code: Some("REPORT_DRAFT_INVALIDATION_FAILED"),
                stop_hint: Some("resume_failed"),
                barrier_failed: false,
                durable_seq: 0,
            },
        )?;
        return Err(error);
    }
    let mut result = get(db, session, Some(id))?;
    result["resume"] = json!({"reasons":hold.reasons,"segment":hold.resume_count+1});
    Ok(result)
}

pub fn close(
    db: &Database,
    session: &str,
    id: &str,
    expected_version: i64,
    action: &str,
) -> Result<Value> {
    if !matches!(action, "accept" | "abandon") {
        return Err(anyhow!(
            "INVALID_ARGUMENT: action must be accept or abandon"
        ));
    }
    owned_execution(db, session, id)?;
    let mut hold =
        get_hold(db, session, id)?.ok_or_else(|| anyhow!("CONFLICT: goal is not blocked"))?;
    let tx = db.conn().unchecked_transaction()?;
    if tx.execute("UPDATE goal_execution_holds SET state=?3,version=version+1,updated_at=?4 WHERE execution_id=?1 AND version=?2 AND state='blocked'",params![id,expected_version,if action=="accept" {"accepted"} else {"abandoned"},now_ms()])?!=1 {return Err(anyhow!("CONFLICT: goal hold changed"));}
    let now = now_ms();
    stamp_execution(
        &tx,
        id,
        "interrupted",
        if action == "accept" {
            "completed"
        } else {
            "interrupted"
        },
        if action == "accept" {
            None
        } else {
            Some("GOAL_ABANDONED")
        },
        now,
    )?;
    hold.state = if action == "accept" {
        "accepted"
    } else {
        "abandoned"
    }
    .into();
    hold.version += 1;
    hold.updated_at = now;
    save_hold(&tx, &hold)?;
    let report = if action == "accept" {
        Some(publication_result(
            db,
            session,
            id,
            goal_reports::finalize_with_closure(db, id, 0, None, None, "user_accepted", true),
        )?)
    } else {
        None
    };
    audit::append_tx(
        &tx,
        "goal_execution_closed",
        Some(session),
        json!({"executionId":id,"action":action}),
    )?;
    tx.commit()?;
    let mut result = get(db, session, Some(id))?;
    if let Some(report) = report {
        result["report"] = json!(report);
    }
    Ok(result)
}

pub(crate) fn supersede(tx: &Transaction<'_>, session: &str) -> Result<()> {
    let now = now_ms();
    let scopes: Vec<String> = {
        let mut stmt=tx.prepare_cached("SELECT first_turn_id FROM goal_execution_holds WHERE session_id=?1 AND state='blocked' AND first_turn_id IS NOT NULL")?;
        let rows = stmt.query_map([session], |row| row.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for scope in scopes {
        let raw: Option<String> = tx
            .query_row(
                "SELECT value_json FROM kv WHERE ns=?1 AND key=?2",
                params![
                    crate::team::TEAM_EXECUTION_DECISION_NS,
                    format!("{session}:{scope}")
                ],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(raw) = raw {
            let decision: crate::team::TeamExecutionDecision = serde_json::from_str(&raw)?;
            if decision.team_session_id != session || decision.lead_turn_id != scope {
                return Err(anyhow!("CONFLICT: held team decision identity changed"));
            }
            for id in decision.message_ids {
                let owned: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM session_collaboration_messages WHERE id=?1 AND plugin_id=?2 AND source_session_id=?3 AND target_session_id<>?3 AND kind='message' AND status='queued' AND turn_id IS NULL)",params![id,crate::team::team_plugin_origin(session),session],|row|row.get(0))?;
                if owned {
                    crate::team::dispatch_metadata::cancel(tx, &id, "superseded")?;
                }
            }
        }
    }
    tx.execute("UPDATE teams SET paused=0,revision=revision+1,updated_at=?2 WHERE team_session_id=?1 AND EXISTS(SELECT 1 FROM goal_execution_holds WHERE session_id=?1 AND state='blocked' AND paused_team=1)",params![session,now])?;
    tx.execute("UPDATE plan_approvals SET error_code='GOAL_SUPERSEDED',version=version+1,updated_at=?2 WHERE session_id=?1 AND error_code='GOAL_BLOCKED' AND execution_state='interrupted' AND execution_id IN (SELECT execution_id FROM goal_execution_holds WHERE session_id=?1 AND state='blocked')",params![session,now])?;
    tx.execute("UPDATE goal_execution_holds SET state='superseded',version=version+1,updated_at=?2 WHERE session_id=?1 AND state='blocked'",params![session,now])?;
    Ok(())
}

pub(crate) fn completion_reasons(db: &Database, id: &str) -> Result<Vec<Value>> {
    evaluate::evaluate(db, id)
}

fn publication_result(
    db: &Database,
    session: &str,
    id: &str,
    result: Result<goal_reports::GoalReportSummary>,
) -> Result<goal_reports::GoalReportSummary> {
    match result {
        Ok(report) => Ok(report),
        Err(error) => {
            if let Some(report) = goal_reports::list_reports(db, session)?
                .into_iter()
                .find(|report| report.execution_id == id && report.status == "failed")
            {
                return Ok(report);
            }
            Err(error)
        }
    }
}

pub(crate) fn blocked_ids(db: &Database, session: &str) -> Result<Vec<String>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT execution_id FROM goal_execution_holds WHERE session_id=?1 AND state='blocked'",
    )?;
    let rows = stmt.query_map([session], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Original approval scope of a currently resumed Goal; ordinary Team work stays latest-scoped.
pub(crate) fn active_resume_scope(db: &Database, session: &str) -> Result<Option<String>> {
    Ok(db.conn().query_row("SELECT h.first_turn_id FROM goal_execution_holds h JOIN plan_approvals p ON p.execution_id=h.execution_id WHERE h.session_id=?1 AND h.state='resumed' AND p.execution_state='running' AND COALESCE(p.execution_kind,p.kind)='goal'",[session],|row|row.get(0)).optional()?.flatten())
}
