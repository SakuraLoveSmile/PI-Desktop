# 02. Agent Runtime

## 1. Goal

Applied decisions: **D002/D003/D008/D158**.


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
7. start pi turn with the resolved session configuration and effective
   thinking level; transient provider transport failures (request timeout,
   dropped connection, 429/5xx) retry up to twice with interruptible
   backoff before the turn is failed (D127)
8. stream normalized answer and thinking events to UI
9. on tool calls, delegate to Rust host bridge with the durable `sessionId`;
   host resolves the session-bound workspace root
10. if pi finishes a message with `stopReason: "error"`, finalize any partial
    assistant bubble with a structured `UiMessage.error`, persist it in the
    transcript, and emit a normalized lifecycle `error` event carrying the
    same provider `AppError`; even a failure with no answer text remains a
    visible assistant error message
11. finalize and persist successful answer/thinking blocks independently

### 5.1 Context checkpoint protection (D158, ADR 0030)

The complete visible transcript and the model context are separate views of
the same session. A durable checkpoint summarizes older model context while
the renderer continues to show every original user, assistant, and tool row.

PI-Desktop reuses pi-agent-core's `buildSessionContext`, `convertToLlm`,
`estimateContextTokens`, `prepareCompaction`, and `compact` primitives. The
desktop runtime owns when they run and how the result crosses the Rust storage
boundary; OpenCode DCP is an AGPL-3.0 behavioral reference only, not a linked or
copied dependency.

For every pi loop turn:

1. pi emits and awaits `turn_end` after the assistant message and all tool
   results for that turn are complete
2. PI-Desktop rebuilds the context from the full transcript plus the newest
   valid checkpoint and estimates the next request budget
3. below the soft boundary, the next turn proceeds unchanged
4. at the soft boundary after a tool turn, the next request receives one
   transient `<context_management>` instruction; it is not persisted or added
   to the runtime's base system prompt, and repeats no more than once every
   three qualifying turns
5. the instruction asks the model to call `CompactContext` with a short active
   focus; the internal tool queues summary generation for the end of its
   current tool turn, bypasses workspace permissions, and otherwise emits and
   persists a normal visible tool call/result row
6. at or above the hard boundary, summary generation is mandatory; failure
   raises `CONTEXT_COMPACTION_FAILED` and pi cannot issue another provider
   request
7. successful generation first appends the checkpoint through host-core, then
   installs its summary + retained tail as the runtime context for the next
   provider request; a hard-boundary checkpoint is re-estimated before it is
   persisted and again before continuation, and cannot authorize the next
   request unless it is below the hard budget

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
Headroom is the maximum of the configured reserve, model maximum output capped
at 25% of the context window, and a 5% safety margin. A configured reserve is
capped at half the window. The effective retained-tail target is capped at half
the hard budget so small-context models can still shed meaningful history. The
soft boundary precedes the hard boundary by a model-aware recent-context gap.

The incoming user prompt participates in budgeting before the first provider
request. If a checkpoint cannot make it fit, the user row and an assistant
error remain durable but no provider request starts. Provider-reported context
overflow is the last recovery layer: omit the failed assistant from model
context, compact once, and retry once. A second overflow or failed checkpoint
is terminal. Bedrock's `prompt is too long: N tokens > M maximum` form maps to
this path.

Automatic protection is enabled by default. Disabling it removes
`CompactContext` and bypasses soft, hard, and overflow recovery; manual
`/compact` remains available while the session is idle. Manual and automatic
checkpoint generation are abortable and count as running state until durable
persistence completes.

## 5b. Mode defaults

- Default product mode: **Agent**
- Chat mode is available as a safer read-only profile
- Mode is session-scoped and persisted with session metadata
- Thinking level is session-scoped and persisted with session metadata
- Composer configuration is mutable only while the session is idle
- Changing mode/provider/model/thinking level applies to the next turn and
  recreates the pi runtime when any runtime-affecting configuration changes

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
+ [mode prompt: chat/agent]
+ [workspace info]
+ [tool instructions]
+ [project instruction chain, when present]
+ [optional user custom instructions]
```

### 7.1 Active tool context and on-demand loading (D185, ADR 0048)

The sidecar builds one complete tool registry, but it does not serialize every
registered schema into every provider request. Each new user prompt starts with
the mode's core set plus `CompactContext` when automatic compaction is enabled:

- Agent: `Read`, `Glob`, `Grep`, `Write`, `Edit`, and `Bash`
- Chat: `Read`, `Glob`, and `Grep`
- both modes: `ToolSearch` when at least one deferred capability exists

`BrowserPreview`, plugin tools, `Skill`, and plugin-development helpers are
registered but deferred. Their names and compact one-line descriptions appear
in an `# On-demand tools` catalog; parameter schemas do not. The catalog is
bounded so a plugin with many tools cannot recreate the original prompt bloat.
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
