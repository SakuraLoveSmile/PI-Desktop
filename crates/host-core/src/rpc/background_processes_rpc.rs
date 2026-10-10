use super::{rpc_err, JsonRpcError};
use crate::{background_processes as jobs, sessions, state::AppState};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

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
