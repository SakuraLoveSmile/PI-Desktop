# Team roster resume validation

Date: 2026-10-11. Request baseline: `26db50438`.
Branch: `codex/team-roster-resume`. Local commits only; no push, PR or merge.

## Package A: confirmed model-context result

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

- R1: first recovery request sees confirmed roster, no stale session IDs; owned
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

Real Electron/Rust multi-expert acceptance and gemini-3.8-flash-high minikv
acceptance: **NOT RUN**. The original minikv prompt has not been provided in this
chat. Scripted replay proves the provider context and real runtime dispatch
wiring; it does not prove real weak-model compliance or three actual experts
starting. No installed application was replaced and package C remains excluded.
