use super::*;
use tempfile::TempDir;

pub(crate) struct Fixture {
    pub dir: TempDir,
    pub repo: PathBuf,
    pub managed: PathBuf,
}
impl Fixture {
    pub async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("project");
        std::fs::create_dir(&repo).unwrap();
        let fixture = Self {
            managed: dir.path().join("data/worktrees"),
            dir,
            repo,
        };
        fixture.git(&["init", "-b", "main"]).await;
        std::fs::write(fixture.repo.join("file.txt"), "committed\n").unwrap();
        fixture.git(&["add", "file.txt"]).await;
        fixture.git(&["commit", "-m", "fixture"]).await;
        fixture
    }
    pub async fn git(&self, args: &[&str]) -> String {
        let overrides = vec![
            "user.name=Fixture".into(),
            "user.email=fixture@example.invalid".into(),
        ];
        run(command(&self.repo, &overrides, args), COMMAND_TIMEOUT)
            .await
            .unwrap()
            .checked()
            .unwrap()
            .text()
            .unwrap()
    }
    async fn snapshot(&self) -> GitWorkspaceSnapshot {
        get(&self.repo, &self.managed).await.unwrap().unwrap()
    }
    async fn mutate(
        &self,
        snapshot: &GitWorkspaceSnapshot,
        branch: &str,
        action: Mutation,
    ) -> Result<(GitWorkspaceSnapshot, Option<GitWorktree>)> {
        mutate(
            MutationRequest {
                project: &self.repo,
                managed_dir: &self.managed,
                branch,
                expected_head: snapshot.head.as_deref(),
                expected_branch: snapshot.branch.as_deref(),
            },
            action,
        )
        .await
    }
}

#[tokio::test]
async fn git_workspaces_non_git_and_unborn_are_distinct() {
    let fixture = Fixture::new().await;
    assert!(get(fixture.dir.path(), &fixture.managed)
        .await
        .unwrap()
        .is_none());
    let empty = fixture.dir.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    run(
        command(&empty, &[], &["init", "-b", "main"]),
        COMMAND_TIMEOUT,
    )
    .await
    .unwrap()
    .checked()
    .unwrap();
    let unborn = get(&empty, &fixture.managed).await.unwrap().unwrap();
    assert_eq!(unborn.head, None);
    assert_eq!(unborn.branch.as_deref(), Some("main"));
    let error = mutate(
        MutationRequest {
            project: &empty,
            managed_dir: &fixture.managed,
            branch: "new-tree",
            expected_head: None,
            expected_branch: Some("main"),
        },
        Mutation::CreateWorktree,
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("committed HEAD"));
}

#[tokio::test]
async fn git_workspaces_create_switch_and_detached_user_path() {
    let fixture = Fixture::new().await;
    let initial = fixture.snapshot().await;
    assert!(!initial.dirty && !initial.is_worktree);
    let (created, _) = fixture
        .mutate(&initial, "feature/ui", Mutation::CreateBranch)
        .await
        .unwrap();
    assert_eq!(created.branch.as_deref(), Some("feature/ui"));
    assert!(created.branches.iter().any(|branch| branch.name == "main"));
    let (switched, _) = fixture
        .mutate(&created, "main", Mutation::SwitchBranch)
        .await
        .unwrap();
    assert_eq!(switched.branch, initial.branch);
    fixture.git(&["switch", "--detach"]).await;
    let detached = fixture.snapshot().await;
    assert_eq!(detached.branch, None);
    let (restored, _) = fixture
        .mutate(&detached, "main", Mutation::SwitchBranch)
        .await
        .unwrap();
    assert_eq!(restored.head, initial.head);
}

#[tokio::test]
async fn git_workspaces_refuse_untracked_unstaged_and_staged_without_discard() {
    for state in ["untracked", "unstaged", "staged"] {
        let fixture = Fixture::new().await;
        fixture.git(&["branch", "other"]).await;
        let file = fixture.repo.join(if state == "untracked" {
            "draft.txt"
        } else {
            "file.txt"
        });
        std::fs::write(&file, "preserve me").unwrap();
        if state == "staged" {
            fixture.git(&["add", "file.txt"]).await;
        }
        let before = fixture.snapshot().await;
        assert!(before.dirty);
        for action in [Mutation::SwitchBranch, Mutation::CreateBranch] {
            let error = fixture
                .mutate(
                    &before,
                    if matches!(action, Mutation::SwitchBranch) {
                        "other"
                    } else {
                        "new"
                    },
                    action,
                )
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("staged, unstaged and untracked"),
                "{error}"
            );
        }
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "preserve me");
        assert_eq!(fixture.snapshot().await.branch, before.branch);
        assert!(!fixture
            .snapshot()
            .await
            .branches
            .iter()
            .any(|branch| branch.name == "new"));
    }
}

#[tokio::test]
async fn git_workspaces_stale_head_and_branch_refused() {
    let fixture = Fixture::new().await;
    let snapshot = fixture.snapshot().await;
    fixture.git(&["switch", "-c", "changed"]).await;
    assert!(fixture
        .mutate(&snapshot, "main", Mutation::SwitchBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("changed; refresh"));
    let snapshot = fixture.snapshot().await;
    std::fs::write(fixture.repo.join("file.txt"), "new commit").unwrap();
    fixture.git(&["add", "file.txt"]).await;
    fixture.git(&["commit", "-m", "new"]).await;
    assert!(fixture
        .mutate(&snapshot, "main", Mutation::SwitchBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("changed; refresh"));
    assert_eq!(fixture.snapshot().await.branch.as_deref(), Some("changed"));
}

#[tokio::test]
async fn git_workspaces_invalid_existing_and_occupied_branches_refused() {
    let fixture = Fixture::new().await;
    let snapshot = fixture.snapshot().await;
    for branch in [
        "",
        "-f",
        "bad name",
        "../escape",
        "@{-1}",
        "refs/heads/../bad",
        "a\nb",
    ] {
        assert!(
            fixture
                .mutate(&snapshot, branch, Mutation::CreateBranch)
                .await
                .unwrap_err()
                .to_string()
                .contains("Invalid branch"),
            "{branch}"
        );
    }
    assert!(fixture
        .mutate(&snapshot, "main", Mutation::CreateBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("already exists"));
    assert!(fixture
        .mutate(&snapshot, "missing", Mutation::SwitchBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("not found"));
    fixture
        .mutate(&snapshot, "occupied", Mutation::CreateWorktree)
        .await
        .unwrap();
    let snapshot = fixture.snapshot().await;
    assert!(fixture
        .mutate(&snapshot, "occupied", Mutation::SwitchBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("another worktree"));
}

#[tokio::test]
async fn git_workspaces_dirty_base_isolation_registry_and_reverse_main_path() {
    let fixture = Fixture::new().await;
    std::fs::write(fixture.repo.join("file.txt"), "dirty base").unwrap();
    std::fs::write(fixture.repo.join("draft.txt"), "untracked base").unwrap();
    let initial = fixture.snapshot().await;
    let (target, tree) = fixture
        .mutate(&initial, "isolated", Mutation::CreateWorktree)
        .await
        .unwrap();
    let tree = tree.unwrap();
    assert!(tree.managed && !tree.is_main && target.is_worktree);
    assert_eq!(target.branch.as_deref(), Some("isolated"));
    assert_eq!(target.head, initial.head);
    assert!(same_path(Path::new(&target.main_path), &fixture.repo));
    assert_eq!(
        std::fs::read_to_string(Path::new(&tree.path).join("file.txt")).unwrap(),
        "committed\n"
    );
    assert!(!Path::new(&tree.path).join("draft.txt").exists());
    assert_eq!(
        std::fs::read_to_string(fixture.repo.join("file.txt")).unwrap(),
        "dirty base"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.repo.join("draft.txt")).unwrap(),
        "untracked base"
    );
    assert_eq!(fixture.snapshot().await.branch, initial.branch);
    // A fresh read uses Git's persisted registry, with no in-memory registration.
    let refreshed = get(Path::new(&tree.path), &fixture.managed)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(refreshed.worktrees.len(), 2);
    assert!(refreshed
        .worktrees
        .iter()
        .find(|tree| tree.is_main)
        .is_some_and(|tree| !tree.managed));
}

#[tokio::test]
async fn git_workspaces_nested_project_retains_project_path_and_checkout_root() {
    let fixture = Fixture::new().await;
    let nested = fixture.repo.join("nested");
    std::fs::create_dir(&nested).unwrap();
    let snapshot = get(&nested, &fixture.managed).await.unwrap().unwrap();
    assert!(same_path(Path::new(&snapshot.project_path), &nested));
    assert!(same_path(Path::new(&snapshot.root_path), &fixture.repo));
    assert!(inside_checkout(&fixture.repo, &nested));
    assert!(!inside_checkout(&nested, &fixture.repo));
}

#[tokio::test]
async fn git_workspaces_command_failure_preserves_checkout() {
    let fixture = Fixture::new().await;
    fixture.git(&["branch", "other"]).await;
    let snapshot = fixture.snapshot().await;
    std::fs::write(fixture.repo.join(".git/index.lock"), "fixture lock").unwrap();
    let error = fixture
        .mutate(&snapshot, "other", Mutation::SwitchBranch)
        .await
        .unwrap_err();
    assert!(matches!(error, GitError::Internal(_)));
    assert!(error.to_string().contains("index.lock"));
    assert_eq!(fixture.snapshot().await.branch.as_deref(), Some("main"));
    assert_eq!(
        std::fs::read_to_string(fixture.repo.join("file.txt")).unwrap(),
        "committed\n"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn git_workspaces_hooks_and_repository_filters_do_not_execute() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new().await;
    let marker = fixture.dir.path().join("unexpected-execution");
    let hook = fixture.repo.join(".git/hooks/post-checkout");
    std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(fixture.repo.join(".gitattributes"), "*.txt filter=unsafe\n").unwrap();
    fixture.git(&["add", ".gitattributes"]).await;
    fixture.git(&["commit", "-m", "attributes"]).await;
    let filter = format!("touch '{}'; cat", marker.display());
    fixture
        .git(&["config", "filter.unsafe.smudge", &filter])
        .await;
    fixture
        .git(&["config", "filter.unsafe.clean", &filter])
        .await;
    fixture
        .git(&["config", "filter.unsafe.required", "true"])
        .await;
    let snapshot = fixture.snapshot().await;
    let error = fixture
        .mutate(&snapshot, "filter-safe", Mutation::CreateWorktree)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("external Git tool"));
    assert!(!marker.exists());
    assert!(!fixture.managed.exists());
    assert!(!fixture
        .snapshot()
        .await
        .branches
        .iter()
        .any(|branch| branch.name == "filter-safe"));
    // Removing the filter attribute keeps configured global/local drivers from
    // needlessly blocking ordinary checkouts.
    std::fs::write(fixture.repo.join(".gitattributes"), "*.txt text\n").unwrap();
    fixture
        .git(&[
            "-c",
            "filter.unsafe.clean=",
            "-c",
            "filter.unsafe.smudge=",
            "-c",
            "filter.unsafe.required=false",
            "add",
            ".gitattributes",
        ])
        .await;
    fixture
        .git(&[
            "-c",
            "filter.unsafe.clean=",
            "-c",
            "filter.unsafe.smudge=",
            "-c",
            "filter.unsafe.required=false",
            "commit",
            "-m",
            "no filters",
        ])
        .await;
    let snapshot = fixture.snapshot().await;
    fixture
        .mutate(&snapshot, "filter-safe", Mutation::CreateWorktree)
        .await
        .unwrap();
    assert!(!marker.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn git_workspaces_command_timeout_and_cancellation_cleanup() {
    let mut command = Command::new("sleep");
    command
        .arg("10")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let error = run(command, Duration::from_millis(25)).await.unwrap_err();
    assert!(error.to_string().contains("timed out"));
    let missing = run(
        Command::new("/nonexistent/pi-git-fixture"),
        Duration::from_millis(25),
    )
    .await
    .unwrap_err();
    assert!(missing.to_string().contains("Unable to start"));
}

#[tokio::test]
async fn git_workspaces_output_limit_is_observable() {
    let (reader, mut writer) = tokio::io::duplex(4096);
    let task = tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let bytes = vec![b'x'; OUTPUT_LIMIT as usize + 1];
        writer.write_all(&bytes).await.unwrap();
    });
    let error = bounded_read(reader).await.unwrap_err();
    assert!(error.to_string().contains("metadata limit"));
    task.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn git_workspaces_dropped_operation_kills_owned_child() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let script = dir.path().join("owned-child");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec sleep 30\n",
            pid_file.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut command = Command::new(&script);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let operation = tokio::spawn(run(command, COMMAND_TIMEOUT));
    let pid = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(contents) = tokio::fs::read_to_string(&pid_file).await {
                if let Ok(pid) = contents.trim().parse::<libc::pid_t>() {
                    break pid;
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    operation.abort();
    assert!(operation.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if unsafe { libc::kill(pid, 0) } == -1
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("cancelled Git operation must reap its owned child");
}

#[tokio::test]
async fn git_workspaces_redirected_core_worktree_rejected_without_touching_outside() {
    let fixture = Fixture::new().await;
    let outside = fixture.dir.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    let sentinel = outside.join("file.txt");
    std::fs::write(&sentinel, "outside stays unchanged").unwrap();
    let before = fixture.snapshot().await;
    fixture
        .git(&["config", "core.worktree", outside.to_str().unwrap()])
        .await;
    let error = fixture
        .mutate(&before, "redirected", Mutation::CreateBranch)
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("root does not contain")
            || error.to_string().contains("not a Git checkout")
    );
    assert_eq!(
        std::fs::read_to_string(sentinel).unwrap(),
        "outside stays unchanged"
    );
    assert!(!fixture
        .git(&["branch", "--list", "redirected"])
        .await
        .contains("redirected"));
}

#[tokio::test]
async fn git_workspaces_target_branch_filters_rejected_before_switch() {
    let fixture = Fixture::new().await;
    fixture.git(&["switch", "-c", "filtered"]).await;
    std::fs::write(fixture.repo.join(".gitattributes"), "*.txt filter=lfs\n").unwrap();
    fixture.git(&["add", ".gitattributes"]).await;
    fixture.git(&["commit", "-m", "target filter"]).await;
    fixture.git(&["switch", "main"]).await;
    let before = fixture.snapshot().await;
    assert!(fixture
        .mutate(&before, "filtered", Mutation::SwitchBranch)
        .await
        .unwrap_err()
        .to_string()
        .contains("external Git tool"));
    assert_eq!(fixture.snapshot().await.branch, before.branch);
    assert!(!fixture.repo.join(".gitattributes").exists());
}

#[tokio::test]
async fn git_workspaces_global_builtin_eol_configuration_is_preserved() {
    let fixture = Fixture::new().await;
    let global = fixture.dir.path().join("global.gitconfig");
    std::fs::write(
        &global,
        "[core]\n autocrlf = true\n eol = crlf\n safecrlf = false\n",
    )
    .unwrap();
    let overrides = builtin_config(
        &fixture.repo,
        Instant::now() + OPERATION_TIMEOUT,
        Some(&global),
    )
    .await
    .unwrap();
    assert!(overrides.iter().any(|value| value == "core.autocrlf=true"));
    assert!(overrides.iter().any(|value| value == "core.eol=crlf"));
    fixture.git(&["branch", "eol-target"]).await;
    std::fs::remove_file(fixture.repo.join("file.txt")).unwrap();
    run(
        command(&fixture.repo, &overrides, &["checkout", "--", "file.txt"]),
        COMMAND_TIMEOUT,
    )
    .await
    .unwrap()
    .checked()
    .unwrap();
    assert_eq!(
        std::fs::read(fixture.repo.join("file.txt")).unwrap(),
        b"committed\r\n"
    );
}

#[tokio::test]
async fn git_workspaces_git_diagnostics_use_c_locale_without_global_env_change() {
    let fixture = Fixture::new().await;
    let command = command(
        fixture.dir.path(),
        &[],
        &["rev-parse", "--is-inside-work-tree"],
    );
    let configuration = command.as_std().get_envs().collect::<Vec<_>>();
    assert!(configuration
        .iter()
        .any(|(key, value)| *key == "LC_ALL" && *value == Some(std::ffi::OsStr::new("C"))));
    let probe = run(command, COMMAND_TIMEOUT).await.unwrap();
    assert!(String::from_utf8_lossy(&probe.stderr).contains("not a git repository"));
}
