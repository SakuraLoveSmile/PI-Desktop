use super::{lead_asks::*, tests::*};
use crate::{sessions, turn_queue};
use serde_json::json;

fn fixture() -> (crate::db::Database, String, LeadAsk) {
    let db = test_db();
    let lead = create_test_lead(&db);
    start_test_turn(&db, &lead, "ask-turn");
    let ask = register(
        &db,
        AskRequest {
            request_id: "ask-id".into(),
            session_id: lead.clone(),
            tool_call_id: "ask-tool".into(),
            questions: vec![
                json!({"question":"Replace failed expert?","options":["Review","Wait"]}),
            ],
            team_pending: None,
            team_managed: None,
        },
        "ask-turn",
    )
    .unwrap();
    (db, lead, ask)
}

fn due(db: &crate::db::Database, ask: &mut LeadAsk) {
    ask.created_at = crate::db::now_ms() - WAIT_MS;
    db.kv_set(
        NS,
        &format!("{}:{}", ask.request.session_id, ask.request.request_id),
        &serde_json::to_value(ask).unwrap(),
    )
    .unwrap();
}

#[test]
fn pending_answer_queues_one_authenticated_new_user_turn_and_keeps_questions_durable() {
    let (db, lead, mut ask) = fixture();
    assert!(defer(&db, &lead, "ask-id", "ask-turn")
        .unwrap_err()
        .to_string()
        .contains("ASKTOOL_NOT_DUE"));
    due(&db, &mut ask);
    let pending = defer(&db, &lead, "ask-id", "ask-turn").unwrap();
    assert_eq!(pending.status, "pending");
    sessions::end_turn(
        &db,
        "ask-turn",
        "aborted",
        Some("TURN_ABORTED"),
        None,
        false,
    )
    .unwrap();
    let restored = list(&db, &lead).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].request.questions, ask.request.questions);
    let answer = resolve(&db, &lead, "ask-id", &json!([["Review"]])).unwrap();
    assert_eq!(answer.status, "answered");
    let replay = resolve(&db, &lead, "ask-id", &json!([["Review"]])).unwrap();
    assert_eq!(replay.queue_id, answer.queue_id);
    let queue = turn_queue::list(&db, Some(&lead)).unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].principal, "desktop");
    assert_eq!(
        queue[0].user_message_id.as_deref(),
        Some("asktool-answer:ask-id")
    );
    assert!(queue[0].session_message_id.is_none());
    assert!(queue[0].content.contains("Review"));
    assert!(!queue[0].content.contains("Replace failed expert?"));
    assert!(list(&db, &lead).unwrap().is_empty());
    assert!(super::authority::require_confirmed_strategy(&db, &lead).is_err());
    assert!(resolve(&db, &lead, "ask-id", &json!([["Wait"]]))
        .unwrap_err()
        .to_string()
        .contains("IDEMPOTENCY_CONFLICT"));
}

#[test]
fn live_answer_wins_timeout_and_acknowledgement_prevents_duplicate_recovery() {
    let (db, lead, _) = fixture();
    let live = resolve(&db, &lead, "ask-id", &json!([["Wait"]])).unwrap();
    assert_eq!(live.status, "answered_live");
    let mut ask = live;
    due(&db, &mut ask);
    assert_eq!(
        defer(&db, &lead, "ask-id", "ask-turn").unwrap().status,
        "answered_live"
    );
    acknowledge(&db, &lead, "ask-id", "ask-turn").unwrap();
    sessions::end_turn(&db, "ask-turn", "completed", None, None, false).unwrap();
    assert!(list(&db, &lead).unwrap().is_empty());
    assert!(turn_queue::list(&db, Some(&lead)).unwrap().is_empty());
}

#[test]
fn orphaned_wait_and_live_answer_recover_without_reviving_an_execution() {
    let (db, lead, _) = fixture();
    sessions::end_turn(
        &db,
        "ask-turn",
        "aborted",
        Some("SIDECAR_EXIT"),
        None,
        false,
    )
    .unwrap();
    assert_eq!(list(&db, &lead).unwrap()[0].status, "pending");
    resolve(&db, &lead, "ask-id", &json!([null])).unwrap();
    assert_eq!(turn_queue::list(&db, Some(&lead)).unwrap().len(), 1);
    let (db, lead, _) = fixture();
    resolve(&db, &lead, "ask-id", &json!([["Wait"]])).unwrap();
    sessions::end_turn(
        &db,
        "ask-turn",
        "aborted",
        Some("SIDECAR_EXIT"),
        None,
        false,
    )
    .unwrap();
    assert!(list(&db, &lead).unwrap().is_empty());
    assert_eq!(turn_queue::list(&db, Some(&lead)).unwrap().len(), 1);
    list(&db, &lead).unwrap();
    assert_eq!(turn_queue::list(&db, Some(&lead)).unwrap().len(), 1);
}

#[test]
fn wrong_owner_stale_turn_malformed_answers_and_cancel_fail_closed() {
    let (db, lead, _) = fixture();
    let foreign = create_test_lead(&db);
    assert!(resolve(&db, &foreign, "ask-id", &json!([["Review"]])).is_err());
    assert!(defer(&db, &lead, "ask-id", "other-turn").is_err());
    for answers in [
        json!([]),
        json!([["Review", "Wait"]]),
        json!(["Review"]),
        json!([[1]]),
    ] {
        assert!(resolve(&db, &lead, "ask-id", &answers).is_err());
    }
    cancel(&db, &lead).unwrap();
    assert!(list(&db, &lead).unwrap().is_empty());
    assert!(resolve(&db, &lead, "ask-id", &json!([["Review"]])).is_err());
    assert!(turn_queue::list(&db, Some(&lead)).unwrap().is_empty());
}

#[test]
fn full_queue_does_not_commit_or_lose_a_pending_answer() {
    let (db, lead, mut ask) = fixture();
    due(&db, &mut ask);
    defer(&db, &lead, "ask-id", "ask-turn").unwrap();
    for index in 0..8 {
        turn_queue::push(
            &db,
            turn_queue::QueuedTurnInput {
                id: Some(format!("queued-{index}")),
                session_id: lead.clone(),
                principal: "desktop".into(),
                idempotency_key: None,
                input_hash: "fixture".into(),
                content: "Fixture".into(),
                session_message_id: None,
                user_message_id: None,
                voice_origin: None,
                attachments: None,
                permission_mode: "ask".into(),
            },
        )
        .unwrap();
    }
    assert!(resolve(&db, &lead, "ask-id", &json!([["Review"]]))
        .unwrap_err()
        .to_string()
        .contains("QUEUE_FULL"));
    let pending = list(&db, &lead).unwrap();
    assert_eq!(pending[0].status, "pending");
    assert!(pending[0].answers.is_none());
    turn_queue::remove(&db, "queued-0").unwrap();
    resolve(&db, &lead, "ask-id", &json!([["Review"]])).unwrap();
    assert_eq!(turn_queue::list(&db, Some(&lead)).unwrap().len(), 8);
}

#[test]
fn cancellation_fences_a_register_that_arrives_after_stop() {
    let (db, lead, ask) = fixture();
    cancel(&db, &lead).unwrap();
    let mut request = ask.request;
    request.request_id = "late-register".into();
    assert!(register(&db, request, "ask-turn")
        .unwrap_err()
        .to_string()
        .contains("cancelled"));
    assert!(list(&db, &lead).unwrap().is_empty());
}

#[test]
fn pending_question_and_answer_identity_survive_database_reopen() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("reopen.sqlite");
    let db = crate::db::Database::open(&path).unwrap();
    let lead = create_test_lead(&db);
    start_test_turn(&db, &lead, "reopen-turn");
    register(
        &db,
        AskRequest {
            request_id: "reopen-ask".into(),
            session_id: lead.clone(),
            tool_call_id: "tool".into(),
            questions: vec![json!({"question":"Resume?","options":["Yes"]})],
            team_pending: None,
            team_managed: None,
        },
        "reopen-turn",
    )
    .unwrap();
    sessions::end_turn(
        &db,
        "reopen-turn",
        "aborted",
        Some("SIDECAR_EXIT"),
        None,
        false,
    )
    .unwrap();
    drop(db);
    let db = crate::db::Database::open(&path).unwrap();
    assert_eq!(list(&db, &lead).unwrap()[0].status, "pending");
    let answer = resolve(&db, &lead, "reopen-ask", &json!([["Yes"]])).unwrap();
    drop(db);
    let db = crate::db::Database::open(&path).unwrap();
    assert_eq!(
        resolve(&db, &lead, "reopen-ask", &json!([["Yes"]]))
            .unwrap()
            .queue_id,
        answer.queue_id
    );
    assert_eq!(turn_queue::list(&db, Some(&lead)).unwrap().len(), 1);
}

#[test]
fn stop_after_live_answer_before_ack_does_not_queue_a_new_turn() {
    let (db, lead, _) = fixture();
    assert_eq!(
        resolve(&db, &lead, "ask-id", &json!([["Review"]]))
            .unwrap()
            .status,
        "answered_live"
    );
    cancel(&db, &lead).unwrap();
    sessions::end_turn(
        &db,
        "ask-turn",
        "aborted",
        Some("TURN_ABORTED"),
        None,
        false,
    )
    .unwrap();
    assert!(list(&db, &lead).unwrap().is_empty());
    assert!(turn_queue::list(&db, Some(&lead)).unwrap().is_empty());
    assert!(resolve(&db, &lead, "ask-id", &json!([["Review"]])).is_err());
}
