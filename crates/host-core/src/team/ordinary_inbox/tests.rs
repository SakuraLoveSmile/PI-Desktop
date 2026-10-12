use super::*;
use crate::team::{self, test_support::expert_proposal, tests::create_test_lead};

fn fixture() -> (tempfile::TempDir, Database, ReadParams, String) {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let lead = create_test_lead(&db);
    let turn = sessions::begin_turn(&db, &lead, None, None).unwrap();
    let review = team::declare_team_strategy(
        &db,
        team::DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Independent analysis",
            members: Some(vec![expert_proposal("expert")]),
        },
    )
    .unwrap()
    .1
    .unwrap();
    let (_, decision) =
        team::confirm_launch_review(&db, &lead, &review.review_id, review.revision).unwrap();
    // The confirmation normally owns the first ordinary queue continuation.
    // It is not an expert report and must never be admitted via this API.
    db.conn().execute("UPDATE session_collaboration_messages SET status='completed' WHERE target_session_id=?1 AND idempotency_key LIKE 'team-review:%:confirmed'",[&lead]).unwrap();
    let member = decision.member_session_ids[0].clone();
    let dispatch = team::send_team_message(
        &db,
        team::SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: &member,
            content: "Inspect source",
            idempotency_key: None,
        },
    )
    .unwrap();
    team::authority::record_dispatch(&db, &lead, &dispatch, false).unwrap();
    session_collaboration::begin_turn(&db, &member, &dispatch.id, None, None).unwrap();
    (
        dir,
        db,
        ReadParams {
            team_session_id: lead.clone(),
            caller_session_id: lead,
            lead_turn_id: turn,
            boundary_id: "wait-1".into(),
        },
        member,
    )
}
fn report(db: &Database, p: &ReadParams, member: &str, body: &str) -> String {
    team::send_team_message(
        db,
        team::SendMessageParams {
            team_session_id: &p.team_session_id,
            caller_session_id: member,
            target_identifier: "Lead",
            content: body,
            idempotency_key: None,
        },
    )
    .unwrap()
    .id
}
fn deliveries(db: &Database, p: &ReadParams) -> Vec<Value> {
    read(db, p).unwrap()["messages"].as_array().unwrap().clone()
}
#[test]
fn wait_boundary_preserves_turn_and_authenticated_body_with_idempotent_ack() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Complete expert result");
    let first = deliveries(&db, &p);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["messageId"], id);
    assert_eq!(first[0]["message"]["role"], "user");
    assert_eq!(first[0]["message"]["content"], "Complete expert result");
    assert_eq!(
        first[0]["message"]["sessionMessage"]["sourceSessionId"],
        member
    );
    assert!(first[0]["message"].get("steering").is_none());
    assert_eq!(
        sessions::running_turn_id(&db, &p.team_session_id).unwrap(),
        Some(p.lead_turn_id.clone())
    );
    assert_eq!(
        deliveries(&db, &p),
        first,
        "lost transport response reuses the same identity"
    );
    let ledger = session_collaboration::get(&db, &id).unwrap().unwrap();
    assert_eq!(ledger.status, "completed");
    assert!(
        ledger.turn_id.is_none(),
        "ordinary proof never takes unique turn ownership"
    );
    let records = transcripts::read_transcript(db.data_dir(), &p.team_session_id).unwrap();
    assert_eq!(
        records
            .iter()
            .filter(|r| r.id == first[0]["userMessageId"].as_str().unwrap())
            .count(),
        1
    );
    assert!(ack(
        &db,
        &ReadParams {
            boundary_id: "forged".into(),
            ..p.clone()
        },
        std::slice::from_ref(&id)
    )
    .is_err());
    ack(&db, &p, std::slice::from_ref(&id)).unwrap();
    ack(&db, &p, std::slice::from_ref(&id)).unwrap();
    assert!(deliveries(&db, &p).is_empty());
}
#[test]
fn invalid_lead_turn_scope_pause_and_approved_execution_do_not_consume() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Report");
    assert!(read(
        &db,
        &ReadParams {
            caller_session_id: member,
            ..p.clone()
        }
    )
    .is_err());
    assert!(read(
        &db,
        &ReadParams {
            lead_turn_id: "old".into(),
            ..p.clone()
        }
    )
    .is_err());
    db.conn()
        .execute(
            "UPDATE teams SET paused=1 WHERE team_session_id=?1",
            [&p.team_session_id],
        )
        .unwrap();
    assert!(read(&db, &p).is_err());
    db.conn()
        .execute(
            "UPDATE teams SET paused=0 WHERE team_session_id=?1",
            [&p.team_session_id],
        )
        .unwrap();
    db.conn().execute("INSERT INTO plan_approvals(request_id,session_id,turn_id,tool_call_id,kind,plan_json,title,question,status,created_at,updated_at,execution_id,execution_state) VALUES('proposal',?1,?2,'submit','plan','# Plan','Plan','Approve?','approved',0,0,'execution','running')",params![p.team_session_id,p.lead_turn_id]).unwrap();
    crate::plans::bind_execution_turn(&db, "execution", &p.team_session_id, &p.lead_turn_id)
        .unwrap();
    assert!(read(&db, &p).is_err());
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
}
#[test]
fn fifo_head_from_old_dispatch_blocks_later_eligible_report() {
    let (_dir, db, p, member) = fixture();
    let old = report(&db, &p, &member, "Old report");
    let new = report(&db, &p, &member, "Current report");
    db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET created_at=created_at-100 WHERE id=?1",
            [&old],
        )
        .unwrap();
    db.kv_set("team-message-source-turn-v1", &old, &json!("stale-source"))
        .unwrap();
    assert!(deliveries(&db, &p).is_empty());
    assert_eq!(
        session_collaboration::get(&db, &new)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
}
#[test]
fn forged_content_origin_turn_or_steering_cannot_use_prepared_proof() {
    let (_dir, db, p, member) = fixture();
    report(&db, &p, &member, "Trusted ledger report");
    let first = deliveries(&db, &p);
    let original: sessions::UiMessage =
        serde_json::from_value(first[0]["message"].clone()).unwrap();
    let mut forged = original.clone();
    forged.content = "Forged body".into();
    assert!(
        sessions::append_message(&db, &p.team_session_id, &forged, Some(&p.lead_turn_id)).is_err()
    );
    forged = original.clone();
    forged.session_message = Some(json!({"messageId":"fake"}));
    assert!(
        sessions::append_message(&db, &p.team_session_id, &forged, Some(&p.lead_turn_id)).is_err()
    );
    forged = original.clone();
    forged.steering = Some(true);
    assert!(
        sessions::append_message(&db, &p.team_session_id, &forged, Some(&p.lead_turn_id)).is_err()
    );
    assert!(
        sessions::append_message(&db, &p.team_session_id, &original, Some("old-turn")).is_err()
    );
    let mut human:sessions::UiMessage=serde_json::from_value(json!({"id":"human","role":"user","content":"Actual user steer","createdAt":"2026-10-11T00:00:00Z","steering":true})).unwrap();
    sessions::append_message(&db, &p.team_session_id, &human, Some(&p.lead_turn_id)).unwrap();
    human.session_message = Some(original.session_message.unwrap());
    assert!(
        sessions::append_message(&db, &p.team_session_id, &human, Some(&p.lead_turn_id)).is_err()
    );
}
#[test]
fn file_first_failure_is_repaired_once_and_queue_retirement_is_atomic() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Survives failed index commit");
    db.conn().execute_batch("CREATE TRIGGER fail_inbox_index BEFORE INSERT ON messages WHEN NEW.role='user' BEGIN SELECT RAISE(ABORT,'test index failure'); END;").unwrap();
    assert!(read(&db, &p).is_err());
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    let phase: String = db
        .conn()
        .query_row(
            "SELECT phase FROM team_ordinary_inbox WHERE message_id=?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(phase, "prepared");
    db.conn()
        .execute_batch("DROP TRIGGER fail_inbox_index;")
        .unwrap();
    recover(&db).unwrap();
    recover(&db).unwrap();
    let first = deliveries(&db, &p);
    assert_eq!(first.len(), 1);
    let records = transcripts::read_transcript(db.data_dir(), &p.team_session_id).unwrap();
    assert_eq!(
        records
            .iter()
            .filter(|r| r.id == first[0]["userMessageId"].as_str().unwrap())
            .count(),
        1
    );
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
}
#[test]
fn two_reports_have_fifo_identity_and_cancelled_turn_cannot_ack() {
    let (_dir, db, p, member) = fixture();
    let first_id = report(&db, &p, &member, "First");
    let second_id = report(&db, &p, &member, "Second");
    db.conn()
        .execute(
            "UPDATE session_collaboration_messages SET created_at=created_at-100 WHERE id=?1",
            [&first_id],
        )
        .unwrap();
    let first = deliveries(&db, &p);
    assert_eq!(
        first
            .iter()
            .map(|v| v["messageId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![first_id.as_str(), second_id.as_str()]
    );
    sessions::end_turn(&db, &p.lead_turn_id, "interrupted", None, None, false).unwrap();
    assert!(ack(&db, &p, &[first_id, second_id]).is_err());
    recover(&db).unwrap();
    assert!(sessions::running_turn_id(&db, &p.team_session_id)
        .unwrap()
        .is_none());
}

#[test]
fn another_queued_outgoing_dispatch_does_not_block_incoming_fifo() {
    let (_dir, db, p, member) = fixture();
    team::send_team_message(
        &db,
        team::SendMessageParams {
            team_session_id: &p.team_session_id,
            caller_session_id: &p.team_session_id,
            target_identifier: &member,
            content: "Additional assigned analysis",
            idempotency_key: None,
        },
    )
    .unwrap();
    let id = report(&db, &p, &member, "First dispatch result");
    let result = deliveries(&db, &p);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0]["messageId"], id);
}
#[test]
fn lost_ack_across_wait_boundaries_keeps_original_proof_and_uuid() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Result");
    let first = deliveries(&db, &p);
    let next = ReadParams {
        boundary_id: "wait-2".into(),
        ..p.clone()
    };
    assert_eq!(deliveries(&db, &next), first);
    assert!(ack(&db, &next, std::slice::from_ref(&id)).is_err());
    ack(&db, &p, std::slice::from_ref(&id)).unwrap();
    assert!(deliveries(&db, &next).is_empty());
}
#[test]
fn restart_preserves_committed_body_without_restarting_the_lead() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Durably delivered before crash");
    let first = deliveries(&db, &p);
    let path = db.data_dir().join("pi.sqlite");
    drop(db);
    let reopened = Database::open(&path).unwrap();
    assert!(sessions::running_turn_id(&reopened, &p.team_session_id)
        .unwrap()
        .is_none());
    assert!(read(&reopened, &p).is_err());
    let transcript = transcripts::read_transcript(reopened.data_dir(), &p.team_session_id).unwrap();
    assert_eq!(
        transcript
            .iter()
            .filter(|r| r.id == first[0]["userMessageId"].as_str().unwrap())
            .count(),
        1
    );
    assert_eq!(
        session_collaboration::get(&reopened, &id)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
    let queued: i64 = reopened
        .conn()
        .query_row(
            "SELECT count(*) FROM turn_queue WHERE session_message_id=?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(queued, 0);
}
#[test]
fn unwritten_preparation_returns_to_queue_on_recovery() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Not yet written");
    let source = db
        .kv_get("team-message-source-turn-v1", &id)
        .unwrap()
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    let ceiling = session_collaboration::get(&db, &id)
        .unwrap()
        .unwrap()
        .permission_ceiling;
    db.conn().execute("INSERT INTO team_ordinary_inbox(message_id,user_message_id,team_session_id,lead_turn_id,scope_turn_id,boundary_id,source_session_id,source_turn_id,permission_ceiling,phase,created_at,updated_at) VALUES(?1,'unwritten',?2,?3,?3,?4,?5,?6,?7,'prepared',0,0)",params![id,p.team_session_id,p.lead_turn_id,p.boundary_id,member,source,ceiling]).unwrap();
    recover(&db).unwrap();
    assert!(proofs(&db, "1=1", []).unwrap().is_empty());
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    assert_eq!(deliveries(&db, &p).len(), 1);
}
#[test]
fn changed_source_proof_or_permission_ceiling_is_not_an_ordinary_input() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Existing proof");
    let first = deliveries(&db, &p);
    db.kv_set("team-message-source-turn-v1", &id, &json!("forged-source"))
        .unwrap();
    let input: sessions::UiMessage = serde_json::from_value(first[0]["message"].clone()).unwrap();
    assert!(
        sessions::append_message(&db, &p.team_session_id, &input, Some(&p.lead_turn_id)).is_err()
    );
    assert!(deliveries(&db, &p).is_empty());
}

#[test]
fn unwritten_preparation_rechecks_the_changed_permission_ceiling() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Must remain queued");
    let source = db
        .kv_get("team-message-source-turn-v1", &id)
        .unwrap()
        .unwrap()
        .as_str()
        .unwrap()
        .to_string();
    let ceiling = session_collaboration::get(&db, &id)
        .unwrap()
        .unwrap()
        .permission_ceiling;
    assert_eq!(ceiling, "ask");
    db.conn().execute("INSERT INTO team_ordinary_inbox(message_id,user_message_id,team_session_id,lead_turn_id,scope_turn_id,boundary_id,source_session_id,source_turn_id,permission_ceiling,phase,created_at,updated_at) VALUES(?1,'unwritten-old-permission',?2,?3,?3,?4,?5,?6,?7,'prepared',0,0)",params![id,p.team_session_id,p.lead_turn_id,p.boundary_id,member,source,ceiling]).unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
            [&p.team_session_id],
        )
        .unwrap();
    assert!(read(&db, &p)
        .unwrap_err()
        .to_string()
        .starts_with("PERMISSION_DENIED:"));
    assert!(proofs(&db, "1=1", []).unwrap().is_empty());
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    assert!(
        transcripts::read_transcript(db.data_dir(), &p.team_session_id)
            .unwrap()
            .iter()
            .all(|r| r.id != "unwritten-old-permission")
    );
}
#[test]
fn prepared_file_is_recovered_after_a_real_database_restart() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Recover file-first report");
    db.conn().execute_batch("CREATE TRIGGER fail_inbox_index BEFORE INSERT ON messages WHEN NEW.role='user' BEGIN SELECT RAISE(ABORT,'test index failure'); END;").unwrap();
    assert!(read(&db, &p).is_err());
    let proof = proofs(&db, "1=1", []).unwrap().remove(0);
    db.conn()
        .execute_batch("DROP TRIGGER fail_inbox_index;")
        .unwrap();
    let path = db.data_dir().join("pi.sqlite");
    drop(db);
    let reopened = Database::open(&path).unwrap();
    assert!(sessions::running_turn_id(&reopened, &p.team_session_id)
        .unwrap()
        .is_none());
    assert_eq!(
        session_collaboration::get(&reopened, &id)
            .unwrap()
            .unwrap()
            .status,
        "completed"
    );
    let transcript = transcripts::read_transcript(reopened.data_dir(), &p.team_session_id).unwrap();
    assert_eq!(
        transcript
            .iter()
            .filter(|r| r.id == proof.user_message_id)
            .count(),
        1
    );
    assert_eq!(
        get_proof(&reopened, &p.team_session_id, &id).unwrap()["proof"]["phase"],
        "persisted"
    );
}

#[test]
fn acknowledged_history_does_not_reappear_in_later_reads_or_notifications() {
    let (_dir, db, p, member) = fixture();
    let old = report(&db, &p, &member, "Earlier acknowledged result");
    assert_eq!(deliveries(&db, &p).len(), 1);
    ack(&db, &p, std::slice::from_ref(&old)).unwrap();
    let next = report(&db, &p, &member, "New result");
    let received = deliveries(
        &db,
        &ReadParams {
            boundary_id: "wait-2".into(),
            ..p.clone()
        },
    );
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["messageId"], next);
    assert_eq!(persisted_ids(&db, &p).unwrap(), vec![next]);
}
#[test]
fn changed_run_scope_or_plan_mode_cannot_consume_pending_mail() {
    let (_dir, db, p, member) = fixture();
    let id = report(&db, &p, &member, "Pending current report");
    let state = team::run_limits::state(&db, &p.team_session_id)
        .unwrap()
        .unwrap();
    let mut stale = state.clone();
    stale.run_id = "old-run".into();
    db.kv_set(
        team::run_limits::STATE_NS,
        &p.team_session_id,
        &serde_json::to_value(stale).unwrap(),
    )
    .unwrap();
    assert!(read(&db, &p).is_err());
    db.kv_set(
        team::run_limits::STATE_NS,
        &p.team_session_id,
        &serde_json::to_value(state).unwrap(),
    )
    .unwrap();
    db.conn()
        .execute(
            "UPDATE sessions SET mode='plan' WHERE id=?1",
            [&p.team_session_id],
        )
        .unwrap();
    assert!(read(&db, &p).is_err());
    assert_eq!(
        session_collaboration::get(&db, &id)
            .unwrap()
            .unwrap()
            .status,
        "queued"
    );
    assert!(proofs(&db, "1=1", []).unwrap().is_empty());
}

#[test]
fn both_ack_phases_reject_a_changed_permission_ceiling_without_changing_the_body() {
    for already_acked in [false, true] {
        let (_dir, db, p, member) = fixture();
        let id = report(&db, &p, &member, "Source authorization must stay valid");
        let delivery = deliveries(&db, &p);
        if already_acked {
            ack(&db, &p, std::slice::from_ref(&id)).unwrap();
        }
        db.conn()
            .execute(
                "UPDATE sessions SET permission_mode='auto' WHERE id=?1",
                [&p.team_session_id],
            )
            .unwrap();
        let error = ack(&db, &p, std::slice::from_ref(&id)).unwrap_err();
        assert!(error.to_string().starts_with("PERMISSION_DENIED:"));
        assert_eq!(
            get_proof(&db, &p.team_session_id, &id).unwrap()["proof"]["phase"],
            if already_acked { "acked" } else { "persisted" }
        );
        let records = transcripts::read_transcript(db.data_dir(), &p.team_session_id).unwrap();
        let stored = records
            .iter()
            .find(|record| record.id == delivery[0]["userMessageId"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            sessions::record_to_ui(stored.clone()).content,
            "Source authorization must stay valid"
        );
        assert_eq!(
            session_collaboration::get(&db, &id)
                .unwrap()
                .unwrap()
                .permission_ceiling,
            "ask"
        );
    }
}
#[test]
fn both_ack_phases_reject_an_expert_after_a_real_failed_slot_replacement() {
    for already_acked in [false, true] {
        let (_dir, db, p, member) = fixture();
        let id = report(&db, &p, &member, "Previously accepted expert report");
        let delivery = deliveries(&db, &p);
        if already_acked {
            ack(&db, &p, std::slice::from_ref(&id)).unwrap();
        }
        let first_turn = sessions::running_turn_id(&db, &member).unwrap().unwrap();
        sessions::end_turn(&db, &first_turn, "completed", None, None, false).unwrap();
        session_collaboration::settle_turn(&db, &first_turn).unwrap();
        let second = team::send_team_message(
            &db,
            team::SendMessageParams {
                team_session_id: &p.team_session_id,
                caller_session_id: &p.team_session_id,
                target_identifier: &member,
                content: "Follow-up task",
                idempotency_key: None,
            },
        )
        .unwrap();
        team::authority::record_dispatch(&db, &p.team_session_id, &second, false).unwrap();
        let failed =
            session_collaboration::begin_turn(&db, &member, &second.id, None, None).unwrap();
        sessions::end_turn(&db, &failed, "error", Some("FIXTURE_FAILURE"), None, false).unwrap();
        session_collaboration::settle_turn(&db, &failed).unwrap();
        // A subsequent failure does not revoke the old completed dispatch by itself.
        if already_acked {
            ack(&db, &p, std::slice::from_ref(&id)).unwrap();
        }
        team::replacements::create(
            &db,
            team::CreateMemberParams {
                team_session_id: &p.team_session_id,
                caller_session_id: &p.team_session_id,
                name: "replacement",
                description: None,
                context_kind: None,
                model_id: None,
                provider_id: None,
            },
            "expert",
        )
        .unwrap();
        assert!(ack(&db, &p, std::slice::from_ref(&id))
            .unwrap_err()
            .to_string()
            .starts_with("TEAM_UNAUTHORIZED:"));
        assert_eq!(
            get_proof(&db, &p.team_session_id, &id).unwrap()["proof"]["phase"],
            if already_acked { "acked" } else { "persisted" }
        );
        let records = transcripts::read_transcript(db.data_dir(), &p.team_session_id).unwrap();
        assert_eq!(
            records
                .iter()
                .filter(|record| record.id == delivery[0]["userMessageId"].as_str().unwrap())
                .count(),
            1
        );
    }
}
