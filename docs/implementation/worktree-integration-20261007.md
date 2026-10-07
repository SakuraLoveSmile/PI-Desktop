# Worktree integration — 2026-10-07

## Inputs and preservation

Primary and source worktrees were not modified. Recoverable file copies,
staged/unstaged/combined binary patches, source metadata, verified SHA-256
manifests and a verified Git bundle are stored at:

`/Users/sakurasep/Documents/Code/Project/Fork Project/PI-Desktop-worktree-archives/20261007-integration`

| Input | Recoverable revision | Integration |
| --- | --- | --- |
| delegation-by-mode | `b48f1b820b510eb4d18629e838b4044a6cedf72e` | Included |
| goal-report-completion | `b17ac1ac75ac013e2226790d63d42c7ca8a73793` | Included through aggregate; snapshot ancestry retained |
| team-title-layout | `632ac0c145076846f1ca371595a3401356f9a288` | Included through aggregate; snapshot ancestry retained |
| repaired-dmg-20261007 | `a70e894acff50baf9b19f972e92fdaaad0b63577` | Included; byte-identical code/test union of Goal and title work |
| fix-team-solo-approval | `0abbad999b871c8fe37eea718eb9fc5006983792` | Deferred pending user behavior choice |

The aggregate contains all 20 Goal code/test files and all 35 title-related
code/test files, including ApprovalSummary. All nonempty source additions to
the four overlapping documents were present in the aggregate. Conflict
resolution retains delegate-first guidance, localized title/review guidance,
and each repair's documentation. No persisted data or installed app was moved.

The deferred worktree prohibits all `lead_only`, gates Lead Write/Edit/Bash
and plan submission on expert participation, and changes planning launch
approval. That conflicts with the previously approved prompt-only policy and
trivial indivisible exception. It must not be silently included as an ordinary
merge resolution. Its participation predicate proves an approved expert turn
started, not task ownership or completed execution contribution.

## Task-candidate validation

Task candidate: `bf04a7659a7556ab6942cc328f95bbc0b7a3e36f`

Base main: `ea54319c379e77e6117c828f10abf8d4f25c1ab3`

E2E suites:

- `node scripts/e2e-subagent-models.mjs`
- `node scripts/e2e-goal-report.mjs`
- `node scripts/e2e-team.mjs`
- `node scripts/e2e-plan-transcript-ui.mjs`
- `node scripts/e2e-team-review-ui.mjs`
- `node scripts/e2e-goal-team-renderer-ui.mjs`
- `node scripts/e2e-transcript-render.mjs`

Result: PASS, exit code 0 for all seven suites.

Environment: macOS, Node 22.23.2, existing host dependencies and Electron
reused by links; workspace package references resolve to the dedicated
integration worktree. TypeScript dependencies, runtime and Desktop were built
there. Host-core was rebuilt from the integration source with the primary
checkout's shared Cargo target. Host/Electron tests use isolated temporary
workspaces, HOME/data/profile where applicable and loopback mock providers or
explicit renderer API fixtures. No real provider or user desktop was used.

Additional checks: 363 runtime tests, 56 desktop tests, 18 Goal Rust tests,
30 i18n tests and 23 Plus changelog tests passed. Agent-runtime and Desktop
TypeScript checks, required package builds, Electron/Vite build, Biome lint,
style-token lint, Cargo format check, clippy, release-doc alignment and
diff whitespace checks passed. Clippy emitted two existing too-many-arguments
warnings in `plugins/install.rs` and `team/roster.rs`.

pnpm's wrapper rejects the linked hoist directory and attempts dependency
repair; no install was performed. The script-defined tsc, Vitest,
electron-vite, Biome and style-token commands were run directly with the same
existing binaries. Exact pnpm wrapper commands are not claimed to pass.

## PR integration validation

Fork PR: https://github.com/SakuraLoveSmile/PI-Desktop/pull/48.

Initial GitHub merge candidate: `4c3d15d0ba822ba5adfada5989ab74d201fcfd93`.
Its tree exactly matched PR head `ea6d64992ca6a5858a04ef666f72d4282955c5e1`;
compared with tested task candidate `bf04a7659`, only this evidence document
was added. Thus executable-tree equivalence applies to all seven E2E results.
The initial Docs check found two missing Chinese traceability rows; corresponding
scenario descriptions and rows were synchronized and local documentation gates
rerun. Later documentation-only commits do not change the tested executable
tree. Recheck the final merge ref and CI before landing; new executable changes
require affected validation again.

CI follow-up: the Rust test file exceeded the architecture limit after the new
regressions. Its three interruption/completion-eligibility tests were moved,
without changing assertions, into `goal_reports/tests/completion_eligibility.rs`;
the parent is now 980 lines. Cargo format, all 18 Goal tests and the architecture
gate passed. The full runtime suite also passed all 1,322 tests.

The complete desktop suite exposed three stale source-contract assertions for
Compact presentation. These were updated to retain error isolation, explicit
Compact expansion and full command copying in the appropriate header/detail
locations; all 42 tests in those suites passed. The mounted Chromium fixture
now clicks the real Compact copy button against an isolated clipboard boundary
and verifies the full multiline command byte-for-byte (45 turn-process checks
passed). The Settings specification and Chinese mirror were synchronized with
the previously documented Compact behavior. These follow-ups change tests and
documentation only, not production behavior. The complete desktop rerun passed
3,838 tests, with one existing published-package fixture skipped; no tests failed.

## Limits

Real-model delegation quality, token cost and latency: NOT RUN. No paid or
production endpoint was authorized. `verify:ui:*`: NOT RUN, not requested;
the isolated existing Electron suites above were run instead. The repaired
DMG build artifacts are not a new release from this PR. Source dirty worktrees
and archive branches remain recoverable pending the separate behavior choice
and any explicit destructive cleanup instruction.
