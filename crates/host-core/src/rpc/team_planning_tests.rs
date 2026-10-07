use super::*;
#[tokio::test]
async fn planning_rpc_preserves_submission_retry_revision_and_execution_permissions() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider=call("providers.create",json!({"name":"Planning fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created=call("session.create",json!({"mode":"plan","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path()})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let turn_id = turn["turnId"].as_str().unwrap();
    let declare=call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn_id,"strategy":"delegate","reason":"Two distinct research areas","members":[{"name":"backend"},{"name":"frontend"}]})).await.unwrap();
    assert_eq!(declare["review"]["status"], "confirmed");
    assert_eq!(declare["review"]["launchPolicy"], "automatic_plan");
    assert!(declare["decision"]["messageIds"]
        .as_array()
        .unwrap()
        .is_empty());
    let denied = call("team.confirmLaunchReview",json!({"teamSessionId":lead,"reviewId":declare["review"]["reviewId"],"expectedRevision":declare["review"]["revision"]})).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    let roster = call(
        "team.getRoster",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    let members = roster["members"].as_array().unwrap();
    let context = call(
        "team.getRuntimeContext",
        json!({"sessionId":members[0]["memberSessionId"]}),
    )
    .await
    .unwrap();
    assert_eq!(context["workPurpose"], "plan_research");
    let lead_context = call("team.getRuntimeContext", json!({"sessionId":lead}))
        .await
        .unwrap();
    assert_eq!(lead_context["isLead"], true);
    assert_ne!(lead_context["workPurpose"], "plan_research");
    for tool in ["Write", "Bash", "Skill", "BrowserPreview"] {
        let denied = call(
            "tools.authorizeLocal",
            json!({"sessionId":members[0]["memberSessionId"],"mode":"agent","toolName":tool}),
        )
        .await
        .unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_RESEARCH_READ_ONLY");
        let denied=call("tools.execute",json!({"sessionId":members[0]["memberSessionId"],"toolCallId":"forged","mode":"agent","toolName":tool,"args":{}})).await.unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_RESEARCH_READ_ONLY");
    }
    let denied=call("team.createTask",json!({"teamSessionId":lead,"callerSessionId":members[0]["memberSessionId"],"subject":"Forged task"})).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_RESEARCH_READ_ONLY");
    let mut tasks = vec![];
    for member in members {
        tasks.push(call("team.createTask",json!({"teamSessionId":lead,"callerSessionId":lead,"ownerMemberName":member["name"],"subject":"Research source"})).await.unwrap());
        let message = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":member["name"],"content":"Inspect the current task"})).await.unwrap();
        let st = state.lock().await;
        let actual = crate::session_collaboration::begin_turn(
            &st.db,
            member["memberSessionId"].as_str().unwrap(),
            message["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
        sessions::end_turn(&st.db, &actual, "completed", None, None, false).unwrap();
        crate::session_collaboration::settle_turn(&st.db, &actual).unwrap();
    }
    let submission = |call_id: &str| json!({"sessionId":lead,"turnId":turn_id,"toolCallId":call_id,"kind":"plan","title":"Implementation plan","question":"Approve?","markdown":"# Plan\nBoth research areas inspected."});
    let early = call("plans.submit", submission("plan")).await.unwrap_err();
    assert_eq!(early.data.unwrap()["errorCode"], "TEAM_PLANNING_NOT_READY");
    for (index, member) in members.iter().enumerate() {
        call("team.submitResearchResult",json!({"teamSessionId":lead,"callerSessionId":member["memberSessionId"],"planningId":context["planningId"],"roundId":context["roundId"],"taskId":tasks[index]["task"]["taskId"],"expectedRevision":1,"structuredResult":{"summary":"Inspected source","findings":["File evidence"],"risks":["Lifecycle"],"recommendations":["Test transition"],"verifiedSources":["src/main.ts"]}})).await.unwrap();
        if index == 0 {
            let status = call(
                "team.getPlanning",
                json!({"teamSessionId":lead,"callerSessionId":lead}),
            )
            .await
            .unwrap();
            assert_eq!(status["totalExpectedTasks"], 2);
            assert_eq!(status["completedResearchTasks"], 1);
            assert_eq!(status["isReadyForPlanSubmission"], false);
        }
    }
    call("team.openPlanningQuestion",json!({"teamSessionId":lead,"callerSessionId":lead,"roundId":context["roundId"],"questionId":"user-question"})).await.unwrap();
    assert!(call("plans.submit", submission("plan")).await.is_err());
    call("team.closePlanningQuestion",json!({"teamSessionId":lead,"callerSessionId":lead,"roundId":context["roundId"],"questionId":"user-question"})).await.unwrap();
    let first = call("plans.submit", submission("plan")).await.unwrap();
    let retry = call("plans.submit", submission("plan")).await.unwrap();
    assert_eq!(retry["proposal"]["id"], first["proposal"]["id"]);
    call("plans.resolve",json!({"proposalId":first["proposal"]["id"],"sessionId":lead,"turnId":turn_id,"toolCallId":"plan","action":"reject","version":first["proposal"]["version"]})).await.unwrap();
    let stopped = call("plans.submit", submission("stopped")).await.unwrap();
    call("plans.abort", json!({"sessionId":lead}))
        .await
        .unwrap();
    let ready = call(
        "team.getPlanning",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(ready["phase"], "aggregating");
    assert_eq!(ready["completedResearchTasks"], 2);
    let expiring = call("plans.submit", submission("expiring")).await.unwrap();
    {
        let st = state.lock().await;
        st.db
            .conn()
            .execute(
                "UPDATE plan_approvals SET expires_at=0 WHERE request_id=?1",
                [expiring["proposal"]["id"].as_str().unwrap()],
            )
            .unwrap();
    }
    call("plans.pending", json!({"sessionId":lead}))
        .await
        .unwrap();
    let ready = call(
        "team.getPlanning",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(ready["phase"], "aggregating");
    assert_ne!(stopped["proposal"]["id"], expiring["proposal"]["id"]);
    let revised = call("plans.submit", submission("revision")).await.unwrap();
    assert_ne!(revised["proposal"]["id"], first["proposal"]["id"]);
    call("plans.resolve",json!({"proposalId":revised["proposal"]["id"],"sessionId":lead,"turnId":turn_id,"toolCallId":"revision","action":"approve","version":revised["proposal"]["version"],"targetPermissionMode":"auto"})).await.unwrap();
    let lead_session = call("session.get", json!({"id":lead})).await.unwrap();
    assert_eq!(lead_session["session"]["mode"], "agent");
    let denied=call("tools.execute",json!({"sessionId":lead,"toolCallId":"before-team-approval","mode":"agent","toolName":"Write","args":{"path":"approved.txt","content":"forbidden"}})).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    assert!(!workspace.path().join("approved.txt").exists());
    {
        let st = state.lock().await;
        sessions::end_turn(&st.db, turn_id, "completed", None, None, false).unwrap();
    }
    let execution_turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let execution = call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":execution_turn["turnId"],"strategy":"delegate","reason":"Execute approved plan","members":[{"name":"implementer"}]})).await.unwrap();
    assert_eq!(execution["review"]["status"], "pending");
    assert_eq!(execution["review"]["launchPolicy"], "user_confirmed");
    let confirmed=call("team.confirmLaunchReview",json!({"teamSessionId":lead,"reviewId":execution["review"]["reviewId"],"expectedRevision":execution["review"]["revision"]})).await.unwrap();
    let dispatch=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"implementer","content":"Implement approved plan"})).await.unwrap();
    {
        let st = state.lock().await;
        let actual = crate::session_collaboration::begin_turn(
            &st.db,
            confirmed["decision"]["memberSessionIds"][0]
                .as_str()
                .unwrap(),
            dispatch["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
        sessions::end_turn(&st.db, &actual, "completed", None, None, false).unwrap();
        crate::session_collaboration::settle_turn(&st.db, &actual).unwrap();
    }
    let written=call("tools.execute",json!({"sessionId":lead,"toolCallId":"approved-write","mode":"agent","toolName":"Write","args":{"path":"approved.txt","content":"approved"}})).await.unwrap();
    assert_eq!(written["ok"], true);
    assert_eq!(
        std::fs::read_to_string(workspace.path().join("approved.txt")).unwrap(),
        "approved"
    );
    assert!(call(
        "tools.authorizeLocal",
        json!({"sessionId":members[0]["memberSessionId"],"toolName":"Skill","mode":"agent"})
    )
    .await
    .is_err());
}

#[tokio::test]
async fn forced_team_rpc_rejects_solo_and_requires_actual_expert_before_plan_submission() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider=call("providers.create",json!({"name":"Forced fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created=call("session.create",json!({"mode":"plan","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path()})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let turn_id = turn["turnId"].as_str().unwrap();
    let solo=call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn_id,"strategy":"lead_only","reason":"No experts"})).await.unwrap_err();
    assert_eq!(solo.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    let declared=call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn_id,"strategy":"delegate","reason":"Expert required","members":[{"name":"researcher"}]})).await.unwrap();
    for tool in [
        "Bash",
        "Write",
        "Edit",
        "Skill",
        "plugin_execute",
        "SubmitPlan",
    ] {
        let denied = call(
            "team.authorizeLeadTool",
            json!({"teamSessionId":lead,"callerSessionId":lead,"toolName":tool}),
        )
        .await
        .unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
        let denied=call("tools.execute",json!({"sessionId":lead,"toolCallId":"denied","mode":"agent","toolName":tool,"args":{}})).await.unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    }
    call(
        "team.authorizeLeadTool",
        json!({"teamSessionId":lead,"callerSessionId":lead,"toolName":"asktool"}),
    )
    .await
    .unwrap();
    let denied = call(
        "team.authorizeLeadTool",
        json!({"teamSessionId":lead,"callerSessionId":"spoofed","toolName":"Write"}),
    )
    .await
    .unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_UNAUTHORIZED");
    assert_eq!(declared["review"]["launchPolicy"], "automatic_plan");
    let confirmed = declared;
    let member = confirmed["decision"]["memberSessionIds"][0]
        .as_str()
        .unwrap();
    let submission = || json!({"sessionId":lead,"turnId":turn_id,"toolCallId":"proposal","kind":"plan","title":"Team plan","question":"Approve?","markdown":"# Plan"});
    let denied = call("plans.submit", submission()).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    let task=call("team.createTask",json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Inspect","ownerMemberName":"researcher"})).await.unwrap();
    let dispatch=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"researcher","content":"Inspect task"})).await.unwrap();
    assert!(
        call("plans.submit", submission()).await.is_err(),
        "queued expert is insufficient"
    );
    let actual = {
        let st = state.lock().await;
        crate::session_collaboration::begin_turn(
            &st.db,
            member,
            dispatch["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap()
    };
    call(
        "team.authorizeLeadTool",
        json!({"teamSessionId":lead,"callerSessionId":lead,"toolName":"SubmitPlan"}),
    )
    .await
    .unwrap();
    let context = call("team.getRuntimeContext", json!({"sessionId":member}))
        .await
        .unwrap();
    call("team.submitResearchResult",json!({"teamSessionId":lead,"callerSessionId":member,"planningId":context["planningId"],"roundId":context["roundId"],"taskId":task["task"]["taskId"],"expectedRevision":1,"structuredResult":{"summary":"Inspected source","findings":["Evidence"],"risks":[],"recommendations":["Implement"],"verifiedSources":["src/main.ts"]}})).await.unwrap();
    {
        let st = state.lock().await;
        sessions::end_turn(&st.db, &actual, "completed", None, None, false).unwrap();
        crate::session_collaboration::settle_turn(&st.db, &actual).unwrap();
    }
    // A structured result alone is insufficient while semantic expert mail
    // remains in the mailbox, including an already-admitted queue receipt.
    let first_mail = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":member,"target":"Lead","content":"Architectural findings"})).await.unwrap();
    let second_mail = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":member,"target":"Lead","content":"An additional compatibility risk"})).await.unwrap();
    let user_entry = {
        let st = state.lock().await;
        let queued = |id: &str, message_id: Option<String>| crate::turn_queue::QueuedTurnInput {
            id: Some(id.into()),
            session_id: lead.into(),
            principal: "test".into(),
            idempotency_key: None,
            input_hash: id.into(),
            content: id.into(),
            session_message_id: message_id,
            user_message_id: None,
            voice_origin: None,
            attachments: None,
            permission_mode: "auto".into(),
        };
        let user = crate::turn_queue::push(&st.db, queued("user-request", None)).unwrap();
        crate::turn_queue::push(
            &st.db,
            queued(
                "team-receipt",
                Some(first_mail["message"]["id"].as_str().unwrap().into()),
            ),
        )
        .unwrap();
        crate::team::ack_team_message(
            &st.db,
            lead,
            lead,
            first_mail["message"]["id"].as_str().unwrap(),
            Some("queued"),
        )
        .unwrap();
        user
    };
    let status = call(
        "team.getPlanning",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(status["pendingMessagesCount"], 2);
    assert_eq!(status["isReadyForPlanSubmission"], false);
    // Existing readiness failures remain failures even when there is mail.
    call("team.openPlanningQuestion", json!({"teamSessionId":lead,"callerSessionId":lead,"roundId":context["roundId"],"questionId":"remaining-question"})).await.unwrap();
    assert_eq!(
        call("plans.submit", submission())
            .await
            .unwrap_err()
            .data
            .unwrap()["errorCode"],
        "TEAM_PLANNING_NOT_READY"
    );
    call("team.closePlanningQuestion", json!({"teamSessionId":lead,"callerSessionId":lead,"roundId":context["roundId"],"questionId":"remaining-question"})).await.unwrap();
    while rx.try_recv().is_ok() {}
    let deferred = call("plans.submit", submission()).await.unwrap();
    while let Ok(note) = rx.try_recv() {
        let note: Value = serde_json::from_str(&note).unwrap();
        assert_ne!(
            note["method"], "plans.changed",
            "deferral is not a proposal"
        );
    }
    assert_eq!(
        deferred,
        json!({"status":"deferred","reason":"team_messages_pending","pendingMessagesCount":2})
    );
    assert!(call("plans.pending", json!({"sessionId":lead}))
        .await
        .unwrap()["plans"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(
        !workspace.path().join(".pi/plan").exists(),
        "defer must not publish an artifact"
    );
    // Invalid actor/turn remains an error rather than an inbox deferral.
    let mut stale = submission();
    stale["turnId"] = json!("stale-turn");
    assert_eq!(
        call("plans.submit", stale).await.unwrap_err().data.unwrap()["errorCode"],
        "PLAN_APPROVAL_STALE"
    );
    {
        let st = state.lock().await;
        sessions::end_turn(&st.db, turn_id, "completed", None, None, false).unwrap();
    }
    let first_turn = {
        let st = state.lock().await;
        crate::session_collaboration::begin_turn(
            &st.db,
            lead,
            first_mail["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap()
    };
    let continuation = |turn: &str| {
        let mut p = submission();
        p["turnId"] = json!(turn);
        p
    };
    assert_eq!(
        call("plans.submit", continuation(&first_turn))
            .await
            .unwrap(),
        json!({"status":"deferred","reason":"team_messages_pending","pendingMessagesCount":1})
    );
    {
        let st = state.lock().await;
        sessions::end_turn(&st.db, &first_turn, "completed", None, None, false).unwrap();
        crate::session_collaboration::settle_turn(&st.db, &first_turn).unwrap();
    }
    let final_turn = {
        let st = state.lock().await;
        crate::session_collaboration::begin_turn(
            &st.db,
            lead,
            second_mail["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap()
    };
    let submitted = call("plans.submit", continuation(&final_turn))
        .await
        .unwrap();
    assert_eq!(submitted["status"], "pending");
    assert_eq!(submitted["proposal"]["markdown"], "# Plan");
    assert_eq!(
        call("plans.submit", continuation(&final_turn))
            .await
            .unwrap(),
        submitted
    );
    {
        let st = state.lock().await;
        assert!(crate::turn_queue::list(&st.db, Some(lead))
            .unwrap()
            .contains(&user_entry));
        let count: i64 = st
            .db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM plan_approvals WHERE session_id=?1",
                [lead],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    assert_eq!(
        std::fs::read_dir(workspace.path().join(".pi/plan"))
            .unwrap()
            .count(),
        1
    );
}

#[tokio::test]
async fn direct_team_mutation_rpc_cannot_reuse_an_old_approval_for_a_new_pending_turn() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider=call("providers.create",json!({"name":"Scoped fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created=call("session.create",json!({"executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture"})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let first = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let declaration = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":first["turnId"],"strategy":"delegate","reason":"Approved old work","members":[{"name":"worker"}]})).await.unwrap();
    call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":declaration["review"]["reviewId"],"expectedRevision":1})).await.unwrap();
    let task = call("team.createTask", json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Original task","ownerMemberName":"worker"})).await.unwrap();
    let old_dispatch=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"worker","content":"Original dispatch","idempotencyKey":"old-dispatch"})).await.unwrap();
    {
        let st = state.lock().await;
        let actual = crate::session_collaboration::begin_turn(
            &st.db,
            old_dispatch["message"]["targetSessionId"].as_str().unwrap(),
            old_dispatch["message"]["id"].as_str().unwrap(),
            None,
            None,
        )
        .unwrap();
        sessions::end_turn(&st.db, &actual, "completed", None, None, false).unwrap();
        crate::session_collaboration::settle_turn(&st.db, &actual).unwrap();
    }

    {
        let st = state.lock().await;
        sessions::end_turn(
            &st.db,
            first["turnId"].as_str().unwrap(),
            "completed",
            None,
            None,
            false,
        )
        .unwrap();
    }
    let next = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":next["turnId"],"strategy":"delegate","reason":"New work needs fresh user consent","members":[{"name":"new-worker"}]})).await.unwrap();
    let before = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    for (method, extra) in [
        (
            "team.createTask",
            json!({"subject":"Unauthorized new task"}),
        ),
        (
            "team.updateTask",
            json!({"taskId":task["task"]["taskId"],"expectedRevision":1,"subject":"Unauthorized change"}),
        ),
        (
            "team.sendMessage",
            json!({"target":"worker","content":"Unauthorized dispatch"}),
        ),
        ("team.createMember", json!({"name":"worker"})),
    ] {
        let mut args = json!({"teamSessionId":lead,"callerSessionId":lead});
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let denied = call(method, args).await.unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    }
    let after = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(after, before);
    let review = call("team.getLaunchReview", json!({"teamSessionId":lead}))
        .await
        .unwrap();
    call(
        "team.confirmLaunchReview",
        json!({"teamSessionId":lead,"reviewId":review["review"]["reviewId"],"expectedRevision":1}),
    )
    .await
    .unwrap();
    let before_subset = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    for (method, extra) in [
        (
            "team.sendMessage",
            json!({"target":"worker","content":"Expert absent from current review"}),
        ),
        ("team.createMember", json!({"name":"worker"})),
        (
            "team.createTask",
            json!({"subject":"Unapproved expert task","ownerMemberName":"worker"}),
        ),
        (
            "team.updateTask",
            json!({"taskId":task["task"]["taskId"],"expectedRevision":1,"ownerMemberName":"worker"}),
        ),
    ] {
        let mut args = json!({"teamSessionId":lead,"callerSessionId":lead});
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let denied = call(method, args).await.unwrap_err();
        assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    }
    let after_subset = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(after_subset, before_subset);
    {
        let st = state.lock().await;
        sessions::end_turn(
            &st.db,
            next["turnId"].as_str().unwrap(),
            "completed",
            None,
            None,
            false,
        )
        .unwrap();
    }
    let third = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let subset = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":third["turnId"],"strategy":"delegate","reason":"Only this roster is approved","members":[{"name":"current-worker"}]})).await.unwrap();
    call(
        "team.confirmLaunchReview",
        json!({"teamSessionId":lead,"reviewId":subset["review"]["reviewId"],"expectedRevision":1}),
    )
    .await
    .unwrap();
    let denied = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"worker","content":"Old roster is not this approval"})).await.unwrap_err();
    assert_eq!(denied.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"current-worker","content":"Approved current dispatch"})).await.unwrap();
    {
        let st = state.lock().await;
        sessions::end_turn(
            &st.db,
            third["turnId"].as_str().unwrap(),
            "completed",
            None,
            None,
            false,
        )
        .unwrap();
    }
    let fourth = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let reused=call("team.declareStrategy",json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":fourth["turnId"],"strategy":"delegate","reason":"Fresh work with a reused expert","members":[{"name":"worker"}]})).await.unwrap();
    call(
        "team.confirmLaunchReview",
        json!({"teamSessionId":lead,"reviewId":reused["review"]["reviewId"],"expectedRevision":1}),
    )
    .await
    .unwrap();
    let before_replay = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    let replay=call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"worker","content":"Original dispatch","idempotencyKey":"old-dispatch"})).await.unwrap_err();
    assert_eq!(replay.data.unwrap()["errorCode"], "TEAM_APPROVAL_REQUIRED");
    let after_replay = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(
        after_replay, before_replay,
        "old expert execution cannot be adopted into a fresh approval"
    );
}

#[tokio::test]
async fn new_user_scope_notifies_a_fresh_snapshot_without_obsolete_pending_approval() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider=call("providers.create",json!({"name":"Scope fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created=call("session.create",json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture"})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let first = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let proposal = |turn: &Value| json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn["turnId"],"strategy":"delegate","reason":"Approve current execution experts","members":[{"name":"expert"}]});
    let original = call("team.declareStrategy", proposal(&first))
        .await
        .unwrap();
    call(
        "session.endTurn",
        json!({"sessionId":lead,"turnId":first["turnId"],"status":"completed"}),
    )
    .await
    .unwrap();
    let before = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(before["review"]["reviewId"], original["review"]["reviewId"]);
    while rx.try_recv().is_ok() {}
    let next = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let after = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert!(after["review"].is_null());
    assert!(after["revision"].as_i64().unwrap() > before["revision"].as_i64().unwrap());
    let mut notified = false;
    while let Ok(raw) = rx.try_recv() {
        let note: Value = serde_json::from_str(&raw).unwrap();
        if note["method"] == "team.changed"
            && note["params"]["teamSessionId"] == lead
            && note["params"]["reason"] == "activity"
            && note["params"]["revision"] == after["revision"]
        {
            notified = true;
        }
    }
    assert!(
        notified,
        "cached readers receive the newer scope activity revision"
    );
    let historical = call(
        "team.getLaunchReview",
        json!({"teamSessionId":lead,"reviewId":original["review"]["reviewId"]}),
    )
    .await
    .unwrap();
    assert_eq!(historical["review"]["status"], "pending");
    let current = call("team.declareStrategy", proposal(&next)).await.unwrap();
    let latest = call(
        "team.getSnapshot",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(latest["review"]["reviewId"], current["review"]["reviewId"]);
}
