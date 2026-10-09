//! Bounded, session-owned model-input diagnostics in the existing kv boundary.
use crate::db::{now_ms, Database};
use anyhow::{anyhow, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const NAMESPACE: &str = "context-insights-v1";
const MAX_REQUESTS: usize = 40;
const MAX_EVENTS: usize = 160;
const MAX_CONTENT: usize = 120_000;
const MAX_TOTAL_CONTENT: usize = 1_200_000;
const MAX_PAYLOAD_BYTES: usize = 800_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Image {
    mime_type: String,
    encoded_bytes: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    id: String,
    category: String,
    label: String,
    content: String,
    estimated_tokens: u64,
    original_chars: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    historical: Option<bool>,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_omitted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<Image>>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderPayload {
    content: String,
    original_chars: u64,
    truncated: bool,
    redacted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_omitted: Option<bool>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    step: u64,
    started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    status: String,
    provider_id: String,
    model_id: String,
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    purpose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_call_id: Option<String>,
    context_window: u64,
    estimated_tokens: u64,
    estimate_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    capture_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_payload: Option<ProviderPayload>,
    entries: Vec<Entry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<Value>,
    content_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    omitted_entries: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_bytes: Option<u64>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Event {
    id: String,
    at: u64,
    r#type: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens_before: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens_after: Option<u64>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Retention {
    max_requests: usize,
    max_events: usize,
    max_content_chars: usize,
    max_total_content_chars: usize,
    dropped_requests: usize,
    dropped_events: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    version: u8,
    session_id: String,
    requests: Vec<Request>,
    events: Vec<Event>,
    retention: Retention,
    updated_at: i64,
}
fn empty(session_id: &str) -> Snapshot {
    Snapshot {
        version: 1,
        session_id: session_id.into(),
        requests: vec![],
        events: vec![],
        retention: Retention {
            max_requests: MAX_REQUESTS,
            max_events: MAX_EVENTS,
            max_content_chars: MAX_CONTENT,
            max_total_content_chars: MAX_TOTAL_CONTENT,
            dropped_requests: 0,
            dropped_events: 0,
        },
        updated_at: 0,
    }
}
fn exists(db: &Database, session_id: &str) -> Result<bool> {
    Ok(db
        .conn()
        .query_row(
            "SELECT 1 FROM sessions WHERE id=?1 AND deleted_at IS NULL",
            [session_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}
fn load(db: &Database, session_id: &str) -> Result<Snapshot> {
    db.kv_get(NAMESPACE, session_id)?
        .map(serde_json::from_value)
        .transpose()
        .map(|v| v.unwrap_or_else(|| empty(session_id)))
        .map_err(Into::into)
}
fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256
}
fn content_size(request: &Request) -> usize {
    request
        .entries
        .iter()
        .map(|e| e.content.encode_utf16().count())
        .sum::<usize>()
        + request
            .provider_payload
            .as_ref()
            .map_or(0, |p| p.content.encode_utf16().count())
}
fn validate_request(r: &Request) -> Result<()> {
    if !valid_id(&r.id)
        || !valid_id(&r.provider_id)
        || !valid_id(&r.model_id)
        || r.turn_id.as_ref().is_some_and(|id| !valid_id(id))
        || r.entries.len() > 2048
        || !matches!(
            r.status.as_str(),
            "running" | "completed" | "error" | "aborted"
        )
        || !matches!(r.mode.as_str(), "agent" | "plan" | "goal")
        || r.purpose
            .as_ref()
            .is_some_and(|purpose| !matches!(purpose.as_str(), "agent" | "compaction" | "subagent"))
        || r.agent_name.as_ref().is_some_and(|name| name.len() > 256)
        || r.parent_tool_call_id
            .as_ref()
            .is_some_and(|id| !valid_id(id))
        || r.capture_source
            .as_ref()
            .is_some_and(|source| !matches!(source.as_str(), "pi-context" | "provider-payload"))
        || r.provider_payload.as_ref().is_some_and(|p| {
            p.content_omitted == Some(true)
                || p.original_chars < p.content.encode_utf16().count() as u64
        })
        || r.estimate_source != "runtime-usage-anchor"
        || content_size(r) > MAX_CONTENT
    {
        return Err(anyhow!("INVALID_ARGUMENT: invalid context request"));
    }
    for entry in &r.entries {
        if !valid_id(&entry.id)
            || entry.label.len() > 512
            || entry.original_chars < entry.content.encode_utf16().count() as u64
            || entry.content_omitted == Some(true)
            || !matches!(
                entry.category.as_str(),
                "system" | "tools" | "user" | "injected" | "skill" | "assistant" | "toolResult"
            )
            || entry
                .kind
                .as_ref()
                .is_some_and(|kind| !matches!(kind.as_str(), "thinking" | "answer" | "toolCall"))
            || entry.images.as_ref().is_some_and(|images| {
                images.len() > 256 || images.iter().any(|image| image.mime_type.len() > 128)
            })
        {
            return Err(anyhow!("INVALID_ARGUMENT: invalid context entry"));
        }
    }
    Ok(())
}
fn validate_event(e: &Event) -> Result<()> {
    if !valid_id(&e.id)
        || e.label.len() > 1024
        || !matches!(
            e.r#type.as_str(),
            "compaction" | "prune" | "model" | "mode" | "injection"
        )
    {
        return Err(anyhow!("INVALID_ARGUMENT: invalid context event"));
    }
    Ok(())
}
fn add_event(snapshot: &mut Snapshot, event: Event) {
    if !snapshot.events.iter().any(|e| e.id == event.id) {
        snapshot.events.push(event);
    }
}
fn transition_event(request: &Request, kind: &str, label: String) -> Event {
    Event {
        id: format!("{}:{kind}", request.id),
        at: request.started_at,
        r#type: kind.into(),
        label,
        turn_id: request.turn_id.clone(),
        request_id: Some(request.id.clone()),
        tokens_before: None,
        tokens_after: None,
    }
}
/// Atomic upsert; late observations cannot recreate deleted sessions or regress a settled request.
pub fn record(
    db: &Database,
    session_id: &str,
    request: Option<&Value>,
    event: Option<&Value>,
) -> Result<bool> {
    if !valid_id(session_id) {
        return Err(anyhow!("INVALID_ARGUMENT: sessionId required"));
    }
    let payload = json!({"request": request, "event": event});
    if serde_json::to_vec(&payload)?.len() > MAX_PAYLOAD_BYTES {
        return Err(anyhow!(
            "LIMIT_EXCEEDED: context diagnostic payload too large"
        ));
    }
    let request: Option<Request> = request
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| anyhow!("INVALID_ARGUMENT: malformed context request"))?;
    let event: Option<Event> = event
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| anyhow!("INVALID_ARGUMENT: malformed context event"))?;
    if request.is_none() && event.is_none() {
        return Err(anyhow!("INVALID_ARGUMENT: context diagnostic required"));
    }
    if let Some(r) = &request {
        validate_request(r)?;
    }
    if let Some(e) = &event {
        validate_event(e)?;
    }
    let tx = db.conn().unchecked_transaction()?;
    if !exists(db, session_id)? {
        return Ok(false);
    }
    let mut snapshot = load(db, session_id)?;
    if let Some(mut request) = request {
        if let Some(previous) = snapshot.requests.iter().find(|r| r.id == request.id) {
            if (previous.status != "running" && request.status == "running")
                || previous.content_revision.unwrap_or(0) > request.content_revision.unwrap_or(0)
            {
                return Ok(true);
            }
            // Host assigns a durable per-session step; process reload never restarts numbering.
            request.step = previous.step;
            snapshot.requests.retain(|r| r.id != request.id);
        } else {
            request.step = snapshot
                .requests
                .last()
                .map_or(snapshot.retention.dropped_requests as u64 + 1, |r| {
                    r.step + 1
                });
            if let Some(previous) = snapshot.requests.iter().rev().find(|p| {
                p.purpose == request.purpose && p.parent_tool_call_id == request.parent_tool_call_id
            }) {
                let model = (previous.provider_id.clone(), previous.model_id.clone());
                let mode = previous.mode.clone();
                if model != (request.provider_id.clone(), request.model_id.clone()) {
                    add_event(
                        &mut snapshot,
                        transition_event(
                            &request,
                            "model",
                            format!(
                                "{}/{} → {}/{}",
                                model.0, model.1, request.provider_id, request.model_id
                            ),
                        ),
                    );
                }
                if mode != request.mode {
                    add_event(
                        &mut snapshot,
                        transition_event(&request, "mode", format!("{} → {}", mode, request.mode)),
                    );
                }
            }
            for entry in &request.entries {
                if matches!(entry.category.as_str(), "injected" | "skill") {
                    let seen = snapshot
                        .requests
                        .iter()
                        .rev()
                        .find(|p| {
                            p.purpose == request.purpose
                                && p.parent_tool_call_id == request.parent_tool_call_id
                        })
                        .is_some_and(|p| {
                            p.entries.iter().any(|e| {
                                e.category == entry.category
                                    && e.label == entry.label
                                    && e.content == entry.content
                            })
                        });
                    if !seen {
                        let mut event =
                            transition_event(&request, "injection", entry.label.clone());
                        event.id = format!("{}:{}", request.id, entry.id);
                        add_event(&mut snapshot, event);
                    }
                }
            }
        }
        snapshot.requests.push(request);
        snapshot.requests.sort_by_key(|r| r.step);
    }
    if let Some(event) = event {
        add_event(&mut snapshot, event);
    }
    while snapshot.requests.len() > MAX_REQUESTS
        || snapshot.requests.iter().map(content_size).sum::<usize>() > MAX_TOTAL_CONTENT
    {
        snapshot.requests.remove(0);
        snapshot.retention.dropped_requests += 1;
    }
    if snapshot.events.len() > MAX_EVENTS {
        let count = snapshot.events.len() - MAX_EVENTS;
        snapshot.events.drain(..count);
        snapshot.retention.dropped_events += count;
    }
    snapshot.updated_at = now_ms();
    db.kv_set(NAMESPACE, session_id, &serde_json::to_value(snapshot)?)?;
    tx.commit()?;
    Ok(true)
}
/// Metadata-only reads omit content explicitly; full reads may select one physical request.
pub fn get(
    db: &Database,
    session_id: &str,
    include_content: bool,
    request_id: Option<&str>,
) -> Result<Value> {
    if !valid_id(session_id) || request_id.is_some_and(|id| !valid_id(id)) {
        return Err(anyhow!("INVALID_ARGUMENT: invalid diagnostic identity"));
    }
    if !exists(db, session_id)? {
        return Err(anyhow!("NOT_FOUND: session not found"));
    }
    let mut snapshot = load(db, session_id)?;
    if let Some(request_id) = request_id {
        snapshot.requests.retain(|r| r.id == request_id);
    }
    if !include_content {
        for request in &mut snapshot.requests {
            if let Some(payload) = &mut request.provider_payload {
                payload.content.clear();
                payload.content_omitted = Some(true);
            }
            for entry in &mut request.entries {
                entry.content.clear();
                entry.content_omitted = Some(true);
            }
        }
    }
    Ok(serde_json::to_value(snapshot)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;
    fn request(id: &str, content: &str) -> Value {
        json!({"id": id, "step": 1, "startedAt": 1, "status": "running", "providerId": "provider",
          "modelId": "model", "mode": "agent", "contextWindow": 100000, "estimatedTokens": 9,
          "estimateSource": "runtime-usage-anchor", "contentTruncated": false,
          "entries": [{"id": format!("{id}:0"), "category": "user", "label": "user", "content": content,
            "estimatedTokens": 9, "originalChars": content.encode_utf16().count(), "truncated": false}]})
    }
    #[test]
    fn persists_across_reload_with_metadata_reads_and_settlement_idempotence() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let session = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let running = request("r1", "exact context");
        assert!(record(&db, &session, Some(&running), None).unwrap());
        let mut done = running.clone();
        done["status"] = json!("completed");
        done["durationMs"] = json!(25);
        record(&db, &session, Some(&done), None).unwrap();
        record(&db, &session, Some(&running), None).unwrap();
        drop(db);
        let db = Database::open_in_dir(dir.path()).unwrap();
        let full = get(&db, &session, true, Some("r1")).unwrap();
        assert_eq!(full["requests"][0]["status"], "completed");
        assert_eq!(
            full["requests"][0]["entries"][0]["content"],
            "exact context"
        );
        let meta = get(&db, &session, false, None).unwrap();
        assert_eq!(meta["requests"][0]["entries"][0]["content"], "");
        assert_eq!(meta["requests"][0]["entries"][0]["contentOmitted"], true);
        assert_eq!(meta["requests"].as_array().unwrap().len(), 1);
        record(&db, &session, Some(&request("r2", "second")), None).unwrap();
        assert_eq!(
            get(&db, &session, true, None).unwrap()["requests"][1]["step"],
            2
        );
    }
    #[test]
    fn bounds_retention_and_refuses_invalid_input_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let session = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        for index in 0..45 {
            record(
                &db,
                &session,
                Some(&request(&format!("r{index}"), "small")),
                None,
            )
            .unwrap();
        }
        let snapshot = get(&db, &session, true, None).unwrap();
        assert_eq!(snapshot["requests"].as_array().unwrap().len(), 40);
        assert_eq!(snapshot["retention"]["droppedRequests"], 5);
        assert!(record(
            &db,
            &session,
            Some(&request("oversized", &"x".repeat(120001))),
            None
        )
        .is_err());
        let mut bad = request("bad", "x");
        bad["headers"] = json!({"Authorization": "must not persist"});
        assert!(record(&db, &session, Some(&bad), None).is_err());
        assert_eq!(
            get(&db, &session, true, None).unwrap()["retention"]["droppedRequests"],
            5
        );
    }
    #[test]
    fn deleted_session_cannot_be_read_or_resurrected_by_a_late_result() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let session = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        let payload = request("r1", "context");
        record(&db, &session, Some(&payload), None).unwrap();
        sessions::delete_session(&db, &session).unwrap();
        assert!(db.kv_get(NAMESPACE, &session).unwrap().is_none());
        assert!(!record(&db, &session, Some(&payload), None).unwrap());
        assert!(get(&db, &session, true, None).is_err());
        assert!(db.kv_get(NAMESPACE, &session).unwrap().is_none());
    }
    #[test]
    fn total_content_bound_keeps_newest_whole_requests() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let session = sessions::create_session(&db, None, None, None, None, None)
            .unwrap()
            .id;
        for index in 0..11 {
            record(
                &db,
                &session,
                Some(&request(&format!("r{index}"), &"x".repeat(120000))),
                None,
            )
            .unwrap();
        }
        let snapshot = get(&db, &session, false, None).unwrap();
        assert_eq!(snapshot["requests"].as_array().unwrap().len(), 10);
        assert_eq!(snapshot["requests"][0]["id"], "r1");
        assert_eq!(snapshot["retention"]["droppedRequests"], 1);
    }
}
