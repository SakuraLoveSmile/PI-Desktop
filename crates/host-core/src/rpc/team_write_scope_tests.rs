use super::*;

#[tokio::test]
async fn team_write_scope_warning_succeeds_and_counts_only_current_task_mutations() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    std::fs::create_dir(workspace.path().join("owned")).unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call = |method: &'static str, args| {
        let request = handle_request(state.clone(), method, args, tx.clone());
        async move {
            tokio::time::timeout(std::time::Duration::from_secs(10), request)
                .await
                .unwrap_or_else(|_| panic!("RPC timed out: {method}"))
        }
    };
    let provider = call("providers.create", json!({"name":"Scope fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture"}]})).await.unwrap();
    let lead = call("session.create", json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path(),"permissionMode":"auto"})).await.unwrap()["session"]["id"].as_str().unwrap().to_owned();
    call(
        "session.configure",
        json!({"id":lead,"mode":"agent","permissionMode":"auto"}),
    )
    .await
    .unwrap();
    let lead_turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap()["turnId"]
        .clone();
    let review = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":lead_turn,"strategy":"delegate","reason":"Check advisory scopes","members":[{"name":"builder","contextKind":"fresh"}]})).await.unwrap()["review"].clone();
    let decision = call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":review["reviewId"],"expectedRevision":review["revision"]})).await.unwrap()["decision"].clone();
    let member = decision["memberSessionIds"][0].clone();
    let task = call("team.createTask", json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Write owned source","ownerMemberName":"builder","writeScopes":["owned"]})).await.unwrap()["task"].clone();
    let other = call("team.createTask", json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Unstarted task","ownerMemberName":"builder","writeScopes":["elsewhere"]})).await.unwrap()["task"].clone();
    let dispatch = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Start the assigned source task"})).await.unwrap()["message"]["id"].clone();
    let member_turn = call(
        "session.beginTurn",
        json!({"sessionId":member,"sessionMessageId":dispatch}),
    )
    .await
    .unwrap()["turnId"]
        .clone();
    let active = call("team.updateTask", json!({"teamSessionId":lead,"callerSessionId":member,"taskId":task["taskId"],"expectedRevision":task["revision"],"status":"in_progress"})).await.unwrap()["task"].clone();
    let write = |id: &str, path: &str| json!({"sessionId":member,"turnId":member_turn,"toolCallId":id,"toolName":"Write","mode":"agent","args":{"path":path,"content":"first\n"}});
    let inside = call("tools.execute", write("inside", "owned/source.txt"))
        .await
        .unwrap();
    assert_eq!(inside["ok"], true);
    assert!(inside["content"].get("scopeWarning").is_none());
    let outside = call("tools.execute", write("outside", "elsewhere/source.txt"))
        .await
        .unwrap();
    assert_eq!(outside["ok"], true);
    assert_eq!(
        std::fs::read_to_string(workspace.path().join("elsewhere/source.txt")).unwrap(),
        "first\n"
    );
    assert_eq!(
        outside["content"]["scopeWarning"]["code"],
        "TEAM_WRITE_SCOPE_WARNING"
    );
    assert_eq!(
        outside["content"]["scopeWarning"]["taskIds"],
        json!([task["taskId"]])
    );
    assert!(outside["content"]["scopeWarning"]["message"]
        .as_str()
        .unwrap()
        .contains("succeeded"));
    let replay = call("tools.execute", write("outside", "elsewhere/source.txt"))
        .await
        .unwrap();
    assert_eq!(replay["ok"], true);
    let edit = call("tools.execute", json!({"sessionId":member,"turnId":member_turn,"toolCallId":"edit-outside","toolName":"Edit","mode":"agent","args":{"path":"elsewhere/source.txt","old_string":"first","new_string":"second"}})).await.unwrap();
    assert_eq!(edit["ok"], true);
    assert_eq!(
        edit["content"]["scopeWarning"]["code"],
        "TEAM_WRITE_SCOPE_WARNING"
    );
    let failed = call("tools.execute", json!({"sessionId":member,"turnId":member_turn,"toolCallId":"failed-edit","toolName":"Edit","mode":"agent","args":{"path":"elsewhere/source.txt","old_string":"absent","new_string":"second"}})).await.unwrap();
    assert_eq!(failed["ok"], false);
    assert!(failed["content"].get("scopeWarning").is_none());
    let board = call(
        "team.getBoard",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    assert_eq!(board["outOfScopeWriteCount"], 2);
    assert_eq!(board["outOfScopeWrites"][0]["memberSessionId"], member);
    assert_eq!(board["outOfScopeWrites"][0]["count"], 2);
    assert!(board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["taskId"] == other["taskId"] && t["status"] == "pending"));
    // Clearing scopes opts this active task out without changing write authority.
    call("team.updateTask", json!({"teamSessionId":lead,"callerSessionId":member,"taskId":task["taskId"],"expectedRevision":active["revision"],"writeScopes":[]})).await.unwrap();
    let unrestricted = call("tools.execute", write("unrestricted", "other.txt"))
        .await
        .unwrap();
    assert_eq!(unrestricted["ok"], true);
    assert!(unrestricted["content"].get("scopeWarning").is_none());
    assert_eq!(
        call(
            "team.getBoard",
            json!({"teamSessionId":lead,"callerSessionId":member})
        )
        .await
        .unwrap()["outOfScopeWriteCount"],
        2
    );
    let st = state.lock().await;
    let current = crate::team::get_team_task(&st.db, &lead, task["taskId"].as_str().unwrap())
        .unwrap()
        .unwrap();
    crate::team::update_team_task(
        &st.db,
        crate::team::UpdateTaskParams {
            team_session_id: &lead,
            caller_session_id: member.as_str().unwrap(),
            task_id: &current.task_id,
            expected_revision: current.revision,
            subject: None,
            description: None,
            status: None,
            owner_session_id: None,
            owner_member_name: None,
            blocked_by: None,
            write_scopes: Some(vec!["owned".into()]),
            deleted: None,
        },
    )
    .unwrap();
    let captured = crate::team::write_scopes::capture(
        &st.db,
        member.as_str().unwrap(),
        member_turn.as_str(),
        "Write",
    )
    .unwrap();
    assert!(captured.is_some());
    // The filesystem operation has committed, but deletion wins during its await.
    crate::sessions::delete_session_with_team_cleanup(&st.db, &lead).unwrap();
    let mut late_result = crate::tools::ToolsExecuteResult {
        tool_call_id: "late".into(),
        ok: true,
        is_error: Some(false),
        content: outside["content"].clone(),
        duration_ms: 1,
        denied: Some(false),
        error_code: None,
        command_shell_id: None,
    };
    crate::team::write_scopes::annotate_observable(
        &st.db,
        captured.as_ref(),
        Some(workspace.path()),
        "late",
        &mut late_result,
    );
    assert!(late_result.ok);
    assert!(late_result.content["scopeTrackingSkipped"]
        .as_str()
        .unwrap()
        .contains("detached"));
    assert!(crate::team::write_scopes::counts(&st.db, &lead)
        .unwrap()
        .is_empty());
}
