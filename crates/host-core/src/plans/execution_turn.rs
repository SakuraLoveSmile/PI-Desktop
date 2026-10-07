//! Trusted dispatchers bind an approved Plan to its immutable execution turn.
//! This is not a model-callable RPC or a continuation/recovery capability.
use super::*;

pub(crate) const EXECUTION_TURN_NS: &str = "plan-execution-turn-v1";

pub fn bind_execution_turn(
    db: &Database,
    execution_id: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<()> {
    let tx = db.conn().unchecked_transaction()?;
    let valid: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM plan_approvals p JOIN turns t ON t.session_id=p.session_id
         WHERE p.execution_id=?1 AND p.session_id=?2 AND p.status='approved'
           AND p.execution_state='running' AND COALESCE(p.execution_kind,p.kind)='plan'
           AND t.id=?3 AND t.status='running')",
        params![execution_id, session_id, turn_id],
        |row| row.get(0),
    )?;
    if !valid {
        return Err(plan_error("PLAN_EXECUTION_STALE"));
    }
    if sessions::session_execution_profile(db, session_id)?.as_deref() == Some("team") {
        crate::team::validate_team_lead(db, session_id)?;
        if !crate::team::authority::review_belongs_to_current_scope(db, session_id, turn_id)? {
            return Err(plan_error("PLAN_EXECUTION_STALE"));
        }
    }
    let binding = json!({ "sessionId": session_id, "turnId": turn_id });
    if let Some(existing) = db.kv_get(EXECUTION_TURN_NS, execution_id)? {
        if existing != binding {
            return Err(plan_error("PLAN_EXECUTION_CONFLICT"));
        }
    } else {
        db.kv_set(EXECUTION_TURN_NS, execution_id, &binding)?;
    }
    tx.commit()?;
    Ok(())
}
