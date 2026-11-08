//! How Goals without an approval-bound command list are observed: the cited
//! evidence is a hint, and the last finished Bash run of the check's own
//! command in this execution decides. Every case asserts the whole observation.

use super::observation_support::*;
use super::*;

#[test]
fn a_check_without_references_is_settled_by_the_run_of_its_command() {
    let fx = fixture();
    let turn = Some(fx.bound.as_str());
    let success_only = Run::recorded(super::native_evidence::wrapped_result(json!(true)));
    // One finished run per command, so every case stands alone.
    let cases = vec![
        ("passes", Run::exit(0), Verdict::exit(0)),
        ("fails", Run::exit(2), Verdict::exit(2)),
        (
            "errors",
            Run::exit(0).record_error(),
            Verdict::error(Some(0)),
        ),
        ("success-only", success_only, Verdict::success_only()),
    ];
    let (mut checks, mut expected) = (Vec::new(), Vec::new());
    for (index, (id, run, verdict)) in cases.into_iter().enumerate() {
        let (call_id, command) = (format!("c-{id}"), format!("make {id}"));
        let seq = i64::try_from(index).unwrap() + 1;
        fx.ran_in(turn, seq, &call_id, &command, run);
        checks.push(check_entry(id, Some(&command), &[]));
        let verdict = verdict.by_command(&call_id, ONLY_RUN);
        expected.push(want(id, Some(&command), &[], &verdict));
    }

    // Whitespace around either command does not matter; the check's command
    // is still echoed as written.
    fx.ran_in(turn, 10, "c-padded-run", " make padded-run\n", Run::exit(0));
    fx.ran_in(
        turn,
        11,
        "c-padded-check",
        "make padded-check",
        Run::exit(0),
    );
    // A reference that leads nowhere does not stop the command match, and the
    // reference is still echoed.
    fx.ran_in(turn, 12, "c-ghost", "make ghost", Run::exit(0));
    let padded = "  make padded-check  ";
    checks.push(check_entry("padded-run", Some("make padded-run"), &[]));
    checks.push(check_entry("padded-check", Some(padded), &[]));
    checks.push(check_entry("ghost", Some("make ghost"), &["ev-ghost"]));
    let by = |call_id: &str| Verdict::exit(0).by_command(call_id, ONLY_RUN);
    expected.push(want(
        "padded-run",
        Some("make padded-run"),
        &[],
        &by("c-padded-run"),
    ));
    expected.push(want(
        "padded-check",
        Some(padded),
        &[],
        &by("c-padded-check"),
    ));
    expected.push(want(
        "ghost",
        Some("make ghost"),
        &["ev-ghost"],
        &by("c-ghost"),
    ));

    let draft = draft_of(Vec::new(), checks);
    assert_rows("unbound", &unbound(&fx, &draft), &expected);
}

#[test]
fn the_last_finished_run_decides_and_unfinished_runs_are_skipped() {
    let fx = fixture();
    let turn = Some(fx.bound.as_str());
    let running = || Run::recorded(json!({"content": [], "details": {}})).status("running");
    // (check id, then the runs as (seq, call id, turn, run), then the verdict)
    let by = |verdict: Verdict, call_id: &str, finished: usize| {
        let rank = if finished == 1 {
            ONLY_RUN.to_string()
        } else {
            last_of(finished)
        };
        verdict.by_command(call_id, &rank)
    };
    let other = Some(fx.other.as_str());

    fx.ran_in(turn, 1, "fail-1", "make fail-after-pass", Run::exit(0));
    fx.ran_in(turn, 2, "fail-2", "make fail-after-pass", Run::exit(1));
    fx.ran_in(turn, 3, "pass-1", "make pass-after-fail", Run::exit(1));
    fx.ran_in(turn, 4, "pass-2", "make pass-after-fail", Run::exit(0));
    // A later run that never recorded how it ended proves nothing.
    fx.ran_in(turn, 5, "kept-1", "make no-result-after", Run::exit(0));
    fx.ran_in(turn, 6, "kept-2", "make no-result-after", Run::no_result());
    fx.ran_in(turn, 7, "run-1", "make running-after", Run::exit(0));
    fx.ran_in(turn, 8, "run-2", "make running-after", running());
    // Messages are ordered by their durable sequence, not by transcript order.
    fx.ran_in(turn, 22, "late", "make ordered-by-seq", Run::exit(0));
    fx.ran_in(turn, 21, "early", "make ordered-by-seq", Run::exit(1));
    // Later runs outside this execution or beyond the boundary do not count.
    fx.ran_in(turn, 31, "own-1", "make foreign-after", Run::exit(0));
    fx.ran_in(other, 32, "other-turn", "make foreign-after", Run::exit(1));
    fx.ran_in(None, 33, "no-turn", "make foreign-after", Run::exit(1));
    fx.ran_in(
        turn,
        DURABLE_SEQ + 1,
        "future",
        "make foreign-after",
        Run::exit(1),
    );
    // The boundary itself is inside.
    fx.ran_in(
        turn,
        DURABLE_SEQ,
        "at-edge",
        "make at-boundary",
        Run::exit(1),
    );

    let cases = vec![
        ("fail-after-pass", by(Verdict::exit(1), "fail-2", 2)),
        ("pass-after-fail", by(Verdict::exit(0), "pass-2", 2)),
        ("no-result-after", by(Verdict::exit(0), "kept-1", 1)),
        ("running-after", by(Verdict::exit(0), "run-1", 1)),
        ("ordered-by-seq", by(Verdict::exit(0), "late", 2)),
        ("foreign-after", by(Verdict::exit(0), "own-1", 1)),
        ("at-boundary", by(Verdict::exit(1), "at-edge", 1)),
    ];
    let (mut checks, mut expected) = (Vec::new(), Vec::new());
    for (id, verdict) in &cases {
        let command = format!("make {id}");
        checks.push(check_entry(id, Some(&command), &[]));
        expected.push(want(id, Some(&command), &[], verdict));
    }

    let draft = draft_of(Vec::new(), checks);
    assert_rows("unbound", &unbound(&fx, &draft), &expected);
}

#[test]
fn a_cited_run_that_is_not_the_last_is_replaced_and_named() {
    let fx = fixture();
    let turn = Some(fx.bound.as_str());
    let runs: Vec<(&str, Vec<(&str, i64)>)> = vec![
        ("pass-then-fail", vec![("p-1", 0), ("p-2", 1)]),
        ("fail-then-pass", vec![("f-1", 1), ("f-2", 0)]),
        // The later run agrees on the result but not on the code: the last
        // run still decides.
        ("fail-then-fail", vec![("s-1", 1), ("s-2", 2)]),
        ("middle-of-three", vec![("m-1", 0), ("m-2", 1), ("m-3", 0)]),
        ("cited-is-last", vec![("l-1", 0), ("l-2", 1)]),
        ("only-run", vec![("o-1", 3)]),
    ];
    let mut seq = 0;
    for (id, calls) in &runs {
        for (call_id, code) in calls {
            seq += 1;
            fx.ran_in(turn, seq, call_id, &format!("make {id}"), Run::exit(*code));
        }
    }
    // A later run that never ended does not replace the cited one.
    fx.ran_in(turn, 50, "u-1", "make unfinished-after", Run::exit(0));
    fx.ran_in(turn, 51, "u-2", "make unfinished-after", Run::no_result());

    let replaced = |verdict: Verdict, call_id: &str, finished: usize, cited: &str, was: &str| {
        let verdict = verdict.by_command(call_id, &last_of(finished));
        verdict.replacing(cited, was)
    };
    // (check id, cited call, verdict)
    let cases = vec![
        (
            "pass-then-fail",
            "p-1",
            replaced(Verdict::exit(1), "p-2", 2, "p-1", "passed"),
        ),
        (
            "fail-then-pass",
            "f-1",
            replaced(Verdict::exit(0), "f-2", 2, "f-1", "failed"),
        ),
        (
            "fail-then-fail",
            "s-1",
            replaced(Verdict::exit(2), "s-2", 2, "s-1", "failed"),
        ),
        (
            "middle-of-three",
            "m-2",
            replaced(Verdict::exit(0), "m-3", 3, "m-2", "failed"),
        ),
        // The cited run is the last finished run: the reference said it all.
        ("cited-is-last", "l-2", Verdict::exit(1)),
        ("only-run", "o-1", Verdict::exit(3)),
        ("unfinished-after", "u-1", Verdict::exit(0)),
    ];
    let (mut evidences, mut checks, mut expected) = (Vec::new(), Vec::new(), Vec::new());
    for (id, cited, verdict) in &cases {
        let (command, evidence_id) = (format!("make {id}"), format!("ev-{id}"));
        evidences.push(evidence_entry(&evidence_id, "tool_result", cited));
        checks.push(check_entry(id, Some(&command), &[&evidence_id]));
        expected.push(want(id, Some(&command), &[&evidence_id], verdict));
    }

    let draft = draft_of(evidences, checks);
    assert_rows("unbound", &unbound(&fx, &draft), &expected);
}

#[test]
fn only_this_executions_exact_bash_runs_count() {
    let fx = fixture();
    let (turn, other) = (Some(fx.bound.as_str()), Some(fx.other.as_str()));
    let ok = || Some(super::native_evidence::wrapped_result(json!(0)));
    let plain = |id: &str, command: &str| bash(id, id, command);

    // Every decoy is the only candidate for its own check command, so none of
    // them may produce a verdict.
    fx.ran_in(other, 1, "d-other-turn", "make other-turn", Run::exit(0));
    fx.ran_in(None, 2, "d-no-turn", "make no-turn", Run::exit(0));
    fx.ran_in(
        turn,
        DURABLE_SEQ + 1,
        "d-future",
        "make future",
        Run::exit(0),
    );
    write_transcript(&fx.db, &plain("d-unindexed", "make unindexed"));
    let indexed_role = plain("d-index-role", "make index-role");
    store_indexed(&fx.db, 3, turn, "assistant", false, &indexed_role);
    let mut assistant_line = plain("d-line-role", "make line-role");
    assistant_line.role = "assistant".to_string();
    store_indexed(&fx.db, 4, turn, "tool", false, &assistant_line);
    let read_block = call("d-block-name", "Read", "make block-name", ok(), "success");
    let read_call = tool_record("d-block-name", "Bash", vec![read_block]);
    store(&fx.db, 5, turn, &read_call);
    let bash_block = call("d-record-name", "Bash", "make record-name", ok(), "success");
    let wrong_tool = tool_record("d-record-name", "Read", vec![bash_block]);
    store(&fx.db, 6, turn, &wrong_tool);
    // Other commands, and commands that only contain the check's command.
    fx.ran_in(turn, 7, "d-longer", "make longer --locked", Run::exit(0));
    fx.ran_in(turn, 8, "d-chained", "cd sub && make chained", Run::exit(0));
    fx.ran_in(turn, 9, "d-prefix", "make", Run::exit(0));

    let ids = [
        "other-turn",
        "no-turn",
        "future",
        "unindexed",
        "index-role",
        "line-role",
        "block-name",
        "record-name",
        "longer",
        "chained",
        "prefix",
    ];
    let (mut checks, mut expected) = (Vec::new(), Vec::new());
    for id in ids {
        let command = format!("make {id}");
        checks.push(check_entry(id, Some(&command), &[]));
        expected.push(want(id, Some(&command), &[], &Verdict::no_run()));
    }
    // A command-less check is decided before any run is looked at.
    checks.push(check_entry("no-command", None, &[]));
    expected.push(want("no-command", None, &[], &Verdict::no_command()));
    checks.push(check_entry("blank-command", Some("  \n"), &[]));
    expected.push(want(
        "blank-command",
        Some("  \n"),
        &[],
        &Verdict::no_command(),
    ));

    let draft = draft_of(Vec::new(), checks);
    assert_rows("unbound", &unbound(&fx, &draft), &expected);
}

#[test]
fn gaps_say_why_nothing_matched_and_bad_references_do_not_block_a_match() {
    let fx = fixture();
    let (turn, other) = (Some(fx.bound.as_str()), Some(fx.other.as_str()));
    // Runs that never recorded how they ended: one command with one such run,
    // another with two.
    fx.ran_in(turn, 1, "u-one", "make one-unfinished", Run::no_result());
    fx.ran_in(turn, 2, "u-two-a", "make two-unfinished", Run::no_result());
    fx.ran_in(
        turn,
        3,
        "u-two-b",
        "make two-unfinished",
        Run::no_result().block_error(),
    );
    // One call id on two messages cannot be told apart. None of them runs the
    // check's command, so the ambiguity is all there is to report.
    fx.ran_as(turn, 4, ("dup-m1", "dup"), "make elsewhere", Run::exit(0));
    fx.ran_as(turn, 5, ("dup-m2", "dup"), "make elsewhere", Run::exit(1));
    // The same ambiguity next to real runs of the check's command: the command
    // match still decides, and the last of the two runs wins.
    fx.ran_as(
        turn,
        6,
        ("amb-m1", "amb"),
        "make ambiguous-ref",
        Run::exit(0),
    );
    fx.ran_as(
        turn,
        7,
        ("amb-m2", "amb"),
        "make ambiguous-ref",
        Run::exit(1),
    );
    // A reference into another turn is invisible, so the run in this one wins.
    fx.ran_in(other, 8, "away", "make away", Run::exit(1));
    fx.ran_in(turn, 9, "here", "make away", Run::exit(0));

    let evidences = vec![
        evidence_entry("ev-dup", "tool_result", "dup"),
        evidence_entry("ev-amb", "tool_result", "amb"),
        evidence_entry("ev-away", "tool_result", "away"),
    ];
    let checks = vec![
        check_entry("never-ran", Some("make never-ran"), &[]),
        check_entry("one-unfinished", Some("make one-unfinished"), &[]),
        check_entry("two-unfinished", Some("make two-unfinished"), &[]),
        check_entry("ambiguous-only", Some("make dup-target"), &["ev-dup"]),
        check_entry("ambiguous-ref", Some("make ambiguous-ref"), &["ev-amb"]),
        check_entry("cited-elsewhere", Some("make away"), &["ev-away"]),
    ];
    let expected = vec![
        want("never-ran", Some("make never-ran"), &[], &Verdict::no_run()),
        want(
            "one-unfinished",
            Some("make one-unfinished"),
            &[],
            &Verdict::unfinished(1),
        ),
        want(
            "two-unfinished",
            Some("make two-unfinished"),
            &[],
            &Verdict::unfinished(2),
        ),
        want(
            "ambiguous-only",
            Some("make dup-target"),
            &["ev-dup"],
            &Verdict::ambiguous(),
        ),
        want(
            "ambiguous-ref",
            Some("make ambiguous-ref"),
            &["ev-amb"],
            &Verdict::exit(1).by_command("amb", &last_of(2)),
        ),
        want(
            "cited-elsewhere",
            Some("make away"),
            &["ev-away"],
            &Verdict::exit(0).by_command("here", ONLY_RUN),
        ),
    ];

    let draft = draft_of(evidences, checks);
    assert_rows("unbound", &unbound(&fx, &draft), &expected);
}

#[test]
fn an_unreadable_transcript_is_reported_and_a_missing_one_has_no_runs() {
    let draft = draft_of(
        Vec::new(),
        vec![
            check_entry("with-command", Some(COMMAND), &[]),
            check_entry("without-command", None, &[]),
        ],
    );
    let expect = |verdict: Verdict| {
        vec![
            want("with-command", Some(COMMAND), &[], &verdict),
            want("without-command", None, &[], &Verdict::no_command()),
        ]
    };

    let missing = fixture();
    assert_rows(
        "missing",
        &unbound(&missing, &draft),
        &expect(Verdict::no_run()),
    );

    let corrupt = fixture();
    let path = crate::transcripts::transcript_path(corrupt.db.data_dir(), SESSION).unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, [0xff, 0xfe, b'\n']).unwrap();
    assert_rows(
        "unreadable",
        &unbound(&corrupt, &draft),
        &expect(Verdict::unreadable()),
    );
}

#[test]
fn bound_goals_never_match_by_command() {
    let fx = fixture();
    fx.ran(1, "c-1", COMMAND, 0);
    fx.ran(2, "c-2", COMMAND, 1);
    let draft = draft_of(
        vec![evidence_entry("ev-1", "tool_result", "c-1")],
        vec![
            check_entry("by-command", Some(COMMAND), &[]),
            check_entry("stale-cite", Some(COMMAND), &["ev-1"]),
        ],
    );

    // Approval-bound Goals keep the references-only rule, stale pass included.
    let kept = vec![
        want("by-command", Some(COMMAND), &[], &Verdict::unmatched()),
        want("stale-cite", Some(COMMAND), &["ev-1"], &Verdict::exit(0)),
    ];
    assert_rows("bound", &bound(&fx, &draft), &kept);

    let last = Verdict::exit(1).by_command("c-2", &last_of(2));
    let found = vec![
        want("by-command", Some(COMMAND), &[], &last),
        want(
            "stale-cite",
            Some(COMMAND),
            &["ev-1"],
            &last.clone().replacing("c-1", "passed"),
        ),
    ];
    assert_rows("unbound", &unbound(&fx, &draft), &found);
}

#[test]
fn many_checks_share_one_transcript_read() {
    let fx = fixture();
    fx.ran(1, "c-1", COMMAND, 0);
    let five = (0..5)
        .map(|n| check_entry(&format!("chk-{n}"), Some(COMMAND), &[]))
        .collect();
    let five = draft_of(Vec::new(), five);
    let no_commands = vec![
        check_entry("missing", None, &[]),
        check_entry("blank", Some("  "), &[]),
    ];
    let no_commands = draft_of(Vec::new(), no_commands);

    let before = tool_index::builds();
    let rows = unbound(&fx, &five);
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().all(|row| row.result == "passed"));
    assert_eq!(tool_index::builds() - before, 1, "five checks, one read");
    // Checks that name no command have nothing to look up, so nothing is read.
    assert_eq!(unbound(&fx, &no_commands).len(), 2);
    assert_eq!(tool_index::builds() - before, 1, "no command, no read");
}

#[test]
fn a_finalized_unbound_report_records_the_command_match() {
    let fx = fixture();
    fx.ran(1, "c-pass", "make pass", 0);
    fx.ran(2, "c-old", "make flaky", 0);
    fx.ran(3, "c-new", "make flaky", 1);
    let draft = json!({
        "summary": "Observed by command", "verdict": "met",
        "evidences": [evidence_entry("ev-old", "tool_result", "c-old")],
        "checks": [
            check_entry("chk-pass", Some("make pass"), &[]),
            check_entry("chk-flaky", Some("make flaky"), &["ev-old"]),
            check_entry("chk-never", Some("make never"), &[]),
        ],
    });
    submit_draft(&fx.db, EXECUTION, &draft).unwrap();
    fx.db
        .conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![EXECUTION],
        )
        .unwrap();

    let summary = finalize_report(&fx.db, EXECUTION, DURABLE_SEQ, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");

    let report = read_report(&fx.db, SESSION, EXECUTION)
        .unwrap()
        .report
        .unwrap();
    let rows: Vec<Observation> =
        serde_json::from_value(report["checkObservations"].clone()).unwrap();
    let flaky = Verdict::exit(1)
        .by_command("c-new", &last_of(2))
        .replacing("c-old", "passed");
    let expected = vec![
        want(
            "chk-pass",
            Some("make pass"),
            &[],
            &Verdict::exit(0).by_command("c-pass", ONLY_RUN),
        ),
        want("chk-flaky", Some("make flaky"), &["ev-old"], &flaky),
        want("chk-never", Some("make never"), &[], &Verdict::no_run()),
    ];
    assert_rows("finalized", &rows, &expected);
}
