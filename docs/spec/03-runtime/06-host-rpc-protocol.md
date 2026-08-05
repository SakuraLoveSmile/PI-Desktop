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

The control pipe is resource-isolated inside host-core. One dedicated OS
thread reads stdin and one dedicated OS thread serializes stdout; request and
tool tasks never perform Tokio stdio operations. This keeps temporary OS
thread exhaustion from turning a pipe read/write into a Tokio blocking-pool
panic. The threads retry interrupted and transient nonblocking errors while
preserving one-message-per-line framing; an unrecoverable pipe error ends the
host and is handled by the normal Electron supervision path.

### 2.1 Runtime admission and backpressure

Host-core does not create an unbounded task or subprocess for every request.
The RPC dispatcher caps active requests at 32. `tools.execute` then enters a
bounded execution budget:

- 16 total tool executions
- 4 concurrent `Bash` processes globally, 2 per session
- 8 read/search tools globally
- 2 mutating tools globally, 1 per session
- 4 plugin tools globally
- 4 tool executions per session
- 64 queued tool executions globally

Permission prompts do not consume an execution slot. A full queue returns
`HOST_OVERLOADED` with retryable semantics in the tool result instead of
waiting indefinitely or spawning more work. The limits are host-owned so
Electron and the sidecar cannot independently over-admit the same resources.
The per-session mutation permit is acquired before the global mutation slot;
queued `Write`/`Edit` calls therefore do not hold global capacity while waiting
for an earlier mutation in the same session.

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
  protocolVersion: 6
  client: "electron-main"
  clientVersion: string
  locale: string // default "en"
}
```

Result:

```ts
type HandshakeResult = {
  protocolVersion: 6
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

## 4. Method catalog (MVP)

### App
- `app.handshake`
- `app.health`
- `app.getVersion`

`app.health` returns a diagnostic `toolBudget` object:

```ts
type ToolBudgetHealth = {
  active: number
  queued: number
  total: number
  shell: number
  reads: number
  mutations: number
  plugins: number
}
```

### Workspace
- `workspace.get`
- `workspace.set`
- `workspace.clear`

### Review snapshots (ADR 0043)
- `review.rollback({sessionId, snapshotId})` — verify the current post-tool
  hash, restore the session-owned previous bytes, and return one of
  `rolledBack`, `alreadyRolledBack`, `conflict`, or `unavailable`.

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
  `INVALID_PARAMS`
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

Tool execution starts only after admission. Shell spawn retries transient
resource exhaustion (`EAGAIN` / `WouldBlock`) with bounded backoff, never
retries a command after it has started, and reaps timed-out children before
releasing the execution slot.

`session.appendMessage` is idempotent by message id. Electron main may keep
message appends in its application-owned outbox while host-core is restarting;
the outbox flushes in order after a successful handshake.

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
  mode: "read-only" | "agent"   // D188: only `agent` is UI-reachable
  timeoutMs?: number
}
```

Workspace resolution is session-scoped:

1. Host loads `sessionId` and resolves its persisted `project_id`/path.
2. That path becomes the tool sandbox root for permission preview, execution,
   artifact paths, and audit context.
3. The mutable `workspace.get` selection is not consulted for a valid durable
   session, so switching a retained project tab cannot redirect a background
   call.
4. A durable path-less session resolves no root and receives
   `WORKSPACE_REQUIRED` where the tool requires one. A selected project is not
   inherited.
5. Legacy calls whose session does not exist may temporarily fall back to the
   selected workspace; new renderer flows must always provide a valid
   `sessionId`.
6. A database/session-resolution error returns `INTERNAL` and fails closed;
   only a confirmed missing session may use the legacy fallback.

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
  // Workspace Write/Edit results may include content.details.review. The
  // record is persisted with the tool message and is independent of Git.
  // Bash command failures preserve content.exitCode/stdout/stderr while
  // setting ok=false, isError=true, and errorCode=TOOL_FAILED.
  // The agent runtime forwards isError into the tool transcript without
  // dropping the structured content/details needed for recovery.
}
```

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
| -32029 | HOST_OVERLOADED | RPC dispatcher capacity exhausted |

## 8. Concurrency / ordering

1. Requests may be concurrent within the dispatcher cap. Read/search tools may
   run in parallel; `Write`/`Edit` are bounded and FIFO-ordered per session,
   with at most one mutation in flight for a session.
2. Different sessions may continue concurrently across retained project tabs;
   each resolves its own project root and grants
3. Notifications may arrive anytime after handshake
4. Abort should be best-effort and idempotent
5. A session fork is one host-owned snapshot operation. The source transcript
   is never rewritten, and a handled child write/index failure leaves no
   visible session or orphan transcript file. A process crash follows D119's
   existing orphan-transcript recovery policy.
6. A message-scoped fork is identical except that the canonical snapshot ends
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
