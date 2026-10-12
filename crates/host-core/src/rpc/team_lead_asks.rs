use serde_json::{json, Value};

use super::{rpc_err, team_rpc::team_rpc_err, JsonRpcError};
use crate::{db::Database, sessions};

/// Question lifecycle RPCs run under the Team handler's existing Host lock.
pub(super) fn handle(db: &Database, method: &str, params: &Value) -> Result<Value, JsonRpcError> {
    match method {
        "team.registerLeadAsk" | "team.deferLeadAsk" | "team.ackLeadAsk" => {
            let session = params
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let caller = params
                .get("callerSessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
            if caller != session {
                return Err(rpc_err(
                    1002,
                    "Only the Lead owns questions",
                    "TEAM_UNAUTHORIZED",
                ));
            }
            let turn = params
                .get("turnId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "turnId required", "INVALID_PARAMS"))?;
            let ask = if method == "team.registerLeadAsk" {
                let request =
                    serde_json::from_value(params.get("request").cloned().unwrap_or(Value::Null))
                        .map_err(|_| {
                        rpc_err(1002, "invalid ask request", "ASKTOOL_INVALID_ARGUMENT")
                    })?;
                let request: crate::team::lead_asks::AskRequest = request;
                if request.session_id != session {
                    return Err(rpc_err(
                        1002,
                        "question session mismatch",
                        "TEAM_UNAUTHORIZED",
                    ));
                }
                crate::team::lead_asks::register(db, request, turn).map_err(team_rpc_err)?
            } else {
                let id = params
                    .get("requestId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| rpc_err(1002, "requestId required", "INVALID_PARAMS"))?;
                if method == "team.ackLeadAsk" {
                    crate::team::lead_asks::acknowledge(db, session, id, turn)
                        .map_err(team_rpc_err)?;
                    return Ok(json!({"ok":true}));
                }
                crate::team::lead_asks::defer(db, session, id, turn).map_err(team_rpc_err)?
            };
            Ok(json!({"ask":ask,"deadlineMs":ask.created_at+crate::team::lead_asks::WAIT_MS}))
        }
        "team.listLeadAsks" => {
            let session = params
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let asks = crate::team::lead_asks::list(db, session).map_err(team_rpc_err)?;
            let entries = crate::turn_queue::list(db, Some(session))
                .map_err(team_rpc_err)?
                .into_iter()
                .filter(|entry| entry.id.starts_with("asktool-answer:"))
                .collect::<Vec<_>>();
            Ok(json!({"asks":asks,"entries":entries}))
        }
        "team.resolveLeadAsk" => {
            let session = params
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            let id = params
                .get("requestId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "requestId required", "INVALID_PARAMS"))?;
            let ask = crate::team::lead_asks::resolve(
                db,
                session,
                id,
                params.get("answers").unwrap_or(&Value::Null),
            )
            .map_err(team_rpc_err)?;
            let entry = crate::team::lead_asks::queue_entry(db, &ask).map_err(team_rpc_err)?;
            Ok(json!({"ask":ask,"entry":entry}))
        }
        "team.cancelLeadAsks" => {
            let session = params
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_PARAMS"))?;
            if let Some(expected) = params.get("expectedTurnId") {
                if !expected.is_null() && !expected.is_string() {
                    return Err(rpc_err(
                        1002,
                        "expectedTurnId must be a string or null",
                        "INVALID_PARAMS",
                    ));
                }
                let running = sessions::running_turn_id(db, session).map_err(team_rpc_err)?;
                if running.as_deref() != expected.as_str() {
                    return Ok(json!({"ok":false}));
                }
            }
            crate::team::lead_asks::cancel(db, session).map_err(team_rpc_err)?;
            Ok(json!({"ok":true}))
        }
        _ => Err(rpc_err(1002, "Unknown question method", "METHOD_NOT_FOUND")),
    }
}
