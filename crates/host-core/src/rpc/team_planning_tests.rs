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
    call("team.confirmLaunchReview",json!({"teamSessionId":lead,"reviewId":declare["review"]["reviewId"],"expectedRevision":declare["review"]["revision"]})).await.unwrap();
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
