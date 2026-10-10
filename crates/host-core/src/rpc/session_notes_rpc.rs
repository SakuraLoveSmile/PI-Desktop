//! Quick Notes transport adapter. Notes are only saved on explicit UI request.

use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{rpc_err, AppState, JsonRpcError};
use crate::session_notes::{self, SessionNoteError};

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
    let note = match method {
        "sessionNotes.get" => session_notes::get(&st.db, session_id),
        "sessionNotes.set" => {
            let content = required_string(params, "content")?;
            let revision = params
                .get("expectedRevision")
                .and_then(Value::as_i64)
                .filter(|revision| *revision >= 0)
                .ok_or_else(|| {
                    rpc_err(
                        1002,
                        "expectedRevision must be a non-negative integer",
                        "INVALID_ARGUMENT",
                    )
                })?;
            session_notes::set(&st.db, session_id, content, revision)
        }
        _ => return Err(rpc_err(-32601, "method not found", "METHOD_NOT_FOUND")),
    }
    .map_err(note_error)?;
    Ok(json!({ "note": note }))
}

fn required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, JsonRpcError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, format!("{key} must be a string"), "INVALID_ARGUMENT"))
}

fn note_error(error: SessionNoteError) -> JsonRpcError {
    match error {
        SessionNoteError::Conflict(note) => JsonRpcError {
            code: 1008,
            message: "note was changed by another editor".into(),
            data: Some(json!({
                "errorCode": "NOTE_CONFLICT", "currentRevision": note.revision, "note": note,
            })),
        },
        SessionNoteError::NotFound => rpc_err(1007, error.to_string(), "NOT_FOUND"),
        SessionNoteError::UnsupportedSession => {
            rpc_err(1002, error.to_string(), "SESSION_NOTES_UNSUPPORTED")
        }
        SessionNoteError::ContentTooLarge => rpc_err(1002, error.to_string(), "LIMIT_EXCEEDED"),
        SessionNoteError::InvalidSessionId | SessionNoteError::InvalidRevision => {
            rpc_err(1002, error.to_string(), "INVALID_ARGUMENT")
        }
        SessionNoteError::Internal(error) => rpc_err(1000, error.to_string(), "INTERNAL"),
    }
}

#[cfg(test)]
mod tests {
    use super::super::handle_request;
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn quick_notes_rpc_user_journey_and_wire_errors() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, _rx) = mpsc::unbounded_channel();
        let created = handle_request(state.clone(), "session.create", json!({}), tx.clone())
            .await
            .unwrap();
        let id = created["session"]["id"].as_str().unwrap();
        let blank = handle_request(
            state.clone(),
            "sessionNotes.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(
            blank,
            json!({"note": {"sessionId": id, "content": "", "revision": 0}})
        );
        let content = "  # Note\n\n中文 **markdown**\n ";
        let saved = handle_request(
            state.clone(),
            "sessionNotes.set",
            json!({"sessionId": id, "content": content, "expectedRevision": 0}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(saved["note"]["content"], content);
        assert_eq!(saved["note"]["revision"], 1);
        let conflict = handle_request(
            state.clone(),
            "sessionNotes.set",
            json!({"sessionId": id, "content": "stale", "expectedRevision": 0}),
            tx.clone(),
        )
        .await
        .unwrap_err();
        let data = conflict.data.unwrap();
        assert_eq!(data["errorCode"], "NOTE_CONFLICT");
        assert_eq!(data["note"], saved["note"]);
        for revision in [
            json!(-1),
            json!(0.5),
            json!("1"),
            Value::Null,
            json!(u64::MAX),
        ] {
            let error = handle_request(
                state.clone(),
                "sessionNotes.set",
                json!({"sessionId": id, "content": "x", "expectedRevision": revision}),
                tx.clone(),
            )
            .await
            .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], "INVALID_ARGUMENT");
        }
        for (session_id, code) in [
            ("", "INVALID_ARGUMENT"),
            ("native-pi:abc", "SESSION_NOTES_UNSUPPORTED"),
            ("remote:abc", "SESSION_NOTES_UNSUPPORTED"),
            ("missing", "NOT_FOUND"),
        ] {
            for method in ["sessionNotes.get", "sessionNotes.set"] {
                let error = handle_request(
                    state.clone(),
                    method,
                    json!({"sessionId": session_id, "content": "", "expectedRevision": 0}),
                    tx.clone(),
                )
                .await
                .unwrap_err();
                assert_eq!(error.data.unwrap()["errorCode"], code);
            }
        }
        for params in [
            json!({}),
            json!({"sessionId": 1}),
            json!({"sessionId": id, "content": null, "expectedRevision": 1}),
        ] {
            let error = handle_request(state.clone(), "sessionNotes.set", params, tx.clone())
                .await
                .unwrap_err();
            assert_eq!(error.data.unwrap()["errorCode"], "INVALID_ARGUMENT");
        }
        let read = handle_request(
            state.clone(),
            "sessionNotes.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(read, saved);
        let cleared = handle_request(
            state.clone(),
            "sessionNotes.set",
            json!({"sessionId": id, "content": "", "expectedRevision": 1}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(cleared["note"]["revision"], 2);
        handle_request(
            state.clone(),
            "session.delete",
            json!({"id": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        let deleted = handle_request(state, "sessionNotes.get", json!({"sessionId": id}), tx)
            .await
            .unwrap_err();
        assert_eq!(deleted.data.unwrap()["errorCode"], "NOT_FOUND");
    }
}
