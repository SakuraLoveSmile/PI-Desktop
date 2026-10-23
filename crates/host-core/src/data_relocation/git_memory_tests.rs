use super::*;
use crate::project_memory_owner::tests::git;
use crate::{db::Database, project_memory_owner, sessions};
use serde_json::json;

fn copy_directory(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn init_repository(path: &Path) {
    fs::create_dir_all(path).unwrap();
    git(path, &["init", "-q"]);
    git(
        path,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "fixture",
        ],
    );
}

#[tokio::test]
async fn verified_profile_copy_preserves_git_memory_context_and_session_history() {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let source = base.join("source-profile");
    let destination = base.join("copied-profile");
    let repository = source.join("project");
    init_repository(&repository);
    let path = repository.to_str().unwrap();
    let db = Database::open_in_dir(&source).unwrap();
    db.set_project_memory(path, "Legacy project convention")
        .unwrap();
    let session = sessions::create_session(
        &db,
        Some("Relocation history".into()),
        Some("agent".into()),
        None,
        None,
        Some(path.into()),
    )
    .unwrap();
    let message = serde_json::from_value(json!({"id":"relocation-evidence", "role":"user", "content":"Verified relocation-history finding", "createdAt":"2026-10-23T00:00:00Z"})).unwrap();
    sessions::append_message(&db, &session.id, &message, None).unwrap();
    let original = project_memory_owner::prepare(path).await.unwrap();
    let space = db.ensure_project_memory_space(&original).unwrap();
    db.set_memory_space_content(&space.id, &json!([{"id":"shared", "title":"Verified", "content":"Shared finding saved after legacy import"}])).unwrap();
    db.set_auto_memory_enabled(path, true).unwrap();
    let before = db.get_project_memory_editor(path).unwrap();
    drop(db);
    copy_directory(&source, &destination);
    let source_before = fs::read(source.join("pi.sqlite")).unwrap();
    relocate(&source, &destination).unwrap();
    let moved_repository = destination.join("project");
    let moved_path = moved_repository.to_str().unwrap();
    let prepared = project_memory_owner::prepare(moved_path).await.unwrap();
    assert_ne!(
        prepared.repository_identity, original.repository_identity,
        "a real copy has new filesystem evidence"
    );
    let db = Database::open_in_dir(&destination).unwrap();
    let moved_space = db.ensure_project_memory_space(&prepared).unwrap();
    assert_eq!(
        moved_space.id, space.id,
        "verified copy must retain the stable UUID"
    );
    let editor = db.get_project_memory_editor(moved_path).unwrap();
    assert_eq!(editor.owner, before.owner);
    assert_eq!(
        serde_json::to_value(&editor.memory).unwrap(),
        serde_json::to_value(&before.memory).unwrap()
    );
    assert!(editor.auto_record_enabled);
    db.bind_project_memory_space_session(&session.id, &moved_space.id)
        .unwrap();
    let roots = vec![moved_path.to_owned()];
    let hits = crate::session_search::search_with_memory_scope(
        &db,
        "relocation-history",
        0,
        Some(&roots),
        Some(&space.id),
    )
    .unwrap();
    assert_eq!(hits.hits.len(), 1);
    assert_eq!(hits.hits[0].session.id, session.id);
    let history = crate::session_search::context(
        &db,
        &session.id,
        "relocation-evidence",
        "around",
        "relocation-history",
    )
    .unwrap()
    .unwrap();
    assert!(serde_json::to_string(&history)
        .unwrap()
        .contains("Verified relocation-history finding"));
    // The retained backup is now a separate physical repository. Its former
    // index must not make it another live checkout of the relocated space.
    let backup = db.ensure_project_memory_space(&original).unwrap();
    assert_ne!(backup.id, space.id);
    assert!(db
        .get_memory_space_content(&backup.id)
        .unwrap()
        .content
        .is_empty());
    let clone = base.join("independent-clone");
    git(&base, &["clone", "-q", path, clone.to_str().unwrap()]);
    let clone_prepared = project_memory_owner::prepare(clone.to_str().unwrap())
        .await
        .unwrap();
    let clone_space = db.ensure_project_memory_space(&clone_prepared).unwrap();
    assert_ne!(clone_space.id, space.id);
    assert!(db
        .get_memory_space_content(&clone_space.id)
        .unwrap()
        .content
        .is_empty());
    assert_eq!(
        db.project_memory_space_session(&session.id).unwrap(),
        Some(space.id.clone())
    );
    drop(db);
    let db = Database::open_in_dir(&destination).unwrap();
    assert_eq!(
        db.ensure_project_memory_space(&prepared).unwrap().id,
        space.id
    );
    assert_eq!(
        db.get_project_memory_editor(moved_path).unwrap().owner,
        before.owner
    );
    assert_eq!(fs::read(source.join("pi.sqlite")).unwrap(), source_before);
}

#[tokio::test]
async fn profile_copy_does_not_rebind_a_replaced_source_git_directory() {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let source = base.join("source-profile");
    let destination = base.join("copied-profile");
    let repository = source.join("project");
    init_repository(&repository);
    let db = Database::open_in_dir(&source).unwrap();
    let original = project_memory_owner::prepare(repository.to_str().unwrap())
        .await
        .unwrap();
    let original_space = db.ensure_project_memory_space(&original).unwrap();
    db.set_memory_space_content(
        &original_space.id,
        &json!([{"id":"private", "title":"Original", "content":"Previous repository finding"}]),
    )
    .unwrap();
    drop(db);
    fs::remove_dir_all(repository.join(".git")).unwrap();
    init_repository(&repository);
    let replacement = project_memory_owner::prepare(repository.to_str().unwrap())
        .await
        .unwrap();
    assert_ne!(
        original.repository_identity,
        replacement.repository_identity
    );
    copy_directory(&source, &destination);
    relocate(&source, &destination).unwrap();
    let moved = project_memory_owner::prepare(destination.join("project").to_str().unwrap())
        .await
        .unwrap();
    let db = Database::open_in_dir(&destination).unwrap();
    let replacement_space = db.ensure_project_memory_space(&moved).unwrap();
    assert_ne!(
        replacement_space.id, original_space.id,
        "a copied replacement is not evidence for the stored repository"
    );
    assert!(db
        .get_memory_space_content(&replacement_space.id)
        .unwrap()
        .content
        .is_empty());
    assert!(db
        .get_memory_space_content(&original_space.id)
        .unwrap()
        .content
        .contains("Previous repository finding"));
}

#[tokio::test]
async fn profile_copy_rejects_git_worktree_pointer_relocation_without_touching_source() {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let source = base.join("source-profile");
    let destination = base.join("copied-profile");
    let repository = source.join("project");
    let linked = source.join("linked-checkout");
    init_repository(&repository);
    git(
        &repository,
        &[
            "worktree",
            "add",
            "--detach",
            "-q",
            linked.to_str().unwrap(),
        ],
    );
    let db = Database::open_in_dir(&source).unwrap();
    let original = project_memory_owner::prepare(repository.to_str().unwrap())
        .await
        .unwrap();
    db.ensure_project_memory_space(&original).unwrap();
    drop(db);
    let pointer = fs::read(linked.join(".git")).unwrap();
    copy_directory(&source, &destination);
    let before = fs::read(destination.join("pi.sqlite")).unwrap();
    let error = relocate(&source, &destination).unwrap_err();
    assert!(error.to_string().contains("linked Git worktrees"));
    assert_eq!(fs::read(linked.join(".git")).unwrap(), pointer);
    assert_eq!(fs::read(destination.join("pi.sqlite")).unwrap(), before);
    assert!(project_memory_owner::prepare(linked.to_str().unwrap())
        .await
        .is_some());
}

#[tokio::test]
async fn profile_copy_replaces_explicit_group_physical_evidence_for_each_copied_root() {
    let temporary = tempfile::tempdir().unwrap();
    let base = temporary.path().canonicalize().unwrap();
    let source = base.join("source-profile");
    let destination = base.join("copied-profile");
    let roots = [source.join("first"), source.join("second")];
    for root in &roots {
        init_repository(root);
    }
    let paths: Vec<_> = roots
        .iter()
        .map(|root| root.to_str().unwrap().to_owned())
        .collect();
    let db = Database::open_in_dir(&source).unwrap();
    let group = db.create_project_group("Explicit", &paths).unwrap();
    let mut old_identities = Vec::new();
    let mut space_id = String::new();
    for path in &paths {
        let prepared = project_memory_owner::prepare(path).await.unwrap();
        old_identities.push(prepared.repository_identity.clone());
        space_id = db.ensure_project_memory_space(&prepared).unwrap().id;
    }
    // A group has one gitCommonDir projection but may hold evidence for several
    // physical repositories. Relocation must update each listed root.
    db.ensure_explicit_group_memory_space(&paths[0]).unwrap();
    drop(db);
    copy_directory(&source, &destination);
    relocate(&source, &destination).unwrap();
    let db = Database::open_in_dir(&destination).unwrap();
    let stored = db
        .kv_get("projectMemorySpaces/v1", &space_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        stored["repositoryIdentity"],
        format!("explicit-group:{}", group.id)
    );
    let evidence = stored["verifiedRepositoryIdentities"].as_array().unwrap();
    for (position, name) in ["first", "second"].into_iter().enumerate() {
        let prepared = project_memory_owner::prepare(destination.join(name).to_str().unwrap())
            .await
            .unwrap();
        assert!(evidence.contains(&json!(prepared.repository_identity)));
        assert!(!evidence.contains(&json!(old_identities[position])));
        assert_eq!(
            db.ensure_project_memory_space(&prepared).unwrap().id,
            space_id
        );
    }
    assert_eq!(evidence.len(), 2);
}
