//! Internal ordinary Lead wait-boundary RPC. Caller text never supplies origin.
use super::{rpc_err, JsonRpcError};
use crate::{db::Database, team::ordinary_inbox};
use serde_json::{json, Value};

pub(super) fn handle(
    db: &Database,
    method: &str,
    params: &Value,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
) -> Result<Value, JsonRpcError> {
    if method == "team.getOrdinaryInboxCapability" {
        return Ok(json!({"capability":ordinary_inbox::CAPABILITY}));
    }
    if method == "team.getOrdinaryInboxProof" {
        let required = |key: &str| {
            params
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty() && s.len() <= 256)
                .ok_or_else(|| rpc_err(1002, format!("{key} required"), "INVALID_PARAMS"))
        };
        return ordinary_inbox::get_proof(db, required("teamSessionId")?, required("messageId")?)
            .map_err(super::team_rpc::team_rpc_err);
    }
    let mut input = params.clone();
    let ids = input
        .as_object_mut()
        .and_then(|object| object.remove("messageIds"));
    let p: ordinary_inbox::ReadParams = serde_json::from_value(input)
        .map_err(|error| rpc_err(1002, error.to_string(), "INVALID_PARAMS"))?;
    let result = if method == "team.ackOrdinaryInbox" {
        let ids: Vec<String> = serde_json::from_value(
            ids.ok_or_else(|| rpc_err(1002, "messageIds required", "INVALID_PARAMS"))?,
        )
        .map_err(|error| rpc_err(1002, error.to_string(), "INVALID_PARAMS"))?;
        if ids.len() > 64 {
            return Err(rpc_err(1002, "too many messageIds", "INVALID_PARAMS"));
        }
        ordinary_inbox::ack(db, &p, &ids)
    } else {
        if ids.is_some() {
            return Err(rpc_err(1002, "unexpected messageIds", "INVALID_PARAMS"));
        }
        ordinary_inbox::read(db, &p)
    };
    // A partial batch may already be durable even if a later file write fails.
    // The notification is only a hint; receivers revalidate each durable proof.
    match ordinary_inbox::persisted_ids(db, &p) {
        Ok(mut ids) => {
            if let Ok(ref response) = result {
                if let Some(acknowledged) =
                    response.get("acknowledgedIds").and_then(Value::as_array)
                {
                    for id in acknowledged.iter().filter_map(Value::as_str) {
                        if !ids.iter().any(|existing| existing == id) {
                            ids.push(id.to_owned());
                        }
                    }
                }
            }
            if !ids.is_empty() {
                super::send_notification(
                    tx,
                    "team.ordinaryInboxPersisted",
                    json!({"teamSessionId":p.team_session_id,"leadTurnId":p.lead_turn_id,"messageIds":ids}),
                );
            }
        }
        Err(error) => {
            tracing::warn!(%error, "ordinary inbox mirror notification proof query failed")
        }
    }
    result.map_err(|error| {
        if error.to_string().starts_with("PERMISSION_DENIED:") {
            rpc_err(1002, error.to_string(), "PERMISSION_DENIED")
        } else {
            super::team_rpc::team_rpc_err(error)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::super::*;
    #[tokio::test]
    async fn public_rpc_delivers_at_wait_boundary_and_keeps_its_durable_proof() {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let mut app = AppState::open(data.path()).unwrap();
        app.handshook = true;
        let state = Arc::new(Mutex::new(app));
        let (tx, mut rx) = mpsc::unbounded_channel();
        let call =
            |method: &'static str, args| handle_request(state.clone(), method, args, tx.clone());
        assert_eq!(
            call("team.getOrdinaryInboxCapability", json!({}))
                .await
                .unwrap()["capability"],
            "ordinary-team-inbox-v1"
        );
        let provider=call("providers.create",json!({"name":"Inbox fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture"}]})).await.unwrap();
        let lead=call("session.create",json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path()})).await.unwrap()["session"]["id"].clone();
        let turn = call("session.beginTurn", json!({"sessionId":lead}))
            .await
            .unwrap()["turnId"]
            .clone();
        let review=call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn,"strategy":"delegate","reason":"Review queued report","members":[{"name":"expert","contextKind":"fresh"}]})).await.unwrap()["review"].clone();
        let decision=call("team.confirmLaunchReview",json!({"teamSessionId":lead,"reviewId":review["reviewId"],"expectedRevision":review["revision"]})).await.unwrap()["decision"].clone();
        let member = decision["memberSessionIds"][0].clone();
        // The real confirmation transport is consumed before ordinary wait.
        state.lock().await.db.conn().execute("UPDATE session_collaboration_messages SET status='completed' WHERE target_session_id=?1 AND idempotency_key LIKE 'team-review:%:confirmed'",[lead.as_str().unwrap()]).unwrap();
        let dispatch=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"expert","content":"Analyze assigned task"})).await.unwrap()["message"]["id"].clone();
        call(
            "session.beginTurn",
            json!({"sessionId":member,"sessionMessageId":dispatch}),
        )
        .await
        .unwrap();
        let report=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":member,"target":"Lead","content":"Complete report","idempotencyKey":"expert-report"})).await.unwrap()["message"]["id"].clone();
        let params = json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn,"boundaryId":"wait-1"});
        let mut forged = params.clone();
        forged["callerSessionId"] = member.clone();
        assert!(call("team.readOrdinaryInbox", forged).await.is_err());
        let delivered = call("team.readOrdinaryInbox", params.clone())
            .await
            .unwrap();
        assert_eq!(delivered["messages"].as_array().unwrap().len(), 1);
        assert_eq!(
            delivered["messages"][0]["message"]["content"],
            "Complete report"
        );
        assert_eq!(
            delivered["messages"][0]["message"]["sessionMessage"]["sourceSessionId"],
            member
        );
        assert_eq!(
            call("team.readOrdinaryInbox", params.clone())
                .await
                .unwrap(),
            delivered
        );
        let proof = call(
            "team.getOrdinaryInboxProof",
            json!({"teamSessionId":lead,"messageId":report}),
        )
        .await
        .unwrap();
        assert_eq!(proof["proof"]["phase"], "persisted");
        assert!(proof["proof"].get("message").is_none());
        let mut ack = params.clone();
        ack["messageIds"] = json!([report]);
        call("team.ackOrdinaryInbox", ack.clone()).await.unwrap();
        call("team.ackOrdinaryInbox", ack).await.unwrap();
        assert!(
            call("team.readOrdinaryInbox", params).await.unwrap()["messages"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let mut persisted = false;
        while let Ok(event) = rx.try_recv() {
            let event: Value = serde_json::from_str(&event).unwrap();
            if event["method"] == "team.ordinaryInboxPersisted" {
                assert!(event["params"].get("content").is_none());
                assert_eq!(event["params"]["messageIds"], json!([report]));
                persisted = true;
            }
        }
        assert!(persisted);
    }
}
