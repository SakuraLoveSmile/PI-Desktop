# 01. Plugin System

## 0. Frozen implementation defaults

- Plugin tool exposed names use forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015)
- enable→load failure auto-disables plugin (D017)
- uninstall deletes plugin data by default (D016)
- plugin settings secrets not allowed in MVP (D018)
- runtime target remains separate process; M4 may use host-managed sandboxed runtime (D009)
- every extension carries `enabled` plus an activation scope; both plugins and the
  user's own MCP servers and skills are global or limited to named projects (D192)
- user MCP tools use the prefix `mcp_<serverId>_<toolName>`, disjoint from D015's
  plugin namespace (D193)

Plan policy: plugin agent tools, plugin skills that register tools, and any
unknown plugin contribution are not visible or executable in Plan. This deny
is enforced by host-core before generic plugin permission evaluation and cannot
be bypassed by a low-risk manifest, a session grant, or `auto`. Plugin tools
remain available to the same Agent after an approved Plan → Agent transition.

## 1. Goals

Give PI-Desktop extensibility similar to established desktop plugin ecosystems (e.g. VS Code extensions):

- Users can install / enable / disable / uninstall plugins
- Developers can build custom plugins
- Plugins can extend commands, panels, tools, and Agent capabilities
- The platform keeps a security boundary and does not hand full system privileges directly to arbitrary third-party code

In one sentence:

> **PI-Desktop is the host; plugins are capability packs.**

## 2. Design goals

### Patterns adopted from established plugin ecosystems
- Directory-based plugin installation
- Capabilities declared in a manifest file
- Feature keyword / command triggers
- A dedicated plugin management page
- Developer mode for loading local plugins

### Differences (because we are an Agent desktop)
- Plugins are not just small utility panels; they can also extend:
 - Agent Tools
 - Skills
 - MCP bridge
 - Session commands
 - Settings
- High-risk capabilities must go through the permission framework
- Plugins cannot directly obtain arbitrary Node/Electron privileges by default

## 3. What plugins can do

### MVP-Plugin scope (first iteration of the plugin system)
1. **Command plugins**: register command palette actions
2. **Panel plugins**: open a plugin UI panel (iframe / webview sandboxed page)
3. **AgentTool plugins**: provide new tools to the agent
4. **Skill plugins**: provide loadable skill documents/flows
5. **Theme plugins**: ship a CSS file that overrides the design tokens

### Beyond the MVP scope (implemented)
6. **MCP server plugins**: declare stdio or remote HTTP MCP servers whose tools
   join the agent's tool set
7. **Background service plugins**: keep a supervised resident worker alive
8. **Inter-plugin message bus**: publish/subscribe over declared topics

### Later
- Billing / signed plugins
- Enterprise private plugin sources

**Current implementation:** the Plugins page can browse and install packages
from the official marketplace provider. Per-plugin auto-update is opt-in and
refuses silent permission expansion. This is not a capability-sandboxed runtime:
plugin main processes retain raw Node built-ins, so marketplace packages are
unrestricted user-privileged code until the planned sandbox is implemented.

## 4. Plugin shape

Each plugin is a directory:

```text
my-plugin/
├── manifest.json # required
├── package.json # optional (if it carries build artifacts / dependency metadata)
├── main.js # plugin runtime extension entry (restricted API)
├── preload.js # optional, plugin panel bridge
├── renderer/ # plugin UI (static assets)
│ ├── index.html
│ └── assets/
├── skills/ # optional
├── themes/ # optional (`.css` files declared in contributes.themes)
├── tools/ # optional (declarative tool schema)
├── icon.png
└── README.md
```

### Install location

```text
~/.pi-desktop/plugins/
 ├── installed/
 │ └── <plugin-id>/
 ├── disabled/
 └── cache/
```

Developer mode can load a local path directly, without copying it into `installed`.

## 5. manifest.json (core contract)

```json
{
 "schemaVersion": 1,
 "id": "demo.hello",
 "name": "Hello Plugin",
 "version": "0.1.0",
 "description": "Example plugin",
 "author": "you",
 "main": "main.js",
 "ui": {
 "panel": "renderer/index.html",
 "width": 480,
 "height": 360
 },
 "contributes": {
 "commands": [
 {
 "id": "hello.say",
 "title": "Hello: Say",
 "keywords": ["hello", "hi"],
 "category": "Demo"
 }
 ],
 "agentTools": [
 {
 "name": "hello_echo",
 "description": "Echo text back",
 "risk": "low",
 "schema": {
 "type": "object",
 "properties": {
 "text": { "type": "string" }
 },
 "required": ["text"]
 }
 }
 ],
 "skills": ["./skills/hello.md"],
 "settings": [
 {
 "key": "greeting",
 "type": "string",
 "default": "Hello",
 "title": "Greeting"
 }
 ]
 },
 "permissions": [
 "clipboard.read",
 "clipboard.write",
 "notify",
 "fs.read",
 "fs.delete",
 "agent.tool.register"
 ],
 "fs": {
 "read": { "scope": ["**/*"] },
 "delete": { "own": true }
 },
 "engines": {
 "piDesktop": ">=0.1.0"
 },
 "entrypoints": {
 "onLoad": "main.js#onLoad",
 "onUnload": "main.js#onUnload"
 }
}
```

### Field constraints
- `schemaVersion` is required and must be `1`; the Rust host (`crates/host-core/src/plugins.rs`) rejects manifests without it
- `id` is globally unique; reverse-domain naming is recommended
- `version` follows semver
- `permissions` must be declared explicitly
- Undeclared permissions default to none
- A manifest that fails validation is refused

## 6. Plugin runtime model

Uses **three-layer isolation**:

```text
Host Main (PI-Desktop)
 ├─ PluginManager
 ├─ PluginPermissionGateway
 ├─ Plugin Sandbox / Worker
 └─ Plugin Panel (Renderer iframe/webview)
```

### 6.1 Host Main
- Install / uninstall / enable / disable
- Validate manifest
- Authorization management
- Route command and tool calls

### 6.2 Plugin Runtime (restricted)
Plugin logic runs in a restricted environment; it is not equivalent to full Electron main privileges.

**Implemented today (ADR 0008):** each plugin's main module runs in its own
`utilityProcess` (`electron/main/plugin-host-process.mjs`) and reaches the host
only through JSON RPC to the broker in `electron/main/plugin-runtime.ts`, which
enforces the API allowlist and the permission gateway. Plugin code never gets a
host object and cannot `require` host modules.

Still open: capability sandboxing inside the plugin process (raw Node built-ins
are reachable there) and CPU/memory limits.

### 6.3 Plugin Panel UI
- Load the plugin page in a dedicated sandboxed `BrowserWindow` and isolated
  per-plugin session partition
- Reserve a host-owned 46px custom titlebar above plugin content: macOS keeps
  hidden-inset traffic lights at `{x:16,y:16}`; Windows/Linux use a frameless
  window with custom minimize, maximize/restore, and close controls
- Panel titles may be a legacy string or a localized `{ "en": string,
  "zh-CN": string }` object. The host resolves the title using the active
  PI-Desktop UI language, not the plugin window's OS/browser locale.
- The titlebar follows the loaded plugin page's computed background and text
  colors. The active PI-Desktop theme (`light` / `dark`, including a plugin
  theme's base palette) is the fallback while the page is transparent.
- Expose the titlebar height as `--pi-plugin-titlebar-height: 46px`; normal-flow
  content is offset automatically, while fixed/sticky top UI must use
  `top: var(--pi-plugin-titlebar-height, 46px)` rather than `top: 0`
- Development panels show a host-owned safe-area reminder in the titlebar;
  production panels keep the reminder hidden
- Render the host titlebar in a closed preload-owned Shadow DOM so plugin CSS
  cannot restyle its controls
- Can only call the safe APIs exposed by the plugin preload
- Cannot access the host DOM / host store by default

## 7. Host API (callable by plugins)

Namespace: `pi.plugin.*`

### Basics
- `pi.app.getVersion()`
- `pi.plugin.getManifest()`
- `pi.plugin.getSettings()`
- `pi.plugin.setSettings(partial)`
- `pi.commands.register(command)`
- `pi.ui.openPanel(options?)`
- `pi.ui.showToast(message)`
- `pi.ui.notify(title, body)`
- `pi.ui.getNotificationPermission()`
- `pi.ui.requestNotificationPermission()`
- `pi.ui.showNativeNotification({ title, body? })`

### Workspace (requires permission)
- `pi.workspace.get()`
- `pi.fs.readText(path)`
- `pi.fs.writeText(path, content)` // high risk
- `pi.fs.glob(pattern)`

### Agent (requires permission)
- `pi.agent.registerTool(tool)`
- `pi.agent.unregisterTool(name)`

Skills are contributed declaratively (`contributes.skills` + `agent.prompt.inject`),
not invoked by the plugin: the host puts the catalog in the system prompt and the
model loads a body through the built-in `Skill` tool (D174). Planned, not
currently exposed: `pi.agent.appendSystemHint(text)`.

### Background services (requires `background.service`)
- `pi.services.register({ id, start, stop? })`
- `pi.services.unregister(id)`

Registration is local bookkeeping; the broker starts a service only when the
manifest declared it and the permission was granted, and supervises restarts.

### Message bus (requires permission)
- `pi.bus.publish(topic, payload)` // `bus.publish`
- `pi.bus.subscribe(pattern, handler)` → `unsubscribe()` // `bus.subscribe`
- `pi.events.on(event, handler)` / `pi.events.off(event, handler)` // host pushes,
  including the raw `bus.message` stream

### Clipboard / system (requires permission)
- `pi.clipboard.readText()`
- `pi.clipboard.writeText(text)`
- `pi.shell.openExternal(url)` // confirmation by default
- `pi.net.fetch(input)`

`pi.ui.notify` is an in-app Toast. Native plugin notifications use the
Electron main-process notification API and share the manifest `notify`
permission. `requestNotificationPermission()` returns the best-effort native
permission state (`granted`, `denied`, `unknown`, or `unsupported`) after
performing a short native probe. These notifications are not durable task
inbox records and do not activate a session when clicked.

### Explicitly not provided directly
- Arbitrary host-internal Electron objects
- Arbitrary absolute-path access through the brokered `pi.fs` APIs

The broker does not provide Node capabilities directly. However, the current
utility-process plugin runtime is not a Node capability sandbox: plugin code can
reach raw Node built-ins independently of `pi.*`. The permission model below
therefore applies only to brokered APIs until runtime sandboxing is delivered.

## 8. Permission model

### Permission list

| permission | Risk | Description |
|---|---|---|
| `ui.panel` | low | Show panel |
| `ui.theme` | low | Contribute a theme CSS file |
| `clipboard.read` | medium | Read clipboard |
| `clipboard.write` | medium | Write clipboard |
| `notify` | low | System notification |
| `fs.read` | medium | Read the paths `manifest.fs.read` lists |
| `fs.write` | high | Write the paths `manifest.fs.write` lists |
| `fs.delete` | high | Delete the paths `manifest.fs.delete` lists, to the OS trash |
| `agent.tool.register` | high | Register agent tool |
| `agent.prompt.inject` | high | Inject prompt; activates `contributes.skills` |
| `net.fetch` | high | Network request |
| `shell.openExternal` | medium | Open external link |
| `mcp.server.local` | high | Spawn a stdio MCP server |
| `mcp.server.remote` | high | Connect a remote HTTP MCP server |
| `background.service` | medium | Keep a resident service running |
| `bus.publish` | medium | Publish to declared bus topics |
| `bus.subscribe` | medium | Subscribe to declared bus patterns |

Themes, MCP servers, services, and bus topics are declared in the manifest, so
their permission is checked at validation time as well as at runtime — see
[13-plugin-permissions-matrix.md](13-plugin-permissions-matrix.md).

The three file permissions carry a range as well as a switch: `manifest.fs` says
which paths each mode may touch, and `manifest.net.domains` does the same for
egress. A file permission with no declared scope has no standing reach — every
access asks the user. The pre-scope names (`fs.read.workspace` and friends) still
load and are downgraded to the minimum safe equivalent (ADR 0087).

### Authorization timing
1. Show the declared permission list at install or upgrade review time
2. Only granted permissions are passed to the brokered runtime; missing grants
   fail the corresponding `pi.*` call
3. Users can revoke permissions on the plugin management page; a reload is
   required for a running plugin to observe the changed grant set

Per-call confirmation and any policy for direct Node access are not implemented.

## 9. Command palette

The global command palette supports:

- Searching plugin commands
- Keyword triggers
- Recently used
- Grouping by category

Interaction flow:

```text
User opens the command palette
 → types a keyword
 → matches a plugin command
 → executes the command handler
 → opens a panel or triggers an agent/tool
```

Shortcut (recommended):
- macOS: `Command+Shift+P` or custom
- support quick launcher invocation later

## 10. AgentTool plugin mechanism

After a plugin registers a tool:

1. PluginManager validates the schema and permissions
2. ToolHost wraps the tool
3. Every call first passes through permissions and audit
4. Actual execution lands in the plugin runtime
5. The result is normalized before being returned to the agent

The wrapping layer must add:
- timeout
- argument validation
- error normalization
- audit logging
- a disable switch

## 11. Plugin lifecycle

```text
discover → validate → install → enable → load → running
 ↘ disable → unload
 ↘ uninstall → purge
```

Hooks:
- `onInstall`
- `onLoad`
- `onEnable`
- `onDisable`
- `onUnload`
- `onUninstall`

**Implemented today:** the runtime (`apps/desktop/electron/main/plugin-runtime.ts`) invokes `onLoad` (when a plugin is loaded on load/enable) and `onUnload` (in the plugin process, before it is stopped, 5s budget); unloading tears down the plugin's registered commands and tools. The other hooks are declared in the API but not yet fired.

**Planned:** once the full lifecycle lands, hooks fire in this order: install → enable → load → (running) → unload → disable → uninstall. See [05-plugin-lifecycle.md](05-plugin-lifecycle.md) for the detailed sequence.

Failure policy:
- load failure: mark error, do not affect host startup
- tool execution failure: return a tool error, do not crash the main process

## 12. Extensions UI

The app shell's dedicated **Extensions** destination owns everything a user adds
to the app. Do not duplicate any of it in Settings.

Four tabs, because the three kinds are created in completely different ways —
installed, configured, written — and one merged list would have to hide that
behind a lowest-common-denominator row:

| Tab | Contents |
|---|---|
| Installed | Plugins, grouped: needs attention, updates, active, disabled |
| MCP | The user's own MCP servers (D193) |
| Skills | The user's own skill documents (D194) |
| Marketplace | Browse and install |

Plugin features:
- Local install (choose directory / zip)
- Developer load (path)
- Activation scope (off / this project / everywhere)
- Uninstall
- View permissions
- View logs
- Open plugin directory

Status indicators:
- enabled
- disabled
- error
- dev-loaded

### 12.1 The activation-scope control

One control serves all three kinds (D192). It is a three-segment track ordered
by increasing reach — **Off → These projects → Everywhere** — so widening and
narrowing are the same gesture in opposite directions, plus a summary chip that
opens the project picker when the middle segment is active.

Rules the control encodes:
- Choosing "these projects" with nothing picked yet seeds the currently open
  project, so the common case is one click.
- Switching to "everywhere" or "off" keeps the project list, so going back
  restores it.
- A project already scoped but no longer in the recent list still appears in the
  picker, or the scope could never be undone.
- A project-scoped extension with an empty list warns instead of silently doing
  nothing.

### 12.2 MCP tab

- **Import from JSON** is the primary action: a pasted `mcpServers` block is what
  users have on hand. Bad entries are listed with a reason, not fatal (D193).
- Each row's leading glyph doubles as the connection light — idle, connecting,
  ready, failed — so "is this working" is the first thing read.
- The editor sheet has stdio and HTTP transport cards, key/value rows for env or
  headers, and a **Test connection** button that reports the tool names it found.

### 12.3 Skills tab

- Create writes `SKILL.md`; import copies an existing document in.
- The description is required and sits above the body, because it is the only
  part that enters the prompt (D174, D194).
- A live byte counter against the 128KB document cap.

## 13. Developer experience

Provide:

1. Plugin template: `npm create pi-desktop-plugin`
2. manifest schema validator
3. Developer hot reload (watch directory)
4. Example plugins:
 - Hello Panel
 - Workspace Greeter Tool
 - Clipboard Note

Local development flow:

```bash
# develop the plugin
cd plugins/hello
pnpm dev

# in PI-Desktop
Plugins → Load Development Plugin → choose directory
```

## 14. Relationship with the pi ecosystem

| Ecosystem object | Relationship |
|---|---|
| pi Skills | Can be distributed / managed by skill plugins |
| pi Extensions | Not directly equivalent; needs an adapter layer |
| MCP | A plugin declares MCP servers in `contributes.mcpServers`; their tools join the agent's tool set |
| Agent Tools | One of the most important plugin extension surfaces |

Principles:
- Do not exclude pi native capabilities
- But on the user side, call everything "plugins"

## 15. Security baseline (non-negotiable)

1. Plugins have no permissions by default
2. Plugins cannot directly access host renderer state
3. Plugins cannot read or write files outside the workspace by default
4. Plugin network capability is off by default
5. Plugin update / install requires integrity verification (signing later)
6. The host core process does not execute arbitrary Electron main code injected by a plugin

## 16. Phased rollout

### P0 (design first, can be prepared in parallel with M2/M3)
- manifest spec
- PluginManager skeleton
- local load / enable-disable
- command registration
- 1 example plugin

### P1
- plugin Panel UI
- permission-grant UX
- AgentTool registration and invocation
- plugin settings storage

### P2
- zip install
- plugin log center
- developer hot reload
- more official examples

### P3
- plugin marketplace
- signing and auto-update
- MCP plugin type
- background service plugins

## 17. MVP product strategy adjustment

The original MVP can hold off on opening a "full plugin marketplace", but should reserve:

- plugin directory
- manifest
- PluginManager interface
- at least one built-in / example plugin path

That is:

> **Have the plugin architecture first, then the plugin ecosystem.**

## 18. Acceptance (minimal usable plugin system)

1. Users can load a plugin from a local directory
2. Plugin commands appear in the command palette
3. Plugins can open their own panel page
4. Plugins can register a low-risk agent tool and invoke it successfully
5. Disabling a plugin immediately deactivates its commands and tools
6. A plugin crash does not cause the host to exit

## 19. Examples

Example plugin in the repo:

- `examples/plugins/hello`
