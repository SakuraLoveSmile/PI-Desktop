use super::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, process::Command};

pub(crate) fn git(path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}

pub(crate) struct Fixture {
    pub dir: tempfile::TempDir,
    pub repository: PathBuf,
    pub slot: PathBuf,
    pub projection: PathBuf,
    pub data: Value,
}
impl Fixture {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let repository = base.join("repository");
        std::fs::create_dir(&repository).unwrap();
        git(&repository, &["init", "-q"]);
        git(
            &repository,
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
        let common = repository.join(".git");
        let key =
            hex::encode(Sha256::digest(common.to_str().unwrap().as_bytes()))[..16].to_string();
        let pool = base.join("worktrees");
        let slot = pool.join("pool").join(&key).join("slot-1");
        git(
            &repository,
            &["worktree", "add", "--detach", "-q", slot.to_str().unwrap()],
        );
        let projection = base.join("projection.json");
        let data = json!({ "schema_version": 1, "updated_at": "2026-10-16T00:00:00Z", "worktrees_root":pool,
            "slots": [{"slot_id":"fixture-one", "path":slot, "repository":repository, "git_common_dir":common, "repo_key":key, "state":"leased"}] });
        let result = Self {
            dir,
            repository,
            slot,
            projection,
            data,
        };
        result.save();
        result
    }
    pub fn save(&self) {
        std::fs::write(&self.projection, serde_json::to_vec(&self.data).unwrap()).unwrap();
    }
    pub async fn resolve(&self) -> MemoryOwner {
        TEST_PROJECTION
            .scope(
                self.projection.clone(),
                resolve(self.slot.to_str().unwrap()),
            )
            .await
    }
}

#[tokio::test]
async fn project_memory_owner_real_detached_slots_resolve_only_memory() {
    let mut f = Fixture::new();
    let owner = f.resolve().await;
    assert!(owner.is_alias);
    assert_eq!(owner.owner_path, f.repository.to_str().unwrap());
    assert_eq!(owner.requested_path, f.slot.to_str().unwrap());
    let second = f.slot.parent().unwrap().join("slot-2");
    git(
        &f.repository,
        &[
            "worktree",
            "add",
            "--detach",
            "-q",
            second.to_str().unwrap(),
        ],
    );
    let mut entry = f.data["slots"][0].clone();
    entry["slot_id"] = json!("fixture-two");
    entry["path"] = json!(second);
    f.data["slots"].as_array_mut().unwrap().push(entry);
    f.save();
    assert!(
        TEST_PROJECTION
            .scope(f.projection.clone(), resolve(second.to_str().unwrap()))
            .await
            .is_alias
    );
    let nested = f.slot.join("nested");
    std::fs::create_dir(&nested).unwrap();
    assert!(
        !TEST_PROJECTION
            .scope(f.projection.clone(), resolve(nested.to_str().unwrap()))
            .await
            .is_alias
    );
}

#[tokio::test]
async fn project_memory_owner_rejects_untrusted_and_stale_projection() {
    let mut f = Fixture::new();
    for (field, value) in [
        ("schema_version", json!(2)),
        ("worktrees_root", json!("relative")),
    ] {
        let original = f.data.clone();
        f.data[field] = value;
        f.save();
        assert!(!f.resolve().await.is_alias);
        f.data = original;
    }
    for (field, value) in [
        ("repository", json!(f.slot)),
        ("git_common_dir", json!(f.dir.path())),
        ("repo_key", json!("bad")),
        ("path", json!(format!("{}/../slot-1", f.slot.display()))),
    ] {
        let original = f.data.clone();
        f.data["slots"][0][field] = value;
        f.save();
        assert!(!f.resolve().await.is_alias, "{field}");
        f.data = original;
    }
    let original = f.data.clone();
    let entry = f.data["slots"][0].clone();
    f.data["slots"].as_array_mut().unwrap().push(entry);
    f.save();
    assert!(!f.resolve().await.is_alias);
    f.data = original;
    f.save();
    git(&f.slot, &["switch", "-c", "not-detached"]);
    assert!(!f.resolve().await.is_alias);
    git(&f.slot, &["checkout", "--detach", "-q"]);
    git(
        &f.repository,
        &["worktree", "remove", f.slot.to_str().unwrap()],
    );
    assert!(!f.resolve().await.is_alias);
}

#[cfg(unix)]
#[tokio::test]
async fn project_memory_owner_rejects_symlinks_inside_pool_but_accepts_system_aliases() {
    let mut f = Fixture::new();
    let actual = f.slot.parent().unwrap().join("actual");
    std::fs::rename(&f.slot, &actual).unwrap();
    std::os::unix::fs::symlink(&actual, &f.slot).unwrap();
    assert!(!f.resolve().await.is_alias);
    std::fs::remove_file(&f.slot).unwrap();
    std::fs::rename(actual, &f.slot).unwrap();
    if cfg!(target_os = "macos") {
        let slot = f
            .slot
            .to_str()
            .unwrap()
            .replacen("/private/var/", "/var/", 1);
        f.data["slots"][0]["path"] = json!(slot);
        f.save();
        assert!(
            TEST_PROJECTION
                .scope(f.projection.clone(), resolve(&slot))
                .await
                .is_alias
        );
    }
}

#[tokio::test]
async fn project_memory_owner_rejects_cross_repository_duplicate_ids_and_prefixes() {
    let mut f = Fixture::new();
    let other = Fixture::new();
    let original = f.data.clone();
    f.data["slots"][0]["repository"] = json!(other.repository);
    f.save();
    assert!(!f.resolve().await.is_alias);
    f.data = original.clone();
    let mut duplicate = f.data["slots"][0].clone();
    duplicate["path"] = json!(f.slot.parent().unwrap().join("slot-2"));
    f.data["slots"].as_array_mut().unwrap().push(duplicate);
    f.save();
    assert!(!f.resolve().await.is_alias);
    f.data = original.clone();
    let mut duplicate = f.data["slots"][0].clone();
    duplicate["slot_id"] = json!("different-id");
    f.data["slots"].as_array_mut().unwrap().push(duplicate);
    f.save();
    assert!(!f.resolve().await.is_alias);
    f.data = original.clone();
    f.data["worktrees_root"] = json!(f.slot.parent().unwrap());
    f.save();
    assert!(!f.resolve().await.is_alias);
    f.data = original;
    f.data["slots"][0]["state"] = json!("quarantined");
    f.save();
    assert!(
        f.resolve().await.is_alias,
        "state must not confer or remove memory authority"
    );
}

#[tokio::test]
async fn project_memory_owner_missing_oversized_and_too_many_slots_fail_closed() {
    let mut f = Fixture::new();
    std::fs::remove_file(&f.projection).unwrap();
    assert!(!f.resolve().await.is_alias);
    std::fs::write(&f.projection, vec![b' '; (MAX_BYTES + 1) as usize]).unwrap();
    assert!(!f.resolve().await.is_alias);
    let entry = json!({"slot_id":"i","path":"/s","repository":"/r","git_common_dir":"/g","repo_key":"k","state":"free"});
    f.data["slots"] = json!(vec![entry; MAX_SLOTS + 1]);
    f.save();
    assert!(!f.resolve().await.is_alias);
}

#[tokio::test]
async fn project_memory_owner_rejects_detached_registry_with_attached_actual_head() {
    let f = Fixture::new();
    let attached = f.dir.path().join("attached");
    git(
        &f.repository,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "attached",
            attached.to_str().unwrap(),
        ],
    );
    let original = std::fs::read(f.slot.join(".git")).unwrap();
    std::fs::copy(attached.join(".git"), f.slot.join(".git")).unwrap();
    assert!(
        !f.resolve().await.is_alias,
        "registry detached flag cannot replace the actual HEAD check"
    );
    std::fs::write(f.slot.join(".git"), original).unwrap();
}
