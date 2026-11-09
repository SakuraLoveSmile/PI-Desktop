# PI-GOAL-1108: Host checks Goal report commands without model-supplied references

- Project: `fork-pi-desktop`; task ID: `PI-GOAL-1108`; tier: T1; status: 待体验
  (S1 and S2 merged in PR #77 and published in v0.15.13; user acceptance
  pending; S3 deferred).
- Created: 2026-11-08 (Asia/Taipei).
- Authoritative record: this file. Linked evidence only supplements it.
- Goal / authorization: the user reviewed the Goal report feature, chose
  optimization 1 ("Host automatic checking"), accepted the default decisions
  D1–D4 below and told the executor to start the work on 2026-11-08. The user
  authorized the S1 and S2 commits, then the push and the PR, then on
  2026-11-08 the merge and the release ("请你合并并发布"); the release was
  published on 2026-11-09 under `PI-REL-01513`.
- Baseline: `4eb94398bea606ce140c9f45d9fe5fe46b25a909` (`origin/main`).
- Branch: `feat/20261108-pi-goal-1108-check-observation` (merged; the local
  branch is deleted, the remote branch is kept).
- Worktree: `/Users/sakurasep/Documents/Code/Project/Project Worktree/fork-pi-desktop/20261108-feat-pi-goal-1108-check-observation`
  (removed after the merge).
- PR: [#77](https://github.com/SakuraLoveSmile/PI-Desktop/pull/77), merged as
  `e758c88d918ebc80a82b23f56c031ab9f5f54dc3` on 2026-11-08T14:57:49Z.
- Release: [v0.15.13](https://github.com/SakuraLoveSmile/PI-Desktop/releases/tag/v0.15.13),
  published 2026-11-09T04:14:00Z (task `PI-REL-01513`).
- Target: remote `main` (landed).

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
2. S2, feature: for unbound Goals only, fall back to a command match (whole
   command text, surrounding whitespace ignored) among the Bash runs of this
   execution's own turns, and scope the reference path to those turns as well.
   Spec, E2E scenario and changelog change with it.
3. S3, optional and deferred: drop the per-Bash reference hint in
   `packages/agent-runtime/src/runtime.ts` once real hit rates are known.

## Frozen decisions

- D1: bound Goals do not use command matching. `validate_native_checks` and the
  bound finalize path stay references-only and are not changed.
- D2: when the cited run and the last terminal run of the same command
  disagree, the later terminal run wins and the detail names both (unbound
  only). As built, the last finished run decides whenever the cited run is not
  that run, whether or not the two agree on the result, and the detail names
  both.
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

1. An unbound check with no `evidenceRefs` whose command (surrounding
   whitespace ignored) ran in this execution gets `passed` or `failed` with
   the recorded exit code.
2. A later run of the same command with the opposite result wins.
3. Runs from turns before the execution, runs beyond the durable boundary and
   runs of other commands do not count.
4. Bound Goals validate, finalize and observe exactly as before.
5. No report schema, RPC shape, TypeScript type or UI component changes.
6. N checks read the transcript once.

## Limits to state in the delivery report

- An observation is not acceptance: the model chooses the command, and a
  pipeline's exit code is the last stage's.
- Matching compares the whole command text (surrounding whitespace ignored), so
  it misses `cd x && cmd` style commands.
- Team expert sessions are not covered in v1.
- Retrying an old failed report whose Bash messages carry no turn id yields
  `inconclusive` instead of a session-wide `passed` once S2 scopes the path.

## Implementation and acceptance

| Step | Surface | Acceptance | Result | Status |
| --- | --- | --- | --- | --- |
| S1a | `goal_reports/tests/reference_observations.rs` | pins the old lookup (exit codes, error flags, call id or message id, ambiguity, boundaries, unreadable transcript) on the unmodified code | 5 tests green on the old code | 完成 |
| S1b | `goal_reports/tool_index.rs`, `evidence.rs`, `mod.rs` (one line) | same tests green unchanged; N checks, one read; public signatures unchanged | 6 tests green; 12 of 12 mutations caught; commit `13e2cfd10` | 完成 |
| S2 | `evidence.rs`, `evidence/command_match.rs`, `tool_index.rs`, `mod.rs` call site, tests, specs and zh-CN mirrors, E2E script and scenario doc, scenario index, changelog | scenarios 1–5 above | implemented, verified locally, committed and merged in PR #77; see the validation record | 完成 |
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

S2 design notes:

- Two entry points share one observation loop. `execution_check_observations`
  (bound Goals) keeps references-only matching. `unbound_check_observations`
  adds the command match and is what `finalize_with_closure` calls when the
  approval carries no required commands. Both read only the execution's own
  turns: the bound turn plus the resumed segments of its hold. The session-wide
  `generate_check_observations` is removed.
- Per check with a non-blank command, the cited run is resolved exactly as in S1
  (`cited_run`: evidence order, ambiguity, byte-exact command). Unbound only,
  `command_match::settle` then collects the Bash runs whose command equals the
  check's command ignoring surrounding whitespace, keeps those that ended with a
  verdict (error flag, integer exit code or success status), and lets the last
  one by `messages.seq` decide:
  - the cited run is the last finished run: the reference verdict, text
    unchanged;
  - the cited run is earlier: the last run decides and `detail` names both
    calls (D2);
  - no usable cited run (none, unresolvable, or ambiguous): the last run decides;
  - no finished run: `inconclusive` with the reason: the command never ran, it
    ran but no run recorded how it ended, or the S1 ambiguity text.
- Provenance lives only in the English `detail` (D3); `evidenceIds` keeps
  echoing the check's own `evidenceRefs`, with no synthetic ids.
- Tests: shared helpers moved to `tests/observation_support.rs`. The S1
  reference tests now run on the bound entry point only; their session-wide
  half pinned the behavior S2 deliberately removes. `tests/command_match.rs`
  covers the unbound path and one finalize-level report. The fixture of
  `test_evidence_resolution_and_check_observations` gained a bound turn and a
  `turn_id` on its tool row; the old row had none, which the scoped path rightly
  ignores.

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
| 2026-11-08 | S2 working tree on `13e2cfd10` (uncommitted) | same | `cargo test -p host-core --locked goal_reports` | PASS: 55 passed, 0 failed |
| 2026-11-08 | S2 working tree | same | 23 mutations of the command match, the index and the call sites (first instead of last run, cited run always final, fallback dropped, ambiguity hidden, no-run and unfinished swapped, rank counts, replaced run not named, rank text, runs unsorted, run and check command not trimmed, non-Bash runs, same-call comparison both ways, owning turns, boundary, unbound references only, bound uses command match, resumed segments, error flag, ambiguity skipped, bound gap text, finalize entry point), each restored byte for byte | 23 of 23 caught by at least one test |
| 2026-11-08 | S2 working tree | same | `cargo fmt --all -- --check` | PASS |
| 2026-11-08 | S2 working tree | same | `cargo clippy --workspace --all-targets --all-features` | no warning in changed files; the same two existing `too_many_arguments` warnings |
| 2026-11-08 | S2 working tree | same | `cargo test -p host-core --locked` | PASS: 1295 passed, 0 failed, 1 ignored (S1 had 1286; the nine new tests are in `tests/command_match.rs`) |
| 2026-11-08 | S2 working tree | same | `node docs/scripts/check-docs.mjs`, `node docs/scripts/check-locales.mjs` | PASS: 633 pages (only the existing ADR "Consequences" notes), 95 English/Chinese pairs |
| 2026-11-08 | S2 working tree | same, `NODE_PATH` pointing at the primary checkout's `node_modules` for TypeScript (read-only) | `node scripts/generate-scenario-index.mjs` then `--check` | regenerated: only the two `E2E-GOAL-UI-00x` line anchors moved (64 to 66, 225 to 252), in the English and zh-CN index; `--check` reports current |
| 2026-11-08 | S2 working tree | same | `node scripts/check-test-quality.mjs` | PASS: exit 0; baseline untouched |
| 2026-11-08 | S2 working tree, host binary built in this worktree | same, `PI_DESKTOP_HOST_BIN` pinned to `target/debug/pi-desktop-host-core`; `packages/shared/dist/ndjson.js` transpiled locally from the tracked source (gitignored, local-only shim) | `node scripts/e2e-goal-report-ui.mjs` | PASS: 2 of 2, including the new chk-3, chk-4 and chk-5 assertions |
| 2026-11-08 | S2 working tree with the unbound entry point forced to references only | same | the same E2E after a rebuild | red as intended: `E2E-GOAL-UI-001` fails on chk-3 with the old "No durable tool result matched the check evidence." text; restored source and rebuilt binary: PASS 2 of 2 |
| 2026-11-08 | `064813150` (PR #77 head) | GitHub-hosted, manual `workflow_dispatch` on the PR head (Actions was disabled when the PR opened, so no `pull_request` run fired) | `ci.yml` [run 42491215756](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42491215756) | PASS: all three jobs (JS build / typecheck / lint / architecture / test; isolated smoke; Rust host-core format / lint / test) |
| 2026-11-08 | `064813150` | GitHub-hosted, manual dispatch | `docs-check.yml` [run 42492198737](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42492198737) | PASS |
| 2026-11-08 | `064813150` against base `4eb94398b` | local worktree | `node scripts/check-pr-base-main.mjs` (`pr-base.yml` runs on `pull_request` only) | PASS (the script and its 3 unit tests); the hosted `pr-base.yml` run is NOT RUN |
| 2026-11-08 | PR #77 | GitHub | `gh pr merge 77 --merge --match-head-commit 064813150...` | Merged as `e758c88d9` at 14:57:49Z; remote `main` was still `4eb94398b`, so the merged tree equals the tested head tree |
| 2026-11-09 | `f9cbc4b37` (contains this change) | GitHub-hosted | PR #78's five checks and the `v0.15.13` tag run [42559184767](https://github.com/SakuraLoveSmile/PI-Desktop/actions/runs/42559184767), which reuses `ci.yml` | PASS (see `PI-REL-01513`) |

NOT RUN, with the reason:

- Electron and visual UI E2E (`verify:ui:*`): the renderer is unchanged and
  those suites run only on explicit request.
- Hosted `pull_request` runs for PR #77: they never fired because GitHub
  Actions was disabled when the PR opened. The manual dispatches above replaced
  `ci.yml` and `docs-check.yml`; the hosted `pr-base.yml` run did not happen
  (its script ran locally).
- Any real provider or model run: not authorized. The hit rate of the command
  match on real model runs is therefore unmeasured, and S3 depends on it.
- The `pnpm` wrappers (`pnpm docs:check`, `pnpm docs:scenarios`,
  `pnpm check:test-quality`): pnpm is not run inside this worktree. The
  underlying `node` scripts ran instead, with module lookup pointed read-only at
  the primary checkout's `node_modules`.

## Commit and integration

- S1: `13e2cfd10` `refactor(host-core): index tool messages once per Goal report
  pass`, authorized by the user on 2026-11-08.
- S2: `064813150` `feat(goal): match unbound check commands to the Goal's Bash
  runs`, the commit directly above S1, with the `Task: PI-GOAL-1108` trailer;
  authorized by the user on 2026-11-08. It carries code, tests, specs, the E2E
  script, the scenario index and the changelog together.
- Both landed in PR #77, merged as `e758c88d9` (2026-11-08) and published in
  `v0.15.13` (2026-11-09, `PI-REL-01513`). The remote branch is kept.

## Delivery and recovery

- Entry point: the Goal report observations in the 0.15.13 release; see
  `PI-REL-01513` for the published assets.
- Resume: the worktree was removed after the merge. Start a new branch from
  `origin/main` for S3 or any follow-up, and read this record first; old
  passing results are not current evidence.
- Rollback: S1 and S2 are self-contained commits; revert them in reverse order
  on a new branch from `main` (a shipped change needs a new release). S2
  changes no schema, RPC shape, TypeScript type or stored report format, so
  reports finalized under S2 stay readable by S1 and the baseline.
- User confirmation: none yet; acceptance remains pending explicit user
  confirmation (已验收). Whether the command match hits on real model runs is
  unmeasured.
- Runtime resources: none left running. The worktree, its Cargo target
  directory and the ignored local E2E shim were removed with it.
