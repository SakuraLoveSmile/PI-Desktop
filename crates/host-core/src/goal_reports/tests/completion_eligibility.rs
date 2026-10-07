use super::*;

#[test]
fn test_finalize_rejects_interrupted_without_mutation() {
    for with_draft in [false, true] {
        for override_status in [None, Some("interrupted"), Some("completed")] {
            let (_dir, db) = create_test_db();
            let session_id = "sess-interrupted";
            let execution_id = "exec-interrupted";
            seed_goal_execution(&db, session_id, execution_id);
            bind_execution_turn(&db, execution_id, "turn-interrupted").unwrap();
            if with_draft {
                submit_draft(&db, execution_id, &structured_draft()).unwrap();
            }
            db.conn().execute(
                "UPDATE plan_approvals SET execution_state = 'interrupted', error_code = 'USER_CANCELLED' WHERE execution_id = ?1",
                params![execution_id],
            ).unwrap();
            let before = serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap();
            let draft_path = draft_file_path(db.data_dir(), session_id, execution_id);
            let draft_before = fs::read(&draft_path).ok();

            let error = finalize_report(&db, execution_id, 99, override_status, None).unwrap_err();
            assert!(error
                .to_string()
                .starts_with("GOAL_EXECUTION_NOT_TERMINAL:"));
            assert_eq!(
                serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap(),
                before
            );
            assert_eq!(fs::read(&draft_path).ok(), draft_before);
            assert!(!report_file_path(db.data_dir(), session_id, execution_id).exists());
            let read = read_report(&db, session_id, execution_id).unwrap();
            assert_ne!(read.state, REPORT_STATE_READY);
            assert!(read.report.is_none());
        }
    }
}

#[test]
fn test_finalize_rejects_interrupted_override_for_completed_execution() {
    let (_dir, db) = create_test_db();
    let session_id = "sess-completed-override";
    let execution_id = "exec-completed-override";
    seed_goal_execution(&db, session_id, execution_id);
    ready_structured_file(&db, session_id, execution_id);
    let before = serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap();
    let report_path = report_file_path(db.data_dir(), session_id, execution_id);
    let bytes = fs::read(&report_path).unwrap();
    let error = finalize_report(
        &db,
        execution_id,
        99,
        Some("interrupted"),
        Some("USER_CANCELLED"),
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .starts_with("GOAL_EXECUTION_NOT_TERMINAL:"));
    assert_eq!(
        serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap(),
        before
    );
    assert_eq!(fs::read(&report_path).unwrap(), bytes);
}

#[test]
fn test_retry_rejects_uncompleted_execution_before_any_mutation() {
    for execution_state in ["running", "interrupted"] {
        for report_state in ["absent", "pending", "draft", "failed", "ready"] {
            let (_dir, db) = create_test_db();
            let session_id = "sess-retry-uncompleted";
            let execution_id = "exec-retry-uncompleted";
            seed_goal_execution(&db, session_id, execution_id);
            if report_state == "ready" {
                // Model an existing legacy ready report without deleting or rewriting it.
                ready_structured_file(&db, session_id, execution_id);
            } else {
                if report_state != "absent" {
                    bind_execution_turn(&db, execution_id, "turn-retry").unwrap();
                    if matches!(report_state, "draft" | "failed") {
                        submit_draft(&db, execution_id, &structured_draft()).unwrap();
                    }
                    if report_state == "failed" {
                        db.conn()
                            .execute(
                                "UPDATE goal_reports SET status = 'failed' WHERE execution_id = ?1",
                                params![execution_id],
                            )
                            .unwrap();
                    }
                }
            }
            db.conn()
                .execute(
                    "UPDATE plan_approvals SET execution_state = ?2 WHERE execution_id = ?1",
                    params![execution_id, execution_state],
                )
                .unwrap();
            let before = serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap();
            let report_path = report_file_path(db.data_dir(), session_id, execution_id);
            let report_before = fs::read(&report_path).ok();
            let draft_path = draft_file_path(db.data_dir(), session_id, execution_id);
            let draft_before = fs::read(&draft_path).ok();

            let cross_error = retry_report(&db, "another-session", execution_id).unwrap_err();
            assert!(cross_error.to_string().starts_with("PERMISSION_DENIED:"));
            let error = retry_report(&db, session_id, execution_id).unwrap_err();
            assert!(error
                .to_string()
                .starts_with("GOAL_EXECUTION_NOT_TERMINAL:"));
            assert_eq!(
                serde_json::to_value(list_reports(&db, session_id).unwrap()).unwrap(),
                before
            );
            assert_eq!(fs::read(&report_path).ok(), report_before);
            assert_eq!(fs::read(&draft_path).ok(), draft_before);
        }
    }
}
