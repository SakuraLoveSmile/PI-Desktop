use super::*;

#[test]
fn schedule_approval_does_not_queue_execution_before_due_time() {
    let (dir, db) = test_db();
    let root = dir.path().join("workspace");
    fs::create_dir_all(&root).unwrap();
    let manager = PlanManager;
    let proposal = submit(&manager, &db, &root, "schedule-call");
    let future = ms_to_ts(now_ms() + 3_600_000);
    let result = manager
        .resolve_with_options(
            &db,
            PlanResolveParams {
                workspace_root: Some(&root),
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "schedule",
                target_permission_mode: Some("ask"),
            },
            PlanResolveOptions {
                execution_provider_id: Some("provider-one"),
                execution_model_id: Some("model-one"),
                scheduled_for: Some(&future),
                schedule_timezone: Some("Asia/Taipei"),
                revision_intent: None,
            },
        )
        .unwrap();
    assert_eq!(result.status, STATUS_APPROVED);
    assert!(result.execution.is_none());
    assert_eq!(result.proposal.schedule_state.as_deref(), Some("scheduled"));
    assert_eq!(
        result.proposal.execution_provider_id.as_deref(),
        Some("provider-one")
    );
    assert_eq!(
        result.proposal.execution_model_id.as_deref(),
        Some("model-one")
    );
    assert!(manager
        .queued_executions(&db, Some(&proposal.session_id))
        .unwrap()
        .is_empty());
    assert_eq!(
        sessions::session_mode(&db, &proposal.session_id)
            .unwrap()
            .as_deref(),
        Some("agent")
    );
}

#[test]
fn pending_review_allows_next_planning_model_but_blocks_mode_change() {
    let (dir, db) = test_db();
    let root = dir.path().join("workspace");
    fs::create_dir_all(&root).unwrap();
    let proposal = submit(&PlanManager, &db, &root, "pending-model-call");
    sessions::end_turn(&db, &proposal.turn_id, "completed", None, None, false).unwrap();
    gate_session_configure(
        &db,
        &proposal.session_id,
        "plan",
        Some("next-provider"),
        Some("next-model"),
        None,
        None,
    )
    .unwrap();
    let error = gate_session_configure(&db, &proposal.session_id, "goal", None, None, None, None)
        .unwrap_err();
    assert_eq!(error.to_string(), "PLAN_CONFIGURATION_BLOCKED");
}

#[test]
fn revision_intent_is_durable_and_claims_one_new_turn() {
    let (dir, db) = test_db();
    let root = dir.path().join("workspace");
    fs::create_dir_all(&root).unwrap();
    let manager = PlanManager;
    let proposal = submit(&manager, &db, &root, "old-call");
    sessions::end_turn(&db, &proposal.turn_id, "completed", None, None, false).unwrap();
    let intent = json!({
        "content": "Please add tests to the plan",
        "providerId": "provider-two",
        "modelId": "model-two",
        "thinkingLevel": "low",
        "targetKind": "plan"
    });
    let resolved = manager
        .resolve_with_options(
            &db,
            PlanResolveParams {
                workspace_root: None,
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "request_changes",
                target_permission_mode: None,
            },
            PlanResolveOptions {
                revision_intent: Some(&intent),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        resolved.proposal.revision_intent.as_ref().unwrap().state,
        "ready"
    );
    assert_eq!(
        resolved
            .proposal
            .revision_intent
            .as_ref()
            .unwrap()
            .input
            .content,
        "Please add tests to the plan"
    );
    let (turn_id, existing) = manager
        .begin_revision_turn(
            &db,
            &proposal.id,
            &proposal.session_id,
            "Please add tests to the plan",
            "provider-two",
            "model-two",
        )
        .unwrap();
    assert!(!existing);
    let (same_turn, existing) = manager
        .begin_revision_turn(
            &db,
            &proposal.id,
            &proposal.session_id,
            "Please add tests to the plan",
            "provider-two",
            "model-two",
        )
        .unwrap();
    assert!(existing);
    assert_eq!(same_turn, turn_id);
    assert!(!manager
        .mark_revision_failed(&db, &proposal.id, &proposal.session_id, "RETRY")
        .unwrap());
    let replacement = manager
        .submit(
            &db,
            PlanSubmitParams {
                workspace_root: &root,
                session_id: &proposal.session_id,
                turn_id: &turn_id,
                tool_call_id: "new-call",
                kind: KIND_PLAN,
                title: "Revised plan",
                markdown: "# Revised plan\n\n- add tests",
                question: "Proceed?",
                artifact_workspace_kind: WORKSPACE_KIND_PROJECT,
            },
        )
        .unwrap();
    assert_eq!(replacement.status, STATUS_PENDING);
    assert_eq!(
        manager
            .history_for_session(&db, &proposal.session_id)
            .unwrap()
            .len(),
        2
    );
    let old = get_proposal(&db, &proposal.id).unwrap().unwrap();
    assert_eq!(old.revision_intent.unwrap().state, "submitted");
}

#[test]
fn revision_draft_references_round_trip_and_reject_unbounded_input() {
    let (dir, db) = test_db();
    let root = dir.path().join("workspace");
    fs::create_dir_all(&root).unwrap();
    let manager = PlanManager;
    let proposal = submit(&manager, &db, &root, "draft-call");
    sessions::end_turn(&db, &proposal.turn_id, "completed", None, None, false).unwrap();
    let intent = json!({
        "content": "Use the attached screenshot in the revised plan",
        "providerId": "provider-two",
        "modelId": "model-two",
        "thinkingLevel": "low",
        "targetKind": "plan",
        "draft": {
            "text": "The screenshot shows the desired state.",
            "fileReferences": [{
                "path": "attachments/ui.png",
                "name": "ui.png",
                "kind": "image",
                "mimeType": "image/png",
                "token": "file-token-1"
            }]
        }
    });
    let invalid = json!({
        "content": "Try again",
        "providerId": "provider-two",
        "modelId": "model-two",
        "thinkingLevel": "low",
        "targetKind": "plan",
        "draft": {
            "text": "",
            "fileReferences": [{
                "path": "",
                "name": "missing-path"
            }]
        }
    });
    let error = manager
        .resolve_with_options(
            &db,
            PlanResolveParams {
                workspace_root: None,
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "request_changes",
                target_permission_mode: None,
            },
            PlanResolveOptions {
                revision_intent: Some(&invalid),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(error.to_string(), "PLAN_REVISION_INVALID");

    let resolved = manager
        .resolve_with_options(
            &db,
            PlanResolveParams {
                workspace_root: None,
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "request_changes",
                target_permission_mode: None,
            },
            PlanResolveOptions {
                revision_intent: Some(&intent),
                ..Default::default()
            },
        )
        .unwrap();
    let stored = resolved.proposal.revision_intent.unwrap();
    let draft = stored.input.draft.unwrap();
    assert_eq!(draft.text, "The screenshot shows the desired state.");
    assert_eq!(draft.file_references[0].path, "attachments/ui.png");
    assert_eq!(draft.file_references[0].kind.as_deref(), Some("image"));

    drop(db);
    let reopened = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let recovered = PlanManager
        .history_for_session(&reopened, &proposal.session_id)
        .unwrap();
    let recovered_ref = recovered[0]
        .revision_intent
        .as_ref()
        .unwrap()
        .input
        .draft
        .as_ref()
        .unwrap()
        .file_references[0]
        .clone();
    assert_eq!(recovered_ref.name, "ui.png");
    assert_eq!(recovered_ref.token.as_deref(), Some("file-token-1"));
}

#[test]
fn interrupted_revision_recovers_as_retryable_without_model_replay() {
    let (dir, db) = test_db();
    let root = dir.path().join("workspace");
    fs::create_dir_all(&root).unwrap();
    let proposal = submit(&PlanManager, &db, &root, "recovery-old-call");
    sessions::end_turn(&db, &proposal.turn_id, "completed", None, None, false).unwrap();
    let intent = json!({
        "content": "Improve the acceptance criteria",
        "providerId": "provider-two",
        "modelId": "model-two",
        "thinkingLevel": "low",
        "targetKind": "plan"
    });
    PlanManager
        .resolve_with_options(
            &db,
            PlanResolveParams {
                workspace_root: None,
                proposal_id: &proposal.id,
                session_id: &proposal.session_id,
                turn_id: &proposal.turn_id,
                tool_call_id: &proposal.tool_call_id,
                version: Some(proposal.version),
                action: "request_changes",
                target_permission_mode: None,
            },
            PlanResolveOptions {
                revision_intent: Some(&intent),
                ..Default::default()
            },
        )
        .unwrap();
    PlanManager
        .begin_revision_turn(
            &db,
            &proposal.id,
            &proposal.session_id,
            "Improve the acceptance criteria",
            "provider-two",
            "model-two",
        )
        .unwrap();
    drop(db);

    let reopened = Database::open(&dir.path().join("pi.sqlite")).unwrap();
    let recovered = PlanManager
        .history_for_session(&reopened, &proposal.session_id)
        .unwrap();
    assert_eq!(recovered.len(), 1);
    let intent = recovered[0].revision_intent.as_ref().unwrap();
    assert_eq!(intent.state, "failed");
    assert_eq!(intent.input.content, "Improve the acceptance criteria");
    assert!(PlanManager
        .pending_for_session(&reopened, Some(&proposal.session_id))
        .unwrap()
        .is_empty());
}
