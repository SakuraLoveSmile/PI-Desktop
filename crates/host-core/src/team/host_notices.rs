//! Shared reserved key ownership for durable Host-authored Team notices.
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};

pub(super) const FAILED_PREFIX: &str = "member-turn-failed:";
pub(super) const SILENT_PREFIX: &str = "member-turn-silent:";
const SOFT_LIMIT_PREFIX: &str = "team-run-limit-soft:";
const PREFIXES: [&str; 3] = [FAILED_PREFIX, SILENT_PREFIX, SOFT_LIMIT_PREFIX];
pub(super) const SILENT_EVENT_NS: &str = "team-member-silence-event-v1";

pub(super) fn prefixes_json() -> String {
    serde_json::json!(PREFIXES).to_string()
}

pub(super) fn validate_message_key(key: Option<&str>) -> Result<()> {
    if key.is_some_and(|key| PREFIXES.iter().any(|prefix| key.trim().starts_with(prefix))) {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: reserved Team notice message keys are Host-owned"
        ));
    }
    Ok(())
}

/// Mailbox rows still exist here, before session deletion cascades them away.
pub(crate) fn cleanup_session(conn: &Connection, session: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM kv WHERE ns IN ('team-member-failure-v1','team-message-source-turn-v1','team-member-silence-event-v1')
         AND key IN (SELECT id FROM session_collaboration_messages m WHERE
           (source_session_id=?1 OR target_session_id=?1) AND EXISTS
           (SELECT 1 FROM json_each(?2) p WHERE m.idempotency_key LIKE p.value||'%'))",
        params![session, prefixes_json()],
    )?;
    Ok(())
}

/// Mail is durable independently of wake events. Failures retain their existing
/// replay delivery; silence wakes mark successful transport admission once.
pub(crate) fn send_pending(
    db: &crate::db::Database,
    tx: &tokio::sync::mpsc::UnboundedSender<String>,
    turn: &str,
) -> Result<()> {
    let wake = |notice: &super::member_failure::QueuedMemberFailure| {
        format!(
            "{}\n",
            serde_json::json!({"jsonrpc":"2.0","method":"team.messageQueued",
            "params":{"teamSessionId":notice.team_session_id,"messageId":notice.message_id}})
        )
    };
    if let Some(notice) = super::member_failure::pending_for_turn(db, turn)? {
        // Existing member_failed transport behavior is intentionally unchanged.
        let _ = tx.send(wake(&notice));
    }
    if let Some(notice) = super::member_silence::pending_for_turn(db, turn)? {
        // Mark only after transport accepts the wake; closure retains recovery.
        tx.send(wake(&notice))?;
        super::member_silence::mark_notified(db, &notice.message_id)?;
    }
    Ok(())
}
