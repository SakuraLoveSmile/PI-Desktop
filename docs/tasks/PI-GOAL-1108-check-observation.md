# PI-GOAL-1108: Host checks Goal report commands without model-supplied references

- Project: `fork-pi-desktop`; task ID: `PI-GOAL-1108`; tier: T1; status: 实现中
  (S1 implemented and verified locally, nothing committed; S2 not started).
- Created: 2026-11-08 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user reviewed the Goal report feature, chose
  optimization 1 ("Host automatic checking"), accepted the default decisions
  D1–D4 below and told the executor to start the work on 2026-11-08. No commit,
  push, merge or release is authorized yet.
- Baseline: `4eb94398bea606ce140c9f45d9fe5fe46b25a909` (`origin/main`).
- Branch: `feat/20261108-pi-goal-1108-check-observation`.
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261108-feat-pi-goal-1108-check-observation`.
- PR: none.
- Target: remote `main`, not authorized yet.

## Problem statement

Goal reports carry `checks[]` (model claims) and `checkObservations[]` (Host
facts). A Host observation is only conclusive when the model fills
`evidenceRefs`, which must point to an `evidences[]` entry of kind
`tool_result` whose `refId` is the Bash `toolCallId`. The runtime already
appends an evidence-reference hint to every Bash result inside a Goal and real
models still skip it, so real reports show every observation `inconclusive`
(four of four in the reviewed Team+Goal runs). The Host already holds the
durable Bash results; it should find them itself.

Two further weaknesses sit in the same code:

- Unbound Goals (no `requiredVerificationCommands`) match references against
  the whole session, so a Bash result from before the execution can count.
- `durable_check_result` re-read the entire transcript and re-ran a full
  message query for every check.

## Scope

1. S1, refactor (behavior preserved): characterize the reference lookup, then
   move it behind one `ToolRunIndex` built once per submit or finalize.
2. S2, feature: for unbound Goals only, fall back to an exact-command match
   among the Bash runs of this execution's own turns, and scope the reference
   path to those turns as well. Spec, E2E scenario and changelog change with it.
3. S3, optional and deferred: drop the per-Bash reference hint in
   `packages/agent-runtime/src/runtime.ts` once real hit rates are known.

## Frozen decisions

- D1: bound Goals do not use command matching. `validate_native_checks` and the
  bound finalize path stay references-only and are not changed.
- D2: when the cited run and the last terminal run of the same exact command
  disagree, the later terminal run wins and the detail names both (unbound
  only).
- D3: provenance is written into the English `detail` text only; no schema,
  RPC or TypeScript change. A structured `source` field would be T2: stop and
  ask first.
- D4: observations are recorded only; they do not change whether a `met`
  report can complete.
- Also in S2: the unbound reference path is limited to this execution's turns
  (the bound turn plus resumed segments), like the bound path.

## Out of scope (reported as follow-ups)

- Bound path stale-pass hole: a cited earlier pass still counts when the same
  command fails later.
- A result with no integer exit code but `status: "success"` is reported as
  `passed`. Pinned by tests in S1, not changed.
- `evidenceResolution` and `checkObservations` disagree when a message id was
  remapped to a session-namespaced id.
- Commands run by Team expert member sessions are not in the Lead's turns, so
  v1 does not cover them.
- Report fields wired at one end only, report size caps and English prose in
  immutable reports.

## Acceptance scenarios

1. An unbound check with no `evidenceRefs` whose exact command ran in this
   execution gets `passed` or `failed` with the recorded exit code.
2. A later run of the same command with the opposite result wins.
3. Runs from turns before the execution, runs beyond the durable boundary and
   runs of other commands do not count.
4. Bound Goals validate, finalize and observe exactly as before.
5. No report schema, RPC shape, TypeScript type or UI component changes.
6. N checks read the transcript once.

## Limits to state in the delivery report

- An observation is not acceptance: the model chooses the command, and a
  pipeline's exit code is the last stage's.
- Exact matching misses `cd x && cmd` style commands.
- Team expert sessions are not covered in v1.
- Retrying an old failed report whose Bash messages carry no turn id yields
  `inconclusive` instead of a session-wide `passed` once S2 scopes the path.

## Implementation and acceptance

| Step | Surface | Acceptance | Result | Status |
| --- | --- | --- | --- | --- |
| S1a | `goal_reports/tests/reference_observations.rs` | pins the old lookup (exit codes, error flags, call id or message id, ambiguity, boundaries, unreadable transcript) on the unmodified code | 5 tests green on the old code | 完成 |
| S1b | `goal_reports/tool_index.rs`, `evidence.rs`, `mod.rs` (one line) | same tests green unchanged; N checks, one read; public signatures unchanged | 6 tests green; 12 of 12 mutations caught | 完成 |
| S2 | `evidence.rs`, new command-match module and tests, `mod.rs` call site, specs and zh-CN mirrors, E2E script and scenario doc, changelog | scenarios 1–5 above | not started | 未开始 |
| S3 | `runtime.ts` hint | decided from real hit rates | deferred | 未开始 |

S1 design notes:

- `tool_index.rs` holds the durable `tool` messages that pass the same filters
  as before (indexed row with role `tool` up to `durable_seq`, transcript role
  `tool`, owning turns when scoped). The lookup keeps the old rules: the first
  `tool_call` block whose `callId` or message id equals the reference, more
  than one matching message is ambiguous, and ambiguity ends the search.
- `evidence.rs` keeps the observation loop and the verdict mapping
  (`reference_verdict`); the index is built lazily for the first check that
  names a command.
- The only additions are two `tracing::warn!` lines when the transcript or the
  message query cannot be read. The observation text is unchanged.
- `seq` and the command lookup are deliberately absent from S1; they arrive in
  S2 so S1 carries no unused code.

## Execution and validation record

| Date | Revision / candidate | Environment | Command or action | Result / evidence |
| --- | --- | --- | --- | --- |
| 2026-11-08 | `4eb94398b` + tests only (old implementation) | macOS, rustc 1.98.0, cold worktree target dir | `cargo test -p host-core --locked reference_observations` | PASS: 5 passed, 0 failed |
| 2026-11-08 | `4eb94398b` + tests only | same | `cargo test -p host-core --locked goal_reports` / `goal_holds` | PASS: 45 passed / 24 passed |
| 2026-11-08 | S1 working tree (uncommitted) | same | the same `reference_observations` file, unchanged, plus `goal_reports` | PASS: all green |
| 2026-11-08 | S1 working tree | same | 12 mutations of the index and verdict code (ambiguity, message id, record tool name, owning turns, index error flag, success status, block type, envelope, ambiguity skip, unreadable mapping, command compare, per-check rebuild), each restored byte for byte | 12 of 12 caught by at least one test |
| 2026-11-08 | S1 working tree | same | `cargo fmt --all -- --check` | PASS |
| 2026-11-08 | S1 working tree | same | `cargo clippy --workspace --all-targets --all-features` | no warning in changed files; two existing `too_many_arguments` warnings in `plugins/install.rs:213` and `team/roster.rs:432` |
| 2026-11-08 | S1 working tree | same | `cargo test -p host-core --locked` | PASS: 1286 passed, 0 failed, 1 ignored |
| 2026-11-08 | S1 working tree | same | `node docs/scripts/check-docs.mjs` (this record added) | PASS: exit 0, 633 pages; only the existing ADR "Consequences" notes |

NOT RUN so far, with the reason:

- `node scripts/check-test-quality.mjs`: needs the TypeScript install of
  `apps/desktop`, which this worktree does not have. Not expected to change in
  S1: the baseline lists only JS/TS test files (235 `.mjs`, 2 `.ts`, no
  `crates/` entry), S1 touches no JS/TS file, and no JS test reads the changed
  Rust files as text (`scripts/e2e-goal-report.mjs` only names a data path).
  CI runs it on the pull request.
- `pnpm docs:scenarios`, the Electron E2E suites and hosted validation: S1
  changes no spec, scenario document, script or TypeScript file, so there is
  no observable behavior for them to cover yet. They apply to S2.

## Commit and integration

None. S1 and S2 are separate commits (a `refactor` and a `feat`); S2 is not
stacked on an uncommitted S1.

## Delivery and recovery

- Resume: open the worktree above, run `git status --short`, then read this
  record; old passing results are not current evidence.
- Rollback: S1 is a self-contained refactor plus tests; revert its commit.
- Runtime resources: none started. The worktree target directory is a normal
  Cargo build directory.
