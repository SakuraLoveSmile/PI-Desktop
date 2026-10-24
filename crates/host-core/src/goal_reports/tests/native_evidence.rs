use super::*;

pub(super) fn record_command(
    db: &Database,
    session: &str,
    turn: &str,
    call: &str,
    command: &str,
    result: Value,
    is_error: bool,
) {
    let message: crate::sessions::UiMessage = serde_json::from_value(json!({
        "id": call, "role": "tool", "content": "Native command result",
        "createdAt": "2026-10-22T13:32:00Z", "toolName": "Bash",
        "toolCallId": call, "toolArgs": {"command": command},
        "toolResult": result, "toolStatus": "success", "isError": is_error
    }))
    .unwrap();
    crate::sessions::append_message(db, session, &message, Some(turn)).unwrap();
}

pub(super) fn wrapped_result(exit: Value) -> Value {
    json!({"content": [{"type": "text", "text": "All tests passed; exitCode=0"}],
        "details": {"commandShellId": "bash", "exitCode": exit, "stdout": "", "stderr": ""},
        "isError": false})
}

fn draft(reference: &str, kind: &str) -> Value {
    json!({"summary": "Native command verified", "verdict": "met", "checks": [{
        "id": "check", "command": "cargo test --locked", "result": "passed", "exitCode": 0,
        "evidenceRefs": ["evidence"]
    }], "evidences": [{"id": "evidence", "kind": kind, "refId": reference, "summary": "Command result"}]})
}

fn bound_goal() -> (tempfile::TempDir, Database, String) {
    let (dir, db) = create_test_db();
    seed_goal_execution(&db, "native-session", "native-execution");
    db.conn().execute("UPDATE plan_approvals SET required_verification_commands_json=?1 WHERE execution_id='native-execution'", [r#"["cargo test --locked"]"#]).unwrap();
    let turn = crate::sessions::begin_turn(&db, "native-session", None, None).unwrap();
    bind_execution_turn(&db, "native-execution", &turn).unwrap();
    (dir, db, turn)
}

#[test]
fn native_envelope_has_integer_exit_in_final_observation() {
    let (_dir, db, turn) = bound_goal();
    record_command(
        &db,
        "native-session",
        &turn,
        "native-call",
        "cargo test --locked",
        wrapped_result(json!(0)),
        false,
    );
    submit_draft(
        &db,
        "native-execution",
        &draft("native-call", "tool_result"),
    )
    .unwrap();
    crate::sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let settled = crate::goal_holds::settle(
        &db,
        "native-session",
        "native-execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert_eq!(settled["execution"]["state"], "completed");
    let report = read_report(&db, "native-session", "native-execution")
        .unwrap()
        .report
        .unwrap();
    assert_eq!(report["checkObservations"][0]["exitCode"], 0);
    assert_eq!(report["checkObservations"][0]["result"], "passed");
    submit_draft(
        &db,
        "native-execution",
        &draft("native-call", "tool_result"),
    )
    .expect_err("ready reports remain immutable");
    assert_eq!(
        read_report(&db, "native-session", "native-execution")
            .unwrap()
            .report
            .unwrap(),
        report
    );
}

#[test]
fn native_wrong_references_are_corrected_within_the_same_execution() {
    let (_dir, db, turn) = bound_goal();
    record_command(
        &db,
        "native-session",
        &turn,
        "native-call",
        "cargo test --locked",
        wrapped_result(json!(0)),
        false,
    );
    for (reference, kind) in [
        ("bash", "tool_result"),
        ("native-call", "tool_call"),
        ("missing", "tool_result"),
    ] {
        let error = submit_draft(&db, "native-execution", &draft(reference, kind))
            .expect_err("wrong references cannot prove a passed command");
        assert!(error.to_string().starts_with("INVALID_ARGUMENT:"));
        assert!(error.to_string().contains("cargo test --locked"));
        assert!(current_draft(&db, "native-execution").unwrap().is_none());
    }
    submit_draft(
        &db,
        "native-execution",
        &draft("native-call", "tool_result"),
    )
    .unwrap();
}

#[test]
fn native_invalid_results_cannot_be_replaced_by_model_success() {
    for (result, error) in [
        (wrapped_result(json!(1)), false),
        (wrapped_result(json!(true)), false),
        (wrapped_result(json!("0")), false),
        (wrapped_result(json!(0.0)), false),
        (wrapped_result(Value::Null), false),
        (wrapped_result(json!(0)), true),
        (
            json!({"content": [{"type":"text", "text":"{\"exitCode\":0}"}], "details": {"stdout": "All tests passed"}}),
            false,
        ),
        (
            json!({"content": [], "details": {"exitCode":0}, "isError":true}),
            false,
        ),
    ] {
        let (_dir, db, turn) = bound_goal();
        record_command(
            &db,
            "native-session",
            &turn,
            "native-call",
            "cargo test --locked",
            result,
            error,
        );
        submit_draft(
            &db,
            "native-execution",
            &draft("native-call", "tool_result"),
        )
        .expect_err("native failure or missing integer exit is not proof of success");
    }
}

#[test]
fn native_proof_is_owned_by_the_execution_turn() {
    let (_dir, db) = create_test_db();
    seed_goal_execution(&db, "native-session", "native-execution");
    let old_turn = crate::sessions::begin_turn(&db, "native-session", None, None).unwrap();
    record_command(
        &db,
        "native-session",
        &old_turn,
        "old-call",
        "cargo test --locked",
        wrapped_result(json!(0)),
        false,
    );
    crate::sessions::end_turn(&db, &old_turn, "completed", None, None, false).unwrap();
    db.conn().execute("UPDATE plan_approvals SET required_verification_commands_json=?1 WHERE execution_id='native-execution'", [r#"["cargo test --locked"]"#]).unwrap();
    let turn = crate::sessions::begin_turn(&db, "native-session", None, None).unwrap();
    bind_execution_turn(&db, "native-execution", &turn).unwrap();
    submit_draft(&db, "native-execution", &draft("old-call", "tool_result"))
        .expect_err("same session does not establish execution ownership");
    record_command(
        &db,
        "native-session",
        &turn,
        "new-call",
        "different command",
        wrapped_result(json!(0)),
        false,
    );
    submit_draft(&db, "native-execution", &draft("new-call", "tool_result"))
        .expect_err("command must match byte for byte");
}

#[test]
fn native_scope_keeps_the_durable_sequence_boundary_and_legacy_bare_result() {
    let (_dir, db, turn) = bound_goal();
    record_command(
        &db,
        "native-session",
        &turn,
        "native-call",
        "cargo test --locked",
        json!({"exitCode": 0}),
        false,
    );
    let sequence: i64 = db
        .conn()
        .query_row(
            "SELECT seq FROM messages WHERE id='native-call'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let draft = draft("native-call", "tool_result");
    let before = evidence::execution_check_observations(
        &db,
        "native-session",
        "native-execution",
        sequence - 1,
        &draft,
    )
    .unwrap();
    assert_eq!(before[0].result, "inconclusive");
    let durable = evidence::execution_check_observations(
        &db,
        "native-session",
        "native-execution",
        sequence,
        &draft,
    )
    .unwrap();
    assert_eq!(
        (&durable[0].result, durable[0].exit_code),
        (&"passed".to_string(), Some(0))
    );
    submit_draft(&db, "native-execution", &draft).unwrap();
}

#[test]
fn native_resumed_execution_preserves_its_original_segment_evidence() {
    let (_dir, db, turn) = bound_goal();
    record_command(
        &db,
        "native-session",
        &turn,
        "native-call",
        "cargo test --locked",
        wrapped_result(json!(0)),
        false,
    );
    crate::sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let blocked = crate::goal_holds::settle(
        &db,
        "native-session",
        "native-execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    let version = blocked["hold"]["version"].as_i64().unwrap();
    crate::goal_holds::resume(&db, "native-session", "native-execution", version, None).unwrap();
    let resumed_turn = crate::sessions::begin_turn(&db, "native-session", None, None).unwrap();
    bind_execution_turn(&db, "native-execution", &resumed_turn).unwrap();
    submit_draft(
        &db,
        "native-execution",
        &draft("native-call", "tool_result"),
    )
    .unwrap();
    let report = current_draft(&db, "native-execution").unwrap().unwrap();
    assert_eq!(report["evidences"][0]["refId"], "native-call");
}

#[test]
fn native_duplicate_call_ids_are_not_guessed_across_resumed_segments() {
    let (_dir, db, turn) = bound_goal();
    record_command(
        &db,
        "native-session",
        &turn,
        "native-call",
        "cargo test --locked",
        wrapped_result(json!(0)),
        false,
    );
    // A durable index may remap the message ID when a provider reuses a call
    // ID. Keep both identities in this execution and do not select one by order.
    let message: crate::sessions::UiMessage = serde_json::from_value(json!({
        "id":"remapped-message", "role":"tool", "content":"Later result", "createdAt":"2026-10-22T00:00:00Z",
        "toolName":"Bash", "toolCallId":"native-call", "toolArgs":{"command":"cargo test --locked"},
        "toolResult":wrapped_result(json!(1)), "toolStatus":"error", "isError":true
    })).unwrap();
    crate::sessions::append_message(&db, "native-session", &message, Some(&turn)).unwrap();
    submit_draft(
        &db,
        "native-execution",
        &draft("native-call", "tool_result"),
    )
    .expect_err("ambiguous call identity is not independent proof");
}
