//! Narrow monotonic refresh of a Task launch receipt when its delegate settles.
use super::{transcripts, Database, UiMessage};
use anyhow::{anyhow, Result};
use serde_json::Value;

fn is_task(name: Option<&str>) -> bool {
    let bare: String = name
        .unwrap_or("")
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect();
    matches!(bare.as_str(), "task" | "subagent")
}
fn details(message: &UiMessage) -> Option<&Value> {
    message
        .tool_result
        .as_ref()?
        .get("details")
        .filter(|v| v.is_object())
}
fn terminal(status: &str) -> bool {
    matches!(
        status,
        "completed" | "failed" | "timed_out" | "aborted" | "stopped" | "denied"
    )
}

/// Return true only when a canonical receipt was refreshed. Final snapshots and
/// ordinary message replays retain the existing idempotent append semantics.
pub(super) fn refresh(
    db: &Database,
    session_id: &str,
    incoming: &UiMessage,
    turn_id: Option<&str>,
) -> Result<bool> {
    // Most outbox replays are ordinary immutable messages; avoid reading their bodies.
    let (role, name, stored_turn): (String, Option<String>, Option<String>) = db.conn().query_row(
        "SELECT role, tool_name, turn_id FROM messages WHERE session_id=?1 AND id=?2",
        [session_id, &incoming.id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if role != "tool" || !is_task(name.as_deref()) {
        return Ok(false);
    }
    let layout = super::session_layout(db, session_id)?;
    let Some(position) =
        transcripts::find_message_position(db.data_dir(), session_id, &layout, &incoming.id)?
    else {
        return Err(anyhow!("indexed message is missing from its transcript"));
    };
    let mut read = transcripts::read_transcript_window_with_layout(
        db.data_dir(),
        session_id,
        &layout,
        position,
        Some(1),
    )?;
    let mut record = read
        .messages
        .pop()
        .ok_or_else(|| anyhow!("indexed message is missing from its transcript"))?;
    if record.role != "tool" || !is_task(record.tool_name.as_deref()) {
        return Ok(false);
    }
    let previous = super::record_to_ui(record.clone());
    let Some(old) = details(&previous) else {
        return Ok(false);
    };
    let Some(id) = old
        .get("delegationId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return Ok(false);
    };
    let invalid = || anyhow!("delegation snapshot identity mismatch");
    let new = details(incoming).ok_or_else(invalid)?;
    if turn_id != stored_turn.as_deref()
        || incoming.role != previous.role
        || incoming.tool_name != previous.tool_name
        || incoming.tool_call_id != previous.tool_call_id
        || incoming.tool_args != previous.tool_args
        || incoming.parent_tool_call_id != previous.parent_tool_call_id
        || incoming.nested_parent_tool_call_id != previous.nested_parent_tool_call_id
        || incoming.agent_name != previous.agent_name
        || incoming.created_at != previous.created_at
        || new.get("delegationId").and_then(Value::as_str) != Some(id)
        || matches!((new.get("startedAt"), old.get("startedAt")), (Some(a), Some(b)) if !a.is_null() && !b.is_null() && a != b)
    {
        return Err(invalid());
    }
    // The completed Task launch call is a different lifecycle from the delegate.
    // Preserve its status, duration and usage while refreshing only delegate data.
    if old.get("status").and_then(Value::as_str) != Some("running") {
        return Ok(false);
    }
    if previous.tool_status.as_deref() != Some("success")
        || incoming.tool_status != previous.tool_status
        || incoming.is_error.unwrap_or(false) != previous.is_error.unwrap_or(false)
    {
        return Err(invalid());
    }
    if !new
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(terminal)
    {
        return Ok(false);
    }
    let blocks = record
        .blocks
        .as_array_mut()
        .ok_or_else(|| anyhow!("invalid canonical tool blocks"))?;
    let tool = blocks
        .iter_mut()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("tool_call"))
        .ok_or_else(|| anyhow!("missing canonical tool block"))?;
    tool["result"] = incoming.tool_result.clone().ok_or_else(invalid)?;
    tool["text"] = Value::String(incoming.content.clone());
    super::invalidate_transcript_layout(session_id);
    if !transcripts::update_message(db.data_dir(), session_id, &record)? {
        return Err(anyhow!("delegation receipt is missing from its transcript"));
    }
    // The index contains no delegate content, and receipt error/usage/timing are
    // preserved. Do not replace the index row or count a second tool execution.
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn snapshot(status: &str) -> UiMessage {
        serde_json::from_value(json!({"id": "task", "role": "tool", "content": format!("Delegate {status}"),
            "createdAt": "2026-10-10T00:00:00Z", "toolName": "Task", "toolCallId": "call", "toolStatus": "success",
            "toolCompletedAt": "2026-10-10T00:00:01Z", "toolDurationMs": 1000, "isError": false,
            "toolArgs": {"agent": "worker", "task": "Work"}, "toolResult": {"details": {"delegationId": "delegate", "status": status, "startedAt": 10, "completedAt": if status == "running" { Value::Null } else { json!(20) }}}})).unwrap()
    }
    #[test]
    fn launch_receipt_settles_once_and_survives_stale_outbox_replay_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = super::super::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let turn = super::super::begin_turn(&db, &id, None, None).unwrap();
        let running = snapshot("running");
        super::super::append_message(&db, &id, &running, Some(&turn)).unwrap();
        let mut canonical = transcripts::read_transcript(db.data_dir(), &id)
            .unwrap()
            .remove(0);
        canonical.meta.get_or_insert_with(|| json!({}))["extensionEvidence"] =
            json!({"retained": true});
        canonical.blocks[0]["toolUsage"] = json!({"totalTokens": 8});
        transcripts::update_message(db.data_dir(), &id, &canonical).unwrap();
        super::super::invalidate_transcript_layout(&id);
        let index: (i64, i64, String) = db
            .conn()
            .query_row(
                "SELECT mid, seq, turn_id FROM messages WHERE id='task'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let mut final_row = snapshot("completed");
        final_row.tool_duration_ms = Some(999999);
        final_row.tool_completed_at = Some("2026-10-10T23:00:00Z".into());
        super::super::append_message(&db, &id, &final_row, Some(&turn)).unwrap();
        super::super::append_message(&db, &id, &running, Some(&turn)).unwrap();
        super::super::append_message(&db, &id, &snapshot("failed"), Some(&turn)).unwrap();
        super::super::append_message(&db, &id, &final_row, Some(&turn)).unwrap();
        let detail = super::super::get_session(&db, &id).unwrap().unwrap();
        assert_eq!(detail.messages.len(), 1);
        let saved = &detail.messages[0];
        assert_eq!(details(saved).unwrap()["status"], "completed");
        assert_eq!(saved.content, "Delegate completed");
        assert_eq!(saved.tool_duration_ms, Some(1000));
        assert_eq!(saved.tool_completed_at, running.tool_completed_at);
        let canonical = transcripts::read_transcript(db.data_dir(), &id)
            .unwrap()
            .remove(0);
        assert_eq!(
            canonical.meta.unwrap()["extensionEvidence"]["retained"],
            true
        );
        assert_eq!(canonical.blocks[0]["toolUsage"]["totalTokens"], 8);
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT mid, seq, turn_id FROM messages WHERE id='task'",
                    [],
                    |r| Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, String>(2)?
                    ))
                )
                .unwrap(),
            index
        );
        let activity = crate::session_activity::get(&db, &id, 0, 50).unwrap();
        assert_eq!(activity["subagents"][0]["status"], "completed");
        drop(db);
        let reopened = Database::open_in_dir(dir.path()).unwrap();
        assert_eq!(
            crate::session_activity::get(&reopened, &id, 0, 50).unwrap(),
            activity
        );
    }
    #[test]
    fn delegation_identity_cannot_be_rebound_by_replay_and_ordinary_tools_stay_immutable() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = super::super::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        super::super::append_message(&db, &id, &snapshot("running"), None).unwrap();
        let final_row = serde_json::to_value(snapshot("completed")).unwrap();
        for (pointer, value) in [
            ("/role", json!("assistant")),
            ("/toolName", json!("Subagent")),
            ("/toolCallId", json!("other")),
            ("/toolArgs/task", json!("Changed")),
            ("/parentToolCallId", json!("other")),
            ("/toolResult/details/delegationId", json!("other")),
            ("/toolResult/details/startedAt", json!(11)),
        ] {
            let mut forged = final_row.clone();
            if pointer == "/parentToolCallId" {
                forged["parentToolCallId"] = value;
            } else {
                *forged.pointer_mut(pointer).unwrap() = value;
            }
            let forged: UiMessage = serde_json::from_value(forged).unwrap();
            assert!(
                super::super::append_message(&db, &id, &forged, None).is_err(),
                "{pointer}"
            );
        }
        assert_eq!(
            crate::session_activity::get(&db, &id, 0, 50).unwrap()["subagents"][0]["status"],
            "aborted"
        );
        let mut ordinary = snapshot("running");
        ordinary.id = "write".into();
        ordinary.tool_name = Some("Write".into());
        super::super::append_message(&db, &id, &ordinary, None).unwrap();
        ordinary.content = "Changed replay".into();
        super::super::append_message(&db, &id, &ordinary, None).unwrap();
        assert_ne!(
            super::super::get_session(&db, &id)
                .unwrap()
                .unwrap()
                .messages[1]
                .content,
            ordinary.content
        );
    }
    #[test]
    fn legacy_receipt_can_gain_first_known_start_time_but_cannot_move_to_another_turn() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = super::super::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let mut running = snapshot("running");
        running.tool_result.as_mut().unwrap()["details"]
            .as_object_mut()
            .unwrap()
            .remove("startedAt");
        super::super::append_message(&db, &id, &running, None).unwrap();
        let turn = super::super::begin_turn(&db, &id, None, None).unwrap();
        assert!(
            super::super::append_message(&db, &id, &snapshot("completed"), Some(&turn)).is_err()
        );
        super::super::append_message(&db, &id, &snapshot("completed"), None).unwrap();
        let saved = super::super::get_session(&db, &id).unwrap().unwrap();
        assert_eq!(details(&saved.messages[0]).unwrap()["status"], "completed");
        assert_eq!(details(&saved.messages[0]).unwrap()["startedAt"], 10);
    }
    #[test]
    fn colliding_cross_session_task_receipt_settles_the_namespaced_record_only() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let a = super::super::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let b = super::super::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let turn_a = super::super::begin_turn(&db, &a, None, None).unwrap();
        let turn_b = super::super::begin_turn(&db, &b, None, None).unwrap();
        let running = snapshot("running");
        super::super::append_message(&db, &a, &running, Some(&turn_a)).unwrap();
        super::super::append_message(&db, &b, &running, Some(&turn_b)).unwrap();
        super::super::append_message(&db, &b, &snapshot("completed"), Some(&turn_b)).unwrap();
        let detail_b = super::super::get_session(&db, &b).unwrap().unwrap();
        assert_eq!(detail_b.messages.len(), 1);
        assert_eq!(detail_b.messages[0].id, format!("{b}:task"));
        assert_eq!(detail_b.messages[0].tool_call_id.as_deref(), Some("call"));
        assert_eq!(
            details(&detail_b.messages[0]).unwrap()["status"],
            "completed"
        );
        assert_eq!(
            crate::session_activity::get(&db, &a, 0, 50).unwrap()["subagents"][0]["status"],
            "running"
        );
        assert_eq!(
            crate::session_activity::get(&db, &b, 0, 50).unwrap()["subagents"][0]["status"],
            "completed"
        );
        super::super::append_message(&db, &b, &running, Some(&turn_b)).unwrap();
        assert_eq!(
            crate::session_activity::get(&db, &b, 0, 50).unwrap()["subagents"][0]["status"],
            "completed"
        );
        drop(db);
        let reopened = Database::open_in_dir(dir.path()).unwrap();
        // Reopening applies the existing startup turn fence; the other session's
        // canonical Task was never settled or rewritten by B's update.
        let unchanged_a = super::super::get_session(&reopened, &a).unwrap().unwrap();
        assert_eq!(
            details(&unchanged_a.messages[0]).unwrap()["status"],
            "running"
        );
        assert_eq!(unchanged_a.messages[0].content, running.content);
        assert_eq!(
            crate::session_activity::get(&reopened, &a, 0, 50).unwrap()["subagents"][0]["status"],
            "aborted"
        );
        assert_eq!(
            crate::session_activity::get(&reopened, &b, 0, 50).unwrap()["subagents"][0]["status"],
            "completed"
        );
    }
}
