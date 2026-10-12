use super::*;

#[tokio::test]
async fn subagent_limits_roundtrip_restart_and_reject_invalid_writes_atomically() {
    let data = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call =
        |method: &'static str, params| handle_request(state.clone(), method, params, tx.clone());
    call(
        "settings.set",
        json!({"theme":"light", "subagentMaxDepth":3, "subagentMaxConcurrency":12}),
    )
    .await
    .unwrap();
    call("settings.set", json!({"subagentMaxDepth":0}))
        .await
        .unwrap();
    let saved = call("settings.get", json!({})).await.unwrap();
    assert_eq!(saved["theme"], "light");
    assert_eq!(saved["subagentMaxDepth"], 0);
    assert_eq!(saved["subagentMaxConcurrency"], 12);
    for (key, invalid) in [
        ("subagentMaxDepth", json!(-1)),
        ("subagentMaxDepth", json!(9)),
        ("subagentMaxDepth", json!(1.5)),
        ("subagentMaxDepth", json!(null)),
        ("subagentMaxConcurrency", json!(0)),
        ("subagentMaxConcurrency", json!(33)),
        ("subagentMaxConcurrency", json!("10")),
        ("subagentMaxConcurrency", json!(true)),
    ] {
        let error = call("settings.set", json!({key:invalid, "theme":"dark"}))
            .await
            .unwrap_err();
        assert_eq!(error.data.unwrap()["errorCode"], "INVALID_PARAMS");
        assert_eq!(call("settings.get", json!({})).await.unwrap(), saved);
    }
    drop(state);
    let reopened = AppState::open(data.path()).unwrap();
    let persisted = reopened.db.get_setting("app").unwrap().unwrap();
    assert_eq!(persisted["subagentMaxDepth"], 0);
    assert_eq!(persisted["subagentMaxConcurrency"], 12);
    assert_eq!(persisted["theme"], "light");
}
