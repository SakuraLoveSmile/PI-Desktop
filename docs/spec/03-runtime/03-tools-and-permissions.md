# 03. Tools and Permissions

> Decisions applied: D003, D005, D006, D015, D093, D114, D115, D170, D171

## 0. Frozen policy summary

| Topic | Decision |
|---|---|
| Default mode | Agent |
| Agent tools | Read / Glob / Grep / Write / Edit / Bash |
| Plan tools | Read / Glob / Grep / BrowserPreview / Bash / CompactContext / SubmitPlan |
| Plan hard deny | Write / Edit / all plugin tools / unknown tools |
| Permission timeout | 120s → deny |
| allow-session scope | toolName |
| Bash style | non-interactive; selected host catalog shell with streamed output |

## 1. Goal

Let the agent get things done, but stay under control by default.

## 2. MVP Built-in Tools

| Tool | Risk | Description |
|---|---|---|
| `Read` | low | Read files within the workspace |
| `Glob` | low | List files by pattern |
| `Grep` | low | Content search |
| `BrowserPreview` | low | Open a workspace-relative preview in the user-driven Browser panel |
| `CompactContext` | low | Create a model-context checkpoint without workspace mutation |
| `EnterPlanMode` | low | Move the same Agent from Agent to Plan after host validation |
| `SubmitPlan` | low | Preserve exact Markdown bytes in a new `.pi/plan/*.md` artifact and request approval |
| `Write` | high | Create/overwrite files |
| `Edit` | high | Modify files |
| `Bash` | high | Execute commands |

> Names may be fine-tuned during implementation, but semantics stay consistent.

## 3. Common Tool Constraints

Every tool must have:

1. JSON schema / typebox parameter definition
2. timeout
3. workspace path validation
4. output truncation policy
5. trace id
6. structured results

## 4. Path Rules

- For a durable `sessionId`, `workspaceRoot` is resolved from that session's
  persisted project binding. It is not read from the mutable active sidebar
  tab at execution time.
- All file paths are relative to the resolved `workspaceRoot` by default
- After normalization they must still reside within the workspace
- `..` escapes are forbidden
- Symlinks that escape the workspace are rejected
- Exception (D114): absolute paths inside the session scratch directory are a
  second legal root for `Read`/`Write`/`Edit` — see §4b. Both roots run the
  same lexical + symlink containment defense; everything else remains
  `PATH_OUTSIDE_WORKSPACE`.

## 4b. Session scratch directory (D114)

Temporary/intermediate files an agent produces (one-off scripts, downloaded
data, drafts) must not dirty the user's project or its git status. Each
session gets a scratch directory outside the workspace:

```text
<data_dir>/scratch/<sessionId>/
```

- **Addressing.** The model addresses scratch by absolute path only; the path
  is advertised in the system prompt. Relative tool paths always resolve
  against the workspace. `Bash` additionally exports `PI_SCRATCH_DIR`.
- **Containment.** `resolve_tool_path` tries the workspace root first, then
  the scratch root, applying the identical two-layer defense (lexical `..`
  normalization + canonicalized-ancestor symlink check) to each. A symlink
  planted inside scratch cannot reach the workspace or anywhere else.
- **Permissions.** `Write`/`Edit` whose `path` is lexically inside the
  session's scratch root auto-allow without a permission card — they cannot
  touch the project. The lexical check only skips the prompt; execution still
  goes through the full resolver, so it is not an escape vector. Plan does not
  expose Write/Edit, so the scratch auto-allow rule cannot make those tools
  available in Plan. A Plan Bash call may still create or mutate scratch data
  when its permission mode allows it.
- **Artifacts.** Successful scratch writes are not recorded in the
  `artifacts` table; artifact-driven file tabs represent workspace
  deliverables only, while the Files surface may still browse the active
  workspace. Tool results carry `root: "workspace" | "scratch"` to make this
  decision and the UI rendering explicit.
- **Tool coverage.** `Read`/`Write`/`Edit` are dual-root. `Glob`/`Grep`
  remain workspace-only (the model lists scratch via `ls $PI_SCRATCH_DIR`).
  `BrowserPreview` remains workspace-relative in v1. Its Main-process handler
  resolves the root from the originating durable session, and the renderer
  event carries `sessionId`; the selected foreground workspace is never used
  for a background preview.
- **Lifecycle.** Created lazily on the first `Write`/`Edit`/`Bash` of a
  session. Deleted with `session.delete`. A startup sweep removes scratch
  dirs whose session no longer exists and dirs untouched for over 7 days
  (crash/force-quit fallback; no scheduled job needed).
- A project switch does not redirect or cancel a background session's tools;
  sessions A and B remain sandboxed to projects A and B respectively.
- A Temporary/path-less session has no workspace root, even if another project
  is visible. High-risk tools are unavailable without a session project.
- Legacy calls that do not resolve to a durable session may use the selected
  host workspace only during the compatibility window.
- A session lookup/storage error fails the tool request; it must never be
  treated as a missing legacy session or redirected to the selected workspace.

## 5. Bash Rules

Host execution baseline:

- A project-bound session workspace is required
- Default cwd = the originating session's `workspaceRoot`
- Confirmation required by default
- Set a mandatory 60s timeout; accept only a bounded 1s–300s override
- Stream stdout and stderr separately, then return bounded final output
- Truncate large output without mixing the two streams
- No interactive TTY (MVP)

Shell catalog (D171) exposes the stable IDs `windows-powershell`, `cmd`,
`git-bash`, and `bash` where supported by the platform. The host persists
`defaultCommandShell`; if that persisted choice later becomes unavailable, the
effective catalog selection intentionally falls back to the first available
platform shell. A turn pins the effective shell ID and dialect. `Bash` remains
the tool/protocol name, and the request carries the pinned shell ID separately.
Host-core resolves the entry again before spawn and rejects a changed ID/dialect
with `COMMAND_SHELL_CHANGED`; settings writes reject unavailable or
wrong-platform IDs with `COMMAND_SHELL_INVALID`. No arbitrary executable path
or executable path hash is accepted as shell identity.

- Windows PowerShell and cmd use their native non-interactive invocation.
- Git Bash uses the discovered Git for Windows executable.
- Unix Bash uses an approved system Bash entry.
- User abort and timeout terminate the complete process tree before returning.

Initial denylist (extensible):

- Directly reading/writing sensitive paths outside the workspace
- Destructive operations without confirmation (policy governed by the permission layer)

## 6. Permission Model

### Risk Levels

| risk | Example | Default policy |
|---|---|---|
| low | Read/Glob/Grep | Auto-allow |
| medium | low-risk network/metadata | Confirm or allow by policy |
| high | Write/Edit/Bash | Confirm by default |

### Decision Types

- `allow-once`
- `allow-session`
- `deny`

May be added later:
- `allow-always-for-tool`
- `allow-always-for-command-pattern`

### Permission Modes (D115/D132)

How high-risk tool calls get approved is governed by a **permission mode**:

| Mode | Write/Edit | Bash / plugin tools |
|---|---|---|
| `ask` (default) | confirm | confirm |
| `accept-edits` | auto-allow | confirm |
| `auto` | auto-allow | auto-allow |

Resolution order per tool call (host-core `tools.execute`):

1. Session's persisted `permission_mode`, unless it is `inherit`
2. Global `defaultPermissionMode` from app settings (`ask` / `accept-edits` / `auto`)
3. `ask`

Rules:

- The session value is stored in `sessions.permission_mode`
  (`inherit | ask | accept-edits | auto`, default `inherit`, schema v5) and
  set via `session.configure` `permissionMode`.
- Plan's hard deny wins over every permission mode for Write/Edit and plugin
  tools. `auto` cannot re-enable a hidden or denied tool.
- Low-risk tools (`Read`/`Glob`/`Grep`) auto-allow in every mode, as before.
- `BrowserPreview` is an explicit read-only UI inspection capability and is
  available in both operating modes.
- Plan retains the permission-mode selector. Bash is confirmed under `ask` and
  `accept-edits`, and is auto-allowed under `auto`; therefore Plan is planning
  intent, not a strict read-only security profile.
- `allow-session` grants continue to work under `ask` and stay scoped to the
  session; under `accept-edits`/`auto` they are simply never needed.
- Scratch-directory writes (D114) stay prompt-free in every mode.
- UI: Settings → segmented global default; composer shows a per-session chip in
  both Agent and Plan whose menu offers the three effective modes without a
  separate global-default/inherit entry. The chip and selected menu item
  display the effective mode; choosing an item stores that explicit session
  override. Existing inherited sessions continue to resolve through the
  global setting until the user chooses a mode.
- Enforcement lives in host-core only; the sidecar/model is never told the
  mode and cannot influence it.

## 7. Permission Flow

```text
tool call
 → policy.evaluate()
 → allow? execute
 → need confirm? push to UI
 → deny? return tool error result
```

Permission confirmation timeout:
- After 120s, auto-deny (D005: fail closed, do not hang forever)

## 8. Tool Result Visibility to the Model

- Success result: given to the model
- Failure result: given to the model (with error info)
- User denial: give the model an explicit "user denied permission"
- Sensitive info: redact before persisting/displaying

## 9. Auditing

Each tool call records:

- sessionId
- turnId
- toolCallId
- toolName
- args hash / preview
- decision
- duration
- success / error code

MVP may start by writing to SQLite or a log file.

Timing is recorded in segments, not as one duration (D137): `prompted`
(whether a permission card was shown), `permissionWaitMs`, `durationMs` (the
tool body), `overheadMs` (host bookkeeping), and `totalMs`. Denied calls carry
the same fields with a zero tool body. See
[09. Logging and Observability](09-logging-and-observability.md) for the
matching log lines.

## 10. Operating-mode matrix

| Mode | Read/Glob/Grep | BrowserPreview | Write/Edit | Bash | Plugins |
|---|---|---|---|---|---|
| Agent | allow | allow | permission policy | permission policy | registered risk policy |
| Plan | allow | allow | deny | `ask`/`accept-edits`: confirm; `auto`: allow | deny |

### Notes
- Plan hard-denies Write/Edit/plugin tools before permission UI; a direct host
  call cannot bypass the matrix.
- Agent mode uses permission cards or the selected automatic policy for
  Write/Edit/Bash and registered plugin tools.
- Plan Bash may mutate workspace or scratch state when the user selected Auto;
  the UI must make that tradeoff visible.
- allow-session is remembered per toolName for the active session only
- Session grants follow `sessionId` across project-tab switches and are never
  inherited by another session or Temporary conversation

### 10.1 Plan control and context tools

`CompactContext` is available when automatic context protection permits it and
does not mutate the workspace. `SubmitPlan` is available only in Plan and must
be the only tool call in its assistant batch. It preserves the exact Markdown
bytes in a new unique `.pi/plan/*.md` artifact
through host-core before creating one pending approval. `EnterPlanMode` is
available only in Agent and must be the only tool call in its batch. The host
validates the durable mode and active-turn/configuration boundary before either
transition; the visible tool list is guidance, not the security boundary.

## 11. Plugin Tools

Plugins can contribute tools via `agentTools` in Agent only:

1. manifest declaration
2. user grants `agent.tool.register`
3. PluginManager registers them into the ToolHost
4. execution goes through the unified permission/audit/timeout wrapper

No plugin tool is visible or executable in Plan, regardless of manifest risk,
declared permission, session grant, or `auto`. A direct attempt returns
`PLUGIN_DISABLED_IN_PLAN` and is audited as a Plan policy denial. Missing or
invalid plugin risk defaults to `medium` for Agent and never grants Plan
access.

Naming:
- Internal full name: `plugin.<pluginId>.<toolName>`
- Name exposed to the model: forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015) to avoid conflicts

## 12. Future Extensions

- MCP tools
- tool group toggles
- command allowlist / denylist
- dry-run mode
- apply patches after preview
