use super::*;
pub(crate) fn setup() -> (tempfile::TempDir, Database) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    db.conn().execute("INSERT INTO sessions(id,title,mode,permission_mode,created_at,updated_at) VALUES('s','Goal','agent','auto',1,1)",[]).unwrap();
    db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,action,target_permission_mode,created_at,updated_at,execution_id,execution_state,artifact_relative_path,artifact_sha256,artifact_size_bytes) VALUES('p','s','t','tool','goal','# Contract','Goal','Approve','approved','approve','auto',1,1,'e','running','.pi/goal/test.md','hash',1)",[]).unwrap();
    db.conn().execute("INSERT INTO turns(id,session_id,started_at,ended_at,status) VALUES('t','s',10,20,'completed')",[]).unwrap();
    goal_reports::bind_execution_turn(&db, "e", "t").unwrap();
    (dir, db)
}
fn block(db: &Database) -> Value {
    settle(
        db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap()
}
#[test]
fn report_matrix_never_completes_unverified() {
    for verdict in [
        None,
        Some("partial"),
        Some("blocked"),
        Some("unknown"),
        Some("met"),
    ] {
        let (_dir, db) = setup();
        if let Some(verdict) = verdict {
            goal_reports::submit_draft(
                &db,
                "e",
                &json!({"summary":"Results","verdict":verdict,"limitations":["Needs input"]}),
            )
            .unwrap();
        }
        let result = block(&db);
        if verdict == Some("met") {
            assert_eq!(result["execution"]["state"], "completed");
            assert_eq!(result["report"]["integrity"], "structured");
            assert_eq!(
                goal_reports::read_report(&db, "s", "e")
                    .unwrap()
                    .report
                    .unwrap()["closure"],
                "agent_verified"
            );
        } else {
            assert_eq!(result["execution"]["state"], "interrupted");
            assert_eq!(result["hold"]["state"], "blocked");
            let code = verdict
                .map(|v| format!("verdict_{v}"))
                .unwrap_or("report_missing".into());
            assert_eq!(result["hold"]["reasons"][0]["code"], code);
            assert!(!db.data_dir().join("goal_reports/s/e.json").exists());
            let (status, code): (String, String) = db
                .conn()
                .query_row(
                    "SELECT execution_state,error_code FROM plan_approvals WHERE execution_id='e'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                (status.as_str(), code.as_str()),
                ("interrupted", "GOAL_BLOCKED")
            );
            let notification: (String, String) = db
                .conn()
                .query_row("SELECT kind,error_code FROM notifications", [], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            assert_eq!(notification, ("task.failed".into(), "GOAL_BLOCKED".into()));
        }
    }
}
#[test]
fn invalid_draft_blocks_without_publishing() {
    let (_dir, db) = setup();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Results","verdict":"met"})).unwrap();
    std::fs::write(db.data_dir().join("goal_reports/s/e.draft.json"), "invalid").unwrap();
    assert_eq!(block(&db)["hold"]["reasons"][0]["code"], "report_invalid");
}
#[test]
fn resume_cas_preserves_identity_and_segment_history() {
    let (_dir, db) = setup();
    let blocked = block(&db);
    let version = blocked["hold"]["version"].as_i64().unwrap();
    let resumed = resume(
        &db,
        "s",
        "e",
        version,
        Some(&json!({"providerId":"new","modelId":"model"})),
    )
    .unwrap();
    assert_eq!(resumed["execution"]["id"], "e");
    assert_eq!(resumed["execution"]["state"], "running");
    assert_eq!(resumed["resume"]["segment"], 2);
    assert!(resume(&db, "s", "e", version, None).is_err());
    assert!(close(&db, "s", "e", version, "accept").is_err());
    db.conn().execute("INSERT INTO turns(id,session_id,started_at,ended_at,status) VALUES('t2','s',30,40,'completed')",[]).unwrap();
    goal_reports::bind_execution_turn(&db, "e", "t2").unwrap();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"})).unwrap();
    settle(
        &db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    let report = goal_reports::read_report(&db, "s", "e")
        .unwrap()
        .report
        .unwrap();
    assert_eq!(report["segments"].as_array().unwrap().len(), 2);
    assert_eq!(report["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(report["execution"]["startedAt"], 10);
}
#[test]
fn accept_is_only_non_met_completion_path() {
    for draft in [false, true] {
        let (_dir, db) = setup();
        if draft {
            goal_reports::submit_draft(&db,"e",&json!({"summary":"Partial result","verdict":"partial","limitations":["Need input"]})).unwrap();
        }
        let blocked = block(&db);
        let version = blocked["hold"]["version"].as_i64().unwrap();
        let accepted = close(&db, "s", "e", version, "accept").unwrap();
        assert_eq!(accepted["execution"]["state"], "completed");
        assert_eq!(accepted["hold"]["state"], "accepted");
        assert_eq!(accepted["report"]["closure"], "user_accepted");
        assert_eq!(
            goal_reports::list_reports(&db, "s").unwrap()[0]
                .closure
                .as_deref(),
            Some("user_accepted")
        );
        let report = goal_reports::read_report(&db, "s", "e")
            .unwrap()
            .report
            .unwrap();
        assert_eq!(report["closure"], "user_accepted");
        assert_ne!(report["verdict"], "met");
        if draft {
            assert_eq!(report["verdict"], "partial");
        }
    }
}
#[test]
fn abandon_and_supersede_leave_reports_unpublished() {
    for action in ["abandon", "supersede"] {
        let (_dir, db) = setup();
        let blocked = block(&db);
        if action == "abandon" {
            close(
                &db,
                "s",
                "e",
                blocked["hold"]["version"].as_i64().unwrap(),
                action,
            )
            .unwrap();
        } else {
            let tx = db.conn().unchecked_transaction().unwrap();
            supersede(&tx, "s").unwrap();
            tx.commit().unwrap();
        }
        let code: String = db
            .conn()
            .query_row("SELECT error_code FROM plan_approvals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            code,
            if action == "abandon" {
                "GOAL_ABANDONED"
            } else {
                "GOAL_SUPERSEDED"
            }
        );
        assert!(!db.data_dir().join("goal_reports/s/e.json").exists());
        assert!(resume(&db, "s", "e", 1, None).is_err());
    }
}
#[test]
fn restart_preserves_hold_and_original_report_bytes() {
    let (dir, db) = setup();
    let before = block(&db);
    drop(db);
    let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
    assert_eq!(get(&db, "s", None).unwrap()["hold"]["state"], "blocked");
    assert_eq!(
        get(&db, "s", None).unwrap()["hold"]["version"],
        before["hold"]["version"]
    );
    assert!(resume(&db, "s", "e", 1, None).is_ok());
}
#[test]
fn error_is_resumable_but_user_stop_is_not_reopened() {
    let (_dir, db) = setup();
    let result = settle(
        &db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "errored",
            error_code: Some("MODEL_ERROR"),
            stop_hint: Some("resume_failed"),
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert!(result["hold"]["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["code"] == "agent_error:MODEL_ERROR"));
    assert!(result["hold"]["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["code"] == "resume_failed"));
    let (_dir, db) = setup();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET execution_state='interrupted',error_code='USER_CANCELLED'",
            [],
        )
        .unwrap();
    assert!(settle(
        &db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "errored",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0
        }
    )
    .unwrap()["hold"]
        .is_null());
    assert!(resume(&db, "s", "e", 1, None).is_err());
}
#[test]
fn team_pause_resume_gates_member_work() {
    let (_dir, db) = setup();
    db.conn().execute("INSERT INTO teams(team_session_id,revision,paused,created_at,updated_at) VALUES('s',1,0,1,1)",[]).unwrap();
    block(&db);
    assert!(crate::team::require_unpaused(&db, "s").is_err());
    resume(&db, "s", "e", 1, None).unwrap();
    assert!(crate::team::require_unpaused(&db, "s").is_ok());
}
#[test]
fn met_with_open_owned_task_is_blocked() {
    let (_dir, db) = setup();
    crate::team::ensure_team(&db, "s").unwrap();
    let decision = crate::team::TeamExecutionDecision {
        schema_version: 1,
        team_session_id: "s".into(),
        lead_turn_id: "t".into(),
        strategy: Some("delegate".into()),
        reason: None,
        updated_at: "1".into(),
        task_ids: vec!["owned".into()],
        member_session_ids: vec![],
        message_ids: vec![],
        review_ids: None,
        coordination_error: None,
    };
    db.kv_set("team-execution-decision-v1", "s:t", &json!(decision))
        .unwrap();
    db.conn().execute("INSERT INTO team_tasks(team_session_id,task_id,subject,status,created_at,updated_at) VALUES('s','owned','Review','pending',1,1)",[]).unwrap();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Claimed met","verdict":"met"}))
        .unwrap();
    let result = block(&db);
    assert_eq!(result["hold"]["reasons"][0]["code"], "team_unsettled");
    assert_eq!(result["hold"]["reasons"][0]["tasks"][0]["id"], "owned");
}

#[test]
fn resume_rejects_live_turns_and_preserves_hold_on_failure() {
    for member in [false, true] {
        let (_dir, db) = setup();
        crate::team::ensure_team(&db, "s").unwrap();
        block(&db);
        let target = if member {
            db.conn().execute("INSERT INTO sessions(id,title,mode,permission_mode,created_at,updated_at) VALUES('member','Expert','agent','auto',1,1)",[]).unwrap();
            db.conn().execute("INSERT INTO team_members(team_session_id,member_session_id,name,created_at,updated_at) VALUES('s','member','Expert',1,1)",[]).unwrap();
            "member"
        } else {
            "s"
        };
        db.conn()
            .execute(
                "INSERT INTO turns(id,session_id,started_at,status) VALUES('live',?1,50,'running')",
                [target],
            )
            .unwrap();
        assert!(resume(&db, "s", "e", 1, None).is_err());
        assert_eq!(get_hold(&db, "s", "e").unwrap().unwrap().state, "blocked");
        assert!(crate::team::resume_team(&db, "s").is_err());
        if member {
            assert!(crate::sessions::begin_turn(&db, "member", None, None)
                .unwrap_err()
                .to_string()
                .starts_with("TEAM_PAUSED"));
        }
    }
}
#[test]
fn automatic_completion_api_cannot_bypass_settlement() {
    let (_dir, db) = setup();
    assert!(crate::plans::PlanManager
        .finish_execution(&db, "e", "completed", None)
        .unwrap_err()
        .to_string()
        .starts_with("GOAL_REPORT_NOT_VERIFIED"));
    assert_eq!(execution(&db, "e").unwrap().state, "running");
}
#[test]
fn new_verified_publication_failure_cannot_retry_to_fallback() {
    let (_dir, db) = setup();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"})).unwrap();
    let result = settle(
        &db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: true,
            durable_seq: 0,
        },
    )
    .unwrap();
    assert_eq!(result["report"]["status"], "failed");
    assert!(goal_reports::retry_report(&db, "s", "e")
        .unwrap_err()
        .to_string()
        .starts_with("GOAL_REPORT_NOT_VERIFIED"));
    assert!(!db.data_dir().join("goal_reports/s/e.json").exists());
}
#[test]
fn legacy_snapshot_remains_readable_and_immutable() {
    let (_dir, db) = setup();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"})).unwrap();
    settle(
        &db,
        "s",
        "e",
        crate::goal_holds::GoalSettlement {
            ended: "agent_stopped",
            error_code: None,
            stop_hint: None,
            barrier_failed: false,
            durable_seq: 0,
        },
    )
    .unwrap();
    let path = db.data_dir().join("goal_reports/s/e.json");
    let mut report: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    report["schemaVersion"] = json!(1);
    report.as_object_mut().unwrap().remove("closure");
    std::fs::write(&path, serde_json::to_vec(&report).unwrap()).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    use sha2::{Digest, Sha256};
    db.conn()
        .execute(
            "UPDATE goal_reports SET file_hash=?1,file_size=?2 WHERE execution_id='e'",
            params![hex::encode(Sha256::digest(&bytes)), bytes.len() as i64],
        )
        .unwrap();
    assert_eq!(
        goal_reports::read_report(&db, "s", "e").unwrap().state,
        "ready"
    );
    assert!(goal_reports::bind_execution_turn(&db, "e", "other").is_err());
    goal_reports::finalize_report(&db, "e", 0, None, None).unwrap();
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}
#[test]
fn blocked_scratch_is_retained_and_superseding_does_not_rewrite_draft() {
    let (_dir, db) = setup();
    db.conn()
        .execute(
            "UPDATE plan_approvals SET artifact_workspace_kind='scratch'",
            [],
        )
        .unwrap();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Partial","verdict":"partial"}))
        .unwrap();
    block(&db);
    assert!(plans::has_live_scratch_goal(&db, "s").unwrap());
    let path = db.data_dir().join("goal_reports/s/e.draft.json");
    let bytes = std::fs::read(&path).unwrap();
    let tx = db.conn().unchecked_transaction().unwrap();
    supersede(&tx, "s").unwrap();
    tx.commit().unwrap();
    assert!(!plans::has_live_scratch_goal(&db, "s").unwrap());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}
#[test]
fn terminal_team_tasks_do_not_block_verified_met() {
    for status in ["failed", "cancelled", "completed"] {
        let (_dir, db) = setup();
        crate::team::ensure_team(&db, "s").unwrap();
        let decision = crate::team::TeamExecutionDecision {
            schema_version: 1,
            team_session_id: "s".into(),
            lead_turn_id: "t".into(),
            strategy: None,
            reason: None,
            updated_at: "1".into(),
            task_ids: vec!["owned".into()],
            member_session_ids: vec![],
            message_ids: vec![],
            review_ids: None,
            coordination_error: None,
        };
        db.kv_set("team-execution-decision-v1", "s:t", &json!(decision))
            .unwrap();
        db.conn().execute("INSERT INTO team_tasks(team_session_id,task_id,subject,status,created_at,updated_at) VALUES('s','owned','Review',?1,1,1)",[status]).unwrap();
        goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"}))
            .unwrap();
        assert_eq!(block(&db)["execution"]["state"], "completed");
    }
}
#[test]
fn resumed_goal_restores_approved_permission_ceiling() {
    let (_dir, db) = setup();
    db.conn()
        .execute("UPDATE plan_approvals SET target_permission_mode='ask'", [])
        .unwrap();
    block(&db);
    db.conn()
        .execute("UPDATE sessions SET permission_mode='auto'", [])
        .unwrap();
    let resumed = resume(&db, "s", "e", 1, None).unwrap();
    assert_eq!(resumed["execution"]["targetPermissionMode"], "ask");
    assert_eq!(
        crate::sessions::session_permission_mode(&db, "s")
            .unwrap()
            .as_deref(),
        Some("ask")
    );
}
#[test]
fn publication_failures_do_not_strand_ended_execution_or_leave_orphan_file() {
    for after_write in [false, true] {
        let (_dir, db) = setup();
        goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"}))
            .unwrap();
        let path = db.data_dir().join("goal_reports/s/e.json");
        if after_write {
            db.conn().execute_batch("CREATE TRIGGER reject_ready BEFORE UPDATE OF status ON goal_reports WHEN NEW.status='ready' BEGIN SELECT RAISE(FAIL,'publication rejected'); END;").unwrap();
        } else {
            std::fs::create_dir(&path).unwrap();
        }
        let result = settle(
            &db,
            "s",
            "e",
            crate::goal_holds::GoalSettlement {
                ended: "agent_stopped",
                error_code: None,
                stop_hint: None,
                barrier_failed: false,
                durable_seq: 0,
            },
        )
        .unwrap();
        assert_eq!(result["execution"]["state"], "completed");
        assert_eq!(result["report"]["status"], "failed");
        assert!(!path.is_file());
        assert!(db.data_dir().join("goal_reports/s/e.draft.json").is_file());
    }
}

#[test]
fn host_restart_blocks_initial_and_resumed_goal_without_replay() {
    for resumed in [false, true] {
        let (dir, db) = setup();
        crate::team::ensure_team(&db, "s").unwrap();
        if resumed {
            block(&db);
            resume(&db, "s", "e", 1, None).unwrap();
        }
        drop(db);
        let db = Database::open(&dir.path().join("db.sqlite")).unwrap();
        let hold = get_hold(&db, "s", "e").unwrap().unwrap();
        assert_eq!(hold.state, "blocked");
        assert!(hold
            .reasons
            .iter()
            .any(|r| r["code"] == "agent_error:HOST_RESTARTED"));
        assert!(crate::team::get_team(&db, "s").unwrap().unwrap().paused);
        assert_eq!(execution(&db, "e").unwrap().state, "interrupted");
        assert!(!db.data_dir().join("goal_reports/s/e.json").is_file());
        assert!(resume(&db, "s", "e", hold.version, None).is_ok());
    }
}
#[test]
fn invalidation_io_failure_compensates_resume_claim_to_blocked() {
    let (_dir, db) = setup();
    crate::team::ensure_team(&db, "s").unwrap();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Partial","verdict":"partial"}))
        .unwrap();
    block(&db);
    let path = db.data_dir().join("goal_reports/s/e.draft.json");
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(resume(&db, "s", "e", 1, None).is_err());
    assert_eq!(execution(&db, "e").unwrap().state, "interrupted");
    let hold = get_hold(&db, "s", "e").unwrap().unwrap();
    assert_eq!(hold.state, "blocked");
    assert!(hold
        .reasons
        .iter()
        .any(|reason| reason["code"] == "resume_failed"));
    assert!(crate::team::get_team(&db, "s").unwrap().unwrap().paused);
}
#[test]
fn supersede_releases_only_goal_owned_pause() {
    for user_paused in [false, true] {
        let (_dir, db) = setup();
        crate::team::ensure_team(&db, "s").unwrap();
        block(&db);
        if user_paused {
            crate::team::pause_team(&db, "s").unwrap();
        }
        let tx = db.conn().unchecked_transaction().unwrap();
        supersede(&tx, "s").unwrap();
        tx.commit().unwrap();
        assert_eq!(
            crate::team::get_team(&db, "s").unwrap().unwrap().paused,
            user_paused
        );
    }
}
#[test]
fn compat_finish_api_creates_verified_lineage_before_report_failure() {
    let (_dir, db) = setup();
    goal_reports::submit_draft(&db, "e", &json!({"summary":"Verified","verdict":"met"})).unwrap();
    std::fs::create_dir(db.data_dir().join("goal_reports/s/e.json")).unwrap();
    let finished = crate::plans::PlanManager
        .finish_execution(&db, "e", "completed", None)
        .unwrap();
    assert_eq!(finished.state, "completed");
    assert!(get_hold(&db, "s", "e").unwrap().is_some());
    assert!(goal_reports::retry_report(&db, "s", "e").is_err());
}
#[test]
fn late_agent_draft_cannot_mutate_blocked_goal() {
    let (_dir, db) = setup();
    block(&db);
    let before = serde_json::to_value(goal_reports::list_reports(&db, "s").unwrap()).unwrap();
    assert!(
        goal_reports::submit_draft(&db, "e", &json!({"summary":"Late reply","verdict":"met"}))
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(goal_reports::list_reports(&db, "s").unwrap()).unwrap(),
        before
    );
    assert!(!db.data_dir().join("goal_reports/s/e.draft.json").is_file());
}
