//! Durable completion-with-open-tasks notices, owned by the terminal turn CAS.
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use uuid::Uuid;

use super::{host_notices, member_failure::QueuedMemberFailure};
use crate::db::Database;

pub(crate) fn record(conn: &Connection, turn: &str) -> Result<Option<QueuedMemberFailure>> {
    let member: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT m.team_session_id,m.member_session_id,m.name,d.permission_ceiling
         FROM team_members m JOIN turns t ON t.session_id=m.member_session_id
         JOIN session_collaboration_messages d ON d.turn_id=t.id
           AND d.plugin_id='team:'||m.team_session_id
           AND d.source_session_id=m.team_session_id AND d.target_session_id=m.member_session_id
           AND d.kind='message'
         WHERE t.id=?1 AND t.status='completed' LIMIT 1",
            [turn],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((team, member, name, ceiling)) = member else {
        return Ok(None);
    };
    let reported: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_collaboration_messages m JOIN kv k
           ON k.ns='team-message-source-turn-v1' AND k.key=m.id
         WHERE m.plugin_id=?1 AND m.source_session_id=?2
           AND m.target_session_id=?3 AND m.kind='message'
           AND json_extract(k.value_json,'$')=?4)",
        params![super::team_plugin_origin(&team), member, team, turn],
        |r| r.get(0),
    )?;
    if reported {
        return Ok(None);
    }
    let tasks = {
        let mut stmt = conn.prepare_cached(
            "SELECT task_id FROM team_tasks WHERE team_session_id=?1 AND owner_session_id=?2
               AND deleted=0 AND status IN ('pending','in_progress') ORDER BY task_id",
        )?;
        let rows = stmt.query_map(params![team, member], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if tasks.is_empty() {
        return Ok(None);
    }
    let content = json!({"kind":"member_ended_without_report","memberName":name,
        "taskIds":tasks,"suggestedAction":"inspect team_status and task state; send_message to explicitly re-dispatch, or task_update to cancelled/failed with the reason before completing"}).to_string();
    let now = crate::db::now_ms();
    let id = Uuid::new_v4().to_string();
    let inserted = conn.execute(
        "INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,
           target_session_id,target_title,kind,content,status,notify_on_completion,idempotency_key,
           remaining_hops,permission_ceiling,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,'Lead','message',?6,'queued',0,?7,1,?8,?9,?9)
         ON CONFLICT(plugin_id,source_session_id,idempotency_key) DO NOTHING",
        params![
            id,
            super::team_plugin_origin(&team),
            member,
            name,
            team,
            content,
            format!("{}{turn}", host_notices::SILENT_PREFIX),
            ceiling,
            now
        ],
    )?;
    if inserted == 0 {
        return Ok(None);
    }
    conn.execute("INSERT INTO kv(ns,key,value_json,updated_at) VALUES('team-message-source-turn-v1',?1,?2,?3)",
        params![id,json!(turn).to_string(),now])?;
    super::lifecycle::bump_team_revision_conn(conn, &team)?;
    Ok(Some(QueuedMemberFailure {
        team_session_id: team,
        message_id: id,
    }))
}

/// A sent wake is suppressed on terminal replay; transport failure leaves it
/// pending. Startup's existing durable mailbox drain does not depend on wakes.
pub(crate) fn pending_for_turn(db: &Database, turn: &str) -> Result<Option<QueuedMemberFailure>> {
    Ok(db.conn().query_row(
        "SELECT m.target_session_id,m.id FROM session_collaboration_messages m
         JOIN turns t ON t.id=?1 AND t.session_id=m.source_session_id AND t.status='completed'
         JOIN kv s ON s.ns='team-message-source-turn-v1' AND s.key=m.id AND json_extract(s.value_json,'$')=t.id
         WHERE m.status='queued' AND m.kind='message'
           AND m.plugin_id='team:'||m.target_session_id AND m.idempotency_key=?2||t.id
           AND NOT EXISTS(SELECT 1 FROM kv k WHERE k.ns=?3 AND k.key=m.id)",
        params![turn,host_notices::SILENT_PREFIX,host_notices::SILENT_EVENT_NS],
        |r| Ok(QueuedMemberFailure { team_session_id:r.get(0)?,message_id:r.get(1)? }),
    ).optional()?)
}

pub(crate) fn mark_notified(db: &Database, message: &str) -> Result<()> {
    db.kv_set(host_notices::SILENT_EVENT_NS, message, &json!(true))
}
