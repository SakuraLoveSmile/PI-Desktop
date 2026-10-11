//! Shared-tree accident replay uses only disposable repositories and fake providers.
use super::*;

struct Fixture {
    _data: tempfile::TempDir,
    workspace: tempfile::TempDir,
    state: Arc<Mutex<AppState>>,
    tx: mpsc::UnboundedSender<String>,
    lead: String,
    member: String,
    lead_turn: Value,
    member_turn: Value,
    task: Value,
    shell: String,
}

impl Fixture {
    async fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let mut app = AppState::open(data.path()).unwrap();
        app.handshook = true;
        let (tx, _rx) = mpsc::unbounded_channel();
        let mut f = Self {
            _data: data,
            workspace,
            state: Arc::new(Mutex::new(app)),
            tx,
            lead: String::new(),
            member: String::new(),
            lead_turn: Value::Null,
            member_turn: Value::Null,
            task: Value::Null,
            shell: tools::shell::catalog(None).effective.unwrap().id,
        };
        let provider = f.call("providers.create", json!({"name":"Git fixture","vendorKey":"custom","apiStyle":"chat_completions","authKind":"none","baseUrl":"http://127.0.0.1:9/v1","defaultModelId":"fixture","models":[{"id":"fixture"}]})).await;
        f.lead = f.call("session.create", json!({"mode":"agent","executionProfile":"team","providerId":provider["provider"]["id"],"modelId":"fixture","projectPath":f.workspace.path(),"permissionMode":"auto"})).await["session"]["id"].as_str().unwrap().into();
        f.call(
            "session.configure",
            json!({"id":f.lead,"mode":"agent","permissionMode":"auto"}),
        )
        .await;
        f.lead_turn = f
            .call("session.beginTurn", json!({"sessionId":f.lead}))
            .await["turnId"]
            .clone();
        let review = f.call("team.declareStrategy", json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"leadTurnId":f.lead_turn,"strategy":"delegate","reason":"Replay shared Git warnings","members":[{"name":"builder","contextKind":"fresh"}]})).await["review"].clone();
        f.member = f.call("team.confirmLaunchReview", json!({"teamSessionId":f.lead,"reviewId":review["reviewId"],"expectedRevision":review["revision"]})).await["decision"]["memberSessionIds"][0].as_str().unwrap().into();
        f.task = f.call("team.createTask", json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"subject":"Build source","ownerMemberName":"builder","writeScopes":["builder.txt"]})).await["task"].clone();
        let message = f.call("team.sendMessage", json!({"teamSessionId":f.lead,"callerSessionId":f.lead,"target":"builder","content":"Build your owned source"})).await["message"]["id"].clone();
        f.member_turn = f
            .call(
                "session.beginTurn",
                json!({"sessionId":f.member,"sessionMessageId":message}),
            )
            .await["turnId"]
            .clone();
        f.task = f.call("team.updateTask", json!({"teamSessionId":f.lead,"callerSessionId":f.member,"taskId":f.task["taskId"],"expectedRevision":f.task["revision"],"status":"in_progress"})).await["task"].clone();
        f.git(&["init", "-q"]);
        f.git(&["config", "core.hooksPath", "/dev/null"]);
        f.git(&["config", "commit.gpgSign", "false"]);
        f.git(&["config", "user.name", "Fixture"]);
        f.git(&["config", "user.email", "fixture@example.invalid"]);
        std::fs::write(f.workspace.path().join("builder.txt"), "base\n").unwrap();
        f.git(&["add", "builder.txt"]);
        f.git(&["commit", "-qm", "fixture base"]);
        f
    }
    fn git(&self, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .args(args)
            .env(
                "GIT_CONFIG_GLOBAL",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            )
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .current_dir(self.workspace.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
    async fn call(&self, method: &str, params: Value) -> Value {
        tokio::time::timeout(
            Duration::from_secs(15),
            handle_request(self.state.clone(), method, params, self.tx.clone()),
        )
        .await
        .unwrap()
        .unwrap()
    }
    async fn bash(&self, session: &str, turn: &Value, id: &str, command: &str) -> Value {
        self.call("tools.execute", json!({"sessionId":session,"turnId":turn,"toolCallId":id,"toolName":"Bash","mode":"agent","expectedCommandShellId":self.shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&self.shell),"args":{"command":command}})).await
    }
    async fn board(&self) -> Value {
        self.call(
            "team.getBoard",
            json!({"teamSessionId":self.lead,"callerSessionId":self.lead}),
        )
        .await
    }
}

#[tokio::test]
async fn shared_git_warning_accident_replay_preserves_real_commands_and_counts() {
    let f = Fixture::new().await;
    std::fs::write(f.workspace.path().join("builder.txt"), "expert work\n").unwrap();
    std::fs::write(f.workspace.path().join("lead.txt"), "lead work\n").unwrap();
    let mixed = f
        .bash(
            &f.lead,
            &f.lead_turn,
            "mixed",
            "git add -A && git commit -m 'mixed fixture'",
        )
        .await;
    assert_eq!(mixed["ok"], true);
    assert_eq!(mixed["content"]["exitCode"], 0);
    assert_eq!(
        mixed["content"]["gitWarning"]["code"],
        "TEAM_SHARED_GIT_WARNING"
    );
    assert_eq!(
        mixed["content"]["gitWarning"]["conflictingTasks"][0]["taskId"],
        f.task["taskId"]
    );
    assert!(f
        .git(&["show", "--format=", "--name-only", "HEAD"])
        .contains("lead.txt"));
    // A dangerous command still executes; warnings must not claim protection.
    std::fs::write(
        f.workspace.path().join("builder.txt"),
        "later expert work\n",
    )
    .unwrap();
    let stash = f.bash(&f.lead, &f.lead_turn, "stash", "git stash").await;
    assert_eq!(stash["ok"], true);
    assert_eq!(
        stash["content"]["gitWarning"]["code"],
        "TEAM_SHARED_GIT_WARNING"
    );
    assert_eq!(
        std::fs::read_to_string(f.workspace.path().join("builder.txt")).unwrap(),
        "expert work\n"
    );
    assert!(!f.git(&["stash", "list"]).is_empty());
    let failed = f
        .bash(
            &f.lead,
            &f.lead_turn,
            "failed",
            "git reset --hard missing-fixture-revision",
        )
        .await;
    assert_eq!(failed["ok"], false);
    assert_eq!(failed["content"]["exitCode"], 128);
    assert_eq!(
        failed["content"]["gitWarning"]["code"],
        "TEAM_SHARED_GIT_WARNING"
    );
    let board = f.board().await;
    assert_eq!(board["sharedGitWarningCount"], 3);
    assert_eq!(board["sharedGitWarnings"][0]["memberSessionId"], f.lead);
    assert_eq!(board["outOfScopeWriteCount"], 0);
    let st = f.state.lock().await;
    let captured = crate::team::git_warnings::capture(
        &st.db,
        &f.lead,
        f.lead_turn.as_str(),
        "Bash",
        &json!({"command":"git stash"}),
    );
    assert!(captured.as_ref().unwrap().is_some());
    let mut replay = stash["content"].clone();
    crate::team::git_warnings::annotate_observable(&st.db, &captured, "stash", &mut replay);
    assert_eq!(
        crate::team::git_warnings::counts(&st.db, &f.lead).unwrap()[0].count,
        3
    );
    // Reopen the on-disk database: diagnostics are not process-local counters.
    let reopened = crate::db::Database::open_in_dir(f._data.path()).unwrap();
    assert_eq!(
        crate::team::git_warnings::counts(&reopened, &f.lead).unwrap()[0].count,
        3
    );
    assert!(crate::team::git_warnings::capture(
        &st.db,
        &f.lead,
        Some("stale-turn"),
        "Bash",
        &json!({"command":"git stash"})
    )
    .unwrap()
    .is_none());
    crate::sessions::delete_session_with_team_cleanup(&st.db, &f.lead).unwrap();
    let mut late = json!({"exitCode":0});
    crate::team::git_warnings::annotate_observable(&st.db, &captured, "late", &mut late);
    assert!(late["gitTrackingSkipped"]
        .as_str()
        .unwrap()
        .contains("detached"));
    assert_eq!(late["exitCode"], 0);
    assert!(crate::team::git_warnings::counts(&reopened, &f.lead)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn shared_git_warning_single_writer_read_only_and_other_team_do_not_warn() {
    let f = Fixture::new().await;
    // The only active writer is the caller: no other member's work is at risk.
    let own = f
        .bash(&f.member, &f.member_turn, "own", "git add --all")
        .await;
    assert_eq!(own["ok"], true);
    assert!(own["content"].get("gitWarning").is_none());
    let read = f
        .bash(
            &f.lead,
            &f.lead_turn,
            "read",
            "git status --short && printf '%s' 'git stash'",
        )
        .await;
    assert_eq!(read["ok"], true);
    assert!(read["content"].get("gitWarning").is_none());
    let other = Fixture::new().await;
    other.call("team.updateTask", json!({"teamSessionId":other.lead,"callerSessionId":other.member,"taskId":other.task["taskId"],"expectedRevision":other.task["revision"],"writeScopes":[]})).await;
    let isolated = other
        .bash(&other.lead, &other.lead_turn, "isolated", "git stash")
        .await;
    assert!(isolated["content"].get("gitWarning").is_none());
    assert_eq!(other.board().await["sharedGitWarningCount"], 0);
    assert_eq!(f.board().await["sharedGitWarningCount"], 0);
}

#[tokio::test]
async fn shared_git_warning_all_operations_and_background_admission_remain_advisory() {
    let f = Fixture::new().await;
    std::fs::write(
        f.workspace.path().join("builder.txt"),
        "discard fixture work\n",
    )
    .unwrap();
    let checkout = f
        .bash(&f.lead, &f.lead_turn, "checkout", "git checkout -- '.'")
        .await;
    assert_eq!(checkout["ok"], true);
    assert_eq!(
        checkout["content"]["gitWarning"]["operations"],
        json!(["git checkout ."])
    );
    assert_eq!(
        std::fs::read_to_string(f.workspace.path().join("builder.txt")).unwrap(),
        "base\n"
    );
    std::fs::write(f.workspace.path().join("untracked.txt"), "disposable").unwrap();
    let clean = f
        .bash(&f.lead, &f.lead_turn, "clean", "git clean -fd")
        .await;
    assert_eq!(clean["ok"], true);
    assert_eq!(
        clean["content"]["gitWarning"]["operations"],
        json!(["git clean"])
    );
    assert!(!f.workspace.path().join("untracked.txt").exists());
    std::fs::write(
        f.workspace.path().join("builder.txt"),
        "committed fixture work\n",
    )
    .unwrap();
    let commit = f
        .bash(
            &f.lead,
            &f.lead_turn,
            "commit",
            "git commit -am 'fixture commit'",
        )
        .await;
    assert_eq!(commit["ok"], true);
    assert_eq!(
        commit["content"]["gitWarning"]["operations"],
        json!(["git commit -a"])
    );
    assert_eq!(
        f.git(&["show", "HEAD:builder.txt"]),
        "committed fixture work\n"
    );
    let reset = f
        .bash(&f.lead, &f.lead_turn, "reset", "git reset --hard HEAD~1")
        .await;
    assert_eq!(reset["ok"], true);
    assert_eq!(
        reset["content"]["gitWarning"]["operations"],
        json!(["git reset --hard"])
    );
    assert_eq!(f.git(&["show", "HEAD:builder.txt"]), "base\n");
    let background = f.call("tools.execute", json!({"sessionId":f.lead,"turnId":f.lead_turn,"toolCallId":"background","toolName":"Bash","mode":"agent","expectedCommandShellId":f.shell,"expectedCommandShellDialect":tools::shell::dialect_for_id(&f.shell),"args":{"command":"git add --all","run_in_background":true}})).await;
    assert_eq!(background["ok"], true);
    assert!(background["content"]["backgroundProcessId"].is_string());
    assert_eq!(
        background["content"]["gitWarning"]["code"],
        "TEAM_SHARED_GIT_WARNING"
    );
    assert_eq!(f.board().await["sharedGitWarningCount"], 5);
}
