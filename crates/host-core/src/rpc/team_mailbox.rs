//! Team mailbox mutation owner, kept separate from Team RPC registration.
use super::team_rpc::{
    authorize_lead_expert, authorize_lead_mutation, send_team_changed_if_revision_changed,
    team_revision,
};
use super::{rpc_err, send_notification, team_rpc_err, AppState, JsonRpcError};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use tokio::sync::mpsc;

pub(super) fn send(
    st: &AppState,
    params: &Value,
    tx: &mpsc::UnboundedSender<String>,
    dispatch_head: Option<&super::team_dispatch_head::Snapshot>,
) -> Result<Value, JsonRpcError> {
    let team_id = params
        .get("teamSessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| rpc_err(1002, "teamSessionId required", "INVALID_PARAMS"))?;
    let caller_id = params
        .get("callerSessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| rpc_err(1002, "callerSessionId required", "INVALID_PARAMS"))?;
    authorize_lead_mutation(&st.db, team_id, caller_id)?;
    let target_id = params
        .get("target")
        .and_then(|v| v.as_str())
        .ok_or_else(|| rpc_err(1002, "target required", "INVALID_PARAMS"))?;
    authorize_lead_expert(&st.db, team_id, caller_id, target_id)?;
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| rpc_err(1002, "content required", "INVALID_PARAMS"))?;
    let idempotency_key = params.get("idempotencyKey").and_then(|v| v.as_str());
    let previous_revision = team_revision(&st.db, team_id)?;
    let delivery_tx = st
        .db
        .conn()
        .unchecked_transaction()
        .map_err(|e| team_rpc_err(e.into()))?;
    let existed = if let Some(key) = idempotency_key {
        st.db.conn().query_row(
                    "SELECT id FROM session_collaboration_messages WHERE plugin_id=?1 AND source_session_id=?2 AND idempotency_key=?3",
                    rusqlite::params![crate::team::team_plugin_origin(team_id), caller_id, key],
                    |row| row.get::<_, String>(0),
                ).optional().map_err(|e| team_rpc_err(e.into()))?.is_some()
    } else {
        false
    };
    let msg = crate::team::send_team_message(
        &st.db,
        crate::team::SendMessageParams {
            team_session_id: team_id,
            caller_session_id: caller_id,
            target_identifier: target_id,
            content,
            idempotency_key,
        },
    )
    .map_err(team_rpc_err)?;
    if caller_id == team_id {
        crate::team::authority::record_dispatch(&st.db, team_id, &msg, existed)
            .map_err(team_rpc_err)?;
    }
    if !existed {
        crate::team::dispatch_head::record(
            &st.db,
            &msg.id,
            dispatch_head.and_then(|snapshot| snapshot.head.as_deref()),
        )
        .map_err(team_rpc_err)?;
    }
    let msg = crate::team::get_team_message(&st.db, team_id, caller_id, &msg.id)
        .map_err(team_rpc_err)?
        .ok_or_else(|| rpc_err(1000, "dispatch receipt missing", "INTERNAL"))?;
    delivery_tx.commit().map_err(|e| team_rpc_err(e.into()))?;
    send_notification(
        tx,
        "team.messageQueued",
        json!({ "teamSessionId": team_id, "messageId": msg.id }),
    );
    send_team_changed_if_revision_changed(&st.db, tx, team_id, previous_revision, "mailbox")?;
    Ok(json!({ "message": msg }))
}
