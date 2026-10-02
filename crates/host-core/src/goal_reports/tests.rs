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
fn test_submit_draft_rejects_terminal_reports_without_mutation() {
    let (_dir, db) = create_test_db();
    let ready_session_id = "sess-terminal-ready";
    let failed_session_id = "sess-terminal-failed";
    let ready_execution_id = "exec-terminal-ready";
    let failed_execution_id = "exec-terminal-failed";
    seed_goal_execution(&db, ready_session_id, ready_execution_id);
    seed_goal_execution(&db, failed_session_id, failed_execution_id);

    let original_draft = json!({
        "summary": "Original report",
        "verdict": "met"
    });
    submit_draft(&db, ready_execution_id, &original_draft).unwrap();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![ready_execution_id],
        )
        .unwrap();
    finalize_report(&db, ready_execution_id, 1, Some("completed"), None).unwrap();
    mark_failed(
        &db,
        failed_session_id,
        failed_execution_id,
        "REPORT_PERSISTENCE_BARRIER_FAILED",
    )
    .unwrap();

    let replacement = json!({
        "summary": "Replacement report",
        "verdict": "blocked"
    });
    for (session_id, execution_id) in [
        (ready_session_id, ready_execution_id),
        (failed_session_id, failed_execution_id),
    ] {
        let before = list_reports(&db, session_id)
            .unwrap()
            .into_iter()
            .find(|report| report.execution_id == execution_id)
            .unwrap();
        let before_read = read_report(&db, session_id, execution_id).unwrap();
        let draft_path = draft_file_path(db.data_dir(), session_id, execution_id);
        assert!(!draft_path.exists());

        let error = submit_draft(&db, execution_id, &replacement)
            .unwrap_err()
            .to_string();
        assert!(error.starts_with("INVALID_ARGUMENT:"), "{error}");

        let after = list_reports(&db, session_id)
            .unwrap()
            .into_iter()
            .find(|report| report.execution_id == execution_id)
            .unwrap();
        let after_read = read_report(&db, session_id, execution_id).unwrap();
        assert_eq!(after.status, before.status);
        assert_eq!(after.summary, before.summary);
        assert_eq!(after.verdict, before.verdict);
        assert_eq!(after.file_path, before.file_path);
        assert_eq!(after.file_hash, before.file_hash);
        assert_eq!(after.file_size, before.file_size);
        assert_eq!(after_read.state, before_read.state);
        assert_eq!(after_read.report, before_read.report);
        assert!(!draft_path.exists());
    }
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
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
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
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
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
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
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
#[test]
fn test_assets_save_and_chunk_read() {
    let (dir, db) = create_test_db();
    let session_id = "sess-assets";
    let execution_id = "exec-assets-1";
    seed_goal_execution(&db, session_id, execution_id);

    // Create a dummy attachment file in data_dir/attachments/test-sc.png
    let att_dir = dir.path().join("attachments");
    fs::create_dir_all(&att_dir).unwrap();
    // Valid PNG signature: \x89PNG\r\n\x1a\n plus some bytes
    let mut png_bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    png_bytes.extend_from_slice(b"TEST_IMAGE_DATA_1234567890");
    let test_img_path = att_dir.join("test-img-hash.png");
    fs::write(&test_img_path, &png_bytes).unwrap();
    crate::transcripts::append_message(
        db.data_dir(),
        session_id,
        "2025-01-01T00:00:00Z",
        &crate::transcripts::MessageRecord {
            id: "attachment-message".to_string(),
            role: "user".to_string(),
            tool_name: None,
            is_error: false,
            blocks: json!([{
                "type": "attachment",
                "kind": "image",
                "name": "test-img-hash.png",
                "ref": "attachments/test-img-hash.png"
            }]),
            meta: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
        },
    )
    .unwrap();

    let draft = json!({
        "summary": "Report with screenshot asset",
        "verdict": "met",
        "screenshots": [
            {
                "id": "sc-1",
                "evidenceRef": "ev-1",
                "title": "Main Screenshot"
            }
        ],
        "evidences": [
            {
                "id": "ev-1",
                "kind": "file",
                "refId": "attachments/test-img-hash.png",
                "summary": "Screenshot evidence"
            }
        ]
    });

    submit_draft(&db, execution_id, &draft).unwrap();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    let summary = finalize_report(&db, execution_id, 10, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");

    let read = read_report(&db, session_id, execution_id).unwrap();
    assert_eq!(read.state, "ready");
    let rep = read.report.unwrap();
    let assets = rep.get("assets").and_then(Value::as_array).unwrap();
    assert_eq!(assets.len(), 1);
    assert_eq!(
        assets[0].get("screenshotId").and_then(Value::as_str),
        Some("sc-1")
    );
    assert_eq!(
        assets[0].get("mimeType").and_then(Value::as_str),
        Some("image/png")
    );

    // Read asset chunk
    let chunk =
        assets::read_asset_chunk(db.data_dir(), session_id, execution_id, "sc-1", 0, Some(10));
    assert_eq!(chunk.state, "ready");
    assert_eq!(chunk.length, Some(10));
    assert_eq!(chunk.eof, Some(false));
    assert_eq!(chunk.total_bytes, Some(png_bytes.len() as u64));
    assert!(chunk.data_base64.is_some());

    // Read remaining chunk
    let chunk_end =
        assets::read_asset_chunk(db.data_dir(), session_id, execution_id, "sc-1", 10, None);
    assert_eq!(chunk_end.state, "ready");
    assert_eq!(chunk_end.length, Some(png_bytes.len() - 10));
    assert_eq!(chunk_end.eof, Some(true));

    // Non-existent screenshot
    let missing_chunk = assets::read_asset_chunk(
        db.data_dir(),
        session_id,
        execution_id,
        "non-existent",
        0,
        None,
    );
    assert_eq!(missing_chunk.state, "unavailable");

    let outside = dir.path().join("outside.png");
    fs::write(&outside, &png_bytes).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, att_dir.join("escape.png")).unwrap();
    let unsafe_draft = json!({
        "screenshots": [
            { "id": "sc-escape", "evidenceRef": "ev-escape" },
            { "id": "sc-absolute", "evidenceRef": "ev-absolute" }
        ],
        "evidences": [
            { "id": "ev-escape", "kind": "file", "refId": "attachments/escape.png" },
            { "id": "ev-absolute", "kind": "file", "refId": outside.to_string_lossy() }
        ]
    });
    let (unsafe_assets, warnings) = assets::resolve_and_save_assets(
        db.data_dir(),
        session_id,
        "exec-unsafe-assets",
        &unsafe_draft,
    );
    assert!(unsafe_assets.is_empty());
    assert_eq!(warnings.len(), 2);
}

#[test]
fn test_evidence_resolution_and_check_observations() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-ev";
    let execution_id = "exec-ev-1";
    seed_goal_execution(&db, session_id, execution_id);

    // Insert a message in this session with seq = 5
    db.conn()
        .execute(
            "INSERT INTO messages (id, session_id, seq, role, text, created_at)
         VALUES ('msg-recorded-1', 'sess-ev', 5, 'assistant', 'output evidence text', 1000)",
            params![],
        )
        .unwrap();
    let tool_record = crate::transcripts::MessageRecord {
        id: "tool-recorded-1".to_string(),
        role: "tool".to_string(),
        tool_name: Some("Bash".to_string()),
        is_error: false,
        blocks: json!([{
            "type": "tool_call",
            "callId": "tc-recorded",
            "name": "Bash",
            "args": { "command": "cargo check" },
            "result": { "exitCode": 0 },
            "status": "success"
        }]),
        meta: None,
        created_at: "2025-01-01T00:00:00Z".to_string(),
    };
    crate::transcripts::append_message(
        db.data_dir(),
        session_id,
        "2025-01-01T00:00:00Z",
        &tool_record,
    )
    .unwrap();
    db.conn()
        .execute(
            "INSERT INTO messages (id, session_id, seq, role, tool_name, created_at)
             VALUES ('tool-recorded-1', 'sess-ev', 6, 'tool', 'Bash', 1001)",
            params![],
        )
        .unwrap();
    db.conn()
        .execute(
            "INSERT INTO messages (id, session_id, seq, role, text, created_at)
             VALUES ('future-message', 'sess-ev', 11, 'assistant', 'future-message', 1002)",
            params![],
        )
        .unwrap();

    let draft = json!({
        "summary": "Check observations and evidence",
        "verdict": "met",
        "evidences": [
            {
                "id": "ev-recorded",
                "kind": "message",
                "refId": "msg-recorded-1",
                "summary": "Found in message"
            },
            {
                "id": "ev-missing",
                "kind": "tool_call",
                "refId": "tc-not-found",
                "summary": "Missing ref"
            },
            {
                "id": "ev-tool",
                "kind": "tool_result",
                "refId": "tc-recorded",
                "summary": "Recorded command result"
            },
            {
                "id": "ev-wildcard",
                "kind": "message",
                "refId": "%",
                "summary": "Must not match text"
            },
            {
                "id": "ev-future",
                "kind": "message",
                "refId": "future-message",
                "summary": "Outside durable boundary"
            }
        ],
        "checks": [
            {
                "id": "chk-passed",
                "command": "cargo check",
                "exitCode": 17,
                "evidenceRefs": ["ev-tool"],
                "result": "passed"
            },
            {
                "id": "chk-failed",
                "command": "npm test",
                "exitCode": 1,
                "result": "passed" // Model claimed passed, but exitCode 1 -> observation failed
            },
            {
                "id": "chk-blocked",
                "command": "deploy.sh",
                "disposition": "blocked",
                "result": "inconclusive"
            }
        ]
    });

    submit_draft(&db, execution_id, &draft).unwrap();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    let summary = finalize_report(&db, execution_id, 10, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");

    let read = read_report(&db, session_id, execution_id).unwrap();
    let rep = read.report.unwrap();

    let ev_res = rep
        .get("evidenceResolution")
        .and_then(Value::as_array)
        .unwrap();
    assert_eq!(ev_res.len(), 5);
    assert_eq!(
        ev_res[0].get("state").and_then(Value::as_str),
        Some("recorded")
    );
    assert_eq!(
        ev_res[1].get("state").and_then(Value::as_str),
        Some("unresolved")
    );
    assert_eq!(
        ev_res[2].get("state").and_then(Value::as_str),
        Some("unresolved")
    );
    assert_eq!(
        ev_res[3].get("state").and_then(Value::as_str),
        Some("unresolved")
    );
    assert_eq!(
        ev_res[4].get("state").and_then(Value::as_str),
        Some("unresolved")
    );

    let chk_obs = rep
        .get("checkObservations")
        .and_then(Value::as_array)
        .unwrap();
    assert_eq!(chk_obs.len(), 3);
    assert_eq!(
        chk_obs[0].get("result").and_then(Value::as_str),
        Some("passed")
    );
    assert_eq!(
        chk_obs[1].get("result").and_then(Value::as_str),
        Some("inconclusive")
    );
    assert_eq!(
        chk_obs[2].get("result").and_then(Value::as_str),
        Some("inconclusive")
    );
    assert_eq!(
        chk_obs[0].get("result").and_then(Value::as_str),
        Some("passed")
    );
    assert_eq!(chk_obs[0].get("exitCode").and_then(Value::as_i64), Some(0));
}

#[test]
fn test_finalize_rejects_non_terminal_execution() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-non-terminal";
    let execution_id = "exec-non-terminal-1";
    seed_goal_execution(&db, session_id, execution_id);

    // Initial state is 'running'
    let err = finalize_report(&db, execution_id, 1, None, None).unwrap_err();
    assert!(err.to_string().contains("GOAL_EXECUTION_NOT_TERMINAL"));

    // Also rejects even if override says completed but db says running
    let err2 = finalize_report(&db, execution_id, 1, Some("completed"), None).unwrap_err();
    assert!(err2.to_string().contains("GOAL_EXECUTION_NOT_TERMINAL"));

    // Set to queued
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'queued' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    let err3 = finalize_report(&db, execution_id, 1, None, None).unwrap_err();
    assert!(err3.to_string().contains("GOAL_EXECUTION_NOT_TERMINAL"));

    // Missing execution_state (NULL)
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = NULL WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    let err4 = finalize_report(&db, execution_id, 1, None, None).unwrap_err();
    assert!(err4.to_string().contains("GOAL_EXECUTION_NOT_TERMINAL"));

    // Verify report file was not written and status is not ready
    let report_path = report_file_path(db.data_dir(), session_id, execution_id);
    assert!(!report_path.exists());
}
