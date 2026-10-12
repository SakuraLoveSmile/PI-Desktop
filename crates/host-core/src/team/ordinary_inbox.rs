//! Read compatibility for the released ordinary Lead consumption journal.
//! This build recovers existing proofs only; it has no same-turn inbox writer.
use crate::{db::Database, session_collaboration, sessions, transcripts};
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;

pub(crate) const SCHEMA: &str = include_str!("ordinary_inbox/schema.sql");

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
