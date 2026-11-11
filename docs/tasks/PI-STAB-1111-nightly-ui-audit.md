# PI-STAB-1111 — Nightly fixture diagnosis and UI baseline audit

Date: 2026-11-11 (Asia/Taipei). Tier: T1. Status: 实现中.

## Scope and decisions

The user authorized S1 investigation and a parallel, read-only U0 audit from
`main` at `6c57182920d18b163ee8b6dcc4fdcc0de0ee8471`, then authorized a
reviewable fixture-diagnostics change and an evidence-based minimal fixture
repair. Preserve all assertions, timeouts and test-quality budgets. Product
changes require a separate briefing if the
investigation reaches product code. No real provider, paid model or running
user application is an authorized test target. S2–S7 and U1–U6 remain outside
this implementation package. No board or roadmap changes.

- Branch: `fix/20261111-pi-stab-1111-nightly-ui-audit`.
- Worktree: the central `fork-pi-desktop` root, directory
  `20261111-fix-pi-stab-1111-nightly-ui-audit`.
- Intended integration target: `main`; merge and release are not authorized.
- D8 authorized publishing this dedicated baseline branch and dispatching
  diagnostic CI. On 2026-11-11 the user explicitly authorized committing the
  five reviewed files and proceeding with that branch's diagnostic CI.
- Preserve the primary checkout's pre-existing `pnpm-lock.yaml` modification.

## Evidence and baseline

- Historical nightly run `42924146284`: goals-team 35/36; `goal-blocked-ui`
  failed with GPU exit 133 and `UnknownVizError` from Electron capturePage.
  The interaction probe runs before the failing capture. The GPU crash cause
  remains unresolved. Both a green run and the first red run used the same
  source revision and runner image, so recent product commits are not proven
  to be the trigger.
- Dedicated baseline run `42976431136`, same source: goals-team 35/36.
  `goal-blocked-ui` passed; `expert-team-settings` failed waiting for Subagents.
  The settings fixture caches a navigation rail across a responsive transition;
  it does not open the compact directory. Its exact failing stage is unknown.
- With diagnostics added and navigation unchanged, one local settings run
  reproduced the failure at `compact:light`, 560px. Before the Subagents click,
  the current rail was attached inside a closed directory while the cached rail
  and target button were detached; the tab stayed `expertTeam`. The original
  six-second assertion failed, without a retry. Preserve this evidence under
  `.artifacts/pi-stab-1111/settings-repro/`. This is a confirmed local fixture
  race; the historical Linux stage still needs candidate CI evidence.
- U0 covered all 12 requested screen categories using isolated fixtures.
  Three P2 findings: inconsistent run-state presentation, ambiguous model/off
  wording, and missing file-error recovery guidance. Images and limitations are
  in `.artifacts/pi-stab-1111/u0-audit-evidence.json`; no UI was changed.
- Capture limitation: the default fixture attempted public model discovery
  twice using a fake key; both calls failed. This violated the requested R6
  boundary and was reported. That path was stopped. No user credentials were
  used and logs showed no inference call. Later capture used loopback fixtures.
- Local Team suite failed waiting for an editable Composer; recorded only.
  Its screenshots do not establish a passing suite. Isolated profiles were
  verified into an archive before removing task-owned temporary directories.

## Current package and ownership

1. Main agent: `scripts/e2e-goal-blocked-ui.mjs`; retain the interaction probe
   before capture, log named stages and GPU/renderer exits, and retain failure
   evidence in the existing CI artifact upload directory.
2. Worker: `scripts/e2e-expert-team-settings.mjs` and
   `scripts/e2e/expert-team-settings.tsx`; record runner stages, viewport/media,
   current/cached rail attachment, directory state and navigation before/after.
   After the diagnostic repro, wait for responsive structure, reacquire visible
   navigation and use the real compact-directory trigger. Keep every original
   interaction and style assertion. Atomically publish diagnostic snapshots so
   a killed writer cannot expose a truncated file; unreadable evidence fails
   explicitly while retaining the original child result.
3. Main agent: task record and relevant E2E documentation. Freeze source edits
   before candidate-identity suites; independently review the combined diff.

## Acceptance and validation

- Successful fixtures still satisfy their original assertions and final exit
  status. Screenshot failure remains a test failure.
- Interaction results and the last diagnostic stage survive a capture error.
- Settings failures identify the probe invocation and navigation node state.
- Diagnostics are available under `.artifacts/e2e/`, already uploaded by the
  existing workflow. No workflow or release-policy changes are required.
- Run syntax checks, relevant isolated fixture suites, test-quality/catalog
  checks, and appropriate documentation checks on the stable combined source.
- Goal diagnostic candidate passed its local suite, including all nine original
  interaction groups and both captures. An isolated injected capturePage
  rejection then verified exit 1, retained nine groups and wide-layout evidence,
  the `wide-capture` failure stage, and absence of stale success files. This
  validates failure evidence, not the unresolved GPU crash cause.
- Final combined executable candidate: both `goal-blocked-ui` and
  `expert-team-settings` passed once on macOS, Node 22.23.2 / Electron 43.6.0.
  Both reports have `candidateUnchanged: true` and the same dirty-tree digest
  `7c7f38daf4d16320046df1d983c29fc046d3debdda1dd0e6965c0195179efbd6`.
  At 560px, both themes recorded connected navigation targets in an open
  directory before the click, and `settingsTab: subagents` afterward.
  Reports: `.artifacts/pi-stab-1111/s1-goal-candidate.json` and
  `.artifacts/pi-stab-1111/s1-settings-candidate.json`. This task record's
  validation summary was updated afterward; executable files did not change.
- Passed: both runner syntax checks; `check-test-quality.mjs --base origin/main`
  (237 files / 8,120 existing syntax-level assertions); generated scenario index
  (138 suites / 167 IDs); agent-policy check; documentation structure and locale
  pair checks; `git diff --check`. The test-quality baseline was unchanged.
  Independent review's atomic-write finding was fixed and re-reviewed, with no
  remaining findings. The fetched `origin/main` still equals the base SHA.
- No additional unit tests: existing real-renderer E2E reproduces the navigation
  regression, and capture-boundary fault injection checks retained failure
  evidence. Full workspace/Rust suites and packaging: NOT RUN; no product,
  Host, runtime or package source changed. Real providers and the running user
  application: NOT RUN in this implementation package.
- At candidate submission, Linux diagnosis on the new commit is NOT RUN pending
  dispatch. Subsequent run results and downloaded diagnostics are retained under
  `.artifacts/pi-stab-1111/`, with the current hosted summary in
  `s1-hosted-validation.json`. S1 acceptance still requires a proven minimal fix followed by
  two consecutive green goals-team/nightly runs on the same commit, then
  scheduled nightly evidence. Diagnostics alone do not satisfy S1.

## Remaining work and resources

This record accompanies the authorized fixture candidate. Publish the request
branch and run Linux CI; use its evidence to decide the remaining GPU/capture
repair. Keep this worktree
and its local evidence while S1 remains unresolved. The final process check
found no task-owned Goal/settings Electron or crashpad process. PR, merge and
release remain outside the authorized delivery scope.
