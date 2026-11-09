//! The install sequence: wait for the application to exit, check its commit,
//! exchange the installed app with the staged one, relaunch, and roll back if
//! the relaunch fails. Every step that can fail maps to one result status; the
//! installed app is only touched by the single atomic exchange.

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::job::{self, Job, ResultFile, Status};
use crate::platform::{acquire_lock, Platform};

const LOCK_FILE: &str = ".update.lock";

pub struct Timing {
    pub poll: Duration,
    /// How many polls to wait for the application to exit.
    pub parent_exit_polls: u32,
    /// How many polls to wait for leftover processes of the bundle to exit.
    pub idle_polls: u32,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            poll: Duration::from_millis(250),
            parent_exit_polls: 480, // two minutes
            idle_polls: 60,         // fifteen seconds
        }
    }
}

struct Outcome {
    status: Status,
    message: String,
    backup_app: Option<PathBuf>,
}

impl Outcome {
    fn new(status: Status, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            backup_app: None,
        }
    }

    fn with_backup(mut self, backup_app: &Path) -> Self {
        self.backup_app = Some(backup_app.to_path_buf());
        self
    }
}

/// Runs the whole job and records the outcome in `result.json`.
pub fn run(job_dir: &Path, platform: &dyn Platform, timing: &Timing) -> ResultFile {
    if let Err(message) = job::check_private_dir(job_dir) {
        // The directory itself cannot be trusted, so nothing is written to it.
        return ResultFile::invalid(job_dir, message, platform.now_ms());
    }
    let result = match job::load_job(job_dir) {
        Ok(job) => {
            let outcome = execute(&job, job_dir, platform, timing);
            let mut result =
                ResultFile::new(&job, outcome.status, outcome.message, platform.now_ms());
            result.backup_app = outcome.backup_app;
            result
        }
        Err(message) => ResultFile::invalid(job_dir, message, platform.now_ms()),
    };
    if let Err(error) = job::write_result(job_dir, &result) {
        eprintln!("update helper: cannot write {}: {error}", job::RESULT_FILE);
    }
    result
}

fn execute(job: &Job, job_dir: &Path, p: &dyn Platform, t: &Timing) -> Outcome {
    if !wait_for_exit(job.parent_pid, p, t) {
        return Outcome::new(
            Status::ParentStillRunning,
            format!(
                "the application (pid {}) did not exit; nothing was changed",
                job.parent_pid
            ),
        );
    }
    if let Err(message) = job::read_commit(job_dir, &job.job_id) {
        return Outcome::new(
            Status::NotCommitted,
            format!("the application did not commit this update: {message}"),
        );
    }
    let lock_path = job_dir.parent().unwrap_or(job_dir).join(LOCK_FILE);
    let _lock = match acquire_lock(&lock_path) {
        Ok(Some(file)) => file,
        Ok(None) => {
            return Outcome::new(
                Status::Locked,
                "another update helper holds the update lock",
            );
        }
        Err(error) => {
            return Outcome::new(
                Status::Locked,
                format!("cannot take the update lock: {error}"),
            );
        }
    };
    if let Err(message) = check_target(job) {
        let note = reopen_note(job, p, true);
        return Outcome::new(Status::TargetChanged, format!("{message}{note}"));
    }
    if let Err(message) = wait_for_idle(job, p, t) {
        let note = reopen_note(job, p, false);
        return Outcome::new(Status::BundleInUse, format!("{message}{note}"));
    }
    if let Err(message) = check_staged(job, p) {
        let note = reopen_note(job, p, false);
        return Outcome::new(Status::StagedInvalid, format!("{message}{note}"));
    }
    if let Err(error) = p.exchange(&job.staged_app, &job.target_app) {
        let note = reopen_note(job, p, false);
        return Outcome::new(
            Status::SwapFailed,
            format!("cannot exchange the installed app with the staged app: {error}{note}"),
        );
    }
    let backup_app = move_to_backup(job);
    match p.launch(&job.target_app) {
        Ok(()) => Outcome::new(
            Status::LaunchRequested,
            format!("installed {} and requested a launch", job.to_version),
        )
        .with_backup(&backup_app),
        Err(error) => roll_back(job, p, &backup_app, &error.to_string()),
    }
}

fn wait_for_exit(pid: u32, p: &dyn Platform, t: &Timing) -> bool {
    for poll in 0..=t.parent_exit_polls {
        if !p.process_alive(pid) {
            return true;
        }
        if poll < t.parent_exit_polls {
            p.sleep(t.poll);
        }
    }
    false
}

/// The installed app must be the directory the job was prepared for.
fn check_target(job: &Job) -> Result<(), String> {
    let meta = fs::symlink_metadata(&job.target_app)
        .map_err(|e| format!("the installed app is not readable: {e}"))?;
    if !meta.is_dir() {
        return Err("the installed app is not a directory".into());
    }
    if meta.dev().to_string() != job.target_dev || meta.ino().to_string() != job.target_ino {
        return Err("the installed app was replaced after the update was prepared".into());
    }
    Ok(())
}

/// Nothing may still run from the bundle that is about to be exchanged.
fn wait_for_idle(job: &Job, p: &dyn Platform, t: &Timing) -> Result<(), String> {
    let mut last = String::new();
    for poll in 0..=t.idle_polls {
        match p.processes_in_bundle(&job.target_app) {
            Ok(pids) if pids.is_empty() => return Ok(()),
            Ok(pids) => {
                last = format!(
                    "{} process(es) still run from the installed app (for example pid {})",
                    pids.len(),
                    pids[0]
                );
            }
            Err(error) => last = format!("cannot inspect running processes: {error}"),
        }
        if poll < t.idle_polls {
            p.sleep(t.poll);
        }
    }
    Err(last)
}

fn check_staged(job: &Job, p: &dyn Platform) -> Result<(), String> {
    let meta = fs::symlink_metadata(&job.staged_app)
        .map_err(|e| format!("the staged app is not readable: {e}"))?;
    if !meta.is_dir() {
        return Err("the staged app is not a directory".into());
    }
    if meta.uid() != job::effective_uid() {
        return Err("the staged app is owned by another user".into());
    }
    match p.has_quarantine(&job.staged_app) {
        Ok(false) => {}
        Ok(true) => return Err("the staged app carries com.apple.quarantine".into()),
        Err(error) => return Err(format!("cannot read the staged app's attributes: {error}")),
    }
    p.verify_signature(&job.staged_app)
        .map_err(|e| format!("the staged app failed verification: {e}"))
}

/// After the exchange the staging directory holds the previous app; it
/// becomes the backup. Returns where the previous app now is.
fn move_to_backup(job: &Job) -> PathBuf {
    match fs::rename(job.staging_dir(), &job.backup_dir) {
        Ok(()) => job.backup_dir.join(job.staged_name()),
        Err(_) => job.staged_app.clone(),
    }
}

fn roll_back(job: &Job, p: &dyn Platform, backup_app: &Path, launch_error: &str) -> Outcome {
    match p.processes_in_bundle(&job.target_app) {
        Ok(pids) if !pids.is_empty() => {
            return Outcome::new(
                Status::LaunchRequested,
                format!("open reported an error ({launch_error}) but the new app is running; it was kept"),
            )
            .with_backup(backup_app);
        }
        Ok(_) => {}
        Err(error) => {
            return Outcome::new(
                Status::RollbackFailed,
                format!(
                    "the new app did not launch ({launch_error}) and its state is unknown ({error}); the previous app is kept at {}",
                    backup_app.display()
                ),
            )
            .with_backup(backup_app);
        }
    }
    match p.exchange(backup_app, &job.target_app) {
        Ok(()) => {
            let note = reopen_note(job, p, false);
            Outcome::new(
                Status::RolledBack,
                format!("the new app did not launch ({launch_error}); the previous app was restored{note}"),
            )
        }
        Err(error) => Outcome::new(
            Status::RollbackFailed,
            format!(
                "the new app did not launch ({launch_error}) and the previous app could not be restored ({error}); it is kept at {}",
                backup_app.display()
            ),
        )
        .with_backup(backup_app),
    }
}

/// The application quit for this update, so a refused update reopens the app
/// that is installed. Returns a suffix for the result message.
fn reopen_note(job: &Job, p: &dyn Platform, only_if_present: bool) -> String {
    if only_if_present && fs::symlink_metadata(&job.target_app).is_err() {
        return "; the installed app no longer exists".into();
    }
    match p.launch(&job.target_app) {
        Ok(()) => "; the installed app was reopened".into(),
        Err(error) => format!("; reopening the installed app failed: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::tests::sample_job;
    use crate::job::{COMMIT_FILE, JOB_FILE, RESULT_FILE};
    use serde_json::json;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    use std::io;
    use std::os::unix::fs::PermissionsExt;

    const ID: &str = "0f8d3a52-1c9e-4b7a-9d11-6e2f0a7c4b55";

    struct State {
        alive_for: u32,
        sleeps: u32,
        scans: VecDeque<Result<Vec<u32>, String>>,
        scan_default: Vec<u32>,
        quarantine: bool,
        signature: Result<(), String>,
        exchange_failures: u32,
        launch_results: VecDeque<Result<(), String>>,
        launched: Vec<PathBuf>,
    }

    struct Fake(RefCell<State>);

    impl Fake {
        fn new() -> Self {
            Self(RefCell::new(State {
                alive_for: 0,
                sleeps: 0,
                scans: VecDeque::new(),
                scan_default: Vec::new(),
                quarantine: false,
                signature: Ok(()),
                exchange_failures: 0,
                launch_results: VecDeque::new(),
                launched: Vec::new(),
            }))
        }

        fn set(&self, change: impl FnOnce(&mut State)) {
            change(&mut self.0.borrow_mut());
        }

        fn launched(&self) -> Vec<PathBuf> {
            self.0.borrow().launched.clone()
        }
    }

    impl Platform for Fake {
        fn process_alive(&self, _pid: u32) -> bool {
            let mut state = self.0.borrow_mut();
            if state.alive_for > 0 {
                state.alive_for -= 1;
                return true;
            }
            false
        }

        fn exchange(&self, a: &Path, b: &Path) -> io::Result<()> {
            let mut state = self.0.borrow_mut();
            if state.exchange_failures > 0 {
                state.exchange_failures -= 1;
                return Err(io::Error::other("exchange refused"));
            }
            let spare = a.with_extension("swap-spare");
            fs::rename(a, &spare)?;
            fs::rename(b, a)?;
            fs::rename(&spare, b)
        }

        fn processes_in_bundle(&self, _bundle: &Path) -> io::Result<Vec<u32>> {
            let mut state = self.0.borrow_mut();
            match state.scans.pop_front() {
                Some(scripted) => scripted.map_err(io::Error::other),
                None => Ok(state.scan_default.clone()),
            }
        }

        fn has_quarantine(&self, _path: &Path) -> io::Result<bool> {
            Ok(self.0.borrow().quarantine)
        }

        fn verify_signature(&self, _app: &Path) -> Result<(), String> {
            self.0.borrow().signature.clone()
        }

        fn launch(&self, app: &Path) -> io::Result<()> {
            let mut state = self.0.borrow_mut();
            state.launched.push(app.to_path_buf());
            match state.launch_results.pop_front() {
                Some(result) => result.map_err(io::Error::other),
                None => Ok(()),
            }
        }

        fn sleep(&self, _duration: Duration) {
            self.0.borrow_mut().sleeps += 1;
        }

        fn now_ms(&self) -> u64 {
            1_000
        }
    }

    struct Fixture {
        _root: tempfile::TempDir,
        job_dir: PathBuf,
        job: Job,
    }

    fn make_app(path: &Path, marker: &str) {
        fs::create_dir_all(path.join("Contents")).expect("app dirs");
        fs::write(path.join("Contents/marker"), marker).expect("marker");
    }

    fn marker(path: &Path) -> String {
        fs::read_to_string(path.join("Contents/marker")).unwrap_or_else(|e| format!("<{e}>"))
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("tempdir");
            let apps = root.path().join("apps");
            let jobs = root.path().join("jobs");
            fs::create_dir(&apps).expect("apps");
            fs::create_dir(&jobs).expect("jobs");
            let mut job = sample_job(&apps, ID);
            make_app(&job.target_app, "old");
            make_app(&job.staged_app, "new");
            let meta = fs::metadata(&job.target_app).expect("target meta");
            job.target_dev = meta.dev().to_string();
            job.target_ino = meta.ino().to_string();
            let job_dir = jobs.join(ID);
            fs::create_dir(&job_dir).expect("job dir");
            let fixture = Self {
                _root: root,
                job_dir,
                job,
            };
            fixture.write_job();
            fixture.commit();
            fixture
        }

        fn write_job(&self) {
            let job = &self.job;
            let value = json!({
                "schemaVersion": job.schema_version,
                "jobId": job.job_id,
                "parentPid": job.parent_pid,
                "targetApp": job.target_app,
                "targetDev": job.target_dev,
                "targetIno": job.target_ino,
                "stagedApp": job.staged_app,
                "backupDir": job.backup_dir,
                "fromVersion": job.from_version,
                "toVersion": job.to_version,
            });
            fs::write(self.job_dir.join(JOB_FILE), value.to_string()).expect("job file");
        }

        fn commit(&self) {
            let value = json!({ "schemaVersion": 1, "jobId": ID });
            fs::write(self.job_dir.join(COMMIT_FILE), value.to_string()).expect("commit");
        }

        fn run(&self, fake: &Fake) -> ResultFile {
            let timing = Timing {
                poll: Duration::from_millis(1),
                parent_exit_polls: 5,
                idle_polls: 3,
            };
            run(&self.job_dir, fake, &timing)
        }

        fn target(&self) -> &Path {
            &self.job.target_app
        }

        fn written_status(&self) -> String {
            let bytes = fs::read(self.job_dir.join(RESULT_FILE)).expect("result.json");
            let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
            value["status"].as_str().unwrap_or_default().to_string()
        }
    }

    #[test]
    fn exchanges_keeps_the_previous_app_and_launches_the_new_one() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::LaunchRequested, "{}", result.message);
        assert_eq!(marker(fixture.target()), "new");
        let backup = result.backup_app.expect("backup path");
        assert_eq!(backup, fixture.job.backup_dir.join("Pi-Desktop-Plus.app"));
        assert_eq!(marker(&backup), "old");
        assert!(
            !fixture.job.staging_dir().exists(),
            "staging directory moved"
        );
        assert_eq!(fake.launched(), vec![fixture.target().to_path_buf()]);
        assert_eq!(fixture.written_status(), "launch_requested");
    }

    #[test]
    fn waits_for_the_application_to_exit_before_touching_anything() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.alive_for = 3);
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::LaunchRequested, "{}", result.message);
        assert_eq!(fake.0.borrow().sleeps, 3);
    }

    #[test]
    fn leaves_everything_alone_when_the_application_never_exits() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.alive_for = u32::MAX);
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::ParentStillRunning);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(marker(&fixture.job.staged_app), "new");
        assert!(fake.launched().is_empty(), "the app is still running");
    }

    #[test]
    fn does_nothing_without_a_commit_for_this_job() {
        let fixture = Fixture::new();
        fs::remove_file(fixture.job_dir.join(COMMIT_FILE)).expect("remove commit");
        let fake = Fake::new();
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::NotCommitted);
        assert_eq!(marker(fixture.target()), "old");
        assert!(fake.launched().is_empty());

        let other = json!({ "schemaVersion": 1, "jobId": "another-job-9999" });
        fs::write(fixture.job_dir.join(COMMIT_FILE), other.to_string()).expect("other commit");
        assert_eq!(fixture.run(&Fake::new()).status, Status::NotCommitted);
        assert_eq!(marker(fixture.target()), "old");
    }

    #[test]
    fn refuses_while_another_helper_holds_the_lock() {
        let fixture = Fixture::new();
        let lock_path = fixture.job_dir.parent().expect("jobs dir").join(LOCK_FILE);
        let _held = acquire_lock(&lock_path).expect("lock").expect("free");
        let fake = Fake::new();
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::Locked);
        assert_eq!(marker(fixture.target()), "old");
        assert!(fake.launched().is_empty());
    }

    #[test]
    fn refuses_an_installed_app_that_was_replaced_and_reopens_it() {
        let mut fixture = Fixture::new();
        fixture.job.target_ino = "1".into();
        fixture.write_job();
        let fake = Fake::new();
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::TargetChanged);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(marker(&fixture.job.staged_app), "new");
        assert_eq!(fake.launched(), vec![fixture.target().to_path_buf()]);
    }

    #[test]
    fn waits_for_leftover_processes_of_the_bundle_to_exit() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| {
            s.scans = VecDeque::from([Ok(vec![31]), Ok(vec![31]), Ok(Vec::new())]);
        });
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::LaunchRequested, "{}", result.message);
        assert_eq!(marker(fixture.target()), "new");
    }

    #[test]
    fn reopens_the_old_app_when_processes_keep_running_from_the_bundle() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.scan_default = vec![31, 32]);
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::BundleInUse);
        assert!(result.message.contains("pid 31"), "{}", result.message);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(marker(&fixture.job.staged_app), "new");
        assert_eq!(fake.launched(), vec![fixture.target().to_path_buf()]);
    }

    #[test]
    fn fails_closed_when_the_process_table_cannot_be_read() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| {
            s.scans = VecDeque::from(vec![Err("no access".to_string()); 4]);
        });
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::BundleInUse);
        assert_eq!(marker(fixture.target()), "old");
    }

    #[test]
    fn refuses_a_quarantined_staged_app() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.quarantine = true);
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::StagedInvalid);
        assert!(result.message.contains("quarantine"), "{}", result.message);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(fake.launched(), vec![fixture.target().to_path_buf()]);
    }

    #[test]
    fn refuses_a_staged_app_that_fails_verification() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.signature = Err("a sealed resource is missing".into()));
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::StagedInvalid);
        assert_eq!(marker(fixture.target()), "old");
    }

    #[test]
    fn refuses_a_staged_app_that_is_a_symlink() {
        let fixture = Fixture::new();
        let elsewhere = fixture.job.staging_dir().join("Real.app");
        fs::rename(&fixture.job.staged_app, &elsewhere).expect("move staged");
        std::os::unix::fs::symlink(&elsewhere, &fixture.job.staged_app).expect("symlink");
        let result = fixture.run(&Fake::new());
        assert_eq!(result.status, Status::StagedInvalid);
        assert_eq!(marker(fixture.target()), "old");
    }

    #[test]
    fn reopens_the_old_app_when_the_exchange_fails() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.exchange_failures = 1);
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::SwapFailed);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(marker(&fixture.job.staged_app), "new");
        assert_eq!(fake.launched(), vec![fixture.target().to_path_buf()]);
    }

    #[test]
    fn restores_the_previous_app_when_the_launch_fails() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.launch_results = VecDeque::from([Err("launch refused".to_string())]));
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::RolledBack, "{}", result.message);
        assert_eq!(marker(fixture.target()), "old");
        assert_eq!(
            marker(&fixture.job.backup_dir.join("Pi-Desktop-Plus.app")),
            "new",
            "the failed copy is left in the backup directory for Main to clean"
        );
        assert!(result.backup_app.is_none());
        assert_eq!(
            fake.launched().len(),
            2,
            "new app first, then the restored app"
        );
    }

    #[test]
    fn keeps_the_new_app_when_open_failed_but_it_is_running() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| {
            s.launch_results = VecDeque::from([Err("open exited with 1".to_string())]);
            s.scans = VecDeque::from([Ok(Vec::new()), Ok(vec![77])]);
        });
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::LaunchRequested, "{}", result.message);
        assert_eq!(marker(fixture.target()), "new");
        assert!(result.backup_app.is_some());
        assert_eq!(fake.launched().len(), 1);
    }

    #[test]
    fn keeps_the_backup_when_the_rollback_itself_fails() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| s.launch_results = VecDeque::from([Err("launch refused".to_string())]));
        // The first exchange succeeds; the rollback exchange is refused.
        let wrapper = RefuseSecondExchange {
            inner: &fake,
            calls: RefCell::new(0),
        };
        let timing = Timing {
            poll: Duration::from_millis(1),
            parent_exit_polls: 5,
            idle_polls: 3,
        };
        let result = run(&fixture.job_dir, &wrapper, &timing);
        assert_eq!(result.status, Status::RollbackFailed, "{}", result.message);
        assert_eq!(marker(fixture.target()), "new");
        let backup = result.backup_app.expect("backup path");
        assert_eq!(marker(&backup), "old");
    }

    #[test]
    fn does_not_roll_back_when_the_process_table_is_unreadable_after_a_failed_launch() {
        let fixture = Fixture::new();
        let fake = Fake::new();
        fake.set(|s| {
            s.launch_results = VecDeque::from([Err("launch refused".to_string())]);
            s.scans = VecDeque::from([Ok(Vec::new()), Err("no access".to_string())]);
        });
        let result = fixture.run(&fake);
        assert_eq!(result.status, Status::RollbackFailed);
        assert_eq!(marker(fixture.target()), "new");
        assert!(result.backup_app.is_some());
    }

    #[test]
    fn untrusted_job_directories_and_files_are_invalid_jobs() {
        let fixture = Fixture::new();
        fs::set_permissions(&fixture.job_dir, fs::Permissions::from_mode(0o777)).expect("chmod");
        let result = fixture.run(&Fake::new());
        assert_eq!(result.status, Status::InvalidJob);
        assert!(
            !fixture.job_dir.join(RESULT_FILE).exists(),
            "nothing written into an untrusted directory"
        );
        assert_eq!(marker(fixture.target()), "old");

        fs::set_permissions(&fixture.job_dir, fs::Permissions::from_mode(0o700)).expect("chmod");
        fs::write(fixture.job_dir.join(JOB_FILE), "not json").expect("corrupt");
        let result = fixture.run(&Fake::new());
        assert_eq!(result.status, Status::InvalidJob);
        assert_eq!(fixture.written_status(), "invalid_job");
        assert_eq!(result.job_id, ID);
        assert_eq!(marker(fixture.target()), "old");
    }

    /// Delegates to `Fake` but refuses the second exchange (the rollback).
    struct RefuseSecondExchange<'a> {
        inner: &'a Fake,
        calls: RefCell<u32>,
    }

    impl Platform for RefuseSecondExchange<'_> {
        fn process_alive(&self, pid: u32) -> bool {
            self.inner.process_alive(pid)
        }

        fn exchange(&self, a: &Path, b: &Path) -> io::Result<()> {
            let mut calls = self.calls.borrow_mut();
            *calls += 1;
            if *calls >= 2 {
                return Err(io::Error::other("rollback refused"));
            }
            self.inner.exchange(a, b)
        }

        fn processes_in_bundle(&self, bundle: &Path) -> io::Result<Vec<u32>> {
            self.inner.processes_in_bundle(bundle)
        }

        fn has_quarantine(&self, path: &Path) -> io::Result<bool> {
            self.inner.has_quarantine(path)
        }

        fn verify_signature(&self, app: &Path) -> Result<(), String> {
            self.inner.verify_signature(app)
        }

        fn launch(&self, app: &Path) -> io::Result<()> {
            self.inner.launch(app)
        }

        fn sleep(&self, duration: Duration) {
            self.inner.sleep(duration);
        }

        fn now_ms(&self) -> u64 {
            self.inner.now_ms()
        }
    }
}
