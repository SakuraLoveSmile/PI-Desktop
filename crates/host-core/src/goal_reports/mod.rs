//! Goal Completion Report persistence and lifecycle.
//!
//! Owned exclusively by Rust Host Core; stores structured drafts and finalized
//! immutable snapshots in the host data directory, indexed in SQLite.

use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::db::{now_ms, Database};

#[cfg(test)]
mod tests;

pub const SCHEMA: &str = include_str!("schema.sql");

pub const GOAL_REPORT_SCHEMA_VERSION: i64 = 1;
pub const MAX_REPORT_JSON_BYTES: usize = 256 * 1024; // 256 KiB
pub const MAX_EVIDENCE_SUMMARY_BYTES: usize = 2 * 1024; // 2 KiB
pub const MAX_METRICS: usize = 8;
pub const MAX_CRITERIA: usize = 100;
pub const MAX_STEPS: usize = 100;
pub const MAX_FILES: usize = 500;
pub const MAX_CHECKS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportSummary {
    pub report_id: String,
    pub session_id: String,
    pub execution_id: String,
    pub proposal_id: String,
    pub turn_id: Option<String>,
    pub status: String,
    pub verdict: String,
    pub integrity: String,
    pub summary: String,
    pub goal_title: String,
    pub file_path: String,
    pub file_hash: String,
    pub file_size: u64,
    pub durable_seq: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

fn row_to_summary(row: &Row<'_>) -> rusqlite::Result<GoalReportSummary> {
    Ok(GoalReportSummary {
        execution_id: row.get("execution_id")?,
        report_id: row.get("report_id")?,
        session_id: row.get("session_id")?,
        proposal_id: row.get("proposal_id")?,
        turn_id: row.get("turn_id")?,
        status: row.get("status")?,
        integrity: row.get("integrity")?,
        verdict: row.get("verdict")?,
        summary: row.get("summary")?,
        goal_title: row.get("goal_title").unwrap_or_default(),
        file_path: row.get("file_path")?,
        file_hash: row.get("file_hash")?,
        file_size: row.get::<_, i64>("file_size")? as u64,
        durable_seq: row.get("durable_seq")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn reports_dir(data_dir: &Path, session_id: &str) -> PathBuf {
    data_dir.join("goal_reports").join(session_id)
}

fn report_file_path(data_dir: &Path, session_id: &str, execution_id: &str) -> PathBuf {
    reports_dir(data_dir, session_id).join(format!("{execution_id}.json"))
}

fn draft_file_path(data_dir: &Path, session_id: &str, execution_id: &str) -> PathBuf {
    reports_dir(data_dir, session_id).join(format!("{execution_id}.draft.json"))
}

fn relative_report_path(session_id: &str, execution_id: &str) -> String {
    format!("goal_reports/{session_id}/{execution_id}.json")
}

pub fn remove_session_files(data_dir: &Path, session_id: &str) {
    let dir = reports_dir(data_dir, session_id);
    let _ = fs::remove_dir_all(dir);
}

struct ProposalFacts {
    request_id: String,
    session_id: String,
    kind: String,
    title: String,
    plan_json: String,
    artifact_relative_path: Option<String>,
    artifact_sha256: Option<String>,
    created_at: i64,
    execution_state: Option<String>,
    error_code: Option<String>,
}

fn load_proposal_facts(conn: &Connection, execution_id: &str) -> Result<ProposalFacts> {
    conn.prepare_cached(
        "SELECT request_id, session_id, kind, title, plan_json,
                artifact_relative_path, artifact_sha256, created_at,
                execution_state, error_code
         FROM plan_approvals WHERE execution_id = ?1",
    )?
    .query_row(params![execution_id], |row| {
        Ok(ProposalFacts {
            request_id: row.get(0)?,
            session_id: row.get(1)?,
            kind: row.get(2)?,
            title: row.get(3)?,
            plan_json: row.get(4)?,
            artifact_relative_path: row.get(5)?,
            artifact_sha256: row.get(6)?,
            created_at: row.get(7)?,
            execution_state: row.get(8)?,
            error_code: row.get(9)?,
        })
    })
    .with_context(|| format!("PLAN_EXECUTION_NOT_FOUND: execution {execution_id} not found"))
}

/// Associates a turn id with an execution for durable correlation.
pub fn bind_execution_turn(db: &Database, execution_id: &str, turn_id: &str) -> Result<()> {
    let now = now_ms();
    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Ok(());
    }

    let report_id = format!("rep-{}", Uuid::new_v4().simple());
    db.conn()
        .prepare_cached(
            "INSERT INTO goal_reports (
            execution_id, report_id, session_id, proposal_id, turn_id,
            status, integrity, verdict, summary, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 'fallback', 'unknown', '', ?6, ?6)
         ON CONFLICT(execution_id) DO UPDATE SET
            turn_id = excluded.turn_id,
            updated_at = excluded.updated_at",
        )?
        .execute(params![
            execution_id,
            report_id,
            facts.session_id,
            facts.request_id,
            turn_id,
            now
        ])?;
    Ok(())
}

/// Validates and persists a structured report draft from the SubmitGoalReport tool.
/// Invalidates a previously submitted structured draft (e.g. subsequent tool calls or steering).
pub fn invalidate_draft(db: &Database, execution_id: &str) -> Result<()> {
    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Ok(());
    }
    let draft_path = draft_file_path(db.data_dir(), &facts.session_id, execution_id);
    if draft_path.exists() {
        let _ = fs::remove_file(draft_path);
    }
    db.conn()
        .prepare_cached(
            "UPDATE goal_reports SET status = 'pending', integrity = 'fallback', updated_at = ?2
         WHERE execution_id = ?1 AND status = 'draft'",
        )?
        .execute(params![execution_id, now_ms()])?;
    Ok(())
}

pub fn submit_draft(db: &Database, execution_id: &str, draft: &Value) -> Result<()> {
    let raw = serde_json::to_string(draft)?;
    if raw.len() > MAX_REPORT_JSON_BYTES {
        return Err(anyhow!(
            "REPORT_SIZE_EXCEEDED: draft size {} bytes exceeds limit {}",
            raw.len(),
            MAX_REPORT_JSON_BYTES
        ));
    }

    let summary = draft
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: summary required"))?;

    let verdict = draft
        .get("verdict")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: verdict required"))?;

    if !matches!(verdict, "met" | "partial" | "blocked" | "unknown") {
        return Err(anyhow!("INVALID_ARGUMENT: verdict invalid"));
    }

    if let Some(metrics) = draft.get("metrics").and_then(Value::as_array) {
        if metrics.len() > MAX_METRICS {
            return Err(anyhow!("LIMIT_EXCEEDED: too many metrics"));
        }
    }
    if let Some(criteria) = draft.get("criteria").and_then(Value::as_array) {
        if criteria.len() > MAX_CRITERIA {
            return Err(anyhow!("LIMIT_EXCEEDED: too many criteria"));
        }
    }
    if let Some(steps) = draft.get("steps").and_then(Value::as_array) {
        if steps.len() > MAX_STEPS {
            return Err(anyhow!("LIMIT_EXCEEDED: too many steps"));
        }
    }
    if let Some(files) = draft.get("files").and_then(Value::as_array) {
        if files.len() > MAX_FILES {
            return Err(anyhow!("LIMIT_EXCEEDED: too many files"));
        }
    }
    if let Some(checks) = draft.get("checks").and_then(Value::as_array) {
        if checks.len() > MAX_CHECKS {
            return Err(anyhow!("LIMIT_EXCEEDED: too many checks"));
        }
    }
    if let Some(evidences) = draft.get("evidences").and_then(Value::as_array) {
        for ev in evidences {
            if let Some(s) = ev.get("summary").and_then(Value::as_str) {
                if s.len() > MAX_EVIDENCE_SUMMARY_BYTES {
                    return Err(anyhow!("LIMIT_EXCEEDED: evidence summary too large"));
                }
            }
        }
    }

    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Err(anyhow!("INVALID_ARGUMENT: execution is not a goal"));
    }

    let dir = reports_dir(db.data_dir(), &facts.session_id);
    fs::create_dir_all(&dir)?;
    let draft_path = draft_file_path(db.data_dir(), &facts.session_id, execution_id);
    fs::write(&draft_path, raw)?;

    let now = now_ms();
    let report_id = format!("rep-{}", Uuid::new_v4().simple());
    db.conn()
        .prepare_cached(
            "INSERT INTO goal_reports (
            execution_id, report_id, session_id, proposal_id, turn_id,
            status, integrity, verdict, summary, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, NULL, 'draft', 'structured', ?5, ?6, ?7, ?7)
         ON CONFLICT(execution_id) DO UPDATE SET
            status = 'draft',
            integrity = 'structured',
            verdict = excluded.verdict,
            summary = excluded.summary,
            updated_at = excluded.updated_at",
        )?
        .execute(params![
            execution_id,
            report_id,
            facts.session_id,
            facts.request_id,
            verdict,
            summary,
            now
        ])?;

    Ok(())
}

fn write_atomic(target_path: &Path, content: &[u8]) -> Result<(String, u64)> {
    let parent = target_path
        .parent()
        .ok_or_else(|| anyhow!("invalid target path"))?;
    fs::create_dir_all(parent)?;

    let tmp_path = parent.join(format!(
        "{}.tmp.{}",
        target_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("report"),
        Uuid::new_v4()
    ));

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(content)?;
        file.sync_all()?;
    }

    fs::rename(&tmp_path, target_path)?;

    let mut hasher = Sha256::new();
    hasher.update(content);
    let hash = hex::encode(hasher.finalize());
    Ok((hash, content.len() as u64))
}

/// Finalizes a goal report upon execution settlement.
///
/// Builds a structured snapshot if a valid draft exists, or a fallback report
/// from verified host facts otherwise. Publishes atomically and stamps ready.
pub fn finalize_report(
    db: &Database,
    execution_id: &str,
    durable_seq: i64,
    status_override: Option<&str>,
    error_code_override: Option<&str>,
) -> Result<GoalReportSummary> {
    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Err(anyhow!("INVALID_ARGUMENT: execution is not a goal"));
    }

    let existing: Option<(String, Option<String>, i64)> = db
        .conn()
        .prepare_cached(
            "SELECT report_id, turn_id, created_at FROM goal_reports WHERE execution_id = ?1",
        )?
        .query_row(params![execution_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()?;

    let (report_id, turn_id, created_at) = match existing {
        Some((r_id, t_id, c_at)) => (r_id, t_id, c_at),
        None => (
            format!("rep-{}", Uuid::new_v4().simple()),
            None,
            facts.created_at,
        ),
    };

    let now = now_ms();
    let draft_path = draft_file_path(db.data_dir(), &facts.session_id, execution_id);
    let maybe_draft = if draft_path.exists() {
        fs::read_to_string(&draft_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    } else {
        None
    };

    let execution_status = status_override
        .or(facts.execution_state.as_deref())
        .unwrap_or("completed");
    let error_code = error_code_override.or(facts.error_code.as_deref());

    let (integrity_kind, verdict, summary, full_report) = match maybe_draft {
        Some(draft) if execution_status == "completed" => {
            let verdict = draft
                .get("verdict")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let summary = draft
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();

            let report_obj = json!({
                "schemaVersion": GOAL_REPORT_SCHEMA_VERSION,
                "reportId": report_id,
                "sessionId": facts.session_id,
                "executionId": execution_id,
                "proposalId": facts.request_id,
                "turnId": turn_id,
                "goal": {
                    "title": facts.title,
                    "markdown": facts.plan_json,
                    "contractPath": facts.artifact_relative_path,
                    "contractHash": facts.artifact_sha256,
                },
                "execution": {
                    "startedAt": facts.created_at,
                    "completedAt": now,
                    "status": execution_status,
                    "errorCode": error_code,
                    "durableSeq": durable_seq,
                },
                "integrity": {
                    "kind": "structured",
                },
                "verdict": verdict,
                "summary": summary,
                "metrics": draft.get("metrics").cloned().unwrap_or_else(|| json!([])),
                "criteria": draft.get("criteria").cloned().unwrap_or_else(|| json!([])),
                "steps": draft.get("steps").cloned().unwrap_or_else(|| json!([])),
                "files": draft.get("files").cloned().unwrap_or_else(|| json!([])),
                "checks": draft.get("checks").cloned().unwrap_or_else(|| json!([])),
                "limitations": draft.get("limitations").cloned().unwrap_or_else(|| json!([])),
                "nextSteps": draft.get("nextSteps").cloned().unwrap_or_else(|| json!([])),
                "evidences": draft.get("evidences").cloned().unwrap_or_else(|| json!([])),
            });
            ("structured".to_string(), verdict, summary, report_obj)
        }
        _ => {
            // Fallback report
            let is_interrupted = execution_status == "interrupted";
            let verdict = if is_interrupted { "blocked" } else { "unknown" }.to_string();
            let fallback_summary = if is_interrupted {
                format!(
                    "Execution was interrupted ({}) before a structured report was finalized.",
                    error_code.unwrap_or("unknown error")
                )
            } else {
                "Execution finished without a submitted structured report; basic execution facts retained.".to_string()
            };

            let report_obj = json!({
                "schemaVersion": GOAL_REPORT_SCHEMA_VERSION,
                "reportId": report_id,
                "sessionId": facts.session_id,
                "executionId": execution_id,
                "proposalId": facts.request_id,
                "turnId": turn_id,
                "goal": {
                    "title": facts.title,
                    "markdown": facts.plan_json,
                    "contractPath": facts.artifact_relative_path,
                    "contractHash": facts.artifact_sha256,
                },
                "execution": {
                    "startedAt": facts.created_at,
                    "completedAt": now,
                    "status": execution_status,
                    "errorCode": error_code,
                    "durableSeq": durable_seq,
                },
                "integrity": {
                    "kind": "fallback",
                    "missingFields": ["structured_draft"],
                    "truncationNotice": "Generated from host execution facts without agent structured draft",
                },
                "verdict": verdict,
                "summary": fallback_summary,
                "metrics": [],
                "criteria": [],
                "steps": [],
                "files": [],
                "checks": [],
                "limitations": [],
                "nextSteps": [],
                "evidences": [],
            });
            (
                "fallback".to_string(),
                verdict,
                fallback_summary,
                report_obj,
            )
        }
    };

    let target_file = report_file_path(db.data_dir(), &facts.session_id, execution_id);
    let payload = serde_json::to_vec_pretty(&full_report)?;

    let write_res = write_atomic(&target_file, &payload);
    let (file_hash, file_size) = match write_res {
        Ok(v) => v,
        Err(err) => {
            // Mark failed in DB so state is visible
            let _ = db
                .conn()
                .prepare_cached(
                    "INSERT INTO goal_reports (
                    execution_id, report_id, session_id, proposal_id, turn_id,
                    status, integrity, verdict, summary, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'failed', ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(execution_id) DO UPDATE SET
                    status = 'failed',
                    updated_at = excluded.updated_at",
                )?
                .execute(params![
                    execution_id,
                    report_id,
                    facts.session_id,
                    facts.request_id,
                    turn_id,
                    integrity_kind,
                    verdict,
                    summary,
                    created_at,
                    now
                ]);
            return Err(err);
        }
    };

    let rel_path = relative_report_path(&facts.session_id, execution_id);

    db.conn()
        .prepare_cached(
            "INSERT INTO goal_reports (
            execution_id, report_id, session_id, proposal_id, turn_id,
            status, integrity, verdict, summary, file_path, file_hash, file_size,
            durable_seq, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'ready', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(execution_id) DO UPDATE SET
            status = 'ready',
            integrity = excluded.integrity,
            verdict = excluded.verdict,
            summary = excluded.summary,
            file_path = excluded.file_path,
            file_hash = excluded.file_hash,
            file_size = excluded.file_size,
            durable_seq = excluded.durable_seq,
            updated_at = excluded.updated_at",
        )?
        .execute(params![
            execution_id,
            report_id,
            facts.session_id,
            facts.request_id,
            turn_id,
            integrity_kind,
            verdict,
            summary,
            rel_path,
            file_hash,
            file_size as i64,
            durable_seq,
            created_at,
            now
        ])?;

    // Draft is now superseded by the ready report snapshot
    if draft_path.exists() {
        let _ = fs::remove_file(draft_path);
    }

    Ok(GoalReportSummary {
        report_id,
        session_id: facts.session_id,
        execution_id: execution_id.to_string(),
        proposal_id: facts.request_id,
        turn_id,
        status: "ready".to_string(),
        verdict,
        integrity: integrity_kind,
        summary,
        goal_title: facts.title,
        file_path: rel_path,
        file_hash,
        file_size,
        durable_seq,
        created_at,
        updated_at: now,
    })
}

/// Reads a report for a given session, strictly verifying session boundary.
pub fn get_report(
    db: &Database,
    session_id: &str,
    report_id_or_execution_id: &str,
) -> Result<Option<Value>> {
    let row: Option<(String, String, String, String)> = db
        .conn()
        .prepare_cached(
            "SELECT session_id, execution_id, file_path, status
             FROM goal_reports
             WHERE session_id = ?1 AND (report_id = ?2 OR execution_id = ?2)",
        )?
        .query_row(params![session_id, report_id_or_execution_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;

    let Some((sess_id, exec_id, _file_path, status)) = row else {
        return Ok(None);
    };

    if sess_id != session_id {
        return Err(anyhow!(
            "PERMISSION_DENIED: report belongs to another session"
        ));
    }

    if status == "failed" {
        return Err(anyhow!("REPORT_FAILED: goal report generation failed"));
    }

    if status != "ready" {
        return Ok(Some(json!({
            "status": status,
            "sessionId": sess_id,
            "executionId": exec_id,
        })));
    }

    let full_path = report_file_path(db.data_dir(), &sess_id, &exec_id);
    if !full_path.exists() {
        return Err(anyhow!("REPORT_NOT_FOUND: report file missing on disk"));
    }

    let content = fs::read_to_string(&full_path)?;
    let parsed: Value = serde_json::from_str(&content)?;
    Ok(Some(parsed))
}

/// Lists all goal report summaries for a session.
pub fn list_reports(db: &Database, session_id: &str) -> Result<Vec<GoalReportSummary>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT r.execution_id, r.report_id, r.session_id, r.proposal_id, r.turn_id,
                r.status, r.integrity, r.verdict, r.summary, p.title as goal_title,
                r.file_path, r.file_hash, r.file_size, r.durable_seq,
                r.created_at, r.updated_at
         FROM goal_reports r
         LEFT JOIN plan_approvals p ON p.execution_id = r.execution_id
         WHERE r.session_id = ?1
         ORDER BY r.created_at DESC",
    )?;

    let rows = stmt.query_map(params![session_id], row_to_summary)?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// Retries building a failed or pending report from local facts.
pub fn retry_report(
    db: &Database,
    session_id: &str,
    execution_id: &str,
) -> Result<GoalReportSummary> {
    let row: Option<(String, String, i64)> = db
        .conn()
        .prepare_cached(
            "SELECT session_id, status, durable_seq FROM goal_reports WHERE execution_id = ?1",
        )?
        .query_row(params![execution_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;

    let (sess_id, status, durable_seq) = match row {
        Some(r) => r,
        None => {
            let facts = load_proposal_facts(db.conn(), execution_id)?;
            (facts.session_id, "pending".to_string(), 0)
        }
    };

    if sess_id != session_id {
        return Err(anyhow!(
            "PERMISSION_DENIED: report belongs to another session"
        ));
    }

    if status == "ready" {
        // If ready, query summary and return
        let summary: Option<GoalReportSummary> = db
            .conn()
            .prepare_cached(
                "SELECT r.execution_id, r.report_id, r.session_id, r.proposal_id, r.turn_id,
                        r.status, r.integrity, r.verdict, r.summary, p.title as goal_title,
                        r.file_path, r.file_hash, r.file_size, r.durable_seq,
                        r.created_at, r.updated_at
                 FROM goal_reports r
                 LEFT JOIN plan_approvals p ON p.execution_id = r.execution_id
                 WHERE r.execution_id = ?1",
            )?
            .query_row(params![execution_id], row_to_summary)
            .optional()?;
        if let Some(s) = summary {
            return Ok(s);
        }
    }

    finalize_report(db, execution_id, durable_seq, None, None)
}
