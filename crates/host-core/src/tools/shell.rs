//! Cross-platform shell resolution for the Bash tool.
//!
//! Agent-generated commands are POSIX-flavored, so every platform runs them
//! through bash (D084). The binary is resolved once per process:
//!
//! 1. `PI_DESKTOP_BASH` env override (path to a bash executable)
//! 2. Unix: well-known locations, then a PATH scan
//! 3. Windows: `bash.exe` shipped with Git for Windows (derived from the
//!    `git` on PATH, then standard install dirs), then a PATH scan that
//!    skips the WSL launcher in System32

use std::env;
#[cfg(windows)]
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::Stdio;
use std::sync::OnceLock;
#[cfg(unix)]
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ShellSpec {
    pub program: PathBuf,
    pub args: &'static [&'static str],
}

// Login shell keeps profile-derived PATH (Homebrew, nvm) when the app is
// launched from Finder/Dock with the minimal GUI environment.
#[cfg(unix)]
const SHELL_ARGS: &[&str] = &["-lc"];

// No login shell on Windows: Git Bash profiles are slow to source and the
// host controls the environment explicitly.
#[cfg(windows)]
const SHELL_ARGS: &[&str] = &["-c"];

pub const SHELL_MISSING_GUIDANCE: &str = "bash not found. Install Git for Windows \
(https://gitforwindows.org) or set PI_DESKTOP_BASH to a bash executable.";

/// Resolve the bash binary once per process. Errors are cached too: a broken
/// override or missing install fails fast on every call with the same message.
pub fn resolve_shell() -> Result<&'static ShellSpec, String> {
    static CACHE: OnceLock<Result<ShellSpec, String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            find_bash().map(|program| ShellSpec {
                program,
                args: SHELL_ARGS,
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn find_bash() -> Result<PathBuf, String> {
    if let Some(overridden) = env::var_os("PI_DESKTOP_BASH") {
        let path = PathBuf::from(&overridden);
        if is_executable(&path) {
            return Ok(path);
        }
        return Err(format!(
            "PI_DESKTOP_BASH points to '{}', which is not an executable file",
            path.display()
        ));
    }
    platform_bash().ok_or_else(|| SHELL_MISSING_GUIDANCE.to_string())
}

#[cfg(unix)]
fn platform_bash() -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &[
        "/bin/bash",
        "/usr/bin/bash",
        "/usr/local/bin/bash",
        "/opt/homebrew/bin/bash",
    ];
    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| is_executable(p))
        .or_else(|| search_path("bash", |_| true))
}

#[cfg(windows)]
fn platform_bash() -> Option<PathBuf> {
    // Preferred: the bash bundled with Git for Windows, located relative to
    // whichever git.exe is on PATH (<root>\cmd\git.exe or <root>\bin\git.exe).
    if let Some(git) = search_path("git.exe", |_| true) {
        if let Some(root) = git.parent().and_then(Path::parent) {
            for rel in ["bin\\bash.exe", "usr\\bin\\bash.exe"] {
                let candidate = root.join(rel);
                if is_executable(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }
    // Standard Git for Windows install dirs, in case git is not on PATH.
    for base in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Some(dir) = env::var_os(base) {
            let mut root = PathBuf::from(dir);
            if base == "LocalAppData" {
                root.push("Programs");
            }
            let candidate = root.join("Git").join("bin").join("bash.exe");
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    // Last resort: any bash.exe on PATH except the WSL launcher in System32,
    // which is a different execution environment, not a Win32 bash.
    search_path("bash.exe", |p| {
        !p.components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("System32"))
    })
}

/// Best-effort PATH exported by the user's own login shell, so the Bash tool
/// resolves the same toolchain a fresh terminal would (nvm, Homebrew, conda,
/// ...). The app may be launched from Finder/Dock with a minimal GUI
/// environment, and `bash -lc` alone only sources the *bash* profile — on
/// macOS the default shell is zsh, whose `.zshrc`/`.zprofile` (where nvm and
/// friends usually live) bash never reads. Probed once per process and cached;
/// returns `None` when no login shell can be probed, so callers fall back to
/// the host environment unchanged.
#[cfg(unix)]
pub fn user_login_path() -> Option<&'static str> {
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE.get_or_init(probe_user_login_path).as_deref()
}

#[cfg(unix)]
fn probe_user_login_path() -> Option<String> {
    let shell = env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|p| is_executable(p))
        .or_else(|| {
            ["/bin/zsh", "/bin/bash", "/bin/sh"]
                .iter()
                .map(PathBuf::from)
                .find(|p| is_executable(p))
        })?;
    // `-l` sources login files (.zprofile / .bash_profile), `-i` sources the
    // interactive rc (.zshrc / .bashrc): together they reproduce a terminal's
    // PATH. stderr is discarded — shells complain about the missing tty/job
    // control — and only the last stdout line is taken, so rc banners cannot
    // contaminate the result.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let output = std::process::Command::new(&shell)
            .args(["-lic", "printf %s \"$PATH\""])
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(output);
    });
    // A wedged rc (waiting on input/network) must not stall the first Bash
    // call; probing is best-effort and the host PATH remains the fallback.
    let output = rx.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let path = stdout.lines().next_back().unwrap_or_default().trim();
    (!path.is_empty()).then(|| path.to_string())
}

fn search_path(name: &str, accept: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    env::split_paths(&path_var)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(name))
        .find(|p| is_executable(p) && accept(p))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && std::fs::metadata(path)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(OsStr::new("exe")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_real_bash() {
        let shell = resolve_shell().expect("bash must resolve on CI/dev machines");
        assert!(shell.program.is_absolute(), "resolved path is absolute");
        assert!(is_executable(&shell.program));
        assert!(shell.args.contains(&"-c") || shell.args.contains(&"-lc"));
    }

    #[test]
    fn search_path_skips_rejected_candidates() {
        // With a reject-all filter nothing can match, proving the filter runs.
        assert!(search_path("bash", |_| false).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn user_login_path_probes_a_real_path() {
        // On any machine with a login shell the probe yields a non-empty
        // PATH of absolute directories; when no shell can be probed the
        // function must degrade to None rather than panic.
        if let Some(path) = user_login_path() {
            assert!(!path.is_empty(), "probed PATH is non-empty");
            assert!(path.starts_with('/'), "PATH entries stay absolute");
            assert!(path.contains('/'), "PATH looks like directories");
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_executable_file_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("not-a-shell");
        std::fs::write(&plain, "text").unwrap();
        assert!(!is_executable(&plain));
    }
}
