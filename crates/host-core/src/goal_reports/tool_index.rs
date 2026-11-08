//! Durable tool messages of one execution, read once per submit or finalize.
//!
//! Check observations used to re-read the whole transcript and re-run the
//! message query for every check. [`ToolRunIndex`] does both once; lookups
//! after that work on memory and only see the messages of the turns the
//! execution owns.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::transcripts::{self, MessageRecord};

#[cfg(test)]
thread_local! {
    static BUILDS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Number of indexes built on this thread; tests use it to prove that many
/// checks share one transcript read.
#[cfg(test)]
pub(super) fn builds() -> usize {
    BUILDS.with(std::cell::Cell::get)
}

/// The session transcript could not be read, so no tool message is known.
pub(super) struct TranscriptUnreadable;

/// What the message index records about one tool message.
struct IndexRow {
    turn: Option<String>,
    is_error: bool,
    seq: i64,
}

/// A transcript line the Host indexed with role `tool`.
struct ToolMessage {
    record: MessageRecord,
    /// `messages.seq` of the indexed row.
    seq: i64,
    /// `messages.is_error` of the indexed row, separate from the line's flag.
    index_error: bool,
}

pub(super) struct ToolRunIndex {
    messages: Vec<ToolMessage>,
}

/// Outcome of resolving one evidence reference.
pub(super) enum Lookup<'a> {
    Missing,
    /// Exactly one durable message names the reference.
    Unique(ToolCall<'a>),
    /// Several durable messages name it; the Host never guesses between them.
    Ambiguous,
}

/// One `tool_call` block of a durable message.
pub(super) struct ToolCall<'a> {
    message: &'a ToolMessage,
    block: &'a Value,
}

/// What a tool call recorded about how it ended.
pub(super) struct RecordedOutcome {
    /// Native integer exit code; anything else is not an exit code.
    pub(super) exit_code: Option<i64>,
    pub(super) is_error: bool,
    pub(super) succeeded: bool,
}

impl ToolRunIndex {
    /// Indexes the tool messages the Host recorded up to `durable_seq` for the
    /// turns in `owning_turns`; everything else in the session stays invisible.
    pub(super) fn build(
        data_dir: &Path,
        conn: &Connection,
        session_id: &str,
        durable_seq: i64,
        owning_turns: &HashSet<String>,
    ) -> Result<Self, TranscriptUnreadable> {
        #[cfg(test)]
        BUILDS.with(|builds| builds.set(builds.get() + 1));
        let indexed = indexed_tool_messages(conn, session_id, durable_seq);
        let records = transcripts::read_transcript(data_dir, session_id).map_err(|error| {
            tracing::warn!(%error, session_id, "goal report: transcript is unreadable");
            TranscriptUnreadable
        })?;
        let messages = records
            .into_iter()
            .filter_map(|record| {
                let row = indexed.get(&record.id)?;
                let owned = row
                    .turn
                    .as_ref()
                    .is_some_and(|turn| owning_turns.contains(turn));
                (record.role == "tool" && owned).then_some(ToolMessage {
                    seq: row.seq,
                    index_error: row.is_error,
                    record,
                })
            })
            .collect();
        Ok(Self { messages })
    }

    /// Resolves a reference to a tool call by its call id or by the id of the
    /// message that holds it.
    pub(super) fn lookup(&self, ref_id: &str) -> Lookup<'_> {
        let mut hits = self
            .messages
            .iter()
            .filter_map(|message| message.call_named(ref_id));
        let Some(first) = hits.next() else {
            return Lookup::Missing;
        };
        if hits.next().is_some() {
            return Lookup::Ambiguous;
        }
        Lookup::Unique(first)
    }

    /// The Bash calls whose command equals `command` once both are trimmed,
    /// oldest first.
    pub(super) fn bash_runs(&self, command: &str) -> Vec<ToolCall<'_>> {
        let wanted = command.trim();
        let mut runs: Vec<ToolCall<'_>> = self
            .messages
            .iter()
            .flat_map(ToolMessage::calls)
            .filter(|call| {
                call.is_bash() && call.command().is_some_and(|text| text.trim() == wanted)
            })
            .collect();
        runs.sort_by_key(ToolCall::seq);
        runs
    }
}

/// Message id -> index row of the tool messages up to `durable_seq`. A failed
/// query leaves the index empty, which only ever makes checks inconclusive.
fn indexed_tool_messages(
    conn: &Connection,
    session_id: &str,
    durable_seq: i64,
) -> HashMap<String, IndexRow> {
    let query = || -> rusqlite::Result<_> {
        let mut statement = conn.prepare_cached(
            "SELECT id, turn_id, is_error, seq FROM messages
             WHERE session_id = ?1 AND seq <= ?2 AND role = 'tool'",
        )?;
        let rows = statement.query_map(params![session_id, durable_seq], |row| {
            let index_row = IndexRow {
                turn: row.get(1)?,
                is_error: row.get(2)?,
                seq: row.get(3)?,
            };
            Ok((row.get::<_, String>(0)?, index_row))
        })?;
        Ok(rows.filter_map(Result::ok).collect())
    };
    query().unwrap_or_else(|error| {
        tracing::warn!(%error, session_id, "goal report: tool message index query failed");
        Default::default()
    })
}

impl ToolMessage {
    fn calls(&self) -> impl Iterator<Item = ToolCall<'_>> {
        let blocks = self.record.blocks.as_array().into_iter().flatten();
        blocks
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_call"))
            .map(move |block| ToolCall {
                message: self,
                block,
            })
    }

    /// The first tool call that `ref_id` names, either by its call id or by
    /// this message's own id.
    fn call_named(&self, ref_id: &str) -> Option<ToolCall<'_>> {
        self.calls()
            .find(|call| call.call_id() == Some(ref_id) || self.record.id == ref_id)
    }
}

impl ToolCall<'_> {
    fn seq(&self) -> i64 {
        self.message.seq
    }

    /// Whether both handles name the same block of the same message.
    pub(super) fn is_same_call(&self, other: &ToolCall<'_>) -> bool {
        std::ptr::eq(self.block, other.block)
    }

    fn call_id(&self) -> Option<&str> {
        self.block.get("callId").and_then(Value::as_str)
    }

    /// The call id, or the message id when the block carries none: a name a
    /// reader can find in the transcript.
    pub(super) fn id(&self) -> &str {
        self.call_id().unwrap_or(&self.message.record.id)
    }

    /// Both the block and the message that holds it must name Bash.
    pub(super) fn is_bash(&self) -> bool {
        self.block.get("name").and_then(Value::as_str) == Some("Bash")
            && self.message.record.tool_name.as_deref() == Some("Bash")
    }

    pub(super) fn command(&self) -> Option<&str> {
        self.block
            .get("args")
            .and_then(|args| args.get("command"))
            .and_then(Value::as_str)
    }

    /// `None` when the block never recorded a result.
    pub(super) fn outcome(&self) -> Option<RecordedOutcome> {
        let result = self.block.get("result")?;
        // AgentToolResult stores native Bash facts in details. Older records
        // contain the bare Host result. Never parse the model-visible text.
        let native = if result.get("content").is_some() {
            result.get("details").filter(|details| details.is_object())
        } else {
            Some(result)
        };
        let exit_code = native
            .and_then(|value| value.get("exitCode"))
            .and_then(Value::as_i64);
        let flagged = |value: &Value| {
            value
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };
        let status = self.block.get("status").and_then(Value::as_str);
        let is_error = self.message.record.is_error
            || self.message.index_error
            || flagged(result)
            || flagged(self.block)
            || status.is_some_and(|status| matches!(status, "error" | "failed"));
        Some(RecordedOutcome {
            exit_code,
            is_error,
            succeeded: status == Some("success"),
        })
    }
}
