//! Additive v1 session activity projection; old Hosts reject the method explicitly.
use super::{rpc_err, AppState, JsonRpcError};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    params: &Value,
) -> Result<Value, JsonRpcError> {
    let id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| rpc_err(1002, "sessionId required", "INVALID_ARGUMENT"))?;
    let number = |key: &str, default: u64| -> Result<usize, JsonRpcError> {
        let value = match params.get(key) {
            None => default,
            Some(v) => v
                .as_u64()
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or_else(|| rpc_err(1002, format!("invalid {key}"), "INVALID_ARGUMENT"))?,
        };
        usize::try_from(value)
            .map_err(|_| rpc_err(1002, format!("invalid {key}"), "INVALID_ARGUMENT"))
    };
    let offset = number("offset", 0)?;
    let limit = number("limit", 50)?;
    if !(1..=50).contains(&limit) {
        return Err(rpc_err(1002, "limit must be 1..50", "INVALID_ARGUMENT"));
    }
    let st = state.lock().await;
    let activity = crate::session_activity::get(&st.db, id, offset, limit).map_err(|e| {
        let code = e.to_string();
        match code.as_str() {
            "INVALID_ARGUMENT" | "SESSION_ACTIVITY_UNSUPPORTED" => {
                rpc_err(1002, code.clone(), &code)
            }
            "NOT_FOUND" => rpc_err(1007, "session not found", "NOT_FOUND"),
            _ => rpc_err(1000, code, "INTERNAL"),
        }
    })?;
    Ok(json!({"activity": activity}))
}

#[cfg(test)]
mod tests {
    use super::super::handle_request;
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn activity_rpc_reads_persisted_history_and_notifies_after_canonical_changes() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = AppState::open(dir.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, mut rx) = mpsc::unbounded_channel();
        let create = handle_request(state.clone(), "session.create", json!({}), tx.clone())
            .await
            .unwrap();
        let id = create["session"]["id"].as_str().unwrap();
        let first = json!({"id": "oldest", "role": "tool", "content": "secret", "createdAt": "2026-10-10T00:00:00Z", "toolName": "Write", "toolStatus": "success", "toolArgs": {"path": "/old/file.txt"}});
        handle_request(
            state.clone(),
            "session.appendMessage",
            json!({"sessionId": id, "message": first}),
            tx.clone(),
        )
        .await
        .unwrap();
        let mut notified = false;
        while let Ok(raw) = rx.try_recv() {
            let note: Value = serde_json::from_str(&raw).unwrap();
            if note["method"] == "sessionActivity.changed" {
                assert_eq!(note["params"]["sessionId"], id);
                notified = true;
            }
        }
        assert!(notified);
        let read = handle_request(
            state.clone(),
            "sessionActivity.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(read["activity"]["changedFiles"][0]["messageId"], "oldest");
        assert!(!read.to_string().contains("secret"));
        handle_request(
            state.clone(),
            "session.replaceMessages",
            json!({"sessionId": id, "messages": []}),
            tx.clone(),
        )
        .await
        .unwrap();
        let cleared = handle_request(
            state.clone(),
            "sessionActivity.get",
            json!({"sessionId": id}),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(cleared["activity"]["totals"]["changedFiles"], 0);
        assert_ne!(
            cleared["activity"]["revision"],
            read["activity"]["revision"]
        );
        for params in [
            json!({"sessionId": id, "offset": -1}),
            json!({"sessionId": id, "offset": 0.5}),
            json!({"sessionId": id, "limit": 51}),
            json!({"sessionId": id, "limit": 0}),
            json!({"sessionId": id, "offset": null}),
        ] {
            assert_eq!(
                handle_request(state.clone(), "sessionActivity.get", params, tx.clone())
                    .await
                    .unwrap_err()
                    .data
                    .unwrap()["errorCode"],
                "INVALID_ARGUMENT"
            );
        }
        for (id, expected) in [
            ("remote:test", "SESSION_ACTIVITY_UNSUPPORTED"),
            ("native-pi:test", "SESSION_ACTIVITY_UNSUPPORTED"),
            ("missing", "NOT_FOUND"),
            ("", "INVALID_ARGUMENT"),
        ] {
            assert_eq!(
                handle_request(
                    state.clone(),
                    "sessionActivity.get",
                    json!({"sessionId": id}),
                    tx.clone()
                )
                .await
                .unwrap_err()
                .data
                .unwrap()["errorCode"],
                expected
            );
        }
    }
}
