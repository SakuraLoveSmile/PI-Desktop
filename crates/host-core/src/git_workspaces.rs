//! Local Git metadata and non-destructive checkout mutations. Git owns the
//! durable worktree registry; no parallel database identity is maintained.
use crate::workspace::simple_canonicalize;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::process::Command;

mod command;
#[cfg(test)]
use command::{bounded_read, OUTPUT_LIMIT};
use command::{command, run, run_input, GitOutput};
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Internal(String),
}
type Result<T> = std::result::Result<T, GitError>;
fn internal(error: impl std::fmt::Display) -> GitError {
    GitError::Internal(error.to_string())
}
fn invalid(message: impl Into<String>) -> GitError {
    GitError::Invalid(message.into())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_out_path: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
    pub managed: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceSnapshot {
    pub project_path: String,
    pub root_path: String,
    pub main_path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_worktree: bool,
    pub dirty: bool,
    pub branches: Vec<GitBranch>,
    pub worktrees: Vec<GitWorktree>,
}

struct Repository {
    project: PathBuf,
    overrides: Vec<String>,
    deadline: Instant,
}

fn include_builtin_config(command: &mut Command, global: Option<&Path>) {
    if let Some(global) = global {
        command.env("GIT_CONFIG_GLOBAL", global);
    } else if let Some(global) = std::env::var_os("GIT_CONFIG_GLOBAL") {
        command.env("GIT_CONFIG_GLOBAL", global);
    } else {
        command.env_remove("GIT_CONFIG_GLOBAL");
    }
    command.env_remove("GIT_CONFIG_NOSYSTEM");
}

async fn builtin_config(
    project: &Path,
    deadline: Instant,
    global: Option<&Path>,
) -> Result<Vec<String>> {
    // Preserve normal built-in checkout conversions, without inheriting
    // commands, aliases, hooks, credentials or other executable settings.
    let mut command = command(
        project,
        &[],
        &[
            "config",
            "--includes",
            "--null",
            "--get-regexp",
            "^core\\.(autocrlf|eol|safecrlf|attributesfile|checkroundtripencoding)$",
        ],
    );
    include_builtin_config(&mut command, global);
    let values = run(
        command,
        COMMAND_TIMEOUT.min(deadline.saturating_duration_since(Instant::now())),
    )
    .await?;
    if values.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    Ok(values
        .checked()?
        .text()?
        .split('\0')
        .filter_map(|entry| entry.split_once('\n'))
        .map(|(key, value)| format!("{key}={value}"))
        .collect())
}
impl Repository {
    async fn open(project: &Path) -> Result<Option<Self>> {
        let deadline = Instant::now() + OPERATION_TIMEOUT;
        if !project.is_absolute() {
            return Err(invalid("projectPath must be absolute"));
        }
        let project = simple_canonicalize(project)
            .map_err(|e| invalid(format!("projectPath unavailable: {e}")))?;
        if !project.is_dir() {
            return Err(invalid("projectPath must be a directory"));
        }
        let probe = run(
            command(&project, &[], &["rev-parse", "--is-inside-work-tree"]),
            COMMAND_TIMEOUT.min(deadline.saturating_duration_since(Instant::now())),
        )
        .await?;
        if !probe.status.success() {
            if String::from_utf8_lossy(&probe.stderr).contains("not a git repository") {
                return Ok(None);
            }
            probe.checked()?;
        } else if probe.text()?.trim() != "true" {
            return Ok(None);
        }
        // Enumerate names only, never config values. Disable every repository
        // clean/smudge/process filter before status or checkout can run it.
        let filters = run(
            command(
                &project,
                &[],
                &[
                    "config",
                    "--name-only",
                    "--get-regexp",
                    "^filter\\..*\\.(clean|smudge|process|required)$",
                ],
            ),
            COMMAND_TIMEOUT.min(deadline.saturating_duration_since(Instant::now())),
        )
        .await?;
        let mut overrides = builtin_config(&project, deadline, None).await?;
        if filters.status.success() {
            for key in filters.text()?.lines() {
                overrides.push(format!(
                    "{key}={}",
                    if key.ends_with(".required") {
                        "false"
                    } else {
                        ""
                    }
                ));
            }
        } else if filters.status.code() != Some(1) {
            filters.checked()?;
        }
        Ok(Some(Self {
            project,
            overrides,
            deadline,
        }))
    }
    async fn run(&self, args: &[&str]) -> Result<GitOutput> {
        run(
            command(&self.project, &self.overrides, args),
            COMMAND_TIMEOUT.min(self.deadline.saturating_duration_since(Instant::now())),
        )
        .await
    }
    async fn text(&self, args: &[&str]) -> Result<String> {
        self.run(args).await?.checked()?.text()
    }
    async fn optional_ref(&self, args: &[&str]) -> Result<Option<String>> {
        let output = self.run(args).await?;
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        Ok(Some(output.checked()?.text()?.trim().to_string()))
    }
    async fn snapshot(&self, managed_dir: &Path) -> Result<GitWorkspaceSnapshot> {
        let root = self.text(&["rev-parse", "--show-toplevel"]).await?;
        let root = simple_canonicalize(Path::new(root.strip_suffix('\n').unwrap_or(&root)))
            .map_err(internal)?;
        if !inside_checkout(&root, &self.project) {
            return Err(invalid(
                "Git checkout root does not contain the owner project",
            ));
        }
        let branch = self
            .optional_ref(&["symbolic-ref", "--quiet", "--short", "HEAD"])
            .await?;
        let head = self
            .optional_ref(&["rev-parse", "--verify", "--quiet", "HEAD"])
            .await?;
        let listing = self
            .text(&["worktree", "list", "--porcelain", "-z"])
            .await?;
        let mut worktrees = Vec::new();
        for record in listing.split("\0\0").filter(|record| !record.is_empty()) {
            let mut path = None;
            let mut branch = None;
            for field in record.split('\0') {
                if let Some(value) = field.strip_prefix("worktree ") {
                    path = Some(value.to_string());
                }
                if let Some(value) = field.strip_prefix("branch refs/heads/") {
                    branch = Some(value.to_string());
                }
            }
            let Some(path) = path else {
                return Err(internal("Malformed Git worktree metadata"));
            };
            let path = comparable_path(Path::new(&path));
            worktrees.push(GitWorktree {
                managed: managed_worktree(&path, managed_dir),
                path: path.to_string_lossy().into_owned(),
                branch,
                is_main: worktrees.is_empty(),
            });
        }
        let main_path = worktrees
            .first()
            .ok_or_else(|| internal("Git worktree registry is empty"))?
            .path
            .clone();
        let branch_names = self
            .text(&["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/"])
            .await?;
        let branches = branch_names
            .lines()
            .map(|name| GitBranch {
                name: name.to_string(),
                current: branch.as_deref() == Some(name),
                checked_out_path: worktrees
                    .iter()
                    .find(|tree| tree.branch.as_deref() == Some(name))
                    .map(|tree| tree.path.clone()),
            })
            .collect();
        let dirty = !self
            .text(&[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--ignore-submodules=none",
            ])
            .await?
            .is_empty();
        Ok(GitWorkspaceSnapshot {
            project_path: self.project.to_string_lossy().into_owned(),
            is_worktree: !same_path(&root, Path::new(&main_path)),
            root_path: root.to_string_lossy().into_owned(),
            main_path,
            branch,
            head,
            dirty,
            branches,
            worktrees,
        })
    }
    async fn validate_branch(&self, branch: &str) -> Result<()> {
        if branch.is_empty()
            || branch.len() > 255
            || branch.starts_with('-')
            || branch == "@"
            || branch.contains("@{")
            || branch.chars().any(char::is_control)
        {
            return Err(invalid("Invalid branch name"));
        }
        if !self
            .run(&["check-ref-format", &format!("refs/heads/{branch}")])
            .await?
            .status
            .success()
        {
            return Err(invalid("Invalid branch name"));
        }
        Ok(())
    }
    async fn requires_filters(&self, target: &str) -> Result<bool> {
        let files = self
            .text(&["ls-tree", "-r", "--name-only", "-z", target])
            .await?;
        // Inspect the committed attribute files for the destination, without
        // materializing an alternate index or executing checkout filters.
        for path in files
            .split('\0')
            .filter(|path| path.rsplit('/').next() == Some(".gitattributes"))
        {
            let attributes = self.text(&["show", &format!("{target}:{path}")]).await?;
            for line in attributes
                .lines()
                .filter(|line| !line.trim_start().starts_with('#'))
            {
                if line
                    .split_whitespace()
                    .skip(1)
                    .any(|value| value == "filter" || value.starts_with("filter="))
                {
                    return Ok(true);
                }
            }
        }
        // Git's attribute reader is metadata-only. Include normal global
        // configuration here so core.attributesFile is observed, but keep
        // all executable helpers disabled. Also covers .git/info/attributes.
        let mut command = command(
            &self.project,
            &self.overrides,
            &["check-attr", "--cached", "--all", "-z", "--stdin"],
        );
        include_builtin_config(&mut command, None);
        command.stdin(Stdio::piped());
        let attributes = run_input(
            command,
            COMMAND_TIMEOUT.min(self.deadline.saturating_duration_since(Instant::now())),
            Some(files.into_bytes()),
        )
        .await?
        .checked()?
        .text()?;
        let fields: Vec<_> = attributes.trim_end_matches('\0').split('\0').collect();
        Ok(fields
            .as_chunks::<3>()
            .0
            .iter()
            .any(|entry| entry[1] == "filter" && !matches!(entry[2], "unset" | "unspecified")))
    }
}

pub fn comparable_path(path: &Path) -> PathBuf {
    simple_canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}
pub fn same_path(a: &Path, b: &Path) -> bool {
    let a = comparable_path(a);
    let b = comparable_path(b);
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}
pub fn inside_checkout(checkout: &Path, candidate: &Path) -> bool {
    crate::workspace::lexically_inside(
        &comparable_path(checkout),
        &comparable_path(candidate).to_string_lossy(),
    )
}
fn managed_worktree(path: &Path, managed_dir: &Path) -> bool {
    let root = comparable_path(managed_dir);
    path.parent().is_some_and(|parent| same_path(parent, &root))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| uuid::Uuid::parse_str(name).is_ok())
}

pub async fn get(project: &Path, managed_dir: &Path) -> Result<Option<GitWorkspaceSnapshot>> {
    match Repository::open(project).await? {
        Some(repo) => repo.snapshot(managed_dir).await.map(Some),
        None => Ok(None),
    }
}

pub enum Mutation {
    SwitchBranch,
    CreateBranch,
    CreateWorktree,
}
pub struct MutationRequest<'a> {
    pub project: &'a Path,
    pub managed_dir: &'a Path,
    pub branch: &'a str,
    pub expected_head: Option<&'a str>,
    pub expected_branch: Option<&'a str>,
}
pub async fn mutate(
    request: MutationRequest<'_>,
    mutation: Mutation,
) -> Result<(GitWorkspaceSnapshot, Option<GitWorktree>)> {
    let repo = Repository::open(request.project)
        .await?
        .ok_or_else(|| invalid("Project is not a Git checkout"))?;
    repo.validate_branch(request.branch).await?;
    let snapshot = repo.snapshot(request.managed_dir).await?;
    if snapshot.head.as_deref() != request.expected_head
        || snapshot.branch.as_deref() != request.expected_branch
    {
        return Err(invalid(
            "Git checkout changed; refresh the branch menu before retrying",
        ));
    }
    let existing = snapshot
        .branches
        .iter()
        .find(|branch| branch.name == request.branch);
    if matches!(mutation, Mutation::SwitchBranch) {
        let existing = existing.ok_or_else(|| invalid("Local branch not found"))?;
        if existing
            .checked_out_path
            .as_deref()
            .is_some_and(|path| !same_path(Path::new(path), Path::new(&snapshot.root_path)))
        {
            return Err(invalid("Branch is checked out in another worktree"));
        }
    } else if existing.is_some() {
        return Err(invalid("Branch already exists"));
    }
    let target = if matches!(mutation, Mutation::SwitchBranch) {
        format!("refs/heads/{}", request.branch)
    } else {
        "HEAD".to_string()
    };
    if snapshot.head.is_some() && repo.requires_filters(&target).await? {
        return Err(invalid("Repository uses checkout filters (such as Git LFS); manage this checkout with an external Git tool"));
    }
    if matches!(mutation, Mutation::CreateWorktree) {
        let head = snapshot
            .head
            .as_deref()
            .ok_or_else(|| invalid("Worktree requires a committed HEAD"))?;
        if request
            .managed_dir
            .symlink_metadata()
            .is_ok_and(|meta| meta.file_type().is_symlink())
        {
            return Err(invalid("Managed worktree directory cannot be a symlink"));
        }
        std::fs::create_dir_all(request.managed_dir).map_err(internal)?;
        let target = simple_canonicalize(request.managed_dir)
            .map_err(internal)?
            .join(uuid::Uuid::new_v4().to_string());
        repo.text(&[
            "worktree",
            "add",
            "-b",
            request.branch,
            "--",
            target
                .to_str()
                .ok_or_else(|| invalid("Worktree path must be UTF-8"))?,
            head,
        ])
        .await
        .map_err(|error| {
            internal(format!(
                "{error}; inspect worktree path {} before retrying",
                target.display()
            ))
        })?;
        // Never delete a successfully created checkout if snapshot refresh fails.
        let target_snapshot = get(&target, request.managed_dir)
            .await
            .map_err(|error| {
                internal(format!(
                    "Worktree created at {}, but refresh failed: {error}",
                    target.display()
                ))
            })?
            .ok_or_else(|| {
                internal(format!(
                    "Worktree created at {}, but metadata is unavailable",
                    target.display()
                ))
            })?;
        let worktree = target_snapshot
            .worktrees
            .iter()
            .find(|tree| same_path(Path::new(&tree.path), &target))
            .cloned()
            .ok_or_else(|| {
                internal(format!(
                    "Worktree created at {}, but registry entry is unavailable",
                    target.display()
                ))
            })?;
        return Ok((target_snapshot, Some(worktree)));
    }
    if snapshot.dirty {
        return Err(invalid(
            "Commit or move staged, unstaged and untracked changes before switching branches",
        ));
    }
    match mutation {
        Mutation::SwitchBranch => {
            repo.text(&["switch", "--no-guess", "--", request.branch])
                .await?;
        }
        Mutation::CreateBranch => {
            repo.text(&["switch", "-c", request.branch]).await?;
        }
        Mutation::CreateWorktree => unreachable!(),
    }
    Ok((repo.snapshot(request.managed_dir).await?, None))
}

#[cfg(test)]
mod tests;
