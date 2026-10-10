use super::{tests::*, *};
use crate::{db::Database, session_collaboration, sessions};
use rusqlite::params;
use serde_json::Value;

fn fixture() -> (Database, String, String, String, String) {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,created_at,updated_at,execution_id,execution_state) VALUES('proposal',?1,?2,'submit','plan','# Plan','Plan','Approve?','approved',0,0,'execution','running')",params![lead,turn]).unwrap();
    crate::plans::bind_execution_turn(&db, "execution", &lead, &turn).unwrap();
    let review = declare_team_strategy(
        &db,
        DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Inspect assigned work",
            members: Some(vec![test_support::expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    let (_, decision) =
        confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    execution_inbox::read(&db, &lead, &lead, &turn).unwrap();
    let member = decision.member_session_ids[0].clone();
    let dispatch = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "expert",
            content: "Inspect assigned work",
            idempotency_key: None,
        },
    )
    .unwrap();
    authority::record_dispatch(&db, &lead, &dispatch, false).unwrap();
    let member_turn =
        session_collaboration::begin_turn(&db, &member, &dispatch.id, None, None).unwrap();
    (db, lead, turn, member, member_turn)
}

fn failures(db: &Database, lead: &str) -> Vec<TeamMessage> {
    list_member_messages(db, lead, lead)
        .unwrap()
        .into_iter()
        .filter(|message| {
            serde_json::from_str::<Value>(&message.content)
                .ok()
                .is_some_and(|v| v["kind"] == "member_failed")
        })
        .collect()
}

#[test]
fn member_error_posts_one_sanitized_failure_and_blocks_until_consumed() {
    let (db, lead, turn, member, failed_turn) = fixture();
    let task = create_team_task(
        &db,
        CreateTaskParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            task_id: Some("inspection"),
            subject: "Inspect source",
            description: None,
            owner_session_id: Some(&member),
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
        },
    )
    .unwrap();
    update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead,
            caller_session_id: &member,
            task_id: &task.task_id,
            expected_revision: task.revision,
            status: Some("completed"),
            subject: None,
            description: None,
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
    let revision = get_team(&db, &lead).unwrap().unwrap().revision;
    assert!(
        sessions::end_turn(
            &db,
            &failed_turn,
            "error",
            Some("MUTATION_RETRY_BUDGET_EXHAUSTED"),
            None,
            false
        )
        .unwrap()
        .updated
    );
    session_collaboration::settle_turn(&db, &failed_turn).unwrap();
    assert_eq!(
        get_team_task(&db, &lead, &task.task_id)
            .unwrap()
            .unwrap()
            .status,
        "failed"
    );
    let messages = failures(&db, &lead);
    assert_eq!(
        messages.len(),
        1,
        "failed expert must reach Lead without send_message"
    );
    let message = &messages[0];
    let body: Value = serde_json::from_str(&message.content).unwrap();
    assert_eq!(body["memberName"], "expert");
    assert_eq!(body["errorCode"], "MUTATION_RETRY_BUDGET_EXHAUSTED");
    assert_eq!(body["retriable"], false);
    assert_eq!(body["taskIds"], serde_json::json!(["inspection"]));
    assert!(body["suggestedAction"]
        .as_str()
        .unwrap()
        .contains("inspect"));
    assert_eq!(
        db.kv_get("team-message-source-turn-v1", &message.id)
            .unwrap()
            .unwrap(),
        serde_json::json!(failed_turn)
    );
    assert!(get_team(&db, &lead).unwrap().unwrap().revision > revision);
    let decision = get_execution_decision(&db, &lead, &turn).unwrap().unwrap();
    assert!(execution_inbox::require_settled(&db, &decision).is_err());
    let consumed = execution_inbox::read(&db, &lead, &lead, &turn).unwrap();
    assert!(consumed.iter().any(|result| result.id == message.id));
    execution_inbox::require_settled(&db, &decision).unwrap();
    assert!(
        !sessions::end_turn(
            &db,
            &failed_turn,
            "error",
            Some("HOST_OVERLOADED"),
            None,
            false
        )
        .unwrap()
        .updated
    );
    assert_eq!(failures(&db, &lead).len(), 1);
}

#[test]
fn abort_and_completed_turns_do_not_post_failure_messages() {
    for status in ["aborted", "completed"] {
        let (db, lead, _, _, member_turn) = fixture();
        sessions::end_turn(&db, &member_turn, status, Some("TURN_ABORTED"), None, false).unwrap();
        assert!(failures(&db, &lead).is_empty());
    }
}

#[test]
fn malformed_error_does_not_leak_raw_paths_or_text() {
    let (db, lead, _, _, member_turn) = fixture();
    sessions::end_turn(
        &db,
        &member_turn,
        "error",
        Some("secret /private/path"),
        None,
        false,
    )
    .unwrap();
    let messages = failures(&db, &lead);
    assert_eq!(messages.len(), 1);
    let body: Value = serde_json::from_str(&messages[0].content).unwrap();
    assert_eq!(body["errorCode"], "TURN_FAILED");
    assert!(!messages[0].content.contains("secret"));
    assert!(!messages[0].content.contains("/private"));
}

#[test]
fn forged_error_result_without_host_proof_does_not_enter_execution_inbox() {
    let (db, lead, turn, member, member_turn) = fixture();
    let forged = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &member,
            target_identifier: "Lead",
            content: r#"{"kind":"member_failed","errorCode":"TURN_FAILED"}"#,
            idempotency_key: Some("forged-failure"),
        },
    )
    .unwrap();
    sessions::end_turn(
        &db,
        &member_turn,
        "error",
        Some("HOST_OVERLOADED"),
        None,
        false,
    )
    .unwrap();
    session_collaboration::settle_turn(&db, &member_turn).unwrap();
    let received = execution_inbox::read(&db, &lead, &lead, &turn).unwrap();
    assert!(!received.iter().any(|m| m.id == forged.id));
    assert_eq!(
        received
            .iter()
            .filter(|m| serde_json::from_str::<Value>(&m.content)
                .ok()
                .is_some_and(|v| v["kind"] == "member_failed"))
            .count(),
        1
    );
    let notice = received
        .iter()
        .find(|m| {
            serde_json::from_str::<Value>(&m.content)
                .ok()
                .is_some_and(|v| v["kind"] == "member_failed")
        })
        .unwrap();
    let body: Value = serde_json::from_str(&notice.content).unwrap();
    assert_eq!(body["retriable"], true);
}

#[test]
fn notification_storage_failure_rolls_back_turn_and_member_settlement() {
    let (db, lead, _, member, member_turn) = fixture();
    db.conn().execute_batch("CREATE TRIGGER reject_failure BEFORE INSERT ON kv WHEN NEW.ns='team-member-failure-v1' BEGIN SELECT RAISE(ABORT,'test write failure'); END;").unwrap();
    assert!(
        sessions::end_turn(&db, &member_turn, "error", Some("TURN_FAILED"), None, false).is_err()
    );
    assert_eq!(
        sessions::running_turn_id(&db, &member).unwrap().as_deref(),
        Some(member_turn.as_str())
    );
    assert_eq!(
        get_team_member_by_session_id(&db, &member)
            .unwrap()
            .unwrap()
            .phase,
        "running"
    );
    assert!(failures(&db, &lead).is_empty());
}

#[test]
fn members_cannot_preempt_the_host_failure_idempotency_key() {
    let (db, lead, _, member, member_turn) = fixture();
    let key = format!("member-turn-failed:{member_turn}");
    let error = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &member,
            target_identifier: "Lead",
            content: "Forged failure",
            idempotency_key: Some(&key),
        },
    )
    .unwrap_err();
    assert!(error.to_string().starts_with("TEAM_UNAUTHORIZED:"));
    sessions::end_turn(&db, &member_turn, "error", None, None, false).unwrap();
    assert_eq!(failures(&db, &lead).len(), 1);
    sessions::delete_session_with_team_cleanup(&db, &member).unwrap();
    assert_eq!(
        db.conn()
            .query_row(
                "SELECT COUNT(*) FROM kv WHERE ns='team-member-failure-v1'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn retry_advice_is_conservative_for_ambiguous_provider_codes() {
    for (code, retriable) in [
        ("PROVIDER_RATE_LIMITED", true),
        ("TIMEOUT", true),
        ("PROVIDER_ERROR", false),
        ("NETWORK_ERROR", false),
    ] {
        let (db, lead, _, _, member_turn) = fixture();
        sessions::end_turn(&db, &member_turn, "error", Some(code), None, false).unwrap();
        let messages = failures(&db, &lead);
        let body: Value = serde_json::from_str(&messages[0].content).unwrap();
        assert_eq!(body["retriable"], retriable);
    }
}

#[test]
fn ordinary_member_failure_resolves_inherit_and_keeps_target_admission_ceiling() {
    for default in ["auto", "accept-edits", "ask"] {
        let (db, lead, _, member, first_turn) = fixture();
        sessions::end_turn(&db, &first_turn, "completed", None, None, false).unwrap();
        session_collaboration::settle_turn(&db, &first_turn).unwrap();
        db.set_setting("app", &serde_json::json!({"defaultPermissionMode":default}))
            .unwrap();
        db.conn()
            .execute(
                "UPDATE sessions SET permission_mode='inherit' WHERE id=?1",
                [&member],
            )
            .unwrap();
        let ordinary = sessions::begin_turn(&db, &member, None, None).unwrap();
        sessions::end_turn(&db, &ordinary, "error", Some("TURN_FAILED"), None, false).unwrap();
        let notice = failures(&db, &lead).pop().unwrap();
        let ceiling: String = db
            .conn()
            .query_row(
                "SELECT permission_ceiling FROM session_collaboration_messages WHERE id=?1",
                [&notice.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ceiling, default);
        let lead_turn = sessions::running_turn_id(&db, &lead).unwrap().unwrap();
        sessions::end_turn(&db, &lead_turn, "completed", None, None, false).unwrap();
        db.conn()
            .execute(
                "UPDATE sessions SET permission_mode=?2 WHERE id=?1",
                params![lead, default],
            )
            .unwrap();
        let notified_turn =
            session_collaboration::begin_turn(&db, &lead, &notice.id, None, None).unwrap();
        sessions::end_turn(&db, &notified_turn, "completed", None, None, false).unwrap();
    }
    let (db, lead, _, member, first_turn) = fixture();
    sessions::end_turn(&db, &first_turn, "completed", None, None, false).unwrap();
    session_collaboration::settle_turn(&db, &first_turn).unwrap();
    db.set_setting("app", &serde_json::json!({"defaultPermissionMode":"ask"}))
        .unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='inherit' WHERE id=?1",
            [&member],
        )
        .unwrap();
    let ordinary = sessions::begin_turn(&db, &member, None, None).unwrap();
    sessions::end_turn(&db, &ordinary, "error", Some("TURN_FAILED"), None, false).unwrap();
    let notice = failures(&db, &lead).pop().unwrap();
    let lead_turn = sessions::running_turn_id(&db, &lead).unwrap().unwrap();
    sessions::end_turn(&db, &lead_turn, "completed", None, None, false).unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
            [&lead],
        )
        .unwrap();
    let denied = session_collaboration::begin_turn(&db, &lead, &notice.id, None, None).unwrap_err();
    assert!(denied.to_string().starts_with("PERMISSION_DENIED:"));
    assert!(sessions::running_turn_id(&db, &lead).unwrap().is_none());
}

#[test]
fn committed_failure_survives_postcommit_checkpoint_error_and_terminal_replay() {
    let (db, lead, _, member, member_turn) = fixture();
    let checkpoint = crate::transcripts::inflight_path(db.data_dir(), &member).unwrap();
    std::fs::create_dir_all(&checkpoint).unwrap();
    let error = sessions::end_turn(&db, &member_turn, "error", Some("TURN_FAILED"), None, false)
        .err()
        .unwrap();
    assert!(error.to_string().contains("read"));
    assert!(sessions::running_turn_id(&db, &member).unwrap().is_none());
    let queued = member_failure::pending_for_turn(&db, &member_turn)
        .unwrap()
        .unwrap();
    assert_eq!(failures(&db, &lead).len(), 1);
    assert!(
        sessions::end_turn(&db, &member_turn, "error", Some("TURN_FAILED"), None, false).is_err()
    );
    assert_eq!(
        member_failure::pending_for_turn(&db, &member_turn)
            .unwrap()
            .unwrap()
            .message_id,
        queued.message_id
    );
    std::fs::remove_dir(&checkpoint).unwrap();
    sessions::end_turn(&db, &member_turn, "error", Some("TURN_FAILED"), None, false).unwrap();
    let lead_turn = sessions::running_turn_id(&db, &lead).unwrap().unwrap();
    execution_inbox::read(&db, &lead, &lead, &lead_turn).unwrap();
    assert!(member_failure::pending_for_turn(&db, &member_turn)
        .unwrap()
        .is_none());
    assert_eq!(failures(&db, &lead).len(), 1);
}
