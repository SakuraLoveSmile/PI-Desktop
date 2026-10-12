//! Durable Host-authored member failures, within the terminal turn transaction.
use crate::db::Database;
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use uuid::Uuid;

pub(crate) const PROOF_NS: &str = "team-member-failure-v1";

pub struct QueuedMemberFailure {
    pub team_session_id: String,
    pub message_id: String,
}

pub(super) fn validate_message_key(key: Option<&str>) -> Result<()> {
    if key.is_some_and(|key| {
        key.trim().starts_with("member-turn-failed:")
            || key.trim().starts_with("team-run-limit-soft:")
    }) {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: member-turn-failed message keys are Host-owned"
        ));
    }
    Ok(())
}

/// Remove Host notice proofs before the owning mailbox rows cascade on deletion.
pub(crate) fn cleanup_session(conn: &Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns IN ('team-member-failure-v1','team-message-source-turn-v1')
        AND key IN (SELECT id FROM session_collaboration_messages WHERE
          (source_session_id=?1 OR target_session_id=?1) AND idempotency_key LIKE 'member-turn-failed:%')", [session])?;
    Ok(())
}

/// The caller owns the terminal CAS; aborts and replayed terminals never call us.
pub(crate) fn record(
    db: &Database,
    conn: &Connection,
    turn: &str,
) -> Result<Option<QueuedMemberFailure>> {
    let member: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT m.team_session_id,m.member_session_id,m.name,COALESCE(m.error,'TURN_FAILED')
         FROM team_members m JOIN turns t ON t.session_id=m.member_session_id
         WHERE t.id=?1 AND t.status='error'",
            [turn],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((team, member, name, code)) = member else {
        return Ok(None);
    };
    // Settlement may have just changed an associated task from in_progress to
    // failed. Keep that exact turn binding; do not sweep historical failures.
    let tasks = {
        let mut stmt = conn.prepare_cached(
            "SELECT task_id FROM team_tasks t WHERE team_session_id=?1 AND owner_session_id=?2
             AND deleted=0 AND (status IN ('pending','in_progress') OR EXISTS(
               SELECT 1 FROM kv k WHERE k.ns='team-task-attempt-v1'
                 AND json_extract(k.value_json,'$.teamSessionId')=t.team_session_id
                 AND json_extract(k.value_json,'$.taskId')=t.task_id
                 AND json_extract(k.value_json,'$.turnId')=?3)) ORDER BY task_id",
        )?;
        let rows = stmt.query_map(params![team, member, turn], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    // Preserve the starting dispatch's authority; ordinary member turns resolve
    // inherit through the same persisted default as normal Team mail.
    let dispatch_ceiling: Option<String> = conn
        .query_row(
            "SELECT permission_ceiling FROM session_collaboration_messages
          WHERE turn_id=?1 AND target_session_id=?2 AND plugin_id=?3 AND kind='message' LIMIT 1",
            params![turn, member, super::team_plugin_origin(&team)],
            |r| r.get(0),
        )
        .optional()?;
    let ceiling = match dispatch_ceiling {
        Some(ceiling) => ceiling,
        None => crate::session_collaboration::permissions::effective_mode(db, &member)?,
    };
    // Advisory only: errors without an unambiguous transient code require Lead
    // inspection rather than granting an automatic retry from unknown evidence.
    let retriable = matches!(
        code.as_str(),
        "HOST_OVERLOADED" | "HOST_UNAVAILABLE" | "PROVIDER_RATE_LIMITED" | "TIMEOUT"
    );
    let content = json!({"kind":"member_failed","memberName":name,"errorCode":code,
        "retriable":retriable,"taskIds":tasks,"suggestedAction":if retriable {
            "inspect team_status and task state, then explicitly re-dispatch if retry is appropriate"
        } else { "inspect the member failure and task state; correct the cause before explicitly re-dispatching" }}).to_string();
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
            format!("member-turn-failed:{turn}"),
            ceiling,
            now
        ],
    )?;
    if inserted == 0 {
        return Ok(None);
    }
    for ns in ["team-message-source-turn-v1", PROOF_NS] {
        conn.execute(
            "INSERT INTO kv(ns,key,value_json,updated_at) VALUES(?1,?2,?3,?4)",
            params![ns, id, json!(turn).to_string(), now],
        )?;
    }
    super::lifecycle::bump_team_revision_conn(conn, &team)?;
    Ok(Some(QueuedMemberFailure {
        team_session_id: team,
        message_id: id,
    }))
}

/// Read a still-undelivered durable notice even when post-commit checkpoint I/O
/// failed or the terminal CAS was replayed. A model body is never authority.
pub(crate) fn pending_for_turn(db: &Database, turn: &str) -> Result<Option<QueuedMemberFailure>> {
    Ok(db.conn().query_row(
        "SELECT m.target_session_id,m.id FROM session_collaboration_messages m
         JOIN turns t ON t.id=?1 AND t.session_id=m.source_session_id AND t.status='error'
         JOIN kv k ON k.ns=?2 AND k.key=m.id AND json_extract(k.value_json,'$')=t.id
         JOIN kv s ON s.ns='team-message-source-turn-v1' AND s.key=m.id AND json_extract(s.value_json,'$')=t.id
         WHERE m.status='queued' AND m.kind='message' AND m.plugin_id='team:'||m.target_session_id
           AND m.idempotency_key='member-turn-failed:'||t.id",
        params![turn,PROOF_NS], |row|Ok(QueuedMemberFailure { team_session_id:row.get(0)?,message_id:row.get(1)? }),
    ).optional()?)
}
