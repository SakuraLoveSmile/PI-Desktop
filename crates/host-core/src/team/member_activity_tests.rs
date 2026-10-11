use super::{member_activity::*, tests::create_test_lead};
use crate::{db::Database, state::AppState};
use serde_json::{json, Value};

fn usage(id: &str, tokens: i64) -> Value {
    json!({"operationId":id,"totalTokens":tokens,"inputTokens":tokens,"outputTokens":0})
}

#[test]
fn empty_operations_receipt_protects_member_and_replay_does_not_refresh_activity() {
    let root = tempfile::tempdir().unwrap();
    let st = AppState::open(root.path()).unwrap();
    let lead = create_test_lead(&st.db);
    let expert = super::tests::create_team_member(
        &st.db,
        super::CreateMemberParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            name: "tester",
            description: None,
            context_kind: None,
            model_id: None,
            provider_id: None,
        },
    )
    .unwrap();
    let session = &expert.member_session_id;
    let turn = crate::sessions::begin_turn(&st.db, session, None, None).unwrap();
    let now = crate::db::now_ms();
    st.db
        .conn()
        .execute(
            "UPDATE turns SET started_at=?2 WHERE id=?1",
            rusqlite::params![turn, now - 1_200_000],
        )
        .unwrap();
    assert_eq!(
        member(&st, &lead, session, "tester", now).unwrap()["requiresForce"],
        false
    );
    let mut receipt = usage("empty-array-request", 17);
    receipt["operations"] = json!([]);
    assert!(crate::sessions::record_usage(&st.db, session, &turn, &receipt).unwrap());
    let evidence = member(&st, &lead, session, "tester", crate::db::now_ms()).unwrap();
    assert_eq!(evidence["recentUsage"]["completedCallCount"], 1);
    assert_eq!(evidence["recentUsage"]["totalTokens"], 17);
    assert_eq!(evidence["requiresForce"], true);
    let refusal = super::interruption::request(&st, &lead, &lead, "tester", false, None)
        .err()
        .unwrap();
    assert!(refusal.to_string().starts_with("TEAM_MEMBER_ACTIVE:"));

    // Control the first Host observation, rather than sleeping for a replay.
    let observed_at = now - 300_000;
    let mut records = super::member_activity::observations(&st.db, session).unwrap();
    records[0].observed_at_ms = observed_at;
    st.db
        .kv_set(
            "team-member-usage-observations-v1",
            session,
            &serde_json::to_value(&records).unwrap(),
        )
        .unwrap();
    crate::sessions::record_usage(&st.db, session, &turn, &receipt).unwrap();
    let replayed = member(&st, &lead, session, "tester", crate::db::now_ms()).unwrap();
    assert_eq!(replayed["recentUsage"]["completedCallCount"], 1);
    assert_eq!(replayed["lastActivityAtMs"], observed_at);
    assert_eq!(
        super::member_activity::observations(&st.db, session).unwrap()[0].observed_at_ms,
        observed_at
    );

    // An expired replay must not manufacture a new activity heartbeat either.
    records[0].observed_at_ms = now - ACTIVITY_WINDOW_MS - 1;
    st.db
        .kv_set(
            "team-member-usage-observations-v1",
            session,
            &serde_json::to_value(&records).unwrap(),
        )
        .unwrap();
    crate::sessions::record_usage(&st.db, session, &turn, &receipt).unwrap();
    let expired = member(&st, &lead, session, "tester", crate::db::now_ms()).unwrap();
    assert_eq!(expired["recentUsage"]["completedCallCount"], 0);
    assert_eq!(expired["requiresForce"], false);
    assert!(
        super::interruption::request(&st, &lead, &lead, "tester", false, None)
            .unwrap()
            .is_some()
    );
}

#[test]
fn host_usage_is_recent_deduplicated_and_replays_never_extend_the_window() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("usage.sqlite");
    let db = Database::open(&path).unwrap();
    let lead = create_test_lead(&db);
    let original = usage("request-1", 12);
    observe_usage(&db, &lead, None, &original, 1_000_000).unwrap();
    observe_usage(
        &db,
        &lead,
        Some(&original),
        &usage("request-1", 18),
        1_300_000,
    )
    .unwrap();
    let records = super::member_activity::observations(&db, &lead).unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].observed_at_ms, 1_000_000);
    assert_eq!(records[0].total_tokens, 18);
    drop(db);
    let db = Database::open(&path).unwrap();
    observe_usage(&db, &lead, Some(&original), &original, 1_600_001).unwrap();
    assert!(super::member_activity::observations(&db, &lead)
        .unwrap()
        .is_empty());
    // Legacy records without Host observation time stay unknown, even on replay.
    let legacy = usage("pre-upgrade", 400);
    observe_usage(&db, &lead, Some(&legacy), &legacy, 1_600_002).unwrap();
    assert!(super::member_activity::observations(&db, &lead)
        .unwrap()
        .is_empty());
}

#[test]
fn billing_and_activity_commit_together_and_a_failed_write_can_replay_once() {
    let root = tempfile::tempdir().unwrap();
    let st = AppState::open(root.path()).unwrap();
    let lead = create_test_lead(&st.db);
    let turn = crate::sessions::begin_turn(&st.db, &lead, None, None).unwrap();
    let receipt = usage("physical-request", 17);
    st.db.conn().execute_batch("CREATE TRIGGER fail_activity BEFORE INSERT ON kv
        WHEN NEW.ns='team-member-usage-observations-v1' BEGIN SELECT RAISE(ABORT,'fixture persistence failure'); END;").unwrap();
    assert!(crate::sessions::record_usage(&st.db, &lead, &turn, &receipt).is_err());
    let ledger: Option<String> = st
        .db
        .conn()
        .query_row("SELECT usage_json FROM turns WHERE id=?1", [&turn], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        ledger.is_none(),
        "failed activity persistence must not leave an unobservable paid usage write"
    );
    st.db
        .conn()
        .execute_batch("DROP TRIGGER fail_activity")
        .unwrap();
    crate::sessions::record_usage(&st.db, &lead, &turn, &receipt).unwrap();
    crate::sessions::record_usage(&st.db, &lead, &turn, &receipt).unwrap();
    let evidence = member(&st, &lead, &lead, "Lead", crate::db::now_ms()).unwrap();
    assert_eq!(evidence["recentUsage"]["completedCallCount"], 1);
    assert_eq!(evidence["recentUsage"]["totalTokens"], 17);
    crate::sessions::end_turn(&st.db, &turn, "completed", None, None, false).unwrap();
    crate::sessions::delete_session(&st.db, &lead).unwrap();
    assert!(super::member_activity::observations(&st.db, &lead)
        .unwrap()
        .is_empty());
}

#[test]
fn queued_mail_age_survives_ack_without_becoming_execution_evidence() {
    let root = tempfile::tempdir().unwrap();
    let st = AppState::open(root.path()).unwrap();
    let lead = create_test_lead(&st.db);
    // Fixture a five-hour report already ACKed into turn_queue. Status remains
    // queued until consumption, so no receipt duplication or false activity.
    let created = 1_000_000_i64;
    let now = created + 18_000_000;
    st.db.conn().execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at)
        VALUES ('report',?1,'expert','Expert',?2,'Lead','message','private report body','queued','team-message:report',1,'auto',?3,?3)",
        rusqlite::params![super::team_plugin_origin(&lead), lead, created]).unwrap();
    st.db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,idempotency_key,input_hash,content,session_message_id,permission_mode,position,created_at)
        VALUES ('queue',?1,'team','team-message:report','hash','private report body','report','auto',1,?2)",
        rusqlite::params![lead, created]).unwrap();
    let evidence = member(&st, &lead, &lead, "Lead", now).unwrap();
    assert_eq!(
        evidence["incomingQueue"],
        json!({"count":1,"oldestAgeMs":18_000_000})
    );
    assert_eq!(evidence["requiresForce"], false);
    assert!(!evidence.to_string().contains("private report body"));
    st.db
        .conn()
        .execute(
            "UPDATE session_collaboration_messages SET status='completed' WHERE id='report'",
            [],
        )
        .unwrap();
    assert_eq!(
        member(&st, &lead, &lead, "Lead", now).unwrap()["incomingQueue"]["count"],
        0
    );
}

#[test]
fn tool_and_outbound_response_are_real_activity_while_queue_age_is_only_a_summary() {
    let root = tempfile::tempdir().unwrap();
    let st = AppState::open(root.path()).unwrap();
    let lead = create_test_lead(&st.db);
    crate::audit::append(
        &st.db,
        "tool_execute",
        Some(&lead),
        json!({"toolName":"Read","toolCallId":"read"}),
    )
    .unwrap();
    let now = crate::db::now_ms();
    assert_eq!(
        member(&st, &lead, &lead, "Lead", now).unwrap()["lastTool"]["name"],
        "Read"
    );
    assert_eq!(
        member(&st, &lead, &lead, "Lead", now).unwrap()["requiresForce"],
        true
    );
    assert_eq!(
        member(&st, &lead, &lead, "Lead", now + ACTIVITY_WINDOW_MS + 1).unwrap()["requiresForce"],
        false
    );
    let response_at = now + ACTIVITY_WINDOW_MS + 2;
    st.db.conn().execute("INSERT INTO session_collaboration_messages(id,plugin_id,source_session_id,source_title,target_session_id,target_title,kind,content,status,idempotency_key,remaining_hops,permission_ceiling,created_at,updated_at)
        VALUES ('response',?1,?2,'Lead',?2,'Lead','message','actual response','queued','actual-response',1,'auto',?3,?3)",
        rusqlite::params![super::team_plugin_origin(&lead), lead, response_at]).unwrap();
    let response = member(&st, &lead, &lead, "Lead", response_at).unwrap();
    assert_eq!(response["requiresForce"], true);
    assert_eq!(
        response["outgoingQueue"],
        json!({"count":1,"oldestAgeMs":0})
    );
    assert_eq!(response["lastActivityAtMs"], response_at);
}
