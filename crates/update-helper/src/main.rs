//! PI-Desktop installer helper for the assisted macOS update (PI-UPD-1109).
//!
//! Electron Main copies this binary out of the app bundle, starts it detached
//! and quits. The helper waits for Main to exit, checks Main's commit file,
//! exchanges the installed app with the staged one and relaunches. It has no
//! network, database or credential access. Design:
//! docs/adr/plus-assisted-macos-adhoc-update.md.

#[cfg(unix)]
mod install;
#[cfg(unix)]
mod job;
#[cfg(unix)]
mod platform;

#[cfg(unix)]
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let job_dir = match args.as_slice() {
        [flag, dir] if flag == "--job-dir" => std::path::PathBuf::from(dir),
        _ => {
            eprintln!("usage: pi-desktop-update-helper --job-dir <directory>");
            std::process::exit(64);
        }
    };
    let result = install::run(
        &job_dir,
        &platform::SystemPlatform,
        &install::Timing::default(),
    );
    eprintln!("update helper: {:?}: {}", result.status, result.message);
    let launched = result.status == job::Status::LaunchRequested;
    std::process::exit(if launched { 0 } else { 1 });
}

#[cfg(not(unix))]
fn main() {
    eprintln!("pi-desktop-update-helper only supports macOS");
    std::process::exit(2);
}
