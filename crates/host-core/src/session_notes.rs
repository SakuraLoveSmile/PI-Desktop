//! User-owned per-session notes, separate from model context and transcripts.

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;

use crate::db::{ms_to_ts, now_ms, Database};

pub(crate) const MAX_CONTENT_BYTES: usize = 64 * 1024;

/// Applied by the additive Plus schema track, never by an RPC request.
pub(crate) const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS session_quick_notes (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) <= 65536),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at INTEGER NOT NULL
);
"#;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionQuickNote {
    pub session_id: String,
    pub content: String,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum SessionNoteError {
    #[error("sessionId must not be empty")]
    InvalidSessionId,
    #[error("Quick Notes are unavailable for native or remote sessions")]
    UnsupportedSession,
    #[error("session not found")]
    NotFound,
    #[error("expectedRevision must be a non-negative integer")]
    InvalidRevision,
    #[error("note content exceeds 64 KiB UTF-8")]
    ContentTooLarge,
    #[error("note was changed by another editor")]
    Conflict(SessionQuickNote),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl From<rusqlite::Error> for SessionNoteError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Internal(error.into())
    }
}

fn validate_session_id(session_id: &str) -> Result<(), SessionNoteError> {
    if session_id.trim().is_empty() {
        return Err(SessionNoteError::InvalidSessionId);
    }
    if session_id.starts_with("native-pi:") || session_id.starts_with("remote:") {
        return Err(SessionNoteError::UnsupportedSession);
    }
    Ok(())
}

fn read(conn: &Connection, session_id: &str) -> Result<SessionQuickNote, SessionNoteError> {
    let note = conn
        .query_row(
            "SELECT n.content, n.revision, n.updated_at FROM sessions s
             LEFT JOIN session_quick_notes n ON n.session_id = s.id
             WHERE s.id = ?1 AND s.deleted_at IS NULL",
            [session_id],
            |row| {
                let updated_at: Option<i64> = row.get(2)?;
                Ok(SessionQuickNote {
                    session_id: session_id.to_owned(),
                    content: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    revision: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    updated_at: updated_at.map(ms_to_ts),
                })
            },
        )
        .optional()?;
    note.ok_or(SessionNoteError::NotFound)
}

pub(crate) fn get(db: &Database, session_id: &str) -> Result<SessionQuickNote, SessionNoteError> {
    validate_session_id(session_id)?;
    read(db.conn(), session_id)
}

/// Compare and replace in one immediate transaction. Even another database
/// connection cannot race between the live-session/revision check and commit.
pub(crate) fn set(
    db: &Database,
    session_id: &str,
    content: &str,
    expected_revision: i64,
) -> Result<SessionQuickNote, SessionNoteError> {
    validate_session_id(session_id)?;
    if expected_revision < 0 {
        return Err(SessionNoteError::InvalidRevision);
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(SessionNoteError::ContentTooLarge);
    }
    let tx = Transaction::new_unchecked(db.conn(), TransactionBehavior::Immediate)?;
    let current = read(&tx, session_id)?;
    if current.revision != expected_revision {
        return Err(SessionNoteError::Conflict(current));
    }
    let revision = current
        .revision
        .checked_add(1)
        .ok_or_else(|| SessionNoteError::Internal(anyhow::anyhow!("note revision overflow")))?;
    let updated_at = now_ms();
    tx.execute(
        "INSERT INTO session_quick_notes (session_id, content, revision, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id) DO UPDATE SET content = excluded.content,
           revision = excluded.revision, updated_at = excluded.updated_at",
        params![session_id, content, revision, updated_at],
    )?;
    tx.commit()?;
    Ok(SessionQuickNote {
        session_id: session_id.to_owned(),
        content: content.to_owned(),
        revision,
        updated_at: Some(ms_to_ts(updated_at)),
    })
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

    #[test]
    fn user_note_journey_survives_reopen_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let blank = get(&db, &id).unwrap();
        assert_eq!(blank.content, "");
        assert_eq!(blank.revision, 0);
        assert!(blank.updated_at.is_none());
        let markdown = "  # 笔记\r\n\n- [ ] Follow up\n```rust\nlet x = 1;\n```\n  ";
        let saved = set(&db, &id, markdown, 0).unwrap();
        assert_eq!(saved.content, markdown);
        assert_eq!(saved.revision, 1);
        chrono::DateTime::parse_from_rfc3339(saved.updated_at.as_ref().unwrap()).unwrap();
        drop(db);
        let db = open(dir.path());
        assert_eq!(get(&db, &id).unwrap(), saved);
        let cleared = set(&db, &id, "", 1).unwrap();
        assert_eq!(cleared.revision, 2);
        assert_eq!(cleared.content, "");
        drop(db);
        assert_eq!(get(&open(dir.path()), &id).unwrap(), cleared);
    }

    #[test]
    fn additive_schema_preserves_populated_database_and_session_isolation() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_dir(dir.path()).unwrap();
        let id = session(&db);
        let other = session(&db);
        let settings = serde_json::json!({"language": "zh-CN", "theme": "dark"});
        db.set_setting("app", &settings).unwrap();
        db.conn()
            .execute_batch("DROP TABLE IF EXISTS session_quick_notes")
            .unwrap();
        let previous = sessions::get_session(&db, &id).unwrap().unwrap();
        let version: i64 = db
            .conn()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        db.conn().execute_batch(SCHEMA).unwrap();
        db.conn().execute_batch(SCHEMA).unwrap();
        set(&db, &id, "private note", 0).unwrap();
        let after = sessions::get_session(&db, &id).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(previous).unwrap(),
            serde_json::to_value(after).unwrap()
        );
        assert_eq!(get(&db, &other).unwrap().revision, 0);
        assert_eq!(db.get_setting("app").unwrap(), Some(settings));
        assert_eq!(
            db.conn()
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            version
        );
        assert_eq!(
            db.conn()
                .query_row("SELECT COUNT(*) FROM sessions", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn compare_and_set_refuses_stale_editors_across_connections() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let other_editor = open(dir.path());
        assert_eq!(get(&other_editor, &id).unwrap().revision, 0);
        let saved = set(&db, &id, "first editor", 0).unwrap();
        match set(&other_editor, &id, "stale overwrite", 0).unwrap_err() {
            SessionNoteError::Conflict(note) => assert_eq!(note, saved),
            error => panic!("unexpected error: {error}"),
        }
        assert_eq!(get(&db, &id).unwrap(), saved);
        let next = set(&other_editor, &id, "explicitly reconciled", 1).unwrap();
        assert_eq!(next.revision, 2);
        assert_eq!(get(&db, &id).unwrap(), next);
    }

    #[test]
    fn notes_stay_out_of_transcripts_and_forked_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let message: sessions::UiMessage = serde_json::from_value(serde_json::json!({
            "id": "user-1", "role": "user", "content": "Existing conversation text",
            "createdAt": "2026-10-09T00:00:00Z"
        }))
        .unwrap();
        sessions::append_message(&db, &id, &message, None).unwrap();
        let transcript = dir.path().join("sessions").join(format!("{id}.jsonl"));
        let before = std::fs::read(&transcript).unwrap();
        let saved = set(&db, &id, "User-private context; never send to the model", 0).unwrap();
        assert_eq!(std::fs::read(&transcript).unwrap(), before);
        let sessions::ForkSessionResult::Created(fork) =
            sessions::fork_session_through(&db, &id, None, None).unwrap()
        else {
            panic!("expected fork");
        };
        assert_eq!(get(&db, &fork.summary.id).unwrap().revision, 0);
        assert_eq!(get(&db, &fork.summary.id).unwrap().content, "");
        assert_eq!(get(&db, &id).unwrap(), saved);
    }

    #[test]
    fn simultaneous_editors_commit_one_revision_without_losing_the_winner() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let editors: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|content| {
                let connection = open(dir.path());
                let session_id = id.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    set(&connection, &session_id, content, 0)
                })
            })
            .collect();
        let results: Vec<_> = editors
            .into_iter()
            .map(|editor| editor.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let winner = get(&db, &id).unwrap();
        assert_eq!(winner.revision, 1);
        for result in results {
            match result {
                Ok(note) | Err(SessionNoteError::Conflict(note)) => assert_eq!(note, winner),
                Err(error) => panic!("unexpected error: {error}"),
            }
        }
    }

    #[test]
    fn content_bound_counts_utf8_bytes_and_preserves_exact_content() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let exact = format!("{}x", "中".repeat((MAX_CONTENT_BYTES - 1) / 3));
        assert_eq!(exact.len(), MAX_CONTENT_BYTES);
        let saved = set(&db, &id, &exact, 0).unwrap();
        for large in ["x".repeat(MAX_CONTENT_BYTES + 1), format!("{exact}中")] {
            assert!(matches!(
                set(&db, &id, &large, 1),
                Err(SessionNoteError::ContentTooLarge)
            ));
        }
        assert_eq!(get(&db, &id).unwrap(), saved);
        let literal = "\0\n  **note** \n";
        assert_eq!(set(&db, &id, literal, 1).unwrap().content, literal);
    }

    #[test]
    fn invalid_missing_and_deleted_sessions_cannot_read_or_write() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        assert!(matches!(
            set(&db, &id, "x", -1),
            Err(SessionNoteError::InvalidRevision)
        ));
        assert_eq!(get(&db, &id).unwrap().revision, 0);
        for invalid in ["", "  ", "native-pi:abc", "remote:abc", "missing"] {
            assert!(get(&db, invalid).is_err());
            assert!(set(&db, invalid, "x", 0).is_err());
        }
        db.conn()
            .execute("UPDATE sessions SET deleted_at = 1 WHERE id = ?1", [&id])
            .unwrap();
        assert!(matches!(get(&db, &id), Err(SessionNoteError::NotFound)));
        assert!(matches!(
            set(&db, &id, "x", 0),
            Err(SessionNoteError::NotFound)
        ));
    }

    #[test]
    fn session_delete_cascades_notes_and_stale_writes_do_not_recreate_them() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(dir.path());
        let id = session(&db);
        let other = session(&db);
        set(&db, &id, "to delete", 0).unwrap();
        let kept = set(&db, &other, "kept", 0).unwrap();
        assert!(sessions::delete_session(&db, &id).unwrap());
        assert!(matches!(
            set(&db, &id, "late save", 1),
            Err(SessionNoteError::NotFound)
        ));
        assert!(matches!(get(&db, &id), Err(SessionNoteError::NotFound)));
        assert_eq!(get(&db, &other).unwrap(), kept);
        assert_eq!(
            db.conn()
                .query_row("SELECT COUNT(*) FROM session_quick_notes", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
