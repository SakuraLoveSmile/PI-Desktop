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
    let summary = finalize_report(&db, execution_id, 42, Some("completed"), None).unwrap();
    assert_eq!(summary.status, "ready");
    assert_eq!(summary.verdict, "met");
    assert_eq!(summary.integrity, "structured");
    assert_eq!(summary.proposal_id, proposal_id);
    assert_eq!(summary.durable_seq, 42);

    // Read report back through get_report
    let report_val = get_report(&db, session_id, execution_id)
        .unwrap()
        .expect("report should exist");
    assert_eq!(report_val["schemaVersion"], 1);
    assert_eq!(report_val["verdict"], "met");
    assert_eq!(report_val["execution"]["status"], "completed");
    assert_eq!(report_val["execution"]["durableSeq"], 42);
    assert_eq!(report_val["metrics"][0]["label"], "Checks");

    // Verify listing
    let list = list_reports(&db, session_id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].execution_id, execution_id);

    // Verify cross-session access is rejected
    let cross = get_report(&db, "another-session", execution_id).unwrap();
    assert!(cross.is_none());
}

#[test]
fn test_finalize_fallback_when_no_draft() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-fallback";
    let execution_id = "exec-fallback-1";
    seed_goal_execution(&db, session_id, execution_id);
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

    let report_val = get_report(&db, session_id, execution_id)
        .unwrap()
        .expect("report should exist");
    assert_eq!(report_val["schemaVersion"], 1);
    assert_eq!(report_val["integrity"]["kind"], "fallback");
    assert_eq!(report_val["execution"]["status"], "interrupted");
    assert_eq!(report_val["execution"]["errorCode"], "USER_ABORT");
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
