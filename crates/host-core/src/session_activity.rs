//! Read-only summaries of a session's complete canonical transcript.
//! No assistant prose, tool output bodies, attachment contents or credentials cross this boundary.

use crate::{db::Database, sessions, transcripts};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

const MAX_LITERAL_BYTES: usize = 4096;
const MAX_TEXT_CHARS: usize = 1000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn text(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or("")
}
fn literal(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_LITERAL_BYTES && !value.contains('\0')
}
fn label(value: &str) -> String {
    value.chars().take(MAX_TEXT_CHARS).collect()
}
fn payload(message: &sessions::UiMessage) -> &Value {
    let raw = message.tool_result.as_ref().unwrap_or(&Value::Null);
    raw.get("details").filter(|v| !v.is_null()).unwrap_or(raw)
}
fn outcome(value: &str) -> Option<&str> {
    [
        "running",
        "completed",
        "timed_out",
        "aborted",
        "failed",
        "stopped",
        "denied",
    ]
    .contains(&value)
    .then_some(value)
}
fn bare_tool(value: &str) -> String {
    value
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect()
}
fn timestamp(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|t| t.timestamp_millis())
}
fn line_counts(message: &sessions::UiMessage, path: &str) -> Option<(u64, u64)> {
    if !["Write", "Edit"].contains(&message.tool_name.as_deref().unwrap_or("")) {
        return None;
    }
    let details = payload(message);
    let review = details.get("review")?;
    if details.get("root")? != "workspace"
        || review.get("version")? != 1
        || text(review.get("messageId")) != message.id
        || text(review.get("path")) != path
        || !literal(text(review.get("snapshotId")))
        || !["write", "edit", "delete"].contains(&text(review.get("operation")))
        || !["added", "modified", "deleted"].contains(&text(review.get("status")))
        || !["active", "rolledBack"].contains(&text(review.get("state")))
        || review.get("binary").and_then(Value::as_bool) == Some(true)
        || review.get("truncated").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let added = review.get("additions")?.as_u64()?;
    let removed = review.get("deletions")?.as_u64()?;
    (added <= MAX_SAFE_INTEGER && removed <= MAX_SAFE_INTEGER).then_some((added, removed))
}
fn resource(id: &str, name: &str, path: Option<&str>, message_id: Option<&str>) -> Value {
    let mut item = json!({"id": id, "label": label(name)});
    if let Some(path) = path {
        item["path"] = json!(path);
    }
    if let Some(id) = message_id {
        item["messageId"] = json!(id);
    }
    item
}

/// Authority is validated before filesystem access. SQLite still owns session identity,
/// while the canonical active transcript (not archived regenerate branches) owns evidence.
pub(crate) fn get(db: &Database, session_id: &str, offset: usize, limit: usize) -> Result<Value> {
    if !literal(session_id) {
        return Err(anyhow!("INVALID_ARGUMENT"));
    }
    if session_id.starts_with("remote:") || session_id.starts_with("native-pi:") {
        return Err(anyhow!("SESSION_ACTIVITY_UNSUPPORTED"));
    }
    let source: Option<String> = db
        .conn()
        .query_row(
            "SELECT COALESCE(source, 'desktop') FROM sessions WHERE id = ?1 AND deleted_at IS NULL",
            [session_id],
            |r| r.get(0),
        )
        .optional()?;
    let source = source.ok_or_else(|| anyhow!("NOT_FOUND"))?;
    if source != "desktop" {
        return Err(anyhow!("SESSION_ACTIVITY_UNSUPPORTED"));
    }
    // A new turn must not make an unresolved receipt from an older turn live again.
    // Unindexed/legacy NULL attribution is deliberately not assumed to own that turn.
    let mut query = db.conn().prepare_cached(
        "SELECT m.id FROM messages m JOIN turns t ON t.id=m.turn_id AND t.session_id=m.session_id
         WHERE m.session_id=?1 AND t.status='running'",
    )?;
    let live_receipts: HashSet<String> = query
        .query_map([session_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let records =
        sessions::dedupe_records(transcripts::read_transcript(db.data_dir(), session_id)?);
    let messages: Vec<_> = records.into_iter().map(sessions::record_to_ui).collect();
    let mut summary = aggregate(&messages, &live_receipts);
    let revision = hex::encode(Sha256::digest(serde_json::to_vec(&summary)?));
    let mut totals = json!({});
    let mut has_more = false;
    for key in ["subagents", "changedFiles", "websites", "attachments"] {
        let items = summary[key]
            .as_array_mut()
            .ok_or_else(|| anyhow!("invalid activity summary"))?;
        totals[key] = json!(items.len());
        has_more |= items.len() > offset.saturating_add(limit);
        *items = items.iter().skip(offset).take(limit).cloned().collect();
    }
    for key in ["skills", "memory", "mcp"] {
        let items = summary["references"][key]
            .as_array_mut()
            .ok_or_else(|| anyhow!("invalid activity references"))?;
        totals[key] = json!(items.len());
        has_more |= items.len() > offset.saturating_add(limit);
        *items = items.iter().skip(offset).take(limit).cloned().collect();
    }
    summary["sessionId"] = json!(session_id);
    summary["version"] = json!(1);
    summary["revision"] = json!(revision);
    summary["totals"] = totals;
    summary["hasMore"] = json!(has_more);
    summary["nextOffset"] = if has_more {
        json!(offset + limit)
    } else {
        Value::Null
    };
    Ok(summary)
}
use rusqlite::OptionalExtension;

fn aggregate(messages: &[sessions::UiMessage], live_receipts: &HashSet<String>) -> Value {
    let mut files: BTreeMap<String, Value> = BTreeMap::new();
    let mut websites: BTreeMap<String, Value> = BTreeMap::new();
    let mut attachments: BTreeMap<String, Value> = BTreeMap::new();
    let mut skills: BTreeMap<String, Value> = BTreeMap::new();
    let mut mcp: BTreeMap<String, Value> = BTreeMap::new();
    let mut delegates: BTreeMap<String, Value> = BTreeMap::new();
    let mut lifecycle: BTreeMap<String, Value> = BTreeMap::new();
    let mut limited = false;
    for message in messages {
        for attachment in message.attachments.iter().flatten() {
            if attachment.kind == "session" {
                continue;
            }
            if !literal(&attachment.reference) {
                limited = true;
                continue;
            }
            attachments.insert(
                attachment.reference.clone(),
                resource(
                    &attachment.reference,
                    if attachment.name.is_empty() {
                        &attachment.reference
                    } else {
                        &attachment.name
                    },
                    Some(&attachment.reference),
                    Some(&message.id),
                ),
            );
        }
        for mention in message.skill_mentions.iter().flatten() {
            if literal(&mention.id) {
                skills.insert(
                    mention.id.clone(),
                    resource(&mention.id, &mention.id, None, None),
                );
            }
        }
        for round in message
            .hosted_search
            .as_ref()
            .and_then(|v| v.get("rounds"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            for source in round
                .get("sources")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let raw = text(source.get("url"));
                if !literal(raw) {
                    limited = true;
                    continue;
                }
                let Ok(url) = reqwest::Url::parse(raw) else {
                    continue;
                };
                if !["http", "https"].contains(&url.scheme())
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    continue;
                }
                let Some(domain) = url.host_str().filter(|d| !d.is_empty()) else {
                    continue;
                };
                let item = websites.entry(domain.to_owned()).or_insert_with(|| json!({"id": url.as_str(), "url": url.as_str(), "domain": domain, "label": label(source.get("title").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(domain)), "sourceCount": 0}));
                item["sourceCount"] = json!(item["sourceCount"].as_u64().unwrap_or(0) + 1);
            }
        }
        if message.role != "tool" {
            continue;
        }
        let tool = message.tool_name.as_deref().unwrap_or("");
        let bare = bare_tool(tool);
        let details = payload(message);
        if ["task", "subagent"].contains(&bare.as_str()) {
            let id = details
                .get("delegationId")
                .and_then(Value::as_str)
                .filter(|id| literal(id))
                .or(message.tool_call_id.as_deref())
                .unwrap_or(&message.id);
            if !literal(id) {
                limited = true;
                continue;
            }
            let status = outcome(text(details.get("status"))).unwrap_or(
                match message.tool_status.as_deref() {
                    Some("running") => "running",
                    Some("error") => "failed",
                    Some("denied") => "denied",
                    _ => "completed",
                },
            );
            let args = message.tool_args.as_ref();
            let mut item = json!({"delegationId": id, "messageId": message.id, "toolCallId": message.tool_call_id, "agentName": label(text(args.and_then(|v| v.get("agent")))), "task": label(text(args.and_then(|v| v.get("task"))).trim()), "status": status});
            timing(&mut item, details);
            delegates.entry(id.to_owned()).or_insert(item);
        } else {
            for (key, stopped) in [("delegations", false), ("stopped", true)] {
                for entry in details
                    .get(key)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let id = text(entry.get("delegationId"));
                    if !literal(id) {
                        continue;
                    }
                    let status = outcome(text(entry.get("status")));
                    let status = if stopped && (status.is_none() || status == Some("running")) {
                        Some("stopped")
                    } else {
                        status
                    };
                    if let Some(status) = status {
                        let mut item = lifecycle.remove(id).unwrap_or_else(|| json!({}));
                        item["status"] = json!(status);
                        timing(&mut item, entry);
                        lifecycle.insert(id.to_owned(), item);
                    }
                }
            }
        }
        if message.tool_status.as_deref() != Some("success") || message.is_error == Some(true) {
            continue;
        }
        if ["Write", "Edit", "write", "edit"].contains(&tool) {
            let args = message.tool_args.as_ref();
            let path = ["path", "file_path", "filePath"].iter().find_map(|key| {
                args.and_then(|v| v.get(key))
                    .and_then(Value::as_str)
                    .filter(|p| !p.trim().is_empty())
            });
            let Some(path) = path else {
                continue;
            };
            if !literal(path) {
                limited = true;
                continue;
            }
            let counts = line_counts(message, path);
            let time = [
                message.tool_completed_at.as_deref(),
                Some(message.created_at.as_str()),
            ]
            .into_iter()
            .flatten()
            .find(|t| timestamp(t).is_some());
            let first = !files.contains_key(path);
            let item = files.entry(path.to_owned()).or_insert_with(|| {
                let mut item = resource(path, path, Some(path), Some(&message.id));
                item["changeCount"] = json!(0);
                let bytes = path.as_bytes();
                let windows = bytes.first().is_some_and(u8::is_ascii_alphabetic)
                    && bytes.get(1) == Some(&b':')
                    && matches!(bytes.get(2), Some(b'/' | b'\\'))
                    || path.starts_with("\\\\");
                let sep = if windows {
                    path.rfind(['/', '\\'])
                } else {
                    path.rfind('/')
                };
                if let Some(sep) = sep {
                    item["groupLabel"] = json!(if sep == 0 { "/" } else { &path[..sep] });
                }
                item
            });
            item["changeCount"] = json!(item["changeCount"].as_u64().unwrap_or(0) + 1);
            if item.get("lastChangedAt").is_none()
                || time.and_then(timestamp)
                    >= item
                        .get("lastChangedAt")
                        .and_then(Value::as_str)
                        .and_then(timestamp)
            {
                item["messageId"] = json!(message.id);
                if let Some(time) = time {
                    item["lastChangedAt"] = json!(time);
                }
            }
            match counts {
                Some((added, removed)) if first => {
                    item["addedLines"] = json!(added);
                    item["removedLines"] = json!(removed);
                }
                Some((added, removed)) if item.get("addedLines").is_some() => {
                    let a = item["addedLines"]
                        .as_u64()
                        .unwrap_or(0)
                        .saturating_add(added);
                    let d = item["removedLines"]
                        .as_u64()
                        .unwrap_or(0)
                        .saturating_add(removed);
                    if a <= MAX_SAFE_INTEGER && d <= MAX_SAFE_INTEGER {
                        item["addedLines"] = json!(a);
                        item["removedLines"] = json!(d);
                    } else {
                        if let Some(i) = item.as_object_mut() {
                            i.remove("addedLines");
                            i.remove("removedLines");
                        }
                    }
                }
                _ => {
                    if let Some(i) = item.as_object_mut() {
                        i.remove("addedLines");
                        i.remove("removedLines");
                    }
                }
            }
        }
        if tool == "Skill" {
            let id = text(message.tool_args.as_ref().and_then(|v| v.get("id")));
            if literal(id) {
                skills.insert(id.to_owned(), resource(id, id, None, None));
            }
        }
        if tool.starts_with("mcp_") && literal(tool) {
            mcp.insert(tool.to_owned(), resource(tool, tool, None, None));
        }
    }
    for (id, item) in &mut delegates {
        if let Some(state) = lifecycle.get(id) {
            // A terminal Task receipt owns its known status and timing. Lifecycle
            // records can fill gaps but cannot erase its completedAt with an older poll.
            let receipt_running = item["status"] == "running";
            if receipt_running {
                item["status"] = state["status"].clone();
            }
            if let Some(t) = state.get("timing") {
                for key in ["startedAt", "completedAt"] {
                    if let Some(value) = t.get(key) {
                        if receipt_running
                            || item
                                .get("timing")
                                .and_then(|timing| timing.get(key))
                                .is_none()
                        {
                            if item.get("timing").is_none() {
                                item["timing"] = json!({});
                            }
                            item["timing"][key] = value.clone();
                        }
                    }
                }
            }
        }
        if !live_receipts.contains(text(item.get("messageId"))) && item["status"] == "running" {
            item["status"] = json!("aborted");
        }
    }
    json!({"limited": limited, "subagents": delegates.into_values().collect::<Vec<_>>(), "changedFiles": files.into_values().collect::<Vec<_>>(), "websites": websites.into_values().collect::<Vec<_>>(), "attachments": attachments.into_values().collect::<Vec<_>>(), "references": {"skills": skills.into_values().collect::<Vec<_>>(), "memory": [], "mcp": mcp.into_values().collect::<Vec<_>>()}})
}
fn timing(item: &mut Value, source: &Value) {
    for key in ["startedAt", "completedAt"] {
        if let Some(t) = source
            .get(key)
            .and_then(Value::as_u64)
            .filter(|t| *t <= MAX_SAFE_INTEGER)
        {
            if item.get("timing").is_none() {
                item["timing"] = json!({});
            }
            item["timing"][key] = json!(t);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn append(db: &Database, id: &str, value: Value) {
        let message: sessions::UiMessage = serde_json::from_value(value).unwrap();
        sessions::append_message(db, id, &message, None).unwrap();
    }
    fn replace(db: &Database, id: &str, value: Value) {
        let updated: sessions::UiMessage = serde_json::from_value(value).unwrap();
        let mut messages: Vec<_> =
            sessions::dedupe_records(transcripts::read_transcript(db.data_dir(), id).unwrap())
                .into_iter()
                .map(sessions::record_to_ui)
                .collect();
        let item = messages.iter_mut().find(|m| m.id == updated.id).unwrap();
        *item = updated;
        sessions::replace_messages(db, id, &messages).unwrap();
    }
    fn write(id: &str, path: &str, additions: u64) -> Value {
        json!({"id": id, "role": "tool", "content": "PRIVATE TOOL OUTPUT", "createdAt": "2026-10-10T00:00:00Z", "toolName": "Write", "toolStatus": "success", "toolArgs": {"path": path, "content": "PRIVATE FILE BODY"}, "toolResult": {"details": {"root": "workspace", "review": {"version": 1, "snapshotId": "snap", "messageId": id, "path": path, "operation": "write", "status": "modified", "state": "active", "additions": additions, "deletions": 1}}}})
    }
    #[test]
    fn full_session_history_counts_updates_pages_and_reopen_without_bodies() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        append(&db, &id, write("old", "/old/first.txt", 2));
        for n in 0..125 {
            append(
                &db,
                &id,
                json!({"id": format!("text-{n}"), "role": "assistant", "content": "PRIVATE PROSE", "createdAt": "2026-10-10T00:00:00Z"}),
            );
        }
        append(&db, &id, write("later", "/old/first.txt", 3));
        for n in 0..60 {
            append(
                &db,
                &id,
                write(&format!("file-{n}"), &format!("/new/{n}.txt"), 1),
            );
        }
        append(
            &db,
            &id,
            json!({"id": "search", "role": "assistant", "content": "PRIVATE SEARCH BODY", "createdAt": "2026-10-10T00:00:00Z", "hostedSearch": {"rounds": [{"sources": [{"url": "https://example.com/a", "title": "Example"}, {"url": "https://example.com/b"}, {"url": "javascript:alert(1)"}, {"url": "https://user:pass@bad.test"}]}]}}),
        );
        let first = get(&db, &id, 0, 50).unwrap();
        assert_eq!(first["totals"]["changedFiles"], 61);
        assert_eq!(first["changedFiles"].as_array().unwrap().len(), 50);
        assert_eq!(first["hasMore"], true);
        let next = get(&db, &id, 50, 50).unwrap();
        assert_eq!(next["revision"], first["revision"]);
        assert_eq!(next["hasMore"], false);
        let old = next["changedFiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["path"] == "/old/first.txt")
            .unwrap();
        assert_eq!(old["changeCount"], 2);
        assert_eq!(old["addedLines"], 5);
        assert_eq!(old["messageId"], "later");
        assert_eq!(first["websites"][0]["domain"], "example.com");
        assert_eq!(first["websites"][0]["sourceCount"], 2);
        let wire = serde_json::to_string(&first).unwrap();
        assert!(!wire.contains("PRIVATE"));
        // The canonical replacement path updates an existing row without counting a replay twice.
        replace(&db, &id, write("later", "/old/first.txt", 7));
        let changed = get(&db, &id, 50, 50).unwrap();
        assert_ne!(changed["revision"], first["revision"]);
        assert_eq!(
            changed["changedFiles"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["path"] == "/old/first.txt")
                .unwrap()["addedLines"],
            9
        );
        drop(db);
        let reopened = Database::open_in_dir(dir.path()).unwrap();
        assert_eq!(get(&reopened, &id, 50, 50).unwrap(), changed);
    }
    #[test]
    fn exact_paths_unknown_metrics_delegation_lifecycle_and_identity() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let other = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let turn = sessions::begin_turn(&db, &id, None, None).unwrap();
        append(&db, &id, write("known", "/unix/a\\b.txt", 2));
        let mut unknown = write("unknown", "/unix/a\\b.txt", 2);
        unknown["toolResult"]["details"]["review"]["truncated"] = json!(true);
        append(&db, &id, unknown);
        let task = json!({"id": "task", "role": "tool", "content": "", "createdAt": "2026-10-10T00:00:00Z", "toolName": "Task", "toolCallId": "call", "toolStatus": "success", "toolArgs": {"agent": "worker", "task": "Do work"}, "toolResult": {"details": {"delegationId": "delegate", "status": "running", "startedAt": 10}}});
        append(&db, &id, task.clone());
        append(
            &db,
            &id,
            json!({"id": "wait", "role": "tool", "content": "", "createdAt": "2026-10-10T00:00:00Z", "toolName": "TaskWait", "toolStatus": "success", "toolResult": {"details": {"delegations": [{"delegationId": "delegate", "status": "failed", "startedAt": 10, "completedAt": 20}]}}}),
        );
        let current = get(&db, &id, 0, 50).unwrap();
        assert_eq!(current["changedFiles"][0]["path"], "/unix/a\\b.txt");
        assert_eq!(current["changedFiles"][0]["groupLabel"], "/unix");
        assert!(current["changedFiles"][0].get("addedLines").is_none());
        assert_eq!(current["subagents"][0]["status"], "failed");
        assert_eq!(current["subagents"][0]["timing"]["completedAt"], 20);
        let mut settled = task;
        settled["toolResult"]["details"]["status"] = json!("completed");
        replace(&db, &id, settled);
        let settled_summary = get(&db, &id, 0, 50).unwrap();
        assert_eq!(settled_summary["subagents"][0]["status"], "completed");
        // The refreshed receipt has no completion time, so lifecycle fills that gap.
        assert_eq!(settled_summary["subagents"][0]["timing"]["completedAt"], 20);
        assert!(get(&db, &other, 0, 50).unwrap()["subagents"]
            .as_array()
            .unwrap()
            .is_empty());
        sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
        for bad in ["", "../escape", "remote:abc", "native-pi:abc", "missing"] {
            assert!(get(&db, bad, 0, 50).is_err());
        }
        db.conn()
            .execute("UPDATE sessions SET deleted_at=1 WHERE id=?1", [&id])
            .unwrap();
        assert_eq!(get(&db, &id, 0, 50).unwrap_err().to_string(), "NOT_FOUND");
    }
    #[test]
    fn later_turn_does_not_revive_old_or_unattributed_delegation_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let turn_a = sessions::begin_turn(&db, &id, None, None).unwrap();
        let task: sessions::UiMessage = serde_json::from_value(json!({"id": "old-task", "role": "tool", "content": "", "createdAt": "2026-10-10T00:00:00Z", "toolName": "Task", "toolCallId": "old-call", "toolStatus": "success", "toolResult": {"details": {"delegationId": "old-delegate", "status": "running"}}})).unwrap();
        sessions::append_message(&db, &id, &task, Some(&turn_a)).unwrap();
        sessions::end_turn(&db, &turn_a, "error", Some("TEST_ERROR"), None, false).unwrap();
        assert_eq!(
            get(&db, &id, 0, 50).unwrap()["subagents"][0]["status"],
            "aborted"
        );
        let turn_b = sessions::begin_turn(&db, &id, None, None).unwrap();
        assert_eq!(
            get(&db, &id, 0, 50).unwrap()["subagents"][0]["status"],
            "aborted"
        );
        let mut live = task.clone();
        live.id = "live-task".into();
        live.tool_call_id = Some("live-call".into());
        live.tool_result.as_mut().unwrap()["details"]["delegationId"] = json!("live-delegate");
        sessions::append_message(&db, &id, &live, Some(&turn_b)).unwrap();
        let mut unknown = task;
        unknown.id = "unknown-task".into();
        unknown.tool_call_id = Some("unknown-call".into());
        unknown.tool_result.as_mut().unwrap()["details"]["delegationId"] =
            json!("unknown-delegate");
        sessions::append_message(&db, &id, &unknown, None).unwrap();
        let summary = get(&db, &id, 0, 50).unwrap();
        let delegates = summary["subagents"].as_array().unwrap();
        assert_eq!(
            delegates
                .iter()
                .find(|d| d["delegationId"] == "live-delegate")
                .unwrap()["status"],
            "running"
        );
        assert_eq!(
            delegates
                .iter()
                .find(|d| d["delegationId"] == "unknown-delegate")
                .unwrap()["status"],
            "aborted"
        );
    }
    #[test]
    fn terminal_receipt_keeps_completion_time_over_older_running_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let turn = sessions::begin_turn(&db, &id, None, None).unwrap();
        let running: sessions::UiMessage = serde_json::from_value(json!({"id": "task", "role": "tool", "content": "", "createdAt": "2026-10-10T00:00:00Z", "toolName": "Task", "toolCallId": "task", "toolStatus": "success", "toolResult": {"details": {"delegationId": "delegate", "status": "running", "startedAt": 10}}})).unwrap();
        sessions::append_message(&db, &id, &running, Some(&turn)).unwrap();
        let list: sessions::UiMessage = serde_json::from_value(json!({"id": "list", "role": "tool", "content": "", "createdAt": "2026-10-10T00:00:00Z", "toolName": "TaskList", "toolStatus": "success", "toolResult": {"details": {"delegations": [{"delegationId": "delegate", "status": "running", "startedAt": 10}]}}})).unwrap();
        sessions::append_message(&db, &id, &list, Some(&turn)).unwrap();
        let mut completed = running;
        completed.tool_result.as_mut().unwrap()["details"]["status"] = json!("completed");
        completed.tool_result.as_mut().unwrap()["details"]["completedAt"] = json!(20);
        sessions::append_message(&db, &id, &completed, Some(&turn)).unwrap();
        let summary = get(&db, &id, 0, 50).unwrap();
        assert_eq!(summary["subagents"][0]["status"], "completed");
        assert_eq!(
            summary["subagents"][0]["timing"],
            json!({"startedAt": 10, "completedAt": 20})
        );
    }
}
