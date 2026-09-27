# Pi-Desktop-Plus Identity and Distribution Repair Plan

> Implementation authorized on 2026-09-26. T1/T2/T4/T8/T9: **实现中**;
> T3/T5/T6/T7: **待体验**.
> Worktree: `/Users/sakurasep/.codex/worktrees/plus-brand-identity/PI-Desktop`.
> Branch: `codex/plus-brand-identity`; base: `35d69037422492db38ed0c816966122e61989b8c`.

## Goal and approved scope

The user authorized this plan's independent-install contract with
“执行这个计划”. Pi-Desktop-Plus starts with isolated data and does not import
or modify existing PI-Desktop profiles. The identity choice is resolved.
Local implementation and isolated validation are authorized. Commits,
publishing, production installation, real provider calls and paid services
remain outside the request.

## Evidence and starting state

- The primary checkout is on `main` at `1c355b5fa`, with 21 modified tracked
  files, no staged files, and no untracked files at inspection. It was 241
  commits behind the locally recorded `origin/main` (`35d690374`). Fetch again
  before implementation: the remote may have advanced further.
- The current `apps/desktop/package.json` still has
  `appId=net.aiuo.pi-desktop`, `productName=PI-Desktop`, the old macOS ZIP
  name, and old helper filenames. Its DMG and Windows artifact names changed.
  The modified helper instead looks for `Pi-Desktop-Plus.app` with bundle ID
  `cn.sakura.pi-desktop`.
- The earlier targeted review ran `node --test` on
  `ci-workflow.test.mjs`, `packaging-footprint.test.mjs`,
  `auto-update.test.mjs`, and `development-branding.test.mjs`. Three checks
  failed: wrong ZIP expectation, missing renamed helper note, and stale
  Windows installer expectation. `git diff --check` passed. These are not
  packaging, native launch, or release results.
- The locally recorded `origin/main` has version `0.15.6` and a `pt-BR`
  catalog absent from the dirty checkout. `package.json`, i18n catalogs,
  shared protocol, and release tests have changed upstream. Do not blindly
  replay the older 21-file patch over those files.
- Current product identity and data ownership are specified by
  `docs/adr/0278-canonical-application-id.md`,
  `docs/adr/0094-single-instance-per-data-directory.md`, and
  `docs/adr/0204-unsigned-macos-first-launch-helper.md`. A new independent
  identity supersedes those decisions for the fork; record its alternatives
  and consequences in a new ADR rather than rewriting their history.
- Current release and user-path references are
  `docs/spec/06-delivery/06-release-runbook.md`, its `docs/zh-CN` mirror,
  and `docs/spec/06-delivery/04-e2e-test-plan.md` E2E-044, E2E-046,
  E2E-067, E2E-196a/b/c, the Windows portable/install scenario, and their
  relevant Chinese mirrors. The current layout is the visual baseline;
  this work changes names and copy, not components, tokens, or page layout.

## Frozen contract for the independent fork

| Surface | Pi-Desktop-Plus value | Compatibility rule |
| --- | --- | --- |
| Display/native name | `Pi-Desktop-Plus` | Renderer, window, menu, tray, About, diagnostics, and installer agree. |
| Production app ID | `cn.sakura.pi-desktop` | Same value in shared `APP_ID`, electron-builder `appId`, macOS `CFBundleIdentifier`, helper check, and Windows AppUserModelID. Never reuse `net.aiuo.pi-desktop`. |
| macOS development ID | `cn.sakura.pi-desktop.dev` | Separate from both production apps; a changed cache fingerprint rebuilds the native bundle. |
| Production app names | `Pi-Desktop-Plus.app`, `Pi-Desktop-Plus.exe`, Linux `pi-desktop-plus` | Old install files and shortcuts remain untouched. |
| Local data roots | `~/.pi-desktop-plus`, `~/.pi-desktop-plus-dev` | `PI_DESKTOP_DATA_DIR` and explicit `--user-data-dir` retain precedence. Never read/write `~/.pi-desktop` or `~/.pi-desktop-dev` by default. |
| Electron profiles | `Pi-Desktop-Plus`, `Pi-Desktop-Plus Dev` | Locks, renderer storage, browser partitions, and cookies stay separate from `PI-Desktop`. |
| Remote pi-host roots | `~/.pi-desktop-plus/pi-host` for install, bootstrap, logs and pid; `~/.pi-desktop-plus` for default host data | Preserve explicit `PI_HOST_INSTALL_DIR` and `PI_DESKTOP_DATA_DIR` overrides; do not stop the old host from the Plus bootstrap. |
| GitHub release/feed | `SakuraLoveSmile/PI-Desktop` | Package feed, updater link, pi-host checksum/artifact URL, and in-app issue destination agree. No fallback to `vastsa/PI-Desktop` for Plus binaries. |
| Persisted/protocol formats | Existing schema and IPC/RPC names | No data copy, schema migration, protocol rename, or Plugin SDK change merely for branding. |

Public artifact names use the same prefix consistently: macOS
`Pi-Desktop-Plus-${version}-${arch}-mac.zip` and
`Pi-Desktop-Plus-${version}-${arch}.dmg`; Windows
`Pi-Desktop-Plus-Setup-${version}.exe` and
`Pi-Desktop-Plus-Portable-${version}.zip`. The macOS ZIP carries
`Pi-Desktop-Plus-macOS-open.command` and
`Pi-Desktop-Plus-macOS-opening-help.txt`. Linux executable, desktop ID, icon
ID, deb/rpm package names, and `/opt` installation root use
`pi-desktop-plus` / `Pi-Desktop-Plus` consistently; the Linux ASAR asset name
uses the display-name prefix. The release workflow must check the configured
names and architecture markers, including DMG/ZIP blockmaps and updater feed
references. Keep the current logo and visual layout.

If the fork has no release feed yet, do not distribute an auto-updating Plus
build as a completed release. Local package validation uses isolated profiles
and fixtures; release readiness requires matching published `latest*.yml`
metadata and assets in the fork. Version/tag selection is a later release
decision, not a reason to invent or publish a tag during implementation.
The current macOS release scripts and workflow pin the upstream Developer ID
name and Apple Team ID `DUV63RKYTW`. A Plus release must require its own
configured signing identity and team, verify the resulting signature and
notarization, and fail closed when those credentials are absent or inconsistent.
Local unsigned packaging remains available without them. No real Apple
credential or service is used during plan preparation.

## Preparation and ownership

The main agent owns this contract, the dedicated task worktree, integration,
ADR/spec updates, diff review, and final user-path verification. The current
dirty `main` is a coordination surface only. For implementation, fetch
`origin/main`, create a new `codex/` request branch and dedicated worktree
from it, preserve the primary checkout exactly, and import only the reviewed
21-file user diff as a one-time input (for example, export a binary diff of
those paths to a scratch patch, then apply it in the new worktree with 3-way
conflict handling). Reconcile each conflict against latest
code, especially `package.json`, tests, shared protocol, and all current
locale files. Confirm the new worktree has no unrelated changes before work.
Do not stash, reset, clean, or fast-forward the dirty primary checkout.
Reuse its compatible Node/pnpm/Electron/Rust toolchains and caches without a
second dependency install merely for E2E; isolate mutable profiles, data,
ports, and artifacts in the request worktree. Inspect applicable current
`AGENTS.md`, package READMEs, source, tests, and specs there.

With the identity contract confirmed, T1, T2, and T3 can be assigned to
parallel subagents. They have exclusive files below; no two agents edit the
same file. T2 consumes T1's frozen IDs and paths, while T3 consumes the
display name and current catalog list. The main agent resolves cross-module
requests, owns documentation, and runs integrated acceptance; subagent test
reports are inputs, not acceptance.

### T1 — Independent runtime identity and data (实现中)

**Owner / exclusive files:** `packages/shared/src/protocol.ts`,
`apps/desktop/electron/main/data-paths.ts`, `scripts/dev-electron.mjs`,
`crates/host-core/src/main.rs`,
`crates/host-core/src/tools/ignore_rules.rs`,
`apps/pi-host/src/config.ts`, `apps/pi-host/src/cli.ts`,
`apps/pi-host/scripts/bundle.mjs`,
`apps/desktop/electron/main/remote/pi-host-bootstrap-script.ts`, and their
focused development-profile, development-branding, pi-host config, remote
bootstrap, and host-core tests. Read ADR 0094/0278 and the remote-host
bootstrap spec before editing.

**Steps:** First add focused regression assertions that fail with the mixed
identity, old default roots, and populated `v3` cache. Set shared display
name and ID once; retain protocol/schema
versions. Give packaged and dev Plus distinct local roots and Electron
profiles, preserving explicit overrides. Align direct host-core and pi-host
fallback roots so a CLI start cannot reopen old product data. Align the
remote bundle installer and SSH bootstrap's install/current/bootstrap,
pid/log and default data paths; keep the dynamic loopback port behavior and
pairing/security checks. Include name and development bundle ID in the macOS
bundle-cache fingerprint or bump its schema, then prove that a populated old
`v3` cache cannot block `pnpm dev` or be mistaken for the new app. Do not
delete a user's existing cache or profile to make the test pass.

**Acceptance:** With a temporary home containing sentinel old product roots,
Plus resolves only its new paths, leaves old sentinels unchanged, and a second
Plus launch uses its own single-instance lock. Explicit data/profile overrides
still win. A remote bootstrap fixture never touches the old pi-host install
or pidfile. Tests fail against the old mixed identity and pass after the fix.

### T2 — Installers, release assets, and update source (实现中)

**Owner / exclusive files:** `apps/desktop/package.json`, the two macOS
helper/note files and their filenames, `.github/workflows/release.yml`,
`.github/workflows/linux-package.yml`,
`scripts/verify-macos-release.sh`, `scripts/release-macos.sh`,
`scripts/notarize-and-staple-macos-release-dmg.sh`,
`scripts/macos-signing-diagnostics.sh`, `scripts/export-linux-asar.mjs`,
other directly affected release-only scripts assigned by the main agent,
`apps/desktop/electron/main/updater.ts`,
`packages/shared/src/github-feedback.ts`, and related packaging, CI,
auto-update, release, checksum, and feedback tests. T1 alone owns
`apps/pi-host/scripts/bundle.mjs`; T2 requests changes there through the main
agent. Read ADR 0204/0278, the release runbook, and E2E-196 before editing.

**Steps:** First add regression assertions for the actual missing helper files,
wrong bundle ID/path, mismatched macOS artifact glob, and stale Windows
artifact contract. Align electron-builder's `appId`, `productName`, native executable,
macOS ZIP/DMG, Windows installer/ZIP, and Linux package/desktop identities
with the frozen contract. Rename the actual macOS helper and note along with
`extraDistFiles`; keep the helper's limited search locations, bundle-ID
check, single-attribute quarantine removal, no `sudo`, and failure alerts.
Make release globs, sign/notarization verification, Linux RPM/desktop checks,
ASAR export, and source-contract tests expect the real generated names.
Point builder publish metadata, runtime update/release links, shared GitHub
issue and pi-host asset URL source to the fork. Preserve checksum validation,
update delivery modes, and the `latest-mac-${arch}.yml` architecture split.
Replace the upstream-only Developer ID/Team ID constants with required,
consistent environment inputs in the signed lane; verify the signed output
matches those inputs. Do not silently use the upstream certificate or weaken
signing/notarization checks. The release remains blocked until the fork's
actual Apple signing credentials and corresponding CI secrets exist.
Do not weaken a release gate merely to accept missing output.

**Acceptance:** Targeted tests pass; every configured helper path exists and
the ZIP contains it; DMG/ZIP/blockmaps, Windows artifacts, Linux package
identity, and `latest*.yml` names/URLs match the output. The helper accepts
only a Plus bundle with the new ID and rejects the old app before `xattr`.
No generated update feed or help URL sends a Plus build to upstream releases.

### T3 — Renderer copy and representative user path (待体验)

**Owner / exclusive files:** `apps/desktop/index.html`,
`apps/desktop/src/components/settings/ProviderHeadersEditor.tsx`,
`apps/desktop/src/features/settings/SettingsPage.tsx`,
`apps/desktop/src/lib/startup-watchdog.ts`, all current shipped
`packages/i18n/src/locales/*/index.ts` catalogs, their focused tests,
`packages/agent-runtime/src/mode-prompts.ts`,
`packages/agent-runtime/src/project-instructions-prompt.ts`,
`packages/agent-runtime/src/subagent.ts`, the product-name descriptions in
`packages/agent-runtime/src/runtime.ts` and their focused tests, and
`scripts/e2e-electron-boot.mjs`. Read the current renderer and locale
rules at the new base before editing. T1 owns shared `APP_NAME`; T3 consumes it.

**Steps:** Carry the intended `Pi-Desktop-Plus` copy into the latest catalog
set, including `pt-BR` if still shipped, without changing keys, interpolation
variables, meaning, or unrelated translation text. Use the shared runtime
name for About/version and native surfaces where already available. Keep the
existing settings structure, typography, controls, accessibility labels,
responsive behavior, and logo assets. Update the boot probe and branding
tests to assert a real native/shared name and rendered copy, not only a
hard-coded test string. Inspect the longest name at the app's minimum
supported window size and at its normal size in English, zh-CN, and one
longer translation; fix only actual clipping in affected surfaces.

**Acceptance:** Sidebar, composer, Settings > Info, startup/recovery copy,
native window/menu/tray, and provider header presets agree on the Plus name.
No locale loses placeholders or catalog keys, no user-visible current-product
copy exposes the old name, and the focused UI retains its existing
layout and actions. No `verify:ui:*` script is run unless separately requested.

### T4 — Integration, specifications, and candidate validation (实现中)

**Owner / exclusive files:** main agent only: a new ADR superseding ADR 0278
for the fork and `docs/adr/README.md`,
`docs/spec/01-product/01-product-scope.md`,
`docs/spec/06-delivery/06-release-runbook.md`,
`docs/spec/06-delivery/04-e2e-test-plan.md`, their maintained `docs/zh-CN`
mirrors, `README.md`, `README.zh-CN.md` where installation guidance changes, and the
final integration diff. Historical ADRs and unrelated E2E scenarios remain
historical. Start once the shared identity contract is confirmed; finish
after T1–T3 are integrated.

**Steps:** Record why an independent ID, data roots, update feed, and remote
host root are necessary, the in-place-upgrade alternative, no-import rule,
and compatibility consequences. Update the release runbook and only the
affected E2E scenarios (not a global text replacement). Check that code,
generated package metadata, docs, and tests describe the same behavior.
Review the final task diff for unrelated files, secrets, stale `PI-Desktop`
current-product copy, and accidental loss of upstream changes. Refresh the
request worktree against latest `origin/main` before candidate validation and
resolve conflicts only there. A later implementation request alone is not
authorization to commit, push, or publish: if a commit is not authorized,
label any local E2E result provisional against the uncommitted tree and do not
claim the repository's tested-commit/PR gate has passed. Once a commit is
authorized, record its SHA and the incorporated base SHA for final candidate
E2E.

**Validation order and expected result:**

1. Run the T1/T2 failing regression checks before fixing code, then re-run
   them green. The focused desktop set includes
   `development-profile.test.mjs`, `development-branding.test.mjs`,
   `packaging-footprint.test.mjs`, `ci-workflow.test.mjs`,
   `auto-update.test.mjs`, `macos-release-verification.test.mjs`,
   `remote-host-bootstrap-script.test.mjs`, `renderer-branding.test.mjs`,
   `startup-watchdog.test.mjs`, and `release-asar.test.mjs`. Run
   `pnpm --filter @pi-desktop/i18n test`,
   `pnpm --filter @pi-desktop/pi-host test`, and the desktop package test suite
   after focused fixes. `pnpm build:js`,
   `pnpm --filter @pi-desktop/desktop typecheck`, `pnpm lint`, and
   `pnpm docs:check` must pass. For the changed Rust defaults, run
   `cargo fmt --check`, `cargo test -p host-core --locked`, and
   `cargo clippy -p host-core --all-targets`.
2. Build the candidate desktop and run `node scripts/e2e-electron-boot.mjs`
   with its throwaway profile and local host binary. Verify the reported
   `appName`, preload/IPC round trips, and clean exit. Do not use a real
   provider, paid API, or the user's active app/profile.
3. On an isolated native macOS build, use
   `pnpm --filter @pi-desktop/desktop dist:mac` with signing auto-discovery
   disabled for an unsigned local ZIP/DMG, then
   inspect Info.plist/signature identity, ZIP helper/note, both architecture
   name rules, blockmaps, and updater feed entries. Perform E2E-196b with a
   test account and trusted unsigned artifact: install, run helper, observe
   quarantine handling and launch, and verify the old bundle is rejected.
   Record this separately from signed/notarized E2E-196c.
4. Inspect native Windows NSIS/ZIP and Linux deb/rpm/AppImage outputs or
   their isolated CI artifacts. Verify executable/shortcut/desktop identity,
   side-by-side paths, package metadata, and that an old product fixture is
   unchanged. A real signed release, notarization, Gatekeeper, updater
   download, and user acceptance remain unverified until those gates run.

Stop optional testing after the relevant gates pass. For any unavailable
native platform, record the exact unrun scenario and keep the task
**实现中**; builds or source assertions do not replace native qualification.
Only the user may mark the experience **已验收**. Two materially different
attempts at the same blocker without new evidence trigger an evidence report,
not repeated blind retries. No release is published from this plan.

## Execution evidence, 2026-09-26

- T1: default local and remote roots, overrides, development cache identity,
  and remote host process ownership are implemented. The remote fixture
  starts an old product host, checks that Plus leaves it alive, then verifies
  that a second Plus bootstrap stops only its first Plus process. Native
  side-by-side installation and single-instance lock behavior remain to be
  qualified on a clean host.
- T2: an unsigned macOS arm64 ZIP and DMG were built in the request worktree.
  The ZIP contains the executable Plus helper and note; the DMG mounts with
  the Plus app and Applications link as its two visible items. Info.plist has
  `CFBundleIdentifier=cn.sakura.pi-desktop`; `latest-mac.yml` hashes and sizes
  match the generated ZIP and DMG. The packaged `app-update.yml` points to
  `SakuraLoveSmile/PI-Desktop` and uses the distinct
  `pi-desktop-plus-updater` cache. Windows/Linux native packages, signed
  macOS release, notarization and live update download remain unverified.
- T3: all nine shipped catalogs, renderer title, native version result,
  provider headers, startup copy, Agent/Plan/Goal/subagent prompts and
  model-visible tool descriptions use the Plus name. Agent runtime tests
  passed (1054/1054) and typecheck passed. An isolated Electron
  app was inspected in English and zh-CN at the standard 1200px width and
  a 1040px minimum renderer viewport. Settings > Info showed the correct
  name/version, with no horizontal overflow or clipped About text.
- T4: targeted desktop regression checks passed (106/106), pi-host tests
  passed (7/7), host-core tests passed (649/649), JS build/typecheck and
  documentation checks/build passed. Electron boot E2E passed with an
  isolated profile, IPC/preload round trips and 800 synthetic sessions.
  Cargo format and clippy completed; clippy reported pre-existing warnings.
  The full desktop suite remains red: 14 failures and 7 cancellations,
  reproduced in a pristine `35d690374` source snapshot. The two style-token
  lint failures in `composer-menus.css` also reproduce on that snapshot.
  This worktree has no commit because repository policy requires an explicit
  commit request; consequently the tested-commit PR/E2E gate is pending.

## Closeout plan, 2026-09-26

This section extends T1–T4; it does not replace their identity contract or
turn the current plan-only request into implementation authorization. The
repository's `AGENTS.md` requires English repository documentation, so this
plan remains in English. The current Plus worktree is uncommitted and must be
preserved. The primary checkout's separate 21-file diff must also be preserved.

### Gate evidence and classification

The complete desktop suite reported 2,785 passes, 14 failures, 7
cancellations and 1 skip. A pristine `35d690374` source snapshot reproduced
all 14 failures and 7 cancellations. `pnpm lint` reported two violations in
`apps/desktop/src/styles/composer-menus.css` at lines 123 and 496; both also
reproduced on that snapshot. These are pre-existing relative to T1–T4, but
they block the real `pnpm -r --if-present test` and `pnpm lint` gates in
`.github/workflows/ci.yml` and `.github/workflows/release.yml`. Baseline
reproduction does not make a failing gate acceptable or prove every assertion
is obsolete.

The failures separate into three repair paths:

| Path | Current evidence | Planned owner |
| --- | --- | --- |
| Seven stale source-contract assertions | Two agent-capability, one plan-mode, two general-settings, one project-archive, and one traffic-light test inspect an old inline implementation or unrelated CSS. The shared primitives and current layout already implement the intended contract. | T5 |
| Six actual UI/CSS contract gaps | Import and remote-host tabs lack matching stable tab/panel ARIA links; the combined Composer menu is 280px where the current component spec says 300px, model rows lack the specified indent, and two partials set prohibited scrollbar properties. The Composer differences account for three failures, scrollbar for one, tabs for two. | T5/T6 |
| One test-structure failure and seven cancellations | A network-error test is nested inside its parent without awaiting it, cancelling that subtest and failing the parent. A WebSocket timeout test waits only on a timer that production intentionally `unref`s; its pending promise cancels that test and five following tests. This is evidence of a test lifecycle fault, not proof of transport correctness. | T7 |

The applicable UI authority is `docs/spec/04-ux/07-ui-design-system.md`
for shared scrollbars and Composer grouping, plus
`docs/spec/04-ux/08-component-spec.md` for the 300px combined menu. Keep the
existing Settings and Composer layout, components, themes, and interactions.
There is no redesign in this closeout. Verify the affected areas in the
native app after repair; source-text tests alone are not visual or accessible
runtime evidence.

### Worktree and parallel ownership

T5–T7 repair baseline gate debt in a new dedicated `codex/` branch/worktree
from the latest `origin/main`, not in the primary checkout or the uncommitted
Plus worktree. The main agent first records the exact base SHA and checks
whether upstream has already fixed any item. It owns worktree setup, the
shared UI contract, spec/E2E updates, integration, and the final diff review.
The T5, T6, and T7 subagents can work in parallel after that base and file
ownership are frozen. They use the same identity-independent baseline and
never edit one another's files. Within T7, the chat-test and WebSocket-test
files can be assigned to separate subagents. The main agent integrates and
verifies their work; a subagent's passing report is not final acceptance.

The baseline fixes should land as a coherent separate change before refreshing
the Plus candidate. `AGENTS.md` controls this workflow where older delivery
docs disagree: no merge into local `main` as an E2E shortcut. A commit, push,
PR, or merge needs its own authorization under the repository rules. Until
then, run isolated local checks and report the baseline and Plus candidate as
uncommitted, provisional trees. Do not copy an uncommitted patch between
worktrees and call the resulting tree the verified release candidate.

### T5 — Settings tab links and current component contracts (待体验)

**Goal and owner:** A settings user can select Import and Remote Hosts tabs
with correct accessible tab/panel relationships; source-contract tests protect
current shared-component behavior. The T5 subagent exclusively owns
`apps/desktop/src/components/ui.tsx`,
`apps/desktop/src/features/settings/import-page.tsx`,
`apps/desktop/src/components/settings/RemoteHostsPage.tsx`, plus these tests:
`agent-capability-settings.test.mjs`, `plan-mode-source-contract.test.mjs`,
`settings-general.test.mjs`, `settings-import-page.test.mjs`,
`settings-project-archive.test.mjs`, `settings-remote-hosts.test.mjs`,
`traffic-light-reserve.test.mjs`, and `segmented-control-tabs.test.mjs` under
`apps/desktop/test/`.

**Input and steps:** Read the scoped renderer `AGENTS.md`, the current
`SegmentedControl`/`SettingsToggle` implementation, the two page panels, and
the relevant UX spec. Keep the shared primitive. Its current tab ID is made
from the localized `label`, while the panels reference fixed IDs. Give
`tablist` options explicit stable tab and panel IDs so each tab exposes its
matching `id` and `aria-controls`, and each panel's `aria-labelledby` points
back to that tab. Other `radiogroup`/`group` callers retain their current
roles and selection behavior. Preserve mounted Import panel state and the
Remote Hosts form's disabled/busy behavior. Update the seven stale assertions
to check the current shared primitive or rendered contract, with source
boundaries that cannot swallow unrelated settings features. The traffic-light
assertion must inspect only the titlebar reserve, not an unrelated jump
button's `bottom` position. For tablists, only the selected tab is in the Tab
order; ArrowLeft/ArrowRight wrap and select adjacent tabs; Home/End select the
first/last tab and update the panel. Do not simply delete the assertions.

**Deliverable and acceptance:** Focused tests for all eight files pass, plus
a rendered component check proves stable tab IDs, reciprocal panel links,
selected state, and panel visibility. Tests exercise arrow, Home/End, roving
tabindex and disabled states. Switching Import kinds preserves their
per-kind state. Main agent checks Import and Remote Hosts in the isolated
Electron UI, including keyboard movement. Update affected UX/E2E documentation
only if the observable contract changes, with the main agent as the sole
documentation writer.

### T6 — Composer visual contract and style tokens (实现中)

**Goal and owner:** The combined menu matches its current UX spec and style
checks without changing the existing light-theme shadow. The T6 subagent
exclusively owns `apps/desktop/src/styles/composer-menus.css`, and, for a
semantic shadow token, `apps/desktop/src/styles/tokens.css`. It owns the
focused Composer menu, thinking UI, interaction-polish, and chip-descender
tests under `apps/desktop/test/`; T5 does not edit these files.

**Input and steps:** Use the current `300px` combined-menu width and the
provider/model one-tab-stop hierarchy in the UX spec. Set the menu width to
`min(300px, calc(100vw - 24px))` and model-row left indent to the existing
test's `22px`, retaining narrow-viewport constraints. Remove
`scrollbar-width` and `scrollbar-color` from both Composer partials so the
shared WebKit/Chromium scrollbar rules work. Use
`var(--leading-compact)` for the runtime chip: its descender regression test
already requires it, and the literal `1` violates token policy. Move the
existing three-layer light-menu shadow value into a light-theme semantic
token and reference that token from the override; keep the painted value
unchanged. Do not replace it with the visually different generic dialog
shadow merely to satisfy lint.

**Deliverable and acceptance:** The three affected Composer/thinking
assertions, interaction-polish test, chip-descender test,
`node scripts/check-style-tokens.mjs`, and `pnpm lint` pass. In an isolated
Electron light and dark theme, inspect the menu at normal and minimum window
width: provider headings and model rows remain distinct; long model IDs wrap;
the chip has no clipped descenders; shadows and scrollbar reveal are intact.
The main agent updates UX/E2E text only if implementation exposes a spec
drift, not to excuse a failed assertion.

### T7 — Deterministic chat and WebSocket tests (待体验)

**Goal and parallel owners:** The full desktop suite completes rather than
ending in a parent failure or cancelled tail. One subagent exclusively owns
`apps/desktop/test/chat-error-message.test.mjs`; another exclusively owns
`apps/desktop/test/plugin-websocket.test.mjs`. The latter may request
exclusive ownership of `apps/desktop/electron/main/plugin-websocket.ts` from
the main agent only if a controlled test clock cannot be supplied through the
current harness. No other task edits these files.

**Input and steps:** Move the network-error case to a peer top-level test and
keep its errno assertion. For the WebSocket timeout, drive a controlled timer
to an explicit timeout while preserving production `unref` and the existing
permission, allowlist, socket-budget, and cleanup semantics. Prefer a scoped
Node test clock; add a minimal injectable timeout dependency only if needed
for deterministic control. Do not use an arbitrary sleep, drop the timeout
assertion, or make the production timer keep the app alive for a test.

**Deliverable and acceptance:** Run
`node --test apps/desktop/test/chat-error-message.test.mjs` and
`node --test apps/desktop/test/plugin-websocket.test.mjs`. Every test in both
files must complete with zero failures and zero cancellations, including the
loopback frame, permission refusal, unload cleanup, and event ownership
cases. If unblocking the first timeout exposes a real later failure, diagnose
and fix that failure within its actual boundary before closing T7.

### T8 — Green baseline gates and refreshed Plus candidate (实现中)

**Owner and dependencies:** Main agent only. T5–T7 must pass their focused
checks and be reviewed before this integration; T1–T4 stay in their existing
Plus worktree. The main agent owns applicable spec and E2E docs, the baseline
diff review, and the refreshed Plus diff. Shared code changes requested by
subagents are integrated by their assigned file owner.

**Validation:** In the baseline repair worktree, run `pnpm build:js`,
`pnpm --filter @pi-desktop/desktop typecheck`, `pnpm lint`,
`pnpm -r --if-present test`, `pnpm docs:check`, and `git diff --check`.
The default shell resolves pnpm 8.15.4 on this host, below the repository's
`pnpm@10.34.5` requirement. Prepend `/Users/sakurasep/Library/pnpm` to
`PATH` for these commands; do not install a second dependency tree. For
changed UI behavior, use isolated Electron checks against E2E-050 (combined
menu), E2E-209 (Import), and E2E-REMOTE-HOST-settings-compact-inventory,
plus the T5/T6 tab and theme conditions. Do not run `verify:ui:*`, which this
request has not authorized. Record the tested head SHA, base `origin/main`
SHA, environment, suites and results; an
uncommitted run is provisional. The expected desktop result is no failure or
cancellation, not merely fewer than 14/7. Diagnose any newly visible
WebSocket failures rather than counting them as the old cancellation debt.

After baseline fixes are authorized and incorporated into remote `main`,
refresh the Plus worktree against that exact latest `origin/main` without
discarding its present uncommitted changes. Review conflicts in owned files,
rerun the T1–T4 focused checks, full JS build/typecheck/lint/tests, applicable
Rust checks, documentation checks, and isolated Electron boot/user path.
Record the task candidate's tested commit and base. If commits are still not
authorized, preserve both worktrees and report the remaining Git/PR gate
without claiming merge readiness. Do not change the user's primary checkout.

### T9 — Native installation and release qualification (实现中)

**Owner and dependency:** Main agent coordinates platform-specific
verification after T8 produces a green, identifiable Plus candidate.
Windows, Linux, and macOS checks may run in parallel on isolated native
runners; each runner owns only its temporary profile, package output, and
evidence. T2's package/identity contract and T4's E2E-196 scenarios are the
shared inputs. No runner edits the same source file.

**Acceptance matrix:** On Windows, install NSIS and run portable ZIP beside
the old product; check distinct executable, shortcuts, taskbar identity,
data/profile paths and update metadata. On Linux, inspect and launch deb,
rpm, and AppImage as applicable; check `pi-desktop-plus` package/executable,
desktop ID, `/opt` path, isolated profile and updater behavior. On macOS,
verify unsigned arm64 and x64 bundles, helper, ZIP/DMG, blockmaps,
`latest-mac-*.yml`, side-by-side launch and single-instance/data isolation.
Use throwaway old-product fixtures; do not open or migrate a real user's
existing profile. Record each artifact hash and exact platform/build result.

Apple Developer ID signing, notarization, Gatekeeper E2E-196c, and a real
fork-feed update require the fork's actual credentials, CI configuration,
published assets and separate authorization for external release actions.
Until each corresponding native or external check passes, label that surface
**实现中** and do not claim a signed, updating, or releasable Plus build.
Successful local checks lead to **待体验** only; **已验收** requires the user's
explicit confirmation. A PR integration candidate and repository merge gates
remain separate from task-candidate evidence.

## Closeout execution evidence, 2026-09-26

All T5–T7 fixes were implemented in a separate baseline worktree at
`/Users/sakurasep/.codex/worktrees/plus-baseline-closeout/PI-Desktop`, branch
`codex/plus-baseline-closeout`, based on the fetched
`origin/main=35d69037422492db38ed0c816966122e61989b8c`. The primary checkout
and the existing uncommitted `codex/plus-brand-identity` worktree were not
changed by this closeout implementation. The baseline branch remains
uncommitted.

- T5: the shared tab control now emits stable tab/panel links and supports
  selected-only tab stops, wrapping ArrowLeft/ArrowRight, and Home/End. Import
  and Remote Hosts panel labels point to the generated tab IDs. Seven stale
  assertions were updated without removing their behavior checks. Added an
  SSR/render interaction test for IDs, reciprocal panel links, localized-label
  stability, keyboard focus/selection, roving tabindex, and disabled controls.
  In isolated Electron, Import selection and Remote Hosts SSH/Pair switching
  were exercised; Import Right Arrow, Home, and End were exercised after the
  keyboard fix. After unlock, Import Right from MCP wrapped to Sessions and
  Left from Sessions wrapped to MCP; Remote Hosts Pair Right wrapped to SSH
  and Left from SSH wrapped to Pair. Each tab switch selected the matching
  panel. No SSH install or Pair request was submitted. Developer mode was
  enabled only in the disposable profile to expose the developer-only page.
- T6: focused Composer/thinking/style tests passed (39/39), the style-token
  check and lint passed. A disposable Host database used twelve fake model
  bindings and a loopback `/v1/models` fixture; no model-generation request was
  made. In isolated Electron, the menu was inspected in dark and light themes
  at the default 1200×800 CSS window and at 1040×800 CSS, confirmed by the main
  renderer viewport. The menu visually matched its 300px width, model rows
  remained indented under the provider heading, the long model ID wrapped, and
  the `gypq-vision` chip descenders were not clipped. With twelve rows, scrolling
  exposed the Chromium scrollbar in both themes at minimum width, and the light
  menu shadow remained intact. The disposable profile and local fixture were
  cleaned. T6 is now **待体验**.
- T7: chat-error and WebSocket tests passed (20/20, zero cancellations).
  Node's scoped mock timer drives the 20ms timeout; production `unref` remains
  unchanged. The run emitted Node's experimental MockTimers warning.
- T8 local candidate gates: `pnpm build:js`, desktop typecheck, `pnpm lint`,
  `pnpm docs:check`, and `pnpm -r --if-present test` passed using pnpm 10.34.5.
  The full desktop result was 2,805 passed, 0 failed, 0 cancelled, 1 skipped.
  `git diff --check` passed. The request head has no commit SHA, so task
  candidate/PR integration evidence is still provisional. The baseline fixes
  need explicit commit/remote-integration authorization before the Plus tree
  can refresh against them.
- Dependency setup: the first worktree symlink pointed workspace aliases at
  the dirty primary checkout and caused cross-tree type errors. After proving
  incompatibility, the symlink was removed and `pnpm install --offline
  --frozen-lockfile` reused all 842 cached packages (0 downloads) to create
  correct worktree links. Running Electron then fetched its missing 43.6.0
  binary through the existing package install script. No source lockfile was
  changed.
- T9: Windows/Linux native qualification, macOS x64, signing, notarization,
  Gatekeeper, and live updater remain unverified. T9 depends on a refreshed,
  identifiable Plus candidate and available native runners/credentials.
