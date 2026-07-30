use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::audit;
use crate::db::{ms_to_ts, now_ms, Database};
use crate::sessions;

pub const PLAN_APPROVAL_TIMEOUT_MS: u64 = 120_000;

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_CHANGES_REQUESTED: &str = "changes_requested";
pub const STATUS_REJECTED: &str = "rejected";
pub const STATUS_EXPIRED: &str = "expired";
pub const STATUS_INTERRUPTED: &str = "interrupted";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProposal {
    pub id: String,
    pub session_id: String,
    /// The durable host turn that owns the ExitPlanMode call. Runtime and
    /// host use this ID consistently for approval identity and audit rows.
    pub turn_id: String,
    /// Exact ExitPlanMode tool-call identity. It is unique in storage.
    pub tool_call_id: String,
    pub plan: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub resolved_at: Option<String>,
    pub action: Option<String>,
    pub target_permission_mode: Option<String>,
    pub feedback: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResolution {
    pub status: String,
    pub proposal: PlanProposal,
    pub action: Option<String>,
    pub target_permission_mode: Option<String>,
    pub feedback: Option<String>,
}

struct PendingPlan {
    tx: oneshot::Sender<PlanResolution>,
}

#[derive(Default)]
pub struct PlanManager {
    /// A row is actionable only while its one-shot waiter is present here.
    pending: HashMap<String, PendingPlan>,
}

fn plan_error(code: &str) -> anyhow::Error {
    anyhow!(code.to_string())
}

fn valid_permission_mode(value: &str) -> bool {
    matches!(value, "ask" | "accept-edits" | "auto")
}

fn proposal_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanProposal> {
    let created_at: i64 = row.get(6)?;
    let expires_at: i64 = row.get(7)?;
    let resolved_at = row.get::<_, Option<i64>>(8)?;
    Ok(PlanProposal {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        tool_call_id: row.get(3)?,
        plan: row.get(4)?,
        status: row.get(5)?,
        created_at: ms_to_ts(created_at),
        // There is no mutable updated_at column in the v8 approval contract;
        // resolved_at is the update timestamp once a row is terminal.
        updated_at: ms_to_ts(resolved_at.unwrap_or(created_at)),
        expires_at: ms_to_ts(expires_at),
        resolved_at: resolved_at.map(ms_to_ts),
        action: row.get(9)?,
        target_permission_mode: row.get(10)?,
        feedback: row.get(11)?,
        error_code: row.get(12)?,
    })
}

fn get_proposal(db: &Database, id: &str) -> Result<Option<PlanProposal>> {
    Ok(db
        .conn()
        .prepare_cached(
            "SELECT request_id, session_id, turn_id, tool_call_id, plan_json, status,
                    created_at, expires_at, resolved_at, action,
                    target_permission_mode, feedback, error_code
             FROM plan_approvals WHERE request_id = ?1",
        )?
        .query_row(params![id], proposal_from_row)
        .optional()?)
}

fn session_is_plan(db: &Database, session_id: &str) -> Result<bool> {
    Ok(sessions::session_mode(db, session_id)?.as_deref() == Some("plan"))
}

fn live_turn_belongs_to_session(db: &Database, session_id: &str, turn_id: &str) -> Result<bool> {
    Ok(db.conn().query_row(
        "SELECT EXISTS(
             SELECT 1 FROM turns
             WHERE id = ?1 AND session_id = ?2 AND status = 'running'
         )",
        params![turn_id, session_id],
        |row| row.get(0),
    )?)
}

fn persist_terminal_status(
    db: &Database,
    proposal: &PlanProposal,
    status: &str,
    error_code: &str,
) -> Result<bool> {
    let now = now_ms();
    let tx = db.conn().unchecked_transaction()?;
    let changed = tx
        .prepare_cached(
            "UPDATE plan_approvals
             SET status = ?1, resolved_at = ?2, error_code = ?3
             WHERE request_id = ?4 AND status = 'pending'",
        )?
        .execute(params![status, now, error_code, proposal.id])?;
    if changed == 0 {
        return Ok(false);
    }
    audit::append_tx(
        &tx,
        "plan_approval_terminal",
        Some(&proposal.session_id),
        json!({
            "proposalId": proposal.id,
            "sessionId": proposal.session_id,
            "turnId": proposal.turn_id,
            "toolCallId": proposal.tool_call_id,
            "status": status,
            "errorCode": error_code,
        }),
    )?;
    tx.commit()?;
    Ok(true)
}

impl PlanManager {
    /// Close expired rows and rows whose host waiter disappeared. The latter
    /// are interrupted so a stale pending row cannot block a new submission.
    fn reap(&mut self, db: &Database) -> Result<()> {
        let rows: Vec<(String, i64)> = {
            let mut stmt = db.conn().prepare_cached(
                "SELECT request_id, expires_at FROM plan_approvals
                 WHERE status = 'pending'",
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let now = now_ms();
        for (id, expires_at) in rows {
            let live = self
                .pending
                .get(&id)
                .map(|pending| !pending.tx.is_closed())
                .unwrap_or(false);
            let Some(proposal) = get_proposal(db, &id)? else {
                self.pending.remove(&id);
                continue;
            };
            if expires_at <= now {
                if live {
                    let _ =
                        self.finish_pending(db, &id, STATUS_EXPIRED, "PLAN_APPROVAL_TIMEOUT")?;
                } else {
                    self.pending.remove(&id);
                    let _ = persist_terminal_status(
                        db,
                        &proposal,
                        STATUS_EXPIRED,
                        "PLAN_APPROVAL_TIMEOUT",
                    )?;
                }
            } else if !live {
                self.pending.remove(&id);
                let _ = persist_terminal_status(
                    db,
                    &proposal,
                    STATUS_INTERRUPTED,
                    "PLAN_APPROVAL_INTERRUPTED",
                )?;
            }
        }
        Ok(())
    }

    pub fn enter(&mut self, db: &Database, session_id: &str) -> Result<()> {
        let Some(mode) = sessions::session_mode(db, session_id)? else {
            return Err(plan_error("PLAN_SESSION_NOT_FOUND"));
        };
        if mode != "agent" {
            return Err(plan_error("PLAN_ALREADY_ACTIVE"));
        }
        let now = now_ms();
        let tx = db.conn().unchecked_transaction()?;
        let changed = tx
            .prepare_cached(
                "UPDATE sessions SET mode = 'plan', updated_at = ?1
                 WHERE id = ?2 AND mode = 'agent'",
            )?
            .execute(params![now, session_id])?;
        if changed == 0 {
            return Err(plan_error("PLAN_ALREADY_ACTIVE"));
        }
        audit::append_tx(
            &tx,
            "plan_entered",
            Some(session_id),
            json!({ "sessionId": session_id, "mode": "plan" }),
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn submit(
        &mut self,
        db: &Database,
        session_id: &str,
        turn_id: &str,
        tool_call_id: &str,
        plan: &str,
    ) -> Result<(PlanProposal, oneshot::Receiver<PlanResolution>)> {
        let plan = plan.trim();
        if plan.is_empty() || turn_id.trim().is_empty() || tool_call_id.trim().is_empty() {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        }
        if !session_is_plan(db, session_id)? {
            return Err(plan_error("PLAN_NOT_ACTIVE"));
        }
        if !live_turn_belongs_to_session(db, session_id, turn_id)? {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        self.reap(db)?;
        let has_pending: bool = db.conn().query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM plan_approvals
                 WHERE session_id = ?1 AND status = 'pending'
             )",
            params![session_id],
            |row| row.get(0),
        )?;
        if has_pending {
            return Err(plan_error("PLAN_ALREADY_PENDING"));
        }

        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        let expires_at = now + PLAN_APPROVAL_TIMEOUT_MS as i64;
        db.conn()
            .prepare_cached(
                "INSERT INTO plan_approvals
                    (request_id, session_id, turn_id, tool_call_id, plan_json,
                     status, created_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)",
            )?
            .execute(params![
                id,
                session_id,
                turn_id,
                tool_call_id,
                plan,
                now,
                expires_at
            ])?;
        let proposal = get_proposal(db, &id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?;
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, PendingPlan { tx });
        Ok((proposal, rx))
    }

    pub fn pending_for_session(
        &mut self,
        db: &Database,
        session_id: Option<&str>,
    ) -> Result<Vec<PlanProposal>> {
        self.reap(db)?;
        let mut stmt = db.conn().prepare_cached(
            "SELECT request_id, session_id, turn_id, tool_call_id, plan_json, status,
                    created_at, expires_at, resolved_at, action,
                    target_permission_mode, feedback, error_code
             FROM plan_approvals
             WHERE status = 'pending'
               AND (?1 IS NULL OR session_id = ?1)
             ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![session_id], proposal_from_row)?;
        let mut out = Vec::new();
        for row in rows {
            let proposal = row?;
            if self
                .pending
                .get(&proposal.id)
                .is_some_and(|pending| !pending.tx.is_closed())
            {
                out.push(proposal);
            }
        }
        Ok(out)
    }

    pub fn state_for_session(&mut self, db: &Database, session_id: &str) -> Result<String> {
        let Some(mode) = sessions::session_mode(db, session_id)? else {
            return Err(plan_error("PLAN_SESSION_NOT_FOUND"));
        };
        if mode == "agent" {
            return Ok("inactive".into());
        }
        if !self.pending_for_session(db, Some(session_id))?.is_empty() {
            return Ok("awaiting_approval".into());
        }
        Ok("planning".into())
    }

    /// Recover a terminal result when the waiting receiver was dropped after
    /// the durable transition committed (for example, a timeout sweep raced
    /// the RPC task). Pending rows are deliberately not exposed here.
    pub fn resolution_for(
        &self,
        db: &Database,
        proposal_id: &str,
    ) -> Result<Option<PlanResolution>> {
        let Some(proposal) = get_proposal(db, proposal_id)? else {
            return Ok(None);
        };
        if proposal.status == STATUS_PENDING {
            return Ok(None);
        }
        Ok(Some(PlanResolution {
            status: proposal.status.clone(),
            action: proposal.action.clone(),
            target_permission_mode: proposal.target_permission_mode.clone(),
            feedback: proposal.feedback.clone(),
            proposal,
        }))
    }

    pub fn resolve(
        &mut self,
        db: &Database,
        proposal_id: &str,
        session_id: &str,
        turn_id: &str,
        tool_call_id: &str,
        action: &str,
        target_permission_mode: Option<&str>,
        feedback: Option<&str>,
    ) -> Result<PlanResolution> {
        self.reap(db)?;
        let Some(current) = get_proposal(db, proposal_id)? else {
            return Err(plan_error("PLAN_NOT_FOUND"));
        };
        let Some(waiter) = self.pending.get(proposal_id) else {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        };
        if waiter.tx.is_closed()
            || current.status != STATUS_PENDING
            || current.session_id != session_id
            || current.turn_id != turn_id
            || current.tool_call_id != tool_call_id
        {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        if !matches!(action, "approve" | "request_changes" | "reject") {
            return Err(plan_error("PLAN_INVALID_ACTION"));
        }
        let selected = target_permission_mode.unwrap_or("ask");
        if action == "approve" && !valid_permission_mode(selected) {
            return Err(plan_error("PLAN_PERMISSION_MODE_INVALID"));
        }
        let feedback = feedback.map(str::trim).filter(|value| !value.is_empty());
        if action == "request_changes" && feedback.is_none() {
            return Err(plan_error("PLAN_FEEDBACK_REQUIRED"));
        }

        let now = now_ms();
        let status = match action {
            "approve" => STATUS_APPROVED,
            "request_changes" => STATUS_CHANGES_REQUESTED,
            _ => STATUS_REJECTED,
        };
        let tx = db.conn().unchecked_transaction()?;
        if action == "approve" {
            let changed = tx
                .prepare_cached(
                    "UPDATE sessions
                     SET mode = 'agent', permission_mode = ?1, updated_at = ?2
                     WHERE id = ?3 AND mode = 'plan'",
                )?
                .execute(params![selected, now, current.session_id])?;
            if changed == 0 {
                return Err(plan_error("PLAN_NOT_ACTIVE"));
            }
        }
        let changed = tx
            .prepare_cached(
                "UPDATE plan_approvals
                 SET status = ?1, action = ?2, target_permission_mode = ?3,
                     feedback = ?4, resolved_at = ?5, error_code = NULL
                 WHERE request_id = ?6 AND session_id = ?7 AND turn_id = ?8
                   AND tool_call_id = ?9 AND status = 'pending'",
            )?
            .execute(params![
                status,
                action,
                (action == "approve").then_some(selected),
                feedback,
                now,
                proposal_id,
                session_id,
                turn_id,
                tool_call_id,
            ])?;
        if changed != 1 {
            return Err(plan_error("PLAN_APPROVAL_STALE"));
        }
        audit::append_tx(
            &tx,
            "plan_approval_resolved",
            Some(session_id),
            json!({
                "proposalId": proposal_id,
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": tool_call_id,
                "action": action,
                "status": status,
                "targetPermissionMode": (action == "approve").then_some(selected),
                "feedback": feedback,
            }),
        )?;
        tx.commit()?;

        let proposal =
            get_proposal(db, proposal_id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?;
        let resolution = PlanResolution {
            status: status.into(),
            proposal,
            action: Some(action.into()),
            target_permission_mode: (action == "approve").then_some(selected.into()),
            feedback: feedback.map(str::to_string),
        };
        let pending = self
            .pending
            .remove(proposal_id)
            .ok_or_else(|| plan_error("PLAN_APPROVAL_STALE"))?;
        let _ = pending.tx.send(resolution.clone());
        Ok(resolution)
    }

    fn finish_pending(
        &mut self,
        db: &Database,
        proposal_id: &str,
        status: &str,
        error_code: &str,
    ) -> Result<Option<PlanResolution>> {
        let Some(current) = get_proposal(db, proposal_id)? else {
            self.pending.remove(proposal_id);
            return Ok(None);
        };
        if current.status != STATUS_PENDING || !self.pending.contains_key(proposal_id) {
            return Ok(None);
        }
        if !persist_terminal_status(db, &current, status, error_code)? {
            return Ok(None);
        }
        let proposal =
            get_proposal(db, proposal_id)?.ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?;
        let resolution = PlanResolution {
            status: status.into(),
            proposal,
            action: None,
            target_permission_mode: None,
            feedback: None,
        };
        if let Some(pending) = self.pending.remove(proposal_id) {
            let _ = pending.tx.send(resolution.clone());
        }
        Ok(Some(resolution))
    }

    pub fn abort_session(&mut self, db: &Database, session_id: &str) -> Result<bool> {
        self.reap(db)?;
        let ids = self
            .pending
            .iter()
            .filter_map(|(id, _)| {
                get_proposal(db, id)
                    .ok()
                    .flatten()
                    .filter(|proposal| proposal.session_id == session_id)
                    .map(|_| id.clone())
            })
            .collect::<Vec<_>>();
        let mut changed = false;
        for id in ids {
            changed |= self
                .finish_pending(db, &id, STATUS_INTERRUPTED, "PLAN_APPROVAL_INTERRUPTED")?
                .is_some();
        }
        Ok(changed)
    }

    pub fn timeout(&mut self, db: &Database, proposal_id: &str) -> Result<Option<PlanResolution>> {
        self.finish_pending(db, proposal_id, STATUS_EXPIRED, "PLAN_APPROVAL_TIMEOUT")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap();
        Database::open(&dir.path().join("pi.sqlite")).unwrap()
    }

    fn live_turn(db: &Database, session_id: &str) -> String {
        sessions::begin_turn(db, session_id, None, None).unwrap()
    }

    #[tokio::test]
    async fn approval_atomically_enters_agent_and_persists_permission_mode() {
        let db = test_db();
        let session =
            sessions::create_session(&db, None, Some("plan".into()), None, None, None).unwrap();
        let turn_id = live_turn(&db, &session.id);
        let mut manager = PlanManager::default();
        let (proposal, receiver) = manager
            .submit(
                &db,
                &session.id,
                &turn_id,
                "exit-call-1",
                "implement the change",
            )
            .unwrap();
        assert_eq!(proposal.status, STATUS_PENDING);
        assert_eq!(proposal.session_id, session.id);
        assert_eq!(proposal.turn_id, turn_id);
        assert_eq!(proposal.tool_call_id, "exit-call-1");
        let result = manager
            .resolve(
                &db,
                &proposal.id,
                &session.id,
                &turn_id,
                "exit-call-1",
                "approve",
                Some("auto"),
                None,
            )
            .unwrap();
        assert_eq!(result.status, STATUS_APPROVED);
        assert_eq!(
            receiver.await.unwrap().target_permission_mode.as_deref(),
            Some("auto")
        );
        let stored = sessions::get_session(&db, &session.id).unwrap().unwrap();
        assert_eq!(stored.summary.mode, "agent");
        assert_eq!(stored.summary.permission_mode, "auto");
        let audit_count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE kind = 'plan_approval_resolved'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(audit_count, 1);
    }

    #[tokio::test]
    async fn identity_mismatch_and_duplicate_resolution_are_stale() {
        let db = test_db();
        let session =
            sessions::create_session(&db, None, Some("plan".into()), None, None, None).unwrap();
        let turn_id = live_turn(&db, &session.id);
        let mut manager = PlanManager::default();
        let (proposal, receiver) = manager
            .submit(&db, &session.id, &turn_id, "exit-call-1", "plan")
            .unwrap();
        assert_eq!(
            manager
                .resolve(
                    &db,
                    &proposal.id,
                    &session.id,
                    "wrong-turn",
                    "exit-call-1",
                    "approve",
                    Some("ask"),
                    None,
                )
                .unwrap_err()
                .to_string(),
            "PLAN_APPROVAL_STALE"
        );
        let result = manager
            .resolve(
                &db,
                &proposal.id,
                &session.id,
                &turn_id,
                "exit-call-1",
                "request_changes",
                None,
                Some("include validation"),
            )
            .unwrap();
        assert_eq!(result.status, STATUS_CHANGES_REQUESTED);
        assert_eq!(receiver.await.unwrap().status, STATUS_CHANGES_REQUESTED);
        assert!(manager
            .resolve(
                &db,
                &proposal.id,
                &session.id,
                &turn_id,
                "exit-call-1",
                "approve",
                Some("ask"),
                None,
            )
            .is_err());
    }

    #[tokio::test]
    async fn timeout_and_abort_are_terminal_and_not_actionable() {
        let db = test_db();
        let session =
            sessions::create_session(&db, None, Some("plan".into()), None, None, None).unwrap();
        let turn_id = live_turn(&db, &session.id);
        let mut manager = PlanManager::default();
        let (proposal, receiver) = manager
            .submit(&db, &session.id, &turn_id, "exit-call-1", "plan")
            .unwrap();
        assert!(manager.timeout(&db, &proposal.id).unwrap().is_some());
        assert_eq!(receiver.await.unwrap().status, STATUS_EXPIRED);
        assert!(manager.timeout(&db, &proposal.id).unwrap().is_none());

        let (second, receiver) = manager
            .submit(&db, &session.id, &turn_id, "exit-call-2", "plan 2")
            .unwrap();
        assert!(manager.abort_session(&db, &session.id).unwrap());
        assert_eq!(receiver.await.unwrap().status, STATUS_INTERRUPTED);
        assert_eq!(second.status, STATUS_PENDING);
    }

    #[tokio::test]
    async fn enter_requires_agent_and_persists_plan() {
        let db = test_db();
        let session = sessions::create_session(&db, None, None, None, None, None).unwrap();
        let mut manager = PlanManager::default();
        manager.enter(&db, &session.id).unwrap();
        assert_eq!(
            sessions::session_mode(&db, &session.id).unwrap().as_deref(),
            Some("plan")
        );
        assert!(manager.enter(&db, &session.id).is_err());
    }

    #[test]
    fn restart_invalidates_a_pending_approval() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.sqlite");
        let session_id;
        let proposal_id;
        {
            let db = Database::open(&path).unwrap();
            let session =
                sessions::create_session(&db, None, Some("plan".into()), None, None, None).unwrap();
            session_id = session.id;
            let turn_id = live_turn(&db, &session_id);
            let mut manager = PlanManager::default();
            let (proposal, _receiver) = manager
                .submit(&db, &session_id, &turn_id, "exit-call-1", "stale")
                .unwrap();
            proposal_id = proposal.id;
        }

        let db = Database::open(&path).unwrap();
        let status: String = db
            .conn()
            .query_row(
                "SELECT status FROM plan_approvals WHERE request_id = ?1",
                params![proposal_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, STATUS_INTERRUPTED);
        let mut manager = PlanManager::default();
        assert!(manager
            .pending_for_session(&db, Some(&session_id))
            .unwrap()
            .is_empty());
    }
}
