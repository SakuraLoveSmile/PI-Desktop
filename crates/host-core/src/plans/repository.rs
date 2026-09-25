use super::*;

// `kind` is appended last so the historical column indexes stay stable.
pub(crate) const PROPOSAL_COLUMNS: &str = "request_id, session_id, turn_id, tool_call_id,
    plan_json, title, question, status, created_at, updated_at, expires_at,
    resolved_at, action, target_permission_mode, feedback, error_code,
    artifact_relative_path, artifact_sha256, artifact_size_bytes, version,
    execution_id, execution_state, kind, artifact_workspace_kind";

pub(crate) fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanProposal> {
    let artifact_path: Option<String> = row.get(16)?;
    let artifact_sha256: Option<String> = row.get(17)?;
    let artifact_size: Option<i64> = row.get(18)?;
    let artifact_workspace_kind: Option<String> = row.get(23)?;
    let artifact = match (artifact_path, artifact_sha256, artifact_size) {
        (Some(relative_path), Some(sha256), Some(size_bytes)) => Some(PlanArtifact {
            relative_path,
            sha256,
            size_bytes: size_bytes.max(0) as u64,
            workspace_kind: artifact_workspace_kind,
        }),
        _ => None,
    };
    let created_at: i64 = row.get(8)?;
    let updated_at: i64 = row.get(9)?;
    let expires_at = row.get::<_, Option<i64>>(10)?.map(ms_to_ts);
    let resolved_at = row.get::<_, Option<i64>>(11)?.map(ms_to_ts);
    // This legacy column remains in SQLite for migration/read safety but is
    // intentionally absent from the current approval contract.
    let _legacy_feedback: Option<String> = row.get(14)?;
    Ok(PlanProposal {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        tool_call_id: row.get(3)?,
        kind: row
            .get::<_, Option<String>>(22)?
            .unwrap_or_else(|| KIND_PLAN.to_string()),
        plan: row.get(4)?,
        markdown: row.get(4)?,
        title: row.get(5)?,
        question: row.get(6)?,
        status: row.get(7)?,
        created_at: ms_to_ts(created_at),
        updated_at: ms_to_ts(updated_at),
        expires_at,
        resolved_at,
        action: row.get(12)?,
        target_permission_mode: row.get(13)?,
        error_code: row.get(15)?,
        artifact,
        version: row.get(19)?,
        execution_id: row.get(20)?,
        execution_state: row.get(21)?,
    })
}

pub(crate) fn get_proposal(db: &Database, id: &str) -> Result<Option<PlanProposal>> {
    let sql = format!("SELECT {PROPOSAL_COLUMNS} FROM plan_approvals WHERE request_id = ?1");
    Ok(db
        .conn()
        .prepare_cached(&sql)?
        .query_row(params![id], proposal_from_row)
        .optional()?)
}

pub(crate) fn temporary_goal_session_ids(
    db: &Database,
) -> Result<std::collections::HashSet<String>> {
    let mut statement = db.conn().prepare(
        "SELECT DISTINCT p.session_id
         FROM plan_approvals p
         JOIN sessions s ON s.id = p.session_id
         WHERE p.artifact_workspace_kind = 'scratch'",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<std::collections::HashSet<_>>>()?)
}

pub(crate) fn has_live_scratch_goal(db: &Database, session_id: &str) -> Result<bool> {
    expire_pending_approvals(db)?;
    let blocked: bool = db.conn().query_row(
        "SELECT EXISTS(
             SELECT 1 FROM plan_approvals
             WHERE session_id = ?1
               AND artifact_workspace_kind = 'scratch'
               AND (status = 'pending' OR execution_state IN ('queued', 'running'))
         )",
        params![session_id],
        |row| row.get(0),
    )?;
    Ok(blocked)
}

/// The approval kind this session may submit, or `None` while it is executing
/// freely in Agent mode.
pub(crate) fn session_submit_kind(db: &Database, session_id: &str) -> Result<Option<&'static str>> {
    let Some(mode) = sessions::session_mode(db, session_id)? else {
        return Err(plan_error("PLAN_SESSION_NOT_FOUND"));
    };
    Ok(kind_for_mode(&mode))
}

pub(crate) fn live_turn_belongs_to_session(
    db: &Database,
    session_id: &str,
    turn_id: &str,
) -> Result<bool> {
    Ok(db.conn().query_row(
        "SELECT EXISTS(
             SELECT 1 FROM turns
             WHERE id = ?1 AND session_id = ?2 AND status = 'running'
         )",
        params![turn_id, session_id],
        |row| row.get(0),
    )?)
}
