use super::*;
use serde_json::json;

fn fixture(root: &Path, rows: &[(&str, String, Value)]) {
    fs::create_dir_all(root).unwrap();
    let database = Connection::open(root.join("pi.sqlite")).unwrap();
    database.execute_batch("CREATE TABLE kv(ns TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(ns,key));").unwrap();
    for (namespace, key, value) in rows {
        database
            .execute(
                "INSERT INTO kv VALUES (?1,?2,?3,42)",
                params![namespace, key, value.to_string()],
            )
            .unwrap();
    }
}

fn snapshot(root: &Path) -> Vec<(String, String, String, i64)> {
    let database = Connection::open(root.join("pi.sqlite")).unwrap();
    let mut statement = database
        .prepare("SELECT ns,key,value_json,updated_at FROM kv ORDER BY ns,key")
        .unwrap();
    let rows = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    rows
}

#[test]
fn memory_space_metadata_follows_profile_without_rewriting_identity_or_history() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("old");
    let destination = temporary.path().join("new");
    let checkout = source.join("project").to_string_lossy().into_owned();
    let removed = source.join("removed").to_string_lossy().into_owned();
    let external = temporary
        .path()
        .join("external")
        .to_string_lossy()
        .into_owned();
    let space_id = "7490f697-26f2-4d61-b547-576e82c46f90";
    let repository_identity = "git-dir:device-1:inode-2:created-3";
    let content = json!({"content": checkout, "entries": [{"id": "imported:source-hash:original", "title": format!("Evidence [{checkout}]"), "content": checkout}], "updatedAt": 12});
    let rows = vec![
        (
            "projectMemorySpaces/v1",
            space_id.into(),
            json!({"id": space_id, "name": checkout, "primaryPath": checkout, "paths": [checkout, external, removed], "repositoryIdentity": repository_identity, "gitCommonDir": source.join("project/.git"), "importedSources": [format!("path:{checkout}"), "group:workspace", format!("path:{external}")], "autoRecordEnabled": true}),
        ),
        (
            "projectMemoryCheckouts/v1",
            checkout.clone(),
            json!(space_id),
        ),
        (
            "projectMemoryCheckouts/v1",
            external.clone(),
            json!(space_id),
        ),
        (
            "projectMemoryRevokedCheckouts/v1",
            removed.clone(),
            json!(space_id),
        ),
        (
            "projectMemoryImportedSources/v1",
            format!("path:{checkout}"),
            json!(space_id),
        ),
        (
            "projectMemoryImportedSources/v1",
            "group:workspace".into(),
            json!(space_id),
        ),
        (
            "projectMemoryRepositories/v1",
            "repository-hash".into(),
            json!(space_id),
        ),
        (
            "projectMemorySessions/v1",
            "historical-session".into(),
            json!(space_id),
        ),
        (
            "projectMemorySpaceContent/v1",
            space_id.into(),
            content.clone(),
        ),
    ];
    fixture(&source, &rows);
    fs::create_dir_all(&destination).unwrap();
    fs::copy(source.join("pi.sqlite"), destination.join("pi.sqlite")).unwrap();
    let original = snapshot(&source);
    relocate(&source, &destination).unwrap();
    let moved = snapshot(&destination);
    let value = |namespace: &str, key: &str| -> Value {
        serde_json::from_str(
            &moved
                .iter()
                .find(|row| row.0 == namespace && row.1 == key)
                .unwrap()
                .2,
        )
        .unwrap()
    };
    let moved_checkout = destination.join("project").to_string_lossy().into_owned();
    let metadata = value("projectMemorySpaces/v1", space_id);
    assert_eq!(metadata["primaryPath"], json!(moved_checkout));
    assert_eq!(
        metadata["paths"],
        json!([moved_checkout, external, destination.join("removed")])
    );
    assert_eq!(
        metadata["gitCommonDir"],
        json!(destination.join("project/.git"))
    );
    assert_eq!(
        metadata["importedSources"],
        json!([
            format!("path:{moved_checkout}"),
            "group:workspace",
            format!("path:{external}")
        ])
    );
    assert_eq!(metadata["repositoryIdentity"], repository_identity);
    assert_eq!(metadata["id"], space_id);
    assert_eq!(metadata["name"], checkout);
    assert_eq!(metadata["autoRecordEnabled"], true);
    assert_eq!(
        value("projectMemoryCheckouts/v1", &moved_checkout),
        space_id
    );
    assert_eq!(value("projectMemoryCheckouts/v1", &external), space_id);
    assert_eq!(
        value(
            "projectMemoryRevokedCheckouts/v1",
            &destination.join("removed").to_string_lossy()
        ),
        space_id
    );
    assert_eq!(
        value(
            "projectMemoryImportedSources/v1",
            &format!("path:{moved_checkout}")
        ),
        space_id
    );
    assert_eq!(
        value("projectMemoryImportedSources/v1", "group:workspace"),
        space_id
    );
    // These records must remain byte-identical: they are historical bindings,
    // device identity indexes, and user narrative rather than relocatable paths.
    for namespace in [
        "projectMemoryRepositories/v1",
        "projectMemorySessions/v1",
        "projectMemorySpaceContent/v1",
    ] {
        assert_eq!(
            moved
                .iter()
                .filter(|row| row.0 == namespace)
                .collect::<Vec<_>>(),
            original
                .iter()
                .filter(|row| row.0 == namespace)
                .collect::<Vec<_>>()
        );
    }
    assert_eq!(
        moved.len(),
        original.len(),
        "relocation cannot invent a checkout association"
    );
    assert!(moved.iter().all(|row| row.3 == 42));
    assert_eq!(snapshot(&source), original);
    relocate(&source, &destination).unwrap();
    assert_eq!(snapshot(&destination), moved);
}

#[test]
fn colliding_memory_checkout_keys_roll_back_the_database_transaction() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("old");
    let destination = temporary.path().join("new");
    fs::create_dir_all(&source).unwrap();
    fixture(
        &destination,
        &[
            (
                "projectMemoryCheckouts/v1",
                source.join("project").to_string_lossy().into_owned(),
                json!("old-space"),
            ),
            (
                "projectMemoryCheckouts/v1",
                destination.join("project").to_string_lossy().into_owned(),
                json!("another-space"),
            ),
            (
                "projectMemorySpaces/v1",
                "old-space".into(),
                json!({"primaryPath": source.join("project")}),
            ),
        ],
    );
    let original = snapshot(&destination);
    assert!(relocate(&source, &destination).is_err());
    assert_eq!(snapshot(&destination), original);
}
