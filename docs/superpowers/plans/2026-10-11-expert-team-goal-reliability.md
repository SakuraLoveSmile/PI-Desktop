# Expert Team and Goal Reliability Plan

Status: local P0/P1 repair candidates delivered, pending user experience; WP3b investigation complete (not reproduced); WP7 remains P2 backlog. Revision `team-goal-reliability-v1`, execution updated 2026-10-11.

## Baseline

- Base: `origin/main` = `05dc95412028d7e5a9bcedbb03e2d01f795da21a` (fetched 2026-10-11; unchanged since
  2026-10-08). Local `main` = `25602d52d510e98a3c8a6ac5d50fe42992c2d103` is 43 commits ahead of it and 0 behind;
  none of those commits is on `origin/main`. Line numbers below are at local `main` unless marked `[origin]`.
  The two refs differ in code and docs, so locate an anchor by symbol or text and re-verify it in WP-0.
  Section 3 explains why the difference matters.
- Plan branch: `docs/expert-team-goal-reliability-plan` (this file only; not committed).
- Evidence: a read-only review of session `2d56b76d`, a long Expert Team plus Goal run (first message
  2026-10-10 15:39; data copied at about 23:45, the run still active; all times UTC+08:00). Only the copies were
  read. The live data directory and the running session were not touched, and no fix in this plan has been
  executed.
- Related: ADR `docs/adr/plus-expert-team-collaboration.md` (completion gate :383-387, approval errors :118);
  plan `2026-09-30-expert-team-ux-reliability.md`.
- Implementation branches: one per work package (section 7), each cut from the then-current `origin/main`.

## 1. Goal and non-goals

Goal: an Expert Team plus Goal run finishes for the right reason, and when it cannot, it fails early and says why.
Four outcomes:

1. A goal report cannot be accepted while the team's dispatched work or incoming results are unsettled.
2. A member that dies is known to the lead at once, with the error code, instead of 17 or 76 minutes later.
3. A model's habitual Edit argument shape no longer costs an expert its turn.
4. Shell capacity and background-run limits are visible to the model instead of silently burning calls.

Non-goals:

- No change to roster confirmation, plan approval or goal negotiation.
- No weakening of permission, approval or sandbox checks, and no new automatic abort of running turns.
- No per-member git worktree isolation (its own ADR-first design) and no cost-cap enforcement design (backlog).
- No judgment of the code the run produced in the other repository (an engine-rewrite goal).

## 2. Evidence from the review

Run outcome: the lead's own draft report says 14 of 15 acceptance criteria met; the unmet one needs five tasks
through PR merge. The lead session has 1531 messages in 10 turns; one turn ran 364 minutes (1.85M input and 180K
output tokens). The goal execution ended `interrupted` at 22:00:32 with `TEAM_APPROVAL_REQUIRED` (stage
`team_completion`). The draft (recorded 21:59:51) was never finalized. Team: 5 experts, 6 tasks (4 completed,
2 in progress).

| # | Observation | Evidence | Effect |
| --- | --- | --- | --- |
| E1 | `SubmitGoalReport` accepted while the team was unsettled | at 21:59:51 four member reports to the lead (created 21:33 to 21:56) were unread (the lead read them in later turns, 22:40 to 23:15), one builder was still working through the lead's earlier dispatches (its turn ended 22:07), and two tasks were `in_progress`; the host ended the turn 41 s later | "done" was declared on a false basis |
| E2 | The terminal error blames the wrong cause | text says the lead "did not propose approved experts or coordinate actual expert participation"; the roster was confirmed and five experts had worked for hours | user and model are misdirected |
| E3 | Edit shape ended two member turns | `tag` + `old_string` + `new_string` without `ops` gives `INVALID_ARGUMENT: ops required`; `ops: PUT <n>:` without `+` rows gives `EDIT_PARSE_FAILED`; the third failure gives `MUTATION_RETRY_BUDGET_EXHAUSTED` (turn errors at 16:45:39 and 18:33:29) | one expert stayed `failed` to the end of the run; the other was re-dispatched 76 minutes later |
| E4 | A dead member tells the lead nothing | no member-to-lead mailbox row exists after either failure; the lead found out 17 and 76 minutes later | silent stall |
| E5 | `HOST_OVERLOADED` 104 times | lead 37, builders 32 and 24, scout 11; 76 were the agents' own `sleep N` polls | calls and minutes burned |
| E6 | Background test run killed at 60 s | audit: started 15:46:00, terminal 15:47:00; reruns with 600 s and 900 s were killed too (suite ~20 min); 1800 s worked | 4 wasted runs |
| E7 | A builder turn stayed `running` | no progress after an empty assistant message at 22:55 (turn running since 22:17) | member looks alive; lead waits |
| E8 | Write scopes unused, one shared git tree | `write_scopes` empty on all 6 tasks; the lead reverted a builder's commit while it was still working | lost or confusing work |
| E9 | Cost cap not enforceable | `costStatus` unknown on every call (custom provider); recorded goal cost 0 | the $50 cap is decorative |
| E10 | Backlog items | early Bash gate errors not actionable (6 calls); `declare_team_strategy` schema errors list constants without allowed values; members get `TodoWrite not found`; contexts reached 0.6-0.8M tokens with no compaction seen (observed, not re-verified) | friction |

## 3. Code baseline: what exists where

Fixes touch code that exists only on local `main`, and `CLAUDE.md` requires worktrees from `origin/main`. The original
OD1 default required local `main` to reach `origin/main` first for the packages marked "local-only" below.
The user explicitly overrode that prerequisite for this execution in section 15: use local `main` as the
base and do not push, open PRs or merge.

| Needed by | Symbol or file | origin/main | local main |
| --- | --- | --- | --- |
| WP1 | `validate_lead_tool`, `require_settled` (`team/authority.rs:43`, `team/execution_inbox.rs:131`) | same | same |
| WP1 | `confirmedAttempted` in `team/lead-execution-guard.ts` | absent | present (`f040181fd`) |
| WP1 | progress snapshot and `hasIncompleteProgress` in `goal-report-tool.ts` | absent | present (`8c3b6e792`) |
| WP2 | legacy arm in `tools/mod.rs` | present | present |
| WP3 | `team/task_attempts.rs` (provisional completion) | absent | present (`961e632b9`) |
| WP4 | `tool_budget.rs` | same | same |
| WP5 | `run_in_background`, `background_processes.rs`, its RPC and tests | absent | present (`81a3ee4f3`, `070b5c1df`) |
| tests | runtime regressions | `runtime.test.ts` | split into `runtime-tests/*` (`ed98fd818`) |
| gates | `pnpm check:test-quality` (`scripts/check-test-quality.mjs`) | absent | present |

Anchors that differ between the two:

| Anchor | local main | `[origin]` |
| --- | --- | --- |
| `onDraftSubmitted` in `runtime.ts` | 8898 | 8583 |
| `MUTATION_RETRY_BUDGET_EXHAUSTED` in `runtime.ts` | 8740 | 8431 |
| `tag` schema text in `runtime.ts` | 3297 | 3228 |
| generic override in `team/lead-execution-guard.ts` | 120 | 105 |
| `"ops required"` in `tools/mod.rs` | 1568 | 1565 |
| legacy Edit test in `tools/mod.rs` | 4732 | 4706 |
| `submit_draft` in `goal_reports/mod.rs` | 396 | 395 |
| `withTeamLeadApproval` in `runtime.ts` | 3954 | 3856 |
| `EMPTY_MODEL_RESPONSE` in `runtime.ts` | 8336 | 8046 |
| `EMPTY_MODEL_RESPONSE` in `packages/shared/src/errors.ts` | 113 | 107 |
| member phase update in `sessions.rs` (`update_member_turn_phase_conn` call) | 4380 | 4364 |
| `team.authorizeLeadTool` in `06-host-rpc-protocol.md` | 1630 | 1588 |
| Goal-report scenario in `04-e2e-test-plan.md` | 17524 | 17480 |
| shell-capacity scenario in `04-e2e-test-plan.md` | 759 | 712 |
| `SubmitGoalReport` draft paragraph in `02-agent-runtime.md` | 848 | absent |
| background `Bash` paragraph in `03-tools-and-permissions.md` | 685-694 | absent (:340 is the same) |

Which build ran the session is not known. It already had managed background Bash (the 60 s kill), which local
`main` has had since 2026-10-10 12:01. The goal-report and team-completion reconciliation commits (`8c3b6e792`,
`961e632b9`) are stamped 21:14, after the run began, so the run probably lacked them. Every package therefore
starts by re-running its repro on the chosen base (WP-0).

## 4. Binding decisions

- B1 Fix at the owner: host gates in `crates/host-core`, runtime wiring in the `packages/agent-runtime` team
  modules. No new logic in `runtime.ts`, `tools/mod.rs` or `sessions.rs` beyond a call site (architecture ratchet);
  new TS modules stay under about 500 LOC.
- B2 The completion gate only gets stricter for Goal plus Team runs. `TeamFinalAnswer` semantics for every other
  flow stay as they are.
- B3 Each defect gets a failing regression test first. Host rules get Rust tests; runtime wiring gets tests with a
  fake host.
- B4 One package is one branch and one worktree from fresh `origin/main`, once its prerequisites are on it.
- B5 Tests use fakes. No real provider, no live data directory, no running desktop instance.
- B6 Error text is data the model reads. Keep the precise host reason; never replace it with generic text; never
  put paths or secrets in it. The `TEAM_APPROVAL_REQUIRED:` prefix stays stable.
- B7 No new ADR unless a frozen boundary changes. WP1 and WP3a amend the existing Team ADR with dated sections.
  Automatic abort of stalled turns and per-member worktrees would each need a new ADR and are out of scope.

## 5. Intentional behavior changes (state them in each PR and the report)

1. In a Goal plus Team run, `SubmitGoalReport` fails while dispatched experts or their results are unsettled
   (was: accepted). A lead that wants to report `blocked` or `partial` must first wait or call `interrupt_agent`,
   the same rule that already applies to ending the turn (OD7).
2. A completion rejection keeps the host's reason in the terminal error; the recovery nudge names what is
   unsettled; confirmed rosters get up to three nudges (OD2).
3. Edit applies `old_string` and `new_string` when `ops` is absent even if `tag` is present, and malformed `ops`
   errors include a correct example.
4. A member turn that ends in error posts a structured failure message to the lead and wakes it.
5. The shell `HOST_OVERLOADED` result says who holds capacity and what to do instead of `sleep`.
6. Background process terminal records state the limit that applied and whether it was the default.
7. A write outside a member's task `write_scopes` produces a warning, never a denial.

## 6. Open decisions for the user (defaults apply if unanswered)

| ID | Question | Default |
| --- | --- | --- |
| OD1 | Land local `main`'s 43 commits on `origin/main` before cutting packages? | yes, through the normal PR path at the user's request; WP1 host part, WP2 and WP4 diagnostics may start earlier from `origin/main` |
| OD2 | Recovery nudge budget for confirmed rosters | up to 3 nudges, each naming what is unsettled; alternative is a host-driven bounded wait inside authorization (larger, needs an ADR) |
| OD3 | Legacy Edit shape with a supplied `tag` | ignore `tag` (the unique `old_string` match is the safety); alternative: validate the tag against the session chain and reject stale |
| OD4 | Shell capacity numbers (`MAX_IN_FLIGHT_SHELL` 4, 30 s wait) | diagnostics first; change numbers only on data from the next run; options: raise the cap, separate cap for managed background processes, longer wait |
| OD5 | Background Bash default timeout | keep 60 s (tools-and-permissions spec, D329) and fix the messaging |
| OD6 | PR granularity | one PR per package; 3a and 3b separate |
| OD7 | May a `blocked` or `partial` goal report bypass the settled gate? | no; same rule as the final answer, wait or `interrupt_agent` first |

## 7. Work packages

Priorities: P0 decides whether a run can be trusted, P1 removes the main time sinks, P2 is backlog. Each package
ends with a short report (files, commands run with results, deviations).

### WP-0 Per package: base, re-verification, worktree (no commit)

- `git fetch origin main`; confirm the OD1 outcome; `git worktree add -b <type>/<name> ../PI-Desktop-worktrees/<name> origin/main`.
- Reuse the host toolchain by link per the E2E environment-reuse rule; never `pnpm install` or `npm install`. In a
  linked worktree run binaries directly, and verify every `node_modules/@pi-desktop/*` link resolves inside the
  worktree before trusting a result.
- Re-run the defect's repro as a failing test on that base. If it no longer fails (the 21:14 commits may have fixed
  part of it), stop and report instead of patching (S2).

### WP1 (P0) Goal report and team completion gate

Problem: E1, E2.

Root cause, verified on local `main`:

- Every tool of a team lead session in `agent` or `plan` mode is wrapped by `withTeamLeadApproval`
  (`rebuildToolCatalog`, `runtime.ts:3952-3954`; `team/lead-tool-approval.ts:19`), and `SubmitGoalReport` is built
  with the other tools (`runtime.ts:3885`), so the wrapper asks the host through `team.authorizeLeadTool` before the
  tool body runs. But `validate_lead_tool` (`team/authority.rs:43`) applies `require_settled` only when
  `tool == "TeamFinalAnswer"` (`:84-89`). `SubmitGoalReport` passes after `require_expert_participation`, and its
  draft goes `onDraftSubmitted` (`runtime.ts:8898`) to `goalReports.submitDraft` (`goal_reports/mod.rs:396`).
- At turn end `TeamLeadExecutionGuard.authorizeCompletion` (`team/lead-execution-guard.ts`) asks the same RPC for
  `TeamFinalAnswer`, spends one nudge per phase (`:107-108`), then replaces the host's message with generic text
  (`:116-124`) and fails the turn. The nudge text (`TEAM_COMPLETION_NUDGE`) is static.
- `require_settled` (`team/execution_inbox.rs:131`) returns two fixed strings that name neither the member nor the
  task.

Changes:

1. Host: include `SubmitGoalReport` in the settled check in `validate_lead_tool`. The wrapper already authorizes
   every lead tool, so no TypeScript call site is needed and the tool result carries the host's reason.
2. Host: make the `require_settled` errors specific (pending member names, task ids, count of unconsumed results)
   from the same queries; keep the `TEAM_APPROVAL_REQUIRED:` prefix and the `wait_for_updates` instruction.
3. Runtime: in `authorizeCompletion`, when the roster is confirmed, keep the host message as the terminal error
   message (code and `stage: team_completion` unchanged); append the host reason to the recovery nudge; allow up
   to three nudges for confirmed rosters (OD2). Put the new logic in `team/` (a small helper or the guard itself),
   not in `runtime.ts`.
4. Before coding, check that `execution_inbox::state(...).active` (the condition around `require_settled`) is true
   in a lead turn woken by a teammate message. If it is false there, the gate is bypassed in exactly the turns that
   matter; stop and report (S1).

Tests (failing first):

- Rust (`team/authority_tests.rs`, `team/execution_inbox_tests.rs`): `SubmitGoalReport` is rejected with a queued
  dispatch, with a running expert turn and with an unconsumed result; allowed when settled; the message names the
  member; non-Goal Team flows and non-lead sessions are unchanged.
- TypeScript: new `team/lead-execution-guard.test.ts` with a fake host: confirmed roster keeps the host message;
  the nudge contains the reason; the third failure ends the turn; the unconfirmed path is unchanged. Wiring
  assertions go to `runtime-tests/runtime-team-completion.test.ts` (local-only; `runtime.test.ts` on origin).
- E2E (scripts exist: `scripts/e2e-team-approved-goal.mjs`, `scripts/e2e-goal-report.mjs`):
  `E2E-GOAL-report-waits-for-settled-team` and `E2E-TEAM-completion-error-keeps-host-reason`.

Docs: `docs/spec/03-runtime/08-error-codes.md:593` and the `TEAM_APPROVAL_REQUIRED` row (:386);
`docs/spec/03-runtime/02-agent-runtime.md:848` (local `main` only; state there that a draft is not accepted while
the team is unsettled);
`docs/spec/03-runtime/06-host-rpc-protocol.md:1630` (`team.authorizeLeadTool` covers `SubmitGoalReport`); a dated
amendment in `docs/adr/plus-expert-team-collaboration.md` (the :383-387 text already states the intent; the
implementation only gated `TeamFinalAnswer`); `docs/spec/06-delivery/04-e2e-test-plan.md` (near :17524);
`docs/project/plus-unreleased.md`; the `docs/zh-CN/` mirrors.

STOP: the change needs different `TeamFinalAnswer` semantics for non-Goal flows; it would gate a Team session that
never dispatched; new logic would land in `runtime.ts` beyond wiring.

Depends: changes 1, 2 and 4 need nothing (`authority.rs`, `execution_inbox.rs` and their test files are identical
on both refs). Change 3 needs `confirmedAttempted` (`f040181fd`), so OD1.

### WP2 (P0) Edit accepts a supplied tag with legacy arguments

Problem: E3.

Root cause, verified: in `tools/mod.rs:1518-1570` the legacy arm is `(None, None, Some(old), Some(new))`, so it
applies only when both `tag` and `ops` are absent. `tag` + `old_string` + `new_string` falls through to
`(_, None, _, _)`, which returns `INVALID_ARGUMENT: ops required` (:1568). The `tag` schema text
(`runtime.ts:3297`) says "Required unless legacy old_string/new_string is used", which invites the mixed shape.
`PUT <n>:` without `+` rows fails in `tools/hashline/parse.rs:123`. Three failures end the turn
(`MUTATION_RETRY_BUDGET_EXHAUSTED`, `runtime.ts:8740`). D273 says a model's habitual argument form is accepted,
not corrected.

Changes:

1. Add the arm `(_, None, Some(old), Some(new))` before `(None, _, _, _)`: legacy semantics whenever `ops` is
   absent. `tag` is ignored (OD3). `ops` present still wins.
2. Put one correct example (`PUT 48.=48:` then `+` body rows) into the `ops required` error and the
   `requires at least one + body row` error, and say that `new_string` is read only when `ops` is absent.
3. Keep the retry budget (3).

Tests: in `tools/mod.rs` beside `edit_accepts_legacy_old_string_new_string_shape` (:4732): `tag` + legacy applies;
`tag` + `ops` unchanged; `ops` plus legacy fields uses `ops`; zero or multiple `old_string` matches keep
`EDIT_LEGACY_MATCH_FAILED`; error text contains the example. TypeScript: `runtime-tests/runtime-mutation-guard.test.ts`
(local-only; `runtime.test.ts` on origin) only if an assertion pins the old text.

Docs: `docs/spec/03-runtime/18-line-anchored-edit-contract.md:27` says `old_string`/`new_string` are "Removed" while
the shipped tool, the changelog and the error table (:521, `EDIT_LEGACY_MATCH_FAILED`) accept them; correct the row to
"tolerated alias, applied when `ops` is absent (D273)". Add an amendment line to D273 in
`docs/spec/08-meta/decisions-log.md` (:308). Mirror in `docs/zh-CN/`. E2E:
`E2E-RUNTIME-edit-accepts-tag-with-legacy-arguments`. No ADR: a tolerance widens; no parameter, storage or
protocol is added.

STOP: the fix needs a change to `hashline::apply_edit` or the tag chain; a stale supplied tag would be applied
where it is rejected today and OD3 is not answered.

Depends: nothing; applicable on `origin/main`.

### WP3 (P0 and P1) A failed member reaches the lead; stalled turns

#### 3a (P0) Failure message to the lead

Problem: E4.

Root cause, verified: team dispatches are inserted with `notify_on_completion = 0` (`team/mailbox.rs:217-219`), so
`session_collaboration/settlement.rs:58` never emits a failure receipt for them. When a member turn ends in error,
the settle path sets `phase = failed` and the error (`sessions.rs:4373-4384` to `team/roster.rs:385`) and, on
local `main`, reverts the provisional task completion (`team/task_attempts.rs`), but writes nothing to the lead's
inbox. The `completion` rows in the mailbox are delivery acknowledgements (`mailbox.rs:406-420`), not results. A
member's result reaches the lead only if the member itself calls `send_message`. In the reviewed run the host did
record both failures: the lead's dispatch rows ended `failed` with `MUTATION_RETRY_BUDGET_EXHAUSTED` at the failure
instant, and no row from either member to the lead exists afterwards. The data was there; nothing delivered it.

Change: in the same transaction as the phase update, when a member turn ends with `error` (not user abort), insert
a host-authored team message from the member to the lead. Content: member name, error code, retriable flag, the
member's open task ids, suggested next action. Idempotency key `member-turn-failed:<turn id>`; bump the team
revision; record the source turn (`team-message-source-turn-v1`) so `wait_for_updates` returns it and
`require_settled` treats it as a result the lead must consume. Implement in a new `team/member_failure.rs`;
`sessions.rs` only calls it. Error code only; no raw error text, paths or secrets.

Alternative to weigh in the 3a worktree before coding: make `settlement.rs` `callback` emit its receipt for failed
team dispatches. It reuses an existing path, but the callback is shared with non-team flows, team code reads
`completion` rows as delivery acks, and `notify_on_completion` is 0 for every team dispatch by construction. Pick
this only if the `wait_for_updates` consumer can tell a failure receipt from an ack without a new message kind.

Tests: Rust: one message per failed turn, idempotent on replay, none on user abort or cancel, delivered through
`wait_for_updates`, completion blocked until consumed. TypeScript: `wait-for-updates` formatting of the failure
kind. E2E: `E2E-TEAM-member-failure-wakes-lead`.

Docs: dated amendment of `docs/adr/plus-expert-team-collaboration.md` (a host-authored message class in the Team
mailbox) and the matching Team protocol text in `docs/spec/03-runtime/06-host-rpc-protocol.md`; E2E docs; changelog.

STOP: carrying the message needs a schema change or migration (pause for an ADR and a version bump); waking an
idle lead needs a change in `agent-host` turn queue semantics.

Depends: the Rust part works on `origin/main`; tests that assert the provisional-completion revert need
`961e632b9` (OD1).

#### 3b (P1, repro first) Stalled member turn

Problem: E7. Root cause not known. One builder turn stayed `running` after an empty assistant reply. Searches of
`team/*.rs`, `agent-host/turn-queue.ts` and the runtime found no stall or idle watchdog; the runtime re-runs once
after a silent reply and then raises `EMPTY_MODEL_RESPONSE` (`runtime.ts:8336`; `packages/shared/src/errors.ts:113`).

Steps: (1) reproduce with a fake provider that returns an empty reply and then hangs; (2) if confirmed, make the
turn settle with `EMPTY_MODEL_RESPONSE`, or add a host-side "no activity for N minutes" mark that shows `stalled`
in `team_status` and posts the 3a message. The first PR marks and notifies only; auto-abort needs an ADR (B7).

STOP: not reproduced in two attempts. Report the evidence and keep it as an investigation; no speculative watchdog.

### WP4 (P1) Shell capacity: diagnostics and guidance

Problem: E5.

Root cause, verified: `tool_budget.rs:7-19` allows 4 shell calls host-wide (`MAX_IN_FLIGHT_SHELL`), 4 per session,
a queue of 64 and a 30 s wait (`TOOL_QUEUE_WAIT_MS`); `Bash` is the only shell-class tool. A managed background
process keeps its tool permit until it stops (`background_processes.rs:330` and `:384`; the `run_in_background`
description at `tools/mod.rs:3030` says it "keeps the same timeout and tool capacity until it stops"). Agents also
poll with foreground `sleep N`, which holds a slot for the whole sleep, so a few concurrent agents can fill all
four slots. The message the model reads names neither the holders nor an alternative: "host tool capacity is
exhausted; bounded queue is full (N queued)" or "host tool capacity did not become available in time"
(`tool_budget.rs:57-59`); `agent-errors.ts:455` classes the error as retryable.

Changes (each shippable alone):

1. Diagnostics: the shell `HOST_OVERLOADED` result carries in-flight and queued counts (own session and
   host-wide) and a hint: background processes and long `sleep` hold a slot; use `wait_for_updates` or a background
   process and check back.
2. Guidance: the Bash tool description and the lead and member prompts say not to poll with `sleep`.
3. Capacity numbers change only under OD4.

Tests: `tool_budget/tests.rs` for the payload and for unchanged admission order; runtime test that the hint reaches
the tool result.

Docs: `docs/spec/03-runtime/06-host-rpc-protocol.md:53-65`; `08-error-codes.md:49`; E2E docs near
`04-e2e-test-plan.md:759`.

STOP: any change that lets a session exceed host-wide caps or bypasses approval; changing `TOOL_QUEUE_WAIT_MS`
without its mirror in `packages/shared/src/rpc-timeouts.ts`.

Depends: items 1 and 2 apply to `origin/main`; wording about background processes needs WP5's code (OD1).

### WP5 (P1) Background Bash: make the limit visible

Problem: E6. This is not a clock defect: `DEFAULT_BASH_TIMEOUT_MS = 60_000` (`tools/mod.rs:41`) also applies to
`run_in_background` by contract (`docs/spec/03-runtime/03-tools-and-permissions.md:693`, D329), and the
`run_in_background` text does not say so.

Changes:

1. The `run_in_background` and `timeout` descriptions state "default 60 s; pass `timeout` in seconds (1-21,600)
   for long runs".
2. A `timed_out` terminal record (`background_processes.rs:413`) and its notification state the limit that applied
   and whether it was the default.
3. Check whether a background process exit or timeout wakes a lead blocked in `wait_for_updates`; if not, add it
   through the existing notification path, not a new one.
4. A higher background default only under OD5.

Tests: `background-bash.test.ts` (local-only), `rpc/background_processes_tests.rs` (local-only).
Docs: `03-tools-and-permissions.md:340` and `:685-694`; a D329 amendment only if OD5 changes the default; E2E
`E2E-RUNTIME-background-bash-timeout-is-visible`.
Depends: entirely local-only code (`81a3ee4f3`, `070b5c1df`), so OD1.

### WP6 (P1) Write scopes and the shared tree

Problem: E8. `write_scopes_json` is advisory and was empty on all tasks.

Changes:

1. Warn, never deny: a `Write` or `Edit` result for a member whose current task has non-empty `write_scopes` and
   whose path is outside them appends a warning, and `team_status` lists the count of out-of-scope writes. Shell
   writes cannot be attributed and are not covered.
2. Lead prompt: set `write_scopes` on file-editing tasks; dispatch messages carry the sender's HEAD at send time.
3. Per-member git worktree isolation is a separate ADR-first design (not this plan).

Tests: Rust for the scope predicate; TypeScript for the warning in the tool result. E2E `E2E-TEAM-write-scope-warning`.
Docs: Team ADR dated amendment (same PR style as 3a), E2E docs, changelog.
STOP: turning the warning into a denial (permission semantics change; needs an ADR and a user decision).
Depends: after 3a so one ADR amendment covers both.

### WP7 (P2) Backlog, one small PR each

- Custom providers report unknown cost: show that, or state at goal negotiation that the cost cap is not
  enforceable (E9).
- Contexts of 0.6-0.8M tokens with no compaction seen: check the compaction trigger for team members (E10).
- Actionable early-gate errors (name the next step) and `declare_team_strategy` schema errors (list allowed values).
- `TodoWrite` for members, or a clear "not available" message instead of `not found`.
- Member `phase = completed` means "last turn ok"; a task can stay `in_progress` after that. Decide whether
  completion should warn about owned tasks left open (not covered by `require_settled`).
- Notification noise during long team turns.
- A goal contract with a human gate inside an autonomous goal: warn at negotiation.

## 8. Delivery order

| Package | Priority | Base | Depends on | Can run in parallel with |
| --- | --- | --- | --- | --- |
| WP1 host (1, 2, 4) | P0 | `origin/main` | none | WP2, WP4 |
| WP1 runtime (3) | P0 | after OD1 | `f040181fd` | WP2 |
| WP2 | P0 | `origin/main` | none | WP1, WP4 |
| WP3a | P0 | `origin/main`; revert tests after OD1 | none | WP4 |
| WP3b | P1 | after repro | none | any |
| WP4 | P1 | `origin/main` | none (background wording: OD1) | WP1, WP2, WP3a |
| WP5 | P1 | after OD1 | `81a3ee4f3`, `070b5c1df` | WP4 |
| WP6 | P1 | after 3a | 3a | WP5 |
| WP7 | P2 | per item | per item | any |

Recommended order: OD1, then WP1 and WP2 in parallel, WP3a, WP4, WP5, WP6; WP3b once reproduced.

## 9. STOP rules (stop and report; do not improvise)

- S1 A gate or hook does not run where this plan assumes (for example `state.active` is false in a teammate-woken
  turn, or a lead tool is not wrapped).
- S2 The defect no longer reproduces on the chosen base.
- S3 A package needs a new RPC, a schema change or migration, or a frozen-boundary change without an ADR.
- S4 A fix would weaken a permission, approval, sandbox, URL or filesystem check.
- S5 New logic would land in a ratchet file beyond a call site (`runtime.ts`, `tools/mod.rs`, `sessions.rs`,
  `app-store.ts`, `plugins.rs`, `db.rs`).
- S6 A step needs the live data directory, a real provider, or a running desktop instance.
- S7 A step needs `pnpm install` or `npm install` in a linked worktree.
- S8 A required change touches a file outside the package's list without a reason recorded in the report.

## 10. Acceptance criteria

- WP1: in a fake Goal plus Team run with one expert still running, `SubmitGoalReport` fails with a message naming
  that expert; after `wait_for_updates` consumes the result it succeeds; the terminal error after exhausted nudges
  quotes the host reason, not the generic text; non-Goal flows behave as before.
- WP2: `tag` + `old_string` + `new_string` applies the edit once; `tag` + `ops` is unchanged; the two error
  texts contain a correct example; the retry budget is unchanged.
- WP3a: a member turn that errors yields exactly one failure message to the lead, delivered by `wait_for_updates`,
  none on abort, and the lead cannot complete until it consumes it.
- WP3b: either reproduced and covered by a test, or reported as not reproduced.
- WP4: the shell `HOST_OVERLOADED` result names counts and the alternative; admission order and caps are unchanged.
- WP5: a `timed_out` background record shows the limit and whether it was the default; descriptions state the default.
- WP6: an out-of-scope write succeeds with a warning and is counted in `team_status`.

## 11. Test plan

| Layer | Where | Covers |
| --- | --- | --- |
| Rust unit | `team/authority_tests.rs`, `team/execution_inbox_tests.rs`, new `team/member_failure` tests, `tool_budget/tests.rs`, `tools/mod.rs` tests, `rpc/background_processes_tests.rs` | gates, failure message, capacity payload, Edit arms, background records |
| Runtime (fake host) | new `team/lead-execution-guard.test.ts`, `runtime-tests/runtime-team-completion.test.ts`, `runtime-tests/runtime-mutation-guard.test.ts`, `background-bash.test.ts` | guard, nudge, wiring, error text |
| E2E | `scripts/e2e-team-approved-goal.mjs`, `scripts/e2e-goal-report.mjs`, new scenarios named below | cross-process behavior |

New semantic scenario IDs: `E2E-GOAL-report-waits-for-settled-team`, `E2E-TEAM-completion-error-keeps-host-reason`,
`E2E-TEAM-member-failure-wakes-lead`, `E2E-TEAM-write-scope-warning`,
`E2E-RUNTIME-edit-accepts-tag-with-legacy-arguments`, `E2E-RUNTIME-background-bash-timeout-is-visible`.
Assertions check behavior and stable contracts, not source or CSS text (`pnpm check:test-quality`).

## 12. Docs, E2E docs, changelog

Specs and ADR are listed per package in section 7. In addition: every touched `docs/spec/` file gets its
`docs/zh-CN/` mirror; `docs/spec/06-delivery/04-e2e-test-plan.md` gets the new IDs; `docs/project/plus-unreleased.md`
gets entries for WP1, WP2 and WP3a (user-visible behavior). Pure error-text improvements still update the
error-code spec.

## 13. Validation and delivery

Run only checks that match the surface:

- Rust: `cargo fmt --check`, `cargo test -p host-core --locked` (filtered per package), `cargo clippy -p host-core --all-targets`.
- JS: targeted test files per package; `pnpm --filter @pi-desktop/desktop typecheck` and `pnpm lint` where wiring
  changed. In a linked worktree run binaries directly, not through pnpm.
- Gates: `node scripts/check-architecture.mjs`, `node scripts/check-test-quality.mjs --base <base>` (the
  `pnpm check:test-quality` script; on local `main` only until OD1) and `node scripts/check-pr-base-main.mjs` (the
  `pnpm check:pr-base` script) before any PR. The `node` forms avoid running pnpm in a linked worktree.
- E2E: refresh the branch against the latest `origin/main`, then run the package's scripts on the task candidate
  using the primary checkout's environment. Record:

```text
Task candidate:
Base main:
E2E suites:
Result:
Environment:
```

Report `NOT RUN` with reason, alternative validation and remaining risk for anything skipped. Nothing is pushed,
no PR is opened and nothing is merged without an explicit request. After a verified, user-authorized merge, remove
the package's own worktree and merged branch and report the cleanup separately.

## 14. Risks and unverified items

- R1 The tested build is unknown (section 3). A defect may already be fixed by `8c3b6e792` or `961e632b9`.
- R2 The settled gate may not hold in teammate-woken turns (WP1 item 4). Unverified.
- R3 Gating `SubmitGoalReport` forces a lead that wants to give up to interrupt or wait first (OD7).
- R4 The failure message in 3a could trigger re-dispatch loops. The message carries the retriable flag and the
  suggested action; a retry cap, if needed, is a lead-prompt matter, not a host rule.
- R5 Test files differ by base: `runtime.test.ts` on `origin/main`, `runtime-tests/*` on local `main`.
- R6 Not verified: why the builder turn stayed `running`; how much of the 17 and 76 minute delay came from
  `wait_for_updates` timeouts rather than missing events; the full diff the run produced in the other repository.
- R7 Cost visibility for custom providers has no fix here (WP7).


## 15. Execution record (2026-10-11)

Status: six local repair candidates are ready for user experience. The user explicitly authorized execution of this plan; no publication or integration is authorized.

- OD1 override: the user authorized each work package to start from local `main`
  `25602d52d510e98a3c8a6ac5d50fe42992c2d103`. No push, PR opening or merge is authorized.
  A fresh fetch confirmed remote `origin/main` is still `05dc95412028d7e5a9bcedbb03e2d01f795da21a`.
- OD2-OD7: apply the plan defaults. Keep host limits, the 60-second background default and non-Goal completion semantics.
- WP1 verification distinguishes messages consumed inside the original approved execution (`active=true`)
  from mailbox continuations after that execution has ended (`active=false`, Goal tools already removed).
  The user permits a necessary current-Goal scope adjustment, but implementation must not grant a
  subsequent ordinary turn the previous Goal tools or execution token. Verify the actual original-turn path first.
- Each package owns its dedicated worktree and all package-specific source, tests, specifications,
  translated mirrors and fixture edits. No writer edits another package worktree.
- WP1, WP2, WP3a, WP4 and WP5 run concurrently on isolated fixture data; WP6 waits for the WP3a commit.
  WP3b is a bounded fake-provider investigation before any watchdog. WP7 remains P2 backlog;
  its undecided product designs are not silently implemented.
- The primary checkout, previous Composer candidates, running sessions and `~/.pi-desktop-plus` are preserved.
- Tests reuse the primary provisioned toolchain and Cargo cache. Candidate Host binaries are copied
  after compilation before cross-process testing so another package cannot substitute an old executable.


### Final local candidates

| Package | Candidate | Outcome |
| --- | --- | --- |
| WP1 | `5142aeaa90adbee73e6d0ce5ca18d34589b2ca9b` | Implemented and candidate-verified; pending user experience. |
| WP2 | `48c91900fd3e46c0c001ce73f95db27e466f0182` | Implemented and candidate-verified; pending user experience. |
| WP3a | `62d22d09297b84cf65f8c8a37fefac4aeae78173` | Implemented and candidate-verified; pending user experience. |
| WP3b | `865e9db5e11365950090b2b918c1792deb05c87f` | Bounded investigation: long-running member not reproduced; no watchdog added. |
| WP4 | `bc6806279b276382d80da38b526a9aeb811850e2` | Implemented and candidate-verified; pending user experience. |
| WP5 | `08d9ed3dcb296651f2f58841a9a08ce4ec265d70` | Implemented and candidate-verified; pending user experience. |
| WP6 | `3cbf0a19ea838babb5c720b13c5c13c390bcd5be` | Implemented and candidate-verified; pending user experience. |

WP7 remains P2 backlog; it is not counted as implemented. All seven implementation/investigation worktrees are clean. Main remains unchanged. Full commands, evidence, retained limitations and branch paths: historical external execution record: `/Users/developer/Documents/Code/Project/Fork Project/PI-Desktop-delivery/20261011-expert-team-goal-reliability/EXECUTION.md`.

Review corrections included complete sanitized rejection reasons, RPC-wrapped error recognition, trusted roster cancellation, failure notice delivery after checkpoint faults, background completion between waits, complete HEAD projections, sender-turn/scope fences and deletion-safe warning counters. WP6 mechanically extracted the existing send-message RPC arm to its domain owner to satisfy the architecture ratchet; it did not expand the limit allowlist. No new RPC or database migration was introduced.
