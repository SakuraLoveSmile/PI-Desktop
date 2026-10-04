use super::*;

#[cfg(test)]
#[path = "schedule_tests.rs"]
mod schedule_tests;

const SCHEDULED: &str = "scheduled";
const MISSED: &str = "missed";
const CLAIMED: &str = "claimed";
const CANCELLED: &str = "cancelled";
const ELIGIBLE_SCHEDULE: &str =
    "s.state = ?1 AND p.status = 'approved' AND p.execution_state IS NULL";

/// Mark due schedules as missed. This is intentionally a separate operation
/// from `due_schedules`: callers that are running the host can claim due work,
/// while restart maintenance can mark work that was not observed as missed.
impl PlanManager {
    pub fn mark_overdue_schedules_missed(&self, db: &Database, now_ms: i64) -> Result<Vec<String>> {
        let tx = db.conn().unchecked_transaction()?;
        let proposal_ids = {
            let mut stmt = tx.prepare_cached(
                "SELECT proposal_id
                 FROM plan_execution_schedules
                 WHERE state = ?1 AND scheduled_for <= ?2
                 ORDER BY scheduled_for ASC, proposal_id ASC",
            )?;
            let rows = stmt.query_map(params![SCHEDULED, now_ms], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<Vec<String>>>()?
        };

        if !proposal_ids.is_empty() {
            tx.execute(
                "UPDATE plan_execution_schedules
                 SET state = ?1, updated_at = ?2
                 WHERE state = ?3 AND scheduled_for <= ?2",
                params![MISSED, now_ms, SCHEDULED],
            )?;
            for proposal_id in &proposal_ids {
                audit::append_tx(
                    &tx,
                    "plan_execution_schedule_missed",
                    None,
                    json!({
                        "proposalId": proposal_id,
                        "state": MISSED,
                        "reason": "overdue"
                    }),
                )?;
            }
        }
        tx.commit()?;
        Ok(proposal_ids)
    }

    /// Return approved schedules that are due and have not been claimed.
    pub fn due_schedules(&self, db: &Database, now_ms: i64) -> Result<Vec<String>> {
        let sql = format!(
            "SELECT s.proposal_id
             FROM plan_execution_schedules s
             JOIN plan_approvals p ON p.request_id = s.proposal_id
             WHERE {ELIGIBLE_SCHEDULE} AND s.scheduled_for <= ?2
             ORDER BY s.scheduled_for ASC, s.proposal_id ASC"
        );
        let mut stmt = db.conn().prepare_cached(&sql)?;
        let rows = stmt.query_map(params![SCHEDULED, now_ms], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
    }

    /// Return the earliest eligible future deadline; due work is returned separately.
    pub fn next_due_at(&self, db: &Database, now_ms: i64) -> Result<Option<i64>> {
        let sql = format!(
            "SELECT MIN(s.scheduled_for)
             FROM plan_execution_schedules s
             JOIN plan_approvals p ON p.request_id = s.proposal_id
             WHERE {ELIGIBLE_SCHEDULE} AND s.scheduled_for > ?2"
        );
        Ok(db
            .conn()
            .prepare_cached(&sql)?
            .query_row(params![SCHEDULED, now_ms], |row| row.get(0))?)
    }

    /// Atomically claim one schedule and create its queued execution record.
    /// `allow_missed` is reserved for an explicit user-triggered run after a
    /// restart; it never causes the scheduler to catch up automatically.
    pub fn claim_schedule(
        &self,
        db: &Database,
        proposal_id: &str,
        now_ms: i64,
        allow_missed: bool,
    ) -> Result<PlanExecution> {
        if proposal_id.trim().is_empty() {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        }
        let tx = db.conn().unchecked_transaction()?;
        let schedule_state = tx
            .query_row(
                "SELECT state FROM plan_execution_schedules WHERE proposal_id = ?1",
                params![proposal_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| plan_error("PLAN_SCHEDULE_NOT_FOUND"))?;
        let allowed_state = if allow_missed {
            schedule_state == SCHEDULED || schedule_state == MISSED
        } else {
            schedule_state == SCHEDULED
        };
        if !allowed_state {
            return Err(plan_error(if schedule_state == MISSED {
                "PLAN_SCHEDULE_MISSED"
            } else {
                "PLAN_SCHEDULE_STALE"
            }));
        }

        let proposal = {
            let sql =
                format!("SELECT {PROPOSAL_COLUMNS} FROM plan_approvals WHERE request_id = ?1");
            tx.prepare_cached(&sql)
                .and_then(|mut stmt| stmt.query_row(params![proposal_id], proposal_from_row))
                .optional()?
                .ok_or_else(|| plan_error("PLAN_NOT_FOUND"))?
        };
        if proposal.status != STATUS_APPROVED || proposal.execution_state.is_some() {
            return Err(plan_error("PLAN_SCHEDULE_STALE"));
        }
        let session_busy: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM plan_approvals
                 WHERE session_id = ?1 AND request_id != ?2
                   AND (status = 'pending' OR execution_state IN ('queued', 'running')))
              OR EXISTS(SELECT 1 FROM turns WHERE session_id = ?1 AND status = 'running')
              OR NOT EXISTS(SELECT 1 FROM sessions WHERE id = ?1 AND mode = 'agent')",
            params![proposal.session_id, proposal_id],
            |row| row.get(0),
        )?;
        if session_busy {
            return Err(plan_error("PLAN_SCHEDULE_SESSION_BUSY"));
        }
        let permission_mode = proposal
            .target_permission_mode
            .as_deref()
            .ok_or_else(|| plan_error("PLAN_PERMISSION_MODE_REQUIRED"))?;
        if schedule_state == SCHEDULED {
            let scheduled_for: i64 = tx.query_row(
                "SELECT scheduled_for FROM plan_execution_schedules WHERE proposal_id = ?1",
                params![proposal_id],
                |row| row.get(0),
            )?;
            if scheduled_for > now_ms {
                return Err(plan_error("PLAN_SCHEDULE_NOT_DUE"));
            }
        }

        let execution_id = Uuid::new_v4().to_string();
        let changed = tx.execute(
            "UPDATE plan_execution_schedules
             SET state = ?1, updated_at = ?2
             WHERE proposal_id = ?3 AND state = ?4",
            params![CLAIMED, now_ms, proposal_id, schedule_state],
        )?;
        if changed != 1 {
            return Err(plan_error("PLAN_SCHEDULE_STALE"));
        }
        let changed = tx.execute(
            "UPDATE plan_approvals
             SET execution_id = ?1, execution_state = ?2,
                 updated_at = ?3, version = version + 1
             WHERE request_id = ?4 AND status = 'approved'
               AND execution_state IS NULL",
            params![execution_id, EXECUTION_QUEUED, now_ms, proposal_id],
        )?;
        if changed != 1 {
            return Err(plan_error("PLAN_SCHEDULE_STALE"));
        }
        let updated_session = tx.execute(
            "UPDATE sessions SET permission_mode = ?1, updated_at = ?2
             WHERE id = ?3 AND mode = 'agent'",
            params![permission_mode, now_ms, proposal.session_id],
        )?;
        if updated_session != 1 {
            return Err(plan_error("PLAN_SCHEDULE_SESSION_BUSY"));
        }
        audit::append_tx(
            &tx,
            "plan_execution_schedule_claimed",
            Some(&proposal.session_id),
            json!({
                "proposalId": proposal_id,
                "executionId": execution_id,
                "state": CLAIMED,
                "executionState": EXECUTION_QUEUED,
                "allowMissed": allow_missed
            }),
        )?;

        let sql = format!("SELECT {PROPOSAL_COLUMNS} FROM plan_approvals WHERE request_id = ?1");
        let claimed = tx
            .prepare_cached(&sql)?
            .query_row(params![proposal_id], proposal_from_row)?;
        let execution = execution_from_proposal(&claimed)?
            .ok_or_else(|| plan_error("PLAN_EXECUTION_NOT_FOUND"))?;
        tx.commit()?;
        Ok(execution)
    }

    /// Cancel an unclaimed one-time schedule. Claimed schedules are owned by
    /// the normal execution stop/finish path and therefore return false.
    pub fn cancel_schedule(&self, db: &Database, proposal_id: &str) -> Result<bool> {
        if proposal_id.trim().is_empty() {
            return Err(plan_error("PLAN_INVALID_ARGUMENT"));
        }
        let now = now_ms();
        let tx = db.conn().unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE plan_execution_schedules
             SET state = ?1, updated_at = ?2
             WHERE proposal_id = ?3 AND state IN (?4, ?5)",
            params![CANCELLED, now, proposal_id, SCHEDULED, MISSED],
        )?;
        if changed == 1 {
            audit::append_tx(
                &tx,
                "plan_execution_schedule_cancelled",
                None,
                json!({"proposalId": proposal_id, "state": CANCELLED}),
            )?;
        }
        tx.commit()?;
        Ok(changed == 1)
    }

    pub fn miss_schedule(&self, db: &Database, proposal_id: &str, now_ms: i64) -> Result<bool> {
        let tx = db.conn().unchecked_transaction()?;
        let changed = tx.execute(
            "UPDATE plan_execution_schedules SET state = ?1, updated_at = ?2
             WHERE proposal_id = ?3 AND state = ?4 AND scheduled_for <= ?2",
            params![MISSED, now_ms, proposal_id, SCHEDULED],
        )?;
        if changed == 1 {
            audit::append_tx(
                &tx,
                "plan_execution_schedule_missed",
                None,
                json!({ "proposalId": proposal_id, "state": MISSED, "reason": "session_busy" }),
            )?;
        }
        tx.commit()?;
        Ok(changed == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add_schedule(db: &Database, session_id: &str, id: &str, at: i64) {
        db.conn().execute(
            "INSERT INTO plan_approvals
             (request_id, session_id, turn_id, tool_call_id, plan_json, status, created_at, updated_at)
             VALUES (?1, ?2, 'turn', ?1, '# plan', 'approved', 1, 1)",
            params![id, session_id],
        ).unwrap();
        db.conn()
            .execute(
                "INSERT INTO plan_execution_schedules
             (proposal_id, scheduled_for, timezone, state, updated_at)
             VALUES (?1, ?2, 'UTC', 'scheduled', 1)",
                params![id, at],
            )
            .unwrap();
    }

    #[test]
    fn next_due_at_shares_due_eligibility_and_excludes_the_due_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
        let session = sessions::create_session(&db, None, None, None, None, None).unwrap();
        let manager = PlanManager;
        assert_eq!(manager.next_due_at(&db, 1_000).unwrap(), None);
        add_schedule(&db, &session.id, "later", 3_000);
        add_schedule(&db, &session.id, "next", 2_000);
        add_schedule(&db, &session.id, "due", 1_000);
        add_schedule(&db, &session.id, "past", 999);
        assert_eq!(manager.next_due_at(&db, 1_000).unwrap(), Some(2_000));
        assert_eq!(
            manager.due_schedules(&db, 1_000).unwrap(),
            vec!["past", "due"]
        );
        for state in [MISSED, CLAIMED, CANCELLED] {
            db.conn()
                .execute(
                    "UPDATE plan_execution_schedules SET state = ?1 WHERE proposal_id = 'next'",
                    params![state],
                )
                .unwrap();
            assert_eq!(manager.next_due_at(&db, 1_000).unwrap(), Some(3_000));
        }
        db.conn().execute("UPDATE plan_execution_schedules SET state = 'scheduled' WHERE proposal_id = 'next'", []).unwrap();
        for status in [
            STATUS_PENDING,
            STATUS_REJECTED,
            STATUS_CHANGES_REQUESTED,
            STATUS_EXPIRED,
            STATUS_INTERRUPTED,
        ] {
            db.conn()
                .execute(
                    "UPDATE plan_approvals SET status = ?1 WHERE request_id = 'next'",
                    params![status],
                )
                .unwrap();
            assert_eq!(manager.next_due_at(&db, 1_000).unwrap(), Some(3_000));
        }
        db.conn()
            .execute(
                "UPDATE plan_approvals SET status = 'approved' WHERE request_id = 'next'",
                [],
            )
            .unwrap();
        for state in [
            EXECUTION_QUEUED,
            EXECUTION_RUNNING,
            EXECUTION_COMPLETED,
            EXECUTION_INTERRUPTED,
        ] {
            db.conn()
                .execute(
                    "UPDATE plan_approvals SET execution_state = ?1 WHERE request_id = 'next'",
                    params![state],
                )
                .unwrap();
            assert_eq!(manager.next_due_at(&db, 1_000).unwrap(), Some(3_000));
        }
        assert_eq!(manager.next_due_at(&db, 3_000).unwrap(), None);
    }
}
