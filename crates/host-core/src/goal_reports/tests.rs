use rusqlite::params;
use serde_json::json;

use super::*;
use crate::db::Database;

fn create_test_db() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("pi.sqlite");
    let db = Database::open(&db_path).unwrap();
    (dir, db)
}

fn seed_goal_execution(db: &Database, session_id: &str, execution_id: &str) -> String {
    let proposal_id = format!("prop-{}", Uuid::new_v4().simple());
    let now = now_ms();
    // First create a session to satisfy foreign key
    db.conn()
        .prepare_cached(
            "INSERT INTO sessions (
                id, title, mode, permission_mode, created_at, updated_at
             ) VALUES (?1, 'Test Session', 'goal', 'accept-edits', ?2, ?2)",
        )
        .unwrap()
        .execute(params![session_id, now])
        .unwrap();

    // Now insert plan_approvals
    db.conn()
        .prepare_cached(
            "INSERT INTO plan_approvals (
                request_id, session_id, turn_id, tool_call_id, kind, plan_json,
                title, question, status, action, target_permission_mode,
                created_at, updated_at, execution_id, execution_state,
                artifact_relative_path, artifact_sha256, artifact_size_bytes
             ) VALUES (
                ?1, ?2, 'turn-init', ?3, 'goal', '# Goal\n\nBuild goal report.',
                'Test Goal Title', 'Approve?', 'approved', 'approve', 'accept-edits',
                ?4, ?4, ?5, 'running',
                '.pi/goal/test.md', 'sha256-test', 123
             )",
        )
        .unwrap()
        .execute(params![
            proposal_id,
            session_id,
            format!("tc-{}", Uuid::new_v4().simple()),
            now,
            execution_id
        ])
        .unwrap();

    proposal_id
}

#[test]
fn test_bind_execution_turn() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-bind";
    let execution_id = "exec-bind-1";
    seed_goal_execution(&db, session_id, execution_id);

    bind_execution_turn(&db, execution_id, "turn-100").unwrap();

    let (turn_id, status): (Option<String>, String) = db
        .conn()
        .query_row(
            "SELECT turn_id, status FROM goal_reports WHERE execution_id = ?1",
            params![execution_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();

    assert_eq!(turn_id.as_deref(), Some("turn-100"));
    assert_eq!(status, "pending");
}

#[test]
fn test_submit_draft_and_finalize_structured() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-draft";
    let execution_id = "exec-draft-1";
    let proposal_id = seed_goal_execution(&db, session_id, execution_id);
    bind_execution_turn(&db, execution_id, "turn-draft").unwrap();

    let draft = json!({
        "summary": "Implemented feature completely with all green tests.",
        "verdict": "met",
        "metrics": [
            { "label": "Checks", "value": "10/10", "source": "cargo test" }
        ],
        "criteria": [
            {
                "id": "crit-1",
                "text": "Schema v20 migration",
                "verdict": "met",
                "explanation": "Applied migration cleanly."
            }
        ],
        "steps": [
            {
                "id": "step-1",
                "title": "Add schema migration",
                "status": "completed"
            }
        ],
        "files": [
            {
                "path": "crates/host-core/src/goal_reports/mod.rs",
                "changeType": "created",
                "attribution": "direct"
            }
        ],
        "checks": [
            {
                "id": "chk-1",
                "command": "cargo test",
                "result": "passed",
                "exitCode": 0
            }
        ],
        "limitations": ["Initial release"],
        "nextSteps": ["Review"],
        "evidences": [
            {
                "id": "ev-1",
                "kind": "tool_result",
                "refId": "tc-1",
                "summary": "cargo test passed"
            }
        ]
    });

    submit_draft(&db, execution_id, &draft).unwrap();

    // Verify row was updated to draft
    let status: String = db
        .conn()
        .query_row(
            "SELECT status FROM goal_reports WHERE execution_id = ?1",
            params![execution_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "draft");

    // Finalize report
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    let summary = finalize_report(&db, execution_id, 42, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");
    assert_eq!(summary.execution_status.as_deref(), Some("completed"));
    assert_eq!(summary.verdict, "met");
    assert_eq!(summary.integrity, "structured");
    assert_eq!(summary.proposal_id, proposal_id);
    assert_eq!(summary.durable_seq, 42);

    // Read report back through the trusted read model.
    let read = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(read.state, REPORT_STATE_READY);
    assert_eq!(read.integrity.as_deref(), Some("structured"));
    assert_eq!(read.verdict.as_deref(), Some("met"));
    // The hash is recomputed from the bytes on disk, not echoed from the row.
    let on_disk = fs::read(report_file_path(db.data_dir(), session_id, execution_id)).unwrap();
    assert_eq!(
        read.report_sha256.as_deref(),
        Some(sha256_hex(&on_disk).as_str())
    );
    assert_eq!(read.file_bytes, Some(on_disk.len() as u64));
    let report_val = read.report.clone().expect("ready report body");
    assert_eq!(report_val["schemaVersion"], 1);
    assert_eq!(report_val["verdict"], "met");
    assert_eq!(report_val["execution"]["status"], "completed");
    assert_eq!(report_val["execution"]["durableSeq"], 42);
    assert_eq!(report_val["metrics"][0]["label"], "Checks");

    // Verify listing
    let list = list_reports(&db, session_id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].execution_id, execution_id);
    assert_eq!(list[0].status, "ready");
    assert_eq!(list[0].execution_status.as_deref(), Some("completed"));

    // Verify cross-session access is not found and leaks no body.
    let cross = read_report(&db, "another-session", execution_id).unwrap();
    assert_eq!(cross.state, REPORT_STATE_NOT_FOUND);
    assert!(cross.report.is_none());
}

#[test]
fn test_finalize_fallback_when_no_draft() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-fallback";
    let execution_id = "exec-fallback-1";
    seed_goal_execution(&db, session_id, execution_id);
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'interrupted' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    bind_execution_turn(&db, execution_id, "turn-fb").unwrap();

    let summary = finalize_report(
        &db,
        execution_id,
        10,
        Some("interrupted"),
        Some("USER_ABORT"),
    )
    .unwrap();
    assert_eq!(summary.status, "ready");
    assert_eq!(summary.verdict, "blocked");
    assert_eq!(summary.integrity, "fallback");

    // A fallback report is a SUCCESSFUL `ready` read. Its `integrity.kind` is
    // the only signal that no completed structured report exists, so the state
    // must stay `ready` while the integrity stays distinguishable.
    let read = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(read.state, REPORT_STATE_READY);
    assert_eq!(read.integrity.as_deref(), Some("fallback"));
    assert_ne!(read.integrity.as_deref(), Some("structured"));
    assert_eq!(read.verdict.as_deref(), Some("blocked"));
    let report_val = read.report.expect("fallback report body");
    assert_eq!(report_val["schemaVersion"], 1);
    assert_eq!(report_val["integrity"]["kind"], "fallback");
    assert_eq!(report_val["execution"]["status"], "interrupted");
    assert_eq!(report_val["execution"]["errorCode"], "USER_ABORT");
    let summary = list_reports(&db, session_id).unwrap().remove(0);
    assert_eq!(summary.status, "ready");
    assert_eq!(summary.execution_status.as_deref(), Some("interrupted"));
}

#[test]
fn test_submit_draft_bounds() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-bounds";
    let execution_id = "exec-bounds-1";
    seed_goal_execution(&db, session_id, execution_id);

    // 1. Missing summary
    let bad_draft = json!({ "verdict": "met" });
    assert!(submit_draft(&db, execution_id, &bad_draft).is_err());

    // 2. Invalid verdict
    let bad_verdict = json!({ "summary": "ok", "verdict": "super" });
    assert!(submit_draft(&db, execution_id, &bad_verdict).is_err());

    // 3. Exceeds metrics count
    let metrics: Vec<Value> = (0..MAX_METRICS + 1)
        .map(|i| json!({ "label": format!("m{i}"), "value": "1" }))
        .collect();
    let too_many_metrics = json!({
        "summary": "ok",
        "verdict": "met",
        "metrics": metrics
    });
    assert!(submit_draft(&db, execution_id, &too_many_metrics).is_err());
}

#[test]
fn test_submit_draft_uses_shared_structured_fields() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-schema";
    let execution_id = "exec-schema-1";
    seed_goal_execution(&db, session_id, execution_id);

    let legacy = json!({
        "summary": "legacy",
        "verdict": "met",
        "criteria": [{ "id": "c1", "title": "old", "status": "satisfied" }],
        "files": [{ "path": "a", "changeType": "created", "attribution": "agent" }],
        "evidences": [{ "id": "e1", "kind": "command_output", "refId": "x", "summary": "old" }]
    });
    let error = submit_draft(&db, execution_id, &legacy)
        .unwrap_err()
        .to_string();
    assert!(error.starts_with("INVALID_ARGUMENT:"), "{error}");

    let valid = json!({
        "summary": "valid",
        "verdict": "met",
        "criteria": [{ "id": "c1", "text": "criterion", "verdict": "met", "explanation": "ok" }],
        "files": [{ "path": "a", "changeType": "created", "attribution": "declared" }],
        "evidences": [{ "id": "e1", "kind": "tool_result", "refId": "x", "summary": "ok" }]
    });
    submit_draft(&db, execution_id, &valid).unwrap();
}

#[test]
fn test_mark_failed_is_idempotent_and_retry_uses_host_facts() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-failed";
    let execution_id = "exec-failed-1";
    seed_goal_execution(&db, session_id, execution_id);
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();

    submit_draft(
        &db,
        execution_id,
        &json!({ "summary": "stale agent draft", "verdict": "met" }),
    )
    .unwrap();
    mark_failed(&db, session_id, execution_id, "REPORT_DRAFT_PERSIST_FAILED").unwrap();
    mark_failed(&db, session_id, execution_id, "REPORT_DRAFT_PERSIST_FAILED").unwrap();
    let status: String = db
        .conn()
        .query_row(
            "SELECT status FROM goal_reports WHERE execution_id = ?1",
            params![execution_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status, "failed");
    assert!(mark_failed(&db, session_id, execution_id, "UNKNOWN").is_err());

    let automatic_finalization =
        finalize_report(&db, execution_id, 1, Some("completed"), None).unwrap();
    assert_eq!(automatic_finalization.status, "failed");

    let retry = retry_report(&db, session_id, execution_id).unwrap();
    assert_eq!(retry.status, "ready");
    assert_eq!(retry.integrity, "fallback");
    assert_eq!(retry.verdict, "unknown");
    let report = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(report.state, REPORT_STATE_READY, "{:?}", report.detail);
    assert_eq!(report.integrity.as_deref(), Some("fallback"));
    assert_eq!(report.verdict.as_deref(), Some("unknown"));
    let body = report.report.expect("retried fallback report body");
    assert_eq!(body["integrity"]["kind"], "fallback");
    assert_eq!(body["verdict"], "unknown");
}

#[test]
fn test_mark_failed_rejects_cross_session_execution() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-mark-failed-owner";
    let execution_id = "exec-mark-failed-cross";
    seed_goal_execution(&db, session_id, execution_id);
    bind_execution_turn(&db, execution_id, "turn-mark-failed-cross").unwrap();

    let error = mark_failed(
        &db,
        "sess-mark-failed-other",
        execution_id,
        "REPORT_PERSISTENCE_BARRIER_FAILED",
    )
    .unwrap_err();
    assert!(error.to_string().contains("PERMISSION_DENIED"));
    assert_eq!(list_reports(&db, session_id).unwrap()[0].status, "pending");
}

#[test]
fn test_invalidate_draft_triggers_fallback() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-inv";
    let execution_id = "exec-inv-1";
    seed_goal_execution(&db, session_id, execution_id);
    bind_execution_turn(&db, execution_id, "turn-inv").unwrap();

    let draft = json!({
        "summary": "Draft summary that will be invalidated.",
        "verdict": "met"
    });
    submit_draft(&db, execution_id, &draft).unwrap();

    let status: String = db
        .conn()
        .query_row(
            "SELECT status FROM goal_reports WHERE execution_id = ?1",
            params![execution_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "draft");

    // Now invalidate the draft
    invalidate_draft(&db, execution_id).unwrap();

    let status_after: String = db
        .conn()
        .query_row(
            "SELECT status FROM goal_reports WHERE execution_id = ?1",
            params![execution_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status_after, "pending");

    // Finalize report - must fall back
    let summary = finalize_report(&db, execution_id, 1, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");
    assert_eq!(summary.integrity, "fallback");
    assert_eq!(summary.verdict, "unknown");
}

fn structured_draft() -> Value {
    json!({
        "summary": "Verified all acceptance criteria with green tests.",
        "verdict": "met",
        "criteria": [
            { "id": "crit-1", "text": "Report read model", "verdict": "met", "explanation": "Covered." }
        ],
        "checks": [
            { "id": "chk-1", "command": "cargo test", "result": "passed", "exitCode": 0 }
        ],
        "evidences": [
            { "id": "ev-1", "kind": "tool_result", "refId": "tc-1", "summary": "cargo test passed" }
        ]
    })
}

fn ready_structured_file(db: &Database, session_id: &str, execution_id: &str) {
    submit_draft(db, execution_id, &structured_draft()).unwrap();
    finalize_report(db, execution_id, 7, Some("completed"), None).unwrap();
    let _ = session_id;
}

#[test]
fn read_report_states_are_distinct_and_never_conflated() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-states";
    let execution_id = "exec-states-1";
    seed_goal_execution(&db, session_id, execution_id);

    // Unknown target -> not_found.
    let missing = read_report(&db, session_id, "exec-does-not-exist").unwrap();
    assert_eq!(missing.state, REPORT_STATE_NOT_FOUND);
    assert!(missing.report.is_none());
    assert!(missing.report_sha256.is_none());

    // Bound but not finalized -> pending.
    bind_execution_turn(&db, execution_id, "turn-states").unwrap();
    let pending = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(pending.state, REPORT_STATE_PENDING);
    assert!(pending.report.is_none());

    // Submitted draft -> draft, still no body.
    submit_draft(&db, execution_id, &structured_draft()).unwrap();
    let draft = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(draft.state, REPORT_STATE_DRAFT);
    assert!(draft.report.is_none());

    // Finalized -> ready + structured, with a recomputed hash.
    finalize_report(&db, execution_id, 3, Some("completed"), None).unwrap();
    let ready = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(ready.state, REPORT_STATE_READY);
    assert_eq!(ready.integrity.as_deref(), Some("structured"));
    assert!(ready
        .report_sha256
        .as_deref()
        .is_some_and(|hash| hash.len() == 64));
    assert!(ready.report.is_some());
}

#[test]
fn read_report_rejects_corrupt_and_oversized_files_without_a_body() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-corrupt";
    let execution_id = "exec-corrupt-1";
    seed_goal_execution(&db, session_id, execution_id);
    ready_structured_file(&db, session_id, execution_id);

    let path = report_file_path(db.data_dir(), session_id, execution_id);

    // Schema-invalid JSON: parses, but is not a report snapshot.
    fs::write(&path, br#"{"schemaVersion":1,"unexpected":true}"#).unwrap();
    let corrupt = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(corrupt.state, REPORT_STATE_CORRUPT);
    assert!(corrupt.report.is_none(), "corrupt must not return a body");
    assert!(corrupt
        .detail
        .as_deref()
        .unwrap_or_default()
        .starts_with("REPORT_CORRUPT"));

    // Unparseable bytes are also corrupt, not a fabricated empty report.
    fs::write(&path, b"not json at all").unwrap();
    assert_eq!(
        read_report(&db, session_id, execution_id).unwrap().state,
        REPORT_STATE_CORRUPT
    );

    // Identity mismatch: a valid snapshot for another execution id.
    let snapshot = json!({
        "schemaVersion": GOAL_REPORT_SCHEMA_VERSION,
        "reportId": "rep-foreign",
        "sessionId": session_id,
        "executionId": "exec-somebody-else",
        "proposalId": "prop-foreign",
        "turnId": null,
        "goal": { "title": "T", "markdown": "# T" },
        "execution": { "startedAt": 1, "completedAt": 2, "status": "completed", "errorCode": null, "durableSeq": 1 },
        "integrity": { "kind": "structured" },
        "verdict": "met",
        "summary": "foreign",
        "metrics": [], "criteria": [], "steps": [], "files": [], "checks": [],
        "limitations": [], "nextSteps": [], "evidences": []
    });
    fs::write(&path, serde_json::to_vec_pretty(&snapshot).unwrap()).unwrap();
    assert_eq!(
        read_report(&db, session_id, execution_id).unwrap().state,
        REPORT_STATE_CORRUPT
    );

    // Over the 256 KiB ceiling: explicit truncated state, never a cut body.
    let oversized = vec![b' '; MAX_REPORT_JSON_BYTES + 1];
    fs::write(&path, &oversized).unwrap();
    let truncated = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(truncated.state, REPORT_STATE_TRUNCATED);
    assert!(truncated.report.is_none());
    assert_eq!(truncated.file_bytes, Some(oversized.len() as u64));
    assert_eq!(truncated.max_bytes, MAX_REPORT_JSON_BYTES as u64);
}

#[test]
fn read_report_is_not_found_across_sessions_and_survives_a_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("pi.sqlite");
    let db = Database::open(&db_path).unwrap();
    let session_id = "sess-durable";
    let execution_id = "exec-durable-1";
    seed_goal_execution(&db, session_id, execution_id);
    ready_structured_file(&db, session_id, execution_id);
    let before = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(before.state, REPORT_STATE_READY);
    let before_hash = before.report_sha256.clone();

    // Cross-session lookup of another session's execution must not leak a body.
    let other = read_report(&db, "sess-other", execution_id).unwrap();
    assert_eq!(other.state, REPORT_STATE_NOT_FOUND);
    assert!(other.report.is_none());

    // Re-open the same data directory: the trusted read is stable and rebuilt
    // from disk, so the recomputed hash must match the pre-restart value.
    drop(db);
    let reopened = Database::open(&db_path).unwrap();
    let after = read_report(&reopened, session_id, execution_id).unwrap();
    assert_eq!(after.state, REPORT_STATE_READY);
    assert_eq!(after.report_sha256, before_hash);
    assert_eq!(after.integrity.as_deref(), Some("structured"));
}
