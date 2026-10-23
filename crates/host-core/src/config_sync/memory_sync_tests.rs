use super::*;
use std::process::Command;

fn git(path: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn shared_project() -> (tempfile::TempDir, AppState, String, String, String) {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("Music");
    let checkout = temporary.path().join("slot-3");
    fs::create_dir(&main).unwrap();
    git(&main, &["init", "-b", "main"]);
    git(
        &main,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Fixture",
        ],
    );
    git(
        &main,
        &["worktree", "add", "--detach", checkout.to_str().unwrap()],
    );
    let main = fs::canonicalize(main)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let checkout = fs::canonicalize(checkout)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let state = AppState::open(&temporary.path().join("profile")).unwrap();
    let group = state
        .db
        .create_project_group("Music", std::slice::from_ref(&main))
        .unwrap();
    state
        .db
        .create_project_group("slot-3", std::slice::from_ref(&checkout))
        .unwrap();
    state
        .db
        .set_project_group_memory(
            &group.id,
            &json!([
                { "id": "original", "title": "Original", "content": "Preserved legacy source" }
            ]),
        )
        .unwrap();
    let prepared = crate::project_memory_owner::prepare(&checkout)
        .await
        .unwrap();
    let project = state.db.ensure_project_memory_space(&prepared).unwrap();
    (temporary, state, main, checkout, project.id)
}

#[tokio::test]
async fn config_sync_captures_worktree_memory_once_after_agent_edits() {
    let (_temporary, mut state, main, checkout, id) = shared_project().await;
    state.db.set_auto_memory_enabled(&checkout, true).unwrap();
    state
        .db
        .agent_upsert_project_memory(
            &checkout,
            None,
            "Review",
            "Verified shared convention",
            None,
            None,
        )
        .unwrap();
    state.db.set_auto_memory_enabled(&main, false).unwrap();
    let legacy = state.db.get_project_memory_readonly(&main).unwrap();

    let entities =
        domains::capture_memory(&mut state, &domains::ProjectIdentityOverrides::default()).unwrap();
    assert_eq!(
        entities.len(),
        1,
        "one portable entity for one shared memory collection"
    );
    let payload = &entities[0].payload;
    let entries = payload["memory"]["entries"].as_array().unwrap();
    assert!(entries
        .iter()
        .any(|entry| entry["content"] == "Verified shared convention"));
    assert!(payload["projectGroupLogicalId"].is_string());
    assert!(payload.get("projectRootPosition").is_none());
    assert_eq!(
        payload["memory"],
        serde_json::to_value(state.db.get_memory_space_content(&id).unwrap()).unwrap()
    );
    assert_eq!(
        serde_json::to_value(state.db.get_project_memory_readonly(&main).unwrap()).unwrap(),
        serde_json::to_value(legacy).unwrap()
    );
    for local_field in [
        "id",
        "memoryProjectId",
        "repositoryIdentity",
        "gitCommonDir",
        "paths",
        "autoRecordEnabled",
    ] {
        assert!(payload.get(local_field).is_none());
        assert!(payload["memory"].get(local_field).is_none());
    }
    assert!(!serde_json::to_string(payload).unwrap().contains(&id));

    // A receiving device keeps the existing portable scope after mapping that
    // logical project to a different checkout, without exporting its space UUID.
    let mut overrides = domains::ProjectIdentityOverrides::default();
    overrides
        .group_ids
        .insert(checkout.clone(), "project-group:received".into());
    let mapped = domains::capture_memory(&mut state, &overrides).unwrap();
    assert_eq!(mapped.len(), 1);
    assert_eq!(mapped[0].entity_id, "memory:project-group:received");
    overrides.group_ids.clear();
    overrides
        .project_ids
        .insert(checkout.clone(), "project:received".into());
    let standalone = domains::capture_memory(&mut state, &overrides).unwrap();
    assert_eq!(standalone.len(), 1);
    assert_eq!(standalone[0].entity_id, "memory:project:received");
    assert_eq!(
        standalone[0].payload["projectLogicalId"],
        "project:received"
    );
    assert!(standalone[0].payload.get("projectGroupLogicalId").is_none());
    state.db.clear_project_memory_space_path(&checkout).unwrap();
    let revoked = domains::capture_memory(&mut state, &overrides).unwrap();
    assert!(revoked
        .iter()
        .all(|entity| entity.entity_id != "memory:project:received"));
}

#[tokio::test]
async fn config_sync_applies_mapped_memory_to_all_worktrees_and_clears_it() {
    let (_temporary, mut state, main, checkout, id) = shared_project().await;
    state.db.set_auto_memory_enabled(&main, true).unwrap();
    let legacy =
        serde_json::to_value(state.db.get_project_memory_readonly(&main).unwrap()).unwrap();
    let (header, _) = create_vault("fixture-password", "fixture-vault").unwrap();
    let mut config = config_from_input(
        None,
        &json!({
            "endpoint": "https://example.invalid", "deviceLabel": "Fixture", "includeMemory": true
        }),
        header,
    )
    .unwrap();
    config
        .project_group_mappings
        .insert("remote-group".into(), vec![checkout.clone()]);
    let mut entity = PortableEntity {
        domain: domains::DOMAIN_MEMORY.into(),
        entity_id: "memory:remote-group".into(),
        label: "Music".into(),
        deleted: false,
        requires_approval: false,
        secret_bearing: true,
        mapping_required: true,
        digest: "fixture".into(),
        resource_ids: Vec::new(),
        payload: json!({"projectGroupLogicalId":"remote-group", "memory":{
            "entries":[{"id":"remote-note","title":"Review","content":"Imported shared convention"}]
        }}),
    };
    let bundle = PendingBundle {
        manifest: RevisionManifest {
            format: REVISION_FORMAT.into(),
            version: 1,
            revision_id: "fixture-revision".into(),
            parents: Vec::new(),
            created_at: String::new(),
            entities: vec![entity.clone()],
            resource_ids: Vec::new(),
        },
        local_before: None,
        resources: BTreeMap::new(),
        approvals: Vec::new(),
        conflicts: Vec::new(),
        journal_state: "applying".into(),
        remote_revision_id: "fixture-revision".into(),
    };
    for root_memory in [false, true] {
        if root_memory {
            entity.payload["projectRootPosition"] = json!(0);
        }
        apply_entity(&mut state, &mut config, &bundle, &entity).unwrap();
        for path in [&main, &checkout] {
            let editor = state.db.get_project_memory_editor(path).unwrap();
            assert_eq!(editor.owner, format!("memory:{id}"));
            assert_eq!(
                editor.memory.entries.unwrap()[0].content,
                "Imported shared convention"
            );
            assert!(
                editor.auto_record_enabled,
                "sync must preserve the device opt-in"
            );
        }
        entity.deleted = true;
        apply_entity(&mut state, &mut config, &bundle, &entity).unwrap();
        assert!(state
            .db
            .get_project_memory_editor(&main)
            .unwrap()
            .memory
            .content
            .is_empty());
        assert!(state
            .db
            .get_project_memory_editor(&checkout)
            .unwrap()
            .memory
            .content
            .is_empty());
        entity.deleted = false;
    }
    // Older content-only memory payloads remain lossless in the shared owner.
    entity.payload["memory"] = json!({"content":"  legacy imported text\n"});
    apply_entity(&mut state, &mut config, &bundle, &entity).unwrap();
    assert_eq!(
        state
            .db
            .get_project_memory_editor(&main)
            .unwrap()
            .memory
            .content,
        "  legacy imported text\n"
    );
    assert_eq!(
        serde_json::to_value(state.db.get_project_memory_readonly(&main).unwrap()).unwrap(),
        legacy
    );
}
