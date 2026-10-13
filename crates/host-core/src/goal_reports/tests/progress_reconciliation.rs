use super::*;
use crate::goal_progress::{self, GoalProgressItem};

fn start_goal(db: &Database) -> String {
    seed_goal_execution(db, "session-progress", "execution-progress");
    db.conn()
        .execute(
            "INSERT INTO turns (id, session_id, provider_id, model_id, started_at, status)
             VALUES ('turn-progress', 'session-progress', 'test', 'test', ?1, 'streaming')",
            params![now_ms()],
        )
        .unwrap();
    bind_execution_turn(db, "execution-progress", "turn-progress").unwrap();
    goal_progress::issue_write_token(
        db,
        "session-progress",
        "execution-progress",
        "turn-progress",
    )
    .unwrap()
}

fn update(db: &Database, token: &str, statuses: &[&str]) {
    goal_progress::update_progress(
        db,
        "session-progress",
        "execution-progress",
        token,
        None,
        statuses
            .iter()
            .enumerate()
            .map(|(index, status)| GoalProgressItem {
                id: format!("step-{index}"),
                label: format!("Work item {index}"),
                status: status.to_string(),
            })
            .collect(),
    )
    .unwrap();
}

fn finish(db: &Database) -> Value {
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state = 'completed'
             WHERE execution_id = 'execution-progress'",
            [],
        )
        .unwrap();
    finalize_with_closure(
        db,
        "execution-progress",
        1,
        Some("completed"),
        None,
        "user_accepted",
        true,
    )
    .unwrap();
    read_report(db, "session-progress", "execution-progress")
        .unwrap()
        .report
        .unwrap()
}

#[test]
fn met_report_requires_progress_reconciliation_then_publishes_structured() {
    let (_dir, db) = create_test_db();
    let token = start_goal(&db);
    for status in ["pending", "in_progress", "failed"] {
        update(&db, &token, &["completed", status]);
        let error = submit_draft(
            &db,
            "execution-progress",
            &json!({"summary": "All work complete", "verdict": "met"}),
        )
        .unwrap_err()
        .to_string();
        assert!(error.starts_with("INVALID_ARGUMENT:"), "{error}");
        assert!(error.contains("UpdateGoalProgress"), "{error}");
        assert!(!draft_file_path(db.data_dir(), "session-progress", "execution-progress").exists());
    }
    for verdict in ["partial", "blocked"] {
        submit_draft(
            &db,
            "execution-progress",
            &json!({"summary": "Work remains", "verdict": verdict}),
        )
        .unwrap();
    }
    update(&db, &token, &["completed", "completed"]);
    submit_draft(
        &db,
        "execution-progress",
        &json!({"summary": "All work complete", "verdict": "met"}),
    )
    .unwrap();
    let report = finish(&db);
    assert_eq!(report["verdict"], "met");
    assert_eq!(report["integrity"]["kind"], "structured");
}

#[test]
fn accepted_host_facts_retains_latest_progress_without_inventing_completion() {
    let (_dir, db) = create_test_db();
    let token = start_goal(&db);
    update(&db, &token, &["pending"]);
    update(
        &db,
        &token,
        &["completed", "failed", "pending", "in_progress"],
    );
    let report = finish(&db);
    assert_eq!(report["integrity"]["kind"], "fallback");
    assert_eq!(report["verdict"], "partial");
    let steps = report["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 4);
    for (index, expected) in ["completed", "failed", "skipped", "skipped"]
        .iter()
        .enumerate()
    {
        assert_eq!(steps[index]["id"], format!("step-{index}"));
        assert_eq!(steps[index]["title"], format!("Work item {index}"));
        assert_eq!(steps[index]["status"], *expected);
        assert!(steps[index]["detail"]
            .as_str()
            .unwrap()
            .contains("revision 2"));
    }
    assert!(steps[2]["detail"].as_str().unwrap().contains("pending"));
    assert!(steps[3]["detail"].as_str().unwrap().contains("in_progress"));
    let snapshot = goal_progress::get_progress(&db, Some("session-progress"), "execution-progress")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.items[2].status, "pending");
    assert_eq!(snapshot.items[3].status, "in_progress");
}

#[test]
fn accepted_host_facts_verdict_does_not_claim_unverified_success() {
    for (statuses, expected) in [
        (vec!["pending", "in_progress"], "unknown"),
        (vec!["failed", "pending"], "blocked"),
        (vec!["completed", "completed"], "partial"),
        (vec![], "unknown"),
    ] {
        let (_dir, db) = create_test_db();
        let token = start_goal(&db);
        update(&db, &token, &statuses);
        assert_eq!(finish(&db)["verdict"], expected);
    }
}

#[test]
fn changed_progress_prevents_a_stale_met_draft_from_finalizing() {
    let (_dir, db) = create_test_db();
    let token = start_goal(&db);
    update(&db, &token, &["completed"]);
    submit_draft(
        &db,
        "execution-progress",
        &json!({"summary": "All complete", "verdict": "met"}),
    )
    .unwrap();
    update(&db, &token, &["completed", "pending"]);
    let report = finish(&db);
    assert_eq!(report["verdict"], "partial");
    assert_eq!(report["integrity"]["kind"], "fallback");
    assert_eq!(report["steps"][1]["status"], "skipped");
}

#[test]
fn accepted_host_facts_bounds_steps_and_discloses_omitted_progress() {
    let (_dir, db) = create_test_db();
    let token = start_goal(&db);
    let mut statuses = vec!["pending"; MAX_STEPS + 1];
    statuses[MAX_STEPS] = "completed";
    update(&db, &token, &statuses);
    let report = finish(&db);
    assert_eq!(report["steps"].as_array().unwrap().len(), MAX_STEPS);
    assert_eq!(report["verdict"], "partial");
    assert!(report["limitations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| {
            value
                .as_str()
                .is_some_and(|text| text.contains("1") && text.contains("omitted"))
        }));
}

#[test]
fn accepted_host_facts_bounds_large_utf8_and_escaped_progress_strings() {
    let (_dir, db) = create_test_db();
    let token = start_goal(&db);
    goal_progress::update_progress(
        &db,
        "session-progress",
        "execution-progress",
        &token,
        None,
        (0..MAX_STEPS)
            .map(|index| GoalProgressItem {
                id: format!("{}-step-{index}", "界".repeat(1024)),
                label: "\0界".repeat(4096),
                status: "completed".into(),
            })
            .collect(),
    )
    .unwrap();
    let report = finish(&db);
    assert_eq!(report["verdict"], "partial");
    assert!(serde_json::to_vec_pretty(&report).unwrap().len() <= MAX_REPORT_JSON_BYTES);
    let steps = report["steps"].as_array().unwrap();
    assert!(!steps.is_empty());
    assert!(steps.len() < MAX_STEPS);
    let ids: std::collections::HashSet<_> = steps.iter().map(|step| &step["id"]).collect();
    assert_eq!(ids.len(), steps.len());
    for step in steps {
        assert!(step["id"].as_str().unwrap().len() <= 1024);
        assert!(step["title"].as_str().unwrap().len() <= 1024);
    }
    let limitations = report["limitations"].to_string();
    assert!(limitations.contains("truncated"));
    assert!(limitations.contains("omitted"));
}

#[test]
fn accepted_host_facts_never_includes_another_execution_proposal_or_session_snapshot() {
    for field in ["executionId", "proposalId", "sessionId"] {
        let (_dir, db) = create_test_db();
        let token = start_goal(&db);
        update(&db, &token, &["completed"]);
        let raw: String = db
            .conn()
            .query_row(
                "SELECT value_json FROM kv WHERE ns = ?1 AND key = 'execution-progress'",
                params![goal_progress::GOAL_PROGRESS_KV_NAMESPACE],
                |row| row.get(0),
            )
            .unwrap();
        let mut snapshot: Value = serde_json::from_str(&raw).unwrap();
        snapshot[field] = json!("unrelated-identity");
        db.conn()
            .execute(
                "UPDATE kv SET value_json = ?1 WHERE ns = ?2 AND key = 'execution-progress'",
                params![
                    snapshot.to_string(),
                    goal_progress::GOAL_PROGRESS_KV_NAMESPACE
                ],
            )
            .unwrap();
        let report = finish(&db);
        assert_eq!(report["verdict"], "unknown");
        assert!(report["steps"].as_array().unwrap().is_empty());
    }
}
