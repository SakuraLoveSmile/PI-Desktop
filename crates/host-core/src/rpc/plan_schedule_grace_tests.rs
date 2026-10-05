use super::*;

async fn schedule(
    state: &Arc<Mutex<AppState>>,
    workspace: &std::path::Path,
    at: i64,
) -> plans::PlanProposal {
    std::fs::create_dir(workspace).unwrap();
    let st = state.lock().await;
    let session = sessions::create_session(
        &st.db,
        None,
        Some("plan".into()),
        None,
        None,
        Some(workspace.to_string_lossy().into_owned()),
    )
    .unwrap();
    let turn = sessions::begin_turn(&st.db, &session.id, None, None).unwrap();
    let proposal = st
        .plans
        .submit(
            &st.db,
            plans::PlanSubmitParams {
                workspace_root: workspace,
                session_id: &session.id,
                turn_id: &turn,
                tool_call_id: "schedule-grace-test",
                kind: "plan",
                title: "Scheduled plan",
                markdown: "# Scheduled plan\n- run once",
                question: "Proceed?",
                artifact_workspace_kind: "project",
            },
        )
        .unwrap();
    sessions::end_turn(&st.db, &turn, "completed", None, None, false).unwrap();
    st.plans
        .resolve_with_options(
            &st.db,
            plans::PlanResolveParams {
                workspace_root: Some(workspace),
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "schedule",
                target_permission_mode: Some("ask"),
            },
            plans::PlanResolveOptions {
                scheduled_for: Some(&crate::db::ms_to_ts(at)),
                schedule_timezone: Some("UTC"),
                execution_provider_id: Some("fixture-provider"),
                execution_model_id: Some("fixture-model"),
                ..Default::default()
            },
        )
        .unwrap()
        .proposal
}

fn notification(rx: &mut mpsc::UnboundedReceiver<String>) -> Value {
    serde_json::from_str(&rx.try_recv().unwrap()).unwrap()
}

#[tokio::test]
async fn scheduled_plan_resume_lifecycle_preserves_snapshot_and_notifies_missed_once() {
    for delay in [0, 119_999, 120_000, 120_001] {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
        let at = crate::db::now_ms() + 3_600_000;
        let proposal = schedule(&state, &dir.path().join("workspace"), at).await;
        let (tx, mut rx) = mpsc::unbounded_channel();
        let before = handle(
            state.clone(),
            "plans.dueSchedules",
            json!({ "nowMs": at - 1 }),
            tx.clone(),
        )
        .await
        .unwrap();
        assert_eq!(before, json!({ "schedules": [], "nextDueAt": at }));
        assert!(rx.try_recv().is_err());

        let due = handle(
            state.clone(),
            "plans.dueSchedules",
            json!({ "nowMs": at + delay }),
            tx.clone(),
        )
        .await
        .unwrap();
        if delay <= 120_000 {
            assert_eq!(
                due["schedules"],
                json!([{ "proposalId": proposal.id, "sessionId": proposal.session_id }])
            );
            assert!(rx.try_recv().is_err());
            let claimed = handle(
                state.clone(), "plans.claimSchedule",
                json!({ "proposalId": proposal.id, "sessionId": proposal.session_id, "nowMs": at + delay }), tx.clone(),
            ).await.unwrap();
            assert_eq!(claimed["execution"]["state"], "queued");
            assert_eq!(
                claimed["execution"]["executionProviderId"],
                "fixture-provider"
            );
            assert_eq!(claimed["execution"]["executionModelId"], "fixture-model");
            assert_eq!(claimed["execution"]["targetPermissionMode"], "ask");
            assert_eq!(
                notification(&mut rx)["params"]["execution"],
                claimed["execution"]
            );
        } else {
            assert_eq!(due, json!({ "schedules": [], "nextDueAt": null }));
            let note = notification(&mut rx);
            assert_eq!(note["method"], "plans.changed");
            assert_eq!(note["params"]["proposal"]["scheduleState"], "missed");
            assert!(note["params"]["proposal"]["executionId"].is_null());
            handle(
                state.clone(),
                "plans.dueSchedules",
                json!({ "nowMs": at + delay }),
                tx.clone(),
            )
            .await
            .unwrap();
            assert!(rx.try_recv().is_err());
            let st = state.lock().await;
            let audit_count: i64 = st
                .db
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM audit_log WHERE kind = 'plan_execution_schedule_missed'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(audit_count, 1);
            assert!(st.plans.queued_executions(&st.db, None).unwrap().is_empty());
            drop(st);
            let manual = handle(
                state.clone(), "plans.claimSchedule",
                json!({ "proposalId": proposal.id, "sessionId": proposal.session_id, "nowMs": at + delay, "allowMissed": true }), tx.clone(),
            ).await.unwrap();
            assert_eq!(manual["execution"]["state"], "queued");
            assert_eq!(manual["execution"]["plan"], proposal.plan);
            assert_eq!(
                notification(&mut rx)["params"]["execution"],
                manual["execution"]
            );
        }
        let st = state.lock().await;
        assert_eq!(st.plans.queued_executions(&st.db, None).unwrap().len(), 1);
    }
}

#[tokio::test]
async fn claim_crossing_grace_deadline_notifies_missed_before_returning_error() {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
    let at = crate::db::now_ms() + 3_600_000;
    let proposal = schedule(&state, &dir.path().join("workspace"), at).await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let due = handle(
        state.clone(),
        "plans.dueSchedules",
        json!({ "nowMs": at + 120_000 }),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(due["schedules"].as_array().unwrap().len(), 1);
    for _ in 0..2 {
        let error = handle(
            state.clone(), "plans.claimSchedule",
            json!({ "proposalId": proposal.id, "sessionId": proposal.session_id, "nowMs": at + 120_001 }), tx.clone(),
        ).await.unwrap_err();
        assert_eq!(
            error.data.as_ref().unwrap()["errorCode"],
            "PLAN_SCHEDULE_MISSED"
        );
    }
    assert_eq!(
        notification(&mut rx)["params"]["proposal"]["scheduleState"],
        "missed"
    );
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn restart_marks_even_recent_due_schedules_missed_without_grace() {
    let dir = tempfile::tempdir().unwrap();
    let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
    let at = crate::db::now_ms() + 3_600_000;
    let proposal = schedule(&state, &dir.path().join("workspace"), at).await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    let result = handle(
        state.clone(),
        "plans.markMissedSchedules",
        json!({ "nowMs": at }),
        tx.clone(),
    )
    .await
    .unwrap();
    assert_eq!(result["proposalIds"], json!([proposal.id]));
    assert_eq!(
        notification(&mut rx)["params"]["proposal"]["scheduleState"],
        "missed"
    );
    assert_eq!(
        handle(state, "plans.dueSchedules", json!({ "nowMs": at + 1 }), tx)
            .await
            .unwrap(),
        json!({ "schedules": [], "nextDueAt": null })
    );
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn default_clock_is_read_after_lock_wait_crossing_grace_deadline() {
    use std::sync::atomic::{AtomicI64, Ordering};
    for method in ["plans.dueSchedules", "plans.claimSchedule"] {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(AppState::open(dir.path()).unwrap()));
        let at = crate::db::now_ms() + 3_600_000;
        let proposal = schedule(&state, &dir.path().join("workspace"), at).await;
        let (tx, mut rx) = mpsc::unbounded_channel();
        let clock = AtomicI64::new(at + 120_000);
        let locked = state.lock().await;
        let mut request = Box::pin(handle_with_clock(
            state.clone(),
            method,
            json!({"proposalId": proposal.id, "sessionId": proposal.session_id}),
            tx,
            || clock.load(Ordering::SeqCst),
        ));
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(request.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        clock.store(at + 120_001, Ordering::SeqCst);
        drop(locked);
        let result = request.await;
        if method == "plans.dueSchedules" {
            assert_eq!(result.unwrap(), json!({"schedules": [], "nextDueAt": null}));
        } else {
            assert_eq!(
                result.unwrap_err().data.unwrap()["errorCode"],
                "PLAN_SCHEDULE_MISSED"
            );
        }
        assert_eq!(
            notification(&mut rx)["params"]["proposal"]["scheduleState"],
            "missed"
        );
        assert!(rx.try_recv().is_err());
        let st = state.lock().await;
        assert!(st.plans.queued_executions(&st.db, None).unwrap().is_empty());
    }
}
