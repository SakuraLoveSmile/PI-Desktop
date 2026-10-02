use rusqlite::params;
use uuid::Uuid;

use super::*;
use crate::db::Database;

fn create_test_db() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open_in_dir(dir.path()).unwrap();
    (dir, db)
}

fn seed_running_turn_and_goal(db: &Database, session_id: &str, execution_id: &str, turn_id: &str) {
    let now = now_ms();
    // 1. Session
    db.conn()
        .prepare_cached(
            "INSERT INTO sessions (id, title, mode, permission_mode, created_at, updated_at)
             VALUES (?1, 'Test Session', 'goal', 'accept-edits', ?2, ?2)",
        )
        .unwrap()
        .execute(params![session_id, now])
        .unwrap();

    // 2. Running turn (ended_at is null)
    db.conn()
        .prepare_cached(
            "INSERT INTO turns (id, session_id, provider_id, model_id, started_at, status)
             VALUES (?1, ?2, 'test-prov', 'test-model', ?3, 'streaming')",
        )
        .unwrap()
        .execute(params![turn_id, session_id, now])
        .unwrap();

    // 3. Goal execution in 'running' state
    db.conn()
        .prepare_cached(
            "INSERT INTO plan_approvals (
                request_id, session_id, turn_id, tool_call_id, kind, plan_json,
                title, question, status, action, target_permission_mode,
                created_at, updated_at, execution_id, execution_state,
                artifact_relative_path, artifact_sha256, artifact_size_bytes
             ) VALUES (
                ?1, ?2, ?3, ?4, 'goal', '# Goal', 'Goal Title', 'Approve?',
                'approved', 'approve', 'accept-edits', ?5, ?5, ?6, 'running',
                '.pi/goal/test.md', 'hash', 100
             )",
        )
        .unwrap()
        .execute(params![
            format!("prop-{}", Uuid::new_v4().simple()),
            session_id,
            turn_id,
            format!("tc-{execution_id}"),
            now,
            execution_id
        ])
        .unwrap();
    crate::goal_reports::bind_execution_turn(db, execution_id, turn_id).unwrap();
}

#[test]
fn test_goal_progress_issue_token_and_update_lifecycle() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-prog-1";
    let execution_id = "exec-prog-1";
    let turn_id = "turn-prog-1";

    seed_running_turn_and_goal(&db, session_id, execution_id, turn_id);

    // 1. Issue write token
    let token = issue_write_token(&db, session_id, execution_id, turn_id).unwrap();
    assert!(token.starts_with("gptk_"));

    // 2. Initial update (revision 1)
    let items = vec![
        GoalProgressItem {
            id: "step-1".into(),
            label: "Research requirements".into(),
            status: "completed".into(),
        },
        GoalProgressItem {
            id: "step-2".into(),
            label: "Implement changes".into(),
            status: "in_progress".into(),
        },
    ];
    let snap1 =
        update_progress(&db, session_id, execution_id, &token, None, items.clone()).unwrap();
    assert_eq!(snap1.revision, 1);
    assert_eq!(snap1.items.len(), 2);
    assert_eq!(snap1.items[0].status, "completed");

    // 3. Get progress
    let retrieved = get_progress(&db, Some(session_id), execution_id)
        .unwrap()
        .unwrap();
    assert_eq!(retrieved.revision, 1);
    assert_eq!(retrieved.items, snap1.items);

    // 4. Update with expectedRevision
    let snap2 = update_progress(
        &db,
        session_id,
        execution_id,
        &token,
        Some(1),
        items.clone(),
    )
    .unwrap();
    assert_eq!(snap2.revision, 2);

    // 5. Concurrency conflict on stale revision
    let conflict_err = update_progress(
        &db,
        session_id,
        execution_id,
        &token,
        Some(1), // Stale revision (expected 2)
        items,
    )
    .unwrap_err();
    assert!(conflict_err.to_string().contains("CONFLICT"));

    // 6. Unauthorized on fake token
    let unauth_err = update_progress(
        &db,
        session_id,
        execution_id,
        "gptk_fake_token",
        None,
        vec![],
    )
    .unwrap_err();
    assert!(unauth_err.to_string().contains("UNAUTHORIZED"));

    invalidate_write_token_conn(db.conn(), execution_id).unwrap();
    let invalidated_err =
        update_progress(&db, session_id, execution_id, &token, None, vec![]).unwrap_err();
    assert!(invalidated_err.to_string().contains("UNAUTHORIZED"));
}

#[test]
fn test_goal_progress_rejects_non_running_execution_or_turn() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-prog-2";
    let execution_id = "exec-prog-2";
    let turn_id = "turn-prog-2";

    seed_running_turn_and_goal(&db, session_id, execution_id, turn_id);
    let token = issue_write_token(&db, session_id, execution_id, turn_id).unwrap();

    // End the turn
    let now = now_ms();
    db.conn()
        .execute(
            "UPDATE turns SET ended_at = ?1, status = 'complete' WHERE id = ?2",
            params![now, turn_id],
        )
        .unwrap();

    let err = update_progress(&db, session_id, execution_id, &token, None, vec![]).unwrap_err();
    assert!(err.to_string().contains("GOAL_PROGRESS_NOT_RUNNING"));

    // Reset turn to running but execution to completed
    db.conn()
        .execute(
            "UPDATE turns SET ended_at = NULL, status = 'streaming' WHERE id = ?1",
            params![turn_id],
        )
        .unwrap();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();

    let err2 = update_progress(&db, session_id, execution_id, &token, None, vec![]).unwrap_err();
    assert!(err2.to_string().contains("GOAL_PROGRESS_NOT_RUNNING"));
}

#[test]
fn test_goal_progress_token_requires_approved_goal_turn() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-prog-binding";
    let execution_id = "exec-prog-binding";
    let proposal_turn_id = "turn-prog-proposal";
    let approved_turn_id = "turn-prog-approved";
    let unrelated_turn_id = "turn-prog-unrelated";

    seed_running_turn_and_goal(&db, session_id, execution_id, proposal_turn_id);
    let now = now_ms();
    db.conn()
        .execute(
            "INSERT INTO turns (id, session_id, provider_id, model_id, started_at, status)
             VALUES (?1, ?2, 'test-prov', 'test-model', ?3, 'streaming'),
                    (?4, ?2, 'test-prov', 'test-model', ?3, 'streaming')",
            params![approved_turn_id, session_id, now, unrelated_turn_id],
        )
        .unwrap();
    crate::goal_reports::bind_execution_turn(&db, execution_id, approved_turn_id).unwrap();

    // A Plan proposal can be approved for Goal execution; use the effective kind.
    db.conn()
        .execute(
            "UPDATE plan_approvals SET kind = 'plan', execution_kind = 'goal' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();

    let err = issue_write_token(&db, session_id, execution_id, unrelated_turn_id).unwrap_err();
    assert!(err.to_string().contains("UNAUTHORIZED"));

    let token = issue_write_token(&db, session_id, execution_id, approved_turn_id).unwrap();
    let plan = db
        .conn()
        .execute(
            "UPDATE plan_approvals SET execution_kind = 'plan' WHERE execution_id = ?1",
            params![execution_id],
        )
        .unwrap();
    assert_eq!(plan, 1);
    let err = issue_write_token(&db, session_id, execution_id, approved_turn_id).unwrap_err();
    assert!(err.to_string().contains("UNAUTHORIZED"));

    let err = update_progress(&db, session_id, execution_id, &token, None, vec![]).unwrap_err();
    assert!(err.to_string().contains("UNAUTHORIZED"));
}

#[test]
fn test_goal_progress_session_cleanup_removes_only_its_snapshots_and_tokens() {
    let (_dir, db) = create_test_db();
    seed_running_turn_and_goal(&db, "sess-clean-1", "exec-clean-1", "turn-clean-1");
    seed_running_turn_and_goal(&db, "sess-clean-2", "exec-clean-2", "turn-clean-2");
    let token1 = issue_write_token(&db, "sess-clean-1", "exec-clean-1", "turn-clean-1").unwrap();
    let token2 = issue_write_token(&db, "sess-clean-2", "exec-clean-2", "turn-clean-2").unwrap();
    update_progress(&db, "sess-clean-1", "exec-clean-1", &token1, None, vec![]).unwrap();
    update_progress(&db, "sess-clean-2", "exec-clean-2", &token2, None, vec![]).unwrap();

    cleanup_session_conn(db.conn(), "sess-clean-1").unwrap();

    assert!(get_progress(&db, Some("sess-clean-1"), "exec-clean-1")
        .unwrap()
        .is_none());
    assert!(get_progress(&db, Some("sess-clean-2"), "exec-clean-2")
        .unwrap()
        .is_some());
    let auth1: Option<String> = db
        .conn()
        .query_row(
            "SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2",
            params![GOAL_PROGRESS_AUTH_KV_NAMESPACE, "exec-clean-1"],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    let auth2: Option<String> = db
        .conn()
        .query_row(
            "SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2",
            params![GOAL_PROGRESS_AUTH_KV_NAMESPACE, "exec-clean-2"],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(auth1.is_none());
    assert!(auth2.is_some());

    cleanup_auth_tokens_conn(db.conn()).unwrap();
    let remaining_auth: Option<String> = db
        .conn()
        .query_row(
            "SELECT value_json FROM kv WHERE ns = ?1 AND key = ?2",
            params![GOAL_PROGRESS_AUTH_KV_NAMESPACE, "exec-clean-2"],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    assert!(remaining_auth.is_none());
}

#[test]
fn test_goal_progress_accepts_failed_and_normalizes_items() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-prog-normalize";
    let execution_id = "exec-prog-normalize";
    let turn_id = "turn-prog-normalize";
    seed_running_turn_and_goal(&db, session_id, execution_id, turn_id);
    let token = issue_write_token(&db, session_id, execution_id, turn_id).unwrap();

    let snap = update_progress(
        &db,
        session_id,
        execution_id,
        &token,
        None,
        vec![GoalProgressItem {
            id: "  step-1  ".into(),
            label: "  Failed check  ".into(),
            status: "failed".into(),
        }],
    )
    .unwrap();
    assert_eq!(snap.items[0].id, "step-1");
    assert_eq!(snap.items[0].label, "Failed check");
    assert_eq!(snap.items[0].status, "failed");

    let duplicate_err = update_progress(
        &db,
        session_id,
        execution_id,
        &token,
        None,
        vec![
            GoalProgressItem {
                id: "step-2".into(),
                label: "A".into(),
                status: "pending".into(),
            },
            GoalProgressItem {
                id: " step-2 ".into(),
                label: "B".into(),
                status: "pending".into(),
            },
        ],
    )
    .unwrap_err();
    assert!(duplicate_err.to_string().contains("duplicate item id"));
}
