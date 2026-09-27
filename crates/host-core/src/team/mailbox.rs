use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::model::{TeamMessage, MAX_MEMBER_QUEUED_MESSAGES, MAX_MESSAGE_BYTES};
use super::roster::{
    get_team_member_by_name, get_team_member_by_session_id, validate_team_participant,
};
use crate::db::{now_ms, Database};
use crate::sessions;

const TEAM_MESSAGE_KIND: &str = "message";

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

fn validate_participant_permissions(
    db: &Database,
    source_session_id: &str,
    target_session_id: &str,
) -> Result<String> {
    let ceiling = crate::session_collaboration::permissions::effective_mode(db, source_session_id)?;
    crate::session_collaboration::permissions::check_target(db, target_session_id, &ceiling)?;
    Ok(ceiling)
}

fn validate_ack_permission_modes(
    db: &Database,
    source_session_id: &str,
    target_session_id: &str,
) -> Result<()> {
    for (role, session_id) in [("sender", source_session_id), ("target", target_session_id)] {
        let mode = sessions::session_permission_mode(db, session_id)?
            .ok_or_else(|| anyhow!("TEAM_UNAUTHORIZED: {role} session not found"))?;
        if !sessions::is_valid_permission_mode(&mode) {
            return Err(anyhow!("TEAM_UNAUTHORIZED: invalid {role} permission mode"));
        }
    }
    Ok(())
}

fn message_from_row(
    row: &rusqlite::Row<'_>,
    team_session_id: &str,
) -> rusqlite::Result<TeamMessage> {
    let status: String = row.get(6)?;
    let turn_id: Option<String> = row.get(9)?;
    let acknowledged: bool = row.get(10)?;
    let accepted: bool = row.get(11)?;
    let delivery_status = if acknowledged {
        "acknowledged"
    } else {
        match status.as_str() {
            "running" => "accepted",
            _ if accepted => "accepted",
            "completed" => "completed",
            "failed" => "failed",
            _ => "queued",
        }
    };
    Ok(TeamMessage {
        id: row.get(0)?,
        team_session_id: team_session_id.to_string(),
        source_session_id: row.get(1)?,
        source_member_name: row.get(2)?,
        target_session_id: row.get(3)?,
        target_member_name: row.get(4)?,
        content: row.get(5)?,
        turn_id,
        status,
        delivery_status: delivery_status.to_string(),
        created_at: row.get::<_, i64>(7)?.to_string(),
        updated_at: row.get::<_, i64>(8)?.to_string(),
    })
}

fn get_message(
    db: &Database,
    team_session_id: &str,
    message_id: &str,
) -> Result<Option<TeamMessage>> {
    let plugin_id = team_plugin_origin(team_session_id);
    Ok(db
        .conn()
        .prepare_cached(
            "SELECT m.id, m.source_session_id, m.source_title, m.target_session_id,
                    m.target_title, m.content, m.status, m.created_at, m.updated_at, m.turn_id,
                    EXISTS(SELECT 1 FROM session_collaboration_messages receipt
                           WHERE receipt.kind = 'completion'
                             AND receipt.reply_to_message_id = m.id),
                    EXISTS(SELECT 1 FROM turn_queue q WHERE q.session_message_id = m.id)
             FROM session_collaboration_messages m
             WHERE m.id = ?1 AND m.plugin_id = ?2 AND m.kind = ?3",
        )?
        .query_row(params![message_id, plugin_id, TEAM_MESSAGE_KIND], |row| {
            message_from_row(row, team_session_id)
        })
        .optional()?)
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

    // 2. Validate source membership and Team execution profile from Host state.
    let source_member_name = validate_team_participant(db, team_session_id, caller_session_id)?;

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

    validate_team_participant(db, team_session_id, &target_session_id)?;
    let permission_ceiling =
        validate_participant_permissions(db, caller_session_id, &target_session_id)?;

    let plugin_id = team_plugin_origin(team_session_id);

    // 4. Enforce mailbox queue limit (<= 64 pending messages)
    let queued_count: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM session_collaboration_messages
         WHERE plugin_id = ?1 AND kind = ?2 AND target_session_id = ?3 AND status = 'queued'",
        params![plugin_id, TEAM_MESSAGE_KIND, target_session_id],
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

    let existing = db
        .conn()
        .query_row(
            "SELECT m.id, m.source_session_id, m.source_title, m.target_session_id,
                    m.target_title, m.content, m.status, m.created_at, m.updated_at, m.turn_id,
                    EXISTS(SELECT 1 FROM session_collaboration_messages receipt
                           WHERE receipt.kind = 'completion'
                             AND receipt.reply_to_message_id = m.id),
                    EXISTS(SELECT 1 FROM turn_queue q WHERE q.session_message_id = m.id)
             FROM session_collaboration_messages m
             WHERE m.plugin_id = ?1 AND m.source_session_id = ?2
               AND m.idempotency_key = ?3 AND m.kind = ?4",
            params![plugin_id, caller_session_id, idem_key, TEAM_MESSAGE_KIND],
            |row| message_from_row(row, team_session_id),
        )
        .optional()?;
    if let Some(existing) = existing {
        if existing.target_session_id != target_session_id || existing.content != content {
            return Err(anyhow!(
                "IDEMPOTENCY_CONFLICT: key was already used for another team message"
            ));
        }
        return Ok(existing);
    }

    db.conn().execute(
        "INSERT INTO session_collaboration_messages (
            id, plugin_id, source_session_id, source_title, target_session_id,
                    target_title, kind, content, status, notify_on_completion, idempotency_key,
                    remaining_hops, permission_ceiling, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 0, ?9, 1, ?10, ?11, ?11)
         ON CONFLICT(plugin_id, source_session_id, idempotency_key) DO NOTHING",
        params![
            message_id,
            plugin_id,
            caller_session_id,
            source_member_name,
            target_session_id,
            target_member_name,
            TEAM_MESSAGE_KIND,
            content,
            idem_key,
            permission_ceiling,
            now
        ],
    )?;

    // A concurrent sender may have won the unique key between the read and
    // insert. Return the durable row in that case, never a fabricated ID.
    if let Some(message) = get_message(db, team_session_id, &message_id)? {
        return Ok(message);
    }
    let durable_id: Option<String> = db
        .conn()
        .query_row(
            "SELECT id FROM session_collaboration_messages
             WHERE plugin_id = ?1 AND source_session_id = ?2
               AND idempotency_key = ?3 AND kind = ?4",
            params![plugin_id, caller_session_id, idem_key, TEAM_MESSAGE_KIND],
            |row| row.get(0),
        )
        .optional()?;
    durable_id
        .and_then(|id| get_message(db, team_session_id, &id).transpose())
        .transpose()?
        .ok_or_else(|| anyhow!("TEAM_MESSAGE_PERSISTENCE_FAILED: message receipt was not durable"))
}

pub fn get_team_message(
    db: &Database,
    team_session_id: &str,
    caller_session_id: &str,
    message_id: &str,
) -> Result<Option<TeamMessage>> {
    validate_team_participant(db, team_session_id, caller_session_id)?;
    let Some(message) = get_message(db, team_session_id, message_id)? else {
        return Ok(None);
    };
    if caller_session_id != team_session_id
        && caller_session_id != message.source_session_id
        && caller_session_id != message.target_session_id
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: caller cannot read this Team message"
        ));
    }
    Ok(Some(message))
}

/// Pending Team mail includes durable Agent Host queue entries that need
/// startup recovery, and is visible only while the owning Team is unpaused.
pub fn list_pending_team_messages(
    db: &Database,
    team_session_id: &str,
) -> Result<Vec<TeamMessage>> {
    let plugin_id = team_plugin_origin(team_session_id);
    let mut stmt = db.conn().prepare_cached(
        "SELECT m.id, m.source_session_id, m.source_title, m.target_session_id,
                m.target_title, m.content, m.status, m.created_at, m.updated_at, m.turn_id,
                EXISTS(SELECT 1 FROM session_collaboration_messages receipt
                       WHERE receipt.kind = 'completion'
                         AND receipt.reply_to_message_id = m.id),
                EXISTS(SELECT 1 FROM turn_queue q WHERE q.session_message_id = m.id)
         FROM session_collaboration_messages m
         LEFT JOIN teams t ON t.team_session_id = ?2
         WHERE m.plugin_id = ?1 AND m.kind = ?3 AND m.status = 'queued'
           AND m.turn_id IS NULL
           AND COALESCE(t.paused, 0) = 0
         ORDER BY m.created_at ASC, m.id ASC",
    )?;
    let messages = stmt
        .query_map(
            params![plugin_id, team_session_id, TEAM_MESSAGE_KIND],
            |row| message_from_row(row, team_session_id),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(messages)
}

pub fn list_member_messages(
    db: &Database,
    team_session_id: &str,
    session_id: &str,
) -> Result<Vec<TeamMessage>> {
    let plugin_id = team_plugin_origin(team_session_id);
    let mut stmt = db.conn().prepare_cached(
        "SELECT m.id, m.source_session_id, m.source_title, m.target_session_id, m.target_title,
                m.content, m.status, m.created_at, m.updated_at, m.turn_id,
                EXISTS(SELECT 1 FROM session_collaboration_messages receipt
                       WHERE receipt.kind = 'completion'
                         AND receipt.reply_to_message_id = m.id),
                EXISTS(SELECT 1 FROM turn_queue q WHERE q.session_message_id = m.id)
         FROM session_collaboration_messages m
         WHERE plugin_id = ?1 AND kind = ?3
           AND (source_session_id = ?2 OR target_session_id = ?2)
         ORDER BY created_at ASC, id ASC",
    )?;
    let msgs = stmt
        .query_map(params![plugin_id, session_id, TEAM_MESSAGE_KIND], |row| {
            message_from_row(row, team_session_id)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(msgs)
}

#[allow(dead_code)]
pub fn ack_team_message(
    db: &Database,
    team_session_id: &str,
    ack_session_id: &str,
    message_id: &str,
    result_text: Option<&str>,
) -> Result<bool> {
    let plugin_id = team_plugin_origin(team_session_id);
    validate_team_participant(db, team_session_id, ack_session_id)?;
    let (source_session_id, target_session_id): (String, String) = db
        .conn()
        .query_row(
            "SELECT source_session_id, target_session_id
             FROM session_collaboration_messages
             WHERE id = ?1 AND plugin_id = ?2 AND kind = ?3",
            params![message_id, plugin_id, TEAM_MESSAGE_KIND],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| anyhow!("TEAM_MESSAGE_NOT_FOUND: message not found"))?;
    if target_session_id != ack_session_id {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: only the message target can acknowledge it"
        ));
    }
    validate_team_participant(db, team_session_id, &source_session_id)?;
    validate_ack_permission_modes(db, &source_session_id, &target_session_id)?;
    let now = now_ms();
    let tx = db.conn().unchecked_transaction()?;
    let already_acknowledged: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_collaboration_messages
                       WHERE kind = 'completion' AND reply_to_message_id = ?1)",
        params![message_id],
        |row| row.get(0),
    )?;
    if already_acknowledged {
        tx.commit()?;
        return Ok(true);
    }
    let has_durable_queue_receipt: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM turn_queue
                       WHERE session_message_id = ?1 AND session_id = ?2)
             OR EXISTS(SELECT 1 FROM session_collaboration_messages m
                       JOIN turns t ON t.id = m.turn_id
                       WHERE m.id = ?1 AND m.target_session_id = ?2 AND t.session_id = ?2)",
        params![message_id, ack_session_id],
        |row| row.get(0),
    )?;
    if !has_durable_queue_receipt {
        return Err(anyhow!(
            "TEAM_DELIVERY_PENDING: recipient turn receipt is not durable"
        ));
    }
    let receipt_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO session_collaboration_messages
         (id, plugin_id, source_session_id, source_title, target_session_id,
          target_title, kind, content, status, notify_on_completion, reply_to_message_id,
          idempotency_key, remaining_hops, permission_ceiling, result, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'Team member', ?4, 'Team sender', 'completion',
                 ?5, 'completed', 0, ?6, ?7, 1, 'auto', ?5, ?8, ?8)",
        params![
            receipt_id,
            plugin_id,
            ack_session_id,
            source_session_id,
            result_text.unwrap_or("acknowledged"),
            message_id,
            format!("ack:{message_id}"),
            now,
        ],
    )?;
    tx.execute(
        "UPDATE session_collaboration_messages
         SET result = ?1, updated_at = ?2
         WHERE id = ?3 AND plugin_id = ?4 AND kind = ?5",
        params![result_text, now, message_id, plugin_id, TEAM_MESSAGE_KIND],
    )?;
    tx.commit()?;
    Ok(true)
}
