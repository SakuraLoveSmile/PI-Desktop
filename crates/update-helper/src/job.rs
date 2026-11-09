//! Job, commit and result files exchanged with the Electron main process.
//!
//! Main writes `job.json` before it starts the helper and `commit.json` right
//! before it exits. The helper writes `result.json` and nothing else outside
//! the install paths named by the job. Every path in a job is validated
//! structurally so a damaged or hand-edited job cannot point the exchange at
//! an arbitrary location.

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
pub const JOB_FILE: &str = "job.json";
pub const COMMIT_FILE: &str = "commit.json";
pub const RESULT_FILE: &str = "result.json";
pub const STAGING_PREFIX: &str = ".pi-desktop-plus-update-";
pub const BACKUP_PREFIX: &str = ".pi-desktop-plus-backup-";

const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_VERSION_LEN: usize = 64;

/// What Main prepared: one installed app, one staged app next to it, and the
/// directory that keeps the previous app afterwards.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub schema_version: u32,
    pub job_id: String,
    pub parent_pid: u32,
    pub target_app: PathBuf,
    /// `st_dev` and `st_ino` of the installed app when the job was prepared,
    /// as decimal strings (inode numbers exceed what JSON numbers hold).
    pub target_dev: String,
    pub target_ino: String,
    pub staged_app: PathBuf,
    pub backup_dir: PathBuf,
    pub from_version: String,
    pub to_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Commit {
    schema_version: u32,
    job_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    LaunchRequested,
    NotCommitted,
    ParentStillRunning,
    Locked,
    TargetChanged,
    BundleInUse,
    StagedInvalid,
    SwapFailed,
    RolledBack,
    RollbackFailed,
    InvalidJob,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultFile {
    pub schema_version: u32,
    pub job_id: String,
    pub status: Status,
    pub message: String,
    pub from_version: String,
    pub to_version: String,
    /// Where the previous app is kept (only when the exchange happened).
    pub backup_app: Option<PathBuf>,
    pub finished_at_ms: u64,
}

impl Job {
    pub fn target_parent(&self) -> &Path {
        self.target_app.parent().unwrap_or(Path::new("/"))
    }

    pub fn staging_dir(&self) -> &Path {
        self.staged_app.parent().unwrap_or(Path::new("/"))
    }

    pub fn staged_name(&self) -> &OsStr {
        self.staged_app.file_name().unwrap_or_default()
    }

    /// Structural validation; does not touch the file system.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!("unsupported job schema {}", self.schema_version));
        }
        if !valid_job_id(&self.job_id) {
            return Err("invalid job id".into());
        }
        if self.parent_pid == 0 || i32::try_from(self.parent_pid).is_err() {
            return Err("invalid parent pid".into());
        }
        for (label, value) in [("device", &self.target_dev), ("inode", &self.target_ino)] {
            if value.is_empty() || value.len() > 20 || !value.bytes().all(|b| b.is_ascii_digit()) {
                return Err(format!("invalid target {label}"));
            }
        }
        for (label, value) in [
            ("source version", &self.from_version),
            ("target version", &self.to_version),
        ] {
            if value.is_empty()
                || value.len() > MAX_VERSION_LEN
                || !value.bytes().all(|b| b.is_ascii_graphic())
            {
                return Err(format!("invalid {label}"));
            }
        }
        for (label, path) in [
            ("target app", &self.target_app),
            ("staged app", &self.staged_app),
            ("backup directory", &self.backup_dir),
        ] {
            if !is_clean_absolute(path) {
                return Err(format!("{label} must be a normalized absolute path"));
            }
        }
        if !has_app_name(&self.target_app) {
            return Err("target app must be a .app bundle".into());
        }
        let parent = self.target_parent();
        let staging = parent.join(format!("{STAGING_PREFIX}{}", self.job_id));
        if self.staged_app.parent() != Some(staging.as_path()) || !has_app_name(&self.staged_app) {
            return Err("staged app must be a .app inside the job's staging directory".into());
        }
        if self.backup_dir != parent.join(format!("{BACKUP_PREFIX}{}", self.job_id)) {
            return Err("backup directory must be the job's backup directory".into());
        }
        Ok(())
    }
}

fn valid_job_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn is_clean_absolute(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|c| matches!(c, Component::RootDir | Component::Normal(_)))
}

fn has_app_name(path: &Path) -> bool {
    path.extension() == Some(OsStr::new("app"))
        && path.file_stem().is_some_and(|stem| !stem.is_empty())
}

pub fn effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

/// A directory the helper may trust: not a symlink, owned by the current user
/// and not writable by group or others.
pub fn check_private_dir(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("cannot read directory {}: {e}", path.display()))?;
    if !meta.is_dir() {
        return Err(format!("{} is not a directory", path.display()));
    }
    if meta.uid() != effective_uid() {
        return Err(format!("{} is owned by another user", path.display()));
    }
    if meta.mode() & 0o022 != 0 {
        return Err(format!("{} is writable by group or others", path.display()));
    }
    Ok(())
}

/// Reads a small file Main created: no symlink, regular file, owned by the
/// current user, not writable by group or others.
pub fn read_trusted_file(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let meta = file.metadata()?;
    let invalid = |reason: &str| io::Error::new(io::ErrorKind::InvalidData, reason.to_string());
    if !meta.is_file() {
        return Err(invalid("not a regular file"));
    }
    if meta.uid() != effective_uid() {
        return Err(invalid("owned by another user"));
    }
    if meta.mode() & 0o022 != 0 {
        return Err(invalid("writable by group or others"));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(invalid("file is too large"));
    }
    let mut bytes = Vec::new();
    Read::take(&mut file, MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub fn load_job(job_dir: &Path) -> Result<Job, String> {
    let bytes = read_trusted_file(&job_dir.join(JOB_FILE))
        .map_err(|e| format!("cannot read {JOB_FILE}: {e}"))?;
    let job: Job =
        serde_json::from_slice(&bytes).map_err(|e| format!("cannot parse {JOB_FILE}: {e}"))?;
    job.validate()?;
    Ok(job)
}

/// Succeeds only when Main wrote a commit file for exactly this job.
pub fn read_commit(job_dir: &Path, job_id: &str) -> Result<(), String> {
    let bytes = read_trusted_file(&job_dir.join(COMMIT_FILE))
        .map_err(|e| format!("cannot read {COMMIT_FILE}: {e}"))?;
    let commit: Commit =
        serde_json::from_slice(&bytes).map_err(|e| format!("cannot parse {COMMIT_FILE}: {e}"))?;
    if commit.schema_version != SCHEMA_VERSION {
        return Err("unsupported commit schema".into());
    }
    if commit.job_id != job_id {
        return Err("commit belongs to another job".into());
    }
    Ok(())
}

impl ResultFile {
    pub fn new(job: &Job, status: Status, message: String, now_ms: u64) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            job_id: job.job_id.clone(),
            status,
            message,
            from_version: job.from_version.clone(),
            to_version: job.to_version.clone(),
            backup_app: None,
            finished_at_ms: now_ms,
        }
    }

    /// Result for a job that could not be trusted; carries no versions.
    pub fn invalid(job_dir: &Path, message: String, now_ms: u64) -> Self {
        let name = job_dir
            .file_name()
            .and_then(OsStr::to_str)
            .filter(|n| valid_job_id(n))
            .unwrap_or_default();
        Self {
            schema_version: SCHEMA_VERSION,
            job_id: name.to_string(),
            status: Status::InvalidJob,
            message,
            from_version: String::new(),
            to_version: String::new(),
            backup_app: None,
            finished_at_ms: now_ms,
        }
    }
}

/// Writes `result.json` atomically (temporary file, then rename).
pub fn write_result(job_dir: &Path, result: &ResultFile) -> io::Result<()> {
    let bytes = serde_json::to_vec(result).map_err(io::Error::other)?;
    let temporary = job_dir.join(format!("{RESULT_FILE}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, job_dir.join(RESULT_FILE))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    pub fn sample_job(parent: &Path, id: &str) -> Job {
        Job {
            schema_version: SCHEMA_VERSION,
            job_id: id.to_string(),
            parent_pid: 4242,
            target_app: parent.join("Pi-Desktop-Plus.app"),
            target_dev: "16777234".into(),
            target_ino: "98765".into(),
            staged_app: parent
                .join(format!("{STAGING_PREFIX}{id}"))
                .join("Pi-Desktop-Plus.app"),
            backup_dir: parent.join(format!("{BACKUP_PREFIX}{id}")),
            from_version: "0.15.13".into(),
            to_version: "0.15.14".into(),
        }
    }

    #[test]
    fn accepts_a_well_formed_job() {
        let job = sample_job(
            Path::new("/Applications"),
            "0f8d3a52-1c9e-4b7a-9d11-6e2f0a7c4b55",
        );
        assert_eq!(job.validate(), Ok(()));
    }

    #[test]
    fn rejects_paths_that_leave_the_prepared_layout() {
        let id = "0f8d3a52-1c9e-4b7a-9d11-6e2f0a7c4b55";
        let base = Path::new("/Applications");
        type Mutate = fn(&mut Job);
        let cases: Vec<(&str, Mutate)> = vec![
            ("relative target", |j| j.target_app = "Pi.app".into()),
            ("parent traversal", |j| {
                j.target_app = "/Applications/../tmp/Pi.app".into();
            }),
            ("target not an app", |j| {
                j.target_app = "/Applications/Pi".into()
            }),
            ("hidden dot app", |j| {
                j.target_app = "/Applications/.app".into()
            }),
            ("staged elsewhere", |j| {
                j.staged_app = "/tmp/.pi-desktop-plus-update-x/Pi.app".into();
            }),
            ("staged wrong prefix", |j| {
                j.staged_app = "/Applications/.other-0f8d3a52/Pi.app".into();
            }),
            ("staged too deep", |j| {
                j.staged_app = j.staged_app.join("Nested.app");
            }),
            ("backup elsewhere", |j| j.backup_dir = "/tmp/backup".into()),
            ("backup of another job", |j| {
                j.backup_dir = "/Applications/.pi-desktop-plus-backup-other-job-1".into();
            }),
            ("short job id", |j| j.job_id = "abc".into()),
            ("job id with slash", |j| j.job_id = "aaaa/../bbbb".into()),
            ("zero pid", |j| j.parent_pid = 0),
            ("pid beyond pid_t", |j| j.parent_pid = u32::MAX),
            ("signed inode", |j| j.target_ino = "-1".into()),
            ("empty device", |j| j.target_dev = String::new()),
            ("control characters in version", |j| {
                j.to_version = "1.0\n".into();
            }),
            ("future schema", |j| j.schema_version = 2),
        ];
        for (name, mutate) in cases {
            let mut job = sample_job(base, id);
            mutate(&mut job);
            assert!(job.validate().is_err(), "{name} must be rejected");
        }
    }

    #[test]
    fn rejects_unknown_fields_in_job_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let json = r#"{"schemaVersion":1,"jobId":"0f8d3a52-1c9e","parentPid":1,"targetApp":"/A/X.app",
            "targetDev":"1","targetIno":"2","stagedApp":"/A/.pi-desktop-plus-update-0f8d3a52-1c9e/X.app",
            "backupDir":"/A/.pi-desktop-plus-backup-0f8d3a52-1c9e","fromVersion":"1","toVersion":"2","extra":true}"#;
        fs::write(dir.path().join(JOB_FILE), json).expect("write");
        let error = load_job(dir.path()).expect_err("unknown field");
        assert!(error.contains("cannot parse"), "{error}");
    }

    #[test]
    fn trusted_file_rules_reject_symlinks_and_loose_permissions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real = dir.path().join("real.json");
        fs::write(&real, b"{}").expect("write");
        assert!(read_trusted_file(&real).is_ok());

        let link = dir.path().join("link.json");
        std::os::unix::fs::symlink(&real, &link).expect("symlink");
        assert!(read_trusted_file(&link).is_err(), "symlink");

        fs::set_permissions(&real, fs::Permissions::from_mode(0o664)).expect("chmod");
        assert!(read_trusted_file(&real).is_err(), "group writable");

        fs::set_permissions(&real, fs::Permissions::from_mode(0o600)).expect("chmod");
        fs::write(&real, vec![b' '; (MAX_FILE_BYTES + 1) as usize]).expect("write");
        assert!(read_trusted_file(&real).is_err(), "too large");
    }

    #[test]
    fn private_dir_rules() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(check_private_dir(dir.path()).is_ok());
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o777)).expect("chmod");
        assert!(check_private_dir(dir.path()).is_err());
        assert!(check_private_dir(&dir.path().join("missing")).is_err());
    }

    #[test]
    fn commit_must_name_the_same_job() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(
            dir.path().join(COMMIT_FILE),
            r#"{"schemaVersion":1,"jobId":"job-aaaa-1111"}"#,
        )
        .expect("write");
        assert!(read_commit(dir.path(), "job-aaaa-1111").is_ok());
        assert!(read_commit(dir.path(), "job-bbbb-2222").is_err());
        fs::write(
            dir.path().join(COMMIT_FILE),
            r#"{"schemaVersion":2,"jobId":"job-aaaa-1111"}"#,
        )
        .expect("write");
        assert!(read_commit(dir.path(), "job-aaaa-1111").is_err());
    }

    #[test]
    fn result_file_is_written_atomically_with_camel_case_fields() {
        let dir = tempfile::tempdir().expect("tempdir");
        let job = sample_job(
            Path::new("/Applications"),
            "0f8d3a52-1c9e-4b7a-9d11-6e2f0a7c4b55",
        );
        let mut result = ResultFile::new(&job, Status::RolledBack, "restored".into(), 7);
        result.backup_app = Some(PathBuf::from(
            "/Applications/.pi-desktop-plus-backup-x/P.app",
        ));
        write_result(dir.path(), &result).expect("write result");
        assert!(!dir.path().join("result.json.tmp").exists());
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(dir.path().join(RESULT_FILE)).expect("read"))
                .expect("json");
        assert_eq!(value["status"], "rolled_back");
        assert_eq!(value["jobId"], "0f8d3a52-1c9e-4b7a-9d11-6e2f0a7c4b55");
        assert_eq!(value["toVersion"], "0.15.14");
        assert_eq!(value["finishedAtMs"], 7);
        assert_eq!(
            value["backupApp"],
            "/Applications/.pi-desktop-plus-backup-x/P.app"
        );
    }
}
