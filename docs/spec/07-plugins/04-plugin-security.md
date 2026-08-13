# 04. Plugin Security

## 1. Threat model

Plugins may come from:
- The user's own development
- Shared by colleagues
- Third parties in a future marketplace

Main risks:
1. Malicious file read/write
2. Malicious command execution
3. Stealing API keys / session content
4. Hijacking agent tools
5. Phishing via the UI

## 2. Default-deny principle

- Undeclared permission = unavailable
- Disabled plugin = code not loaded
- Unconfirmed high-risk action = not executed
- Host API not on the allowlist = does not exist

## 3. Isolation strategy

### Must
1. Plugin UI is isolated from the host UI DOM
2. Plugins cannot directly require host modules
3. The secret store is not open to plugins
4. The plugin-private data directory is separate from the host core library

### Goals
1. Plugin main runs in a separate process
2. Crash isolation
3. Resource limits (later: CPU/memory/timeout)

## 3.1 Contributed theme CSS

A theme contribution (`ui.theme`) is the one case where plugin-authored content
runs inside the host renderer, so it crosses a sanitizer in the main process
before it is ever sent to the UI:

- Rejected: `@import`, any `url()` target that is not a `data:` URI, a `url(`
  the parser cannot resolve, `javascript:`, `expression(`, and markup sequences
  (`<style`, `</style`, `<!--`); an empty sheet is refused too
- Capped at 256KB per file, 8 themes per plugin
- The CSS is read from disk at load time and delivered whole over IPC; the
  renderer injects it into a single dedicated `<style>` element appended after
  the app's own stylesheets, so it can override tokens but never inject markup
- Selecting a theme is a settings value (`plugin:<pluginId>:<themeId>`); if the
  providing plugin is disabled or uninstalled the setting falls back to `system`

CSS cannot script, but it can mislead: a theme is still third-party code shaping
what the user sees, which is why it is a declared, revocable permission.

## 4. Permission-grant UX

At install/load time, show:

- Permission list
- Risk description
- Developer info
- Source path

User actions:
- Accept and enable
- Cancel

First use of a high-risk API may re-confirm.

## 5. Data isolation

Plugins can access:
- Their own settings
- Their own data path

Plugins cannot access:
- Other plugins' data
- Host secrets
- The host's full session database (unless a controlled API exists in the future)

## 5.1 Inter-plugin message bus

The bus is the only channel between two plugins, and it is deliberately narrow:

- Both sides declare their traffic in the manifest — `bus.publish` lists concrete
  topics, `bus.subscribe` lists patterns — and the broker refuses anything
  undeclared even when the permission is granted
- Routing lives entirely in the host; a subscriber never learns who else
  subscribes, and a publisher is excluded from its own fan-out
- A message carries only `topic`, `from`, `payload`, and a host-assigned `at`
- Caps: 64KB per payload, 16 subscriptions per plugin, 100 publishes per rolling
  10s window; over-cap calls fail with `LIMIT_EXCEEDED` / `RATE_LIMITED` and are
  audited alongside the topic
- A payload is data, not capability: receiving a message grants nothing the
  subscriber did not already have

Treat a topic as public within the app: any plugin that can declare a matching
pattern and hold `bus.subscribe` will see it. Do not put secrets on the bus.

## 6. Path safety

For `fs.*`:
- Workspace-relative paths only
- normalize + root boundary
- Reject absolute paths and escapes

## 7. Agent security

- Plugin tool names are namespaced to avoid collisions using the frozen forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015)
- tool execution timeout
- tools can be disabled by the user in one click
- the prompt-injection API is high-risk by default and requires an explicit permission

## 7.1 Skills and MCP tools reaching the agent

Both surfaces let a plugin change what the agent knows or can do, so both are
bounded before they reach the model:

**Skills** (`agent.prompt.inject`) — the system prompt carries only the catalog
(id, name, one-line description, capped at 240 chars); a body is read on demand
through the built-in `Skill` tool. A plugin may teach at most 32 skills, each
document at most 128KB. Without the permission the skills are simply skipped:
the manifest still validates, nothing reaches the prompt.

**MCP tools** (`mcp.server.local` / `mcp.server.remote`) — discovered tools are
registered under the same `plugin_*` namespace as hand-written plugin tools and
therefore inherit the tool timeout, the audit trail, and the per-plugin disable
switch. They are always registered at `risk: "medium"`: their schema and
description come from a third-party server, so the host cannot trust a
self-declared risk level. At most 64 tools per server and 8 servers per plugin.

Plan is an additional host policy boundary for agent tools:

- no plugin tool is visible or executable in Plan;
- the deny precedes manifest risk, declared/granted permissions, session
  grants, and the `auto` permission mode;
- a direct forged `tools.execute` call returns `PLUGIN_DISABLED_IN_PLAN` and is
  audited; it is not forwarded to the plugin runtime;
- plugin commands and panels may remain usable as explicit user UI actions,
  but they cannot become model-callable Plan tools or silently mutate Plan
  state.

## 8. Network and external links

- `net.fetch` is not granted by default
- `openExternal` should confirm
- Plugins are forbidden from silently downloading and executing binaries (not done at all in MVP)

## 8.1 MCP server egress and credentials

An MCP server is a second egress path next to `net.fetch`, so it is declarative
and reviewable rather than programmatic — a plugin cannot open a connection the
manifest did not name:

- `transport: "stdio"` spawns a local executable (`mcp.server.local`). The
  `command` must be a bare PATH name or a plugin-relative path; absolute paths
  are refused at validation time. The child gets a minimal environment — only
  the declared `env` entries plus what the host needs to run a process.
- `transport: "http"` reaches a remote endpoint (`mcp.server.remote`). The `url`
  must be `https` unless the host is loopback. Tool arguments leave the machine,
  which is why the permission copy says so plainly.
- `env` and `headers` values resolve **only** from the plugin's own settings via
  `{ "setting": "<key>" }`. The host environment is never passed through, and a
  literal secret in the manifest is a review smell, not a supported pattern
  (D018).
- Connection budget: 10s to complete `initialize`, 100s per `tools/call`, 8
  `tools/list` pages, 4MB per stdio line. Servers are connected lazily and torn
  down when the plugin unloads or is disabled.

## 9. Auditing and emergency response

Users should be able to:
- View plugin permissions
- View plugin error logs
- Disable in one click
- Uninstall in one click

The host should be able to:
- Auto-disable a plugin on anomaly
- Guarantee the main app can start

## 10. Security acceptance

1. Writing a file fails without the `fs.write.workspace` permission
2. Deleting a file fails without the `fs.delete.workspace` permission and never deletes recursively
3. After disabling a plugin, its tools are no longer visible
4. A plugin cannot read API keys
5. A plugin panel cannot call arbitrary host IPC
6. An uncaught exception from a plugin does not cause the app to exit
7. A theme CSS file with `@import` or a remote `url()` is refused, and disabling
   the providing plugin drops the app back to the `system` theme
8. Publishing to an undeclared topic fails, and a publisher never receives its
   own message
9. An MCP server declared with an absolute `command` or a plain-`http` remote
   `url` fails manifest validation
10. A low-risk or granted plugin tool still fails closed in Plan


## 11. Implementation status

Current enforcement:

1. Default-deny permission checks in `PluginRuntime`
2. Workspace path boundary checks for plugin fs APIs
3. Panel windows use sandboxed preload + isolated session partitions. Their
   custom cross-platform titlebar is preload-owned, keeps its controls in a
   closed Shadow DOM, and routes only a fixed sender-validated window-action
   tuple without adding window primitives to `window.pluginBridge`
4. Secrets / host DB remain inaccessible to plugins
5. Marketplace/package install requires explicit permission acceptance in UI
6. Auto-update refuses silent permission expansion
7. Plugin main runs in a dedicated `utilityProcess` per plugin (ADR 0008) with a
   minimal environment; all `pi.*` calls cross an allowlist + permission gateway
   in the host, and a plugin crash only tears down that plugin
8. Contributed theme CSS is sanitized in the main process before it reaches the
   renderer (§3.1)
9. Bus routing is host-owned with declared topics and hard caps (§5.1)
10. MCP servers are declared, permission-gated, and fed credentials only from
    plugin settings (§8.1)

Not enforced yet:

- Capability sandboxing inside the plugin process (Node built-ins are reachable
  there, so `fs.*` permissions gate the plugin API, not the process)
- CPU / memory limits
- Signature verification (packages are only sha256-checked)
- Declared manifest permissions are auto-granted at load time
