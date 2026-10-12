//! Session-bound Git RPC. The AppState lock is held through each bounded
//! mutation so turn admission and Bash ownership cannot race its idle check.
use super::{rpc_err, JsonRpcError};
use crate::{
    git_workspaces::{self as git, GitError, Mutation, MutationRequest},
    state::AppState,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    project_path: String,
    session_id: Option<String>,
}
fn invalid(message: impl Into<String>) -> JsonRpcError {
    rpc_err(1002, message, "INVALID_PARAMS")
}
fn internal(error: impl std::fmt::Display) -> JsonRpcError {
    rpc_err(1000, error.to_string(), "INTERNAL")
}
fn git_error(error: GitError) -> JsonRpcError {
    match error {
        GitError::Invalid(message) => invalid(message),
        GitError::Internal(message) => internal(message),
    }
}
fn expected<'a>(params: &'a Value, key: &str) -> Result<Option<&'a str>, JsonRpcError> {
    match params.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.is_empty() => Ok(Some(value)),
        _ => Err(invalid(format!(
            "{key} is required and must be a nonempty string or null"
        ))),
    }
}

fn bind_project(st: &AppState, request: &Request, mutation: bool) -> Result<PathBuf, JsonRpcError> {
    let owner = if let Some(session_id) = request.session_id.as_deref() {
        if session_id.trim().is_empty() {
            return Err(invalid("sessionId cannot be empty"));
        }
        let row: Option<(Option<String>, Option<String>, bool)> = st.db.conn().query_row(
            "SELECT p.path, s.source, EXISTS(SELECT 1 FROM team_members WHERE member_session_id=s.id)
             FROM sessions s LEFT JOIN projects p ON p.id=s.project_id
             WHERE s.id=?1 AND s.deleted_at IS NULL", [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(internal)?;
        let (project, source, member) =
            row.ok_or_else(|| rpc_err(1007, "session not found", "SESSION_NOT_FOUND"))?;
        if source.as_deref().is_some_and(|source| source != "desktop") || (mutation && member) {
            return Err(invalid(
                "Git operations require a local, writable owner session",
            ));
        }
        // Imported plugin sessions can use an arbitrary source string; its
        // origin sidecar remains authoritative even if the source is desktop.
        let imported: bool = st
            .db
            .conn()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM session_import_origins WHERE session_id=?1)",
                [session_id],
                |row| row.get(0),
            )
            .map_err(internal)?;
        if imported {
            return Err(invalid(
                "Imported sessions cannot manage local Git checkouts",
            ));
        }
        project
    } else {
        st.workspace.get().map(|workspace| workspace.path)
    };
    let owner =
        owner.ok_or_else(|| invalid("A project-bound session or active workspace is required"))?;
    if !Path::new(&request.project_path).is_absolute()
        || !git::same_path(Path::new(&request.project_path), Path::new(&owner))
    {
        return Err(invalid("projectPath does not match the owner workspace"));
    }
    Ok(PathBuf::from(owner))
}

fn ensure_idle_checkout(st: &AppState, root: &Path) -> Result<(), JsonRpcError> {
    let mut statement = st
        .db
        .conn()
        .prepare(
            "SELECT DISTINCT p.path FROM projects p JOIN sessions s ON s.project_id=p.id
         JOIN turns t ON t.session_id=s.id WHERE t.status='running'",
        )
        .map_err(internal)?;
    for path in statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(internal)?
    {
        if owner_can_access_checkout(st, root, &path.map_err(internal)?)? {
            return Err(invalid("Git checkout has a running session"));
        }
    }
    let mut statement = st.db.conn().prepare("SELECT b.cwd,p.path FROM background_processes b LEFT JOIN sessions s ON s.id=b.session_id LEFT JOIN projects p ON p.id=s.project_id WHERE b.status IN ('starting','running','stopping')").map_err(internal)?;
    for row in statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(internal)?
    {
        let (cwd, owner) = row.map_err(internal)?;
        if directories_overlap(root, Path::new(&cwd))
            || owner
                .map(|owner| owner_can_access_checkout(st, root, &owner))
                .transpose()?
                .unwrap_or(false)
        {
            return Err(invalid("Git checkout has a running background process"));
        }
    }
    for (session, _) in st.active_bash_cancellations.keys() {
        let path: Option<String> = st
            .db
            .conn()
            .query_row(
                "SELECT p.path FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?1",
                [session],
                |row| row.get(0),
            )
            .optional()
            .map_err(internal)?;
        if let Some(path) = path {
            if !owner_can_access_checkout(st, root, &path)? {
                continue;
            }
            return Err(invalid("Git checkout has a running Bash tool"));
        }
    }
    Ok(())
}

fn owner_can_access_checkout(
    st: &AppState,
    checkout: &Path,
    owner: &str,
) -> Result<bool, JsonRpcError> {
    if directories_overlap(checkout, Path::new(owner)) {
        return Ok(true);
    }
    Ok(st
        .db
        .project_group_for_path(owner)
        .map_err(internal)?
        .is_some_and(|group| {
            group
                .roots
                .iter()
                .any(|root| directories_overlap(checkout, Path::new(&root.path)))
        }))
}

fn directories_overlap(a: &Path, b: &Path) -> bool {
    git::inside_checkout(a, b) || git::inside_checkout(b, a)
}

async fn read_git<F, Fut>(
    state: Arc<Mutex<AppState>>,
    request: &Request,
    read: F,
) -> Result<Value, JsonRpcError>
where
    F: FnOnce(PathBuf, PathBuf) -> Fut,
    Fut: std::future::Future<Output = Result<Option<git::GitWorkspaceSnapshot>, GitError>>,
{
    let (project, managed_dir) = {
        let st = tokio::time::timeout(std::time::Duration::from_secs(10), state.lock())
            .await
            .map_err(|_| internal("Git metadata admission timed out"))?;
        if st.shutting_down {
            return Err(invalid("Host is shutting down"));
        }
        (
            bind_project(&st, request, false)?,
            st.data_dir.join("worktrees"),
        )
    };
    Ok(json!({"git":read(project,managed_dir).await.map_err(git_error)?}))
}

pub(super) async fn handle(
    state: Arc<Mutex<AppState>>,
    method: &str,
    params: &Value,
) -> Result<Value, JsonRpcError> {
    if !matches!(
        method,
        "workspace.git.get"
            | "workspace.git.switchBranch"
            | "workspace.git.createBranch"
            | "workspace.git.createWorktree"
    ) {
        return Err(rpc_err(-32601, "method not found", "METHOD_NOT_FOUND"));
    }
    let mutation = method != "workspace.git.get";
    // Mutations include additional fields, while get rejects misspelled fields.
    let request: Request = if mutation {
        serde_json::from_value(
            json!({"projectPath":params.get("projectPath"), "sessionId":params.get("sessionId")}),
        )
    } else {
        serde_json::from_value(params.clone())
    }
    .map_err(|error| invalid(error.to_string()))?;
    if !mutation {
        return read_git(state, &request, |project, managed_dir| async move {
            git::get(&project, &managed_dir).await
        })
        .await;
    }
    let st = tokio::time::timeout(std::time::Duration::from_secs(10), state.lock())
        .await
        .map_err(|_| {
            internal("Git operation could not obtain Host admission before its deadline")
        })?;
    if st.shutting_down {
        return Err(invalid("Host is shutting down"));
    }
    let project = bind_project(&st, &request, mutation)?;
    let managed_dir = st.data_dir.join("worktrees");
    let branch = params
        .get("branch")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("branch required"))?;
    let expected_head = expected(params, "expectedHead")?;
    let expected_branch = expected(params, "expectedBranch")?;
    let action = match method {
        "workspace.git.switchBranch" => Mutation::SwitchBranch,
        "workspace.git.createBranch" => Mutation::CreateBranch,
        _ => Mutation::CreateWorktree,
    };
    if !matches!(action, Mutation::CreateWorktree) {
        let snapshot = git::get(&project, &managed_dir)
            .await
            .map_err(git_error)?
            .ok_or_else(|| invalid("Project is not a Git checkout"))?;
        ensure_idle_checkout(&st, Path::new(&snapshot.root_path))?;
    }
    let (snapshot, worktree) = git::mutate(
        MutationRequest {
            project: &project,
            managed_dir: &managed_dir,
            branch,
            expected_head,
            expected_branch,
        },
        action,
    )
    .await
    .map_err(git_error)?;
    if let Some(worktree) = worktree {
        Ok(json!({"git":snapshot,"worktree":worktree}))
    } else {
        Ok(json!({"git":snapshot}))
    }
}

#[cfg(test)]
#[path = "git_workspaces_tests.rs"]
mod tests;
