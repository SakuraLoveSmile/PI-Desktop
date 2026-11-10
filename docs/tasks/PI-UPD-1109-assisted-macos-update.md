# PI-UPD-1109: Assisted in-place update for ad-hoc macOS builds

- Project: `fork-pi-desktop`; task ID: `PI-UPD-1109`; status: 待体验
  (WP0-WP4 merged and shipped in 0.15.14; the install journey and user
  acceptance are pending).
- Created: 2026-11-09 (Asia/Taipei). Tier: T2 (changes the update trust model,
  adds a process role and a crate).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user asked to give unsigned macOS installs an
  in-app update by porting the installer pattern of the maintainer's
  KaneoPilot app. The briefing was the chat plan of 2026-11-09; the user then
  said "开工 WP0", accepted the default decisions OD1-OD8 below, and said
  "继续" after the WP0 report, which is read as the go-ahead for WP1-WP4 in
  this worktree. The user then answered the delivery report with "是的
  请按照流程发布新版本", which is read as authorizing the commit, push and
  PR #80, its hosted validation and merge, and the 0.15.14 release (tracked in
  [PI-REL-01514](PI-REL-01514-macos-release.md)); the user then authorized the
  closeout PR ("开收尾 PR"). NOT authorized, each needing the user's explicit
  word: downloading or installing the produced installers, the second real
  release of WP5, changes to signing secrets or repository variables, and
  deleting remote branches.
- Baseline: `2185e7e08fb9edb9d4ae61a12eb5b91aa3f78919` (`origin/main`).
- Branch: `feat/20261109-pi-upd-1109-assisted-macos-update` (merged; the local
  branch is deleted, the remote branch is kept).
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261109-feat-pi-upd-1109-assisted-macos-update`
  (removed after the merge).
- PR / release: [PR #80](https://github.com/SakuraLoveSmile/PI-Desktop/pull/80),
  merged as `b6e11df48fe0a51d91d0f7d9ab0286c9ed198576` on
  2026-11-09T11:36:11Z; shipped in
  [v0.15.14](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.14),
  published 2026-11-09T12:04:57Z.
- Target: remote `main` (done). Documents and implementation landed in one PR.

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
| WP0 | ADR; security, process-model, architecture, repository-structure, UX-patterns, runbook and E2E-196d edits with zh-CN mirrors; ADR 0022/0289 amendments; this record | Done; merged (`e8bbec82e`) |
| WP1 | `crates/update-helper`: job, commit and result files, per-target lock, target identity check, bounded waits, `renamex_np(RENAME_SWAP)` exchange, relaunch with `open -n`, rollback; 33 Rust tests on temporary bundles | Done; merged (`ab8ed8127`) |
| WP2 | Main `electron/main/assisted-update/` (eligibility, asset selection, download and hash check, staging and verification, job store, helper process, recovery, lane driver, `net` transport); hooks in `updater.ts`, `update-policy.ts`, `bootstrap/shutdown.ts` (commit file written last) and `ipc/app-ipc.ts` (`await updater.install()`) | Done; merged (`e466bca16`) |
| WP3 | `UpdateState.delivery`, `assistedBlockedReason`, `assistedInstallFailed`; banner retry and Settings Download / Try again, trust notice and blocked-reason notes; 8 new `updates.*` keys in all 9 locales | Done; merged (`e466bca16`) |
| WP4 | Packaging and gates (`build:update-helper-release`, mac `extraResources`, pre-sign gate, `verify-macos-release.sh`, CI and release workflow steps), tests, and the final documentation pass including the `docs/project/plus-unreleased.md` entry | Done; merged (`4ed16a9c1` packaging and CI, `e8bbec82e` documents). The helper step and the bundle gates ran green on hosted macOS runners; the Electron packaged-candidate journey is NOT RUN |
| WP5 | Release and real validation: two consecutive releases (manual first install, then an in-app update), each on the user's explicit word | Partly done: release 0.15.14 is published (the first release with the lane, installed by hand). The in-app update from it to the next release and the second consecutive release were not started; each needs the user's explicit word |

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
a scratch `CARGO_TARGET_DIR`. The rows up to the mutation checks are the local
evidence from before the commit; each NOT RUN row notes what the hosted runs
later covered, and the hosted rows follow them.

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
| 2026-11-09 | n/a | Electron CDP E2E and the packaged-candidate journey (E2E-196d), `pnpm dist:mac`, the release job step "Test the macOS update helper", signing and notarization | NOT RUN: packaging and release builds run only on GitHub-hosted runners, no Actions run was authorized, and the Electron CDP harness cannot start from the sandboxed shell. Later: the hosted candidate (run 42607731531) and the tag run (42611786896) ran the packaging, the "Test the macOS update helper" step and the unsigned lane's bundle gates; the Electron CDP E2E, the E2E-196d journey, and Developer ID signing and notarization (not part of the unsigned lane) stay NOT RUN. |
| 2026-11-09 | n/a | `cargo test -p update-helper` on Linux (the CI `rust` job runs it on Ubuntu) | NOT RUN: no container runtime was running (the Docker daemon was not started) and none was launched. Audited instead: the tests use fake platforms, `sh`, `sleep` and temporary directories, macOS-only cases are `cfg`-gated, and clippy `--all-targets -D warnings` is clean for a unix non-macOS target and a non-unix target. Later: the hosted Rust job ran it on Ubuntu, 29 passed (the four macOS-only tests compile out; see the hosted rows below). |
| 2026-11-09 | n/a | Real releases (WP5); Windows and Linux packaging; `cargo test -p host-core`; the other packages' tests (`pnpm -r test`); `verify:ui:*` | NOT RUN: WP5 needs the user's word, the other platforms are untouched by the lane, `host-core` and the other packages are unchanged, and `verify:ui:*` was not requested. Later: the user authorized the first release, which ran (0.15.14), and the hosted jobs ran `cargo test -p host-core` (1295 passed) and the `JS build / typecheck / lint / architecture / test` job. Still NOT RUN: the second release, Windows and Linux packaging, and `verify:ui:*`. |
| 2026-11-09 | `e8bbec82e` (PR #80 head) | Hosted `pull_request` runs: `ci.yml` [run 42607691738](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691738), `docs-check.yml` [run 42607691586](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691586), `pr-base.yml` [run 42607691539](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607691539) | All jobs `success`: JS build / typecheck / lint / architecture / test; isolated launch, message, approval and restart smoke; Rust format / clippy / `cargo test -p host-core -p update-helper --locked` (host-core 1295 passed, update-helper 29 passed on Linux, the four macOS-only tests compile out); Docs checks; PR base. |
| 2026-11-09 | `e8bbec82e` (PR #80 head) | Hosted manual dispatch of `release.yml` as a candidate (`sign_macos=false`), [run 42607731531](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607731531) | Preflight, the shared `ci.yml` barriers, Build macOS arm64 and Verify macOS arm64 installer bundle `success`; Publish skipped (candidate: unsigned, Actions artifacts only). On the macOS runner the step "Test the macOS update helper" passed (`cargo test -p update-helper` 33/33 and `assisted-update-macos.test.mjs` 6/6 with the real `ditto`, `codesign` and `open`), and the packaged app, its ZIP and its DMG each contain `Contents/Resources/bin/pi-desktop-update-helper` with valid signatures. |
| 2026-11-09 | `b6e11df48` | PR #80 merged with a merge commit at 11:36:11Z, head pinned to `e8bbec82e` | The merge tree equals the PR head tree (`60cc8db13a67`); `origin/main` contains all four commits. |
| 2026-11-09 | `531e78c10` | Hosted tag run [42611786896](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42611786896) for `v0.15.14` (details in PI-REL-01514) | All seven jobs `success`, including Build macOS arm64 with "Test the macOS update helper" and the bundle verification; the release was published at 12:04:57Z. The cross-check of the API, manifest, `SHA256SUMS` and feed found no mismatch. |
| 2026-11-09 | `531e78c10` | Local macOS, Node 22; scratchpad script loading the repository's `ts-import-hooks.mjs`: the lane's `selectAssistedAsset(…, "arm64")` and `isAllowedAssetUrl` on the published `latest-mac.yml` | Selected `Pi-Desktop-Plus-0.15.14-arm64-mac.zip` with the URL rebuilt from the fixed repository and tag, the feed's sha512 and size 136471080; x64 and ia32 were refused (`asset-missing`). Parsing and selection only: the lane's download and hash check on the real ZIP first runs in an in-app update from an installed 0.15.14. |

## Remaining work and unverified items

- WP5: the first real release is published (0.15.14). Remaining: install it by
  hand, update from inside the app to the next release, a second consecutive
  release, and the packaged-candidate E2E-196d. The decision to run them is the
  user's.
- Not verified on a real install: whether macOS App Management protection
  refuses the bundle replacement in `/Applications` (the helper then keeps and
  reopens the old app, and the next launch offers Try again); whether Keychain
  items and privacy grants survive the changed cdhash; Electron `net` downloads
  of a 130+ MB file behind the outbound proxy; that the release ZIP holds
  exactly one top-level app (staging refuses anything else); the lane's own
  download and SHA-512 check on the real ZIP. The real 0.15.14 `latest-mac.yml`
  has since been read: the lane's selector accepts its ZIP entry, and the hosted
  release gate compared the feed's SHA-512 and size with the built bytes before
  upload. Only an in-app update from an installed 0.15.14 exercises the download
  and hash check itself.
- Release risk, resolved: the build-job step "Test the macOS update helper"
  drives `open -n` and LaunchServices on a CI machine, and a red step there
  would block a tag release. It ran green on a hosted macOS runner in the manual
  candidate (run 42607731531) and again in the 0.15.14 tag run (42611786896).
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
- The first release that contains the lane, 0.15.14, has to be installed by
  hand. The localized in-app "What's new" notes were written in its release
  preparation (PI-REL-01514), not in this task.
- The published 0.15.14 release notes carry the fixed unsigned-lane notice
  ("install updates manually", `scripts/publish-release.mjs`). It is accurate
  for this first lane-bearing release; from the next release on it should
  mention the in-app update for eligible installs, which is the user's call.
- The ADR [plus-assisted-macos-adhoc-update](../adr/plus-assisted-macos-adhoc-update.md)
  stays at "Implemented candidate" until the lane qualifies (two consecutive
  real releases, E2E-196d) and the user accepts this task.

## Delivery and recovery

- Runtime resources: the feature worktree and its local branch were removed
  after the merge; the remote branch is kept. The hosted runs were the manual
  candidate [42607731531](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42607731531)
  and the tag run [42611786896](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42611786896).
  No secret, repository variable or app setting was changed, and the user's
  installed app was not touched.
- Merged and released: PR #80 (`b6e11df48`) and v0.15.14 (PI-REL-01514).
  Rollback for users is to leave Automatic off (Manual stays the default) and,
  after an unwanted install, to restore the retained backup. For the code,
  revert the PR #80 merge on `main` and publish a new release; by process rule
  the tag and the published assets are never moved or replaced.
- Experience entry: the [v0.15.14 release](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.14).
  Install the DMG or ZIP by hand (this first lane-bearing build cannot be
  reached by an in-app update), review the Updates settings, and select
  Automatic to take part in the in-app update to the next release.
- User confirmation: none yet; acceptance (已验收) waits for the user. Pending
  decisions: running the in-app update and the second release (WP5), the ADR
  status, deleting the remote branch, and any installer download.
