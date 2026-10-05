//! Host RPC for Plan schedule bookkeeping (`plans.markMissedSchedules`,
//! `dueSchedules`, `claimSchedule`, `cancelSchedule`, `markScheduleMissed`,
//! `markRevisionFailed`) and the durable turn read `session.getTurn`.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

use super::{emit_notification, plan_rpc_err, rpc_err, AppState, JsonRpcError};
use crate::{plans, sessions};

#[cfg(test)]
#[path = "plan_schedule_grace_tests.rs"]
mod grace_tests;

async fn notify_schedule_change(tx: &mpsc::UnboundedSender<String>, proposal: plans::PlanProposal) {
    emit_notification(
        tx,
        "plans.changed",
        json!({
            "sessionId": proposal.session_id,
            "proposalId": proposal.id,
            "state": "inactive",
            "kind": proposal.kind,
            "proposal": proposal,
        }),
    )
    .await;
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    handle_with_clock(state, method, params, tx, crate::db::now_ms).await
}

async fn handle_with_clock(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
    now_ms: impl Fn() -> i64,
) -> Result<Value, JsonRpcError> {
    match method {
        "plans.markMissedSchedules" => {
            let (proposal_ids, proposals) = {
                let st = state.lock().await;
                let now = params
                    .get("nowMs")
                    .and_then(Value::as_i64)
                    .unwrap_or_else(&now_ms);
                let proposal_ids = st
                    .plans
                    .mark_overdue_schedules_missed(&st.db, now)
                    .map_err(plan_rpc_err)?;
                let proposals = proposal_ids
                    .iter()
                    .map(|id| {
                        plans::get_proposal(&st.db, id)
                            .map_err(plan_rpc_err)?
                            .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))
                    })
                    .collect::<std::result::Result<Vec<_>, JsonRpcError>>()?;
                (proposal_ids, proposals)
            };
            for proposal in proposals {
                notify_schedule_change(&tx, proposal).await;
            }
            Ok(json!({ "proposalIds": proposal_ids }))
        }
        "plans.dueSchedules" => {
            let st = state.lock().await;
            let now = params
                .get("nowMs")
                .and_then(Value::as_i64)
                .unwrap_or_else(&now_ms);
            let missed_ids = st
                .plans
                .mark_delayed_schedules_missed(&st.db, now)
                .map_err(plan_rpc_err)?;
            let missed = missed_ids
                .iter()
                .map(|id| {
                    plans::get_proposal(&st.db, id)
                        .map_err(plan_rpc_err)?
                        .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let proposal_ids = st.plans.due_schedules(&st.db, now).map_err(plan_rpc_err)?;
            let schedules = proposal_ids
                .iter()
                .map(|id| {
                    let proposal = plans::get_proposal(&st.db, id)
                        .map_err(plan_rpc_err)?
                        .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))?;
                    Ok(json!({ "proposalId": id, "sessionId": proposal.session_id }))
                })
                .collect::<std::result::Result<Vec<_>, JsonRpcError>>()?;
            let next_due_at = st.plans.next_due_at(&st.db, now).map_err(plan_rpc_err)?;
            drop(st);
            for proposal in missed {
                notify_schedule_change(&tx, proposal).await;
            }
            Ok(json!({ "schedules": schedules, "nextDueAt": next_due_at }))
        }
        "plans.claimSchedule" => {
            let proposal_id = params
                .get("proposalId")
                .and_then(|v| v.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "proposalId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let allow_missed = params
                .get("allowMissed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let (result, missed) = {
                let st = state.lock().await;
                let now = params
                    .get("nowMs")
                    .and_then(Value::as_i64)
                    .unwrap_or_else(&now_ms);
                let proposal = plans::get_proposal(&st.db, proposal_id)
                    .map_err(plan_rpc_err)?
                    .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))?;
                if proposal.session_id != session_id {
                    return Err(plan_rpc_err("PLAN_APPROVAL_STALE"));
                }
                let result = st
                    .plans
                    .claim_schedule(&st.db, proposal_id, now, allow_missed);
                let missed = if proposal.schedule_state.as_deref() == Some("scheduled")
                    && result
                        .as_ref()
                        .is_err_and(|error| error.to_string() == "PLAN_SCHEDULE_MISSED")
                {
                    plans::get_proposal(&st.db, proposal_id).map_err(plan_rpc_err)?
                } else {
                    None
                };
                (result, missed)
            };
            if let Some(proposal) = missed {
                notify_schedule_change(&tx, proposal).await;
            }
            let execution = result.map_err(plan_rpc_err)?;
            emit_notification(
                &tx,
                "plans.changed",
                json!({
                    "sessionId": execution.session_id,
                    "proposalId": execution.proposal_id,
                    "state": "inactive",
                    "kind": execution.kind,
                    "execution": execution,
                }),
            )
            .await;
            Ok(json!({ "execution": execution }))
        }
        "plans.cancelSchedule" => {
            let proposal_id = params
                .get("proposalId")
                .and_then(|v| v.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "proposalId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let (cancelled, proposal) = {
                let st = state.lock().await;
                let proposal = plans::get_proposal(&st.db, proposal_id)
                    .map_err(plan_rpc_err)?
                    .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))?;
                if proposal.session_id != session_id {
                    return Err(plan_rpc_err("PLAN_APPROVAL_STALE"));
                }
                let cancelled = st
                    .plans
                    .cancel_schedule(&st.db, proposal_id)
                    .map_err(plan_rpc_err)?;
                let proposal = plans::get_proposal(&st.db, proposal_id).map_err(plan_rpc_err)?;
                (cancelled, proposal)
            };
            if cancelled {
                if let Some(ref proposal) = proposal {
                    emit_notification(
                        &tx,
                        "plans.changed",
                        json!({
                            "sessionId": proposal.session_id,
                            "proposalId": proposal.id,
                            "state": "inactive",
                            "kind": proposal.kind,
                            "proposal": proposal,
                        }),
                    )
                    .await;
                }
            }
            Ok(json!({ "cancelled": cancelled, "proposal": proposal }))
        }
        "plans.markScheduleMissed" => {
            let proposal_id = params
                .get("proposalId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "proposalId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let (changed, proposal) = {
                let st = state.lock().await;
                let proposal = plans::get_proposal(&st.db, proposal_id)
                    .map_err(plan_rpc_err)?
                    .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))?;
                if proposal.session_id != session_id {
                    return Err(plan_rpc_err("PLAN_APPROVAL_STALE"));
                }
                let changed = st
                    .plans
                    .miss_schedule(&st.db, proposal_id, crate::db::now_ms())
                    .map_err(plan_rpc_err)?;
                let updated = plans::get_proposal(&st.db, proposal_id).map_err(plan_rpc_err)?;
                (changed, updated)
            };
            if changed {
                if let Some(ref proposal) = proposal {
                    emit_notification(
                        &tx,
                        "plans.changed",
                        json!({
                            "sessionId": session_id, "proposalId": proposal_id,
                            "state": "inactive", "kind": proposal.kind, "proposal": proposal,
                        }),
                    )
                    .await;
                }
            }
            Ok(json!({ "changed": changed, "proposal": proposal }))
        }
        "plans.markRevisionFailed" => {
            let proposal_id = params
                .get("proposalId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "proposalId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let error_code = params
                .get("errorCode")
                .and_then(Value::as_str)
                .unwrap_or("PLAN_REVISION_FAILED");
            let (changed, proposal) = {
                let st = state.lock().await;
                let changed = st
                    .plans
                    .mark_revision_failed(&st.db, proposal_id, session_id, error_code)
                    .map_err(plan_rpc_err)?;
                let proposal = plans::get_proposal(&st.db, proposal_id).map_err(plan_rpc_err)?;
                (changed, proposal)
            };
            if changed {
                if let Some(ref proposal) = proposal {
                    emit_notification(
                        &tx,
                        "plans.changed",
                        json!({
                            "sessionId": session_id, "proposalId": proposal_id,
                            "state": "planning", "kind": proposal.kind, "proposal": proposal,
                        }),
                    )
                    .await;
                }
            }
            Ok(json!({ "changed": changed, "proposal": proposal }))
        }
        "session.getTurn" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let turn_id = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| rpc_err(1002, "turnId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let turn = sessions::get_turn_state(&st.db, session_id, turn_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            match turn {
                Some(turn) => {
                    serde_json::to_value(turn).map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))
                }
                None => Err(rpc_err(1007, "turn not found", "NOT_FOUND")),
            }
        }
        _ => Err(rpc_err(
            -32601,
            format!("method not found: {method}"),
            "NOT_FOUND",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn due_schedules_returns_additive_next_deadline_and_honors_now_ms() {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
        let (tx, _rx) = mpsc::unbounded_channel();
        assert_eq!(
            handle(
                state.clone(),
                "plans.dueSchedules",
                json!({ "nowMs": 1_000 }),
                tx.clone()
            )
            .await
            .unwrap(),
            json!({ "schedules": [], "nextDueAt": null })
        );
        let workspace = dir.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        let proposal = {
            let st = state.lock().await;
            let session = sessions::create_session(
                &st.db,
                None,
                Some("plan".into()),
                None,
                None,
                Some(workspace.to_string_lossy().into_owned()),
            )
            .unwrap();
            let turn = sessions::begin_turn(&st.db, &session.id, None, None).unwrap();
            let proposal = st
                .plans
                .submit(
                    &st.db,
                    plans::PlanSubmitParams {
                        workspace_root: &workspace,
                        session_id: &session.id,
                        turn_id: &turn,
                        tool_call_id: "rpc-schedule-test",
                        kind: "plan",
                        title: "Plan",
                        markdown: "# Plan",
                        question: "Proceed?",
                        artifact_workspace_kind: "project",
                    },
                )
                .unwrap();
            st.db
                .conn()
                .execute(
                    "UPDATE plan_approvals SET status = 'approved' WHERE request_id = ?1",
                    rusqlite::params![proposal.id],
                )
                .unwrap();
            st.db.conn().execute("INSERT INTO plan_execution_schedules (proposal_id, scheduled_for, timezone, state, updated_at) VALUES (?1, 2_000, 'UTC', 'scheduled', 1)", rusqlite::params![proposal.id]).unwrap();
            proposal
        };
        assert_eq!(
            handle(
                state.clone(),
                "plans.dueSchedules",
                json!({ "nowMs": 1_999 }),
                tx.clone()
            )
            .await
            .unwrap(),
            json!({ "schedules": [], "nextDueAt": 2_000 })
        );
        assert_eq!(
            handle(state, "plans.dueSchedules", json!({ "nowMs": 2_000 }), tx)
                .await
                .unwrap(),
            json!({ "schedules": [{ "proposalId": proposal.id, "sessionId": proposal.session_id }], "nextDueAt": null })
        );
    }
}
