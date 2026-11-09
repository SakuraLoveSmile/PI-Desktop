# PI-UPD-1102: Unsigned macOS packages use manual update delivery

- Project: `fork-pi-desktop`; task ID: `PI-UPD-1102`; status: 待体验
  (fix merged and published in 0.15.12; user acceptance pending).
- Created: 2026-11-02 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user asked for a code fix for the failed in-app
  update on unsigned macOS installs because the Apple Developer certificate is
  still pending. On 2026-11-02 the user authorized the complete delivery:
  push, PR, merge, and the 0.15.12 unsigned release.
- Baseline: `ec350c489eb523114d05f87e0c8e4d5d0f750891` (`origin/main`).
- Branch: `fix/20261102-pi-upd-1102-unsigned-macos-manual-update`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261102-fix-pi-upd-1102-unsigned-macos-manual-update`.
- PR: [#71](https://github.com/SakuraLoveSmile/PI-Desktop/pull/71), merged as
  `b28a3c25179eaf7af683161feb9b4e801cdac253`.
- Release: [v0.15.12](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.12),
  published from `5a55d4eec423f8db434281ae090125568d2d006b`.
- Target: remote `main` and the released unsigned 0.15.12 package. Final
  installation of the produced DMG remains the user's manual action.
- Follow-up: task `PI-UPD-1109` revisits the frozen decision below ("unsigned
  installs never update in-app") for eligible ad-hoc macOS installs through an
  assisted installer, in a later release. This record stays authoritative for
  what shipped in 0.15.12.

## Scope and confirmed decisions

Observable defect (confirmed on the user's machine, 2026-11-01): the installed
`Pi-Desktop-Plus 0.15.10` is ad-hoc signed. `electron-updater` downloaded
0.15.11, then Squirrel.Mac rejected the staged bundle with `Code signature at
URL ... did not pass validation: code failed to satisfy specified code
requirement(s)`. Squirrel validates a downloaded update against the running
app's designated requirement; an ad-hoc requirement is the running binary's
cdhash, so a different unsigned build can never satisfy it. The release lane
is intentionally unsigned because the fork has no Developer ID certificate yet.

Scope:

1. Stamp the macOS signing lane into the packaged app at build time, through
   the single macOS packaging entry point (`scripts/package-macos-identity.mjs`).
2. Resolve update delivery from that stamp: Developer ID packages keep the
   existing in-app lane; ad-hoc and unstamped packages use notify-and-link
   delivery (the existing `manual` mode).
3. Keep the renderer, preload, IPC and `UpdateState` contracts unchanged; the
   existing manual UI and `automaticSupported` flag carry the behavior.
4. Update the affected specs/ADR notes and the release runbook.

Frozen decisions:

- No new IPC method, feed field, persisted setting, database change or
  compatibility migration.
- No custom installer and no weakening of Squirrel/code-signature validation.
  Updating an unsigned install stays impossible in-app; the fix only stops the
  doomed download/install attempt and points the user at the release page.
- Signed Developer ID artifacts keep automatic in-app updates. When the
  certificate arrives, only the signed packaging lane needs its existing
  stamping path, not another policy change.
- A missing/unknown stamp is treated as not automatic-capable. This covers
  legacy packages and any lane that bypasses the wrapper.
- The installed 0.15.10 build cannot be changed by source fixes; it still
  requires one manual installation of the fixed release.
- One manual installation of the fixed build is also required before its
  notify-and-link behavior can be observed.

## Implementation and acceptance

| Step | User-visible effect | Acceptance and evidence | Status |
| --- | --- | --- | --- |
| T1 | Packaged macOS app carries `piMacSigning` = `developer-id`, `adhoc`, or `unknown`, produced by the only macOS packaging entry point. | `resolveMacSigningLane` unit test plus an executed wrapper test that runs the real entry point with a stubbed `pnpm` and asserts the stamped builder flag for the unsigned, signed, and unknown lanes. | 完成 |
| T2 | Ad-hoc/unknown macOS packages resolve to manual delivery even when the stored preference is `automatic`; no `electron-updater` download or Squirrel install is started. | Policy unit tests plus controller test: mode `manual`, `automaticSupported` false, no download, state `available`, manual reminder set. | 完成 |
| T3 | Developer ID packages and Windows/Linux packages keep their current delivery modes and defaults. | Existing and updated policy/controller tests; Windows/Linux cases unchanged and green. | 完成 |
| T4 | Docs, ADR amendments, E2E scenario expectations and release runbook match the new behavior. | English and zh-CN spec checks; docs locale pair check; ADR amendments recorded in 0022/0289. | 完成 |

Representative user path: on an unsigned macOS install, open Check for Updates
or wait for the automatic check. The app reports the new version and offers
`View release`; Settings -> Info keeps the update behavior on Manual and
explains that automatic installation is unsupported. It does not download a
136 MB archive only to fail in Squirrel, and no repeated failed install is
left behind.

## Execution and validation record

Local host: macOS arm64, Node 22.23.2, pnpm 12.8.1, dependencies reused from
the primary checkout by symlink. No new dependency installation.

Baseline evidence before the change (2026-11-01, Asia/Taipei; user's installed
app, not this worktree):

- `~/.pi-desktop-plus/logs/app/updater.log`: update check at 18:07:48,
  download completed at 18:09:29 (136,143,409 bytes, sha512 matched
  `latest-mac.yml`), Squirrel code-signature error at 18:09:31, four retries
  between 19:21:14 and 19:21:51.
- Installed 0.15.10 designated requirement:
  `cdhash H"3c73f8f793fb6fad25099305bf84f37f851fd5ac"`.
- Downloaded 0.15.11 designated requirement:
  `cdhash H"e959a3e1aacddc82345c0390ff615b653aae061f"`.
- `SecStaticCodeCheckValidity` of the update against the installed app's
  requirement returned `-67050`; against the update's own requirement it
  returned 0. Squirrel.Mac obtains the running app's designated requirement in
  `currentApplicationSignature` and validates with
  `SecStaticCodeCheckValidityWithErrors`.
- Existing updater test baseline: 24/24 passed in
  `apps/desktop/test/{update-preference,updater-controller,auto-update,update-cache,update-timeout}.test.mjs`
  before the change.

| Date | Code revision | Environment | Command or action | Result / evidence |
| --- | --- | --- | --- | --- |
| 2026-11-02 | baseline `ec350c489` | worktree, Node 22.23.2 | targeted updater tests | 24 passed (pre-change baseline) |
| 2026-11-02 | `7b33f7575` | worktree, Node 22.23.2 | `node scripts/check-pr-base-main.mjs` | Passed: `origin/main` `ec350c489` is an ancestor of the task head. |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | same targeted tests before the implementation (new expectations only) | 6 failed: missing `resolveMacSigning`/`resolveMacSigningLane`, ad-hoc controller case in-app, darwin default automatic. Red baseline recorded. |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `node --test` updater + macOS identity packaging suites | 34/34 passed |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `node --test scripts/release-builder-arguments.test.mjs scripts/require-cloud-build.test.mjs` | 6/6 passed |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `apps/desktop/node_modules/.bin/tsc -p apps/desktop/tsconfig.json --noEmit` | 64 pre-existing errors, identical to the untouched primary checkout; no error in the changed files. The checkout's typecheck baseline is already red, so this is not a clean pass. |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `node scripts/check-test-quality.mjs --base ec350c489...` | Passed (8120 assertions/extractions, no growth). |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `node scripts/check-architecture.mjs`, `check-agent-policy-sync.mjs`, `generate-scenario-index.mjs --check`, `check-release-docs.mjs` | All passed. |
| 2026-11-02 | uncommitted change | worktree, Node 22.23.2 | `docs/scripts/check-locales.mjs`, `docs/scripts/check-docs.mjs` | 95 locale pairs and 630 pages verified; only pre-existing ADR-format warnings. |
| 2026-11-02 | `c141545d1` | GitHub-hosted PR #71 checks | JS build/typecheck/lint/architecture/tests, docs, Rust, isolated smoke, PR base | All five checks passed before merge. |
| 2026-11-02 | merge `b28a3c251` | remote `main` | PR #71 merge | Merged through the repository gate; `origin/main` contains the fix. |
| 2026-11-02 | release `v0.15.12` source `5a55d4eec` | downloaded release assets, macOS arm64 | ZIP/DMG download + SHA256/SHA512; `hdiutil verify`; app identity; packaged manifest | ZIP `302acd59...` and DMG `0b7642cf...` match `release-manifest.json`/`SHA256SUMS`; ZIP sha512 matches `latest-mac.yml`; DMG checksum valid; app is 0.15.12, ad-hoc signed, and packaged `piMacSigning` is `adhoc`. |
| 2026-11-02 | release `v0.15.12` | user's macOS install | Actual installation and manual notify-and-link behavior | NOT RUN. The user installs the DMG manually; acceptance and behavior observation remain pending. |

## Commit and integration

| Commit | Behavior change and reason | Validation | Merge / release |
| --- | --- | --- | --- |
| `7b33f7575` | Unsigned macOS packages stop attempting in-app installs; manual notify-and-link instead. | Unit/integration tests, typecheck (changed files clean), docs and policy gates as recorded above | Merged as `b28a3c251`; published in [v0.15.12](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.12) |
| `c141545d1` | Record the validation evidence and commit binding. | Docs checks | Included in the same merge and release |

## Delivery and recovery

- Experience entry: install the published 0.15.12 DMG, then open Settings ->
  Info -> Updates, or wait for the automatic check on the packaged unsigned
  build.
- Not verified: actual installation, the user-visible manual update path on
  the installed 0.15.12 build, and native Squirrel acceptance on a signed lane.
- User confirmation: none yet. Acceptance remains pending explicit user
  confirmation (已验收).
- Next step: the user installs the 0.15.12 DMG manually and checks that the
  next update appears as a manual notification with `View release` instead of
  a failed in-app install.
- Rollback: revert `7b33f7575` if it is ever backed out; the legacy in-app
  attempt returns. Do not move the published tag or replace release assets.
- Worktree close-out: this fix worktree and local branch are retired after the
  closeout merge; the published tag and release remain immutable.
