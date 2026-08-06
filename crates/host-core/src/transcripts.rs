//! Per-session transcript files (D119).
//!
//! Message content lives on disk, one JSONL file per session, mirroring the
//! codex/claude-code layout; SQLite keeps only index rows (spec 04 §4.7).
//!
//! ```text
//! <data_dir>/sessions/<session_id>.jsonl            live transcript
//! <data_dir>/sessions/<session_id>.revisions.jsonl  regenerate branches
//! ```
//!
//! The transcript starts with a `{"type":"session",...}` header line followed
//! by one `{"type":"message",...}` line per message; `seq` is implied by line
//! order. The revisions file is append-only — one `{"type":"revision",...}`
//! line per archived branch; the active flag lives in the DB index only.
//! Readers skip unknown line types and a torn trailing line, so new line
//! kinds need no migration and a crash mid-append cannot poison the file.
//!
//! Unlike scratch dirs these files are user data: they are removed only with
//! their session, never by an age or orphan sweep.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bumped when the line format changes shape incompatibly.
pub const TRANSCRIPT_SCHEMA: i64 = 1;

/// One persisted message: the canonical block array plus promoted fields,
/// not the flat UiMessage projection (spec 04 §1 "lossless transcripts").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_error: bool,
    /// Canonical block array (text / thinking / tool_call / attachment, open set).
    pub blocks: Value,
    /// usage / modelId / providerId / status / error / revision metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Value>,
    /// RFC3339; storage keeps the wire spelling so files stay human-readable.
    pub created_at: String,
}

/// Durable model-context checkpoint. The visible message transcript remains
/// untouched; this record only changes the context reconstructed for a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionRecord {
    pub id: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_kept_message_id: Option<String>,
    pub through_message_id: String,
    pub tokens_before: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retained_tail: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub created_at: String,
}

/// One archived regenerate branch rooted at a user turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRecord {
    pub root_user_id: String,
    pub revision_index: i64,
    pub created_at: String,
    pub messages: Vec<MessageRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionHeader {
    schema: i64,
    session_id: String,
    created_at: String,
}

fn tagged(tag: &str, body: &impl Serialize) -> Result<String> {
    let mut value = serde_json::to_value(body)?;
    value
        .as_object_mut()
        .ok_or_else(|| anyhow!("line body must be an object"))?
        .insert("type".into(), Value::String(tag.into()));
    Ok(value.to_string())
}

/// Session ids come from our own DB (UUIDs), but stay defensive: an id that
/// could traverse out of the sessions base gets no file at all.
fn safe_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn base_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("sessions")
}

fn path_for(data_dir: &Path, session_id: &str, suffix: &str) -> Result<PathBuf> {
    if !safe_session_id(session_id) {
        return Err(anyhow!("invalid session id: {session_id:?}"));
    }
    Ok(base_dir(data_dir).join(format!("{session_id}{suffix}")))
}

pub fn transcript_path(data_dir: &Path, session_id: &str) -> Result<PathBuf> {
    path_for(data_dir, session_id, ".jsonl")
}

pub fn revisions_path(data_dir: &Path, session_id: &str) -> Result<PathBuf> {
    path_for(data_dir, session_id, ".revisions.jsonl")
}

/// Durable single-line append shared by transcript and revision writers.
/// `header` is written first when the file does not exist yet.
fn append_line(path: &Path, header: Option<String>, line: String) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let fresh = !path.exists();
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let mut buf = String::new();
    if fresh {
        if let Some(header) = header {
            buf.push_str(&header);
            buf.push('\n');
        }
    }
    buf.push_str(&line);
    buf.push('\n');
    file.write_all(buf.as_bytes())?;
    file.flush()?;
    // Message durability matches the DB's WAL synchronous=NORMAL guarantees.
    file.sync_data()?;
    Ok(())
}

fn header_line(session_id: &str, session_created_at: &str) -> Result<String> {
    tagged(
        "session",
        &SessionHeader {
            schema: TRANSCRIPT_SCHEMA,
            session_id: session_id.to_string(),
            created_at: session_created_at.to_string(),
        },
    )
}

/// Append one message to the live transcript, creating the file (with its
/// session header) on first write.
pub fn append_message(
    data_dir: &Path,
    session_id: &str,
    session_created_at: &str,
    record: &MessageRecord,
) -> Result<()> {
    let path = transcript_path(data_dir, session_id)?;
    append_line(
        &path,
        Some(header_line(session_id, session_created_at)?),
        tagged("message", record)?,
    )
    .with_context(|| format!("append transcript {}", path.display()))
}

/// Append a model-context checkpoint without rewriting visible messages.
pub fn append_compaction(
    data_dir: &Path,
    session_id: &str,
    session_created_at: &str,
    record: &CompactionRecord,
) -> Result<()> {
    let path = transcript_path(data_dir, session_id)?;
    append_line(
        &path,
        Some(header_line(session_id, session_created_at)?),
        tagged("compaction", record)?,
    )
    .with_context(|| format!("append compaction {}", path.display()))
}

/// Load the live transcript. A missing file is an empty transcript; unknown
/// line types and a torn trailing line are skipped, not errors.
pub fn read_transcript(data_dir: &Path, session_id: &str) -> Result<Vec<MessageRecord>> {
    let path = transcript_path(data_dir, session_id)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            tracing::warn!(path = %path.display(), "skipping unparseable transcript line");
            continue;
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("message") {
            continue;
        }
        match serde_json::from_value::<MessageRecord>(value) {
            Ok(record) => out.push(record),
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "skipping invalid message line");
            }
        }
    }
    Ok(out)
}

/// Return the newest valid compaction checkpoint. Unknown/torn records are
/// ignored using the same forward-compatible policy as message reads.
pub fn read_latest_compaction(
    data_dir: &Path,
    session_id: &str,
) -> Result<Option<CompactionRecord>> {
    let path = transcript_path(data_dir, session_id)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let mut latest = None;
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("compaction") {
            continue;
        }
        match serde_json::from_value::<CompactionRecord>(value) {
            Ok(record) => latest = Some(record),
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "skipping invalid compaction line");
            }
        }
    }
    Ok(latest)
}

/// Atomically replace the live transcript (compaction, revision switch,
/// import): write a sibling temp file, fsync, rename over the target.
pub fn write_transcript(
    data_dir: &Path,
    session_id: &str,
    session_created_at: &str,
    records: &[MessageRecord],
) -> Result<()> {
    write_transcript_with_compaction(data_dir, session_id, session_created_at, records, None)
}

/// Atomically replace visible messages and optionally retain one current
/// context checkpoint. Rewrites intentionally collapse older checkpoints.
pub fn write_transcript_with_compaction(
    data_dir: &Path,
    session_id: &str,
    session_created_at: &str,
    records: &[MessageRecord],
    compaction: Option<&CompactionRecord>,
) -> Result<()> {
    let path = transcript_path(data_dir, session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("jsonl.tmp");
    {
        let file = File::create(&tmp)?;
        let mut writer = BufWriter::new(file);
        writer.write_all(header_line(session_id, session_created_at)?.as_bytes())?;
        writer.write_all(b"\n")?;
        for record in records {
            writer.write_all(tagged("message", record)?.as_bytes())?;
            writer.write_all(b"\n")?;
        }
        if let Some(record) = compaction {
            writer.write_all(tagged("compaction", record)?.as_bytes())?;
            writer.write_all(b"\n")?;
        }
        writer.flush()?;
        writer.get_ref().sync_data()?;
    }
    swap_into_place(&tmp, &path)
}

/// Swap a fully written temp file over its target. Windows cannot rename over
/// an existing file (D010: Windows post-MVP); on POSIX the plain rename keeps
/// the replacement atomic.
fn swap_into_place(tmp: &Path, path: &Path) -> Result<()> {
    #[cfg(windows)]
    let _ = fs::remove_file(path);
    fs::rename(tmp, path).with_context(|| format!("replace {}", path.display()))?;
    Ok(())
}

/// Rewrite exactly one message line, copying every other line through
/// verbatim. Returns false when the id is not in the file.
///
/// The file is re-read here instead of being handed in by the caller, so a line
/// appended between the caller's own read and this write survives. That is the
/// difference that matters: a metadata stamp must never cost the transcript its
/// newest messages the way a full `write_transcript` from a stale snapshot does.
pub fn update_message(data_dir: &Path, session_id: &str, record: &MessageRecord) -> Result<bool> {
    let path = transcript_path(data_dir, session_id)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let replacement = tagged("message", record)?;
    let mut body = String::with_capacity(raw.len() + replacement.len());
    let mut replaced = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        let is_target = !trimmed.is_empty()
            && serde_json::from_str::<Value>(trimmed).is_ok_and(|value| {
                value.get("type").and_then(Value::as_str) == Some("message")
                    && value.get("id").and_then(Value::as_str) == Some(record.id.as_str())
            });
        // A retried append can leave the same id on two lines; keep-last dedupe
        // means every copy has to carry the new metadata.
        if is_target {
            body.push_str(&replacement);
            replaced = true;
        } else {
            body.push_str(line);
        }
        body.push('\n');
    }
    if !replaced {
        return Ok(false);
    }
    let tmp = path.with_extension("jsonl.tmp");
    {
        let file = File::create(&tmp)?;
        let mut writer = BufWriter::new(file);
        writer.write_all(body.as_bytes())?;
        writer.flush()?;
        writer.get_ref().sync_data()?;
    }
    swap_into_place(&tmp, &path)?;
    Ok(true)
}

/// Append one archived branch. The file is append-only: the active revision
/// flag lives in the DB index, so switching revisions never rewrites it.
pub fn append_revision(data_dir: &Path, session_id: &str, record: &RevisionRecord) -> Result<()> {
    let path = revisions_path(data_dir, session_id)?;
    append_line(&path, None, tagged("revision", record)?)
        .with_context(|| format!("append revisions {}", path.display()))
}

/// Find one archived branch by its family key and index (linear scan; the
/// file holds at most a handful of branches per root). The LAST match wins:
/// a crash between file append and index commit can leave a duplicate index
/// on disk, and the newest line is the one the DB accepted.
pub fn read_revision(
    data_dir: &Path,
    session_id: &str,
    root_user_id: &str,
    revision_index: i64,
) -> Result<Option<RevisionRecord>> {
    let path = revisions_path(data_dir, session_id)?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let mut found = None;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("revision") {
            continue;
        }
        let Ok(record) = serde_json::from_value::<RevisionRecord>(value) else {
            continue;
        };
        if record.root_user_id == root_user_id && record.revision_index == revision_index {
            found = Some(record);
        }
    }
    Ok(found)
}

/// Remove a session's transcript, revisions, and any temp leftover
/// (idempotent, best-effort). Called only from session deletion — transcript
/// files are user data and have no age/orphan sweep.
pub fn remove_session_files(data_dir: &Path, session_id: &str) {
    let Ok(transcript) = transcript_path(data_dir, session_id) else {
        return;
    };
    let Ok(revisions) = revisions_path(data_dir, session_id) else {
        return;
    };
    for path in [
        transcript.with_extension("jsonl.tmp"),
        transcript,
        revisions,
    ] {
        if let Err(error) = fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = %path.display(), %error, "transcript cleanup failed");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    fn record(id: &str, text: &str) -> MessageRecord {
        MessageRecord {
            id: id.into(),
            role: "user".into(),
            tool_name: None,
            is_error: false,
            blocks: json!([{ "type": "text", "text": text }]),
            meta: None,
            created_at: "2026-07-26T00:00:00.000Z".into(),
        }
    }

    fn compaction() -> CompactionRecord {
        CompactionRecord {
            id: "compact-1".into(),
            summary: "summary".into(),
            first_kept_message_id: Some("m1".into()),
            through_message_id: "m2".into(),
            tokens_before: 42_000,
            usage: Some(json!({ "input": 100, "output": 20 })),
            retained_tail: Some(json!([{ "role": "user", "content": "again", "timestamp": 1 }])),
            details: None,
            provider_id: Some("provider-1".into()),
            model_id: Some("model-1".into()),
            created_at: "2026-07-26T00:00:02Z".into(),
        }
    }

    #[test]
    fn rejects_unsafe_session_ids() {
        let dir = tempdir().unwrap();
        assert!(transcript_path(dir.path(), "../evil").is_err());
        assert!(transcript_path(dir.path(), "a/b").is_err());
        assert!(transcript_path(dir.path(), "").is_err());
        assert!(transcript_path(dir.path(), "0b0e9a52-1_ok").is_ok());
    }

    #[test]
    fn append_creates_header_then_lines() {
        let dir = tempdir().unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("m1", "hi"),
        )
        .unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("m2", "again"),
        )
        .unwrap();

        let raw = fs::read_to_string(transcript_path(dir.path(), "s1").unwrap()).unwrap();
        let lines: Vec<&str> = raw.lines().collect();
        assert_eq!(lines.len(), 3);
        let header: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(header["type"], "session");
        assert_eq!(header["schema"], TRANSCRIPT_SCHEMA);
        assert_eq!(header["sessionId"], "s1");

        let loaded = read_transcript(dir.path(), "s1").unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "m1");
        assert_eq!(loaded[1].id, "m2");
    }

    #[test]
    fn read_skips_torn_tail_and_unknown_lines() {
        let dir = tempdir().unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("m1", "ok"),
        )
        .unwrap();
        let path = transcript_path(dir.path(), "s1").unwrap();
        let mut raw = fs::read_to_string(&path).unwrap();
        raw.push_str("{\"type\":\"future-kind\",\"x\":1}\n");
        raw.push_str("{\"type\":\"message\",\"id\":\"torn"); // crash mid-append
        fs::write(&path, raw).unwrap();

        let loaded = read_transcript(dir.path(), "s1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "m1");
    }

    #[test]
    fn compaction_roundtrips_without_hiding_messages() {
        let dir = tempdir().unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("m1", "hi"),
        )
        .unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("m2", "again"),
        )
        .unwrap();
        append_compaction(dir.path(), "s1", "2026-07-26T00:00:00Z", &compaction()).unwrap();

        assert_eq!(read_transcript(dir.path(), "s1").unwrap().len(), 2);
        let restored = read_latest_compaction(dir.path(), "s1").unwrap().unwrap();
        assert_eq!(restored.id, "compact-1");
        assert_eq!(restored.through_message_id, "m2");
        assert_eq!(restored.tokens_before, 42_000);
    }

    #[test]
    fn missing_file_is_empty_transcript() {
        let dir = tempdir().unwrap();
        assert!(read_transcript(dir.path(), "nope").unwrap().is_empty());
        assert!(read_revision(dir.path(), "nope", "u1", 1)
            .unwrap()
            .is_none());
    }

    #[test]
    fn write_transcript_replaces_content() {
        let dir = tempdir().unwrap();
        append_message(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &record("old", "gone"),
        )
        .unwrap();
        write_transcript(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &[record("a", "one"), record("b", "two")],
        )
        .unwrap();

        let loaded = read_transcript(dir.path(), "s1").unwrap();
        assert_eq!(
            loaded.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        let raw = fs::read_to_string(transcript_path(dir.path(), "s1").unwrap()).unwrap();
        assert!(raw.starts_with("{\""));
        assert!(!raw.contains("gone"));
        assert!(!transcript_path(dir.path(), "s1")
            .unwrap()
            .with_extension("jsonl.tmp")
            .exists());
    }

    #[test]
    fn rewrite_can_preserve_only_the_latest_compaction() {
        let dir = tempdir().unwrap();
        write_transcript_with_compaction(
            dir.path(),
            "s1",
            "2026-07-26T00:00:00Z",
            &[record("m1", "one"), record("m2", "two")],
            Some(&compaction()),
        )
        .unwrap();

        assert_eq!(read_transcript(dir.path(), "s1").unwrap().len(), 2);
        assert_eq!(
            read_latest_compaction(dir.path(), "s1")
                .unwrap()
                .unwrap()
                .summary,
            "summary"
        );
    }

    #[test]
    fn revisions_roundtrip_by_root_and_index() {
        let dir = tempdir().unwrap();
        let rev = |i: i64, text: &str| RevisionRecord {
            root_user_id: "u1".into(),
            revision_index: i,
            created_at: "2026-07-26T00:00:00Z".into(),
            messages: vec![record("m", text)],
        };
        append_revision(dir.path(), "s1", &rev(1, "first")).unwrap();
        append_revision(dir.path(), "s1", &rev(2, "second")).unwrap();

        let found = read_revision(dir.path(), "s1", "u1", 2).unwrap().unwrap();
        assert_eq!(found.messages[0].blocks[0]["text"], "second");
        assert!(read_revision(dir.path(), "s1", "u9", 1).unwrap().is_none());
        assert!(read_revision(dir.path(), "s1", "u1", 3).unwrap().is_none());
    }

    #[test]
    fn remove_is_idempotent_and_clears_both_files() {
        let dir = tempdir().unwrap();
        append_message(dir.path(), "s1", "2026-07-26T00:00:00Z", &record("m1", "x")).unwrap();
        append_revision(
            dir.path(),
            "s1",
            &RevisionRecord {
                root_user_id: "u1".into(),
                revision_index: 1,
                created_at: "2026-07-26T00:00:00Z".into(),
                messages: vec![record("m", "x")],
            },
        )
        .unwrap();

        remove_session_files(dir.path(), "s1");
        assert!(!transcript_path(dir.path(), "s1").unwrap().exists());
        assert!(!revisions_path(dir.path(), "s1").unwrap().exists());
        remove_session_files(dir.path(), "s1");
    }
}
