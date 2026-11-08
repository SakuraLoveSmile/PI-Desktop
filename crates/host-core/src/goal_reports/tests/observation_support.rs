//! Shared fixtures of the Goal report check observation tests: an execution
//! with finished turns, durable Bash messages written the way the Host writes
//! them, and the observation text a check is expected to get.

use super::native_evidence::wrapped_result;
use super::*;
use crate::transcripts::MessageRecord;

pub(super) use evidence::GoalReportCheckObservation as Observation;

pub(super) const SESSION: &str = "observe-session";
pub(super) const EXECUTION: &str = "observe-execution";
pub(super) const COMMAND: &str = "cargo test";
pub(super) const DURABLE_SEQ: i64 = 100;

/// The expected result, exit code and detail of one observation.
#[derive(Clone)]
pub(super) struct Verdict {
    result: &'static str,
    exit_code: Option<i64>,
    detail: String,
}

impl Verdict {
    fn new(result: &'static str, exit_code: Option<i64>, detail: &str) -> Self {
        let detail = detail.to_string();
        Self {
            result,
            exit_code,
            detail,
        }
    }

    /// A recorded integer exit code: zero passes, anything else fails.
    pub(super) fn exit(code: i64) -> Self {
        let detail = match code {
            0 => "Command exit code was recorded by the durable tool result.".to_string(),
            _ => format!("Command exit code {code} was recorded by the durable tool result."),
        };
        Self::new(
            if code == 0 { "passed" } else { "failed" },
            Some(code),
            &detail,
        )
    }

    pub(super) fn error(exit_code: Option<i64>) -> Self {
        Self::new(
            "failed",
            exit_code,
            "Durable tool result recorded an error.",
        )
    }

    pub(super) fn success_only() -> Self {
        let detail = "Durable tool result recorded successful completion.";
        Self::new("passed", None, detail)
    }

    fn inconclusive(detail: &str) -> Self {
        Self::new("inconclusive", None, detail)
    }

    /// Only references may settle the check and none led to a judged run.
    pub(super) fn unmatched() -> Self {
        Self::inconclusive("No durable tool result matched the check evidence.")
    }

    pub(super) fn ambiguous() -> Self {
        Self::inconclusive("Tool evidence identity matches multiple durable results in this execution; use a unique durable message ID.")
    }

    pub(super) fn no_command() -> Self {
        Self::inconclusive("Check command is missing; durable command identity cannot be verified.")
    }

    pub(super) fn unreadable() -> Self {
        Self::inconclusive("Durable tool result could not be read from the session transcript.")
    }

    /// The check's command never ran in this execution.
    pub(super) fn no_run() -> Self {
        Self::inconclusive("No durable Bash run of the check command was found in this execution.")
    }

    /// The command ran, but no run recorded how it ended.
    pub(super) fn unfinished(runs: usize) -> Self {
        match runs {
            1 => Self::inconclusive("The durable Bash run of the check command in this execution did not record how it ended."),
            _ => Self::inconclusive(&format!("None of the {runs} durable Bash runs of the check command in this execution recorded how it ended.")),
        }
    }

    /// Found by the check command; `rank` says which finished run decided.
    pub(super) fn by_command(self, call_id: &str, rank: &str) -> Self {
        let basis = &self.detail;
        let detail = format!(
            "{basis} Matched by the check command: tool call {call_id} is {rank} in this execution."
        );
        Self { detail, ..self }
    }

    /// Found by the check command, which replaced the run the check cited.
    pub(super) fn replacing(self, cited_call: &str, cited_result: &str) -> Self {
        let sentence = self.detail.trim_end_matches('.');
        let detail =
            format!("{sentence} and replaces the cited tool call {cited_call} ({cited_result}).");
        Self { detail, ..self }
    }
}

/// How the deciding run ranks among the finished runs of a command.
pub(super) const ONLY_RUN: &str = "its only finished run";

pub(super) fn last_of(finished: usize) -> String {
    format!("the last of its {finished} finished runs")
}

pub(super) struct Fixture {
    pub(super) _dir: tempfile::TempDir,
    pub(super) db: Database,
    /// The turn bound to the execution, the only one the observations read.
    pub(super) bound: String,
    /// A finished turn of the same session that the execution does not own.
    pub(super) other: String,
}

pub(super) fn fixture() -> Fixture {
    let (dir, db) = create_test_db();
    seed_goal_execution(&db, SESSION, EXECUTION);
    let bound = crate::sessions::begin_turn(&db, SESSION, None, None).unwrap();
    bind_execution_turn(&db, EXECUTION, &bound).unwrap();
    crate::sessions::end_turn(&db, &bound, "completed", None, None, false).unwrap();
    let other = crate::sessions::begin_turn(&db, SESSION, None, None).unwrap();
    crate::sessions::end_turn(&db, &other, "completed", None, None, false).unwrap();
    Fixture {
        _dir: dir,
        db,
        bound,
        other,
    }
}

impl Fixture {
    /// Stores one Bash message that holds one call, the way the Host records
    /// it. `ids` is the message id and the call id.
    pub(super) fn ran_as(
        &self,
        turn: Option<&str>,
        seq: i64,
        ids: (&str, &str),
        command: &str,
        run: Run,
    ) {
        let (message_id, call_id) = ids;
        let mut block = call(call_id, "Bash", command, run.result, run.status);
        if run.block_error {
            block["isError"] = json!(true);
        }
        let mut record = tool_record(message_id, "Bash", vec![block]);
        record.is_error = run.record_error;
        store_indexed(&self.db, seq, turn, "tool", run.index_error, &record);
    }

    /// A Bash call in `turn` whose message id is its call id.
    pub(super) fn ran_in(
        &self,
        turn: Option<&str>,
        seq: i64,
        call_id: &str,
        command: &str,
        run: Run,
    ) {
        self.ran_as(turn, seq, (call_id, call_id), command, run);
    }

    /// A Bash call in this execution's own turn that exited with `code`.
    pub(super) fn ran(&self, seq: i64, call_id: &str, command: &str, code: i64) {
        let turn = Some(self.bound.as_str());
        self.ran_in(turn, seq, call_id, command, Run::exit(code));
    }
}

/// One tool_call block; an empty status leaves the field out.
pub(super) fn call(
    call_id: &str,
    name: &str,
    command: &str,
    result: Option<Value>,
    status: &str,
) -> Value {
    let mut block = json!({
        "type": "tool_call", "callId": call_id, "name": name, "args": {"command": command}
    });
    if let Some(result) = result {
        block["result"] = result;
    }
    if !status.is_empty() {
        block["status"] = json!(status);
    }
    block
}

pub(super) fn tool_record(id: &str, tool_name: &str, blocks: Vec<Value>) -> MessageRecord {
    MessageRecord {
        id: id.to_string(),
        role: "tool".to_string(),
        tool_name: Some(tool_name.to_string()),
        is_error: false,
        blocks: Value::Array(blocks),
        meta: None,
        created_at: "2026-11-08T00:00:00Z".to_string(),
    }
}

/// A successful Bash message whose call id differs from its message id.
pub(super) fn bash(id: &str, call_id: &str, command: &str) -> MessageRecord {
    let block = call(
        call_id,
        "Bash",
        command,
        Some(wrapped_result(json!(0))),
        "success",
    );
    tool_record(id, "Bash", vec![block])
}

pub(super) fn write_transcript(db: &Database, record: &MessageRecord) {
    crate::transcripts::append_message(db.data_dir(), SESSION, "2026-11-08T00:00:00Z", record)
        .unwrap();
}

/// Persists a message the way the Host does: a transcript line plus an index
/// row whose role and error flag may deliberately disagree with the line.
pub(super) fn store_indexed(
    db: &Database,
    seq: i64,
    turn: Option<&str>,
    index_role: &str,
    index_error: bool,
    record: &MessageRecord,
) {
    write_transcript(db, record);
    db.conn()
        .execute(
            "INSERT INTO messages (id, session_id, turn_id, seq, role, tool_name, is_error, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1000)",
            params![record.id, SESSION, turn, seq, index_role, record.tool_name, index_error],
        )
        .unwrap();
}

pub(super) fn store(db: &Database, seq: i64, turn: Option<&str>, record: &MessageRecord) {
    store_indexed(db, seq, turn, &record.role, record.is_error, record);
}

pub(super) fn evidence_entry(id: &str, kind: &str, ref_id: &str) -> Value {
    json!({"id": id, "kind": kind, "refId": ref_id, "summary": "Command result"})
}

pub(super) fn check_entry(id: &str, command: Option<&str>, refs: &[&str]) -> Value {
    let mut check = json!({"id": id, "result": "passed", "evidenceRefs": refs});
    if let Some(command) = command {
        check["command"] = json!(command);
    }
    check
}

pub(super) fn draft_of(evidences: Vec<Value>, checks: Vec<Value>) -> Value {
    json!({"summary": "Observed", "verdict": "met", "evidences": evidences, "checks": checks})
}

pub(super) fn want(
    check_id: &str,
    command: Option<&str>,
    refs: &[&str],
    verdict: &Verdict,
) -> Observation {
    Observation {
        check_id: check_id.to_string(),
        result: verdict.result.to_string(),
        command: command.map(str::to_string),
        exit_code: verdict.exit_code,
        evidence_ids: refs.iter().map(|id| id.to_string()).collect(),
        detail: Some(verdict.detail.clone()),
    }
}

/// Bound Goals: only the Bash run a check cites, inside this execution's turns.
pub(super) fn bound(fx: &Fixture, draft: &Value) -> Vec<Observation> {
    evidence::execution_check_observations(&fx.db, SESSION, EXECUTION, DURABLE_SEQ, draft).unwrap()
}

/// Unbound Goals: the cited run, then the check's own command.
pub(super) fn unbound(fx: &Fixture, draft: &Value) -> Vec<Observation> {
    evidence::unbound_check_observations(&fx.db, SESSION, EXECUTION, DURABLE_SEQ, draft).unwrap()
}

pub(super) fn assert_rows(label: &str, rows: &[Observation], expected: &[Observation]) {
    assert_eq!(rows.len(), expected.len(), "{label}: observation count");
    for (row, want) in rows.iter().zip(expected) {
        assert_eq!(row, want, "{label}: check {}", want.check_id);
    }
}

/// How one durable Bash message recorded its outcome.
pub(super) struct Run {
    result: Option<Value>,
    status: &'static str,
    block_error: bool,
    record_error: bool,
    index_error: bool,
}

impl Run {
    pub(super) fn recorded(result: Value) -> Self {
        Self {
            result: Some(result),
            status: "success",
            block_error: false,
            record_error: false,
            index_error: false,
        }
    }

    /// A native Bash result that exited with `code`.
    pub(super) fn exit(code: i64) -> Self {
        Self::recorded(wrapped_result(json!(code)))
    }

    pub(super) fn no_result() -> Self {
        Self {
            result: None,
            ..Self::recorded(Value::Null)
        }
    }

    pub(super) fn status(self, status: &'static str) -> Self {
        Self { status, ..self }
    }

    pub(super) fn block_error(self) -> Self {
        Self {
            block_error: true,
            ..self
        }
    }

    pub(super) fn record_error(self) -> Self {
        Self {
            record_error: true,
            ..self
        }
    }

    pub(super) fn index_error(self) -> Self {
        Self {
            index_error: true,
            ..self
        }
    }
}
