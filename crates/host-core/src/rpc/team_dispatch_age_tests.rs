use super::*;

#[tokio::test]
async fn busy_member_conflicting_task_dispatch_keeps_only_latest_before_forty_minute_boundary() {
    let data = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let mut app = AppState::open(data.path()).unwrap();
    app.handshook = true;
    let state = Arc::new(Mutex::new(app));
    let (tx, _rx) = mpsc::unbounded_channel();
    let call = |method: &'static str, args| handle_request(state.clone(), method, args, tx.clone());
    let provider = call("providers.create", json!({"name":"Dispatch fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture"}]})).await.unwrap();
    let lead = call("session.create", json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":workspace.path()})).await.unwrap()["session"]["id"].clone();
    let turn = call("session.beginTurn", json!({"sessionId":lead}))
        .await
        .unwrap()["turnId"]
        .clone();
    let review = call("team.declareStrategy", json!({"teamSessionId":lead,"callerSessionId":lead,"leadTurnId":turn,"strategy":"delegate","reason":"Replay a busy expert","members":[{"name":"builder"}]})).await.unwrap()["review"].clone();
    let member = call("team.confirmLaunchReview", json!({"teamSessionId":lead,"reviewId":review["reviewId"],"expectedRevision":review["revision"]})).await.unwrap()["decision"]["memberSessionIds"][0].clone();
    let task = call("team.createTask", json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Resolve conflicting instructions","ownerMemberName":"builder"})).await.unwrap()["task"].clone();
    let initial = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Long independent work","idempotencyKey":"initial"})).await.unwrap()["message"].clone();
    let member_turn = call(
        "session.beginTurn",
        json!({"sessionId":member,"sessionMessageId":initial["id"]}),
    )
    .await
    .unwrap()["turnId"]
        .clone();
    let dispatch = |content, key| json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":content,"idempotencyKey":key,"taskDispatch":{"taskId":task["taskId"],"expectedRevision":task["revision"]}});
    let old = call("team.sendMessage", dispatch("Use implementation A", "old"))
        .await
        .unwrap()["message"]
        .clone();
    {
        let st = state.lock().await;
        st.db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,input_hash,content,permission_mode,position,created_at,session_message_id) VALUES('old-queue',?1,'desktop','old','Use implementation A','ask',1,0,?2)",rusqlite::params![member.as_str().unwrap(),old["id"].as_str().unwrap()]).unwrap();
        st.db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,input_hash,content,permission_mode,position,created_at) VALUES('ordinary-user-queue',?1,'desktop','user','Unrelated user message','ask',2,0)",[member.as_str().unwrap()]).unwrap();
    }
    let latest = call(
        "team.sendMessage",
        dispatch("Use implementation B instead", "latest"),
    )
    .await
    .unwrap()["message"]
        .clone();
    {
        let st = state.lock().await;
        // Controlled persisted timestamps represent a 40-minute occupied turn;
        // no wall-clock sleep or real provider is involved.
        let old_queue: i64 = st
            .db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM turn_queue WHERE id='old-queue'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let user_queue: i64 = st
            .db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM turn_queue WHERE id='ordinary-user-queue'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_queue, 0);
        assert_eq!(user_queue, 1);
        let boundary = crate::db::now_ms();
        st.db
            .conn()
            .execute(
                "UPDATE turns SET started_at=?2 WHERE id=?1",
                rusqlite::params![member_turn.as_str().unwrap(), boundary - 40 * 60 * 1000],
            )
            .unwrap();
        st.db
            .conn()
            .execute(
                "UPDATE session_collaboration_messages SET created_at=?2 WHERE id=?1",
                rusqlite::params![old["id"].as_str().unwrap(), boundary - 39 * 60 * 1000],
            )
            .unwrap();
        st.db
            .conn()
            .execute(
                "UPDATE session_collaboration_messages SET created_at=?2 WHERE id=?1",
                rusqlite::params![latest["id"].as_str().unwrap(), boundary - 38 * 60 * 1000],
            )
            .unwrap();
    }
    let pending = call(
        "team.pendingMessages",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    let ids: Vec<_> = pending["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["id"] == old["id"] || m["id"] == latest["id"])
        .map(|m| m["id"].clone())
        .collect();
    assert_eq!(
        ids,
        vec![latest["id"].clone()],
        "stale task dispatch must not survive the occupied turn"
    );
    assert_eq!(old["targetBusyAtSend"], true);
    assert_eq!(latest["targetState"], "running");
    assert_eq!(latest["queuePosition"], 1);
    assert!(latest["sentAt"].is_string());
    let retired = call(
        "team.getMessage",
        json!({"teamSessionId":lead,"callerSessionId":lead,"messageId":old["id"]}),
    )
    .await
    .unwrap()["message"]
        .clone();
    assert_eq!(retired["status"], "cancelled");
    assert_eq!(retired["dispatchCancellation"], "superseded");
    assert_eq!(retired["content"], "Use implementation A");
    let replay = call("team.sendMessage", dispatch("Use implementation A", "old"))
        .await
        .unwrap()["message"]
        .clone();
    assert_eq!(replay["id"], old["id"]);
    assert_eq!(replay["status"], "cancelled");
    call(
        "session.endTurn",
        json!({"turnId":member_turn,"status":"completed"}),
    )
    .await
    .unwrap();
    assert!(call(
        "session.beginTurn",
        json!({"sessionId":member,"sessionMessageId":old["id"]})
    )
    .await
    .is_err());
    let next = call(
        "session.beginTurn",
        json!({"sessionId":member,"sessionMessageId":latest["id"]}),
    )
    .await
    .unwrap();
    assert!(next["turnId"].is_string());
    let active = call("team.updateTask", json!({"teamSessionId":lead,"callerSessionId":member,"taskId":task["taskId"],"expectedRevision":1,"status":"in_progress"})).await.unwrap()["task"].clone();
    let repeat = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Repeat B","taskDispatch":{"taskId":task["taskId"],"expectedRevision":active["revision"]}})).await.unwrap()["message"].clone();
    let ordinary = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":format!("Task {} is complete; this is ordinary mail",task["taskId"])})).await.unwrap()["message"].clone();
    let unowned = call(
        "team.createTask",
        json!({"teamSessionId":lead,"callerSessionId":lead,"subject":"Unowned task"}),
    )
    .await
    .unwrap()["task"]
        .clone();
    let wrong_owner = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Cannot claim unowned work","taskDispatch":{"taskId":unowned["taskId"],"expectedRevision":unowned["revision"]}})).await.unwrap_err();
    assert_eq!(wrong_owner.data.unwrap()["errorCode"], "TEAM_UNAUTHORIZED");
    let member_dispatch = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":member,"target":"Lead","content":"Report is not a dispatch","taskDispatch":{"taskId":task["taskId"],"expectedRevision":active["revision"]}})).await.unwrap_err();
    assert_eq!(
        member_dispatch.data.unwrap()["errorCode"],
        "TEAM_UNAUTHORIZED"
    );
    let report = call("team.sendMessage", json!({"teamSessionId":lead,"callerSessionId":member,"target":"Lead","content":"Full expert result"})).await.unwrap()["message"].clone();
    {
        let st = state.lock().await;
        st.db.conn().execute("INSERT INTO turn_queue(id,session_id,principal,input_hash,content,permission_mode,position,created_at,session_message_id) VALUES('repeat-queue',?1,'desktop','repeat','Repeat B','ask',3,0,?2)",rusqlite::params![member.as_str().unwrap(),repeat["id"].as_str().unwrap()]).unwrap();
    }
    let claim = call("team.updateTask", json!({"teamSessionId":lead,"callerSessionId":member,"taskId":task["taskId"],"expectedRevision":active["revision"],"status":"completed"})).await.unwrap()["task"].clone();
    assert_eq!(
        claim["status"], "in_progress",
        "completion remains provisional until the terminal CAS"
    );
    assert_eq!(
        call(
            "team.getMessage",
            json!({"teamSessionId":lead,"callerSessionId":lead,"messageId":repeat["id"]})
        )
        .await
        .unwrap()["message"]["status"],
        "queued"
    );
    call(
        "session.endTurn",
        json!({"turnId":next["turnId"],"status":"completed"}),
    )
    .await
    .unwrap();
    let cancelled = call(
        "team.getMessage",
        json!({"teamSessionId":lead,"callerSessionId":lead,"messageId":repeat["id"]}),
    )
    .await
    .unwrap()["message"]
        .clone();
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(cancelled["dispatchCancellation"], "task_completed");
    for mail in [&ordinary, &report] {
        assert_eq!(
            call(
                "team.getMessage",
                json!({"teamSessionId":lead,"callerSessionId":lead,"messageId":mail["id"]})
            )
            .await
            .unwrap()["message"]["status"],
            "queued"
        );
    }
    let running = call(
        "team.getMessage",
        json!({"teamSessionId":lead,"callerSessionId":lead,"messageId":latest["id"]}),
    )
    .await
    .unwrap()["message"]
        .clone();
    assert_eq!(running["turnId"], next["turnId"]);
    assert_ne!(running["status"], "cancelled");
    let mismatch = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Use implementation A","idempotencyKey":"old"})).await.unwrap_err();
    assert_eq!(mismatch.data.unwrap()["errorCode"], "IDEMPOTENCY_CONFLICT");
    let malformed = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Never enqueue","taskDispatch":{"taskId":task["taskId"]}})).await.unwrap_err();
    assert_eq!(malformed.data.unwrap()["errorCode"], "INVALID_PARAMS");
    let stale = call("team.sendMessage", dispatch("Stale revision", "stale"))
        .await
        .unwrap_err();
    assert_eq!(
        stale.data.unwrap()["errorCode"],
        "TEAM_TASK_REVISION_CONFLICT"
    );
    let board = call(
        "team.getBoard",
        json!({"teamSessionId":lead,"callerSessionId":lead}),
    )
    .await
    .unwrap();
    let complete = board["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["taskId"] == task["taskId"])
        .unwrap();
    assert_eq!(complete["status"], "completed");
    let completed_dispatch = call("team.sendMessage",json!({"teamSessionId":lead,"callerSessionId":lead,"target":"builder","content":"Cannot redispatch completed task","taskDispatch":{"taskId":task["taskId"],"expectedRevision":complete["revision"]}})).await.unwrap_err();
    assert_eq!(
        completed_dispatch.data.unwrap()["errorCode"],
        "TEAM_UNAUTHORIZED"
    );
    let st = state.lock().await;
    assert_eq!(
        st.db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM turn_queue WHERE id='repeat-queue'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        st.db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM turn_queue WHERE id='ordinary-user-queue'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    assert!(st
        .db
        .kv_get(
            "team-message-source-turn-v1",
            report["id"].as_str().unwrap()
        )
        .unwrap()
        .is_some());
    let ledger = serde_json::to_value(
        crate::session_collaboration::get(&st.db, latest["id"].as_str().unwrap())
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(ledger["targetBusyAtSend"], true);
    assert_eq!(ledger["taskDispatch"]["taskId"], task["taskId"]);
    assert!(ledger["sentAt"].is_string());
}
