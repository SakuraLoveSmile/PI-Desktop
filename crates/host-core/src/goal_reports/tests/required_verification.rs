use super::*;

fn verified_draft() -> Value {
    json!({
        "summary": "Required verification passed.",
        "verdict": "met",
        "checks": [{
            "id": "required-check",
            "command": "cargo test --locked",
            "result": "passed",
            "exitCode": 0,
            "evidenceRefs": ["required-evidence"]
        }],
        "evidences": [{"id":"required-evidence", "kind":"tool_result", "refId":"required-native-call", "summary":"Native command result"}]
    })
}

fn bound_goal_with_draft() -> (tempfile::TempDir, Database) {
    let (dir, db) = create_test_db();
    seed_goal_execution(&db, "required-session", "required-execution");
    db.conn()
        .execute(
            "UPDATE plan_approvals SET required_verification_commands_json=?1 WHERE execution_id='required-execution'",
            [r#"["cargo test --locked"]"#],
        )
        .unwrap();
    let turn = crate::sessions::begin_turn(&db, "required-session", None, None).unwrap();
    bind_execution_turn(&db, "required-execution", &turn).unwrap();
    super::native_evidence::record_command(
        &db,
        "required-session",
        &turn,
        "required-native-call",
        "cargo test --locked",
        super::native_evidence::wrapped_result(json!(0)),
        false,
    );
    crate::sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    submit_draft(&db, "required-execution", &verified_draft()).unwrap();
    (dir, db)
}

fn assert_invalid_replacement_blocks_completion(replacement: &Value) {
    let (_dir, db) = bound_goal_with_draft();
    let error = submit_draft(&db, "required-execution", replacement).unwrap_err();
    assert!(error.to_string().starts_with("INVALID_ARGUMENT:"));

    let settled = crate::goal_holds::settle(
        &db,
        "required-session",
        "required-execution",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert_eq!(settled["execution"]["state"], "interrupted");
    assert_eq!(settled["hold"]["state"], "blocked");
    assert_eq!(settled["hold"]["reasons"][0]["code"], "report_missing");
    assert!(settled.get("report").is_none());
    assert!(current_draft(&db, "required-execution").unwrap().is_none());
    assert!(!draft_file_path(db.data_dir(), "required-session", "required-execution").exists());
    assert!(!report_file_path(db.data_dir(), "required-session", "required-execution").exists());
}

#[test]
fn required_verification_replacement_missing_checks_blocks_completion() {
    assert_invalid_replacement_blocks_completion(&json!({
        "summary": "Replacement omitted verification.", "verdict": "met", "checks": []
    }));
}

#[test]
fn required_verification_replacement_inconsistent_checks_blocks_completion() {
    let mut replacement = verified_draft();
    replacement["checks"][0]["exitCode"] = json!(1);
    assert_invalid_replacement_blocks_completion(&replacement);
}

#[test]
fn required_verification_replacement_malformed_checks_blocks_completion() {
    let mut replacement = verified_draft();
    replacement["checks"] = json!("invalid checks");
    assert_invalid_replacement_blocks_completion(&replacement);
}

#[test]
fn required_verification_corrected_replacement_can_complete() {
    let (_dir, db) = bound_goal_with_draft();
    submit_draft(
        &db,
        "required-execution",
        &json!({"summary": "Missing checks", "verdict": "met"}),
    )
    .unwrap_err();
    let mut corrected = verified_draft();
    corrected["summary"] = json!("Corrected verification report.");
    submit_draft(&db, "required-execution", &corrected).unwrap();
    let settled = crate::goal_holds::settle(
        &db,
        "required-session",
        "required-execution",
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
    let report = read_report(&db, "required-session", "required-execution")
        .unwrap()
        .report
        .unwrap();
    assert_eq!(report["summary"], "Corrected verification report.");
    assert_eq!(report["closure"], "agent_verified");
}

#[test]
fn required_verification_replacement_preserves_failed_report() {
    let (_dir, db) = bound_goal_with_draft();
    mark_failed(
        &db,
        "required-session",
        "required-execution",
        "REPORT_PERSISTENCE_BARRIER_FAILED",
    )
    .unwrap();
    let draft_path = draft_file_path(db.data_dir(), "required-session", "required-execution");
    let before = fs::read(&draft_path).unwrap();
    submit_draft(&db, "required-execution", &verified_draft()).unwrap_err();
    assert_eq!(fs::read(&draft_path).unwrap(), before);
    assert_eq!(
        list_reports(&db, "required-session").unwrap()[0].status,
        "failed"
    );
}

#[test]
fn unbound_goal_preserves_draft_after_malformed_replacement() {
    let (_dir, db) = create_test_db();
    seed_goal_execution(&db, "legacy-session", "legacy-execution");
    let original = json!({"summary": "Legacy report without checks", "verdict": "met"});
    submit_draft(&db, "legacy-execution", &original).unwrap();
    submit_draft(
        &db,
        "legacy-execution",
        &json!({"summary": "Malformed replacement", "verdict": "met", "checks": "invalid"}),
    )
    .unwrap_err();
    assert_eq!(
        current_draft(&db, "legacy-execution").unwrap(),
        Some(original)
    );
}

#[test]
fn required_verification_rejects_summary_only_before_persisting_a_draft() {
    let (dir, db) = create_test_db();
    seed_goal_execution(&db, "required-session", "required-execution");
    // Model the approved immutable requirement on the pre-fix schema too, so
    // this regression fails on behavior rather than an absent migration.
    let has_column: bool = db.conn().query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('plan_approvals') WHERE name='required_verification_commands_json')",
        [], |row| row.get(0),
    ).unwrap();
    if !has_column {
        db.conn()
            .execute(
                "ALTER TABLE plan_approvals ADD COLUMN required_verification_commands_json TEXT",
                [],
            )
            .unwrap();
    }
    db.conn().execute(
        "UPDATE plan_approvals SET required_verification_commands_json=?1 WHERE execution_id='required-execution'",
        [r#"["cargo test --locked","pnpm test"]"#],
    ).unwrap();
    let error = submit_draft(
        &db,
        "required-execution",
        &json!({
            "summary": "Both verification commands passed.", "verdict": "met", "checks": []
        }),
    )
    .expect_err("prose must never substitute for frozen structured checks");
    assert!(error.to_string().contains("INVALID_ARGUMENT"));
    assert!(error.to_string().contains("cargo test --locked"));
    assert_eq!(list_reports(&db, "required-session").unwrap().len(), 0);
    assert!(!dir.path().join("goal-reports/required-session").exists());
}
