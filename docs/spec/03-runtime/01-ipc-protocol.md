# 01. IPC Protocol

## 1. Goal

Define a stable contract between the renderer and main.

Principles:

1. All capabilities go through the preload allowlist
2. Requests/responses are typed
3. Long-running tasks use event streams, not a single oversized response
4. Errors must have a code + message

## 2. API Groups

| Domain | Description |
|---|---|
| `app` | App info, health checks |
| `agent` | Conversation, abort, status |
| `session` | Session CRUD / history |
| `settings` | Config read/write |
| `secrets` | Secret write/delete/exists (never return plaintext to UI logs) |
| `project` | Workspace selection and query |
| `tool` | Permission confirmation callback |
| `log` | Diagnostics that the frontend can display |
| `plugin` | Plugin install/enable-disable/query/permissions |
| `commandPalette` | Command palette search and execution |
| `workspace` | Working-tree inspection for the work panel (diff) |
| `terminal` | Work panel PTY create/write/resize/dispose + data/exit events |
| `browser` | Work panel embedded preview navigation/bounds/visibility + state events |
| `fs` | Work panel workspace file listing/reading/reveal (read-only) |
| `window` | Frameless window state, controls, and bounded work-panel width reservation |
| `menu` | Allowlisted application-menu commands and native editing/window actions |
| `notification` | Durable inbox list/read/clear and new/activated events |

## 3. Channel Conventions

```text
invoke: pi-desktop/<domain>/<action>
event: pi-desktop/<domain>/event/<name>
```

Examples:

- `pi-desktop/agent/prompt`
- `pi-desktop/agent/abort`
- `pi-desktop/agent/event/message`
- `pi-desktop/session/list`
- `pi-desktop/project/open`
- `pi-desktop/project/openFolder`

## 4. Common Response Envelope

```ts
type Result<T> =
 | { ok: true; data: T }
 | { ok: false; error: AppError };

type AppError = {
 code: string;
 message: string;
 details?: unknown;
 retriable?: boolean;
};
```

## 5. Agent API

### 5.1 prompt

```ts
type AgentPromptRequest = {
 sessionId: string;
 content: string;
 /** Truncate durable transcript to N leading messages before append (regenerate). */
 truncateBefore?: number;
};

type AgentPromptResponse = {
 accepted: boolean;
 turnId: string;
};
```

Slash template expansion (D123): when `content` starts with `/name` and the
name matches a loaded pi prompt template, the main-process handler expands
the invocation (`parseCommandArgs` + `substituteArgs`) before persisting.
The persisted user message stores `content = expanded text` plus an optional
`command: string` field carrying the typed invocation for transcript
display. Reseed replays `content`, so the agent context is identical across
restarts. Builtin/plugin slash aliases never reach this channel — the
renderer executes them locally. Unknown `/foo` passes through as literal
content. `@path` tokens are not transformed anywhere in the pipeline (D124).

Prompt execution resolves `mode`, `providerId`, `modelId`, and `thinkingLevel`
from the durable
session record. The renderer changes those values through
`pi-desktop/session/configure` while the session is idle:

```ts
type ThinkingLevel =
  | "off" | "minimal" | "low" | "medium"
  | "high" | "xhigh" | "max";

type SessionConfigureRequest = {
  id: string;
  mode: "chat" | "agent";
  providerId?: string;
  modelId?: string;
  thinkingLevel: ThinkingLevel;
};
```

Image and file payloads are not part of the current prompt contract.

Regenerate history (D109) also uses session channels:

- `pi-desktop/session/saveRevision`
- `pi-desktop/session/listRevisions`
- `pi-desktop/session/activateRevision`

Root user turns may include `revisionRootId`, `revisionCount`, and
`activeRevision`. Activating a revision replaces the live tail with
`prefix + archived branch` and disposes the session agent.
 Composer
attachment affordances remain hidden until main, sidecar, pi model
capabilities, and persistence all consume the payload.

### 5.2 abort

```ts
type AgentAbortRequest = {
 sessionId: string;
 turnId?: string;
};
```

### 5.3 compact (protocol v6)

```ts
type AgentCompactRequest = { sessionId: string };
type AgentCompactResponse = { accepted: boolean };
```

`pi-desktop/agent/compact` creates a model-context checkpoint for an idle
session. It is available even when automatic context protection is disabled.
Missing provider/session configuration fails through the normal `AppError`
envelope; an active turn or compaction returns `AGENT_BUSY`.

### 5.4 getStatus

```ts
type AgentStatus = {
 sessionId: string;
 isRunning: boolean;
 currentTurnId?: string;
 modelId?: string;
 pendingToolConfirmations: number;
};
```

## 6. Agent Events

Pushed from main → renderer:

```ts
type AgentEventEnvelope = {
 sessionId: string;
 turnId?: string;
 ts: number;
 event: AgentEvent;
};

type AgentEvent =
 | { type: "agent_start" }
 | { type: "agent_end"; messageIds: string[] }
 | { type: "turn_start" }
 | { type: "turn_end" }
 | { type: "message_start"; message: UiMessage }
 | { type: "message_update"; message: UiMessage;
     deltaText?: string; deltaThinking?: string }
 | { type: "message_end"; message: UiMessage }
 | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
 | { type: "tool_update"; toolCallId: string; partialResult?: unknown }
 | { type: "tool_end"; toolCallId: string; result: unknown; isError?: boolean }
 | { type: "tool_permission_request"; request: ToolPermissionRequest }
 | { type: "compaction_start";
     reason: "manual" | "threshold" | "overflow" }
 | { type: "compaction_end";
     reason: "manual" | "threshold" | "overflow";
     ok: boolean; tokensBefore?: number; firstKeptMessageId?: string;
     willRetry: boolean; error?: { code: string; message: string } }
 | { type: "error"; error: AppError }
 | { type: "status"; status: AgentStatus };
```

> These are **UI-normalized events**, not a pass-through of raw pi events.
> `packages/agent-runtime` is responsible for mapping pi events to this model.

`turn_end` closes one model/tool turn but is not a terminal desktop run event:
another provider request may follow immediately. Renderer busy state and
durable turn completion therefore settle only on `agent_end` or `error`.
`compaction_start` keeps the run busy; a manual-only operation settles on its
matching `compaction_end`, while threshold/overflow compaction remains inside
the active agent run. The soft context-management instruction is transient and
has no protocol event or transcript row of its own. A model-issued
`CompactContext` call uses the normal tool lifecycle and is visible/durable.

## 6a. Notification API (D117, protocol v4)

Durable inbox requests are allowlisted preload invokes that Electron forwards
to the singular host RPC domain without renderer access to SQLite:

- `pi-desktop/notification/list({ unreadOnly?, limit? })`
- `pi-desktop/notification/markRead({ id })`
- `pi-desktop/notification/markAllRead()`
- `pi-desktop/notification/clear()`

The renderer invokes
`pi-desktop/notification/setViewingSession({ sessionId })` whenever the chat
page's active session changes; `sessionId: null` clears the viewing context on
non-chat pages. Electron combines this hint with Main-owned window
visibility/focus at the terminal event boundary. It also invokes
`pi-desktop/notification/showNative({ id, sessionId, title, body })` after
localizing a new record. This Electron-only request never crosses into the host
RPC domain.

```ts
type AppNotification = {
  id: string;
  kind: "task.completed" | "task.failed";
  sessionId: string;
  sessionTitle: string;
  turnId: string;
  errorCode?: string;
  createdAt: string;
  readAt?: string | null;
};

type NotificationListResult = {
  notifications: AppNotification[];
  unreadCount: number;
};

type NotificationChangedEvent = {
  notification: AppNotification;
};

type NotificationActivatedEvent = {
  id: string;
  sessionId: string;
};
```

Main sends two events:

- `pi-desktop/notification/event/changed` after `session.endTurn` returns a
  newly inserted record. Renderer merges the record into its bounded local list
  and recalculates the exact unread count. A terminal result already visible in
  the focused current chat, repeated terminal updates, and aborted turns emit
  nothing.
- `pi-desktop/notification/event/activated` after the user clicks Electron's
  native system notification. Renderer follows its existing session-selection
  path, including project activation for a project-bound session.

Electron owns the native surface while the renderer derives localized
title/body text from the structured record. Electron accepts `showNative` only
for a valid notification/session pair, shows a native notification only when
the main window is unfocused and the platform API is supported, then
restores/shows and focuses the window before emitting `activated`. There is no
native notification while focused and no permission, scheduled-reminder, or
plugin source in this contract. Native delivery is best-effort; the durable
inbox remains authoritative when the OS suppresses a banner. On Windows,
Electron Main registers `com.pi-desktop.app` as the process AppUserModelID
before readiness and before any window is created. The ID matches the NSIS
package identity so notification attribution, notification settings, taskbar
grouping, and installed shortcuts resolve to `PI-Desktop`, never the stock
Electron host.

The viewing-session hint is advisory and fail-safe: missing, stale, hidden, or
unfocused renderer state creates the durable notification. Suppression occurs
only when the main window is visible and focused and the reported chat session
matches the finishing session. Window creation, renderer reload, and renderer
process loss clear the hint before any later terminal event is evaluated.

## 7. Session API

```ts
type SessionSummary = {
 id: string;
 title: string;
 projectPath?: string;
 modelId?: string;
 providerId?: string;
 mode: "chat" | "agent";
 thinkingLevel: ThinkingLevel;
 supportsReasoning?: boolean;
 supportedThinkingLevels?: ThinkingLevel[];
 updatedAt: string;
 createdAt: string;
};

type UiMessage = {
 id: string;
 role: "user" | "assistant" | "system" | "tool";
 content: string;
 thinking?: string; // assistant reasoning, never folded into content
 error?: AppError;  // structured failure owned by this assistant turn
 createdAt: string;
 // status/tool fields omitted here
};

type SessionDetail = SessionSummary & {
 messages: UiMessage[];
};
```

Electron main enriches session list/get/create/fork/configure results with
effective reasoning capability from pi-ai's model record for that session's
exact `(providerId, modelId)`. Missing pi model metadata yields
`supportsReasoning: false` and `off`; cached discovery and legacy provider
overrides do not replace pi semantics. The Rust host remains authoritative only
for the durable `thinkingLevel`.

Minimal interface:

- `session/list`
- `session/create`
- `session/fork({ sessionId, title?, throughMessageId? }) -> { session: SessionDetail }`
- `session/get`
- `session/delete`
- `session/rename`
- `session/importScan`
- `session/importRun(candidates) -> { imported, skipped, failed }`

Import candidates carry `projectPath: string | null`. A successful import
refreshes both sessions and the durable Projects index.

`session/fork` is a protocol-v5 channel that creates an independent
session from the source session's current active transcript. When optional
`throughMessageId` is present, the copied snapshot ends at that message; an
unknown id returns `NOT_FOUND`. Electron rejects
the request with `AGENT_BUSY` while that source session has an active turn.
Electron owns localization and supplies the user-facing branch title; the host
fallback title is reserved for non-UI callers.
The host assigns a new session id, message ids, and tool-call ids; it copies
the durable project/provider/model/mode/thinking/permission configuration but
does not copy turns, notifications, artifacts, scratch data, permission
grants, or regenerate revisions. The source session remains unchanged.
Message-scoped assistant Fork/Edit uses this option so the child receives a
new session id and therefore cannot reuse or mutate the source pi runtime or
its provider cache.

Protocol version 6 adds `pi-desktop/agent/compact`, compaction lifecycle
events, the optional `SessionDetail.compaction` checkpoint, and the host
`session.appendCompaction` route. A version 5 host must fail the handshake so a
desktop cannot appear protected while silently losing checkpoints.

Protocol version 2 adds `thinkingLevel`, `UiMessage.thinking`, and
`message_update.deltaThinking`. A v1 peer must fail the version check instead
of silently discarding these fields.

`UiMessage.error` is an optional additive field. Provider failures attach the
same normalized `AppError` carried by the lifecycle `error` event to the
assistant message before `message_end`. Error messages persist with the
transcript but are excluded from restored model context.

## 8. Settings / Secrets API

### settings
Non-sensitive config that can be returned to the UI:

- provider list (without secret plaintext)
- default model
- permission policy toggles
- UI preferences, including optional `AppSettings.keybindings` overrides keyed
  by the shared shortcut action ids; values use portable `Mod+Shift+Key`
  notation and contain no platform-specific native accelerator strings
- optional `AppSettings.developerMode`; absent and `false` both keep developer
  tools disabled

### secrets
- `secrets/set(providerId, apiKey)`
- `secrets/delete(providerId)`
- `secrets/has(providerId) -> boolean`

Forbidden:
- Writing the full API key into ordinary logs
- Holding API key plaintext long-term in the renderer

## 9. Project API

- `project/open()`: system directory picker
- `project/openFolder(path)`: open a known project directory in the system file
  manager
- `project/get()`: current workspace
- `project/list()`: durable project records, including import-created entries
- `project/set(path)`: set workspace
- `project/clear()`

Returns:

```ts
type ProjectWorkspace = {
 path: string;
 name: string;
};

type ProjectRecord = {
 id: number;
 path: string;
 name: string;
 pinned: boolean;
 createdAt: number;
 lastOpenedAt: number;
};
```

## 10. Tool Permission API

When a tool requires confirmation:

1. main sends `tool_permission_request`
2. UI shows a confirmation card
3. UI calls `tool/resolvePermission`

```ts
type ToolPermissionRequest = {
 requestId: string;
 sessionId: string;
 toolCallId: string;
 toolName: string;
 argsPreview: unknown;
 risk: "low" | "medium" | "high";
 reason: string;
};

type ToolPermissionResolution = {
 requestId: string;
 decision: "allow-once" | "allow-session" | "deny";
};
```

## 11. Version Compatibility

- IPC/host contract version field: `protocolVersion: 6`
- Breaking changes must bump the version and record an ADR
- renderer and main validate the version at startup; on mismatch, prompt to upgrade/reinstall
- Protocol v4 adds notification records, channels, and the
  notification-bearing `session.endTurn` result. A v3 peer is rejected rather
  than silently losing durable completion/failure events.
- The optional viewing-session invoke and `createNotification` end-turn field
  are additive v4 behavior. Older callers omit the field and retain the
  fail-safe default of creating notifications.
- Protocol v5 adds the required `session/fork` snapshot operation. A v4 peer is
  rejected before chat becomes interactive instead of exposing a branch
  command that can only fail at invocation time (ADR 0023).
- Protocol v6 adds durable context checkpoints plus the manual/lifecycle
  channels. A v5 peer is rejected because silently omitting a checkpoint can
  make the next provider request unsafe (ADR 0030).

## 12. Plugin API (host UI side)

Minimal interface:

- `plugin/list`
- `plugin/loadDev(path)`
- `plugin/installFromPath(path)`
- `plugin/enable(id)`
- `plugin/disable(id)`
- `plugin/uninstall(id)`
- `plugin/getPermissions(id)`
- `plugin/setPermission(id, permission, allowed)` (optional fine-grained)

Returned summary:

```ts
type PluginSummary = {
 id: string
 name: string
 version: string
 enabled: boolean
 source: "installed" | "dev"
 status: "ready" | "error" | "disabled"
 errorMessage?: string
 permissions: string[]
}
```

## 13. Command Palette API

- `commandPalette/search(query)`
- `commandPalette/execute(commandId)`

Command sources:
- Built-in commands
- Plugin contributes.commands

## 13a. Work Panel APIs

Work panel channels are Electron-main implementations. User-driven workspace
operations resolve the visible root from `workspace.get` and fail closed
without one. Agent-driven BrowserPreview routing resolves the originating
conversation through `session.get`, so a background preview never inherits the
visible session's workspace.

### workspace

- `workspace/diff()` → `WorkspaceDiff { repo, clean, files: DiffFile[], truncated? }`.
  Working tree vs `HEAD` (empty tree before the first commit) plus untracked
  files, collected via the git CLI with rename detection. Caps: 100 files,
  200KB per patch (`tooLarge`), binary detection; capped entries keep their
  path row but omit hunks (D098).

### terminal (D099)

- `terminal/create({cwd, cols?, rows?})` → `{termId, replay}` — one PTY per
  workspace path, reused while alive; `replay` restores recent scrollback.
- `terminal/write({termId, data})`, `terminal/resize({termId, cols, rows})`,
  `terminal/dispose({termId})`
- events: `terminal/event/data {termId, data}`, `terminal/event/exit {termId, exitCode}`

### browser (D100)

- `browser/navigate({url, sessionId?})` (scheme-normalized; http/https work
  without a workspace, while a local path requires the supplied session's
  durable project root or the visible workspace for legacy calls),
  `browser/action({action: back|forward|reload|stop})`,
  `browser/setBounds({x,y,width,height})` (renderer-measured content rect),
  `browser/setVisible({visible})`, `browser/openExternal()`,
  `browser/getState()`
- event: `browser/event/state {url, title, isLoading, canGoBack, canGoForward}`
- agent preview event: `browser/event/preview {sessionId, path}`. Electron Main
  validates `path` inside that session's project before emitting; the renderer
  records it in the matching runtime panel context and navigates only when that
  conversation is visible.

### fs (read-only)

- `fs/list({path})` → entries sorted dirs-first; ignores `.git`,
  `node_modules`, and the default ignore subset of
  [15-workspace-ignore-rules](15-workspace-ignore-rules.md)
- `fs/read({path})` → text (≤512KB) / image data URL (≤5MB) / binary / tooLarge
- `fs/reveal({path})` → reveal in Finder
- Every path resolves inside the workspace root; traversal outside is
  rejected (`INVALID_ARGUMENT`).

## 13b. Desktop Menu and Window APIs

The preload exposes a synchronous, read-only `platform: NodeJS.Platform`
value so the renderer chooses native macOS chrome or menu-free Windows/Linux
frameless chrome before first paint.

Main-to-renderer application commands use one allowlisted event:

```ts
type AppMenuCommand =
  | "newTask" | "openProject" | "openSettings"
  | "openCommandPalette" | "toggleSidebar"
  | "openHelp" | "openLogs" | "checkForUpdates";

event: menu/event/command { command: AppMenuCommand }

menu/rendererReady() -> { ready: true }
```

The renderer subscribes to `menu/event/command` before invoking
`menu/rendererReady`. Main waits for that acknowledgement when a native menu
command creates or reloads a window, so startup timing cannot drop the first
command.

Renderer-owned Windows/Linux keyboard shortcuts execute zoom and fullscreen
operations through `menu/nativeAction`. The retained compatibility surface
also supports editing and window operations. Its request is restricted to the
exported `NATIVE_MENU_ACTIONS` tuple; unknown values fail rather than becoming
a generic main-process command surface:

```ts
type NativeMenuAction =
  | "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"
  | "reload" | "zoomIn" | "zoomOut" | "resetZoom"
  | "toggleFullScreen" | "minimize" | "toggleMaximize" | "close";

menu/nativeAction({ action: NativeMenuAction })
  -> { maximized: boolean; fullScreen: boolean }
```

Developer tools use a dedicated Main-owned gate rather than a generic native
menu action:

```ts
devtools/toggle({ open?: boolean }) -> { open: boolean }
```

Main rejects the request while `AppSettings.developerMode` is not `true` or no
live window exists. The same stored flag gates F12 on all platforms,
Ctrl+Shift+I on Windows/Linux, and the macOS View-menu role. Disabling the flag
closes an already-open developer-tools window.

`window/control` accepts the exported `WINDOW_CONTROL_ACTIONS` tuple:

```ts
type WindowControlAction =
  | "getState" | "minimize" | "toggleMaximize" | "close";

window/control({ action: WindowControlAction })
  -> { maximized: boolean }
```

Maximize/unmaximize changes also emit
`window/event/maximized`. Unknown actions fail. These Electron-only channels
do not cross into host-core and do not change the host RPC protocol version.
The preload intentionally exposes no arbitrary BrowserWindow resize channel.
The one geometry-specific capability is a target-state work-panel reservation
(D163, ADR 0032):

```ts
window/setWorkPanelReservation({ width: 0 | number })
  -> { requested: number; reserved: number }
```

`width` must be a finite integer JSON number equal to `0` or inside the
inclusive `244..720` range. Strings, booleans, null, fractional values, and
other malformed payloads fail with `INVALID_ARGUMENT` rather than being
coerced. Zero is the closed/collapsed target, and a positive value is the
visible panel's committed fixed width. `requested` is the accepted current target.
`reserved` is the native width currently added
to the normal base window for that target and can be smaller than `requested`
only when the display work area is insufficient. Calls are idempotent target
updates: repeating the same width never adds another delta.

In normal state, Main expands the base bounds toward the right and shifts left
only as needed to keep the expanded bounds inside the current display work
area. A zero target symmetrically removes the added width and reverses that
reservation-induced shift. Main persists base bounds with both effects removed.
Native edge gestures update only those base bounds, leaving `requested` and the
renderer-owned fixed panel width unchanged. Maximized and fullscreen windows
remember the latest target but defer geometry; returning to normal reconciles
it once against the restored base bounds and current work area. If the window
manager first compresses or relocates the outer window during a display or
work-area transition, reconciliation preserves the last confirmed base bounds;
returning to a roomier work area restores the original chat width. Renderer code
sets this target only for the currently visible session: background artifacts
cannot change visible reservation geometry.

## 13c. Composer input APIs (D123/D124, ADR 0024)

Electron-only channels backing the composer autocomplete. Both are
read-only, fail soft, and do not touch host-core or the host RPC protocol
version.

### composer/commands

```ts
composer/commands() -> { commands: ComposerCommand[] }

type ComposerCommand = {
  /** Slash name typed after "/", unique across the merged list. */
  name: string;
  kind: "template" | "builtin" | "plugin";
  title: string;            // display title (templates: name)
  description?: string;     // template frontmatter / palette title
  argumentHint?: string;    // template frontmatter `argument-hint`
  source?: "project" | "user"; // template provenance
  id?: string;              // builtin/plugin palette id for execution
};
```

Templates load from `<workspace>/.pi/prompts/*.md` and
`~/.pi/agent/prompts/*.md` (project wins name conflicts; short TTL cache).
Without a workspace only user-global templates, builtins, and plugin
commands return.

### fs/index

```ts
fs/index() -> { entries: FsIndexEntry[]; truncated: boolean }

type FsIndexEntry = { path: string; kind: "file" | "dir" };
```

Workspace-rooted relative paths for the `@` menu: `git ls-files -co
--exclude-standard` fast path, ignore-set recursive walk fallback,
directories derived from file paths, 8000-entry cap with `truncated: true`,
short TTL cache per root. Fails closed to an empty list without a
workspace. Fuzzy filtering happens renderer-side.

## 14. Error Codes — Initial registry (extensible)

| code | Meaning |
|---|---|
| `AGENT_BUSY` | The current session already has a running turn |
| `AGENT_NOT_FOUND` | Session does not exist |
| `MODEL_NOT_CONFIGURED` | No available model |
| `PROVIDER_SECRET_MISSING` | Missing API key |
| `TOOL_DENIED` | Permission denied |
| `TOOL_TIMEOUT` | Tool timed out |
| `WORKSPACE_REQUIRED` | Project directory required |
| `PATH_OUTSIDE_WORKSPACE` | Path out of bounds |
| `INTERNAL` | Uncategorized internal error |
