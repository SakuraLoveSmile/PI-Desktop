//! Model-written summary of a local session, kept in the existing kv boundary.
//!
//! The text describes the conversation for the activity rail's pinned card. Host
//! core only validates and stores it: the model call lives in the Node agent
//! runtime. The record is never fed back to the agent, never indexed for search
//! and never exported. It is removed with the session (see the three delete
//! paths that name [`NAMESPACE`]).

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::db::{ms_to_ts, now_ms, Database};

pub(crate) const NAMESPACE: &str = "session-summary-v1";
pub(crate) const MAX_TEXT_BYTES: usize = 2000;
const VERSION: u8 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u8,
    text: String,
    revision: i64,
    based_on_message_count: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSummary {
    pub session_id: String,
    pub text: String,
    pub revision: i64,
    pub based_on_message_count: i64,
    pub updated_at: String,
    /// Messages added since the summary was written.
    pub behind: i64,
    /// The transcript is now shorter than the summary's basis, as after a rewind.
    pub diverged: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSummaryState {
    pub message_count: i64,
    pub summary: Option<SessionSummary>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum SessionSummaryError {
    #[error("sessionId must not be empty")]
    InvalidSessionId,
    #[error("session summaries are unavailable for native or remote sessions")]
    UnsupportedSession,
    #[error("session not found")]
    NotFound,
    #[error("{0}")]
    InvalidArgument(&'static str),
    #[error("summary text exceeds 2000 bytes UTF-8")]
    TextTooLarge,
    #[error("summary was changed by another writer")]
    Conflict(SessionSummaryState),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<rusqlite::Error> for SessionSummaryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Internal(error.into())
    }
}

fn validate_session_id(session_id: &str) -> Result<(), SessionSummaryError> {
    if session_id.trim().is_empty() {
        return Err(SessionSummaryError::InvalidSessionId);
    }
    if session_id.starts_with("native-pi:") || session_id.starts_with("remote:") {
        return Err(SessionSummaryError::UnsupportedSession);
    }
    Ok(())
}

/// The message index counter of a live session (the same count the session
/// list reports). A trashed or missing session is `NotFound`.
fn message_count(conn: &Connection, session_id: &str) -> Result<i64, SessionSummaryError> {
    conn.query_row(
        "SELECT last_seq FROM sessions WHERE id = ?1 AND deleted_at IS NULL",
        [session_id],
        |row| row.get(0),
    )
    .optional()?
    .ok_or(SessionSummaryError::NotFound)
}

/// An unreadable record, or one written by a newer build, reads as absent: the
/// text is derived and the next refresh writes a fresh one.
fn load(conn: &Connection, session_id: &str) -> Result<Option<Stored>, SessionSummaryError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2",
            params![NAMESPACE, session_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw
        .and_then(|raw| serde_json::from_str::<Stored>(&raw).ok())
        .filter(|stored| stored.version == VERSION))
}

fn view(session_id: &str, stored: &Stored, count: i64) -> SessionSummary {
    SessionSummary {
        session_id: session_id.to_owned(),
        text: stored.text.clone(),
        revision: stored.revision,
        based_on_message_count: stored.based_on_message_count,
        updated_at: ms_to_ts(stored.updated_at),
        behind: (count - stored.based_on_message_count).max(0),
        diverged: count < stored.based_on_message_count,
    }
}

fn state(conn: &Connection, session_id: &str) -> Result<SessionSummaryState, SessionSummaryError> {
    let count = message_count(conn, session_id)?;
    let summary = load(conn, session_id)?.map(|stored| view(session_id, &stored, count));
    Ok(SessionSummaryState {
        message_count: count,
        summary,
    })
}

pub(crate) fn get(
    db: &Database,
    session_id: &str,
) -> Result<SessionSummaryState, SessionSummaryError> {
    validate_session_id(session_id)?;
    // One snapshot, so the count and the record belong together.
    let tx = db.conn().unchecked_transaction()?;
    state(&tx, session_id)
}

/// Compare and replace in one immediate transaction. A late result for a
/// deleted session fails the live-session check instead of resurrecting a row.
pub(crate) fn set(
    db: &Database,
    session_id: &str,
    text: &str,
    based_on_message_count: i64,
    expected_revision: i64,
) -> Result<SessionSummary, SessionSummaryError> {
    validate_session_id(session_id)?;
    if expected_revision < 0 {
        return Err(SessionSummaryError::InvalidArgument(
            "expectedRevision must be a non-negative integer",
        ));
    }
    if based_on_message_count < 0 {
        return Err(SessionSummaryError::InvalidArgument(
            "basedOnMessageCount must be a non-negative integer",
        ));
    }
    let text = text.trim();
    if text.is_empty() {
        return Err(SessionSummaryError::InvalidArgument(
            "summary text must not be empty",
        ));
    }
    if text.contains('\0') {
        return Err(SessionSummaryError::InvalidArgument(
            "summary text must not contain NUL",
        ));
    }
    if text.len() > MAX_TEXT_BYTES {
        return Err(SessionSummaryError::TextTooLarge);
    }
    let tx = Transaction::new_unchecked(db.conn(), TransactionBehavior::Immediate)?;
    let count = message_count(&tx, session_id)?;
    if based_on_message_count > count {
        return Err(SessionSummaryError::InvalidArgument(
            "basedOnMessageCount is ahead of the transcript",
        ));
    }
    let current = load(&tx, session_id)?;
    let current_revision = current.as_ref().map_or(0, |stored| stored.revision);
    if current_revision != expected_revision {
        return Err(SessionSummaryError::Conflict(SessionSummaryState {
            message_count: count,
            summary: current.map(|stored| view(session_id, &stored, count)),
        }));
    }
    let revision = current_revision.checked_add(1).ok_or_else(|| {
        SessionSummaryError::Internal(anyhow::anyhow!("summary revision overflow"))
    })?;
    let stored = Stored {
        version: VERSION,
        text: text.to_owned(),
        revision,
        based_on_message_count,
        updated_at: now_ms(),
    };
    tx.execute(
        "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(ns, key) DO UPDATE SET
           value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![
            NAMESPACE,
            session_id,
            serde_json::to_string(&stored).map_err(anyhow::Error::from)?,
            stored.updated_at
        ],
    )?;
    tx.commit()?;
    Ok(view(session_id, &stored, count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions;

    fn open(dir: &std::path::Path) -> Database {
        Database::open_in_dir(dir).unwrap()
    }

    fn session(db: &Database) -> String {
        sessions::create_session(db, None, None, None, None, None)
            .unwrap()
            .id
    }

    fn say(db: &Database, id: &str, message_id: &str, role: &str) {
        let message: sessions::UiMessage = serde_json::from_value(serde_json::json!({
            "id": message_id, "role": role, "content": format!("{role} says {message_id}"),
            "createdAt": "2026-11-22T00:00:00Z"
        }))
        .unwrap();
        sessions::append_message(db, id, &message, None).unwrap();
    }

    fn kv_rows(db: &Database, id: &str) -> i64 {
        db.conn()
            .query_row(
                "SELECT COUNT(*) FROM kv WHERE ns = ?1 AND key = ?2",
                params![NAMESPACE, id],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn summary_journey_counts_what_arrived_after_it_and_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let blank = get(&db, &id).unwrap();
        assert_eq!(blank.message_count, 0);
        assert!(blank.summary.is_none());
        say(&db, &id, "u1", "user");
        say(&db, &id, "a1", "assistant");
        let saved = set(&db, &id, "  Working on the rail card.\n ", 2, 0).unwrap();
        assert_eq!(saved.text, "Working on the rail card.");
        assert_eq!((saved.revision, saved.behind), (1, 0));
        assert!(!saved.diverged);
        chrono::DateTime::parse_from_rfc3339(&saved.updated_at).unwrap();
        say(&db, &id, "u2", "user");
        say(&db, &id, "a2", "assistant");
        say(&db, &id, "u3", "user");
        let later = get(&db, &id).unwrap();
        assert_eq!(later.message_count, 5);
        let summary = later.summary.unwrap();
        assert_eq!((summary.behind, summary.diverged), (3, false));
        assert_eq!(summary.based_on_message_count, 2);
        drop(db);
        let reopened = get(&open(dir.path()), &id).unwrap().summary.unwrap();
        assert_eq!(reopened.text, saved.text);
        assert_eq!(reopened.revision, 1);
    }

    #[test]
    fn a_transcript_shorter_than_its_basis_reads_as_diverged() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        for index in 0..4 {
            say(
                &db,
                &id,
                &format!("m{index}"),
                if index % 2 == 0 { "user" } else { "assistant" },
            );
        }
        set(&db, &id, "Four messages in.", 4, 0).unwrap();
        sessions::replace_messages(&db, &id, &[]).unwrap();
        let state = get(&db, &id).unwrap();
        assert_eq!(state.message_count, 0);
        let summary = state.summary.unwrap();
        assert!(summary.diverged);
        assert_eq!(summary.behind, 0);
    }

    #[test]
    fn compare_and_set_refuses_a_stale_writer_and_hands_back_the_winner() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        say(&db, &id, "u1", "user");
        let other = open(dir.path());
        assert!(get(&other, &id).unwrap().summary.is_none());
        let first = set(&db, &id, "First writer.", 1, 0).unwrap();
        match set(&other, &id, "Stale overwrite.", 1, 0).unwrap_err() {
            SessionSummaryError::Conflict(current) => {
                assert_eq!(current.summary.unwrap(), first);
                assert_eq!(current.message_count, 1);
            }
            error => panic!("unexpected error: {error}"),
        }
        assert_eq!(get(&db, &id).unwrap().summary.unwrap(), first);
        let next = set(&other, &id, "Reconciled.", 1, 1).unwrap();
        assert_eq!(next.revision, 2);
    }

    #[test]
    fn writes_are_validated_before_anything_is_stored() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        say(&db, &id, "u1", "user");
        let invalid = |result: Result<SessionSummary, SessionSummaryError>| {
            assert!(
                matches!(result, Err(SessionSummaryError::InvalidArgument(_))),
                "expected an invalid argument"
            );
        };
        invalid(set(&db, &id, "   \n ", 1, 0));
        invalid(set(&db, &id, "nul\0byte", 1, 0));
        invalid(set(&db, &id, "ok", -1, 0));
        invalid(set(&db, &id, "ok", 1, -1));
        invalid(set(&db, &id, "ahead of the transcript", 2, 0));
        assert!(matches!(
            set(&db, &id, &"x".repeat(MAX_TEXT_BYTES + 1), 1, 0),
            Err(SessionSummaryError::TextTooLarge)
        ));
        assert!(set(&db, &id, &"字".repeat(MAX_TEXT_BYTES / 3), 1, 0).is_ok());
        assert_eq!(kv_rows(&db, &id), 1);
    }

    #[test]
    fn unsupported_missing_and_trashed_sessions_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        for id in ["remote:abc", "native-pi:abc"] {
            assert!(matches!(
                get(&db, id),
                Err(SessionSummaryError::UnsupportedSession)
            ));
            assert!(matches!(
                set(&db, id, "x", 0, 0),
                Err(SessionSummaryError::UnsupportedSession)
            ));
        }
        assert!(matches!(
            get(&db, " "),
            Err(SessionSummaryError::InvalidSessionId)
        ));
        assert!(matches!(
            get(&db, "missing"),
            Err(SessionSummaryError::NotFound)
        ));
        assert!(matches!(
            set(&db, "missing", "x", 0, 0),
            Err(SessionSummaryError::NotFound)
        ));
        let id = session(&db);
        db.conn()
            .execute("UPDATE sessions SET deleted_at = 1 WHERE id = ?1", [&id])
            .unwrap();
        assert!(matches!(
            set(&db, &id, "late result", 0, 0),
            Err(SessionSummaryError::NotFound)
        ));
        assert_eq!(kv_rows(&db, &id), 0);
    }

    #[test]
    fn an_unreadable_or_newer_record_reads_as_absent_and_can_be_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        for raw in [
            "not json".to_owned(),
            serde_json::json!({
                "version": 2, "text": "from a newer build", "revision": 9,
                "basedOnMessageCount": 0, "updatedAt": 1
            })
            .to_string(),
        ] {
            db.conn()
                .execute(
                    "INSERT INTO kv (ns, key, value_json, updated_at) VALUES (?1, ?2, ?3, 1)
                     ON CONFLICT(ns, key) DO UPDATE SET value_json = excluded.value_json",
                    params![NAMESPACE, id, raw],
                )
                .unwrap();
            assert!(get(&db, &id).unwrap().summary.is_none());
            let written = set(&db, &id, "Fresh text.", 0, 0).unwrap();
            assert_eq!(written.revision, 1);
        }
    }

    #[test]
    fn the_summary_stays_out_of_the_transcript_and_a_fork_starts_without_one() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        say(&db, &id, "u1", "user");
        say(&db, &id, "a1", "assistant");
        let transcript = dir.path().join("sessions").join(format!("{id}.jsonl"));
        let before = std::fs::read(&transcript).unwrap();
        let saved = set(
            &db,
            &id,
            "Model-written note; never sent back to the agent.",
            2,
            0,
        )
        .unwrap();
        assert_eq!(std::fs::read(&transcript).unwrap(), before);
        let sessions::ForkSessionResult::Created(fork) =
            sessions::fork_session_through(&db, &id, None, None).unwrap()
        else {
            panic!("expected fork");
        };
        assert!(get(&db, &fork.summary.id).unwrap().summary.is_none());
        assert_eq!(get(&db, &id).unwrap().summary.unwrap(), saved);
    }

    #[test]
    fn every_session_delete_path_removes_the_summary_row() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let plain = session(&db);
        let team_aware = session(&db);
        let kept = session(&db);
        for id in [&plain, &team_aware, &kept] {
            say(&db, id, "u1", "user");
            set(&db, id, "Row to remove.", 1, 0).unwrap();
            assert_eq!(kv_rows(&db, id), 1);
        }
        assert!(sessions::delete_session(&db, &plain).unwrap());
        assert!(sessions::delete_session_with_team_cleanup(&db, &team_aware).unwrap());
        assert_eq!(kv_rows(&db, &plain), 0);
        assert_eq!(kv_rows(&db, &team_aware), 0);
        assert_eq!(kv_rows(&db, &kept), 1);
        // A late result for a deleted session cannot bring the row back.
        assert!(matches!(
            set(&db, &plain, "late", 0, 0),
            Err(SessionSummaryError::NotFound)
        ));
        assert_eq!(kv_rows(&db, &plain), 0);
    }
}
