# Team roster resume validation

Date: 2026-10-11. Request baseline: `26db50438`.
Branch: `codex/team-roster-resume`. Local commits only; no push, PR or merge.

## Package A: confirmed model-context result

The original candidate checks below are historical results, not validation of
the execution-wide projection described in the follow-up section.

S0 source verification established that original tool events/fullEntries own
UI/outbox/history. Tool details survive history reconstruction. Initial
pi-agent-core 1.0.1 continuation snapshots Agent state without the later
prepareNextTurn rebuild. Compaction reads original entries, and only system
messages pass through system-journal persistence. The projection uses fresh
review members and omits stale declaration-time memberSessionIds. Queued
confirmation mail is not a current expert result and does not block dispatch or
completion; no inbox-consuming Host side effect was added. Process restart
continues to interrupt this in-memory wait, with no new replay.

Baseline replay on unmodified `26db50438` (21:35 local time): R1 and R5 failed;
R2 reproduced four confirmation wakeups containing pending declarations, zero
send_message and terminal TEAM_APPROVAL_REQUIRED. The temporary R2 case was
retired after recording this result; R6 preserves the same bounded fallback
without a production bypass switch. Baseline completion/strategy/tools suites
passed 77 tests once the request's own shared package was built.

Candidate A checks:

- R1 (original candidate): recovery request sees confirmed roster, no stale session IDs; owned
  task and dispatch occur once, within original Goal execution and turn.
  Original tool object, tool_end and liveSessionContext remain pending.
- R3/R4: parked cancellation/interruption and Stop, Stop during a held fresh
  review read, and cancellation/interruption during that read never dispatch.
  The latter two first failed (3 requests versus expected 2), then passed after
  terminal review handling was added.
- R5/R6: confirmation between reads dispatches once; an unmatched declaration
  retains the four wakeups (one roster resume plus three completion retries)
  and terminal denial.
- R7: latest matching result, copy-on-write, unrelated/error/missing matches,
  idempotence and equality with the live confirmed tool payload.
- 57 tests passed across roster replay, helper and existing completion suites.
  Project build `node node_modules/typescript/bin/tsc -b packages/agent-runtime`
  passed. Runtime strategy and tool suites previously passed, with no changes
  to their behavior in A.
- Test-quality gate against `26db50438`, configured Biome lint and diff
  whitespace checks passed. Independent review identified the fresh-read
  cancellation window; the corrected increment was independently re-reviewed.

## Package B: waiting and role guidance

The pending result and approved Lead system prompt share the two supported
waiting choices: wait_for_updates or end the assistant message while Host keeps
execution open. A runtime-owned approvedExecution flag selects only that prompt
variant, including the first approved Plan request after mode switching.
Ordinary Team confirmation and automatic Plan research guidance remain intact.
Presentation role schema describes all five existing enum values and maps
builders to executor without adding a value or permission.

R8 initially failed on the absent role description and old waiting text, then
passed. Actual provider-schema validation accepts all five values (including
builder routing name with executor presentation) and rejects the builder role.
R9 existing Team strategy/tools/prompt/completion cases were run.

Final combined run: 113 tests passed in seven suites (roster replay, declaration
helper, roster guidance, existing team-tools, team-prompt, runtime-team-strategy
and runtime-team-completion). Actual approved Plan/Goal provider requests carry
approved waiting guidance; ordinary Team and Plan research retain their paths.
Runtime project build passed. Independent B review found stale approved guidance
after reusing the runtime for ordinary Team requests; both approved Plan/Goal
reuse regressions first failed, then passed after ordinary Team Lead startup
explicitly recomposed the prompt. The increment was independently re-reviewed.
Final combined validation ran at 21:47 local time. Test quality, configured lint,
diff checks and request-head ancestry passed on the final local candidate.

## Environment and acceptance limits

Dependencies are referenced from the primary host environment; no separate
install was performed. Workspace package links point to this request's source
and its own generated shared/runtime dist. The primary shared dist initially
lacked normalizeSubagentLimits; rebuilding shared locally resolved that
compatibility failure. pnpm 12 refused linked task-state/hoist directories and
tried its automatic-install path, so validation invokes the installed Vitest,
TypeScript and Biome binaries directly. No host dependency tree was modified.

The request baseline contains fetched origin/main
`05dc95412028d7e5a9bcedbb03e2d01f795da21a`. The primary checkout is untouched.

## Real-model attempt: pre-roster acceptance remains unverified

After the original minikv prompt was provided, one isolated production
Electron/Main/Host/sidecar attempt ran with MINIKV-GOAL-TEST-2 on candidate
3968c4160882. The real CPA gemini-3.8-flash-high Lead used high thinking. The
candidate UI and Rust Host were built from this checkout; the installed App and
primary database were untouched. One setup-only attempt selected the plugin
launcher instead of the main window and timed out without a prompt/model call;
that selector was corrected before the single real Goal run.

Goal negotiation and real UI Auto approval succeeded. Execution
97067fe7-2375-41a9-b285-cfb7a07c818a / turn
f4aa54bc-b33f-4113-b853-a42a952d2ccc started at 2026-10-11 22:05:47.554
Asia/Taipei. After 240.223 seconds there was no new output/tool, no declaration,
no roster, no task and no expert. The harness's 240-second pending-roster wait
expired (total run 306 seconds); this was not a product/provider timeout. No
TEAM_APPROVAL_REQUIRED or provider error was recorded. Request-level telemetry
was unavailable, so the waiting stage's cause and internal retry count remain
unknown. The A-prime confirmation recovery path was **NOT EXERCISED**.

Harness teardown stopped its own isolated App. Post-teardown read-only evidence
shows turn aborted/TURN_ABORTED, Goal execution interrupted /
PLAN_EXECUTION_INTERRUPTED with host_restart audit, and report still
pending/fallback/unknown. Teardown-induced restart logs do not explain the
preceding wait. Both temporary credential stores were retired and no test
process remained. There was no second Goal run, new nudge or package C.

C1-C4/C7 had no implemented outputs or commands; C5 lacks package.json despite
no node_modules; C6 has no expert participation to verify; C8 has no Lead final
report. Only negotiation Bash git status; ls -la and node -v ran once each,
followed by one successful SubmitGoal. Full external audit and snapshots are
saved in /Users/sakurasep/Documents/Codex/2026-10-11/minikv-goal-test-2/report.md.

Scripted replay remains green, but real-model/multi-expert acceptance is
incomplete. Diagnose approved-execution request-start/first-event/timeout
observability before deciding on another authorized live attempt. No installed
application was replaced and no remote publishing occurred.


## Execution-wide A-prime follow-up (2026-10-12)

Stacked baseline: local `codex/team-roster-resume@961a4e480`, including A-prime
`d295eacc6` and B `3968c4160`; fix branch
`fix/team-roster-context-persistence`. This is a model-view robustness fix, not
a newly observed task failure. Read-only TEST-4 telemetry shows confirmed
`declare_team_strategy` content at step 8, then stale
`awaitingUserApproval=true` at steps 9–41. The original
`a-prime-coverage.json` checked step 8 only; that run still completed its task.
Later `prepareNextTurn` rebuilds from original live history discarded the
one-time Agent-state rewrite.

Guard recovery now registers the trusted confirmed review for the same approved
execution and turn. It reads the original entries starting at the current
approved execution boundary (`entriesFromExecutionStart(fullEntries,
executionContextStartIndex)`), capturing the complete valid assistant tool batch
containing the latest matching successful declaration and all original paired
results. This permits registration when compaction already archived the
original declaration before confirmation, without reading earlier execution
entries or changing any entries.
Signed thinking, text, tool signatures and sibling calls/results stay intact;
only matching declaration results change. The final `convertToLlm` boundary,
after system-journal persistence and beside tool-call deduplication, applies a
pure, idempotent,
copy-on-write projection to each provider request. Reapplying it after every
context rebuild/tool iteration/retry projects every successful result matching
the same team/turn/review without changing the entries used by persistence, UI
or compaction. When compaction archives the batch, final conversion includes the
complete registered batch and all its paired results in the model view only;
it never inserts an orphan call/result or trims signed content or writes to Agent state, journal, summary/checkpoint
or entries. Repeated recovery retains same-owner/review/epoch registration even
when rebuilt messages have archived its batch. Wire-call ID collisions do not
replace newer work. If initial registration has no matching successful
declaration in a fully paired valid assistant batch, it invents none and existing R6 fallback remains intact.
Execution end, interruption/Stop, cancellation/disposal/graceful stop, Team
budget stop, mode/turn/epoch changes or a later execution invalidate the scope.
A newer observable declaration with different reviewId, cancellation or higher
revision clears registration; no new Host notification, RPC or review read is
added. Pending, cancelled, replaced and mismatched reviews cannot rewrite
history from another execution. The direct `wait_for_updates` confirmation path
is unchanged. Host gates, public contracts and guard recovery limits are intact.

A runtime replay also covers actual compaction before confirmation: registration
uses the current execution's original entries and every resumed request retains
the complete confirmed batch. This coverage is included in the final focused
aggregate below.

Scripted acceptance requires at least three consecutive provider requests in
the recovered original turn, all with the matching confirmed result, and exact
preservation of persisted entries. Lifecycle and pure-function checks cover
pending/cancelled/mismatched reviews, Stop, completion followed by an ordinary
turn, a second execution, unrelated results and idempotence. Record actual red
and green commands/results separately; this document is not a passing test log.

### Authorized real-model follow-up: NOT RUN

Do not run a provider test without a separate user decision. After consent,
build this fix branch using the existing host dependencies and rerun the
park-aware TEST-4 flow with a new marker, independent HOME/profile/data and
scratch project. Preserve the CPA first-token precheck (10 seconds, 30 seconds
total), the same CPA provider and `gemini-3.7-flash-high`, observed parking/tool
state before the real UI confirmation, and the original execution/turn proof.
Do not alter TEST-4 evidence or the installed application.

Audit **every** lead request starting after roster confirmation until the
approved execution ends using `context-insights-v1.requests[].providerPayload`,
not only the first recovery request. Record request step/start/end/duration and
verify every matching successful declaration result is `status=confirmed`,
`awaitingUserApproval=false`, `nextStep` beginning
`The user confirmed the execution roster` and absence of stale
`memberSessionIds`. Preserve the Host-confirmed system tail, reviewId,
executionId/turnId, tool events and original persisted pending declaration for
comparison. Verify the complete registered batch with valid original pairing
and signatures remains visible after compaction.
Mark missing/truncated payloads as unverified coverage; a missing batch after
successful registration is a coverage gap. Provider silence is a provider
observation, not a roster failure. Independently rerun C1–C5 on a project copy and audit C6–C8 against
actual scopes, commands and Host/tool records. Retain exports, telemetry, logs
and screenshots after teardown. Report this new-build live acceptance as **NOT RUN** until it actually occurs; historical
TEST-4 or scripted replay does not establish real-model compliance or prompt
cache behavior.

### Execution-wide fix: automated validation evidence

The following results are from this fix worktree, separately from the original
candidate history above. On baseline `961a4e480`, R1 was extended to assert the
matching declaration in every resumed provider request. The red replay observed
`awaitingUserApproval` values `[false, true, true, true, true]`: the one-time
projection reached only the first resumed request.

The final focused run passed all 83 tests across four replay/domain suites. Coverage includes actual runtime
compaction, a request-level transient error/retry with no assistant stream-start
event before continuation,
ordinary turns after completion, Stop and a second execution, and a complete
entries comparison against the original one-time projection mode. Offline
Google/Anthropic serialization exercises signed thinking/tool batches without
sending network requests. These fixtures establish provider-bound model-view
and lifecycle behavior, not real-model compliance.

The full agent-runtime package ran 177 suites / 1,632 tests: 1,631 passed and
one failed in `runtime-goal-report.test.ts`,
`closes an armed report recovery exactly once when aborted before continuation`.
A controlled comparison using the original `961a4e480` runtime ran that file's
22 tests with the same result: 21 passed and the identical one failed. The
original file was restored after the comparison. This is an existing failure;
no out-of-scope report-recovery fix was added, and the full package is not
reported as green.

Installed-tool equivalents of runtime typecheck, `check:runtime-tests`,
`check:test-quality -- --base 961a4e480`, `check-architecture`, configured Biome
lint and style-token checks passed. Package scripts were executed through Node
and the existing installed tools rather than pnpm: the user forbids running
pnpm in this stacked tree, and no dependencies were installed. Record the exact
commands with the final delivery results. New-build real-model verification
remains **NOT RUN** pending separate user consent; effects on prompt-cache
prefixes remain unverified.
