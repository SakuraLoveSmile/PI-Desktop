//! How check observations resolve evidence references to durable Bash results.
//! This is the whole story for approval-bound Goals and the reference half of
//! the unbound path. Every case asserts the full observation (result, exitCode,
//! detail and evidenceIds) so the observation code can be restructured without
//! changing what a report says.

use super::native_evidence::wrapped_result;
use super::observation_support::*;
use super::*;

#[test]
fn recorded_exit_codes_and_error_flags_decide_the_observation() {
    let fx = fixture();
    let raw = |exit_code: Value| Run::recorded(wrapped_result(exit_code));
    let envelope = |details: Value| Run::recorded(json!({"content": [], "details": details}));
    let cases = vec![
        (Run::exit(0), Verdict::exit(0)),
        (Run::exit(2), Verdict::exit(2)),
        (Run::exit(-1), Verdict::exit(-1)),
        // Older records hold the bare Host result instead of the envelope.
        (Run::recorded(json!({"exitCode": 0})), Verdict::exit(0)),
        (Run::recorded(json!({"exitCode": 3})), Verdict::exit(3)),
        // Any error flag wins over a zero exit code and keeps the code.
        (Run::exit(0).record_error(), Verdict::error(Some(0))),
        (Run::exit(0).index_error(), Verdict::error(Some(0))),
        (Run::exit(0).block_error(), Verdict::error(Some(0))),
        (Run::exit(0).status("failed"), Verdict::error(Some(0))),
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
        let seq = i64::try_from(index).unwrap() + 1;
        let turn = Some(fx.bound.as_str());
        fx.ran_as(turn, seq, (&format!("m-{index}"), &call_id), COMMAND, run);
        evidences.push(evidence_entry(&evidence_id, "tool_result", &call_id));
        checks.push(check_entry(&check_id, Some(COMMAND), &[&evidence_id]));
        expected.push(want(&check_id, Some(COMMAND), &[&evidence_id], &verdict));
    }

    let draft = draft_of(evidences, checks);
    assert_rows("bound", &bound(&fx, &draft), &expected);
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
    assert_rows("bound", &bound(&fx, &draft), &expected);
}

#[test]
fn only_exact_bash_results_inside_the_boundary_count() {
    let fx = fixture();
    let (bound_turn, other) = (Some(fx.bound.as_str()), Some(fx.other.as_str()));
    let plain = |id: &str, command: &str| bash(id, id, command);
    let ok = || Some(wrapped_result(json!(0)));
    // Inside, at, and beyond the durable boundary (inclusive).
    store(&fx.db, 20, bound_turn, &plain("b-in", COMMAND));
    store(&fx.db, DURABLE_SEQ, bound_turn, &plain("b-edge", COMMAND));
    store(
        &fx.db,
        DURABLE_SEQ + 1,
        bound_turn,
        &plain("b-future", COMMAND),
    );
    // The same session, but not this execution's turns.
    store(&fx.db, 21, None, &plain("b-null-turn", COMMAND));
    store(&fx.db, 22, other, &plain("b-other-turn", COMMAND));
    // Never indexed, or indexed under another role than the transcript line.
    write_transcript(&fx.db, &plain("b-unindexed", COMMAND));
    store_indexed(
        &fx.db,
        23,
        bound_turn,
        "assistant",
        false,
        &plain("b-index-role", COMMAND),
    );
    let mut assistant_line = plain("b-line-role", COMMAND);
    assistant_line.role = "assistant".to_string();
    store_indexed(&fx.db, 24, bound_turn, "tool", false, &assistant_line);
    // Command identity is byte-exact, and only Bash counts on both sides.
    store(
        &fx.db,
        25,
        bound_turn,
        &plain("b-longer", "cargo test --locked"),
    );
    store(&fx.db, 26, bound_turn, &plain("b-padded", " cargo test"));
    let read_block = call("b-block-name", "Read", COMMAND, ok(), "success");
    store(
        &fx.db,
        27,
        bound_turn,
        &tool_record("b-block-name", "Bash", vec![read_block]),
    );
    let bash_block = call("b-record-name", "Bash", COMMAND, ok(), "success");
    store(
        &fx.db,
        28,
        bound_turn,
        &tool_record("b-record-name", "Read", vec![bash_block]),
    );

    // (check id, command, cited record, verdict)
    let rows: Vec<(&str, Option<&str>, &str, Verdict)> = vec![
        ("in-turn", Some(COMMAND), "b-in", Verdict::exit(0)),
        ("at-boundary", Some(COMMAND), "b-edge", Verdict::exit(0)),
        (
            "beyond-boundary",
            Some(COMMAND),
            "b-future",
            Verdict::unmatched(),
        ),
        // The same session is not enough: the turn must be the execution's.
        (
            "no-turn",
            Some(COMMAND),
            "b-null-turn",
            Verdict::unmatched(),
        ),
        (
            "other-turn",
            Some(COMMAND),
            "b-other-turn",
            Verdict::unmatched(),
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

    let (mut evidences, mut checks, mut expected) = (Vec::new(), Vec::new(), Vec::new());
    for (id, command, record, verdict) in &rows {
        let evidence_id = format!("ev-{id}");
        evidences.push(evidence_entry(&evidence_id, "tool_result", record));
        checks.push(check_entry(id, *command, &[&evidence_id]));
        expected.push(want(id, *command, &[&evidence_id], verdict));
    }

    let draft = draft_of(evidences, checks);
    assert_rows("bound", &bound(&fx, &draft), &expected);
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
    assert_rows("missing", &bound(&missing, &draft), &rows);

    let corrupt = fixture();
    let path = crate::transcripts::transcript_path(corrupt.db.data_dir(), SESSION).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, [0xff, 0xfe, b'\n']).unwrap();
    let rows = expect(Verdict::unreadable());
    assert_rows("unreadable", &bound(&corrupt, &draft), &rows);
}

#[test]
fn drafts_without_checks_or_evidences_still_observe_what_they_can() {
    let fx = fixture();
    assert!(bound(&fx, &json!({"summary": "No checks"})).is_empty());

    let no_evidences = json!({"checks": [check_entry("chk", Some(COMMAND), &["ev"])]});
    let expected = vec![want("chk", Some(COMMAND), &["ev"], &Verdict::unmatched())];
    assert_rows("bound", &bound(&fx, &no_evidences), &expected);
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
    let rows = bound(&fx, &five_checks);
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().all(|row| row.result == "passed"));
    assert_eq!(tool_index::builds() - before, 1, "five checks, one read");
    // Checks that name no command have nothing to look up, so nothing is read.
    assert_eq!(bound(&fx, &no_commands).len(), 2);
    assert_eq!(tool_index::builds() - before, 1, "no command, no read");
}
