use super::*;

#[tokio::test]
async fn expert_settings_cas_rejects_lost_updates_and_never_persists_metadata() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let first = json!({"schemaVersion":1,"userDefaults":{"qa":{"instructions":"QA change"}},"projectOverrides":{}});
    let second = json!({"schemaVersion":1,"userDefaults":{"reviewer":{"instructions":"Review change"}},"projectOverrides":{}});
    let missing_expected = call("settings.set", json!({"expertTeam":first}))
        .await
        .unwrap_err();
    assert_eq!(
        missing_expected.data.unwrap()["errorCode"],
        "TEAM_CONFIG_CONFLICT"
    );
    call(
        "settings.set",
        json!({"expertTeam":first,"expertTeamExpected":null}),
    )
    .await
    .unwrap();
    let conflict = call(
        "settings.set",
        json!({"expertTeam":second,"expertTeamExpected":null}),
    )
    .await
    .unwrap_err();
    assert_eq!(conflict.data.unwrap()["errorCode"], "TEAM_CONFIG_CONFLICT");
    let current = call("settings.get", json!({})).await.unwrap();
    assert_eq!(current["expertTeam"], first);
    assert!(current.get("expertTeamExpected").is_none());
    let mut stale_legacy_snapshot = current.clone();
    stale_legacy_snapshot["theme"] = json!("light");
    let merged = json!({"schemaVersion":1,"userDefaults":{"qa":{"instructions":"QA change"},"reviewer":{"instructions":"Review change"}},"projectOverrides":{}});
    call(
        "settings.set",
        json!({"expertTeam":merged,"expertTeamExpected":first}),
    )
    .await
    .unwrap();
    let current = call("settings.get", json!({})).await.unwrap();
    assert_eq!(current["expertTeam"], merged);
    assert!(current.get("expertTeamExpected").is_none());
    // A legacy full-settings caller must not overwrite the newer expert edit.
    let conflict = call("settings.set", stale_legacy_snapshot)
        .await
        .unwrap_err();
    assert_eq!(conflict.data.unwrap()["errorCode"], "TEAM_CONFIG_CONFLICT");
    assert_eq!(call("settings.get", json!({})).await.unwrap(), current);
}

#[tokio::test]
async fn stale_project_or_provider_defaults_roundtrip_and_reset_without_blocking_other_settings() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let provider = call("providers.create", json!({"name":"Stale default fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let id = &provider["provider"]["id"];
    let project = call(
        "session.create",
        json!({"mode":"agent","providerId":id,"modelId":"fixture","projectPath":workspace.path()}),
    )
    .await
    .unwrap();
    let path = project["session"]["projectPath"].as_str().unwrap();
    let config = json!({"schemaVersion":1,"userDefaults":{"qa":{"providerId":id,"modelId":"fixture","tools":["Read"]}},"projectOverrides":{path:{"qa":{"instructions":"Historical project"}}}});
    call(
        "settings.set",
        json!({"expertTeam":config,"expertTeamExpected":null,"theme":"dark"}),
    )
    .await
    .unwrap();
    call("projects.remove", json!({"path":path})).await.unwrap();
    call("providers.update", json!({"id":id,"enabled":false}))
        .await
        .unwrap();
    let mut full = call("settings.get", json!({})).await.unwrap();
    full["theme"] = json!("light");
    call("settings.set", full).await.unwrap();
    let saved = call("settings.get", json!({})).await.unwrap();
    assert_eq!(saved["theme"], "light");
    assert_eq!(saved["expertTeam"], config);
    // An unchanged disabled reference survives editing a different role.
    let mut changed = config.clone();
    changed["userDefaults"]["reviewer"] = json!({"instructions":"New reviewer instructions"});
    call(
        "settings.set",
        json!({"expertTeam":changed,"expertTeamExpected":config}),
    )
    .await
    .unwrap();
    let mut invalid = changed.clone();
    invalid["userDefaults"]["reviewer"] = json!({"providerId":id,"modelId":"fixture"});
    assert!(call(
        "settings.set",
        json!({"expertTeam":invalid,"expertTeamExpected":changed})
    )
    .await
    .is_err());
    let mut invalid = changed.clone();
    invalid["projectOverrides"]["/new-unknown"] = json!({});
    assert!(call(
        "settings.set",
        json!({"expertTeam":invalid,"expertTeamExpected":changed})
    )
    .await
    .is_err());
    call(
        "settings.set",
        json!({"expertTeam":{"schemaVersion":1,"userDefaults":{},"projectOverrides":{}},"expertTeamExpected":changed}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn expert_settings_rpc_roundtrip_snapshot_and_host_tool_denials() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    let initial = call("settings.get", json!({})).await.unwrap();
    assert!(initial.get("expertTeam").is_none());
    let provider = call("providers.create", json!({"name":"Expert config fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture","contextWindow":128000,"maxTokens":2048}]})).await.unwrap();
    let created = call("session.create", json!({"mode":"plan","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path()})).await.unwrap();
    let lead = created["session"]["id"].as_str().unwrap();
    let path = created["session"]["projectPath"].as_str().unwrap();
    let config = json!({"schemaVersion":1,"userDefaults":{"researcher":{"tools":["Read"],"instructions":"User defaults"}},"projectOverrides":{path:{"researcher":{"instructions":"Project research"}}}});
    call(
        "settings.set",
        json!({"expertTeam":config,"expertTeamExpected":null,"theme":"light"}),
    )
    .await
    .unwrap();
    let saved = call("settings.get", json!({})).await.unwrap();
    assert_eq!(saved["expertTeam"], config);
    for malformed in [
        json!(null),
        json!({"schemaVersion":2,"userDefaults":{},"projectOverrides":{}}),
        json!({"schemaVersion":1,"userDefaults":{},"projectOverrides":{"/unknown":{}}}),
    ] {
        let failure = call(
            "settings.set",
            json!({"expertTeam":malformed,"expertTeamExpected":config,"theme":"dark"}),
        )
        .await
        .unwrap_err();
        assert_eq!(failure.data.unwrap()["errorCode"], "INVALID_PARAMS");
        assert_eq!(call("settings.get", json!({})).await.unwrap(), saved);
    }
    let turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap();
    let launched = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn["turnId"],"strategy":"delegate","reason":"Research","members":[{"name":"Alex","presetId":"researcher"}]})).await.unwrap();
    assert_eq!(launched["review"]["status"], "confirmed");
    let member = &launched["decision"]["memberSessionIds"][0];
    let context = call("team.getRuntimeContext", json!({"sessionId":member}))
        .await
        .unwrap();
    assert_eq!(context["expertConfig"]["presetId"], "researcher");
    assert_eq!(context["expertConfig"]["instructions"], "Project research");
    assert_eq!(context["expertConfig"]["tools"], json!(["Read"]));
    for tool in ["Grep", "mcp_read", "plugin_execute", "read"] {
        for (method, args) in [
            (
                "tools.authorizeLocal",
                json!({"sessionId":member,"mode":"agent","toolName":tool}),
            ),
            (
                "tools.execute",
                json!({"sessionId":member,"mode":"agent","toolName":tool,"toolCallId":"forged","args":{}}),
            ),
        ] {
            let denied = call(method, args).await.unwrap_err();
            // Plan owns the earlier gate for unknown tools; either deny cannot
            // be bypassed by a forged mode or similarly named external tool.
            assert!(matches!(
                denied.data.unwrap()["errorCode"].as_str(),
                Some("TEAM_UNAUTHORIZED" | "TEAM_RESEARCH_READ_ONLY")
            ));
        }
    }
    call("settings.set", json!({"expertTeam":{"schemaVersion":1,"userDefaults":{"researcher":{"tools":[],"instructions":"Changed"}},"projectOverrides":{}},"expertTeamExpected":config})).await.unwrap();
    assert_eq!(
        call("team.getRuntimeContext", json!({"sessionId":member}))
            .await
            .unwrap()["expertConfig"],
        context["expertConfig"]
    );
    call("settings.set", json!({"theme":"dark"})).await.unwrap();
    assert_eq!(
        call("settings.get", json!({})).await.unwrap()["theme"],
        "dark"
    );
}
