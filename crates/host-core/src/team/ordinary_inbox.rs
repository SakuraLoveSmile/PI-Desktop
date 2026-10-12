//! Authenticated ordinary Lead mail at an explicit wait boundary. This journal
//! is separate from execution inbox authority and never owns a collaboration turn.
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{db::Database, session_collaboration, sessions, transcripts};

pub(crate) const SCHEMA: &str = include_str!("ordinary_inbox/schema.sql");
pub(crate) const CAPABILITY: &str = "ordinary-team-inbox-v1";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadParams {
    pub team_session_id: String,
    pub caller_session_id: String,
    pub lead_turn_id: String,
    pub boundary_id: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Proof {
    message_id: String,
    user_message_id: String,
    team_session_id: String,
    lead_turn_id: String,
    scope_turn_id: String,
    boundary_id: String,
    phase: String,
    #[serde(skip_serializing)]
    source_session_id: String,
    #[serde(skip_serializing)]
    source_turn_id: String,
    #[serde(skip_serializing)]
    permission_ceiling: String,
}
const SELECT: &str = "SELECT message_id,user_message_id,team_session_id,lead_turn_id,scope_turn_id,boundary_id,phase,source_session_id,source_turn_id,permission_ceiling FROM team_ordinary_inbox";
fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Proof> {
    Ok(Proof {
        message_id: row.get(0)?,
        user_message_id: row.get(1)?,
        team_session_id: row.get(2)?,
        lead_turn_id: row.get(3)?,
        scope_turn_id: row.get(4)?,
        boundary_id: row.get(5)?,
        phase: row.get(6)?,
        source_session_id: row.get(7)?,
        source_turn_id: row.get(8)?,
        permission_ceiling: row.get(9)?,
    })
}
fn authorize(db: &Database, p: &ReadParams) -> Result<super::TeamExecutionDecision> {
    super::validate_team_lead(db, &p.team_session_id)?;
    if p.caller_session_id != p.team_session_id
        || p.boundary_id.is_empty()
        || p.boundary_id.len() > 256
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: ordinary inbox requires its Lead wait boundary"
        ));
    }
    if sessions::session_mode(db, &p.team_session_id)?.as_deref() != Some("agent")
        || sessions::running_turn_id(db, &p.team_session_id)?.as_deref() != Some(&p.lead_turn_id)
        || super::get_team(db, &p.team_session_id)?.is_none_or(|team| team.paused)
        || super::execution_inbox::state(
            db,
            &p.team_session_id,
            &p.caller_session_id,
            &p.lead_turn_id,
        )?
        .active
    {
        return Err(anyhow!(
            "TEAM_TURN_INVALID: ordinary inbox is unavailable for this turn"
        ));
    }
    let decision = super::authority::current_confirmed_decision(db, &p.team_session_id)?;
    if super::run_limits::state(db, &p.team_session_id)?
        .is_none_or(|run| run.run_id != decision.lead_turn_id || run.hard_reached_at.is_some())
    {
        return Err(anyhow!(
            "TEAM_UNAUTHORIZED: ordinary inbox run scope changed"
        ));
    }
    Ok(decision)
}
fn eligible(
    db: &Database,
    decision: &super::TeamExecutionDecision,
    message: &session_collaboration::Message,
) -> Result<bool> {
    if message.target_session_id != decision.team_session_id
        || message.kind != "message"
        || message.plugin_id != super::team_plugin_origin(&decision.team_session_id)
        || message.turn_id.is_some()
        || !matches!(message.status.as_str(), "queued" | "completed")
        || !decision
            .member_session_ids
            .contains(&message.source_session_id)
        || super::replacements::replaced(db, &decision.team_session_id, &message.source_session_id)?
    {
        return Ok(false);
    }
    session_collaboration::permissions::check_team_target(
        db,
        &decision.team_session_id,
        &message.permission_ceiling,
    )?;
    let source = db
        .kv_get("team-message-source-turn-v1", &message.id)?
        .and_then(|value| value.as_str().map(str::to_owned));
    let Some(source) = source else {
        return Ok(false);
    };
    for dispatch in &decision.message_ids {
        let valid: bool = db.conn().query_row("SELECT EXISTS(SELECT 1 FROM session_collaboration_messages m JOIN turns t ON t.id=m.turn_id AND t.session_id=m.target_session_id WHERE m.id=?1 AND m.turn_id=?2 AND m.source_session_id=?3 AND m.target_session_id=?4 AND (t.status IN ('running','completed') OR (t.status='error' AND EXISTS(SELECT 1 FROM kv k WHERE k.ns=?5 AND k.key=?6 AND json_extract(k.value_json,'$')=t.id))))", params![dispatch,source,decision.team_session_id,message.source_session_id,super::member_failure::PROOF_NS,message.id], |r|r.get(0))?;
        if valid {
            return Ok(true);
        }
    }
    Ok(false)
}
fn canonical(db: &Database, proof: &Proof) -> Result<sessions::UiMessage> {
    let delivery = session_collaboration::get(db, &proof.message_id)?
        .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: ordinary inbox ledger missing"))?;
    if delivery.source_session_id != proof.source_session_id
        || delivery.permission_ceiling != proof.permission_ceiling
        || db
            .kv_get("team-message-source-turn-v1", &proof.message_id)?
            .and_then(|v| v.as_str().map(str::to_owned))
            .as_deref()
            != Some(proof.source_turn_id.as_str())
        || delivery.target_session_id != proof.team_session_id
        || delivery.plugin_id != super::team_plugin_origin(&proof.team_session_id)
    {
        return Err(anyhow!("TEAM_UNAUTHORIZED: ordinary inbox ledger changed"));
    }
    // Keep the established source origin shape, rather than forging human steering.
    let origin = session_collaboration::message_origin(&delivery);
    Ok(serde_json::from_value(
        json!({"id":proof.user_message_id,"role":"user","content":delivery.content,"createdAt":crate::db::ms_to_ts(proof_created_at(db, proof)?),"sessionMessage":origin}),
    )?)
}
fn proof_created_at(db: &Database, proof: &Proof) -> Result<i64> {
    Ok(db.conn().query_row(
        "SELECT created_at FROM team_ordinary_inbox WHERE message_id=?1",
        [&proof.message_id],
        |row| row.get(0),
    )?)
}
/// Provenance is authorized by a durable proof and exact original ledger, not
/// by arbitrary user JSON or a report that merely claims to be an expert.
pub(crate) fn prepare_append(
    db: &Database,
    session: &str,
    input: &sessions::UiMessage,
    turn: Option<&str>,
) -> Result<Option<sessions::UiMessage>> {
    let proof = db
        .conn()
        .prepare_cached(&format!("{SELECT} WHERE user_message_id=?1"))?
        .query_row([&input.id], row)
        .optional()?;
    let Some(proof) = proof else { return Ok(None) };
    let expected = canonical(db, &proof)?;
    validate_input(&proof, session, input, turn, &expected)?;
    Ok(Some(expected))
}

fn validate_input(
    proof: &Proof,
    session: &str,
    input: &sessions::UiMessage,
    turn: Option<&str>,
    expected: &sessions::UiMessage,
) -> Result<()> {
    if session != proof.team_session_id
        || turn != Some(proof.lead_turn_id.as_str())
        || input.role != "user"
        || input.content != expected.content
        || input.steering == Some(true)
        || input.parent_tool_call_id.is_some()
        || input
            .attachments
            .as_ref()
            .is_some_and(|items| !items.is_empty())
        || input
            .session_message
            .as_ref()
            .is_some_and(|origin| Some(origin) != expected.session_message.as_ref())
    {
        return Err(anyhow!(
            "PERMISSION_DENIED: ordinary inbox provenance does not match its proof"
        ));
    }
    Ok(())
}
pub(crate) fn owns_input(db: &Database, session: &str, user_id: &str) -> Result<bool> {
    Ok(db.conn().query_row("SELECT EXISTS(SELECT 1 FROM team_ordinary_inbox WHERE team_session_id=?1 AND user_message_id=?2)", params![session,user_id], |row|row.get(0))?)
}

/// Called in the same transaction that inserts/rebuilds the transcript index.
pub(crate) fn finalize_append(
    db: &Database,
    conn: &Connection,
    session: &str,
    record: &transcripts::MessageRecord,
) -> Result<Option<String>> {
    let proof = conn
        .prepare_cached(&format!(
            "{SELECT} WHERE user_message_id=?1 AND team_session_id=?2"
        ))?
        .query_row(params![record.id, session], row)
        .optional()?;
    let Some(proof) = proof else { return Ok(None) };
    // A repair rebuilds the whole transcript, including other proofs. Each
    // journal-owned body must pass the same identity checks before the shared
    // index/ledger/queue transaction can commit, regardless of its phase.
    let input = sessions::record_to_ui(record.clone());
    let expected = canonical(db, &proof)?;
    validate_input(
        &proof,
        session,
        &input,
        Some(&proof.lead_turn_id),
        &expected,
    )?;
    if input.session_message != expected.session_message {
        return Err(anyhow!(
            "PERMISSION_DENIED: ordinary inbox transcript origin changed"
        ));
    }
    conn.execute("UPDATE team_ordinary_inbox SET phase=CASE WHEN phase='acked' THEN 'acked' ELSE 'persisted' END,updated_at=?2 WHERE message_id=?1",params![proof.message_id,crate::db::now_ms()])?;
    conn.execute("UPDATE session_collaboration_messages SET status='completed',updated_at=?2 WHERE id=?1 AND status='queued' AND turn_id IS NULL",params![proof.message_id,crate::db::now_ms()])?;
    conn.execute(
        "DELETE FROM turn_queue WHERE session_message_id=?1 AND session_id=?2",
        params![proof.message_id, session],
    )?;
    Ok(Some(proof.lead_turn_id))
}
fn proofs(db: &Database, filter: &str, args: impl rusqlite::Params) -> Result<Vec<Proof>> {
    Ok(db.conn().prepare_cached(&format!("{SELECT} WHERE {filter} ORDER BY (SELECT created_at FROM session_collaboration_messages WHERE id=message_id),message_id"))?.query_map(args,row)?.collect::<rusqlite::Result<_>>()?)
}
/// Restart never resumes a provider. An unwritten preparation returns to queue;
/// a written body is reconciled once and stays in the authenticated transcript.
fn recover_proof(db: &Database, proof: &Proof) -> Result<()> {
    let written = transcripts::read_transcript(db.data_dir(), &proof.team_session_id)?
        .into_iter()
        .find(|record| record.id == proof.user_message_id);
    if let Some(record) = written {
        let existing = sessions::record_to_ui(record);
        let canonical = canonical(db, proof)?;
        if existing.session_message != canonical.session_message {
            return Err(anyhow!(
                "PERMISSION_DENIED: ordinary inbox transcript origin changed"
            ));
        }
        prepare_append(
            db,
            &proof.team_session_id,
            &existing,
            Some(&proof.lead_turn_id),
        )?;
        sessions::append_message(
            db,
            &proof.team_session_id,
            &canonical,
            Some(&proof.lead_turn_id),
        )?;
    } else {
        db.conn().execute(
            "DELETE FROM team_ordinary_inbox WHERE message_id=?1 AND phase='prepared'",
            [&proof.message_id],
        )?;
    }
    Ok(())
}
pub(crate) fn recover(db: &Database) -> Result<()> {
    for proof in proofs(db, "phase='prepared'", [])? {
        recover_proof(db, &proof)?;
    }
    Ok(())
}
pub(crate) fn get_proof(db: &Database, team: &str, id: &str) -> Result<Value> {
    super::validate_team_lead(db, team)?;
    let proof = db
        .conn()
        .prepare_cached(&format!(
            "{SELECT} WHERE message_id=?1 AND team_session_id=?2"
        ))?
        .query_row(params![id, team], row)
        .optional()?;
    if let Some(ref proof) = proof {
        canonical(db, proof)?;
    }
    Ok(json!({"proof":proof}))
}
pub(crate) fn persisted_ids(db: &Database, p: &ReadParams) -> Result<Vec<String>> {
    Ok(proofs(
        db,
        "team_session_id=?1 AND lead_turn_id=?2 AND phase='persisted'",
        params![p.team_session_id, p.lead_turn_id],
    )?
    .into_iter()
    .map(|proof| proof.message_id)
    .collect())
}

pub(crate) fn read(db: &Database, p: &ReadParams) -> Result<Value> {
    let decision = authorize(db, p)?;
    // Retrying a transport read reconciles a file-first interrupted commit.
    for proof in proofs(
        db,
        "team_session_id=?1 AND lead_turn_id=?2 AND phase='prepared'",
        params![p.team_session_id, p.lead_turn_id],
    )? {
        recover_proof(db, &proof)?;
    }
    let pending = super::list_member_messages(db, &p.team_session_id, &p.team_session_id)?;
    for pending in pending {
        if pending.target_session_id != p.team_session_id
            || pending.status != "queued"
            || pending.turn_id.is_some()
        {
            continue;
        }
        let message = session_collaboration::get(db, &pending.id)?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: ordinary inbox message missing"))?;
        if !eligible(db, &decision, &message)? {
            break;
        }
        let proof = Proof {
            message_id: message.id,
            user_message_id: Uuid::new_v4().to_string(),
            team_session_id: p.team_session_id.clone(),
            lead_turn_id: p.lead_turn_id.clone(),
            scope_turn_id: decision.lead_turn_id.clone(),
            boundary_id: p.boundary_id.clone(),
            phase: "prepared".into(),
            source_session_id: message.source_session_id,
            source_turn_id: db
                .kv_get("team-message-source-turn-v1", &pending.id)?
                .and_then(|v| v.as_str().map(str::to_owned))
                .ok_or_else(|| anyhow!("TEAM_UNAUTHORIZED: missing source turn"))?,
            permission_ceiling: message.permission_ceiling,
        };
        db.conn().execute("INSERT INTO team_ordinary_inbox(message_id,user_message_id,team_session_id,lead_turn_id,scope_turn_id,boundary_id,source_session_id,source_turn_id,permission_ceiling,phase,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'prepared',?10,?10)",params![proof.message_id,proof.user_message_id,proof.team_session_id,proof.lead_turn_id,proof.scope_turn_id,proof.boundary_id,proof.source_session_id,proof.source_turn_id,proof.permission_ceiling,crate::db::now_ms()])?;
        sessions::append_message(
            db,
            &proof.team_session_id,
            &canonical(db, &proof)?,
            Some(&proof.lead_turn_id),
        )?;
    }
    let mut messages = vec![];
    for proof in proofs(
        db,
        "team_session_id=?1 AND lead_turn_id=?2 AND phase='persisted'",
        params![p.team_session_id, p.lead_turn_id],
    )? {
        let delivery = session_collaboration::get(db, &proof.message_id)?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: inbox ledger missing"))?;
        if proof.scope_turn_id != decision.lead_turn_id || !eligible(db, &decision, &delivery)? {
            break;
        }
        let mut value = serde_json::to_value(&proof)?;
        value["message"] = serde_json::to_value(canonical(db, &proof)?)?;
        messages.push(value);
    }
    Ok(json!({"capability":CAPABILITY,"messages":messages}))
}

pub(crate) fn ack(db: &Database, p: &ReadParams, ids: &[String]) -> Result<Value> {
    let decision = authorize(db, p)?;
    let tx = db.conn().unchecked_transaction()?;
    for id in ids {
        // Runtime may retain an accepted body after a lost ACK response. Every
        // re-ACK is a new admission fence, even when its proof is already acked.
        let proof = tx.prepare_cached(&format!("{SELECT} WHERE message_id=?1 AND team_session_id=?2 AND lead_turn_id=?3 AND boundary_id=?4 AND phase IN ('persisted','acked')"))?
            .query_row(params![id,p.team_session_id,p.lead_turn_id,p.boundary_id], row).optional()?
            .ok_or_else(||anyhow!("TEAM_UNAUTHORIZED: ordinary inbox ACK proof mismatch"))?;
        canonical(db, &proof)?;
        let delivery = session_collaboration::get(db, id)?
            .ok_or_else(|| anyhow!("TEAM_NOT_FOUND: inbox ledger missing"))?;
        if proof.scope_turn_id != decision.lead_turn_id || !eligible(db, &decision, &delivery)? {
            return Err(anyhow!(
                "TEAM_UNAUTHORIZED: ordinary inbox ACK source authority changed"
            ));
        }
        let changed = tx.execute("UPDATE team_ordinary_inbox SET phase='acked',updated_at=?5 WHERE message_id=?1 AND team_session_id=?2 AND lead_turn_id=?3 AND boundary_id=?4 AND phase IN ('persisted','acked')",params![id,p.team_session_id,p.lead_turn_id,p.boundary_id,crate::db::now_ms()])?;
        if changed != 1 {
            return Err(anyhow!(
                "TEAM_UNAUTHORIZED: ordinary inbox ACK proof mismatch"
            ));
        }
    }
    tx.commit()?;
    Ok(json!({"ok":true,"acknowledgedIds":ids}))
}

#[cfg(test)]
mod tests;
