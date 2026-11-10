# PI-UPD-1110: Keep an orphaned crash reporter from blocking assisted updates

- Project: `fork-pi-desktop`; task ID: `PI-UPD-1110`; tier: T1; status: 实现中
  (fix prepared; release not authorized yet).
- Created: 2026-11-10 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Authorization: the user reported "重启更新失败…一直是 0.15.14 没办法更新到
  0.15.15" on 2026-11-10 and asked for a fix. That authorizes this branch, its
  commit, push and PR. Merge, a 0.15.16 release and installation need the
  user's explicit word.
- Baseline: `be591a4b62cf06180301043454581a2831380784` (`v0.15.15` release
  commit).
- Branch: `fix/20261110-PI-UPD-1110-assisted-idle-crashpad`.
- Worktree:
  `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261110-fix-PI-UPD-1110-assisted-idle-crashpad`.
- PR: [#85](https://github.com/SakuraLoveSmile/PI-Desktop/pull/85), opened
  2026-11-10.
- Target: remote `main`; a later patch release carries the fix.

## Problem statement

The first real in-app update of the assisted lane (0.15.14 → 0.15.15) failed on
every attempt. `~/.pi-desktop-plus/logs/app/updater.log` recorded, for each
restart click:

- `previous.assisted.install.finished` with `status: "bundle_in_use"` and
  "1 process(es) still run from the installed app (for example pid 35026); the
  installed app was reopened";
- `assisted.update.recovery.failed` with
  `ENOTEMPTY: directory not empty, rmdir ...`.

The app stayed at 0.15.14 and the helper reopened it after each abort.

## Root cause

`crates/update-helper/src/platform.rs::paths_inside` treats every process whose
executable path lies inside the bundle as "the installed app is still running".
Chromium's `chrome_crashpad_handler` starts from
`Contents/Frameworks/Electron Framework.framework/Helpers/` and can outlive the
app it reports for: pid 35026, started with the 17:07 app instance, was still
alive after that app quit at 22:27, so the helper's 15-second idle window never
saw an idle bundle. Each reopened instance left another handler, so retries
failed the same way.

The `ENOTEMPTY` warning comes from the recovery cleanup of that aborted job; it
does not block the next attempt but leaves the job directory for the next
launch's stale cleanup.

## Fix

`paths_inside` now ignores a bundle process whose file name is
`chrome_crashpad_handler`. The crash reporter loads no bundle resources once
running, so exchanging the bundle cannot affect it; every other process from
the bundle still holds the idle gate, so the swap still never replaces a
running app. A unit test covers the exemption and keeps the renderer case
blocking.

## Validation

- `cargo test` in `crates/update-helper`: 34 passed, including
  `crash_reporter_outliving_the_app_does_not_block_the_exchange` and the
  updated `matches_only_processes_inside_the_bundle`.
- Incident-level evidence: with the stale handler cleared at the moment the app
  exited, the same 0.15.14 install completed the 0.15.15 in-place update
  (`/Applications/Pi-Desktop-Plus.app` now reports 0.15.15, updater log shows
  the new version running). The user's restart click was performed by the user;
  no installer was built locally.
- NOT RUN: a packaged E2E that leaves an orphaned crashpad handler and then
  updates with the fixed helper (the helper ships only in a later release).

## Remaining work

- Merge and release the fix in the next patch (0.15.16) after the user's
  authorization; only then do later updates use the fixed gate.
- Optional follow-up: make recovery tolerate a transient `ENOTEMPTY` during job
  cleanup instead of logging a warning.
