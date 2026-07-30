# 01. Plugin System

## 0. Frozen implementation defaults

- Plugin tool exposed names use forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015)
- enable→load failure auto-disables plugin (D017)
- uninstall deletes plugin data by default (D016)
- plugin settings secrets not allowed in MVP (D018)
- runtime target remains separate process; M4 may use host-managed sandboxed runtime (D009)

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
5. **Theme plugins (optional, lightweight)**: theme token overrides

### Later
- MCP Server packaging and distribution
- Background resident service plugins
- Marketplace install / auto-update
- Inter-plugin message bus
- Billing / signed plugins

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
 "fs.read.workspace",
 "agent.tool.register"
 ],
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
- Load the plugin page with an `iframe` or `webview`
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

### Workspace (requires permission)
- `pi.workspace.get()`
- `pi.fs.readText(path)`
- `pi.fs.writeText(path, content)` // high risk
- `pi.fs.glob(pattern)`

### Agent (requires permission)
- `pi.agent.registerTool(tool)`
- `pi.agent.unregisterTool(name)`
- `pi.agent.invokeSkill(id)`
- `pi.agent.appendSystemHint(text)` (controlled)

### Clipboard / system (requires permission)
- `pi.clipboard.readText()`
- `pi.clipboard.writeText(text)`
- `pi.shell.openExternal(url)` // confirmation by default

### Explicitly not provided directly
- Arbitrary `child_process`
- Arbitrary absolute-path fs
- Arbitrary Electron native modules
- Arbitrary dynamic require of host internal objects

## 8. Permission model

### Permission list (draft)

| permission | Risk | Description |
|---|---|---|
| `ui.panel` | low | Show panel |
| `clipboard.read` | medium | Read clipboard |
| `clipboard.write` | medium | Write clipboard |
| `notify` | low | System notification |
| `fs.read.workspace` | medium | Read workspace |
| `fs.write.workspace` | high | Write workspace |
| `agent.tool.register` | high | Register agent tool |
| `agent.prompt.inject` | high | Inject prompt |
| `net.fetch` | high | Network request |
| `shell.openExternal` | medium | Open external link |

### Authorization timing
1. Show the permission list at install time
2. First use of a high-risk API may require a second confirmation
3. Users can revoke permissions on the plugin management page (after revocation, the corresponding capability must be disabled)

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

## 12. Plugin management UI

Use the app shell's dedicated **Plugins** destination for plugin management.
Do not duplicate plugin management in Settings.

Features:
- Local install (choose directory / zip)
- Developer load (path)
- Enable / disable
- Uninstall
- View permissions
- View logs
- Open plugin directory

Status indicators:
- enabled
- disabled
- error
- dev-loaded

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
| MCP | Can later become a special plugin type `type: mcp` |
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
