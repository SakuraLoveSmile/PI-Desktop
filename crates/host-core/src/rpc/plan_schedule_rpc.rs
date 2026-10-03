//! Host RPC for Plan schedule bookkeeping (`plans.markMissedSchedules`,
//! `dueSchedules`, `claimSchedule`, `cancelSchedule`, `markScheduleMissed`,
//! `markRevisionFailed`) and the durable turn read `session.getTurn`.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

use super::{emit_notification, plan_rpc_err, rpc_err, AppState, JsonRpcError};
use crate::{plans, sessions};

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    match method {
        "plans.markMissedSchedules" => {
            let now = params
                .get("nowMs")
                .and_then(|v| v.as_i64())
                .unwrap_or_else(crate::db::now_ms);
            let (proposal_ids, proposals) = {
                let st = state.lock().await;
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
            Ok(json!({ "proposalIds": proposal_ids }))
        }
        "plans.dueSchedules" => {
            let now = params
                .get("nowMs")
                .and_then(|v| v.as_i64())
                .unwrap_or_else(crate::db::now_ms);
            let st = state.lock().await;
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
            Ok(json!({ "schedules": schedules }))
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
            let now = params
                .get("nowMs")
                .and_then(|v| v.as_i64())
                .unwrap_or_else(crate::db::now_ms);
            let allow_missed = params
                .get("allowMissed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let execution = {
                let st = state.lock().await;
                let proposal = plans::get_proposal(&st.db, proposal_id)
                    .map_err(plan_rpc_err)?
                    .ok_or_else(|| plan_rpc_err("PLAN_NOT_FOUND"))?;
                if proposal.session_id != session_id {
                    return Err(plan_rpc_err("PLAN_APPROVAL_STALE"));
                }
                st.plans
                    .claim_schedule(&st.db, proposal_id, now, allow_missed)
                    .map_err(plan_rpc_err)?
            };
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
