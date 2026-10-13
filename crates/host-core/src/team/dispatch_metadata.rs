//! Host-owned send-time facts and explicit task dispatch lifecycle.
//! Message bodies, permissions, idempotency and consumed/running mail stay immutable.
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::TeamMessage;
use crate::db::{ms_to_ts, now_ms, Database};

pub(crate) const NS: &str = "team-dispatch-metadata-v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskDispatch {
    pub task_id: String,
    pub expected_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Metadata {
    pub sent_at: String,
    pub target_busy_at_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_dispatch: Option<TaskDispatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatch_cancellation: Option<String>,
}

pub(crate) fn read(conn: &Connection, id: &str) -> Result<Option<Metadata>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM kv WHERE ns=?1 AND key=?2",
            params![NS, id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(Into::into))
        .transpose()
}

pub(crate) fn target_state(conn: &Connection, team: &str, target: &str) -> Result<String> {
    let busy: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE session_id=?1 AND status='running')",
        [target],
        |r| r.get(0),
    )?;
    if busy {
        return Ok("running".into());
    }
    let paused: bool = conn.query_row(
        "SELECT paused FROM teams WHERE team_session_id=?1",
        [team],
        |r| r.get(0),
    )?;
    Ok(if paused { "paused" } else { "idle" }.into())
}

pub(crate) fn validate(
    db: &Database,
    team: &str,
    caller: &str,
    target: &str,
    dispatch: &TaskDispatch,
) -> Result<()> {
    if caller != team || target == team {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: task dispatch requires the Lead and an owned expert task"
        ));
    }
    let task = super::get_team_task(db, team, &dispatch.task_id)?
        .ok_or_else(|| anyhow!("TEAM_TASK_NOT_FOUND: dispatch task does not exist"))?;
    if dispatch.expected_revision < 1 || task.revision != dispatch.expected_revision {
        return Err(anyhow!(
            "TEAM_TASK_REVISION_CONFLICT: read the current task before dispatching"
        ));
    }
    if task.deleted
        || !matches!(task.status.as_str(), "pending" | "in_progress")
        || task.owner_session_id.as_deref() != Some(target)
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: dispatch requires an active task owned by the target expert"
        ));
    }
    Ok(())
}

/// Called only for a newly inserted row, inside the send transaction. Ordinary
/// messages also receive age/busy facts, but never a task association inferred
/// from their text. Replays retain the original facts.
pub(crate) fn record(
    db: &Database,
    message: &TeamMessage,
    dispatch: Option<&TaskDispatch>,
) -> Result<()> {
    let busy = target_state(
        db.conn(),
        &message.team_session_id,
        &message.target_session_id,
    )? == "running";
    let metadata = Metadata {
        sent_at: ms_to_ts(message.created_at.parse()?),
        target_busy_at_send: busy,
        task_dispatch: dispatch.cloned(),
        dispatch_cancellation: None,
    };
    db.kv_set(NS, &message.id, &serde_json::to_value(metadata)?)?;
    if let Some(dispatch) = dispatch {
        let mut stmt = db.conn().prepare_cached("SELECT m.id FROM session_collaboration_messages m JOIN kv k ON k.ns=?1 AND k.key=m.id WHERE m.plugin_id=?2 AND m.source_session_id=?3 AND m.target_session_id=?4 AND m.kind='message' AND m.status='queued' AND m.turn_id IS NULL AND m.id<>?5 AND json_extract(k.value_json,'$.taskDispatch.taskId')=?6")?;
        let ids = stmt
            .query_map(
                params![
                    NS,
                    super::team_plugin_origin(&message.team_session_id),
                    message.source_session_id,
                    message.target_session_id,
                    message.id,
                    dispatch.task_id
                ],
                |r| r.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in ids {
            cancel(db.conn(), &id, "superseded")?;
        }
    }
    Ok(())
}

pub(crate) fn cancel(conn: &Connection, id: &str, reason: &str) -> Result<()> {
    let changed = conn.execute("UPDATE session_collaboration_messages SET status='cancelled',updated_at=?2 WHERE id=?1 AND status='queued' AND turn_id IS NULL",params![id,now_ms()])?;
    if changed == 0 {
        return Ok(());
    }
    conn.execute("DELETE FROM turn_queue WHERE session_message_id=?1", [id])?;
    conn.execute("UPDATE kv SET value_json=json_set(value_json,'$.dispatchCancellation',?3),updated_at=?4 WHERE ns=?1 AND key=?2",params![NS,id,reason,now_ms()])?;
    Ok(())
}

/// Called in the same transaction as every task completion path. Completion
/// claims still in progress do not retire mail until their terminal CAS wins.
pub(crate) fn task_completed(conn: &Connection, team: &str, task: &str) -> Result<()> {
    let mut stmt = conn.prepare_cached("SELECT m.id FROM session_collaboration_messages m JOIN kv k ON k.ns=?1 AND k.key=m.id WHERE m.plugin_id=?2 AND m.source_session_id=?3 AND m.kind='message' AND m.status='queued' AND m.turn_id IS NULL AND json_extract(k.value_json,'$.taskDispatch.taskId')=?4")?;
    let ids = stmt
        .query_map(
            params![NS, super::team_plugin_origin(team), team, task],
            |r| r.get::<_, String>(0),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        cancel(conn, &id, "task_completed")?;
    }
    Ok(())
}

pub(crate) fn project(db: &Database, message: &mut TeamMessage) -> Result<()> {
    if let Some(metadata) = read(db.conn(), &message.id)? {
        message.sent_at = Some(metadata.sent_at);
        message.target_busy_at_send = Some(metadata.target_busy_at_send);
        message.task_dispatch = metadata.task_dispatch;
        message.dispatch_cancellation = metadata.dispatch_cancellation;
    }
    message.target_state = Some(target_state(
        db.conn(),
        &message.team_session_id,
        &message.target_session_id,
    )?);
    if message.status == "queued" && message.turn_id.is_none() {
        let queue_position: i64 = db.conn().query_row("SELECT COUNT(*) FROM session_collaboration_messages m WHERE m.plugin_id=?1 AND m.kind='message' AND m.target_session_id=?2 AND m.status='queued' AND m.turn_id IS NULL AND (m.created_at < ?3 OR (m.created_at=?3 AND m.id<=?4))",params![super::team_plugin_origin(&message.team_session_id),message.target_session_id,message.created_at.parse::<i64>()?,message.id],|r|r.get(0))?;
        message.queue_position = Some(queue_position);
    }
    Ok(())
}

pub(crate) fn cleanup_session(conn: &Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns=?1 AND key IN (SELECT id FROM session_collaboration_messages WHERE source_session_id=?2 OR target_session_id=?2)",params![NS,session])?;
    Ok(())
}
