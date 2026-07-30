# 06. Host RPC Protocol

## 1. Goal

Define the local protocol between:

- Electron main (orchestrator)
- Rust host-core (privileged backend)
- Node pi agent sidecar (tool requester / event source consumer via host)

MVP transport decision (**D001**):

> **stdio JSON-RPC over NDJSON**

## 2. Transport

- Process: Electron main spawns Rust host-core sidecar
- Channel: child process stdin/stdout
- Framing: one JSON object per line (NDJSON)
- Encoding: UTF-8
- Request/response: JSON-RPC 2.0 style

### Request

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "method": "tools.execute",
  "params": {}
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "result": {}
}
```

### Error

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "error": {
    "code": 1003,
    "message": "PATH_OUTSIDE_WORKSPACE",
    "data": {
      "errorCode": "PATH_OUTSIDE_WORKSPACE",
      "details": {}
    }
  }
}
```

### Notification (server → client, no id)

```json
{
  "jsonrpc": "2.0",
  "method": "permissions.request",
  "params": {}
}
```

## 3. Handshake

On spawn, Electron must call:

### `app.handshake`

Params:

```ts
type HandshakeParams = {
  protocolVersion: 7
  client: "electron-main"
  clientVersion: string
  locale: string // default "en"
}
```

Result:

```ts
type HandshakeResult = {
  protocolVersion: 7
  host: "rust-host-core"
  hostVersion: string
  features: string[]
}
```

Rules:

1. If protocol major version mismatches → abort boot
2. Electron should exit with actionable error if handshake fails
3. All subsequent calls require successful handshake
4. Version 4 introduced the durable notification inbox and the
   notification-bearing `session.endTurn` result.
5. Version 5 requires the host-owned `session.fork` snapshot operation; a
   version 4 host must be rejected before chat becomes interactive (ADR 0023).
6. Version 6 adds durable model-context checkpoints through
   `session.appendCompaction`; a version 5 host must be rejected before the
   runtime claims automatic context protection (ADR 0030).
7. Version 7 adds the Plan/Agent operating-mode union, plan state and approval
   events, and the `plans.pending` / `plans.resolve` methods. A version 6 host
   must be rejected before the UI becomes interactive (ADR 0033).

## 4. Method catalog (MVP)

### App
- `app.handshake`
- `app.health`
- `app.getVersion`

### Workspace
- `workspace.get`
- `workspace.set`
- `workspace.clear`

### Projects
- `projects.list` — returns durable project records ordered pinned-first, then
  by last-opened time; includes records materialized by session imports

### Secrets
- `secrets.set`
- `secrets.delete`
- `secrets.has`
- // never `secrets.get` to renderer logs

### Settings
- `settings.get`
- `settings.set`

### Sessions
- `session.list`
- `session.create` — accepts optional `thinkingLevel`; missing/null defaults
  to `off`
- `session.fork` — accepts `sessionId`, an optional caller-provided display
  `title`, and optional `throughMessageId`; creates
  one independent session from the source's current active canonical
  transcript, truncated inclusively at the selected message when supplied.
  The child inherits project/provider/model/mode/thinking and
  permission configuration, receives new message/tool-call ids, and starts
  without turns, revisions, notifications, artifacts, grants, or scratch data.
  Missing sources return `NOT_FOUND`; Electron rejects active sources with
  `AGENT_BUSY` before forwarding and normalizes the host's persisted
  running-turn `CONFLICT` fallback to `AGENT_BUSY`; an unknown source or
  `throughMessageId` returns `NOT_FOUND`
- `session.get`
- `session.delete`
- `session.rename`
- `session.configure` — atomically persists `mode`, `providerId`, `modelId`,
  and optional `thinkingLevel` for the next pi turn; omitting/null
  `thinkingLevel` preserves the current value; invalid modes or levels return
  `INVALID_PARAMS`; mode is `plan | agent` and changing it is allowed only
  while idle
- `session.appendMessage`
- `session.appendCompaction` — sidecar-only append of the newest typed
  model-context checkpoint. It requires non-empty checkpoint/summary/boundary
  ids and non-negative `tokensBefore`; it does not insert a message/search row
  or change the visible transcript projection
- `session.replaceMessages` — atomic transcript rewrite (temp-file rename +
  one index transaction, D119) used by regenerate/edit flows; it preserves the
  newest checkpoint only while both its boundary and optional first-kept id
  remain valid in the rewritten prefix
- `session.saveRevision` — archive a regenerate branch under
  `(sessionId, rootUserId)`
- `session.listRevisions` — list linear variants for a root user family
- `session.activateRevision` — replace live transcript with `prefix + branch`
  and stamp root pager metadata
- `session.beginTurn`
- `session.endTurn` — atomically moves a running turn to its terminal state and
  conditionally returns the newly created notification for `completed`/`error`;
  returns no notification when `createNotification=false`, for `aborted`, or
  for an already-terminal turn
- `session.import` — atomically imports one converted session; a non-empty
  project path is normalized and upserted into `projects` before the session
  references it; returns `{ imported, skipped }`

### Plan approvals

- `plans.pending` — returns still-live pending approval requests for renderer
  reload recovery; it never returns an approval whose host waiter has died
- `plans.resolve` — validates and commits one matching approval response
- `plans.cancelSession` — optional explicit shutdown cleanup; marks a pending
  request interrupted and leaves the session in Plan

Canonical thinking levels at the host boundary are:

```text
off | minimal | low | medium | high | xhigh | max
```

Session summaries/details always return `thinkingLevel`. Assistant messages
may return `thinking`; host storage maps it to a canonical content block rather
than appending it to answer `content`.

### Tools
- `tools.list`
- `tools.execute`
- `tools.abort`

### Permissions
- `permissions.evaluate`
- `permissions.resolve`
- `permissions.listSessionGrants`
- `permissions.clearSessionGrants`

### Plugins
- `plugins.list`
- `plugins.loadDev`
- `plugins.installFromPath`
- `plugins.enable`
- `plugins.disable`
- `plugins.uninstall`
- `plugins.getPermissions`

### Audit
- `audit.append`
- `audit.query` (optional later)

### Notification (D117)
- `notification.list`
- `notification.markRead`
- `notification.markAllRead`
- `notification.clear`

## 4a. Notification contracts (protocol v4)

```ts
type AppNotification = {
  id: string;
  kind: "task.completed" | "task.failed";
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  errorCode?: string;
  createdAt: string; // ISO-8601 UTC
  readAt?: string | null;
};

type SessionEndTurnParams = {
  turnId: string;
  status: "completed" | "error" | "aborted";
  errorCode?: string;
  usage?: unknown;
  createNotification?: boolean; // default true; Electron supplies visibility decision
};

type SessionEndTurnResult = {
  ok: boolean; // false when the turn was missing/already terminal
  notification?: AppNotification; // omitted when no row was inserted
};

type NotificationListParams = {
  unreadOnly?: boolean; // default false
  limit?: number;       // default/max 200
};

type NotificationListResult = {
  notifications: AppNotification[]; // newest first
  unreadCount: number;               // global count, independent of filter
};
```

- `notification.markRead({ id }) -> { ok }` is idempotent. `ok=false` means
  the id does not exist; an already-read row remains successful.
- `notification.markAllRead({}) -> { ok: true }` updates every unread row in
  one transaction.
- `notification.clear({}) -> { ok: true }` deletes inbox rows only.
- No `notification.created` JSON-RPC server notification is emitted. Electron
  receives the inserted record directly from `session.endTurn`, avoiding a
  second ordering channel between terminal turn persistence and UI refresh.
- `createNotification=false` suppresses only inbox insertion; the running turn
  still reaches its requested terminal state in the same transaction. Missing
  or non-boolean values default to true so unknown/stale UI state cannot lose a
  notification.
- `sessionTitle` is the stable session-name snapshot stored with the row.
  Localized event title/body prose is derived by Electron/renderer and never
  crosses host RPC.

## 5. Tool execute contract

### `tools.execute` params

```ts
type ToolsExecuteParams = {
  sessionId: string
  turnId?: string
  toolCallId: string
  toolName: string
  args: unknown
  /** Diagnostic/request context only; never used for authorization. */
  requestedMode?: "plan" | "agent"
  timeoutMs?: number
}
```

Authoritative mode and workspace resolution are session-scoped:

1. Host loads `sessionId` and resolves its persisted `project_id`/path.
2. Host reads the persisted `sessions.mode` and validates it as `plan | agent`.
   A conflicting `requestedMode` is ignored for authorization and recorded only
   as diagnostic data.
3. That path becomes the tool sandbox root for permission preview, execution,
   artifact paths, and audit context.
4. The mutable `workspace.get` selection is not consulted for a valid durable
   session, so switching a retained project tab cannot redirect a background
   call.
5. A durable path-less session resolves no root and receives
   `WORKSPACE_REQUIRED` where the tool requires one. A selected project is not
   inherited.
6. Legacy calls whose session does not exist may temporarily fall back to the
   selected workspace; new renderer flows must always provide a valid
   `sessionId`.
7. A database/session-resolution error returns `INTERNAL` and fails closed;
   only a confirmed missing session may use the legacy fallback.

Before generic permission evaluation, host-core applies the mode policy:

- Plan allows `Read`, `Glob`, `Grep`, `BrowserPreview`, `Bash`,
  `CompactContext`, and `ExitPlanMode` as applicable to the live planning
  state.
- Plan denies `Write`, `Edit`, every plugin tool, and unknown tools under all
  permission modes and grants.
- Plan `Bash` follows the resolved permission mode: `ask` and `accept-edits`
  emit `permissions.request`; `auto` executes without confirmation and may
  mutate.
- Agent applies the normal registered-tool and permission policy.

The visible tool list is not the security boundary; a forged RPC call is
authorized by this host-side matrix.

### result

```ts
type ToolsExecuteResult = {
  toolCallId: string
  ok: boolean
  isError?: boolean
  content: unknown
  durationMs: number
  denied?: boolean
  errorCode?: string
}
```

### 5.1 Plan submission and approval contracts

`ExitPlanMode` is handled as a host transition before generic tool execution.
The plan is application/transcript state, not a workspace file and not command
authorization.

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
  proposedCommands?: string[]; // display-only
};

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
  action: "approve" | "request_changes" | "reject";
  feedback?: string;
  targetPermissionMode?: "ask" | "accept-edits" | "auto";
};
```

Host notifications:

```text
method: "plans.request"
params: PlanApprovalRequest

method: "plans.resolved"
params: {
  requestId: string
  sessionId: string
  action: "approve" | "request_changes" | "reject"
}
```

`plans.resolve` accepts only an authenticated, still-pending request whose
session and turn match. `approve` requires an explicit permission mode and
commits `plan_approvals.approved`, `sessions.mode = agent`, and the selected
`sessions.permission_mode` atomically before waking `ExitPlanMode`. The same
Agent then receives a new provider request with Agent tools.

`request_changes` requires non-empty feedback, records
`changes_requested`, leaves the session in Plan, and returns the feedback as a
model-visible Plan tool result. `reject` records `rejected`, leaves Plan
active, and stops the run. Timeout records `expired`; abort, host crash,
sidecar crash, or persistence failure records `interrupted`. All non-approval
outcomes fail closed and grant no execution tool.

## 6. Permission request notification

Host may emit:

```ts
method: "permissions.request"
params: {
  requestId: string
  sessionId: string
  toolCallId: string
  toolName: string
  risk: "low" | "medium" | "high"
  argsPreview: unknown
  reason: string
  timeoutMs: 120000
}
```

Electron/UI resolves via:

```ts
method: "permissions.resolve"
params: {
  requestId: string
  decision: "allow-once" | "allow-session" | "deny"
}
```

Timeout behavior (**D005**): after 120s unresolved → deny.

## 7. Error codes

| code | errorCode | meaning |
|---|---|---|
| 1000 | INTERNAL | unexpected host failure |
| 1001 | UNAUTHORIZED | missing/invalid handshake or capability |
| 1002 | INVALID_PARAMS | schema validation failed |
| 1003 | PATH_OUTSIDE_WORKSPACE | path sandbox violation |
| 1004 | TOOL_DENIED | permission denied |
| 1005 | TOOL_TIMEOUT | tool exceeded timeout |
| 1006 | WORKSPACE_REQUIRED | no workspace bound |
| 1007 | NOT_FOUND | entity missing |
| 1008 | CONFLICT | busy/conflict state |
| 1009 | PLUGIN_INVALID | manifest/validation failure |
| 1010 | PLUGIN_LOAD_FAILED | enable/load failure |
| 1011 | PROTOCOL_MISMATCH | handshake version mismatch |
| 1012 | WRITE_DISABLED_IN_PLAN | Write is unavailable in Plan |
| 1013 | EDIT_DISABLED_IN_PLAN | Edit is unavailable in Plan |
| 1014 | PLUGIN_DISABLED_IN_PLAN | plugin tools are unavailable in Plan |
| 1015 | PLAN_APPROVAL_REQUIRED | ExitPlanMode is waiting for approval |
| 1016 | PLAN_APPROVAL_TIMEOUT | approval deadline expired |
| 1017 | PLAN_APPROVAL_STALE | response does not match live request/session/turn |
| 1018 | PLAN_APPROVAL_INTERRUPTED | approval failed closed during abort/recovery |
| 1019 | PLAN_REQUIRES_INTERACTIVE_SESSION | unattended Plan cannot run |

## 8. Concurrency / ordering

1. Requests may be concurrent, but tools for the same `sessionId` execute serially by default
2. Different sessions may continue concurrently across retained project tabs;
   each resolves its own project root and grants
3. Notifications may arrive anytime after handshake
4. Abort should be best-effort and idempotent
5. Plan approval requests are session/turn scoped; only one pending request
   exists per session and resolution is serialized by host-core
6. A host or sidecar crash interrupts pending approvals, keeps the durable
   session in Plan, and rejects late renderer responses
7. A session fork is one host-owned snapshot operation. The source transcript
   is never rewritten, and a handled child write/index failure leaves no
   visible session or orphan transcript file. A process crash follows D119's
   existing orphan-transcript recovery policy.
8. A message-scoped fork is identical except that the canonical snapshot ends
   inclusively at `throughMessageId`. It still remaps message/tool-call ids and
   creates no runtime or revision state, so later child reseed/cache state is
   isolated by the new session id.

## 9. Logging rules

- Never log API keys/secrets
- Tool args may be redacted in audit previews
- Every tools.execute gets trace id = `toolCallId`

## 10. Acceptance

1. Electron spawns host and completes handshake
2. health method returns ok
3. denied tool path returns `TOOL_DENIED`
4. timeout path returns deny decision after 120s
5. switching the selected workspace from A to B does not change the tool root
   of a call issued by session A
6. Protocol v4 `session.endTurn` creates/returns exactly one notification for
   unseen completed/failed turns and none for visible-current, aborted, or
   repeated terminal updates
7. Notification list/unread/read-all/clear round-trip through host-core and
   remain bounded to the newest 200 durable rows
8. Forking an idle session produces an independently mutable child with the
   same active transcript and durable execution configuration while leaving
   the source and its regenerate revisions unchanged
9. Forking through a message excludes every later source row and rejects an
   unknown message without creating a child
10. A forged `requestedMode` cannot authorize a tool against the durable mode;
    Plan denies Write/Edit/plugin/unknown tools and applies permission prompts
    to Bash according to `ask`/`accept-edits`/`auto`
11. Plan submission, approval, feedback, rejection, timeout, abort, crash, and
    stale responses produce the documented durable statuses and events
