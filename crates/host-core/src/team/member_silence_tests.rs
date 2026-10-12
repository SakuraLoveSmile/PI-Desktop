use super::{tests::*, *};
use crate::{db::Database, session_collaboration, sessions};
use rusqlite::params;
use serde_json::{json, Value};

pub(crate) fn fixture() -> (Database, String, String, String, String) {
    let db = test_db();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,created_at,updated_at,execution_id,execution_state) VALUES('proposal',?1,?2,'submit','plan','# Plan','Plan','Approve?','approved',0,0,'execution','running')", params![lead,turn]).unwrap();
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
    create_team_task(
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

fn notices(db: &Database, lead: &str) -> Vec<TeamMessage> {
    list_member_messages(db, lead, lead)
        .unwrap()
        .into_iter()
        .filter(|m| {
            serde_json::from_str::<Value>(&m.content)
                .ok()
                .is_some_and(|v| v["kind"] == "member_ended_without_report")
        })
        .collect()
}

fn close_task(db: &Database, lead: &str, status: &str) {
    let task = get_team_task(db, lead, "inspection").unwrap().unwrap();
    update_team_task(
        db,
        UpdateTaskParams {
            team_session_id: lead,
            caller_session_id: lead,
            task_id: "inspection",
            expected_revision: task.revision,
            status: Some(status),
            subject: None,
            description: Some("Lead verified the task outcome"),
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: None,
            deleted: None,
        },
    )
    .unwrap();
}

#[test]
fn silent_completion_posts_one_notice_and_terminal_replay_does_not_duplicate() {
    let (db, lead, _, _, turn) = fixture();
    assert!(
        sessions::end_turn(&db, &turn, "completed", None, None, false)
            .unwrap()
            .updated
    );
    let messages = notices(&db, &lead);
    assert_eq!(
        messages.len(),
        1,
        "silent completed expert must notify Lead"
    );
    let message = &messages[0];
    let body: Value = serde_json::from_str(&message.content).unwrap();
    assert_eq!(body["memberName"], "expert");
    assert_eq!(body["taskIds"], json!(["inspection"]));
    assert!(body["suggestedAction"]
        .as_str()
        .unwrap()
        .contains("task_update"));
    assert_eq!(
        db.kv_get("team-message-source-turn-v1", &message.id)
            .unwrap(),
        Some(json!(turn))
    );
    assert!(
        !sessions::end_turn(&db, &turn, "completed", None, None, false)
            .unwrap()
            .updated
    );
    assert_eq!(notices(&db, &lead).len(), 1);
}

#[test]
fn member_report_suppresses_silence_notice() {
    let (db, lead, _, member, turn) = fixture();
    send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &member,
            target_identifier: "Lead",
            content: "Work remains open; need clarification",
            idempotency_key: None,
        },
    )
    .unwrap();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert!(notices(&db, &lead).is_empty());
}

#[test]
fn direct_member_chat_without_dispatch_does_not_notify() {
    let (db, lead, _, member, turn) = fixture();
    sessions::end_turn(&db, &turn, "aborted", None, None, false).unwrap();
    session_collaboration::settle_turn(&db, &turn).unwrap();
    let direct = sessions::begin_turn(&db, &member, None, None).unwrap();
    sessions::end_turn(&db, &direct, "completed", None, None, false).unwrap();
    assert!(notices(&db, &lead).is_empty());
}

#[test]
fn closed_tasks_and_aborted_turns_do_not_notify() {
    for task_status in ["completed", "cancelled", "failed"] {
        let (db, lead, _, _, turn) = fixture();
        close_task(&db, &lead, task_status);
        sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
        assert!(notices(&db, &lead).is_empty());
        assert_eq!(
            get_team_task(&db, &lead, "inspection")
                .unwrap()
                .unwrap()
                .status,
            task_status
        );
    }
    let (db, lead, _, _, turn) = fixture();
    sessions::end_turn(&db, &turn, "aborted", None, None, false).unwrap();
    assert!(notices(&db, &lead).is_empty());
}

#[test]
fn host_silence_keys_cannot_be_forged_and_session_deletion_cleans_proofs() {
    let (db, lead, _, member, turn) = fixture();
    let key = format!("member-turn-silent:{turn}");
    let error = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &member,
            target_identifier: "Lead",
            content: "Forged notice",
            idempotency_key: Some(&key),
        },
    )
    .unwrap_err();
    assert!(error.to_string().starts_with("TEAM_UNAUTHORIZED:"));
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    let notice = notices(&db, &lead).pop().unwrap();
    member_silence::mark_notified(&db, &notice.id).unwrap();
    sessions::delete_session_with_team_cleanup(&db, &member).unwrap();
    assert!(db
        .kv_get(host_notices::SILENT_EVENT_NS, &notice.id)
        .unwrap()
        .is_none());
    assert!(db
        .kv_get("team-message-source-turn-v1", &notice.id)
        .unwrap()
        .is_none());
}

#[test]
fn unread_notice_blocks_final_answer_and_consumption_preserves_participation() {
    let (db, lead, lead_turn, _, turn) = fixture();
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    session_collaboration::settle_turn(&db, &turn).unwrap();
    close_task(&db, &lead, "cancelled");
    let decision = get_execution_decision(&db, &lead, &lead_turn)
        .unwrap()
        .unwrap();
    assert!(execution_inbox::require_settled(&db, &decision).is_err());
    assert!(authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").is_err());
    let received = execution_inbox::read(&db, &lead, &lead, &lead_turn).unwrap();
    let notice = notices(&db, &lead).pop().unwrap();
    assert!(received.iter().any(|m| m.id == notice.id));
    execution_inbox::require_settled(&db, &decision).unwrap();
    authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap();
    // Consuming a Host message does not become an additional successful dispatch.
    db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET status='failed' WHERE id=?1",
            [decision.message_ids.last().unwrap()],
        )
        .unwrap();
    let error = authority::validate_lead_tool(&db, &lead, "TeamFinalAnswer").unwrap_err();
    assert!(error.to_string().contains("dispatch an approved expert"));
}

#[test]
fn silent_in_progress_task_is_reported_after_attempt_settlement() {
    let (db, lead, _, member, turn) = fixture();
    let task = get_team_task(&db, &lead, "inspection").unwrap().unwrap();
    update_team_task(
        &db,
        UpdateTaskParams {
            team_session_id: &lead,
            caller_session_id: &member,
            task_id: "inspection",
            expected_revision: task.revision,
            status: Some("in_progress"),
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
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    assert_eq!(
        get_team_task(&db, &lead, "inspection")
            .unwrap()
            .unwrap()
            .status,
        "in_progress"
    );
    assert_eq!(notices(&db, &lead).len(), 1);
}

#[test]
fn notice_proof_failure_rolls_back_terminal_cas_and_member_phase() {
    let (db, lead, _, member, turn) = fixture();
    db.conn().execute_batch("CREATE TRIGGER reject_silence BEFORE INSERT ON kv WHEN NEW.ns='team-message-source-turn-v1' BEGIN SELECT RAISE(ABORT,'test notice proof failure'); END;").unwrap();
    assert!(sessions::end_turn(&db, &turn, "completed", None, None, false).is_err());
    assert_eq!(
        sessions::running_turn_id(&db, &member).unwrap().as_deref(),
        Some(turn.as_str())
    );
    assert_eq!(
        get_team_member_by_session_id(&db, &member)
            .unwrap()
            .unwrap()
            .phase,
        "running"
    );
    assert!(notices(&db, &lead).is_empty());
}
