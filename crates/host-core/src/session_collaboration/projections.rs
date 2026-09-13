use super::{repository, string};
use crate::db::{ms_to_ts, now_ms, Database};
use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

pub(super) fn result(db: &Database, input: &Value) -> Result<Value> {
    let session_id = string(input, "sessionId", 256)?;
    repository::title(db, session_id)?;
    let message = match input.get("messageId").and_then(Value::as_str) {
        Some(id) => repository::get(db, id)?,
        None => repository::latest_incoming(
            db,
            session_id,
            input.get("turnId").and_then(Value::as_str),
        )?,
    };
    if input.get("messageId").is_some() && message.is_none() {
        return Err(anyhow!("NOT_FOUND: session message"));
    }
    if message
        .as_ref()
        .is_some_and(|value| value.target_session_id != session_id)
    {
        return Err(anyhow!("NOT_FOUND: message for session"));
    }
    let ready = message
        .as_ref()
        .is_some_and(|value| !matches!(value.status.as_str(), "queued" | "running"));
    Ok(json!({"ready":ready,"message":message}))
}

pub(super) fn summary(db: &Database, id: &str) -> Result<Value> {
    let title = repository::title(db, id)?;
    let creator: Option<(String,String)> = db.conn().query_row(
        "SELECT l.created_by_session_id,COALESCE(s.title,l.created_by_session_id)
        FROM session_collaboration_links l LEFT JOIN sessions s ON s.id=l.created_by_session_id WHERE l.session_id=?1",
        params![id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    let turn: Option<(String,String)> = db.conn().query_row(
        "SELECT id,status FROM turns WHERE session_id=?1 ORDER BY started_at DESC,rowid DESC LIMIT 1",
        params![id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    let current = db
        .conn()
        .prepare_cached(&format!(
            "{} WHERE target_session_id=?1
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        created_at DESC,rowid DESC LIMIT 1",
            repository::SELECT
        ))?
        .query_row(params![id], repository::row)
        .optional()?;
    let mut status = match turn.as_ref().map(|(_, status)| status.as_str()) {
        Some("running") => "running",
        Some("completed") => "completed",
        Some("error") => "failed",
        Some("aborted") => "cancelled",
        _ => "idle",
    };
    if let Some(message) = &current {
        if status != "running"
            && (turn.is_none()
                || message.status == "queued"
                || message.turn_id.as_deref() == turn.as_ref().map(|(id, _)| id.as_str()))
        {
            status = &message.status;
        }
    }
    let model: Option<String> = db.conn().query_row(
        "SELECT provider_id || '/' || model_id FROM sessions WHERE id=?1",
        params![id],
        |row| row.get(0),
    )?;
    let exchanges: Vec<Value> = repository::recent(db,id,4)?.into_iter().map(|message| {
        let incoming = message.target_session_id == id;
        json!({"messageId":message.id,"direction":if incoming {"incoming"}else{"outgoing"},
            "peer":{"sessionId":if incoming {message.source_session_id}else{message.target_session_id},
                "title":if incoming {message.source_title}else{message.target_title}},
            "kind":message.kind,"status":message.status,"preview":repository::bounded(&message.content,240),"createdAt":message.created_at})
    }).collect();
    let mut value = json!({"sessionId":id,"title":title,"status":status,"observedAt":ms_to_ts(now_ms()),"recentExchanges":exchanges});
    if let Some(model) = model {
        value["modelKey"] = json!(model);
    }
    if let Some((session_id, title)) = creator {
        value["createdBySession"] = json!({"sessionId":session_id,"title":title});
    }
    if let Some(message) = current.filter(|message| {
        message.status == "queued"
            || message.turn_id.as_deref() == turn.as_ref().map(|(id, _)| id.as_str())
    }) {
        value["currentTask"] = json!({"messageId":message.id,"senderSession":{"sessionId":message.source_session_id,"title":message.source_title},
            "text":repository::bounded(&message.content,512),"status":message.status,"turnId":message.turn_id,"createdAt":message.created_at});
        if !matches!(message.status.as_str(), "queued" | "running")
            && message.turn_id.as_deref() == turn.as_ref().map(|(id, _)| id.as_str())
        {
            value["result"] = json!({"messageId":message.id,"turnId":message.turn_id,"status":message.status,"text":message.result,"error":message.error});
        }
    }
    if let Some(task) = value.get_mut("currentTask").and_then(Value::as_object_mut) {
        task.retain(|_, value| !value.is_null());
    }
    if let Some(result) = value.get_mut("result").and_then(Value::as_object_mut) {
        result.retain(|_, value| !value.is_null());
    }
    Ok(value)
}
