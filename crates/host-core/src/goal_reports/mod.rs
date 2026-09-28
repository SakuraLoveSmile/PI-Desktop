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

mod read;

#[allow(unused_imports)]
use read::sha256_hex;
#[allow(unused_imports)]
pub use read::{
    list_reports, read_report, retry_report, state_stub, GoalReportRead, REPORT_STATE_CORRUPT,
    REPORT_STATE_DRAFT, REPORT_STATE_FAILED, REPORT_STATE_NOT_FOUND, REPORT_STATE_PENDING,
    REPORT_STATE_READY, REPORT_STATE_TRUNCATED,
};

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

const REPORT_FAILURE_CODES: [&str; 3] = [
    "REPORT_PERSISTENCE_BARRIER_FAILED",
    "REPORT_DRAFT_PERSIST_FAILED",
    "REPORT_DRAFT_INVALIDATION_FAILED",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportSummary {
    pub report_id: String,
    pub session_id: String,
    pub execution_id: String,
    pub proposal_id: String,
    pub turn_id: Option<String>,
    pub status: String,
    pub execution_status: Option<String>,
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
        execution_status: row.get("execution_status")?,
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
        fs::remove_file(&draft_path).map_err(|err| {
            anyhow!("REPORT_DRAFT_INVALIDATION_FAILED: could not remove draft: {err}")
        })?;
    }
    db.conn()
        .prepare_cached(
            "UPDATE goal_reports SET status = 'pending', integrity = 'fallback', updated_at = ?2
         WHERE execution_id = ?1 AND status = 'draft'",
        )?
        .execute(params![execution_id, now_ms()])
        .map_err(|err| anyhow!("REPORT_DRAFT_INVALIDATION_FAILED: {err}"))?;
    Ok(())
}

fn validate_string_field<'a>(
    object: &'a serde_json::Map<String, Value>,
    field: &str,
    context: &str,
) -> Result<&'a str> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: {context}.{field} must be a non-empty string"))
}

fn validate_enum_field(
    object: &serde_json::Map<String, Value>,
    field: &str,
    allowed: &[&str],
    context: &str,
) -> Result<()> {
    let value = validate_string_field(object, field, context)?;
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(anyhow!(
            "INVALID_ARGUMENT: {context}.{field} must be one of: {}",
            allowed.join(", ")
        ))
    }
}

fn validate_array<'a>(draft: &'a Value, field: &str) -> Result<Option<&'a Vec<Value>>> {
    let Some(value) = draft.get(field) else {
        return Ok(None);
    };
    value
        .as_array()
        .map(Some)
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: {field} must be an array"))
}

fn validate_structured_draft(draft: &Value) -> Result<()> {
    let object = draft
        .as_object()
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: draft must be an object"))?;
    let summary = validate_string_field(object, "summary", "draft")?;
    if summary.len() > MAX_REPORT_JSON_BYTES {
        return Err(anyhow!("REPORT_SIZE_EXCEEDED: summary too large"));
    }
    validate_enum_field(
        object,
        "verdict",
        &["met", "partial", "blocked", "unknown"],
        "draft",
    )?;

    for (field, limit) in [
        ("metrics", MAX_METRICS),
        ("criteria", MAX_CRITERIA),
        ("steps", MAX_STEPS),
        ("files", MAX_FILES),
        ("checks", MAX_CHECKS),
    ] {
        if let Some(items) = validate_array(draft, field)? {
            if items.len() > limit {
                return Err(anyhow!("LIMIT_EXCEEDED: too many {field}"));
            }
        }
    }

    if let Some(items) = validate_array(draft, "metrics")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: metrics[{index}] must be an object"))?;
            let context = format!("metrics[{index}]");
            validate_string_field(object, "label", &context)?;
            validate_string_field(object, "value", &context)?;
        }
    }
    if let Some(items) = validate_array(draft, "criteria")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: criteria[{index}] must be an object"))?;
            let context = format!("criteria[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "text", &context)?;
            validate_enum_field(
                object,
                "verdict",
                &["met", "unmet", "partial", "unknown"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "steps")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: steps[{index}] must be an object"))?;
            let context = format!("steps[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "title", &context)?;
            validate_enum_field(
                object,
                "status",
                &["completed", "failed", "skipped"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "files")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: files[{index}] must be an object"))?;
            let context = format!("files[{index}]");
            validate_string_field(object, "path", &context)?;
            validate_enum_field(
                object,
                "changeType",
                &["created", "modified", "deleted", "referenced"],
                &context,
            )?;
            validate_enum_field(
                object,
                "attribution",
                &["direct", "subagent", "declared"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "checks")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: checks[{index}] must be an object"))?;
            let context = format!("checks[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_string_field(object, "command", &context)?;
            validate_enum_field(
                object,
                "result",
                &["passed", "failed", "inconclusive"],
                &context,
            )?;
        }
    }
    if let Some(items) = validate_array(draft, "evidences")? {
        for (index, item) in items.iter().enumerate() {
            let object = item
                .as_object()
                .ok_or_else(|| anyhow!("INVALID_ARGUMENT: evidences[{index}] must be an object"))?;
            let context = format!("evidences[{index}]");
            validate_string_field(object, "id", &context)?;
            validate_enum_field(
                object,
                "kind",
                &["tool_call", "tool_result", "message", "file", "subagent"],
                &context,
            )?;
            validate_string_field(object, "refId", &context)?;
            let evidence_summary = validate_string_field(object, "summary", &context)?;
            if evidence_summary.len() > MAX_EVIDENCE_SUMMARY_BYTES {
                return Err(anyhow!("LIMIT_EXCEEDED: evidence summary too large"));
            }
        }
    }
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
    validate_structured_draft(draft)?;
    let object = draft
        .as_object()
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: draft must be an object"))?;
    let summary = object
        .get("summary")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: draft.summary must be a non-empty string"))?
        .trim();
    let verdict = object
        .get("verdict")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("INVALID_ARGUMENT: draft.verdict must be a non-empty string"))?
        .trim();

    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Err(anyhow!("INVALID_ARGUMENT: execution is not a goal"));
    }

    let status: Option<String> = db
        .conn()
        .prepare_cached("SELECT status FROM goal_reports WHERE execution_id = ?1")?
        .query_row(params![execution_id], |row| row.get(0))
        .optional()?;
    if let Some(status) = status.as_deref() {
        if matches!(status, "ready" | "failed") {
            return Err(anyhow!(
                "INVALID_ARGUMENT: cannot submit a draft for a {status} report"
            ));
        }
    }

    let dir = reports_dir(db.data_dir(), &facts.session_id);
    fs::create_dir_all(&dir).map_err(|err| {
        anyhow!("REPORT_DRAFT_PERSIST_FAILED: could not create draft directory: {err}")
    })?;
    let draft_path = draft_file_path(db.data_dir(), &facts.session_id, execution_id);
    fs::write(&draft_path, raw)
        .map_err(|err| anyhow!("REPORT_DRAFT_PERSIST_FAILED: could not write draft: {err}"))?;

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
        ])
        .map_err(|err| {
            anyhow!("REPORT_DRAFT_PERSIST_FAILED: could not persist draft metadata: {err}")
        })?;

    Ok(())
}

/// Records a terminal report publication failure without retrying the Goal or
/// contacting a provider. This is idempotent and uses only durable Host facts.
pub fn mark_failed(
    db: &Database,
    session_id: &str,
    execution_id: &str,
    error_code: &str,
) -> Result<GoalReportSummary> {
    if !REPORT_FAILURE_CODES.contains(&error_code) {
        return Err(anyhow!("INVALID_ARGUMENT: unsupported report failure code"));
    }
    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.kind != "goal" {
        return Err(anyhow!("INVALID_ARGUMENT: execution is not a goal"));
    }
    if facts.session_id != session_id {
        return Err(anyhow!(
            "PERMISSION_DENIED: report belongs to another session"
        ));
    }
    let current: Option<(String, String)> = db
        .conn()
        .prepare_cached("SELECT status, session_id FROM goal_reports WHERE execution_id = ?1")?
        .query_row(params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    if current
        .as_ref()
        .is_some_and(|(_, report_session_id)| report_session_id != session_id)
    {
        return Err(anyhow!(
            "PERMISSION_DENIED: report belongs to another session"
        ));
    }
    if current
        .as_ref()
        .is_some_and(|(status, _)| status == "ready")
    {
        return list_reports(db, &facts.session_id)?
            .into_iter()
            .find(|report| report.execution_id == execution_id)
            .ok_or_else(|| anyhow!("REPORT_PERSISTENCE_FAILED: ready report summary is missing"));
    }
    let now = now_ms();
    let report_id = format!("rep-{}", Uuid::new_v4().simple());
    db.conn()
        .prepare_cached(
            "INSERT INTO goal_reports (
                execution_id, report_id, session_id, proposal_id, turn_id,
                status, integrity, verdict, summary, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, 'failed', 'fallback', 'unknown', ?5, ?6, ?6)
             ON CONFLICT(execution_id) DO UPDATE SET
                status = 'failed', integrity = 'fallback', verdict = 'unknown',
                summary = excluded.summary, updated_at = excluded.updated_at
             WHERE goal_reports.session_id = excluded.session_id",
        )?
        .execute(params![
            execution_id,
            report_id,
            facts.session_id,
            facts.request_id,
            format!(
                "Goal report publication failed ({error_code}); retry uses durable Host facts only."
            ),
            now,
        ])?;
    list_reports(db, &facts.session_id)?
        .into_iter()
        .find(|report| report.execution_id == execution_id)
        .ok_or_else(|| anyhow!("REPORT_PERSISTENCE_FAILED: failed report summary is missing"))
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

    let existing: Option<(String, Option<String>, i64, String)> = db
        .conn()
        .prepare_cached(
            "SELECT report_id, turn_id, created_at, status
             FROM goal_reports WHERE execution_id = ?1",
        )?
        .query_row(params![execution_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .optional()?;

    if existing.as_ref().is_some_and(|row| row.3 == "failed") {
        return list_reports(db, &facts.session_id)?
            .into_iter()
            .find(|report| report.execution_id == execution_id)
            .ok_or_else(|| anyhow!("REPORT_PERSISTENCE_FAILED: failed report summary is missing"));
    }

    let (report_id, turn_id, created_at) = match existing {
        Some((r_id, t_id, c_at, _)) => (r_id, t_id, c_at),
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
            .filter(|draft| validate_structured_draft(draft).is_ok())
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
            mark_failed(
                db,
                &facts.session_id,
                execution_id,
                "REPORT_PERSISTENCE_BARRIER_FAILED",
            )
            .map_err(|mark_error| {
                anyhow!("{err}; failed to record report failure: {mark_error}")
            })?;
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
        execution_status: Some(execution_status.to_string()),
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
