# 02. Agent Runtime

## 1. Goal

Applied decisions: **D002/D003/D008/D158/D189/D190/D193/D194**.


Wrap pi into a product runtime that desktop layers can consume safely.

Core packages:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`

## 2. Runtime placement

Agent loop runs in a **Node/TypeScript pi sidecar**, not in renderer.

```text
packages/agent-runtime/*
apps/desktop/electron/* (supervisor)
crates/host-core (tool execution + permissions)
```

## 3. Core objects

### 3.1 PiRuntime (Node)
- init models/providers
- create Agent
- bind tool bridge
- subscribe/normalize pi events

### 3.2 AgentHostFacade (Electron main)
- session routing
- process supervision
- IPC translation

### 3.3 Host Tool Bridge (Rust)
- receives tool call requests
- applies permission policy
- executes builtin/plugin tools
- returns normalized tool results

## 4. Runtime API (package-level)

```ts
interface AgentRuntime {
 prompt(input: PromptInput): Promise<{ turnId: string }>
 abort(turnId?: string): Promise<void>
 getStatus(): RuntimeStatus
 dispose(): Promise<void>
 subscribe(handler: (event: NormalizedAgentEvent) => void): () => void
}
```

## 5. Prompt flow

1. load the durable session and reject a missing session
2. resolve that session's mode/provider/model and project binding (app/current
   workspace defaults are legacy fallback only)
3. resolve the complete pi-ai model record for that exact provider/model and
   clamp the durable session thinking level to pi's nearest supported value;
   an unknown free-form id uses the explicit generic fallback
4. validate model/secret availability
5. reject if session busy
6. persist user message
7. snapshot the effective shell ID and dialect for the turn
8. start pi turn with the resolved session configuration and effective
   thinking level; request setup receives one bounded pi-ai retry for transient
   transport/provider failures, while a transient failure after streaming has
   started receives one same-turn runtime retry before the turn is failed
   (D127, D186)
9. stream normalized answer and thinking events to UI
10. on tool calls, delegate to Rust host bridge with the durable `sessionId`;
    host resolves the session-bound workspace root
11. if pi finishes a message with `stopReason: "error"`, finalize any partial
    assistant bubble with a structured `UiMessage.error`, persist it in the
    transcript, and emit a normalized lifecycle `error` event carrying the
    same provider `AppError`; even a failure with no answer text remains a
    visible assistant error message
12. finalize and persist successful answer/thinking blocks independently

The runtime constructs exactly one pi `Agent` per durable session. Plan does
not select a second model, planner service, permission implementation, or
runtime. The same Agent changes its planning state and tool registry after a
host-confirmed transition.

### 5d. Bounded provider stream recovery and diagnostics (D186, ADR 0050)

Provider request setup uses one pi-ai retry with an interruptible backoff
capped at 8 seconds. This covers failures before a response is established;
it does not make the whole agent turn an unbounded retry loop.

When a provider terminates or closes an incomplete stream after the assistant
has started, the runtime classifies the event as retryable `STREAM_FAILED`.
`NETWORK_ERROR` and `TIMEOUT` have the same bounded path when they occur during
stream delivery. The runtime waits 750 ms with an abortable backoff, removes
the failed assistant from the next model context, and calls `continue()` once.
The existing assistant message id is reused, so the partial response is
replaced in one visible bubble. The first attempt's `turn_end` and `agent_end`
are suppressed; the retry emits the single terminal lifecycle. A second
failure is terminal and emits the normal assistant error plus lifecycle
`error` event. Authentication, model-selection, rate-limit, malformed-request,
and context errors do not use this same-turn replay path.

Provider failures carry bounded diagnostics in `AppError.details` when
available: `phase` (`request` or `stream`), `providerStatus`, `providerCode`,
`providerWaitMs`, `streamMs`, and `retryAttempt`. Provider messages remain
redacted and capped; credentials and unrestricted response bodies never enter
the event or log.

### 5e. Silent-turn recovery

A turn that ends with no tool call and no visible assistant text is invisible
to the user: reasoning is never rendered, so a conclusion written only there
did not arrive. 15 of 255 recorded sessions ended a turn that way, and the
user's only recourse was typing "继续".

The runtime detects it at `message_end`: the stop was neither an error nor an
abort, the message requested no tools (no `toolCall` content part), and the
visible text is blank after trimming. Reasoning content does not exempt a turn
— a thinking-only turn is exactly the case that needs recovery.

Recovery mirrors §5d and is bounded the same way: at most one re-run per user
prompt. The silent assistant is dropped from the model context (`continue()`
refuses a transcript ending in an assistant message, and an empty one is not
worth resending), a short no-output instruction is appended to the system
prompt for that one continuation, and the bubble id is reused so a recovered
turn leaves no empty row behind. The silent attempt's `turn_end` and
`agent_end` are suppressed; the re-run emits the single terminal lifecycle.

The one-shot instruction rides on the agent's system prompt rather than the
`prepareNextTurn` hook, because that hook only shapes turns inside a live run
and this run has already ended. It is removed afterwards unless a path-scoped
instruction reload rewrote the prompt meanwhile, in which case the newer
rebuild wins.

If the re-run is silent too, the turn ends as a visible assistant error with
retriable `EMPTY_MODEL_RESPONSE`, which gives the transcript its normal retry
action. No empty assistant message is persisted in either case.

Decision D193; see E2E-098.

### 5.1 Context checkpoint protection (D158/D200, ADR 0030/0049/0061)

The complete visible transcript and the model context are separate views of
the same session. A durable checkpoint summarizes older model context while
the renderer continues to show every original user, assistant, and tool row.

PI-Desktop reuses pi-agent-core's `buildSessionContext`, `convertToLlm`,
`estimateContextTokens`, `prepareCompaction`, and `compact` primitives. The
desktop runtime owns when they run and how the result crosses the Rust storage
boundary; OpenCode DCP is an AGPL-3.0 behavioral reference only, not a linked or
copied dependency.

Compaction is host-driven and imperceptible. There is no model-facing
compaction tool and no system-prompt instruction about context management: the
runtime decides deterministically, and a successful automatic compaction
produces no toast, no run-state change, and no transcript row.

For every pi loop turn:

1. pi emits and awaits `turn_end` after the assistant message and all tool
   results for that turn are complete
2. PI-Desktop rebuilds the context from the full transcript plus the newest
   valid checkpoint and estimates the next request budget
3. any in-flight background summary is awaited, and a pre-computed checkpoint
   that is still valid is installed; the turn then usually proceeds without
   reaching the hard boundary
4. below the hard boundary, the next turn proceeds unchanged
5. at or above the hard boundary, summary generation is mandatory; the runtime
   preflights the summary input against the model window and skips a request
   that cannot fit. An automatic summary failure first attempts a deterministic
   retained-tail checkpoint, while manual compaction still reports
   `CONTEXT_COMPACTION_FAILED`
6. successful generation or deterministic recovery first appends the
   checkpoint through host-core, then installs its summary + retained tail as
   the runtime context for the next provider request; a hard-boundary
   checkpoint is re-estimated before it is persisted and again before
   continuation, and cannot authorize the next request unless it is below the
   hard budget

Checkpoint generation and installation are separate operations.
`buildCheckpoint` runs the preparation, budget preflight, and summary request
without persisting anything or changing the active checkpoint; installation
re-estimates, appends through host-core, updates the active checkpoint, and
emits `compaction_end`. The blocking path composes the two back to back.

Background pre-computation runs only in **provider-idle windows**, so a summary
request never shares the provider connection with a streaming turn:

- when a tool starts executing, after the model stream for that turn ended and
  before the next request is issued;
- after a run finishes, while the user is reading the result.

It starts only if compaction is enabled, no compaction is already running or
pending, the session is not disposed, the context is at or above the background
limit, and the context grew by at least the retained-tail target since the
baseline recorded when the newest checkpoint was installed. That increment test
is what stops a large retained tail from requesting a fresh summary every turn
while reducing nothing. Background work never sets the running flag that feeds
`AgentStatus.isRunning`.

A pre-computed checkpoint is installed at the next turn boundary or before the
next user prompt, and only if the checkpoint it was based on is still the
active one, its `throughMessageId` anchor is still present in the transcript,
and it is still below the hard budget of the **current** model. Any miss
discards it and falls through to the blocking path. A background build that
fails, aborts, or lands on a superseded base is discarded in silence: nothing
is persisted, no event is emitted, and no retained-tail fallback is attempted —
that fallback belongs to the blocking hard boundary, which still catches
whatever background work missed. `abort()` cancels an in-flight background
summary but keeps an already-built checkpoint, which remains installable.

pi's cut point keeps provider-valid tool call/result pairs together. When the
final tool-result batch alone exceeds the configured recent-tail target,
PI-Desktop raises the effective target just enough for pi's reverse scan to
reach the batch's assistant carrier. When the carrier plus results reaches half
the hard budget, the runtime first builds a checkpoint-only copy of the batch.
Every tool result keeps its call identity and error state; available text budget
is distributed fairly across the parallel results, retained as head + tail,
and marked with
`[checkpoint truncated: tool result exceeded the retained context budget]`.
Provider-irrelevant duplicate `details` are dropped from truncated checkpoint
results. Original durable message rows and the visible transcript are not
modified. The bounded tail is re-estimated with the summary before persistence
and before continuation, so an oversized request still cannot pass the guard.

The hard boundary is the model context window minus request headroom.
Headroom is the maximum of a 16,384-token reserve floor, model maximum output
capped at 25% of the context window, and a 5% safety margin. The reserve floor
is itself capped at half the window. The retained-tail target is derived from
the model window as 20% of the hard budget clamped to 8,000–64,000 tokens, and
then capped at half the hard budget so small-context models can still shed
meaningful history. None of these values are configurable.

The background limit is 70% of the hard budget. It is the pre-computation
trigger only; the hard boundary keeps measuring total context, because that is
the provider's actual constraint.

The incoming user prompt participates in budgeting before the first provider
request. If normal compaction fails during an automatic threshold or overflow
recovery, the runtime persists a short recovery checkpoint with the previous
summary (when available) and an aggressively bounded recent tail. The
complete transcript remains durable and visible, while the next model request
receives only that recovery checkpoint and tail. The lifecycle event marks
this as `fallback: "retained_tail"` so the renderer can show a warning rather
than a false success. If the fallback cannot be prepared, persisted, or kept
below the safe budget, the user row and an assistant error remain durable and
no provider request starts. Provider-reported context overflow is the last
recovery layer: omit the failed assistant from model context, compact once,
and retry once. A second overflow remains terminal. Bedrock's
`prompt is too long: N tokens > M maximum` form maps to this path.

Automatic protection is always enabled and is not user-configurable. The
runtime still accepts a construction-time override that disables it, used by
tests; persisted `contextCompaction` settings are ignored so a session cannot
be left with the guard off and no way to restore it. Manual `/compact` remains
available while the session is idle. Manual and blocking checkpoint generation
are abortable and count as running state until durable persistence completes;
background generation never does.

## 5b. Operating mode and planning state

- Default product mode: **Agent**
- The product selector is **Agent | Plan | Goal**; the internal conversation page
  may still use `page = "chat"`
- Mode is session-scoped and persisted with session metadata
- Thinking level is session-scoped and persisted with session metadata
- Composer configuration is mutable only while the session is idle
- Changing mode/provider/model/thinking level applies to the next turn and
  recreates the pi runtime when any runtime-affecting configuration changes

The live planning state is derived and projected as:

```ts
type OperatingMode = "agent" | "plan" | "goal";
type ProposalKind = "plan" | "goal";
type PlanningState =
  | "inactive"
  | "planning"
  | "awaiting_approval";
type PlanExecutionState = "queued" | "running" | "completed" | "interrupted";
```

Plan and Goal are the two **contract modes** (D198). They share one durable
approval table, one projected `PlanningState`, one approval surface, and one
execution queue; a `kind` discriminator (`plan` | `goal`) on the proposal selects
the prompt, the artifact directory, and the user-facing copy. `Agent` is the only
mode with no kind, and is the only mode that executes freely. Because the
projection is shared, `planning` and `awaiting_approval` are always read together
with the kind to know which durable mode a session is in.

`Agent / inactive` enters `Plan / planning` either when the user selects Plan
while idle or when the Agent calls `EnterPlanMode`. In Plan, the Agent can
inspect, use context controls, run Bash through the selected permission mode,
and call `SubmitPlan(title, markdown, question)`. Host-core preserves the
submitted Markdown bytes in a new immutable
`.pi/plan/<unique-name>.md` artifact, records its relative path/hash/size and
structured title/question in `plan_approvals`, and moves the live state to
`awaiting_approval`.

Approval has only `approve` and `reject`. Approval commits `mode = agent`, the
explicit permission mode, an execution ID, and `execution_state = queued` on
the same `plan_approvals` row in one host transaction. The
same Agent then receives a fresh model turn with the Agent tool set. Reject,
absolute expiry, a pending interruption, stale response, or persistence
failure closes the approval row and returns the live state to editable
`Plan / planning` without granting execution tools. A later accepted Plan prompt
is a new turn: earlier `SubmitPlan` calls remain historical immutable
checkpoints, and the Agent must call `SubmitPlan`
once with a new complete Markdown snapshot to create a new artifact. If approval
already committed and a queued/running execution is interrupted, durable mode
remains Agent and the execution is not replayed.

Manual mode and configuration selection is allowed only while idle. Selecting
Agent is an intentional user override and does not synthesize a plan or
approval. Each session has one active turn, one pending approval, and one
queued/running execution; a second prompt, configuration change, or execution
is rejected.

`Agent / inactive` enters `Goal / planning` the same two ways, by user selection
while idle or by the Agent calling `EnterGoalMode`. Goal has the identical tool
surface as Plan, except that its submit tool is
`SubmitGoal(title, markdown, question)` and its artifact is written to
`.pi/goal/<unique-name>.md`. The submitted Markdown is a **goal contract** — the
outcome to reach, the acceptance criteria that prove it was reached, and the
boundaries that must not be crossed — not a list of implementation steps. A
submit tool is rejected with `PLAN_KIND_MISMATCH` when the session's active kind
is the other one, and with `PLAN_NOT_ACTIVE` when no contract is active.

Goal approval commits exactly what Plan approval commits: `mode = agent`, the
explicit permission mode, an execution ID, and `execution_state = queued` on the
same row. The queued execution instruction differs by kind. An approved plan is
replayed as steps to follow; an approved goal instructs the Agent to choose its
own approach, verify every acceptance criterion by running the checks the
contract names, keep working while a criterion is unmet and an untried approach
remains, stop early only when a boundary blocks it, and close with a
criterion-by-criterion report of what was met and the evidence observed.

## 5c. Thinking capability and stream contract

- Canonical levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`,
  and `max`.
- Pi's generated model catalog is authoritative for reasoning support,
  thinking-level mapping, limits, input modes, pricing, headers, and adapter
  compatibility for every resolved known model.
- Provider configuration cannot override known-model semantics. Unknown
  free-form ids remain runnable through a generic text-only, non-reasoning
  model and therefore expose only `off`.
- Unsupported requested levels use pi's nearest-supported-level rule: scan
  upward first, then downward. A non-reasoning provider always resolves to
  `off`.
- The effective level is passed to the pi `Agent`; provider-specific request
  serialization remains pi-ai's responsibility.
- Pi `thinking` blocks become `UiMessage.thinking` and
  `message_update.deltaThinking`. They never append to `content` or
  `deltaText`.
- Restored assistant history reconstructs separate text and thinking blocks
  before the next turn.
- Restored history also reconstructs tool call/result pairs from persisted
  tool rows (`toolCallId`/`toolArgs`/`toolResult`), so a recreated runtime
  keeps its full working context — file contents read, command output —
  instead of collapsing to bare chat text (D127). An interrupted tool row
  restores as an errored result; a tool row whose assistant row was lost
  gets a synthesized call-only assistant carrier so call/result pairs stay
  well-formed for every provider API.
- Failed assistant messages remain durable diagnostic transcript entries but
  are never restored into pi model context on a later turn.
- Restored checkpoints clear provider usage from retained assistant messages
  for budgeting. That usage measured the pre-compacted request and must not
  make the summary + tail appear as large as the discarded context.
- Runtime recreation and model changes restore the newest valid checkpoint.
  Truncation keeps it only when its boundary remains in the live transcript;
  a fork copies/remaps it only when the child includes that boundary.
- A forked session receives a new session id and no shared runtime. Its first
  prompt creates a fresh pi runtime and restores context only from the child
  transcript, including the remapped tool call/result pairs.
- Message-scoped assistant Fork/Edit follows the same rule: the child
  transcript may stop at or replace the selected assistant response, but its
  next prompt cannot reuse the source session's runtime/provider cache because
  the session id and remapped transcript identities are independent (D134).

## 5f. Subagent delegation (D201, ADR 0062)

The session Agent can hand one self-contained piece of work to a delegate and
receive a single written report.

**Catalog.** Definitions are Markdown documents: three builtins shipped inline
in `agent-runtime` (`explorer`, `code-reviewer`, `test-runner`) plus
`<workspace>/.pi/agents/*.md`, with project documents shadowing builtins by
name. Electron main loads the catalog on every launch and passes
`subagents` / `subagentProviders` in the sidecar params, so editing a definition
takes effect on the next prompt. The catalog is capped at
`MAX_SUBAGENT_DEFINITIONS` (16); a malformed or unreadable document becomes a
launch diagnostic and never fails the launch.

**Tool.** `Task(agent, task, description?)` is built only in Agent mode and only
when the catalog is non-empty. Its description carries the delegate catalog, and
its arguments are validated in the tool: an unknown `agent`, an empty `task`, an
unresolvable model pin and a definition whose tools are all unavailable each
return a tool error explaining the failure rather than throwing. `Task` belongs
to the Agent core set rather than the on-demand catalog of §7.1, so a session
with definitions always sees it.

**Delegate loop.** A `SubagentRun` is a second pi `Agent` in the same sidecar
process with the definition's system prompt, its (possibly pinned)
provider/model, its declared tools, and the same host connection. It runs under
`maxTurns` (default 24, maximum 80) and the same bounded provider retry policy
as the parent. Its statuses are `completed`, `truncated`, `failed` and
`aborted`; all four collapse into the `Task` tool result, whose text is the
report (bounded to `MAX_SUBAGENT_REPORT_CHARS`, 12k) and whose details carry
`agent`, `status`, `turns`, `toolCalls`, `usage` and, on failure, `error`.

**Model pins.** `model: <provider>/<model>` in the frontmatter is resolved once
per launch in Electron main, where credentials and the pi catalog live, against
provider id, vendor key or display name, and capped at
`MAX_SUBAGENT_PROVIDERS` (8) distinct providers. An unresolvable pin is omitted
from the binding map on purpose; the runtime turns the missing entry into a tool
error naming the pin, and never falls back to the session model. A definition's
`thinkingLevel` is clamped against the resolved model with the same
nearest-supported rule as §5c.

**Events and context.** Every event a delegate emits carries
`parentToolCallId` and `agentName` on its envelope, and Electron main copies both
onto the persisted row. When the runtime rebuilds model context it skips every
row with `parentToolCallId`: the parent only ever saw the report, and replaying
delegate rows would both contradict that and reintroduce the context cost
delegation exists to avoid.

**Turn ownership.** A delegate's lifecycle never reaches Electron main's turn
handling. Termination is visible only as the `Task` tool result, so the parent
turn remains the only thing that can end a turn.

The surrounding contracts live in `03-tools-and-permissions.md` §10.2 (what a
delegate may call), `04-data-storage.md` §4.7a (persisted attribution),
`04-ux/03-permission-ux.md` §6a (more than one pending request) and
`04-ux/08-component-spec.md` §9.9 (how a delegation reads).

## 6. Providers & models

> Full policy: `11-provider-model-system.md`, `12-provider-config-schema.md`, `13-model-catalog-and-selection.md`.

Coverage strategy:

1. **Native providers** exposed by pi-ai (OpenAI, Anthropic, Google, and others available at pin version)
2. **OpenAI-compatible** first-class path for gateways and long-tail vendors
3. **Custom providers** with protocol profiles
4. **Refreshable model catalog** + **free-form model IDs** (no closed allowlist)

MVP UI always includes at least:
- OpenAI
- Anthropic
- Google Gemini
- OpenAI-Compatible (generic)
- Custom provider entry

Runtime responsibilities:
- resolve `(providerId, modelId)`
- resolve and serialize the complete pi-ai model record, or label the model as
  an unknown generic fallback
- resolve model reasoning capability and effective thinking level from that
  same record
- fetch secrets via host (never cache raw secrets in logs)
- translate vendor failures into provider AppError codes
- stream tokens/events to orchestrator
- support abort/cancel mid-stream

Local models are supported through OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, etc.).


## 7. System prompt composition

```text
[base product prompt in English]
+ [operating-state prompt: agent/plan/goal]
+ [workspace info]
+ [tool instructions]
+ [project instruction chain, when present]
+ [optional user custom instructions]
```

The base prompt states collaboration rules explicitly, because omitting them
is what produced silent sessions: "prefer concise, actionable answers" was the
only relevant line, and a reasoning model executed it as saying nothing at all.
Required behaviours, each one an observed failure inverted:

- answer in the language the user writes in
- one sentence before each tool batch, and no silence longer than one tool
  batch or 60 seconds of work
- anything the user asked is answered in visible text; reasoning is not shown
  to them and does not count as an answer
- the final message is self-contained
- work is carried through end to end rather than stopping at analysis
- tool calls go through the native tool-call interface; a call written as prose
  (notably an OpenAI-style `multi_tool_use.parallel` wrapper) does not run, and
  the runtime logs it when a model emits one

It also states a search preference that matches the host-side budgets in
[16-tool-result-limits](16-tool-result-limits.md): scope `Read`, `Grep`, and
`Glob` with their own parameters instead of hand-rolling `cat`/`sed`/`grep`/
`find`; use `Read.offset/limit`, `Glob.path/limit`, and
`Grep.path/include/outputMode/headLimit`; use `filesWithMatches` or `count`
when content is unnecessary; use workspace-relative paths for portability; and
fall back to a bounded command in the active shell only when the native tools
are insufficient. `rg` is optional rather than assumed, and the agent must not
repeat a search whose answer is already in context.

### 7.1 Active tool context and on-demand loading (D185, ADR 0048)

The sidecar builds one complete tool registry, but it does not serialize every
registered schema into every provider request. Each new user prompt starts with
the mode's core set:

- Agent: `Read`, `Bash`, `Edit`, and `Write` (matching pi's coding-agent core)
- Agent: `Task` as well, whenever the subagent catalog is non-empty (§5f) — a
  capability the model has to go looking for is one it will not use, and
  delegation is worth one extra schema per request
- Plan: `Read`, `Glob`, `Grep`, `BrowserPreview`, and `Bash`
- both modes: `ToolSearch` when at least one deferred capability exists

In Agent mode, `Glob` and `Grep` join `BrowserPreview`, plugin tools, `Skill`,
and plugin-development helpers in the deferred set. Both contract modes keep
their read/inspection core available, while the kind's submit tool
(`SubmitPlan` or `SubmitGoal`) is exposed only during the planning state, and
only for the active kind. Deferred tools are registered but their names and
compact
one-line descriptions appear in an `# On-demand tools` catalog; parameter
schemas do not. The catalog is bounded so a plugin with many tools cannot
recreate the original prompt bloat.
The model calls `ToolSearch` with an exact name or a short capability query.
The sidecar activates up to four matches, returns their names through
pi-agent-core's `addedToolNames`, and rebuilds the next-turn context with those
schemas. Providers with native deferred-tool search receive the definitions at
that load point; other providers receive the active definitions normally.

Deferred activation is reset before each new user prompt, so a previous task
cannot make an unrelated first request carry a growing tool set. The tool
registry, host permission path, tool timeout, and workspace containment rules
remain unchanged. `ToolSearch` is local to the sidecar and does not cross the
host RPC boundary. Its activation marker is retained in the persisted tool
result so a restored transcript remains provider-valid, although a restarted
runtime still requires a fresh search before reusing a deferred capability.

For user-visible HTML deliverables, the default system prompt asks the agent to
activate `BrowserPreview` once after creating the page or making its first
meaningful visual edit, using a workspace-relative path. The agent reuses the
live-reloading preview while iterating instead of issuing repeated preview
calls. Generated, test-only, and non-visual HTML files are excluded. When the
tool is deferred, `ToolSearch` must activate it before the preview call.
### 7.2 Plan prompt requirements

The Plan prompt tells the same Agent to understand the request, inspect the
relevant repository/specification/test context, identify impacted files and
risks, include focused validation and migration/recovery implications, surface
open questions. When any initial or revised plan is ready, it must call
`SubmitPlan` immediately exactly once in the current turn with one complete
Markdown snapshot. An accepted new Plan prompt has no prior pending approval;
earlier submissions in the transcript are historical immutable checkpoints.
After reject, expiry, or interruption, the Agent may revise in the new turn and
must follow the same one-SubmitPlan rule. It must not claim that changes were
made. The host writes the immutable `.pi/plan/*.md` artifact; the Agent does
not write or edit it itself and does not receive a request-changes flow.

The prompt may describe Bash as permission-gated and potentially mutating. It
must not describe Plan as a strict read-only security boundary.

### 7.2a Goal prompt requirements

The Goal prompt tells the same Agent to negotiate a goal contract before any
autonomous work. It asks for what to achieve rather than how: the outcome, the
acceptance criteria, and the boundaries. It must not enumerate implementation
steps, because the Agent decides those itself after approval. Every acceptance
criterion must be objectively checkable by the Agent after execution — a command
that must pass, or an observable behavior. The Agent inspects the workspace and
asks about anything ambiguous first, then calls `SubmitGoal` immediately exactly
once in the current turn with one complete Markdown snapshot.

The one-submit rule, the historical-checkpoint rule, the revise-after-close rule,
the no-chat-confirmation rule, and the host-writes-the-artifact rule are the same
as Plan's, with `SubmitGoal` and `.pi/goal/*.md` in place of their Plan
equivalents. The prompt additionally states that once approved, the contract is
the standard the Agent works against: it pursues the goal autonomously, chooses
its own approach, and stops only when every acceptance criterion is verified or a
boundary blocks it.

### 7.2b Subagent prompt composition (D201, ADR 0062)

A delegate's system prompt is composed in the sidecar from three parts, in this
order: the delegation framing, the definition's Markdown body, and the tool
guidance its declared tools earn. The body sits ahead of the workspace guidance
so a project's own instructions still have the last word.

The framing states the shape of the delegate's situation, which is not
inferable from the body: it is one delegated task, the delegate cannot see the
user, ask a question, or delegate further, it has exactly the listed tools, and
its final message is the only thing the main agent receives. A read-only
definition is additionally told never to report an edit it could not have made;
a write-capable one is told to touch only the files the task is about.

Guidance blocks are the same text the session prompt uses, included only when
the definition declares the matching tool: search/read scoping for
Read/Grep/Glob, edit discipline for Edit/Write, the command shell contract for
Bash, and the scratch-directory rule when the session has a scratch directory
and the delegate can write. The project instruction chain (§7.3) is appended
last, so a delegate follows the same project rules as its session.

### 7.3 Project instruction chain

The Electron main process first resolves the global
`~/.pi/agent/AGENTS.md`, then project instruction files inside the
session-bound project root when a runtime starts. For each project directory it
uses at most one non-empty file in this order: `AGENTS.override.md`, `AGENTS.md`,
`CLAUDE.md`, then `.claude/CLAUDE.md`. Entries are concatenated from project
root to the target directory, so the closest file appears last and takes
precedence. The initial chain targets the project root. Before a `Read`,
`Write`, `Edit`, or `BrowserPreview` call, the sidecar asks Electron main to
resolve the target path and replaces the active instruction section with that
path's complete chain before the tool executes. This keeps rules lazy and
prevents sibling-directory rules from persisting after the agent moves to a
different file tree.

The session-bound project root is passed with the runtime launch metadata and
registered by Electron main before each prompt or compaction request. The
sidecar cannot select a different root. During one prompt, path-resolution
claims are cached by project root and target directory, so repeated file tools
in the same directory do not perform another IPC request. Claims are discarded
at the next prompt, allowing edits and newly created instruction files to take
effect without a stale cross-message cache.

Path-specific resolution is best-effort and has a 2-second deadline. If the
resolver or its host RPC is unavailable or exceeds that deadline, the file
tool continues with the runtime's base/root chain rather than waiting for the
general host RPC timeout. A failed resolution never leaves a previously
resolved sibling-directory chain active.

All discovery stays within the session project root. Empty, unreadable, and
out-of-root files are skipped. The combined UTF-8 content is capped at 32 KiB
and source paths are labelled under `# Project instructions`.
The sidecar never reads workspace instructions directly. A changed root chain
recreates an idle runtime on its next prompt; nested instructions are resolved
again when a relevant file tool runs. The sidecar timing line records
`instructionResolveMs`, `instructionCacheHit`, and `instructionFallback`
separately from `hostRttMs` so a slow preflight cannot be mistaken for a slow
command body.

Settings provides dedicated management for the fixed global path. The Projects
view project-list menu provides an `AGENTS.md` editor for its corresponding
registered project root. Its IPC does not accept arbitrary renderer file paths.
Saves affect the next prompt without restarting the application.

## 8. Concurrency

| Scope | MVP policy |
|---|---|
| same session | single turn serial |
| different sessions | limited parallel |
| tools | sequential by default |
| `Task` calls in one assistant message | parallel, 4 slots (D201) |

Tool concurrency is expressed through pi execution modes: every catalog tool is
`sequential` and `Task` alone is `parallel`, and pi runs a batch sequentially as
soon as it contains one sequential tool. So an all-`Task` batch is the only batch
that fans out, and every other ordering guarantee is unchanged. Delegates issue
host calls independently, and host-core's one-mutation-per-session admission
keeps writes from tearing but leaves two same-path mutations unordered, so the
sidecar serializes `Write`/`Edit` calls that target the same normalized path
before they reach the host; calls on different paths never wait on each other.
This is what keeps the per-path edit-recovery rules of
`03-tools-and-permissions.md` §4d meaningful under fan-out.

Selecting another project tab affects only the visible shell workspace. It
does not dispose, abort, or re-root a runtime belonging to another session.

## 9. Abort semantics

- stop model stream
- attempt cancel interruptible tools
- do not auto-rollback completed writes
- mark turn aborted in UI/storage

## 10. Explicit non-goals

- no DOM knowledge
- no direct FS access bypassing Rust host
- no secret leakage into events/logs

## 11. Implementation status (M5)

Implemented: streaming turns over the OpenAI-compatible protocol path
(universal escape hatch, D024); one active turn per session enforced with
`AGENT_BUSY`; real `turnId` returned per accepted prompt; provider failures
mapped to `PROVIDER_UNAUTHORIZED` / `PROVIDER_RATE_LIMITED` /
`MODEL_NOT_CONFIGURED` / `STREAM_FAILED` / `TURN_ABORTED` where detectable.
The desktop development lifecycle rebuilds `packages/agent-runtime/dist`
before Electron starts so the spawned sidecar always executes the current
normalization and error-mapping source.

Tracked gaps (post-MVP backlog): richer system prompt composition (§7) and
provider/model catalog discovery beyond the currently wired paths.
