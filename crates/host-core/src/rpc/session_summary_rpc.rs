//! Session summary transport adapter. Additive: an older Host answers
//! `METHOD_NOT_FOUND` and the renderer draws no card.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{rpc_err, AppState, JsonRpcError};
use crate::session_summary::{self, SessionSummaryError};

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: &Value,
) -> Result<Value, JsonRpcError> {
    let session_id = required_string(params, "sessionId")?;
    let st = state.lock().await;
    if st.shutting_down {
        return Err(rpc_err(1001, "host is shutting down", "HOST_SHUTTING_DOWN"));
    }
    match method {
        "sessionSummary.get" => session_summary::get(&st.db, session_id)
            .map(|state| json!({ "summary": state.summary, "messageCount": state.message_count })),
        "sessionSummary.set" => {
            let text = required_string(params, "text")?;
            let based_on = required_integer(params, "basedOnMessageCount")?;
            let expected = required_integer(params, "expectedRevision")?;
            session_summary::set(&st.db, session_id, text, based_on, expected)
                .map(|summary| json!({ "summary": summary }))
        }
        _ => return Err(rpc_err(-32601, "method not found", "METHOD_NOT_FOUND")),
    }
    .map_err(summary_error)
}

fn required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, JsonRpcError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, format!("{key} must be a string"), "INVALID_ARGUMENT"))
}

/// A JSON number that is a whole number; a fraction, a string or null is refused
/// instead of being rounded into a different value.
fn required_integer(params: &Value, key: &str) -> Result<i64, JsonRpcError> {
    params.get(key).and_then(Value::as_i64).ok_or_else(|| {
        rpc_err(
            1002,
            format!("{key} must be a non-negative integer"),
            "INVALID_ARGUMENT",
        )
    })
}

fn summary_error(error: SessionSummaryError) -> JsonRpcError {
    match error {
        SessionSummaryError::Conflict(current) => JsonRpcError {
            code: 1008,
            message: "summary was changed by another writer".into(),
            data: Some(json!({
                "errorCode": "SUMMARY_CONFLICT",
                "currentRevision": current.summary.as_ref().map_or(0, |summary| summary.revision),
                "summary": current.summary,
                "messageCount": current.message_count,
            })),
        },
        SessionSummaryError::NotFound => rpc_err(1007, error.to_string(), "NOT_FOUND"),
        SessionSummaryError::UnsupportedSession => {
            rpc_err(1002, error.to_string(), "SESSION_SUMMARY_UNSUPPORTED")
        }
        SessionSummaryError::TextTooLarge => rpc_err(1002, error.to_string(), "LIMIT_EXCEEDED"),
        SessionSummaryError::InvalidSessionId | SessionSummaryError::InvalidArgument(_) => {
            rpc_err(1002, error.to_string(), "INVALID_ARGUMENT")
        }
        SessionSummaryError::Internal(error) => rpc_err(1000, error.to_string(), "INTERNAL"),
    }
}

#[cfg(test)]
mod tests {
    use super::super::handle_request;
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn summary_rpc_user_journey_and_wire_errors() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, _rx) = mpsc::unbounded_channel();
        let created = handle_request(state.clone(), "session.create", json!({}), tx.clone())
            .await
            .unwrap();
        let id = created["session"]["id"].as_str().unwrap();
        handle_request(
            state.clone(),
            "session.appendMessage",
            json!({"sessionId": id, "message": {
                "id": "u1", "role": "user", "content": "hello", "createdAt": "2026-11-22T00:00:00Z"
            }}),
            tx.clone(),
        )
        .await
        .unwrap();
        let blank = handle_request(
            state.clone(),
            "sessionSummary.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(blank, json!({"summary": null, "messageCount": 1}));
        let saved = handle_request(
            state.clone(),
            "sessionSummary.set",
            json!({"sessionId": id, "text": " Greeting the assistant. ", "basedOnMessageCount": 1, "expectedRevision": 0}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(saved["summary"]["text"], "Greeting the assistant.");
        assert_eq!(saved["summary"]["revision"], 1);
        assert_eq!(saved["summary"]["behind"], 0);
        assert_eq!(saved["summary"]["diverged"], false);
        let read = handle_request(
            state.clone(),
            "sessionSummary.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(read["summary"], saved["summary"]);
        let conflict = handle_request(
            state.clone(),
            "sessionSummary.set",
            json!({"sessionId": id, "text": "stale", "basedOnMessageCount": 1, "expectedRevision": 0}),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(conflict.code, 1008);
        let data = conflict.data.unwrap();
        assert_eq!(data["errorCode"], "SUMMARY_CONFLICT");
        assert_eq!(data["currentRevision"], 1);
        assert_eq!(data["summary"], saved["summary"]);
        for (params, code) in [
            (
                json!({"sessionId": id, "text": "x", "basedOnMessageCount": 1, "expectedRevision": -1}),
                "INVALID_ARGUMENT",
            ),
            (
                json!({"sessionId": id, "text": "x", "basedOnMessageCount": 0.5, "expectedRevision": 1}),
                "INVALID_ARGUMENT",
            ),
            (
                json!({"sessionId": id, "text": "x", "basedOnMessageCount": null, "expectedRevision": 1}),
                "INVALID_ARGUMENT",
            ),
            (
                json!({"sessionId": id, "text": 5, "basedOnMessageCount": 1, "expectedRevision": 1}),
                "INVALID_ARGUMENT",
            ),
            (
                json!({"sessionId": id, "text": "x", "basedOnMessageCount": 9, "expectedRevision": 1}),
                "INVALID_ARGUMENT",
            ),
            (
                json!({"sessionId": id, "text": "y".repeat(2001), "basedOnMessageCount": 1, "expectedRevision": 1}),
                "LIMIT_EXCEEDED",
            ),
            (
                json!({"sessionId": "remote:x", "text": "x", "basedOnMessageCount": 0, "expectedRevision": 0}),
                "SESSION_SUMMARY_UNSUPPORTED",
            ),
            (
                json!({"sessionId": "missing", "text": "x", "basedOnMessageCount": 0, "expectedRevision": 0}),
                "NOT_FOUND",
            ),
            (json!({"sessionId": ""}), "INVALID_ARGUMENT"),
        ] {
            let error = handle_request(state.clone(), "sessionSummary.set", params, tx.clone())
                .await
                .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], code);
        }
        for (id, code) in [
            ("native-pi:x", "SESSION_SUMMARY_UNSUPPORTED"),
            ("missing", "NOT_FOUND"),
        ] {
            let error = handle_request(
                state.clone(),
                "sessionSummary.get",
                json!({"sessionId": id}),
                tx.clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], code);
        }
        let unknown = handle_request(
            state.clone(),
            "sessionSummary.clear",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap_err();
        assert_eq!(unknown.data.unwrap()["errorCode"], "METHOD_NOT_FOUND");
    }
}
