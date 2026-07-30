# Plan Operating-State Implementation Plan

- Status: Phase 1 documentation, ready for implementation review
- Scope: replace the Chat operating profile with the Plan state
- Core runtime: one `@earendil-works/pi-agent-core` Agent per session
- Baseline: `0.4.13`
- Host protocol: v7
- Database schema: v8
- App release: `0.3.0` is a recommended feature release, not a frozen
  application version; the release runbook and dual-locale changelog gate still
  apply

## 1. Executive decision

PI-Desktop continues to run one pi Agent. Plan is that Agent after entering a
planning state. It is not another Agent, planner service, planner model,
permission mode, or security sandbox.

The product selector is `Agent | Plan`:

- Agent is the default and exposes the existing execution tools under the
  selected permission mode.
- Plan uses the same Agent context and exposes Read, Glob, Grep,
  BrowserPreview, Bash, CompactContext, and ExitPlanMode.
- Plan denies Write, Edit, every plugin tool, and unknown tools at the Rust
  host boundary.
- Plan retains permission-mode selection. Bash under Ask or Accept edits shows
  the normal permission prompt. Bash under Auto runs without confirmation and
  may mutate the workspace or scratch directory.
- Plan is therefore planning intent, not a strict read-only security profile.
  The UI and prompt must make the Bash/Auto tradeoff explicit.
- A user can enter Plan from the idle UI/session selector, or the same Agent
  can call EnterPlanMode. ExitPlanMode submits a structured plan and waits for
  separate approval.
- Approval changes the same durable session to Agent and selects the explicit
  execution permission mode. The same Agent then continues on a fresh provider
  turn; no second Agent is created.
- Request changes returns feedback to that same Agent and remains Plan. Reject,
  timeout, abort, crash, stale response, and persistence failure fail closed.

The internal renderer `page = "chat"` route may remain because it names the
conversation surface. It is not an operating mode and must not appear in the
product selector, command catalog, or authorization policy. All Chat
operating-mode labels and commands are removed. Persisted legacy Chat values
migrate to Plan. New sessions and new scheduled tasks default to Agent.

## 2. Invariants and vocabulary

Keep these concepts separate in shared types, storage, runtime state, and UI:

| Concept | Values | Authority | Meaning |
|---|---|---|---|
| Durable operating mode | `plan`, `agent` | Rust host SQLite | Mode used by the next turn and tool authorization |
| Live planning state | `inactive`, `planning`, `awaiting_approval` | Rust host plus same pi Agent | Runtime state projected to the renderer |
| Permission mode | `inherit`, `ask`, `accept-edits`, `auto` | Rust host settings/session policy | Approval posture for high-risk tools |
| Approval status | `pending`, `approved`, `changes_requested`, `rejected`, `expired`, `interrupted` | Rust host SQLite | Durable proposal outcome |

Recommended shared types:

```ts
export type OperatingMode = "plan" | "agent";

export type PlanningState =
  | "inactive"
  | "planning"
  | "awaiting_approval";

export type PermissionMode =
  | "inherit"
  | "ask"
  | "accept-edits"
  | "auto";
```

`mode` is a state of the same Agent. It must never select a different runtime
implementation or model. Renderer state is a projection and cannot be used as
the authorization source.

## 3. State transitions

```text
Agent / inactive
  -> user selects Plan while idle
  -> Plan / planning

Agent / running
  -> Agent calls EnterPlanMode alone in its tool batch
  -> host persists plan, runtime changes state
  -> Plan / planning

Plan / planning
  -> Agent calls ExitPlanMode(plan) alone in its tool batch
  -> host persists pending approval and emits request
  -> Plan / awaiting_approval

Plan / awaiting_approval
  -> approve(target permission mode)
  -> atomically persist Agent + permission mode
  -> Agent / inactive, same Agent starts a new model turn

Plan / awaiting_approval
  -> request_changes(feedback)
  -> persist changes_requested
  -> Plan / planning, same Agent revises

Plan / awaiting_approval
  -> reject | timeout | abort | crash | persistence failure
  -> persist rejected | expired | interrupted
  -> Plan / stopped, no execution capability
```

Manual mode changes are allowed only while idle. Selecting Agent while idle is
an explicit user override and does not synthesize a plan or bypass a pending
approval. A pending approval cannot be replaced by another proposal for the
same session.

## 4. Existing architecture and ownership

The current path remains:

```text
Renderer session configuration
  -> Electron Main IPC
  -> Node pi sidecar
  -> one DesktopAgentRuntime / pi Agent
  -> Main host proxy
  -> Rust host-core tools.execute
  -> durable mode policy and permission policy
  -> Rust builtin tool or Agent-only plugin execution
  -> result to the same pi Agent
```

Ownership after Plan:

- `packages/agent-runtime`: creates one pi Agent, composes the Agent/Plan
  prompt, builds the state-specific visible tool set, and normalizes events.
- Electron Main: routes typed IPC, forwards host events, and supervises the
  sidecar/host. It does not authorize a mode transition.
- Rust host-core: resolves durable session mode, enforces tool policy, owns
  `plan_approvals`, owns approval timeouts/recovery, and commits Plan -> Agent.
- Renderer: displays selector/state/approval and sends typed responses. It does
  not optimistically change mode or access SQLite.
- Plugin runtime: remains reachable only after Agent-side host policy allows a
  registered plugin tool. Plan never forwards a plugin tool call.

Two implementation gaps must be closed:

1. `tools.execute` must load `sessions.mode` by `sessionId`; a conflicting
   sidecar request field is diagnostic only.
2. Plugin tool risk and registration must survive the complete Agent path, but
   all plugin tools must be filtered and denied in Plan regardless of risk,
   grants, or Auto.

## 5. Tool contract

### 5.1 Visible tools

| Tool | Agent | Plan | Notes |
|---|---:|---:|---|
| `Read` | allow | allow | Host workspace/session root |
| `Glob` | allow | allow | Workspace search |
| `Grep` | allow | allow | Workspace content search |
| `BrowserPreview` | allow | allow | Explicit read-only UI inspection exception |
| `Bash` | permission policy | permission policy | Plan still follows Ask/Accept edits/Auto |
| `CompactContext` | allow | allow | Context-only, no workspace mutation |
| `EnterPlanMode` | allow | unavailable | Same Agent transition |
| `ExitPlanMode` | unavailable | allow | Structured approval proposal |
| `Write` | permission policy | deny | `WRITE_DISABLED_IN_PLAN` |
| `Edit` | permission policy | deny | `EDIT_DISABLED_IN_PLAN` |
| Plugin tools | registered risk policy | deny | `PLUGIN_DISABLED_IN_PLAN` |
| Unknown tools | deny | deny | No prefix or guessed registration |

Visible tools are model guidance only. Rust host-core independently applies
this matrix to every durable `tools.execute` call.

### 5.2 Permission behavior

| Operating mode | Ask | Accept edits | Auto |
|---|---|---|---|
| Agent Write/Edit | prompt | allow | allow |
| Agent Bash/plugins | prompt | prompt | allow |
| Plan Write/Edit/plugins | deny | deny | deny |
| Plan Bash | prompt | prompt | allow, may mutate |

Permission selection remains visible in both Agent and Plan. `allow-session`
grants may suppress normal Ask prompts for an eligible tool, but never override
Plan's Write/Edit/plugin hard deny. BrowserPreview and low-risk reads are
auto-allowed in both modes.

### 5.3 EnterPlanMode

```ts
type EnterPlanModeInput = {
  reason?: string;
};
```

Requirements:

1. The call is the only tool call in its assistant batch.
2. Host resolves the durable session and verifies `mode = agent`.
3. Host persists `mode = plan` before returning success.
4. Runtime updates planning state, prompt, and visible Plan tools only after
   host confirmation.
5. The next provider request uses the Plan prompt and tool schemas.

### 5.4 ExitPlanMode

The internal tool name remains stable; the UI label is `Submit plan`.

```ts
type PlanDocument = {
  title: string;
  summary: string;
  steps: Array<{
    title: string;
    description: string;
    files?: string[];
    validation?: string[];
  }>;
  risks?: string[];
  openQuestions?: string[];
  proposedCommands?: string[];
};

type ExitPlanModeInput = PlanDocument;
```

`proposedCommands` is display-only. It never pre-authorizes Bash. ExitPlanMode
must be the only tool call in its assistant batch. Host validates non-empty
title/summary/steps, active turn/session ownership, durable Plan state, and
proposal uniqueness before creating the pending record.

## 6. Plan approval protocol

### 6.1 Shared request/response

```ts
type PlanApprovalAction = "approve" | "request_changes" | "reject";

type PlanApprovalRequest = {
  requestId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  plan: PlanDocument;
  createdAt: string;
  expiresAt: string;
  timeoutMs: number;
};

type PlanApprovalResponse = {
  requestId: string;
  sessionId: string;
  action: PlanApprovalAction;
  feedback?: string;
  targetPermissionMode?: "ask" | "accept-edits" | "auto";
};
```

Approval requires `targetPermissionMode`; the renderer selects `ask` by
default and the Agent cannot select it. Request changes requires non-empty
feedback. Reject carries neither a target mode nor implicit execution grant.

### 6.2 Renderer IPC and host RPC

Renderer preload methods:

- `pi-desktop/plan/pending() -> { requests: PlanApprovalRequest[] }`
- `pi-desktop/plan/resolve(PlanApprovalResponse) -> { accepted: true }`

Host methods:

- `plans.pending`: return only requests backed by a live host waiter;
- `plans.resolve`: authenticate request/session/turn and commit one response;
- `plans.cancelSession` (optional): interrupt a pending request during explicit
  shutdown.

Host notifications and normalized renderer events:

- `plans.request` / `plan_approval_request` with the full structured request;
- `plans.resolved` / `plan_approval_resolved` with request/session/action;
- `plan_state_changed` with `inactive`, `planning`, or
  `awaiting_approval` and source `session`, `tool`, `approval`, `abort`, or
  `recovery`.

### 6.3 Approval transaction

```text
BEGIN
  plan_approvals: pending -> approved
  sessions.mode: plan -> agent
  sessions.permission_mode: explicit target mode
  append audit record
COMMIT
resolve waiting ExitPlanMode
start a fresh same-Agent model turn with Agent tools
```

If any write fails, the transaction rolls back, the tool does not return
success, and the session remains Plan. Request changes records feedback and
keeps `sessions.mode = plan`. Reject records the outcome, returns a terminal
failure to the run, and keeps Plan active.

## 7. Storage schema v8 and migration

The current transcript/storage contract is schema v7. Schema v8 is an
in-place, host-owned migration that adds plan approvals without changing the
transcript file format.

```sql
CREATE TABLE plan_approvals (
  request_id             TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id                TEXT NOT NULL,
  tool_call_id           TEXT NOT NULL UNIQUE,
  plan_json              TEXT NOT NULL,
  status                 TEXT NOT NULL,
  target_permission_mode TEXT,
  feedback               TEXT,
  created_at             INTEGER NOT NULL,
  expires_at             INTEGER NOT NULL,
  resolved_at            INTEGER,
  error_code             TEXT
);
```

Allowed statuses are `pending`, `approved`, `changes_requested`, `rejected`,
`expired`, and `interrupted`. Add session/status and pending/session indexes.
Only one pending proposal may exist for a session.

Migration transaction:

1. Create `pi.sqlite.v7.bak` and checkpoint the WAL.
2. Map every `sessions.mode = 'chat'` to `plan`.
3. Parse the structured app settings and map `defaultMode: "chat"` to `plan`.
4. Parse every scheduled task `config_json.mode` and map `chat` to `plan`.
5. Create `plan_approvals` and indexes.
6. Preserve transcripts, turns, revisions, project bindings, permission modes,
   providers, and task history.
7. Validate `plan | agent` and set `PRAGMA user_version = 8` last.

Any parse, constraint, or write failure rolls back and leaves schema v7
authoritative. New session, import, configure, and fork validators accept only
`plan | agent`; new sessions default Agent; forks copy mode but never pending
approvals. Historical transcript text and historical error strings are not
rewritten.

### 7.1 Recovery

- Renderer reload: `plans.pending` restores only a pending request with a live
  host waiter and original absolute deadline.
- Host/sidecar crash or full process restart: pending rows become
  `interrupted`, associated running turns become `aborted`, and sessions remain
  Plan. No old response is accepted and the Agent run is not resumed.
- Timeout becomes `expired`; user must submit a new plan.
- Session deletion cascades approval rows and cancels the waiter.
- Renderer state never clears Plan before the host resolution commits.

## 8. Runtime integration

`DesktopAgentRuntime` remains the only Agent runtime. Refactor setup into
deterministic composition helpers:

```ts
buildSystemPrompt(mode, planningState, context): string
buildTools(mode, planningState): AgentTool[]
applyOperatingMode(mode, planningState): void
```

The transition sequence is host-confirmed mode -> runtime planning state ->
prompt/tools -> normalized event -> next provider request. Approval starts a
new provider turn so the same Agent sees the Agent tool schemas before it can
request Write/Edit or plugins.

The Plan prompt must tell the Agent to inspect relevant files/specs/tests,
identify affected behavior and files, include validation/migration/recovery,
surface open questions, call ExitPlanMode when implementation-ready, wait for
approval, and revise from feedback. It must not claim that a plan was executed.
It must describe Bash as permission-gated and potentially mutating under Auto.

The Agent prompt retains execution-oriented instructions and the existing
permission/scratch/context behavior. Tool-batch guards reject mixed
EnterPlanMode or ExitPlanMode calls and reject transitions from the wrong
durable state.

## 9. Plugin policy

Plugin tools are Agent-only. During Plan:

- plugin tool definitions are omitted from the model-visible tool set;
- host-core returns `PLUGIN_DISABLED_IN_PLAN` before plugin dispatch;
- low manifest risk, declared permissions, session grants, and Auto cannot
  bypass the denial;
- the denial is audited with session/turn/tool identity;
- commands and panels may remain explicit user UI contributions, but cannot be
  model-callable Plan tools.

After approval, the same registered Agent tool follows the existing risk,
permission, timeout, and audit policy. Missing/invalid plugin risk defaults to
medium and never grants Plan access.

## 10. Scheduled and unattended policy

Plan is interactive-only for the first release. A scheduled/unattended run
whose durable mode is Plan fails before the provider request with
`PLAN_REQUIRES_INTERACTIVE_SESSION`. It does not create an approval request,
wait for a renderer, or auto-approve. Existing scheduled Chat records migrate
to Plan and require an explicit user switch to Agent. New scheduled tasks
default to Agent and use the normal permission policy.

## 11. UX behavior

Required visible behavior:

- composer selector contains Agent and Plan only;
- Agent is selected for new sessions and migrated legacy values display Plan;
- permission-mode selector remains visible in both modes;
- Plan copy explains that Bash prompts under Ask/Accept edits and may mutate
  under Auto, while Write/Edit/plugin tools remain unavailable;
- planning and awaiting-approval are distinct session states;
- approval card renders title, summary, steps, files, validation, risks,
  questions, and proposed commands;
- Approve offers Ask, Accept edits, and Auto with Ask selected;
- Request changes requires feedback and keeps Plan;
- Reject stops the run and keeps Plan;
- timeout/interruption/crash show a failed-closed state with a new-submission
  path;
- mode and approval controls are disabled during an unrelated running turn;
- all new user-facing strings, accessible names, errors, and states exist in
  English and zh-CN;
- Settings default mode and command palette expose Agent/Plan, with no Chat mode
  command or `/chat-mode` alias.

## 12. Error codes

Add to the shared registry and host numeric mapping:

| Code | Meaning |
|---|---|
| `WRITE_DISABLED_IN_PLAN` | Write denied by Plan policy |
| `EDIT_DISABLED_IN_PLAN` | Edit denied by Plan policy |
| `PLUGIN_DISABLED_IN_PLAN` | plugin tool denied by Plan policy |
| `PLAN_APPROVAL_REQUIRED` | ExitPlanMode is waiting for approval |
| `PLAN_APPROVAL_TIMEOUT` | approval deadline expired |
| `PLAN_APPROVAL_STALE` | response does not match live request/session/turn |
| `PLAN_APPROVAL_INTERRUPTED` | abort/crash/persistence failure closed approval |
| `PLAN_REQUIRES_INTERACTIVE_SESSION` | unattended Plan cannot run |

There is no `BASH_DISABLED_IN_PLAN` code. Plan Bash follows permission mode.
Generic `TOOL_DENIED` remains the model-facing normalized denial where the
caller does not need the more specific policy code.

## 13. Implementation touchpoints

### Shared contracts

- `packages/shared/src/types.ts`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/errors.ts`
- shared protocol/error tests

### pi runtime and sidecar

- `packages/agent-runtime/src/runtime.ts`
- `packages/agent-runtime/src/sidecar.ts`
- plan-tool composition module if it improves isolated tests
- system prompt and normalized event tests

### Rust host-core

- `crates/host-core/src/db.rs`
- `crates/host-core/src/sessions.rs`
- `crates/host-core/src/permissions.rs`
- `crates/host-core/src/rpc/mod.rs`
- plan approval broker module
- plugin registration/dispatch policy path
- migration, recovery, authorization, and RPC tests

### Electron and renderer

- `apps/desktop/electron/main/index.ts`
- `apps/desktop/electron/main/agent-sidecar.ts`
- `apps/desktop/electron/preload/index.ts`
- `apps/desktop/src/stores/app-store.ts`
- `apps/desktop/src/components/Composer.tsx`
- approval card/transcript components
- settings defaults, builtin commands, and EN/zh-CN catalogs

## 14. Delivery slices

1. **Contract freeze**: ADR 0033, D166, baseline 0.4.13, protocol v7/schema
   v8, affected specs, and E2E-087 through E2E-097.
2. **Storage and host boundary**: v7->v8 migration, durable mode resolution,
   Plan tool matrix, approval table/broker, error mapping, and recovery.
3. **pi vertical slice**: state-aware prompts/tools, EnterPlanMode,
   ExitPlanMode, same-Agent feedback, approval continuation, and plugin filter.
4. **Desktop interaction**: typed Plan IPC, renderer projection, approval card,
   permission selector in Plan, migration display, scheduled guard, and locales.
5. **Focused verification and release**: unit/RPC/IPC checks, documented E2E
   execution only when explicitly requested, then normal M6 and release gates.

No implementation is considered complete from the documentation change alone;
M6 remains In Progress on the project board.

## 15. Focused verification plan

### Shared/runtime unit checks

- deterministic Agent and Plan prompt/tool composition;
- one Agent identity across UI entry, EnterPlanMode, feedback, approval, and
  post-approval execution;
- Plan tool list and mixed-batch transition guards;
- Plan Bash Ask/Accept edits/Auto behavior;
- approval state machine and same-Agent feedback;
- plugin definitions absent in Plan and restored for Agent;
- stale renderer event cannot clear Plan.

### Rust host/RPC checks

- v7->v8 migration maps session/default/scheduled Chat values and preserves
  data;
- migration rollback leaves v7 usable;
- durable session mode defeats spoofed request mode;
- Plan denies Write/Edit/plugin/unknown under every permission mode;
- Plan allows BrowserPreview and context controls;
- Plan Bash prompts under Ask/Accept edits and runs under Auto;
- approval transaction changes mode and permission mode atomically;
- wrong session/turn/request, duplicate response, timeout, abort, crash,
  persistence failure, and stale response all fail closed;
- startup interrupts orphaned pending approvals;
- scheduled Plan fails before provider invocation.

### Renderer/IPC checks

- selector persists only Agent/Plan and Agent remains new-session default;
- permission selector works in Plan and communicates Bash's Auto tradeoff;
- approval card renders all fields and sends only valid typed responses;
- request changes requires feedback and does not clear Plan early;
- reload restores a live request; restart renders no actionable stale request;
- command palette/slash aliases contain Plan and Agent, not Chat;
- English and zh-CN catalogs have matching approval/state/error keys.

### E2E documentation

The focused scenarios are:

- `E2E-087` migration;
- `E2E-088` Plan tool set;
- `E2E-089` Bash permission matrix;
- `E2E-090` approval into Agent;
- `E2E-091` same-Agent request changes;
- `E2E-092` reject/timeout;
- `E2E-093` host authority;
- `E2E-094` reload/restart recovery;
- `E2E-095` plugin denial;
- `E2E-096` scheduled/unattended policy;
- `E2E-097` UX/localization and command removal.

These scenarios are documented only in Phase 1. E2E commands must not be run
without an explicit user request.

## 16. Acceptance criteria

The implementation is complete only when:

1. One pi Agent is used before, during, and after planning.
2. The selector is Agent/Plan; Agent is default; Chat is not an operating mode.
3. Legacy Chat session/settings/scheduled values migrate to Plan.
4. Rust resolves durable mode and owns authoritative tool policy.
5. Plan exposes Read/Glob/Grep/BrowserPreview/Bash plus plan/context controls.
6. Plan denies Write/Edit/plugin/unknown tools in every permission mode.
7. Plan Bash prompts under Ask/Accept edits and may mutate under Auto.
8. ExitPlanMode creates a structured host-owned approval request and blocks.
9. Approval atomically enters Agent with selected permission mode and resumes
   the same Agent.
10. Request changes reaches the same Agent and remains Plan.
11. Reject, timeout, abort, crash, stale response, and persistence failure stay
    Plan and grant no execution capability.
12. Protocol v7 and schema v8 migration/recovery contracts pass focused checks.
13. Plugin denial, scheduled policy, UX, localization, and E2E documentation
    are synchronized.

## 17. Explicit non-goals

- second planner Agent/model/service;
- separate Plan permission mode;
- read-only Bash classification or command pre-authorization;
- Plan workspace plan-file writes;
- Plan plugin/MCP agent tools;
- automatic approval for scheduled/background Plan;
- resuming an in-flight Agent after full process restart;
- renaming the internal conversation `page = "chat"` route.
