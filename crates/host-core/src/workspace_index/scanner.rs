//! Bounded reconciliation against the current unscoped tool-visible file set.
use super::{CodeIndexMetadata, Limits};
use anyhow::{Context, Result};
use ignore::WalkBuilder;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Instant, SystemTime};

pub(super) struct IndexedFile {
    pub path: String,
    pub hash: String,
    pub body: String,
}

pub(super) struct Scan {
    pub files: Vec<IndexedFile>,
    pub file_count: usize,
    pub indexed_bytes: u64,
    pub skipped_files: usize,
    pub partial: bool,
    observed: Vec<(PathBuf, Option<(u64, SystemTime)>)>,
}

impl Scan {
    pub fn changed(&self) -> bool {
        self.observed
            .iter()
            .any(|(path, metadata)| fingerprint(path) != *metadata)
    }

    pub fn metadata(&self) -> CodeIndexMetadata {
        CodeIndexMetadata {
            file_count: self.file_count,
            indexed_bytes: self.indexed_bytes,
            skipped_files: self.skipped_files,
            status: if self.partial { "partial" } else { "fresh" }.into(),
        }
    }
}

pub(super) fn scan(root: &Path, limits: Limits, started: Instant) -> Result<Scan> {
    let mut walker = WalkBuilder::new(root);
    walker.hidden(false).git_ignore(true).follow_links(false);
    crate::tools::ignore_rules::configure_walker(&mut walker, root, false);
    let mut result = Scan {
        files: Vec::new(),
        file_count: 0,
        indexed_bytes: 0,
        skipped_files: 0,
        partial: false,
        observed: Vec::new(),
    };
    // Parent/global ignores and Git's local excludes may change the visibility
    // of files that the walk never visits. Observe them too.
    for ancestor in root.ancestors() {
        for name in [".gitignore", ".ignore"] {
            let path = ancestor.join(name);
            result.observed.push((path.clone(), fingerprint(&path)));
        }
    }
    for path in [
        Some(root.join(".pi-desktopignore")),
        Some(root.join(".git/info/exclude")),
        crate::tools::ignore_rules::user_global_ignore_file(),
    ]
    .into_iter()
    .flatten()
    {
        result.observed.push((path.clone(), fingerprint(&path)));
    }
    for entry in walker.build() {
        if started.elapsed() >= limits.duration {
            result.partial = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                result.partial = true;
                result.skipped_files += 1;
                continue;
            }
        };
        if entry.error().is_some() {
            result.partial = true;
        }
        let path = entry.path().to_path_buf();
        result.observed.push((path.clone(), fingerprint(&path)));
        // Symlinks and special files are never opened, even when their target
        // is inside the root. No directory symlink is traversed either.
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if result.file_count >= limits.files {
            result.partial = true;
            break;
        }
        result.file_count += 1;
        let relative = entry
            .path()
            .strip_prefix(root)
            .context("code index path outside root")?;
        let Some(path) = relative.to_str().map(str::to_owned) else {
            result.skipped_files += 1;
            result.partial = true;
            continue;
        };
        // Keep POSIX backslashes literal. Windows paths are serialized with
        // forward slash separators, matching the existing workspace tools.
        #[cfg(windows)]
        let path = path.replace('\\', "/");
        let body = match read_text(root, &path, limits.file_bytes) {
            Ok(Some(body)) => body,
            Ok(None) | Err(_) => {
                result.skipped_files += 1;
                result.partial = true;
                continue;
            }
        };
        let bytes = body.len() as u64;
        if result.indexed_bytes.saturating_add(bytes) > limits.total_bytes {
            result.skipped_files += 1;
            result.partial = true;
            break;
        }
        result.indexed_bytes += bytes;
        result.files.push(IndexedFile {
            path,
            hash: content_hash(&body),
            body,
        });
    }
    Ok(result)
}

fn fingerprint(path: &Path) -> Option<(u64, SystemTime)> {
    let metadata = path.symlink_metadata().ok()?;
    Some((metadata.len(), metadata.modified().ok()?))
}

pub(super) fn content_hash(body: &str) -> String {
    hex::encode(Sha256::digest(body.as_bytes()))
}

pub(super) fn read_text(root: &Path, relative: &str, max_bytes: u64) -> Result<Option<String>> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        anyhow::bail!("invalid indexed relative path");
    }
    let absolute = root.join(path);
    if crate::tools::ignore_rules::is_sensitive_path(&absolute) {
        anyhow::bail!("indexed path denied");
    }
    let mut file = open_contained(root, path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    (&mut file).take(max_bytes + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes || bytes.contains(&0) {
        return Ok(None);
    }
    Ok(String::from_utf8(bytes).ok())
}

#[cfg(unix)]
fn open_contained(root: &Path, relative: &Path) -> Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::OpenOptionsExt;
    let mut parent = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)?;
    let parts: Vec<_> = relative.components().collect();
    for (index, part) in parts.iter().enumerate() {
        let name = CString::new(part.as_os_str().as_bytes())?;
        let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
        if index + 1 != parts.len() {
            flags |= libc::O_DIRECTORY;
        }
        // SAFETY: the directory descriptor and NUL-terminated component live
        // through openat; successful descriptors are immediately owned by File.
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        // SAFETY: openat returned a new, valid, uniquely owned descriptor.
        parent = unsafe { File::from_raw_fd(fd) };
    }
    Ok(parent)
}

#[cfg(not(unix))]
fn open_contained(root: &Path, relative: &Path) -> Result<File> {
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part.as_os_str());
        if path.symlink_metadata()?.file_type().is_symlink() {
            anyhow::bail!("indexed symlink denied");
        }
    }
    if !crate::workspace::simple_canonicalize(&path)?.starts_with(root) {
        anyhow::bail!("indexed path outside root");
    }
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&path)?
    };
    #[cfg(not(windows))]
    let file = File::open(&path)?;
    if !crate::workspace::simple_canonicalize(&path)?.starts_with(root) {
        anyhow::bail!("indexed path changed outside root");
    }
    #[cfg(windows)]
    verify_windows_handle(&file, root)?;
    Ok(file)
}

/// Verify the opened object itself, rather than trusting a path that a
/// concurrent directory/junction replacement may have redirected.
#[cfg(windows)]
fn verify_windows_handle(file: &File, root: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut buffer = vec![0u16; 32_768];
    // SAFETY: the live File owns the handle and buffer exposes the given
    // writable length. Flags 0 request the normalized DOS-volume path.
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if length == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if length as usize >= buffer.len() {
        anyhow::bail!("opened index path exceeds Windows path limit");
    }
    let final_path = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
    let text = final_path.to_string_lossy();
    let final_path = match text.strip_prefix(r"\\?\") {
        Some(rest)
            if rest.len() >= 3 && rest.as_bytes()[1] == b':' && rest.as_bytes()[2] == b'\\' =>
        {
            PathBuf::from(rest)
        }
        _ => final_path,
    };
    if !final_path.starts_with(root) || crate::tools::ignore_rules::is_sensitive_path(&final_path) {
        anyhow::bail!("opened index path outside authorized root or denied");
    }
    Ok(())
}
