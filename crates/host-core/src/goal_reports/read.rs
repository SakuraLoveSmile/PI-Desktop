use super::*;

pub const REPORT_STATE_READY: &str = "ready";
pub const REPORT_STATE_PENDING: &str = "pending";
pub const REPORT_STATE_DRAFT: &str = "draft";
pub const REPORT_STATE_FAILED: &str = "failed";
pub const REPORT_STATE_NOT_FOUND: &str = "not_found";
pub const REPORT_STATE_CORRUPT: &str = "corrupt";
pub const REPORT_STATE_TRUNCATED: &str = "truncated";

/// Trusted result of reading one report: the recomputed hash, the verified
/// snapshot, or an explicit state that says why no verified body is returned.
///
/// `ready` with `integrity.kind == "fallback"` is a successful read that means
/// "there is no completed report"; it is never conflated with `structured`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalReportRead {
    pub state: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    /// Recomputed SHA-256 of the verified file bytes, never a DB echo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_sha256: Option<String>,
    /// Recomputed on-disk size, never a DB echo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_bytes: Option<u64>,
    pub max_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<Value>,
}

impl GoalReportRead {
    fn state_only(state: &str, session_id: &str, detail: Option<String>) -> Self {
        Self {
            state: state.to_string(),
            session_id: session_id.to_string(),
            execution_id: None,
            report_id: None,
            integrity: None,
            verdict: None,
            report_sha256: None,
            file_bytes: None,
            max_bytes: MAX_REPORT_JSON_BYTES as u64,
            detail,
            report: None,
        }
    }
}

fn non_empty_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

/// Validate a report snapshot against the version-1 schema.
///
/// Mirrors the shared TypeScript validator for the fields a reader must trust
/// before handing the body to another process. It never trusts the filename,
/// the SQLite row, or a previously stored hash.
fn validate_report_snapshot(value: &Value) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| "schema: report is not a JSON object".to_string())?;
    let schema_version = object
        .get("schemaVersion")
        .and_then(Value::as_i64)
        .ok_or_else(|| "schema: schemaVersion missing".to_string())?;
    if schema_version != GOAL_REPORT_SCHEMA_VERSION {
        return Err(format!(
            "schema: unsupported schemaVersion {schema_version} (expected {GOAL_REPORT_SCHEMA_VERSION})"
        ));
    }
    for key in ["reportId", "sessionId", "executionId", "proposalId"] {
        if non_empty_str(value, key).is_none() {
            return Err(format!("schema: {key} missing"));
        }
    }
    let goal = object
        .get("goal")
        .and_then(Value::as_object)
        .ok_or_else(|| "schema: goal missing".to_string())?;
    for key in ["title", "markdown"] {
        if !goal.get(key).is_some_and(Value::is_string) {
            return Err(format!("schema: goal.{key} missing"));
        }
    }
    let execution = object
        .get("execution")
        .and_then(Value::as_object)
        .ok_or_else(|| "schema: execution missing".to_string())?;
    if !execution.get("startedAt").is_some_and(Value::is_i64)
        || !execution.get("completedAt").is_some_and(Value::is_i64)
    {
        return Err("schema: execution timestamps missing".to_string());
    }
    let execution_status = execution.get("status").and_then(Value::as_str);
    if !matches!(execution_status, Some("completed") | Some("interrupted")) {
        return Err("schema: execution.status invalid".to_string());
    }
    let integrity = object
        .get("integrity")
        .and_then(Value::as_object)
        .ok_or_else(|| "schema: integrity missing".to_string())?;
    let integrity_kind = integrity.get("kind").and_then(Value::as_str);
    if !matches!(integrity_kind, Some("structured") | Some("fallback")) {
        return Err("schema: integrity.kind invalid".to_string());
    }
    let verdict = object.get("verdict").and_then(Value::as_str);
    if !matches!(
        verdict,
        Some("met") | Some("partial") | Some("blocked") | Some("unknown")
    ) {
        return Err("schema: verdict invalid".to_string());
    }
    if !object.get("summary").is_some_and(Value::is_string) {
        return Err("schema: summary missing".to_string());
    }
    for key in [
        "metrics",
        "criteria",
        "steps",
        "files",
        "checks",
        "limitations",
        "nextSteps",
        "evidences",
    ] {
        if !object.get(key).is_some_and(Value::is_array) {
            return Err(format!("schema: {key} missing"));
        }
    }
    Ok(())
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Render a renderer-compatible stub for a non-ready or unreadable report.
///
/// Carries only host facts and a bounded reason code; never a partial body.
pub fn state_stub(read: &GoalReportRead) -> Value {
    let mut stub = json!({
        "status": read.state,
        "state": read.state,
        "sessionId": read.session_id,
        "executionId": read.execution_id,
        "reportId": read.report_id,
    });
    if let Some(object) = stub.as_object_mut() {
        if let Some(integrity) = read.integrity.as_deref() {
            object.insert("integrity".into(), json!(integrity));
        }
        if let Some(verdict) = read.verdict.as_deref() {
            object.insert("verdict".into(), json!(verdict));
        }
        if let Some(detail) = read.detail.as_deref() {
            object.insert("error".into(), json!(detail));
            object.insert("detail".into(), json!(detail));
        }
    }
    stub
}

/// Read one report for a session with a trusted identity and integrity check.
///
/// The query is scoped to `session_id`, so another session's execution id
/// resolves to `not_found` instead of leaking a body or an existence fact.
/// For `ready` rows the file hash and size are recomputed from disk and the
/// snapshot must pass schema validation plus report/session/execution/proposal
/// identity equality; any mismatch becomes `corrupt` and returns no body.
pub fn read_report(
    db: &Database,
    session_id: &str,
    report_id_or_execution_id: &str,
) -> Result<GoalReportRead> {
    #[allow(clippy::type_complexity)]
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<i64>,
    )> = db
        .conn()
        .prepare_cached(
            "SELECT session_id, execution_id, report_id, proposal_id, status, integrity, file_hash, file_size
             FROM goal_reports
             WHERE session_id = ?1 AND (report_id = ?2 OR execution_id = ?2)",
        )?
        .query_row(params![session_id, report_id_or_execution_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .optional()?;

    let Some((
        sess_id,
        exec_id,
        report_id,
        proposal_id,
        status,
        db_integrity,
        db_file_hash,
        db_file_size,
    )) = row
    else {
        return Ok(GoalReportRead::state_only(
            REPORT_STATE_NOT_FOUND,
            session_id,
            Some("REPORT_NOT_FOUND: no report for this session".to_string()),
        ));
    };

    // Defence in depth: the SQL predicate already scopes by session, and a
    // mismatch must never downgrade into a body-less answer for the wrong row.
    if sess_id != session_id {
        return Ok(GoalReportRead::state_only(
            REPORT_STATE_NOT_FOUND,
            session_id,
            Some("REPORT_NOT_FOUND: report belongs to another session".to_string()),
        ));
    }

    let mut read = GoalReportRead {
        state: REPORT_STATE_PENDING.to_string(),
        session_id: sess_id.clone(),
        execution_id: Some(exec_id.clone()),
        report_id: Some(report_id.clone()),
        integrity: None,
        verdict: None,
        report_sha256: None,
        file_bytes: None,
        max_bytes: MAX_REPORT_JSON_BYTES as u64,
        detail: None,
        report: None,
    };

    if status == REPORT_STATE_FAILED {
        read.state = REPORT_STATE_FAILED.to_string();
        read.detail = Some("REPORT_FAILED: goal report generation failed".to_string());
        return Ok(read);
    }

    if status != REPORT_STATE_READY {
        // `draft` and `pending` are both in-flight states; anything else is
        // reported verbatim instead of being guessed into a ready report.
        read.state = if status == REPORT_STATE_DRAFT {
            REPORT_STATE_DRAFT.to_string()
        } else {
            REPORT_STATE_PENDING.to_string()
        };
        return Ok(read);
    }

    let full_path = report_file_path(db.data_dir(), &sess_id, &exec_id);
    let bytes = match fs::read(&full_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            read.state = REPORT_STATE_CORRUPT.to_string();
            read.detail = Some(format!(
                "REPORT_FILE_MISSING: verified report file unreadable ({})",
                error.kind()
            ));
            return Ok(read);
        }
    };

    // Enforce the 256 KiB ceiling before any body is parsed or returned. An
    // oversized file is an explicit `truncated` state, never a cut body.
    read.file_bytes = Some(bytes.len() as u64);
    if bytes.len() > MAX_REPORT_JSON_BYTES {
        read.state = REPORT_STATE_TRUNCATED.to_string();
        read.detail = Some(format!(
            "REPORT_SIZE_EXCEEDED: report is {} bytes, limit {} bytes",
            bytes.len(),
            MAX_REPORT_JSON_BYTES
        ));
        return Ok(read);
    }

    let recomputed_hash = sha256_hex(&bytes);
    read.report_sha256 = Some(recomputed_hash.clone());

    if let Some(stored_hash) = db_file_hash {
        if !stored_hash.is_empty() && stored_hash != recomputed_hash {
            read.state = REPORT_STATE_CORRUPT.to_string();
            read.detail = Some(
                "REPORT_CORRUPT: file hash does not match recorded publication hash".to_string(),
            );
            return Ok(read);
        }
    }

    if let Some(stored_size) = db_file_size {
        if stored_size > 0 && (stored_size as usize) != bytes.len() {
            read.state = REPORT_STATE_CORRUPT.to_string();
            read.detail = Some(
                "REPORT_CORRUPT: file size does not match recorded publication size".to_string(),
            );
            return Ok(read);
        }
    }
    let parsed: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => {
            read.state = REPORT_STATE_CORRUPT.to_string();
            read.detail = Some("REPORT_CORRUPT: report file is not valid JSON".to_string());
            return Ok(read);
        }
    };

    if let Err(reason) = validate_report_snapshot(&parsed) {
        read.state = REPORT_STATE_CORRUPT.to_string();
        read.detail = Some(format!("REPORT_CORRUPT: {reason}"));
        return Ok(read);
    }

    let identity_matches = non_empty_str(&parsed, "sessionId") == Some(sess_id.as_str())
        && non_empty_str(&parsed, "executionId") == Some(exec_id.as_str())
        && non_empty_str(&parsed, "reportId") == Some(report_id.as_str())
        && non_empty_str(&parsed, "proposalId") == Some(proposal_id.as_str());
    if !identity_matches {
        read.state = REPORT_STATE_CORRUPT.to_string();
        read.detail = Some(
            "REPORT_IDENTITY_MISMATCH: report identity does not match its session row".to_string(),
        );
        return Ok(read);
    }

    let file_integrity = parsed
        .get("integrity")
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if file_integrity != db_integrity {
        read.state = REPORT_STATE_CORRUPT.to_string();
        read.detail =
            Some("REPORT_INTEGRITY_MISMATCH: report integrity != stored integrity".to_string());
        return Ok(read);
    }

    read.state = REPORT_STATE_READY.to_string();
    read.integrity = Some(file_integrity.to_string());
    read.verdict = parsed
        .get("verdict")
        .and_then(Value::as_str)
        .map(str::to_string);
    read.report = Some(parsed);
    Ok(read)
}

/// Lists all goal report summaries for a session.
pub fn list_reports(db: &Database, session_id: &str) -> Result<Vec<GoalReportSummary>> {
    let mut stmt = db.conn().prepare_cached(
        "SELECT r.execution_id, r.report_id, r.session_id, r.proposal_id, r.turn_id,
                r.status, r.integrity, r.verdict, r.summary, p.title as goal_title,
                CASE WHEN p.execution_state IN ('completed', 'interrupted')
                     THEN p.execution_state ELSE NULL END as execution_status,
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

/// Retries a completed execution report from local facts, without rerunning it.
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

    let facts = load_proposal_facts(db.conn(), execution_id)?;
    if facts.session_id != session_id {
        return Err(anyhow!(
            "PERMISSION_DENIED: report belongs to another session"
        ));
    }
    require_completed_execution(&facts, None)?;

    if status == "ready" {
        // If ready, query summary and return
        let summary: Option<GoalReportSummary> = db
            .conn()
            .prepare_cached(
                "SELECT r.execution_id, r.report_id, r.session_id, r.proposal_id, r.turn_id,
                        r.status, r.integrity, r.verdict, r.summary, p.title as goal_title,
                        CASE WHEN p.execution_state IN ('completed', 'interrupted')
                             THEN p.execution_state ELSE NULL END as execution_status,
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

    // A failed publication must never be retried from an agent draft. Remove
    // that stale input before rebuilding the report from durable Host facts.
    if status == "failed" {
        let draft_path = draft_file_path(db.data_dir(), &facts.session_id, execution_id);
        if draft_path.exists() {
            fs::remove_file(draft_path).map_err(|err| {
                anyhow!("REPORT_DRAFT_INVALIDATION_FAILED: could not remove stale draft: {err}")
            })?;
        }
        db.conn().execute(
            "UPDATE goal_reports SET status='pending', updated_at=?1
             WHERE execution_id=?2 AND status='failed'",
            params![now_ms(), execution_id],
        )?;
    }

    finalize_report(db, execution_id, durable_seq, None, None)
}
