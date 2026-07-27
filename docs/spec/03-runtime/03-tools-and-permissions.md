# 03. Tools and Permissions

> Decisions applied: D003, D004, D005, D006, D013, D015, D093, D114, D115

## 0. Frozen policy summary

| Topic | Decision |
|---|---|
| Default mode | Agent |
| Chat tools | Read / Glob / Grep only |
| Agent tools | Read / Glob / Grep / Write / Edit / Bash |
| Permission timeout | 120s → deny |
| allow-session scope | toolName |
| Bash style (M3) | non-interactive (no PTY) |

## 1. Goal

Let the agent get things done, but stay under control by default.

## 2. MVP Built-in Tools

| Tool | Risk | Description |
|---|---|---|
| `Read` | low | Read files within the workspace |
| `Glob` | low | List files by pattern |
| `Grep` | low | Content search |
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
  goes through the full resolver, so it is not an escape vector. Chat mode
  still denies Write/Edit/Bash entirely (D004 unchanged).
- **Artifacts.** Successful scratch writes are not recorded in the
  `artifacts` table; artifact-driven file tabs represent workspace
  deliverables only, while the Files surface may still browse the active
  workspace. Tool results carry `root: "workspace" | "scratch"` to make this
  decision and the UI rendering explicit.
- **Tool coverage.** `Read`/`Write`/`Edit` are dual-root. `Glob`/`Grep`
  remain workspace-only (the model lists scratch via `ls $PI_SCRATCH_DIR`).
  `BrowserPreview` remains workspace-relative in v1.
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

MVP baseline:

- A project-bound session workspace is required
- Default cwd = the originating session's `workspaceRoot`
- Confirmation required by default
- Set a timeout (e.g. 60s, configurable)
- Capture stdout/stderr
- Truncate large output
- No interactive TTY (MVP)

Shell resolution (D084 — bash on every platform, resolved once per process):

1. `PI_DESKTOP_BASH` env override (path to a bash executable)
2. Unix: well-known locations (`/bin/bash`, `/usr/bin/bash`, `/usr/local/bin/bash`, Homebrew), then PATH
3. Windows: `bash.exe` from Git for Windows — derived from the `git` on PATH, then standard install dirs, then PATH excluding the WSL launcher in `System32`

- Unix invokes `bash -lc` (login shell keeps profile PATH for Finder/Dock launches); Windows invokes `bash -c` with `CREATE_NO_WINDOW`
- No bash bundled in the installer: Git for Windows is the Windows prerequisite (the app requires git anyway)
- Resolution failure returns stable `SHELL_NOT_FOUND` with install guidance

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
- **Chat mode's hard deny wins over every permission mode** — `auto` cannot
  re-enable Write/Edit/Bash in chat (D004 unchanged).
- Low-risk tools (`Read`/`Glob`/`Grep`) auto-allow in every mode, as before.
- `allow-session` grants continue to work under `ask` and stay scoped to the
  session; under `accept-edits`/`auto` they are simply never needed.
- Scratch-directory writes (D114) stay prompt-free in every mode.
- UI: Settings → segmented global default; composer shows a per-session chip
  (agent mode only) whose menu offers the three effective modes without a
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

## 10. Mode matrix (Chat vs Agent)

| Mode | Read/Glob/Grep | Write/Edit | Bash |
|---|---|---|---|
| Chat | allow | deny | deny |
| Agent | allow | confirm | confirm |

### Notes
- Chat mode hard-denies high-risk tools before permission UI
- Agent mode uses permission cards for Write/Edit/Bash
- allow-session is remembered per toolName for the active session only
- Session grants follow `sessionId` across project-tab switches and are never
  inherited by another session or Temporary conversation

## 11. Plugin Tools

Plugins can contribute tools via `agentTools`:

1. manifest declaration
2. user grants `agent.tool.register`
3. PluginManager registers them into the ToolHost
4. execution goes through the unified permission/audit/timeout wrapper

Naming:
- Internal full name: `plugin.<pluginId>.<toolName>`
- Name exposed to the model: forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015) to avoid conflicts

## 12. Future Extensions

- MCP tools
- tool group toggles
- command allowlist / denylist
- dry-run mode
- apply patches after preview
