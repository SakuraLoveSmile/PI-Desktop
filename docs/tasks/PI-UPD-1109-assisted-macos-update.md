# PI-UPD-1109: Assisted in-place update for ad-hoc macOS builds

- Project: `fork-pi-desktop`; task ID: `PI-UPD-1109`; status: 实现中
  (WP0-WP4 implemented and checked in the worktree, uncommitted; delivery and
  WP5 wait for the user's word).
- Created: 2026-11-09 (Asia/Taipei). Tier: T2 (changes the update trust model,
  adds a process role and a crate).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user asked to give unsigned macOS installs an
  in-app update by porting the installer pattern of the maintainer's
  KaneoPilot app. The briefing was the chat plan of 2026-11-09; the user then
  said "开工 WP0", accepted the default decisions OD1-OD8 below, and said
  "继续" after the WP0 report, which is read as the go-ahead for WP1-WP4 in
  this worktree. NOT authorized: commit, push, PR, merge, release, GitHub
  Actions runs or dispatches, and WP5. Each of those needs the user's explicit
  word.
- Baseline: `2185e7e08fb9edb9d4ae61a12eb5b91aa3f78919` (`origin/main`).
- Branch: `feat/20261109-pi-upd-1109-assisted-macos-update`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261109-feat-pi-upd-1109-assisted-macos-update`.
- PR / release: none.
- Target: remote `main`, after the user authorizes delivery. Documents and
  implementation land in one PR.

## Scope and confirmed decisions

Problem (confirmed on the user's machine): releases published through the
unsigned lane are ad-hoc builds, which cannot use the Squirrel.Mac install of
`electron-updater` (PI-UPD-1102), so every update is a manual DMG install. The
user's `updater.log` shows no in-app update ever succeeded: the only download
episode (2026-11-01, 0.15.11) ended in five Squirrel.Mac rejections. The user's
KaneoPilot app shows that an ad-hoc app can update itself with its own
installer, because nothing compares the new app with the old app's designated
requirement.

Design: [ADR plus-assisted-macos-adhoc-update](../adr/plus-assisted-macos-adhoc-update.md)
(status: Implemented candidate). Frozen decisions the user accepted on
2026-11-09:

- OD1: reverse the PI-UPD-1102 rule only for macOS builds stamped
  `piMacSigning = "adhoc"` with an eligible install location; `developer-id`,
  `unknown`, Windows and Linux are unchanged.
- OD2: the installer helper is a Rust crate (`crates/update-helper`), not a
  shell script.
- OD3: install only on the user's restart action, never on ordinary quit.
- OD4: an eligible ad-hoc install keeps Manual as its default preference;
  Automatic is an explicit opt-in. No default changes, so the decisions-log
  rows D120, D450 and D628 are not edited (PI-UPD-1102 did not edit them
  either; the ADR 0022 and ADR 0289 amendments carry the change).
- OD5: keep one backup of the previous app, not one per update.
- OD6: the lane downloads the ZIP asset, not the DMG.
- OD7: arm64 only, the one architecture the fork's tag lane publishes.
- OD8: no independent release signature this round; the trust anchor is the
  fixed HTTPS GitHub repository and the UI says so (ADR decision 10).

Non-goals: the Developer ID path, Windows, Linux, delta updates, downgrade,
silent install, notarization, and any quarantine-clearing helper (ADR 0309 and
D634 stay in force: the lane refuses a quarantined bundle instead).

Rules this task changes, all through the ADR and the document edits: the
security spec section 7 sentence that unsigned packages must not enter the
in-app install lane, the PI-UPD-1102 frozen decision, the ADR 0022 and ADR 0289
PI-UPD-1102 amendments, and the release runbook's manual-install statements.

## Implementation and acceptance

| WP | Content | Status |
| --- | --- | --- |
| WP0 | ADR; security, process-model, architecture, repository-structure, UX-patterns, runbook and E2E-196d edits with zh-CN mirrors; ADR 0022/0289 amendments; this record | Done in this worktree; uncommitted |
| WP1 | `crates/update-helper`: job, commit and result files, per-target lock, target identity check, bounded waits, `renamex_np(RENAME_SWAP)` exchange, relaunch with `open -n`, rollback; 33 Rust tests on temporary bundles | Done; uncommitted |
| WP2 | Main `electron/main/assisted-update/` (eligibility, asset selection, download and hash check, staging and verification, job store, helper process, recovery, lane driver, `net` transport); hooks in `updater.ts`, `update-policy.ts`, `bootstrap/shutdown.ts` (commit file written last) and `ipc/app-ipc.ts` (`await updater.install()`) | Done; uncommitted |
| WP3 | `UpdateState.delivery`, `assistedBlockedReason`, `assistedInstallFailed`; banner retry and Settings Download / Try again, trust notice and blocked-reason notes; 8 new `updates.*` keys in all 9 locales | Done; uncommitted |
| WP4 | Packaging and gates (`build:update-helper-release`, mac `extraResources`, pre-sign gate, `verify-macos-release.sh`, CI and release workflow steps), tests, and the final documentation pass including the `docs/project/plus-unreleased.md` entry | Done except the packaged-candidate E2E, which is NOT RUN |
| WP5 | Release and real validation: two consecutive releases (manual first install, then an in-app update), each on the user's explicit word | 未开始 |

Observable behavior: an ad-hoc arm64 macOS build in a writable, non-translocated
location, not reached through a symlink, shows a trust notice in Settings and may
select Automatic. Automatic downloads the ZIP through Electron's network stack,
checks the feed hash and size, stages the app next to the installed one and
offers Restart to update; only that click starts the helper, which exchanges the
bundles after Main exits and relaunches. A failed install is not retried on its
own: the next launch shows Try again and the release link. Ineligible installs
keep notify-and-link and name the rule they fail. Developer ID, unknown-stamp,
Windows and Linux behavior is unchanged.

Acceptance scenarios: E2E-196d (both locales of the E2E plan), plus the unit,
contract, Rust and macOS integration tests below. A skipped check is reported as
NOT RUN.

## Execution and validation record

Checks ran from the worktree without `pnpm`: the worktree has no installed
dependencies, so a per-worktree overlay links its `node_modules` entries to the
primary checkout's, and the git-ignored `dist` folders of `packages/i18n`,
`packages/agent-runtime` and `packages/shared` were built locally. Rust ran with
a scratch `CARGO_TARGET_DIR`.

| Date | Code revision | Command or action | Result / evidence |
| --- | --- | --- | --- |
| 2026-11-09 | `2185e7e08` + uncommitted work | `node --test test/*.test.mjs` in `apps/desktop`, `PI_UPDATE_HELPER_BIN` set to the locally built release helper | 4369 tests, 4364 pass, 1 skipped (unrelated), 4 fail: `custom-system-prompt-launch`, `session-launch-team-isolation`, `subagent-model-launch` and the image-binding case of `image-conversation-selection`. All four load the primary checkout's stale `@pi-desktop/agent-runtime` build, which lacks `resolveAdvisorProvider`; with the link pointed at the worktree's own build the four files pass 18/18, and the same stale-build failures were seen on clean `main` earlier in this task. |
| 2026-11-09 | same | `tsc -p apps/desktop/tsconfig.json --noEmit` | The same 10 pre-existing errors as clean `main` (`goal-report-persistence.ts` x3, `session-launch.ts` x6, `sidecar.ts` x1); no new error. |
| 2026-11-09 | same | `cargo fmt --all -- --check`; `cargo clippy -p update-helper --all-targets --all-features -- -D warnings` | Clean. |
| 2026-11-09 | same | `cargo clippy -p update-helper --all-targets --all-features -- -D warnings` with `--target aarch64-linux-android` (unix, not macOS) and `--target x86_64-pc-windows-msvc` (not unix) | Clean: the crate compiles on the shapes the CI Ubuntu job and any other host see. |
| 2026-11-09 | same | `cargo test -p update-helper --locked`; `cargo metadata --locked` | 33 passed; `Cargo.lock` consistent under `--locked`. |
| 2026-11-09 | same | `cargo clippy --workspace --all-targets --all-features` (the CI command) | Finishes; only the 2 existing `host-core` warnings. |
| 2026-11-09 | same | `cargo build --release -p update-helper` | Built; 680 KB arm64 binary. |
| 2026-11-09 | same | `assisted-update-macos.test.mjs` (part of the node run) | Passed: job and commit files written by the TypeScript side are accepted by the real Rust helper, which exchanges a temporary ad-hoc bundle with the real `ditto`, `codesign` and `open` tools, keeps one backup, relaunches, and the next launch settles the result. |
| 2026-11-09 | same | `vitest run` in `packages/i18n` and `packages/shared` | 30/30 and 1334/1334. |
| 2026-11-09 | same | `node scripts/check-test-quality.mjs`; `scripts/check-architecture.mjs`; `check-style-tokens.mjs`; `biome lint` | Pass; the test-quality baseline is untouched and no new source-regex assertion exists. The architecture script does not see untracked files, so sizes were measured by hand: the largest new TypeScript module is 238 lines; `install.rs` is 754 lines, about half of them unit tests. |
| 2026-11-09 | same | The CI `scripts/` test commands: `node --test scripts/release-*.test.mjs scripts/publish-release.test.mjs scripts/require-cloud-build.test.mjs scripts/refresh-macos-release-metadata.test.mjs`; `node --test scripts/e2e-suite.test.mjs scripts/scenario-index.test.mjs scripts/test/*.test.mjs`; `node --test scripts/pi-patch-hash.test.mjs` | 86/86, 25/25 and 7/7. |
| 2026-11-09 | same | Quarantine probe on this Mac: `xattr -w com.apple.quarantine` on a copy of the built helper, then Node `copyFile` and a run of the copy | The copy carries no quarantine attribute and starts. Pinned by `assisted-update-macos.test.mjs` ("a quarantined bundled helper still installs because its copy drops the attribute"); that file now passes 6/6. |
| 2026-11-09 | same | `check-docs.mjs`, `check-locales.mjs`, `generate-scenario-index.mjs --check`, `check-agent-policy.mjs`, `check-release-docs.mjs`, `git diff --check` | All pass (636 pages; 95 locale pairs; 138 suites and 167 executable ids; release documents aligned with 0.15.13). |
| 2026-11-09 | same | Mutation checks, each reverted afterwards | Caught by the named tests: commit file written before the sidecar shutdown, TypeScript and Rust job field names drifting apart, banner retry condition, Settings trust-notice condition, the build script building the wrong package, and the build script's platform guard. |
| 2026-11-09 | n/a | Electron CDP E2E and the packaged-candidate journey (E2E-196d), `pnpm dist:mac`, the release job step "Test the macOS update helper", signing and notarization | NOT RUN: packaging and release builds run only on GitHub-hosted runners, no Actions run was authorized, and the Electron CDP harness cannot start from the sandboxed shell. |
| 2026-11-09 | n/a | `cargo test -p update-helper` on Linux (the CI `rust` job runs it on Ubuntu) | NOT RUN: no container runtime was running (the Docker daemon was not started) and none was launched. Audited instead: the tests use fake platforms, `sh`, `sleep` and temporary directories, macOS-only cases are `cfg`-gated, and clippy `--all-targets -D warnings` is clean for a unix non-macOS target and a non-unix target. |
| 2026-11-09 | n/a | Real releases (WP5); Windows and Linux packaging; `cargo test -p host-core`; the other packages' tests (`pnpm -r test`); `verify:ui:*` | NOT RUN: WP5 needs the user's word, the other platforms are untouched by the lane, `host-core` and the other packages are unchanged, and `verify:ui:*` was not requested. |

## Remaining work and unverified items

- WP5: two consecutive real releases and the packaged-candidate E2E-196d. The
  decision to run them is the user's.
- Not verified on a real install: whether macOS App Management protection
  refuses the bundle replacement in `/Applications` (the helper then keeps and
  reopens the old app, and the next launch offers Try again); whether Keychain
  items and privacy grants survive the changed cdhash; Electron `net` downloads
  of a 130+ MB file behind the outbound proxy; that the release ZIP holds
  exactly one top-level app (staging refuses anything else); the real
  `latest-mac.yml` SHA-512 and size fields (the feed returned a 504 when fetched
  on 2026-11-09; the aggregate job asserts both fields, but no real feed was
  read here).
- Release risk: the new build-job step "Test the macOS update helper" has never
  run on a hosted runner (it drives `open -n` and LaunchServices on a CI
  machine), and a red step there blocks a tag release. The first Actions run,
  once the user allows one, should be a manual candidate, not a tag.
- OD3 under a delayed quit: after the Restart click the quit is not
  cancellable in Main (the confirmation dialog is skipped and the shutdown
  always releases the quit). If the shutdown hangs, the helper waits at most two
  minutes, then changes nothing and exits (`parent_still_running`, which
  recovery treats as no fault), so a quit that completes later cannot install
  the update; a quit that completes inside the two minutes does, which is the
  click's intent. After the helper has given up, the latched install request
  makes the Restart button a no-op until the app is restarted by other means.
- By design, not fixed here: the downloaded package is not persisted across an
  app restart (it is downloaded again), and there is no health check or
  automatic rollback after a successful relaunch; a new version that starts and
  then crashes leaves the retained backup for a manual restore.
- `apps/desktop/electron/main/updater.ts` grew by about 110 lines to 862
  (constructor wiring and hooks; it is not on the AGENTS.md ratchet list). A
  later extraction of the update state plumbing would shrink it.
- Pre-existing drift, reported and not fixed: decisions-log D450 still says
  packaged macOS uses in-app `electron-updater`, and D628 still says Automatic
  is the default for packaged macOS. Both have been stale since PI-UPD-1102;
  editing frozen decision rows is the user's call. The WP0 pass did fix the
  zh-CN security spec section 7, which still described the executable
  quarantine-clearing ZIP helper that D634 removed.
- Side finding, untouched: the failed 0.15.11 attempt left two ZIPs (about 272
  MB) in `~/Library/Caches/pi-desktop-plus-updater/`. The lane cleans only its
  own staging directories; the leftover itself is the user's call.
- The first release that contains the lane has to be installed by hand. The
  localized in-app "What's new" catalogs (`packages/shared/src/changelog-*.ts`)
  are written at release preparation and are not touched here.

## Delivery and recovery

- Runtime resources: this worktree and branch only, the per-worktree
  `node_modules` overlay (links, removed at the end of the session), the local
  git-ignored `dist` builds and a scratch Cargo target directory. No process,
  Actions run, secret, repository variable or app setting was touched, and the
  user's installed app was not touched.
- Not committed, pushed or merged. Rollback is deleting this worktree and
  branch; nothing exists remotely.
- Experience entry: none yet (the lane ships with the next release). After WP5,
  install the first lane-bearing release by hand, then update from inside the
  app.
- User confirmation: none yet. Next step: the user reviews the diff, authorizes
  a commit, and says whether to open a PR and run the packaged candidate on
  GitHub Actions.
