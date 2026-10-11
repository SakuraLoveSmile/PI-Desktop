//! Durable unanswered Lead questions. These records never grant authority.
use anyhow::{anyhow, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    db::{now_ms, Database},
    sessions, turn_queue,
};

pub const NS: &str = "team-lead-ask-v1";
pub const WAIT_MS: i64 = 30 * 60 * 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskRequest {
    pub request_id: String,
    pub session_id: String,
    pub tool_call_id: String,
    pub questions: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_pending: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team_managed: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadAsk {
    pub request: AskRequest,
    pub turn_id: String,
    pub created_at: i64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<Option<Vec<String>>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_id: Option<String>,
}

fn key(session: &str, id: &str) -> String {
    format!("{session}:{id}")
}

fn load(db: &Database, session: &str, id: &str) -> Result<LeadAsk> {
    db.kv_get(NS, &key(session, id))?.map(serde_json::from_value).transpose()?
        .ok_or_else(|| anyhow!("ASKTOOL_NOT_FOUND: question is not pending; nextStep: open the current question card"))
}

fn save(db: &Database, ask: &LeadAsk) -> Result<()> {
    db.kv_set(
        NS,
        &key(&ask.request.session_id, &ask.request.request_id),
        &serde_json::to_value(ask)?,
    )
}

fn running(db: &Database, session: &str, turn: &str) -> Result<bool> {
    Ok(db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM turns WHERE id=?1 AND session_id=?2 AND status='running')",
        params![turn, session],
        |r| r.get(0),
    )?)
}

fn current(db: &Database, session: &str, turn: &str) -> Result<()> {
    super::validate_team_lead(db, session)?;
    if db
        .kv_get("team-lead-ask-cancel-v1", session)?
        .and_then(|v| v.as_str().map(str::to_owned))
        .as_deref()
        == Some(turn)
    {
        return Err(anyhow!(
            "TEAM_TURN_INVALID: Lead question wait was cancelled"
        ));
    }
    if !running(db, session, turn)? {
        return Err(anyhow!(
            "TEAM_TURN_INVALID: question must belong to the running Lead turn"
        ));
    }
    Ok(())
}

fn validate_questions(questions: &[Value]) -> Result<()> {
    if questions.is_empty() || questions.len() > 20 {
        return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: invalid question count"));
    }
    for q in questions {
        if q.get("question")
            .and_then(Value::as_str)
            .is_none_or(|v| v.trim().is_empty() || v.len() > 16384)
            || q.get("options")
                .and_then(Value::as_array)
                .is_none_or(|v| v.is_empty() || v.len() > 100)
            || q.get("multiSelect").is_some_and(|v| !v.is_boolean())
        {
            return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: malformed question"));
        }
        for option in q["options"].as_array().into_iter().flatten() {
            let label = option
                .as_str()
                .or_else(|| option.get("label").and_then(Value::as_str));
            if label.is_none_or(|v| v.trim().is_empty() || v.len() > 16384) {
                return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: malformed option"));
            }
        }
    }
    if serde_json::to_vec(questions)?.len() > 65536 {
        return Err(anyhow!(
            "ASKTOOL_INVALID_ARGUMENT: question payload exceeds limit"
        ));
    }
    Ok(())
}

pub fn register(db: &Database, request: AskRequest, turn: &str) -> Result<LeadAsk> {
    current(db, &request.session_id, turn)?;
    if request.request_id.is_empty()
        || request.request_id.len() > 128
        || request.tool_call_id.is_empty()
        || request.tool_call_id.len() > 128
        || request.team_pending.is_some()
        || request.team_managed.is_some()
    {
        return Err(anyhow!(
            "ASKTOOL_INVALID_ARGUMENT: invalid question identity"
        ));
    }
    validate_questions(&request.questions)?;
    if db
        .kv_get(NS, &key(&request.session_id, &request.request_id))?
        .is_some()
    {
        let existing = load(db, &request.session_id, &request.request_id)?;
        if existing.turn_id != turn
            || serde_json::to_value(&existing.request)? != serde_json::to_value(&request)?
        {
            return Err(anyhow!(
                "IDEMPOTENCY_CONFLICT: question identity was reused"
            ));
        }
        return Ok(existing);
    }
    let pending = list(db, &request.session_id)?;
    if pending.len() >= 8 {
        return Err(anyhow!(
            "ASKTOOL_QUEUE_FULL: nextStep: answer or cancel pending questions before asking more"
        ));
    }
    let ask = LeadAsk {
        request,
        turn_id: turn.into(),
        created_at: now_ms(),
        status: "waiting".into(),
        answers: None,
        queue_id: None,
    };
    save(db, &ask)?;
    Ok(ask)
}

pub fn defer(db: &Database, session: &str, id: &str, turn: &str) -> Result<LeadAsk> {
    current(db, session, turn)?;
    let mut ask = load(db, session, id)?;
    if ask.turn_id != turn {
        return Err(anyhow!("TEAM_TURN_INVALID: question turn mismatch"));
    }
    if ask.status == "waiting" {
        if now_ms() < ask.created_at + WAIT_MS {
            return Err(anyhow!("ASKTOOL_NOT_DUE: question is still waiting"));
        }
        make_pending(&mut ask);
        save(db, &ask)?;
    }
    Ok(ask)
}

fn make_pending(ask: &mut LeadAsk) {
    ask.status = "pending".into();
    ask.request.team_pending =
        Some(json!({"deferredAt":crate::db::ms_to_ts(now_ms()),"requiresNewApproval":true}));
}

pub fn acknowledge(db: &Database, session: &str, id: &str, turn: &str) -> Result<()> {
    current(db, session, turn)?;
    let mut ask = load(db, session, id)?;
    if ask.turn_id != turn || ask.status != "answered_live" {
        return Err(anyhow!("ASKTOOL_NOT_FOUND: no live answer to acknowledge"));
    }
    ask.status = "answered".into();
    save(db, &ask)
}

pub fn list(db: &Database, session: &str) -> Result<Vec<LeadAsk>> {
    if sessions::get_session(db, session)?.is_none() {
        return Ok(vec![]);
    }
    let mut stmt = db
        .conn()
        .prepare_cached("SELECT value_json FROM kv WHERE ns=?1")?;
    let raws = stmt
        .query_map([NS], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut pending = vec![];
    for raw in raws {
        let mut ask: LeadAsk = serde_json::from_str(&raw)?;
        if ask.request.session_id != session {
            continue;
        }
        if !running(db, session, &ask.turn_id)? {
            if ask.status == "waiting" {
                make_pending(&mut ask);
                save(db, &ask)?;
            }
            // A crash between durable answer and live delivery must not lose it.
            if ask.status == "answered_live" {
                queue_answer(db, &mut ask)?;
            }
        }
        if matches!(ask.status.as_str(), "waiting" | "pending") {
            pending.push(ask);
        }
    }
    pending.sort_by_key(|a| a.created_at);
    Ok(pending)
}

fn validate_answers(ask: &LeadAsk, answers: &Value) -> Result<Vec<Option<Vec<String>>>> {
    let answers: Vec<Option<Vec<String>>> = serde_json::from_value(answers.clone())
        .map_err(|_| anyhow!("ASKTOOL_INVALID_ARGUMENT: invalid answers"))?;
    if answers.len() != ask.request.questions.len() {
        return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: answer count mismatch"));
    }
    let mut normalized = vec![];
    for (i, answer) in answers.into_iter().enumerate() {
        let Some(values) = answer else {
            normalized.push(None);
            continue;
        };
        let mut unique = vec![];
        for v in values {
            let v = v.trim().to_string();
            if v.len() > 16384 {
                return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: answer too long"));
            }
            if !v.is_empty() && !unique.contains(&v) {
                unique.push(v);
            }
        }
        if unique.len() > 100
            || (ask.request.questions[i].get("multiSelect") != Some(&Value::Bool(true))
                && unique.len() > 1)
        {
            return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: invalid selection count"));
        }
        normalized.push(Some(unique));
    }
    if serde_json::to_vec(&normalized)?.len() > 65536 {
        return Err(anyhow!("ASKTOOL_INVALID_ARGUMENT: answers exceed limit"));
    }
    Ok(normalized)
}

fn queue_answer(db: &Database, ask: &mut LeadAsk) -> Result<()> {
    if ask.request.team_pending.is_none() {
        ask.request.team_pending =
            Some(json!({"deferredAt":crate::db::ms_to_ts(now_ms()),"requiresNewApproval":true}));
    }
    let answers = ask
        .answers
        .as_ref()
        .ok_or_else(|| anyhow!("ASKTOOL_INVALID_ARGUMENT: missing durable answers"))?
        .clone();
    // Model-authored questions remain in the transcript, not authenticated user input.
    let content=format!("Authenticated user answer to deferred Team question {}. Answers in original question order: {}. This is a new user turn; explicitly resume or obtain new approval. The original assistant questions remain reference data in the transcript.",ask.request.request_id,serde_json::to_string(&answers)?);
    let id = format!("asktool-answer:{}", ask.request.request_id);
    let session = sessions::get_session(db, &ask.request.session_id)?
        .ok_or_else(|| anyhow!("ASKTOOL_NOT_FOUND: session deleted"))?;
    sessions::with_savepoint(db.conn(), "team_ask_answer", |_| {
        let entry = turn_queue::push(
            db,
            turn_queue::QueuedTurnInput {
                id: Some(id.clone()),
                session_id: ask.request.session_id.clone(),
                principal: "desktop".into(),
                idempotency_key: Some(id.clone()),
                input_hash: serde_json::to_string(&json!({"content":content,"answers":answers}))?,
                content: content.clone(),
                session_message_id: None,
                user_message_id: Some(id.clone()),
                voice_origin: None,
                attachments: None,
                permission_mode: session.summary.permission_mode.clone(),
            },
        )?;
        ask.status = "answered".into();
        ask.queue_id = Some(entry.id);
        save(db, ask)
    })
}

/// Trusted Main only. The sidecar proxy never exposes this operation.
pub fn resolve(db: &Database, session: &str, id: &str, answers: &Value) -> Result<LeadAsk> {
    let mut ask = load(db, session, id)?;
    let answers = validate_answers(&ask, answers)?;
    if ask.answers.as_ref().is_some_and(|a| a != &answers) {
        return Err(anyhow!(
            "IDEMPOTENCY_CONFLICT: question was answered differently"
        ));
    }
    if ask.status == "cancelled" {
        return Err(anyhow!(
            "ASKTOOL_NOT_FOUND: question cancelled; nextStep: open a new question"
        ));
    }
    if ask.status == "answered" || ask.status == "answered_live" {
        return Ok(ask);
    }
    ask.answers = Some(answers);
    if ask.status == "waiting"
        && running(db, session, &ask.turn_id)?
        && now_ms() < ask.created_at + WAIT_MS
    {
        ask.status = "answered_live".into();
        save(db, &ask)?;
    } else {
        queue_answer(db, &mut ask)?;
    }
    Ok(ask)
}

pub fn cancel(db: &Database, session: &str) -> Result<()> {
    if sessions::session_execution_profile(db, session)?.as_deref() != Some("team")
        || super::get_team_member_by_session_id(db, session)?.is_some()
    {
        return Ok(());
    }
    sessions::with_savepoint(db.conn(), "team_ask_cancel", |_| {
        if let Some(turn) = sessions::running_turn_id(db, session)? {
            db.kv_set("team-lead-ask-cancel-v1", session, &json!(turn))?;
        }
        let mut stmt=db.conn().prepare_cached("SELECT value_json FROM kv WHERE ns=?1 AND json_extract(value_json,'$.request.sessionId')=?2")?;
        let raws = stmt
            .query_map(params![NS, session], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for raw in raws {
            let mut ask: LeadAsk = serde_json::from_str(&raw)?;
            if matches!(ask.status.as_str(), "waiting" | "pending" | "answered_live") {
                ask.status = "cancelled".into();
                save(db, &ask)?;
            }
        }
        Ok(())
    })
}

pub fn queue_entry(db: &Database, ask: &LeadAsk) -> Result<Option<turn_queue::QueuedTurn>> {
    let Some(id) = ask.queue_id.as_deref() else {
        return Ok(None);
    };
    Ok(turn_queue::list(db, Some(&ask.request.session_id))?
        .into_iter()
        .find(|e| e.id == id))
}

pub(crate) fn cleanup(conn: &rusqlite::Connection, session: &str) -> Result<()> {
    conn.execute("DELETE FROM kv WHERE ns='team-lead-ask-v1' AND json_extract(value_json,'$.request.sessionId')=?1",[session])?;
    conn.execute(
        "DELETE FROM kv WHERE ns='team-lead-ask-cancel-v1' AND key=?1",
        [session],
    )?;
    Ok(())
}
