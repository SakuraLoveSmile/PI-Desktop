//! How Goal report check observations resolve evidence references to durable
//! Bash results. Every case asserts the full observation (result, exitCode,
//! detail and evidenceIds) so the observation code can be restructured
//! without changing what a report says.

use super::native_evidence::wrapped_result;
use super::*;
use crate::transcripts::MessageRecord;
use evidence::GoalReportCheckObservation as Observation;

const SESSION: &str = "observe-session";
const EXECUTION: &str = "observe-execution";
const COMMAND: &str = "cargo test";
const DURABLE_SEQ: i64 = 100;

/// The expected result, exit code and detail of one observation.
#[derive(Clone)]
struct Verdict {
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
    fn exit(code: i64) -> Self {
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

    fn error(exit_code: Option<i64>) -> Self {
        Self::new(
            "failed",
            exit_code,
            "Durable tool result recorded an error.",
        )
    }

    fn success_only() -> Self {
        let detail = "Durable tool result recorded successful completion.";
        Self::new("passed", None, detail)
    }

    fn inconclusive(detail: &str) -> Self {
        Self::new("inconclusive", None, detail)
    }

    fn unmatched() -> Self {
        Self::inconclusive("No durable tool result matched the check evidence.")
    }

    fn ambiguous() -> Self {
        Self::inconclusive("Tool evidence identity matches multiple durable results in this execution; use a unique durable message ID.")
    }

    fn no_command() -> Self {
        Self::inconclusive("Check command is missing; durable command identity cannot be verified.")
    }

    fn unreadable() -> Self {
        Self::inconclusive("Durable tool result could not be read from the session transcript.")
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    db: Database,
    /// The turn bound to the execution, the only one the scoped path reads.
    bound: String,
    /// A finished turn of the same session that the execution does not own.
    other: String,
}

fn fixture() -> Fixture {
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

/// One tool_call block; an empty status leaves the field out.
fn call(call_id: &str, name: &str, command: &str, result: Option<Value>, status: &str) -> Value {
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

fn tool_record(id: &str, tool_name: &str, blocks: Vec<Value>) -> MessageRecord {
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
fn bash(id: &str, call_id: &str, command: &str) -> MessageRecord {
    let block = call(
        call_id,
        "Bash",
        command,
        Some(wrapped_result(json!(0))),
        "success",
    );
    tool_record(id, "Bash", vec![block])
}

fn write_transcript(db: &Database, record: &MessageRecord) {
    crate::transcripts::append_message(db.data_dir(), SESSION, "2026-11-08T00:00:00Z", record)
        .unwrap();
}

/// Persists a message the way the Host does: a transcript line plus an index
/// row whose role and error flag may deliberately disagree with the line.
fn store_indexed(
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

fn store(db: &Database, seq: i64, turn: Option<&str>, record: &MessageRecord) {
    store_indexed(db, seq, turn, &record.role, record.is_error, record);
}

fn evidence_entry(id: &str, kind: &str, ref_id: &str) -> Value {
    json!({"id": id, "kind": kind, "refId": ref_id, "summary": "Command result"})
}

fn check_entry(id: &str, command: Option<&str>, refs: &[&str]) -> Value {
    let mut check = json!({"id": id, "result": "passed", "evidenceRefs": refs});
    if let Some(command) = command {
        check["command"] = json!(command);
    }
    check
}

fn draft_of(evidences: Vec<Value>, checks: Vec<Value>) -> Value {
    json!({"summary": "Observed", "verdict": "met", "evidences": evidences, "checks": checks})
}

fn want(check_id: &str, command: Option<&str>, refs: &[&str], verdict: &Verdict) -> Observation {
    Observation {
        check_id: check_id.to_string(),
        result: verdict.result.to_string(),
        command: command.map(str::to_string),
        exit_code: verdict.exit_code,
        evidence_ids: refs.iter().map(|id| id.to_string()).collect(),
        detail: Some(verdict.detail.clone()),
    }
}

/// Unbound Goals: every durable tool result of the session up to durable_seq.
fn unscoped(fx: &Fixture, draft: &Value) -> Vec<Observation> {
    let (dir, conn) = (fx.db.data_dir(), fx.db.conn());
    evidence::generate_check_observations(dir, conn, SESSION, DURABLE_SEQ, draft)
}

/// Bound Goals: only this execution's own turns.
fn scoped(fx: &Fixture, draft: &Value) -> Vec<Observation> {
    evidence::execution_check_observations(&fx.db, SESSION, EXECUTION, DURABLE_SEQ, draft).unwrap()
}

fn assert_rows(label: &str, rows: &[Observation], expected: &[Observation]) {
    assert_eq!(rows.len(), expected.len(), "{label}: observation count");
    for (row, want) in rows.iter().zip(expected) {
        assert_eq!(row, want, "{label}: check {}", want.check_id);
    }
}

/// How one durable Bash message recorded its outcome.
struct Run {
    result: Option<Value>,
    status: &'static str,
    block_error: bool,
    record_error: bool,
    index_error: bool,
}

impl Run {
    fn recorded(result: Value) -> Self {
        Self {
            result: Some(result),
            status: "success",
            block_error: false,
            record_error: false,
            index_error: false,
        }
    }

    fn no_result() -> Self {
        Self {
            result: None,
            ..Self::recorded(Value::Null)
        }
    }

    fn status(self, status: &'static str) -> Self {
        Self { status, ..self }
    }

    fn block_error(self) -> Self {
        Self {
            block_error: true,
            ..self
        }
    }

    fn record_error(self) -> Self {
        Self {
            record_error: true,
            ..self
        }
    }

    fn index_error(self) -> Self {
        Self {
            index_error: true,
            ..self
        }
    }
}

#[test]
fn recorded_exit_codes_and_error_flags_decide_the_observation() {
    let fx = fixture();
    let exit = |code: i64| Run::recorded(wrapped_result(json!(code)));
    let raw = |exit_code: Value| Run::recorded(wrapped_result(exit_code));
    let envelope = |details: Value| Run::recorded(json!({"content": [], "details": details}));
    let cases = vec![
        (exit(0), Verdict::exit(0)),
        (exit(2), Verdict::exit(2)),
        (exit(-1), Verdict::exit(-1)),
        // Older records hold the bare Host result instead of the envelope.
        (Run::recorded(json!({"exitCode": 0})), Verdict::exit(0)),
        (Run::recorded(json!({"exitCode": 3})), Verdict::exit(3)),
        // Any error flag wins over a zero exit code and keeps the code.
        (exit(0).record_error(), Verdict::error(Some(0))),
        (exit(0).index_error(), Verdict::error(Some(0))),
        (exit(0).block_error(), Verdict::error(Some(0))),
        (exit(0).status("failed"), Verdict::error(Some(0))),
        (envelope(json!({})).status("error"), Verdict::error(None)),
        (
            Run::recorded(json!({"content": [], "details": {"exitCode": 0}, "isError": true})),
            Verdict::error(Some(0)),
        ),
        // Pinned, not endorsed: a result without an integer exit code but with
        // a success status is reported as passed. Whether that stays is a
        // separate decision from restructuring the observation code.
        (raw(json!(true)), Verdict::success_only()),
        (raw(json!("0")), Verdict::success_only()),
        (raw(json!(0.0)), Verdict::success_only()),
        (raw(Value::Null), Verdict::success_only()),
        (envelope(json!("not an object")), Verdict::success_only()),
        // Without a success status the same results prove nothing.
        (raw(json!(true)).status("running"), Verdict::unmatched()),
        (raw(Value::Null).status(""), Verdict::unmatched()),
        // A block that recorded no result never yields a verdict, even an
        // error one.
        (Run::no_result(), Verdict::unmatched()),
        (Run::no_result().block_error(), Verdict::unmatched()),
    ];

    let (mut evidences, mut checks, mut expected) = (Vec::new(), Vec::new(), Vec::new());
    for (index, (run, verdict)) in cases.into_iter().enumerate() {
        let call_id = format!("c-{index}");
        let (evidence_id, check_id) = (format!("ev-{index}"), format!("chk-{index}"));
        let mut block = call(&call_id, "Bash", COMMAND, run.result, run.status);
        if run.block_error {
            block["isError"] = json!(true);
        }
        let mut record = tool_record(&format!("m-{index}"), "Bash", vec![block]);
        record.is_error = run.record_error;
        let seq = i64::try_from(index).unwrap() + 1;
        let turn = Some(fx.bound.as_str());
        store_indexed(&fx.db, seq, turn, "tool", run.index_error, &record);
        evidences.push(evidence_entry(&evidence_id, "tool_result", &call_id));
        checks.push(check_entry(&check_id, Some(COMMAND), &[&evidence_id]));
        expected.push(want(&check_id, Some(COMMAND), &[&evidence_id], &verdict));
    }

    let draft = draft_of(evidences, checks);
    assert_rows("unscoped", &unscoped(&fx, &draft), &expected);
    assert_rows("scoped", &scoped(&fx, &draft), &expected);
}

#[test]
fn references_resolve_by_call_id_or_message_id_and_never_by_guess() {
    let fx = fixture();
    let exit = |code: i64| wrapped_result(json!(code));
    let bash_call =
        |call_id: &str, result: Value| call(call_id, "Bash", COMMAND, Some(result), "success");
    let records = vec![
        // Two calls in one record: a call id picks its own call, the message
        // id picks the first one.
        tool_record(
            "m-multi",
            "Bash",
            vec![
                bash_call("c-first", exit(1)),
                bash_call("c-second", exit(0)),
            ],
        ),
        // The message id of a record whose call id differs.
        bash("m-id", "c-different", COMMAND),
        // A block that is not a call in front of the call is skipped.
        tool_record(
            "m-text",
            "Bash",
            vec![
                json!({"type": "text", "text": "running"}),
                bash_call("c-after-text", exit(4)),
            ],
        ),
        // The same call id on two records is ambiguous, whatever the tools are.
        bash("m-dup-1", "c-dup", COMMAND),
        bash("m-dup-2", "c-dup", COMMAND),
        bash("m-mix-1", "c-mix", COMMAND),
        tool_record(
            "m-mix-2",
            "Read",
            vec![call("c-mix", "Read", COMMAND, Some(exit(0)), "success")],
        ),
        // A message id equal to another record's call id is ambiguous too.
        bash("x-id", "y-call", COMMAND),
        bash("z-id", "x-id", COMMAND),
        // Two calls with one call id inside a single record are one match.
        tool_record(
            "m-twice",
            "Bash",
            vec![bash_call("c-twice", exit(0)), bash_call("c-twice", exit(5))],
        ),
        bash("m-other", "c-other", "npm test"),
    ];
    for (index, record) in records.iter().enumerate() {
        let seq = i64::try_from(index).unwrap() + 1;
        store(&fx.db, seq, Some(fx.bound.as_str()), record);
    }

    let evidences = vec![
        evidence_entry("ev-first", "tool_result", "c-first"),
        evidence_entry("ev-other", "tool_result", "c-other"),
        evidence_entry("ev-dup", "tool_result", "c-dup"),
        evidence_entry("ev-second", "tool_result", "c-second"),
        evidence_entry("ev-multi", "tool_result", "m-multi"),
        evidence_entry("ev-id", "tool_result", "m-id"),
        evidence_entry("ev-text", "tool_result", "m-text"),
        evidence_entry("ev-mix", "tool_result", "c-mix"),
        evidence_entry("ev-crossed", "tool_result", "x-id"),
        evidence_entry("ev-twice", "tool_result", "c-twice"),
        evidence_entry("ev-padded", "tool_result", " c-second"),
        evidence_entry("ev-message", "message", "c-second"),
        evidence_entry("ev-call", "tool_call", "c-second"),
        json!({"id": "ev-no-ref", "kind": "tool_result", "summary": "No reference"}),
    ];
    let rows: Vec<(&str, Vec<&str>, Verdict)> = vec![
        ("by-call-id", vec!["ev-second"], Verdict::exit(0)),
        ("by-first-call-id", vec!["ev-first"], Verdict::exit(1)),
        ("message-id-picks-first", vec!["ev-multi"], Verdict::exit(1)),
        ("by-message-id", vec!["ev-id"], Verdict::exit(0)),
        ("skips-text-block", vec!["ev-text"], Verdict::exit(4)),
        ("duplicate-call-id", vec!["ev-dup"], Verdict::ambiguous()),
        ("duplicate-tools", vec!["ev-mix"], Verdict::ambiguous()),
        ("id-meets-call-id", vec!["ev-crossed"], Verdict::ambiguous()),
        ("one-record-two-calls", vec!["ev-twice"], Verdict::exit(0)),
        (
            "reference-not-trimmed",
            vec!["ev-padded"],
            Verdict::unmatched(),
        ),
        // The first evidence in the draft decides, not the order of the refs.
        (
            "draft-order-wins",
            vec!["ev-second", "ev-first"],
            Verdict::exit(1),
        ),
        // A reference to another command is skipped; the next one is tried.
        (
            "mismatch-is-skipped",
            vec!["ev-other", "ev-second"],
            Verdict::exit(0),
        ),
        // Ambiguity ends the search even when a later reference would pass.
        (
            "ambiguity-stops",
            vec!["ev-dup", "ev-second"],
            Verdict::ambiguous(),
        ),
        ("message-kind", vec!["ev-message"], Verdict::unmatched()),
        ("call-kind", vec!["ev-call"], Verdict::unmatched()),
        ("no-reference-id", vec!["ev-no-ref"], Verdict::unmatched()),
        ("no-references", vec![], Verdict::unmatched()),
        (
            "unknown-ids-echoed",
            vec!["ev-second", "ev-ghost"],
            Verdict::exit(0),
        ),
    ];

    let mut checks = Vec::new();
    let mut expected = Vec::new();
    for (id, refs, verdict) in &rows {
        checks.push(check_entry(id, Some(COMMAND), refs));
        expected.push(want(id, Some(COMMAND), refs, verdict));
    }
    // A check without an id has nothing to attach an observation to.
    checks.push(json!({"command": COMMAND, "evidenceRefs": ["ev-second"]}));

    let draft = draft_of(evidences, checks);
    assert_rows("unscoped", &unscoped(&fx, &draft), &expected);
    assert_rows("scoped", &scoped(&fx, &draft), &expected);
}

#[test]
fn only_exact_bash_results_inside_the_boundary_count() {
    let fx = fixture();
    let (bound, other) = (Some(fx.bound.as_str()), Some(fx.other.as_str()));
    let plain = |id: &str, command: &str| bash(id, id, command);
    let ok = || Some(wrapped_result(json!(0)));
    // Inside, at, and beyond the durable boundary (inclusive).
    store(&fx.db, 20, bound, &plain("b-in", COMMAND));
    store(&fx.db, DURABLE_SEQ, bound, &plain("b-edge", COMMAND));
    store(&fx.db, DURABLE_SEQ + 1, bound, &plain("b-future", COMMAND));
    // The same session, but not this execution's turns.
    store(&fx.db, 21, None, &plain("b-null-turn", COMMAND));
    store(&fx.db, 22, other, &plain("b-other-turn", COMMAND));
    // Never indexed, or indexed under another role than the transcript line.
    write_transcript(&fx.db, &plain("b-unindexed", COMMAND));
    store_indexed(
        &fx.db,
        23,
        bound,
        "assistant",
        false,
        &plain("b-index-role", COMMAND),
    );
    let mut assistant_line = plain("b-line-role", COMMAND);
    assistant_line.role = "assistant".to_string();
    store_indexed(&fx.db, 24, bound, "tool", false, &assistant_line);
    // Command identity is byte-exact, and only Bash counts on both sides.
    store(&fx.db, 25, bound, &plain("b-longer", "cargo test --locked"));
    store(&fx.db, 26, bound, &plain("b-padded", " cargo test"));
    let read_block = call("b-block-name", "Read", COMMAND, ok(), "success");
    store(
        &fx.db,
        27,
        bound,
        &tool_record("b-block-name", "Bash", vec![read_block]),
    );
    let bash_block = call("b-record-name", "Bash", COMMAND, ok(), "success");
    store(
        &fx.db,
        28,
        bound,
        &tool_record("b-record-name", "Read", vec![bash_block]),
    );

    // (check id, command, cited record, verdict). Only the first two checks
    // against another turn differ between the unbound and the bound path.
    let rows: Vec<(&str, Option<&str>, &str, Verdict)> = vec![
        ("in-turn", Some(COMMAND), "b-in", Verdict::exit(0)),
        ("at-boundary", Some(COMMAND), "b-edge", Verdict::exit(0)),
        (
            "beyond-boundary",
            Some(COMMAND),
            "b-future",
            Verdict::unmatched(),
        ),
        ("no-turn", Some(COMMAND), "b-null-turn", Verdict::exit(0)),
        (
            "other-turn",
            Some(COMMAND),
            "b-other-turn",
            Verdict::exit(0),
        ),
        (
            "unindexed",
            Some(COMMAND),
            "b-unindexed",
            Verdict::unmatched(),
        ),
        (
            "index-role",
            Some(COMMAND),
            "b-index-role",
            Verdict::unmatched(),
        ),
        (
            "line-role",
            Some(COMMAND),
            "b-line-role",
            Verdict::unmatched(),
        ),
        (
            "longer-command",
            Some(COMMAND),
            "b-longer",
            Verdict::unmatched(),
        ),
        (
            "padded-record",
            Some(COMMAND),
            "b-padded",
            Verdict::unmatched(),
        ),
        // The check's own command is compared as written, whitespace included.
        (
            "padded-check",
            Some(" cargo test"),
            "b-padded",
            Verdict::exit(0),
        ),
        (
            "block-name",
            Some(COMMAND),
            "b-block-name",
            Verdict::unmatched(),
        ),
        (
            "record-name",
            Some(COMMAND),
            "b-record-name",
            Verdict::unmatched(),
        ),
        // A missing command is decided before any reference is looked at.
        ("no-command", None, "b-in", Verdict::no_command()),
        ("blank-command", Some("   "), "b-in", Verdict::no_command()),
    ];

    let mut evidences = Vec::new();
    let (mut checks, mut unscoped_rows, mut scoped_rows) = (Vec::new(), Vec::new(), Vec::new());
    for (id, command, record, verdict) in &rows {
        let evidence_id = format!("ev-{id}");
        evidences.push(evidence_entry(&evidence_id, "tool_result", record));
        checks.push(check_entry(id, *command, &[&evidence_id]));
        unscoped_rows.push(want(id, *command, &[&evidence_id], verdict));
        let owned = !matches!(*id, "no-turn" | "other-turn");
        let scoped_verdict = if owned {
            verdict.clone()
        } else {
            Verdict::unmatched()
        };
        scoped_rows.push(want(id, *command, &[&evidence_id], &scoped_verdict));
    }

    let draft = draft_of(evidences, checks);
    assert_rows("unscoped", &unscoped(&fx, &draft), &unscoped_rows);
    assert_rows("scoped", &scoped(&fx, &draft), &scoped_rows);
}

#[test]
fn an_unreadable_transcript_is_reported_and_a_missing_one_matches_nothing() {
    let draft = draft_of(
        vec![evidence_entry("ev", "tool_result", "c-1")],
        vec![
            check_entry("with-reference", Some(COMMAND), &["ev"]),
            check_entry("without-reference", Some(COMMAND), &[]),
            check_entry("without-command", None, &["ev"]),
        ],
    );
    let expect = |verdict: Verdict| {
        vec![
            want("with-reference", Some(COMMAND), &["ev"], &verdict),
            want("without-reference", Some(COMMAND), &[], &verdict),
            want("without-command", None, &["ev"], &Verdict::no_command()),
        ]
    };

    let missing = fixture();
    let rows = expect(Verdict::unmatched());
    assert_rows("missing, unscoped", &unscoped(&missing, &draft), &rows);
    assert_rows("missing, scoped", &scoped(&missing, &draft), &rows);

    let corrupt = fixture();
    let path = crate::transcripts::transcript_path(corrupt.db.data_dir(), SESSION).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, [0xff, 0xfe, b'\n']).unwrap();
    let rows = expect(Verdict::unreadable());
    assert_rows("unreadable, unscoped", &unscoped(&corrupt, &draft), &rows);
    assert_rows("unreadable, scoped", &scoped(&corrupt, &draft), &rows);
}

#[test]
fn drafts_without_checks_or_evidences_still_observe_what_they_can() {
    let fx = fixture();
    assert!(unscoped(&fx, &json!({"summary": "No checks"})).is_empty());
    assert!(scoped(&fx, &json!({"summary": "No checks"})).is_empty());

    let no_evidences = json!({"checks": [check_entry("chk", Some(COMMAND), &["ev"])]});
    let expected = vec![want("chk", Some(COMMAND), &["ev"], &Verdict::unmatched())];
    assert_rows("unscoped", &unscoped(&fx, &no_evidences), &expected);
    assert_rows("scoped", &scoped(&fx, &no_evidences), &expected);
}

#[test]
fn many_checks_share_one_transcript_read() {
    let fx = fixture();
    store(
        &fx.db,
        1,
        Some(fx.bound.as_str()),
        &bash("m-1", "c-1", COMMAND),
    );
    let evidences = vec![evidence_entry("ev", "tool_result", "c-1")];
    let five_checks = (0..5)
        .map(|n| check_entry(&format!("chk-{n}"), Some(COMMAND), &["ev"]))
        .collect();
    let five_checks = draft_of(evidences.clone(), five_checks);
    let no_commands = vec![
        check_entry("missing", None, &["ev"]),
        check_entry("blank", Some("  "), &["ev"]),
    ];
    let no_commands = draft_of(evidences, no_commands);

    let before = tool_index::builds();
    let rows = unscoped(&fx, &five_checks);
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().all(|row| row.result == "passed"));
    assert_eq!(tool_index::builds() - before, 1, "five checks, one read");
    assert_eq!(scoped(&fx, &five_checks).len(), 5);
    assert_eq!(
        tool_index::builds() - before,
        2,
        "the bound path reads once"
    );
    // Checks that name no command have nothing to look up, so nothing is read.
    assert_eq!(unscoped(&fx, &no_commands).len(), 2);
    assert_eq!(tool_index::builds() - before, 2, "no command, no read");
}
