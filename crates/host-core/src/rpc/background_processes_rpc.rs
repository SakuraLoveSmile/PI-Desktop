use super::{rpc_err, JsonRpcError};
use crate::{background_processes as jobs, sessions, state::AppState};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

pub(super) fn service_err(error: anyhow::Error) -> JsonRpcError {
    let message = error.to_string();
    let code = [
        "INVALID_PARAMS",
        "TEAM_SERVICE_UNAUTHORIZED",
        "TEAM_SERVICE_LIMIT_REACHED",
        "TEAM_APPROVAL_REQUIRED",
    ]
    .into_iter()
    .find(|code| message.starts_with(code))
    .unwrap_or("INTERNAL");
    rpc_err(1002, message.clone(), code)
}

pub(super) fn has_services(
    st: &AppState,
    session: &str,
    include_team: bool,
) -> Result<bool, JsonRpcError> {
    st.db.conn().query_row("SELECT EXISTS(SELECT 1 FROM background_processes p JOIN background_service_ownership s ON s.process_id=p.id WHERE p.status IN ('starting','running','stopping') AND (p.session_id=?1 OR (?2 AND s.team_session_id=?1)))",rusqlite::params![session,include_team],|r|r.get(0)).map_err(|error|rpc_err(1000,error.to_string(),"INTERNAL"))
}

/// The caller must finish authorization/preflight before requesting cleanup.
/// Recheck the operation's gates after this bounded wait and before mutation.
pub(super) async fn cleanup_services(
    state: &Arc<Mutex<AppState>>,
    session: &str,
    include_team: bool,
    reason: &str,
) -> Result<(), JsonRpcError> {
    let (ids, waits) = {
        let st = state.lock().await;
        let mut statement = st.db.conn().prepare_cached("SELECT p.id FROM background_processes p JOIN background_service_ownership s ON s.process_id=p.id WHERE p.status IN ('starting','running','stopping') AND (p.session_id=?1 OR (?2 AND s.team_session_id=?1))").map_err(|error|rpc_err(1000,error.to_string(),"INTERNAL"))?;
        let ids = statement
            .query_map(rusqlite::params![session, include_team], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
        let mut waits = Vec::new();
        for id in &ids {
            let output = st
                .background_outputs
                .get(id)
                .ok_or_else(|| rpc_err(1000, "background service owner unavailable", "INTERNAL"))?;
            let receiver = output
                .lock()
                .map_err(|_| rpc_err(1000, "background output lock poisoned", "INTERNAL"))?
                .terminal_receiver();
            crate::background_services::request_stop(&st, id, reason, crate::db::now_ms())
                .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
            waits.push(receiver);
        }
        (ids, waits)
    };
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        for mut receiver in waits {
            while !*receiver.borrow_and_update() {
                if receiver.changed().await.is_err() {
                    return Err(rpc_err(
                        1000,
                        "service cleanup owner disappeared",
                        "INTERNAL",
                    ));
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|_| {
        rpc_err(
            1008,
            "service cleanup is still finishing; operation was not applied",
            "BACKGROUND_SERVICE_CLEANUP_PENDING",
        )
    })??;
    let st = state.lock().await;
    if ids
        .iter()
        .any(|id| st.pending_background_finalizations.contains_key(id))
    {
        return Err(rpc_err(
            1008,
            "service stopped but its terminal result has not been saved; read its details to retry",
            "BACKGROUND_PROCESS_PERSISTENCE_FAILED",
        ));
    }
    Ok(())
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: &Value,
) -> Result<Value, JsonRpcError> {
    let session = params
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
    let mut st = state.lock().await;
    if sessions::session_mode(&st.db, session)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .is_none()
    {
        return Err(rpc_err(1007, "session not found", "SESSION_NOT_FOUND"));
    }
    jobs::retry_session(&mut st, session);
    if method == "backgroundProcesses.list" {
        return Ok(
            json!({"processes":jobs::list_view(&st,session).map_err(|e|rpc_err(1000,e.to_string(),"INTERNAL"))?}),
        );
    }
    let id = params
        .get("id")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| rpc_err(1002, "id required", "INVALID_PARAMS"))?;
    let process = jobs::get(&st.db, session, id)
        .map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))?
        .ok_or_else(|| {
            rpc_err(
                1007,
                "background process not found",
                "BACKGROUND_PROCESS_NOT_FOUND",
            )
        })?;
    if method == "backgroundProcesses.stop" && st.pending_background_finalizations.contains_key(id)
    {
        return Ok(
            json!({"process":jobs::read(&st,session,id).map_err(|e|rpc_err(1000,e.to_string(),"INTERNAL"))?["process"]}),
        );
    }
    match method {
        "backgroundProcesses.read" => {
            jobs::read(&st, session, id).map_err(|e| rpc_err(1000, e.to_string(), "INTERNAL"))
        }
        "backgroundProcesses.stop" => {
            if matches!(process.status.as_str(), "starting" | "running" | "stopping") {
                if process.service.is_some() {
                    crate::background_services::request_stop(
                        &st,
                        id,
                        "explicit_stop",
                        crate::db::now_ms(),
                    )
                    .map_err(|error| rpc_err(1000, error.to_string(), "INTERNAL"))?;
                } else {
                    if let Some(sender) = st
                        .active_bash_cancellations
                        .get(&(session.to_string(), process.tool_call_id))
                    {
                        // Explicit Stop must reach the live owner even when storage cannot
                        // record the request. Terminal persistence retains/retries its result.
                        sender.send_replace(true);
                        st.db.conn.execute("UPDATE background_processes SET status='stopping' WHERE session_id=?1 AND id=?2",rusqlite::params![session,id]).map_err(|e|rpc_err(1000,e.to_string(),"INTERNAL"))?;
                    } else {
                        return Err(rpc_err(
                            1000,
                            "background process owner unavailable",
                            "INTERNAL",
                        ));
                    }
                }
            }
            if let Some(out) = st.background_outputs.get(id) {
                if let Ok(mut out) = out.lock() {
                    out.changed();
                }
            }
            Ok(
                json!({"process":jobs::get(&st.db,session,id).map_err(|e|rpc_err(1000,e.to_string(),"INTERNAL"))?}),
            )
        }
        _ => Err(rpc_err(-32601, "method not found", "METHOD_NOT_FOUND")),
    }
}
