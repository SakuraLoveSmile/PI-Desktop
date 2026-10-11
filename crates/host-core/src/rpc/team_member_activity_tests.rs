use super::*;

#[tokio::test]
async fn team_member_activity_protects_twenty_minute_background_work() {
    let root = tempfile::tempdir().unwrap();
    let mut app = AppState::open(root.path()).unwrap();
    app.handshook = true;
    let lead = sessions::create_session_with_options(
        &app.db,
        sessions::SessionCreateOptions {
            execution_profile: Some("team".into()),
            mode: Some("agent".into()),
            ..Default::default()
        },
    )
    .unwrap()
    .id;
    let config = json!({"models":[{"id":"fixture", "thinkingLevels":["off"]}]}).to_string();
    app.db.conn().execute("INSERT INTO providers (id,name,config_json,created_at,updated_at) VALUES ('fixture','Fixture',?1,0,0)", [&config]).unwrap();
    app.db.conn().execute("INSERT INTO models (provider_id,model_id,display_name,updated_at) VALUES ('fixture','fixture','Fixture',0)", []).unwrap();
    app.db.conn().execute("UPDATE sessions SET provider_id='fixture',model_id='fixture',thinking_level='off' WHERE id=?1", [&lead]).unwrap();
    let turn = sessions::begin_turn(&app.db, &lead, None, None).unwrap();
    let (_, review) = crate::team::declare_team_strategy(
        &app.db,
        crate::team::DeclareStrategyParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            lead_turn_id: &turn,
            strategy: "delegate",
            reason: "Activity accident replay",
            members: Some(vec![crate::team::TeamProposedMember {
                name: "tester".into(),
                preset_id: None,
                description: None,
                context_kind: None,
                member_session_id: None,
                presentation: None,
                selection: None,
            }]),
        },
    )
    .unwrap();
    let review = review.unwrap();
    let (_, approval) =
        crate::team::confirm_launch_review(&app.db, &lead, &review.review_id, review.revision)
            .unwrap();
    let member = approval.member_session_ids[0].clone();
    let dispatch = crate::team::send_team_message(
        &app.db,
        crate::team::SendMessageParams {
            team_session_id: &lead,
            caller_session_id: &lead,
            target_identifier: "tester",
            content: "Run the long test",
            idempotency_key: None,
        },
    )
    .unwrap();
    let member_turn =
        crate::session_collaboration::begin_turn(&app.db, &member, &dispatch.id, None, None)
            .unwrap();
    let now = crate::db::now_ms();
    app.db
        .conn()
        .execute(
            "UPDATE turns SET started_at=?2 WHERE id=?1",
            rusqlite::params![member_turn, now - 1_200_000],
        )
        .unwrap();
    let started = chrono::DateTime::from_timestamp_millis(now - 1_200_000)
        .unwrap()
        .to_rfc3339();
    app.db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES ('long-test',?1,'bash-test','fixture command','fixture','running',?2)", rusqlite::params![member, started]).unwrap();
    let state = Arc::new(Mutex::new(app));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let args = json!({"teamSessionId":lead,"callerSessionId":lead,"memberName":"tester"});
    let error = handle_request(
        state.clone(),
        "team.interruptMember",
        args.clone(),
        tx.clone(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "TEAM_MEMBER_ACTIVE");
    assert!(rx.try_recv().is_err(), "refusal must not emit interruption");
    let roster = handle_request(
        state.clone(),
        "team.getRoster",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
        tx.clone(),
    )
    .await
    .unwrap();
    let evidence = roster["memberActivity"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["memberSessionId"] == member)
        .unwrap();
    assert_eq!(evidence["runningBackgroundProcesses"][0]["id"], "long-test");
    assert!(evidence["turn"]["durationMs"].as_i64().unwrap() >= 1_200_000);
    let mut forced = args.clone();
    forced["force"] = json!(true);
    let error = handle_request(
        state.clone(),
        "team.interruptMember",
        forced.clone(),
        tx.clone(),
    )
    .await
    .unwrap_err();
    assert_eq!(
        error.data.unwrap()["errorCode"],
        "TEAM_INTERRUPT_REASON_REQUIRED"
    );
    forced["reason"] = json!("The test was superseded by the user");
    assert_eq!(
        handle_request(state.clone(), "team.interruptMember", forced, tx.clone())
            .await
            .unwrap()["interrupted"],
        true
    );
    let note: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
    assert_eq!(note["params"]["turnId"], member_turn);
    {
        let st = state.lock().await;
        let audit: String = st
            .db
            .conn()
            .query_row(
                "SELECT payload_json FROM audit_log WHERE kind='team_member_interrupt'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let audit: Value = serde_json::from_str(&audit).unwrap();
        assert_eq!(audit["force"], true);
        assert_eq!(audit["reason"], "The test was superseded by the user");
        assert_eq!(audit["memberSessionId"], member);
    }
    let error = handle_request(state.clone(), "team.interruptMember", json!({
        "teamSessionId":lead,"callerSessionId":member,"memberName":"tester","force":true,"reason":"Unauthorized override",
    }), tx.clone()).await.unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "TEAM_UNAUTHORIZED");
    assert!(rx.try_recv().is_err());
    {
        let st = state.lock().await;
        st.db.conn().execute("UPDATE background_processes SET status='completed',ended_at=started_at WHERE id='long-test'", []).unwrap();
    }
    // Incoming work/report queues do not prove that the recipient is executing.
    let roster = handle_request(
        state.clone(),
        "team.getRoster",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
        tx.clone(),
    )
    .await
    .unwrap();
    let evidence = roster["memberActivity"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["memberSessionId"] == member)
        .unwrap();
    assert_eq!(evidence["requiresForce"], false, "{evidence}");
    assert_eq!(
        handle_request(
            state.clone(),
            "team.interruptMember",
            args.clone(),
            tx.clone()
        )
        .await
        .unwrap()["interrupted"],
        true
    );
    let _ = rx.try_recv().unwrap();
    {
        let mut st = state.lock().await;
        st.register_bash_cancellation(&member, "foreground-test")
            .unwrap();
    }
    let error = handle_request(state.clone(), "team.interruptMember", args, tx.clone())
        .await
        .unwrap_err();
    assert_eq!(error.data.unwrap()["errorCode"], "TEAM_MEMBER_ACTIVE");
    assert!(
        rx.try_recv().is_err(),
        "active foreground Bash ownership must also protect a quiet test"
    );
}
