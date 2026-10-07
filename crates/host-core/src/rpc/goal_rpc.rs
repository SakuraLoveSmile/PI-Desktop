//! Host RPC for Goal reports (`goalReports.*`) and Goal progress
//! (`goalProgress.*`).
//!
//! Each arm takes the state lock itself; the arms that emit a notification
//! release it before awaiting `emit_notification`.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};

use super::{emit_notification, rpc_err, AppState, JsonRpcError};

fn goal_report_rpc_err(error: impl ToString) -> JsonRpcError {
    let message = error.to_string();
    if message.starts_with("PERMISSION_DENIED:") {
        return rpc_err(
            1007,
            "goal report was not found for this session",
            "NOT_FOUND",
        );
    }
    if message.starts_with("GOAL_EXECUTION_NOT_TERMINAL") {
        return rpc_err(
            1002,
            "goal execution has not completed or report status does not match completion",
            "GOAL_EXECUTION_NOT_TERMINAL",
        );
    }
    rpc_err(1000, message, "INTERNAL")
}

fn goal_progress_rpc_err(error: impl ToString) -> JsonRpcError {
    let message = error.to_string();
    if message.starts_with("UNAUTHORIZED") {
        return rpc_err(1007, message, "UNAUTHORIZED");
    }
    if message.starts_with("GOAL_PROGRESS_NOT_RUNNING") {
        return rpc_err(1002, message, "GOAL_PROGRESS_NOT_RUNNING");
    }
    if message.starts_with("CONFLICT") {
        return rpc_err(1008, message, "CONFLICT");
    }
    if message.starts_with("INVALID_ARGUMENT") {
        return rpc_err(1002, message, "INVALID_PARAMS");
    }
    rpc_err(1000, message, "INTERNAL")
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
    tx: mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    match method {
        "goalReports.bindExecutionTurn" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let turn_id = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "turnId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            crate::goal_reports::bind_execution_turn(&st.db, execution_id, turn_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "goalReports.markFailed" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let error_code = params
                .get("errorCode")
                .and_then(|v| v.as_str())
                .filter(|code| !code.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "errorCode required", "INVALID_PARAMS"))?;
            let summary = {
                let st = state.lock().await;
                crate::goal_reports::mark_failed(&st.db, session_id, execution_id, error_code)
                    .map_err(goal_report_rpc_err)?
            };
            emit_notification(
                &tx,
                "goalReports.changed",
                json!({
                    "sessionId": summary.session_id,
                    "reportId": summary.report_id,
                    "executionId": summary.execution_id,
                    "proposalId": summary.proposal_id,
                    "status": summary.status,
                    "integrity": summary.integrity,
                    "verdict": summary.verdict,
                }),
            )
            .await;
            Ok(json!({ "report": summary }))
        }
        "goalReports.invalidateDraft" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            crate::goal_reports::invalidate_draft(&st.db, execution_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "goalReports.submitDraft" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let draft = params
                .get("draft")
                .ok_or_else(|| rpc_err(1002, "draft required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            crate::goal_reports::submit_draft(&st.db, execution_id, draft)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "ok": true }))
        }
        "goalReports.finalizeReport" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let durable_seq = params
                .get("durableSeq")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let status = params.get("status").and_then(|v| v.as_str());
            let error_code = params.get("errorCode").and_then(|v| v.as_str());
            let summary = {
                let st = state.lock().await;
                crate::goal_reports::finalize_report(
                    &st.db,
                    execution_id,
                    durable_seq,
                    status,
                    error_code,
                )
                .map_err(goal_report_rpc_err)?
            };
            emit_notification(
                &tx,
                "goalReports.changed",
                json!({
                    "sessionId": summary.session_id,
                    "reportId": summary.report_id,
                    "executionId": summary.execution_id,
                    "proposalId": summary.proposal_id,
                    "status": summary.status,
                    "integrity": summary.integrity,
                    "verdict": summary.verdict,
                }),
            )
            .await;
            Ok(json!({ "report": summary }))
        }
        "goalReports.get" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let report_id = params
                .get("reportId")
                .or_else(|| params.get("executionId"))
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| {
                    rpc_err(1002, "reportId or executionId required", "INVALID_PARAMS")
                })?;
            let st = state.lock().await;
            // Trusted read: recomputes the file hash/size from disk, validates
            // schema and identity, and reports an explicit state instead of a
            // stale DB hash or an unvalidated body.
            let read = crate::goal_reports::read_report(&st.db, session_id, report_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            let is_ready = read.state == crate::goal_reports::REPORT_STATE_READY;
            let body = if is_ready {
                read.report.clone()
            } else {
                Some(crate::goal_reports::state_stub(&read))
            };
            Ok(json!({
                "report": body,
                "state": read.state,
                "reportSha256": read.report_sha256,
                "fileBytes": read.file_bytes,
                "maxBytes": read.max_bytes,
                "integrity": read.integrity,
                "verdict": read.verdict,
                "detail": read.detail,
            }))
        }
        "goalReports.list" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let reports = crate::goal_reports::list_reports(&st.db, session_id)
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            Ok(json!({ "reports": reports }))
        }
        "goalReports.retry" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let summary = {
                let st = state.lock().await;
                crate::goal_reports::retry_report(&st.db, session_id, execution_id)
                    .map_err(goal_report_rpc_err)?
            };
            emit_notification(
                &tx,
                "goalReports.changed",
                json!({
                    "sessionId": summary.session_id,
                    "reportId": summary.report_id,
                    "executionId": summary.execution_id,
                    "proposalId": summary.proposal_id,
                    "status": summary.status,
                    "integrity": summary.integrity,
                    "verdict": summary.verdict,
                }),
            )
            .await;
            Ok(json!({ "report": summary }))
        }
        "goalReports.getAsset" => {
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let screenshot_id = params
                .get("screenshotId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "screenshotId required", "INVALID_PARAMS"))?;
            let offset = params.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
            let length = params
                .get("length")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
            let st = state.lock().await;
            let owned: bool = st
                .db
                .conn()
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM goal_reports
                        WHERE session_id = ?1 AND execution_id = ?2
                    )",
                    rusqlite::params![session_id, execution_id],
                    |row| row.get(0),
                )
                .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?;
            if !owned {
                return Ok(json!({
                    "state": "not_found",
                    "sessionId": session_id,
                    "offset": offset,
                    "detail": "REPORT_NOT_FOUND: goal report does not exist"
                }));
            }
            let chunk = crate::goal_reports::assets::read_asset_chunk(
                st.db.data_dir(),
                session_id,
                execution_id,
                screenshot_id,
                offset,
                length,
            );
            Ok(json!(chunk))
        }
        "goalProgress.get" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let session_id = params.get("sessionId").and_then(|v| v.as_str());
            let st = state.lock().await;
            let progress = crate::goal_progress::get_progress(&st.db, session_id, execution_id)
                .map_err(goal_progress_rpc_err)?;
            Ok(json!({ "progress": progress }))
        }
        "goalProgress.issueToken" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let turn_id = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "turnId required", "INVALID_PARAMS"))?;
            let st = state.lock().await;
            let token =
                crate::goal_progress::issue_write_token(&st.db, session_id, execution_id, turn_id)
                    .map_err(goal_progress_rpc_err)?;
            Ok(json!({ "writeToken": token }))
        }
        "goalProgress.update" => {
            let execution_id = params
                .get("executionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "executionId required", "INVALID_PARAMS"))?;
            let session_id = params
                .get("sessionId")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let write_token = params
                .get("writeToken")
                .and_then(|v| v.as_str())
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| rpc_err(1002, "writeToken required", "INVALID_PARAMS"))?;
            let expected_revision = params.get("expectedRevision").and_then(|v| v.as_i64());
            let items: Vec<crate::goal_progress::GoalProgressItem> = params
                .get("items")
                .cloned()
                .ok_or_else(|| rpc_err(1002, "items required", "INVALID_PARAMS"))
                .and_then(|v| {
                    serde_json::from_value(v)
                        .map_err(|e| rpc_err(1002, e.to_string(), "INVALID_PARAMS"))
                })?;

            let snapshot = {
                let st = state.lock().await;
                crate::goal_progress::update_progress(
                    &st.db,
                    session_id,
                    execution_id,
                    write_token,
                    expected_revision,
                    items,
                )
                .map_err(goal_progress_rpc_err)?
            };

            emit_notification(
                &tx,
                "goalProgress.changed",
                json!({
                    "sessionId": snapshot.session_id,
                    "executionId": snapshot.execution_id,
                    "revision": snapshot.revision,
                }),
            )
            .await;

            Ok(json!({ "progress": snapshot }))
        }
        _ => Err(rpc_err(
            -32601,
            format!("method not found: {method}"),
            "NOT_FOUND",
        )),
    }
}
