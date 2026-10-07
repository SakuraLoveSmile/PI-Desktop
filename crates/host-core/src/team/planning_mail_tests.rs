//! Submission readiness at the durable Team inbox boundary.
use super::planning_tests::{research, setup, task};
use super::{planning::*, tests::*, *};
use crate::sessions;
use rusqlite::params;

#[test]
fn queued_team_input_blocks_ready_round_even_after_queue_receipt_and_ack() {
    let (db, lead, members) = setup();
    let state = get(&db, &lead).unwrap().unwrap();
    for member in &members {
        let owned = task(&db, &lead, member);
        submit(
            &db,
            SubmitResearch {
                team: &lead,
                caller: &member.member_session_id,
                planning_id: &state.planning_id,
                round_id: &state.round_id,
                task_id: &owned.task_id,
                expected_revision: 1,
                result: research(),
            },
        )
        .unwrap();
    }
    validate_submission(&db, &lead).unwrap();
    let message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &members[0].member_session_id,
            target_identifier: "Lead",
            content: "Additional architectural findings",
            idempotency_key: None,
        },
    )
    .unwrap();
    let input = |id: &str, mail: Option<String>| crate::turn_queue::QueuedTurnInput {
        id: Some(id.into()),
        session_id: lead.clone(),
        principal: "test".into(),
        idempotency_key: None,
        input_hash: id.into(),
        content: id.into(),
        session_message_id: mail,
        user_message_id: None,
        voice_origin: None,
        attachments: None,
        permission_mode: "auto".into(),
    };
    let user = crate::turn_queue::push(&db, input("user-request", None)).unwrap();
    let mail = crate::turn_queue::push(&db, input("team-mail", Some(message.id.clone()))).unwrap();
    ack_team_message(&db, &lead, &lead, &message.id, Some("queued")).unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 1);
    assert!(
        !projection(&db, &lead, &lead).unwrap()["isReadyForPlanSubmission"]
            .as_bool()
            .unwrap()
    );
    assert!(validate_submission(&db, &lead).is_err());
    pause_team(&db, &lead).unwrap();
    assert!(list_pending_team_messages(&db, &lead).unwrap().is_empty());
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 1);
    resume_team(&db, &lead).unwrap();
    // Interrupted/recovered delivery and queue admission are not consumption.
    crate::session_collaboration::recover(&db).unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 1);
    finish_test_turn(&db, "planning-turn");
    let turn =
        crate::session_collaboration::begin_turn(&db, &lead, &message.id, None, None).unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 0);
    validate_submission(&db, &lead).unwrap();
    // Neither checking readiness nor consuming the actual mail deletes user work.
    assert_eq!(
        crate::turn_queue::list(&db, Some(&lead)).unwrap(),
        vec![user, mail]
    );
    sessions::end_turn(&db, &turn, "completed", None, None, false).unwrap();
    crate::session_collaboration::settle_turn(&db, &turn).unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 0);
}

#[test]
fn pending_team_input_count_uses_origin_target_kind_and_unconsumed_status() {
    let (db, lead, members) = setup();
    let message = send_team_message(
        &db,
        SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &members[0].member_session_id,
            target_identifier: "Lead",
            content: "Findings",
            idempotency_key: None,
        },
    )
    .unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 1);
    for (field, value) in [
        ("plugin_id", "plugin:other"),
        ("target_session_id", &members[1].member_session_id),
        ("kind", "completion"),
        ("status", "cancelled"),
        ("status", "failed"),
        ("status", "running"),
        ("status", "completed"),
    ] {
        let original: String = db
            .conn()
            .query_row(
                &format!("SELECT {field} FROM session_collaboration_messages WHERE id=?1"),
                [&message.id],
                |r| r.get(0),
            )
            .unwrap();
        db.conn()
            .execute(
                &format!("UPDATE session_collaboration_messages SET {field}=?2 WHERE id=?1"),
                params![message.id, value],
            )
            .unwrap();
        assert_eq!(
            pending_messages_count(&db, &lead).unwrap(),
            0,
            "{field}={value}"
        );
        db.conn()
            .execute(
                &format!("UPDATE session_collaboration_messages SET {field}=?2 WHERE id=?1"),
                params![message.id, original],
            )
            .unwrap();
    }
    // Durable semantic mail remains relevant even if its sender is historical.
    db.conn().execute("UPDATE session_collaboration_messages SET source_session_id='removed-researcher' WHERE id=?1", [&message.id]).unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 1);
    // Even a legacy queued row is already consumed when an actual turn is bound.
    db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET turn_id='planning-turn' WHERE id=?1",
            [&message.id],
        )
        .unwrap();
    assert_eq!(pending_messages_count(&db, &lead).unwrap(), 0);
}
