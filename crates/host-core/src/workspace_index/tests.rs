use super::*;
use std::fs;

fn fixture() -> (tempfile::TempDir, PathBuf, IndexStore) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("workspace");
    fs::create_dir(&root).unwrap();
    let store = IndexStore::open(&directory.path().join("data")).unwrap();
    (directory, root, store)
}

#[test]
fn search_reconciles_create_edit_rename_delete_and_ignore_changes() {
    let (_directory, root, store) = fixture();
    fs::write(root.join("first.rs"), "Alpha Needle\nother\n").unwrap();
    let result = store.search(&root, "needle", None).unwrap();
    assert_eq!(result.hits[0].path, "first.rs");
    assert_eq!(result.hits[0].line, 1);
    assert_eq!(result.index.status, "fresh");
    assert!(!result.truncated);
    // Same-length rewrites must not depend on size or timestamp heuristics.
    fs::write(root.join("first.rs"), "Alpha Noodle\nother\n").unwrap();
    assert!(store.search(&root, "needle", None).unwrap().hits.is_empty());
    fs::write(root.join("new.rs"), "new NEEDLE").unwrap();
    assert_eq!(
        store.search(&root, "needle", None).unwrap().hits[0].path,
        "new.rs"
    );
    fs::rename(root.join("new.rs"), root.join("renamed.rs")).unwrap();
    assert_eq!(
        store.search(&root, "needle", None).unwrap().hits[0].path,
        "renamed.rs"
    );
    fs::write(root.join(".pi-desktopignore"), "renamed.rs\n").unwrap();
    assert!(store.search(&root, "needle", None).unwrap().hits.is_empty());
    fs::write(root.join(".pi-desktopignore"), "").unwrap();
    assert_eq!(
        store.search(&root, "needle", None).unwrap().hits[0].path,
        "renamed.rs"
    );
    fs::remove_file(root.join("renamed.rs")).unwrap();
    assert!(store.search(&root, "needle", None).unwrap().hits.is_empty());
}

#[test]
fn literals_short_words_cjk_and_unicode_case_equivalence_are_searchable() {
    let (_directory, root, store) = fixture();
    fs::write(
        root.join("unicode.txt"),
        "文档中词\nA+b.[x]\nſearch Kelvin\nAB\n",
    )
    .unwrap();
    for query in ["中词", "a+B.[x]", "SEARCH", "kelvin", "ab"] {
        let result = store.search(&root, query, None).unwrap();
        assert_eq!(result.hits.len(), 1, "{query}");
    }
    assert!(store.search(&root, "a.*x", None).unwrap().hits.is_empty());
    fs::write(root.join("ascii.txt"), "literal \"quote\" and a+b.[x]").unwrap();
    assert_eq!(
        store.search(&root, "\"quote\"", None).unwrap().hits.len(),
        1
    );
}

#[test]
fn cache_persists_isolates_roots_and_clear_is_rebuildable() {
    let (directory, root, store) = fixture();
    assert_eq!(store.status(&root).unwrap().status, "missing");
    fs::write(root.join("one.txt"), "cache marker").unwrap();
    store.search(&root, "cache", None).unwrap();
    let second = directory.path().join("second");
    fs::create_dir(&second).unwrap();
    fs::write(second.join("two.txt"), "other marker").unwrap();
    store.search(&second, "other", None).unwrap();
    let reopened = IndexStore::open(&directory.path().join("data")).unwrap();
    assert_eq!(reopened.status(&root).unwrap().file_count, 1);
    assert!(reopened
        .search(&second, "cache", None)
        .unwrap()
        .hits
        .is_empty());
    reopened.clear(&root).unwrap();
    assert_eq!(reopened.status(&root).unwrap().status, "missing");
    assert_eq!(reopened.status(&second).unwrap().status, "fresh");
    assert_eq!(reopened.search(&root, "cache", None).unwrap().hits.len(), 1);
}

#[test]
fn ignores_dependencies_sensitive_files_binary_and_large_files() {
    let (_directory, root, store) = fixture();
    fs::create_dir(root.join("node_modules")).unwrap();
    for path in [
        ".env",
        ".env.local",
        "secret.key",
        "credentials.json",
        "node_modules/dep.js",
    ] {
        fs::write(root.join(path), "private marker").unwrap();
    }
    fs::write(root.join("binary.dat"), b"private\0marker").unwrap();
    fs::write(root.join("big.txt"), "marker".repeat(200_000)).unwrap();
    fs::write(root.join("source.txt"), "public marker").unwrap();
    let result = store.search(&root, "marker", None).unwrap();
    assert_eq!(result.hits.len(), 1);
    assert_eq!(result.hits[0].path, "source.txt");
    assert_eq!(result.index.skipped_files, 2);
    assert_eq!(result.index.status, "partial");
    assert!(result.truncated);
    let connection = store::open(&store.database_path).unwrap();
    let cached: String = connection
        .query_row("SELECT group_concat(body) FROM code_index_fts", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(!cached.contains("private"));
}

#[test]
fn budgets_and_output_bounds_report_partial_coverage() {
    let (_directory, root, store) = fixture();
    fs::write(root.join("a.txt"), "marker\n".repeat(80)).unwrap();
    fs::write(root.join("b.txt"), "marker").unwrap();
    let result = store.search(&root, "marker", Some(2)).unwrap();
    assert_eq!(result.hits.len(), 2);
    assert!(result.truncated);
    let limited = store
        .search_with_limits(
            &root,
            "marker",
            None,
            Limits {
                files: 1,
                ..Limits::default()
            },
        )
        .unwrap();
    assert_eq!(limited.index.status, "partial");
    assert!(limited.truncated);
    let limited = store
        .search_with_limits(
            &root,
            "marker",
            None,
            Limits {
                total_bytes: 1,
                ..Limits::default()
            },
        )
        .unwrap();
    assert_eq!(limited.index.status, "partial");
    assert!(limited.hits.is_empty());
    fs::write(
        root.join("a.txt"),
        format!("{}marker{}", "x".repeat(1000), "中".repeat(1000)),
    )
    .unwrap();
    let result = store.search(&root, "marker", Some(50)).unwrap();
    assert!(result.hits[0].text.contains("marker"));
    assert!(result.hits[0].text.chars().count() <= 240);
    assert!(serde_json::to_vec(&result).unwrap().len() <= MAX_OUTPUT_BYTES);
}

#[test]
fn invalid_arguments_and_database_errors_are_observable() {
    let (directory, root, store) = fixture();
    for query in ["".to_string(), "x".repeat(501), "a\0b".to_string()] {
        assert!(store.search(&root, &query, None).is_err());
    }
    for limit in [0, 51] {
        assert!(store.search(&root, "x", Some(limit)).is_err());
    }
    let bad_data = directory.path().join("bad-data");
    fs::create_dir(&bad_data).unwrap();
    fs::write(bad_data.join("index"), "not a directory").unwrap();
    assert!(IndexStore::open(&bad_data).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_files_directories_and_parent_escape_are_never_read() {
    let (directory, root, store) = fixture();
    let outside = directory.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "external marker").unwrap();
    std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("linked-dir")).unwrap();
    assert!(store.search(&root, "marker", None).unwrap().hits.is_empty());
    assert!(scanner::read_text(&root, "link.txt", 1024).is_err());
    assert!(scanner::read_text(&root, "linked-dir/secret.txt", 1024).is_err());
    assert!(scanner::read_text(&root, "../outside/secret.txt", 1024).is_err());
}

#[test]
fn observed_changes_mark_non_atomic_filesystem_views() {
    let (_directory, root, _store) = fixture();
    fs::write(root.join("a.txt"), "old").unwrap();
    let scan = scanner::scan(&root, Limits::default(), Instant::now()).unwrap();
    assert!(!scan.changed());
    fs::write(root.join("a.txt"), "changed").unwrap();
    assert!(scan.changed());
    let scan = scanner::scan(&root, Limits::default(), Instant::now()).unwrap();
    fs::write(root.join("new.txt"), "new").unwrap();
    assert!(scan.changed());
}

#[test]
fn separately_opened_stores_coordinate_concurrent_same_root_searches() {
    let (directory, root, _store) = fixture();
    fs::write(root.join("source.rs"), "first marker\nsecond marker\n").unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(4));
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let root = root.clone();
            let data = directory.path().join("data");
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let store = IndexStore::open(&data).unwrap();
                barrier.wait();
                let result = store.search(&root, "marker", None).unwrap();
                assert_eq!(result.hits.len(), 2);
                assert_eq!(result.index.status, "fresh");
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
}
