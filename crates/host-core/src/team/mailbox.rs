use anyhow::{anyhow, Result};
use rusqlite::params;
use uuid::Uuid;

use super::model::{TeamMessage, MAX_MEMBER_QUEUED_MESSAGES, MAX_MESSAGE_BYTES};
use super::roster::{get_team_member_by_name, get_team_member_by_session_id};
use crate::db::{now_ms, Database};

pub fn team_plugin_origin(team_session_id: &str) -> String {
    format!("team:{team_session_id}")
}

pub struct SendMessageParams<'a> {
    pub team_session_id: &'a str,
    pub caller_session_id: &'a str,
    pub target_identifier: &'a str, // Either member name or session ID
    pub content: &'a str,
    pub idempotency_key: Option<&'a str>,
}

pub fn send_team_message(db: &Database, params: SendMessageParams<'_>) -> Result<TeamMessage> {
    let SendMessageParams {
        team_session_id,
        caller_session_id,
        target_identifier,
        content,
        idempotency_key,
    } = params;

    // 1. Validate payload size <= 64 KiB
    if content.len() > MAX_MESSAGE_BYTES {
        return Err(anyhow!(
            "TEAM_MESSAGE_PAYLOAD_TOO_LARGE: message exceeds maximum size of {MAX_MESSAGE_BYTES} bytes"
        ));
    }

    // 2. Validate source membership
    let source_member_name = if caller_session_id == team_session_id {
        "Lead".to_string()
    } else {
        let member = get_team_member_by_session_id(db, caller_session_id)?
            .ok_or_else(|| anyhow!("TEAM_UNAUTHORIZED: sender is not a member of this team"))?;
        if member.team_session_id != team_session_id {
            return Err(anyhow!(
                "TEAM_UNAUTHORIZED: sender belongs to a different team"
            ));
        }
        member.name
    };

    // 3. Resolve target membership
    let (target_session_id, target_member_name) =
        if target_identifier == "Lead" || target_identifier == team_session_id {
            (team_session_id.to_string(), "Lead".to_string())
        } else if let Some(m) = get_team_member_by_name(db, team_session_id, target_identifier)? {
            (m.member_session_id, m.name)
        } else if let Some(m) = get_team_member_by_session_id(db, target_identifier)? {
            if m.team_session_id != team_session_id {
                return Err(anyhow!("TEAM_TARGET_NOT_FOUND: target is not in this team"));
            }
            (m.member_session_id, m.name)
        } else {
            return Err(anyhow!(
                "TEAM_TARGET_NOT_FOUND: recipient '{target_identifier}' not found in team"
            ));
        };

    if caller_session_id == target_session_id {
        return Err(anyhow!("INVALID_PARAMS: cannot send team message to self"));
    }

    let plugin_id = team_plugin_origin(team_session_id);

    // 4. Enforce mailbox queue limit (<= 64 pending messages)
    let queued_count: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM session_collaboration_messages
         WHERE plugin_id = ?1 AND target_session_id = ?2 AND status = 'queued'",
        params![plugin_id, target_session_id],
        |row| row.get(0),
    )?;
    if queued_count >= MAX_MEMBER_QUEUED_MESSAGES {
        return Err(anyhow!(
            "TEAM_MAILBOX_FULL: recipient mailbox is full ({MAX_MEMBER_QUEUED_MESSAGES} queued messages)"
        ));
    }

    let now = now_ms();
    let message_id = Uuid::new_v4().to_string();
    let gen_key = Uuid::new_v4().to_string();
    let idem_key = idempotency_key.unwrap_or(&gen_key);

    db.conn().execute(
        "INSERT INTO session_collaboration_messages (
            id, plugin_id, source_session_id, source_title, target_session_id,
            target_title, kind, content, status, notify_on_completion, idempotency_key,
            remaining_hops, permission_ceiling, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'message', ?7, 'queued', 0, ?8, 1, 'auto', ?9, ?9)
         ON CONFLICT(plugin_id, source_session_id, idempotency_key) DO UPDATE SET updated_at = excluded.updated_at",
        params![
            message_id,
            plugin_id,
            caller_session_id,
            source_member_name,
            target_session_id,
            target_member_name,
            content,
            idem_key,
            now
        ],
    )?;

    Ok(TeamMessage {
        id: message_id,
        team_session_id: team_session_id.to_string(),
        source_session_id: caller_session_id.to_string(),
        source_member_name,
        target_session_id,
        target_member_name,
        content: content.to_string(),
        status: "queued".to_string(),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    })
}

pub fn list_member_messages(
    db: &Database,
    team_session_id: &str,
    session_id: &str,
) -> Result<Vec<TeamMessage>> {
    let plugin_id = team_plugin_origin(team_session_id);
    let mut stmt = db.conn().prepare_cached(
        "SELECT id, source_session_id, source_title, target_session_id, target_title,
                content, status, created_at, updated_at
         FROM session_collaboration_messages
         WHERE plugin_id = ?1 AND (source_session_id = ?2 OR target_session_id = ?2)
         ORDER BY created_at ASC, id ASC",
    )?;
    let msgs = stmt
        .query_map(params![plugin_id, session_id], |row| {
            Ok(TeamMessage {
                id: row.get(0)?,
                team_session_id: team_session_id.to_string(),
                source_session_id: row.get(1)?,
                source_member_name: row.get(2)?,
                target_session_id: row.get(3)?,
                target_member_name: row.get(4)?,
                content: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get::<_, i64>(7)?.to_string(),
                updated_at: row.get::<_, i64>(8)?.to_string(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(msgs)
}

#[allow(dead_code)]
pub fn ack_team_message(
    db: &Database,
    team_session_id: &str,
    message_id: &str,
    result_text: Option<&str>,
) -> Result<bool> {
    let plugin_id = team_plugin_origin(team_session_id);
    let now = now_ms();
    let rows = db.conn().execute(
        "UPDATE session_collaboration_messages
         SET status = 'completed', result = ?1, updated_at = ?2
         WHERE id = ?3 AND plugin_id = ?4",
        params![result_text, now, message_id, plugin_id],
    )?;
    Ok(rows > 0)
}
