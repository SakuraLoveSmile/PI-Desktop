use super::*;
use crate::{rpc::handle_request, sessions};
use std::process::Command;
use tempfile::TempDir;
use tokio::sync::mpsc;

struct Fixture {
    _dir: TempDir,
    project: PathBuf,
    state: Arc<Mutex<AppState>>,
    session: String,
}
impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("repo");
        std::fs::create_dir(&project).unwrap();
        git(&project, &["init", "-b", "main"]);
        std::fs::write(project.join("file.txt"), "fixture").unwrap();
        git(&project, &["add", "file.txt"]);
        git(&project, &["commit", "-m", "fixture"]);
        let mut app = AppState::open(&dir.path().join("data")).unwrap();
        app.handshook = true;
        app.workspace.set(&project);
        let session = sessions::create_session(
            &app.db,
            Some("Git fixture".into()),
            Some("agent".into()),
            None,
            None,
            Some(project.to_string_lossy().into_owned()),
        )
        .unwrap();
        Self {
            _dir: dir,
            project,
            state: Arc::new(Mutex::new(app)),
            session: session.id,
        }
    }
    fn params(&self) -> Value {
        json!({"sessionId":self.session, "projectPath":self.project})
    }
    async fn call(&self, method: &str, params: Value) -> Result<Value, JsonRpcError> {
        let (tx, _rx) = mpsc::unbounded_channel();
        handle_request(self.state.clone(), method, params, tx).await
    }
    async fn snapshot(&self) -> Value {
        self.call("workspace.git.get", self.params()).await.unwrap()["git"].clone()
    }
    async fn mutation(&self, method: &str, branch: &str) -> Result<Value, JsonRpcError> {
        let snapshot = self.snapshot().await;
        let mut params = self.params();
        params["branch"] = json!(branch);
        params["expectedHead"] = snapshot["head"].clone();
        params["expectedBranch"] = snapshot["branch"].clone();
        self.call(method, params).await
    }
}
fn git(project: &Path, args: &[&str]) {
    let mut command = Command::new("git");
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let output = command
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            &format!("core.hooksPath={null}"),
        ])
        .args(args)
        .current_dir(project)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", null)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
fn code(error: JsonRpcError) -> Value {
    error.data.unwrap()["errorCode"].clone()
}

#[tokio::test]
async fn git_workspaces_rpc_footer_branch_and_worktree_user_path() {
    let fixture = Fixture::new().await;
    let initial = fixture.snapshot().await;
    assert_eq!(initial["branch"], "main");
    let created = fixture
        .mutation("workspace.git.createBranch", "feature")
        .await
        .unwrap();
    assert_eq!(created["git"]["branch"], "feature");
    let switched = fixture
        .mutation("workspace.git.switchBranch", "main")
        .await
        .unwrap();
    assert_eq!(switched["git"]["branch"], "main");
    std::fs::write(fixture.project.join("draft.txt"), "preserve").unwrap();
    let worktree = fixture
        .mutation("workspace.git.createWorktree", "isolated")
        .await
        .unwrap();
    assert_eq!(worktree["worktree"]["managed"], true);
    assert_eq!(worktree["git"]["branch"], "isolated");
    assert_eq!(worktree["git"]["mainPath"], initial["mainPath"]);
    assert_eq!(fixture.snapshot().await["branch"], "main");
    assert!(fixture.project.join("draft.txt").exists());
}

#[tokio::test]
async fn git_workspaces_rpc_owner_project_bound_not_mutable_workspace() {
    let fixture = Fixture::new().await;
    let other = fixture._dir.path().join("other");
    std::fs::create_dir(&other).unwrap();
    fixture.state.lock().await.workspace.set(&other);
    assert_eq!(fixture.snapshot().await["branch"], "main");
    let error = fixture
        .call(
            "workspace.git.get",
            json!({"sessionId":fixture.session,"projectPath":other}),
        )
        .await
        .unwrap_err();
    assert_eq!(code(error), "INVALID_PARAMS");
    let error = fixture
        .call("workspace.git.get", json!({"projectPath":fixture.project}))
        .await
        .unwrap_err();
    assert_eq!(code(error), "INVALID_PARAMS");
    assert_eq!(
        fixture
            .call("workspace.git.get", json!({"projectPath":other}))
            .await
            .unwrap()["git"],
        Value::Null
    );
    let error = fixture
        .call(
            "workspace.git.get",
            json!({"sessionId":"unknown","projectPath":fixture.project}),
        )
        .await
        .unwrap_err();
    assert_eq!(code(error), "SESSION_NOT_FOUND");
}

#[tokio::test]
async fn git_workspaces_rpc_missing_snapshot_fields_refused() {
    let fixture = Fixture::new().await;
    let mut params = fixture.params();
    params["branch"] = json!("new");
    assert_eq!(
        code(
            fixture
                .call("workspace.git.createBranch", params.clone())
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    params["expectedHead"] = Value::Null;
    params["expectedBranch"] = Value::Null;
    assert_eq!(
        code(
            fixture
                .call("workspace.git.createBranch", params)
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    assert_eq!(fixture.snapshot().await["branch"], "main");
}

#[tokio::test]
async fn git_workspaces_rpc_native_remote_and_team_member_owners_refused() {
    let fixture = Fixture::new().await;
    for source in ["remote", "pi-native", "imported"] {
        {
            let st = fixture.state.lock().await;
            st.db
                .conn()
                .execute(
                    "UPDATE sessions SET source=?1 WHERE id=?2",
                    rusqlite::params![source, fixture.session],
                )
                .unwrap();
        }
        assert_eq!(
            code(
                fixture
                    .call("workspace.git.get", fixture.params())
                    .await
                    .unwrap_err()
            ),
            "INVALID_PARAMS"
        );
    }
    {
        let st = fixture.state.lock().await;
        st.db
            .conn()
            .execute(
                "UPDATE sessions SET source=NULL WHERE id=?1",
                [&fixture.session],
            )
            .unwrap();
        let lead = sessions::create_session(
            &st.db,
            Some("Lead".into()),
            Some("agent".into()),
            None,
            None,
            Some(fixture.project.to_string_lossy().into_owned()),
        )
        .unwrap();
        st.db.conn().execute("INSERT INTO teams(team_session_id,revision,paused,created_at,updated_at) VALUES(?1,1,0,1,1)", [&lead.id]).unwrap();
        st.db.conn().execute("INSERT INTO team_members(team_session_id,member_session_id,name,context_kind,phase,created_at,updated_at) VALUES(?1,?2,'member','fresh','idle',1,1)", rusqlite::params![lead.id,fixture.session]).unwrap();
    }
    assert_eq!(
        code(
            fixture
                .mutation("workspace.git.createBranch", "new")
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_running_descendant_blocks_but_unrelated_checkout_does_not() {
    let fixture = Fixture::new().await;
    let nested = fixture.project.join("nested");
    std::fs::create_dir(&nested).unwrap();
    let turn = {
        let st = fixture.state.lock().await;
        let session = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(nested.to_string_lossy().into_owned()),
        )
        .unwrap();
        sessions::begin_turn(&st.db, &session.id, None, None).unwrap()
    };
    let error = fixture
        .mutation("workspace.git.createBranch", "new")
        .await
        .unwrap_err();
    assert_eq!(code(error), "INVALID_PARAMS");
    {
        let st = fixture.state.lock().await;
        st.db
            .conn()
            .execute("UPDATE turns SET status='aborted' WHERE id=?1", [turn])
            .unwrap();
    }
    let other = fixture._dir.path().join("other");
    std::fs::create_dir(&other).unwrap();
    {
        let st = fixture.state.lock().await;
        let session = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(other.to_string_lossy().into_owned()),
        )
        .unwrap();
        sessions::begin_turn(&st.db, &session.id, None, None).unwrap();
    }
    assert_eq!(
        fixture
            .mutation("workspace.git.createBranch", "new")
            .await
            .unwrap()["git"]["branch"],
        "new"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_background_cwd_and_foreground_bash_guard() {
    let fixture = Fixture::new().await;
    {
        let st = fixture.state.lock().await;
        st.db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES('job',?1,'call','fixture',?2,'running','2026-10-10T00:00:00Z')",rusqlite::params![fixture.session,fixture.project.to_string_lossy()]).unwrap();
    }
    assert_eq!(
        code(
            fixture
                .mutation("workspace.git.createBranch", "new")
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    {
        let mut st = fixture.state.lock().await;
        st.db
            .conn()
            .execute(
                "UPDATE background_processes SET status='completed' WHERE id='job'",
                [],
            )
            .unwrap();
        st.register_bash_cancellation(&fixture.session, "foreground")
            .unwrap();
    }
    assert_eq!(
        code(
            fixture
                .mutation("workspace.git.createBranch", "new")
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    fixture
        .state
        .lock()
        .await
        .clear_bash_cancellation(&fixture.session, "foreground");
    assert_eq!(
        fixture
            .mutation("workspace.git.createBranch", "new")
            .await
            .unwrap()["git"]["branch"],
        "new"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_home_requires_active_workspace_and_observes_shutting_down() {
    let fixture = Fixture::new().await;
    assert_eq!(
        fixture
            .call("workspace.git.get", json!({"projectPath":fixture.project}))
            .await
            .unwrap()["git"]["branch"],
        "main"
    );
    fixture.state.lock().await.workspace.clear();
    assert_eq!(
        code(
            fixture
                .call("workspace.git.get", json!({"projectPath":fixture.project}))
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    fixture.state.lock().await.shutting_down = true;
    assert_eq!(
        code(
            fixture
                .call("workspace.git.get", fixture.params())
                .await
                .unwrap_err()
        ),
        "HOST_SHUTTING_DOWN"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_import_origin_cannot_claim_desktop_owner() {
    let fixture = Fixture::new().await;
    {
        let st = fixture.state.lock().await;
        st.db
            .conn()
            .execute(
                "UPDATE sessions SET source='desktop' WHERE id=?1",
                [&fixture.session],
            )
            .unwrap();
        st.db.conn().execute("INSERT INTO session_import_origins(plugin_id,source_id,external_id,session_id,created_at) VALUES('fixture','desktop','foreign',?1,1)", [&fixture.session]).unwrap();
    }
    assert_eq!(
        code(
            fixture
                .call("workspace.git.get", fixture.params())
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_group_sibling_running_turn_and_bash_block() {
    let fixture = Fixture::new().await;
    let sibling = fixture._dir.path().join("sibling-root");
    std::fs::create_dir(&sibling).unwrap();
    let (session, turn) = {
        let st = fixture.state.lock().await;
        st.db
            .create_project_group(
                "Shared roots",
                &[
                    sibling.to_string_lossy().into_owned(),
                    fixture.project.to_string_lossy().into_owned(),
                ],
            )
            .unwrap();
        let session = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(sibling.to_string_lossy().into_owned()),
        )
        .unwrap();
        let turn = sessions::begin_turn(&st.db, &session.id, None, None).unwrap();
        (session.id, turn)
    };
    assert_eq!(
        code(
            fixture
                .mutation("workspace.git.createBranch", "blocked")
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    {
        let mut st = fixture.state.lock().await;
        st.db
            .conn()
            .execute("UPDATE turns SET status='aborted' WHERE id=?1", [turn])
            .unwrap();
        st.register_bash_cancellation(&session, "group-bash")
            .unwrap();
    }
    assert_eq!(
        code(
            fixture
                .mutation("workspace.git.createBranch", "blocked")
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    fixture
        .state
        .lock()
        .await
        .clear_bash_cancellation(&session, "group-bash");
    assert_eq!(
        fixture
            .mutation("workspace.git.createBranch", "allowed")
            .await
            .unwrap()["git"]["branch"],
        "allowed"
    );
}

#[tokio::test]
async fn git_workspaces_rpc_metadata_read_releases_host_admission_before_io() {
    let fixture = Fixture::new().await;
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let state = fixture.state.clone();
    let request: Request = serde_json::from_value(fixture.params()).unwrap();
    let read = tokio::spawn(async move {
        read_git(state, &request, |_, _| async move {
            entered_tx.send(()).unwrap();
            release_rx.await.unwrap();
            Ok(None)
        })
        .await
    });
    entered_rx.await.unwrap();
    let guard = fixture
        .state
        .try_lock()
        .expect("metadata I/O must not hold Host admission");
    assert!(guard.handshook);
    drop(guard);
    release_tx.send(()).unwrap();
    assert_eq!(read.await.unwrap().unwrap()["git"], Value::Null);
}

#[tokio::test]
async fn git_workspaces_rpc_running_parent_and_background_cwd_block_nested_checkout() {
    let fixture = Fixture::new().await;
    let nested = fixture.project.join("vendor/child");
    std::fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-b", "main"]);
    std::fs::write(nested.join("file.txt"), "nested fixture").unwrap();
    git(&nested, &["add", "file.txt"]);
    git(&nested, &["commit", "-m", "nested"]);
    let (session, turn) = {
        let st = fixture.state.lock().await;
        let session = sessions::create_session(
            &st.db,
            None,
            Some("agent".into()),
            None,
            None,
            Some(nested.to_string_lossy().into_owned()),
        )
        .unwrap();
        (
            session.id,
            sessions::begin_turn(&st.db, &fixture.session, None, None).unwrap(),
        )
    };
    let snapshot = fixture
        .call(
            "workspace.git.get",
            json!({"projectPath":nested,"sessionId":session}),
        )
        .await
        .unwrap()["git"]
        .clone();
    let params = json!({"projectPath":nested,"sessionId":session,"branch":"new","expectedHead":snapshot["head"],"expectedBranch":snapshot["branch"]});
    assert_eq!(
        code(
            fixture
                .call("workspace.git.createBranch", params.clone())
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
    {
        let st = fixture.state.lock().await;
        st.db
            .conn()
            .execute("UPDATE turns SET status='aborted' WHERE id=?1", [turn])
            .unwrap();
        st.db.conn().execute("INSERT INTO background_processes(id,session_id,tool_call_id,command,cwd,status,started_at) VALUES('parent-job',?1,'call','fixture',?2,'running','2026-10-10T00:00:00Z')",rusqlite::params![fixture.session,fixture.project.to_string_lossy()]).unwrap();
    }
    assert_eq!(
        code(
            fixture
                .call("workspace.git.createBranch", params)
                .await
                .unwrap_err()
        ),
        "INVALID_PARAMS"
    );
}
