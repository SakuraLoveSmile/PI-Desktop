# 03. Plugin API

## 1. Design principles

1. Small and stable
2. Permission-driven
3. Async-first
4. Auditable
5. Do not expose host internal objects

## 2. Runtime-injected object

Inside the plugin runtime, a global is available:

```ts
declare const pi: PiPluginHostApi;
```

## 3. API overview (MVP)

### app
```ts
pi.app.getVersion(): Promise<string>
pi.app.getLocale(): Promise<string>
```

### plugin
```ts
pi.plugin.getId(): string
pi.plugin.getManifest(): PluginManifestV1
pi.plugin.getSettings<T=Record<string, unknown>>(): Promise<T>
pi.plugin.setSettings(partial: Record<string, unknown>): Promise<void>
pi.plugin.getDataPath(): Promise<string> // plugin-private directory
```

The installed Plugins page renders every `contributes.settings` field and
persists edits in the plugin's private settings file. Supported generated
controls are `string`, `number`, `boolean`, `select`, `json`, and `shortcut`.
Shortcut settings are plugin-local: they invoke the declared `command` only
while the PI-Desktop app window is focused and while the plugin's activation
scope matches the current project. They are never registered as OS-global
shortcuts in this release. The host emits `plugin:settingsChanged` after a
user edit so a plugin can refresh in-memory configuration.

### commands
```ts
pi.commands.register(def: {
 id: string
 title: string
 keywords?: string[]
 run: () => Promise<void> | void
}): Promise<void>

pi.commands.unregister(id: string): Promise<void>
```

### ui
```ts
pi.ui.openPanel(options?: { title?: string }): Promise<void>
pi.ui.closePanel(): Promise<void>
pi.ui.showToast(message: string, level?: "info"|"warn"|"error"): Promise<void>
pi.ui.notify(input: { title: string; body?: string }): Promise<void>
pi.ui.getNotificationPermission(): Promise<PluginNotificationPermission>
pi.ui.requestNotificationPermission(): Promise<PluginNotificationPermission>
pi.ui.showNativeNotification(input: {
  title: string
  body?: string
}): Promise<{ shown: boolean; permission: PluginNotificationPermission }>

type PluginNotificationPermission = "granted" | "denied" | "unknown" | "unsupported"
```

`ui.notify` remains an in-app Toast. Native delivery is opt-in through
`ui.showNativeNotification` and is guarded by the same manifest `notify`
permission. `requestNotificationPermission` performs the platform-native
permission probe by showing a short confirmation notification; Electron does
not expose a cross-platform read-only notification permission API, so
`unknown` is returned before the first probe and when the operating system does
not report a result. Native delivery is best-effort: an OS policy may suppress
the banner without changing the durable task notification inbox.

### workspace / fs
```ts
pi.workspace.get(): Promise<{ path: string; name: string } | null>

pi.fs.readText(pathFromWorkspaceRoot: string): Promise<string>
pi.fs.writeText(pathFromWorkspaceRoot: string, content: string): Promise<void>
pi.fs.glob(pattern: string): Promise<string[]>
```

### agent
```ts
pi.agent.registerTool(tool: {
 name: string
 description: string
 risk: "low"|"medium"|"high"
 schema: unknown
 execute: (args: unknown, ctx: ToolExecContext) => Promise<unknown>
}): Promise<void>

pi.agent.unregisterTool(name: string): Promise<void>
```

Registered plugin agent tools are Agent-only contributions. During Plan the
host filters them out of the model tool list and rejects direct execution with
`PLUGIN_DISABLED_IN_PLAN`, including when the manifest risk is `low`, the user
has an `allow-session` grant, or the session permission mode is `auto`. A
successful plan approval makes the same registered tools eligible again under
the selected Agent permission policy.

```ts
type ToolExecContext = {
 sessionId: string
 turnId?: string
 signal?: AbortSignal
 log: (msg: string) => void
}
```

### clipboard / shell
```ts
pi.clipboard.readText(): Promise<string>
pi.clipboard.writeText(text: string): Promise<void>
pi.shell.openExternal(url: string): Promise<void>
```

### services (requires `background.service`)
```ts
pi.services.register(service: {
 id: string // must match a contributes.services[].id
 start: (ctx: { log: (msg: string) => void }) => Promise<void> | void
 stop?: () => Promise<void> | void
}): void

pi.services.unregister(id: string): Promise<void>
```

Registration is local bookkeeping: it records the handlers so the broker can
call them. The host calls `start` after `onLoad` and `stop` before unload, and
restarts a crashed plugin per [05-plugin-lifecycle.md](05-plugin-lifecycle.md).
`start` is idempotent within one process — a second start on an already-running
service is a no-op.

### bus (requires `bus.publish` / `bus.subscribe`)
```ts
pi.bus.publish(topic: string, payload?: unknown): Promise<void>
pi.bus.subscribe(
 pattern: string,
 handler: (message: PluginBusMessage) => void,
): Promise<() => Promise<void>> // resolves to unsubscribe
```

```ts
type PluginBusMessage = {
 topic: string
 from: string // publisher plugin id
 payload?: unknown
 at: string // ISO timestamp assigned by the host
}
```

`topic` must appear in `contributes.bus.publish`; `pattern` must appear in
`contributes.bus.subscribe`. A publisher is excluded from its own fan-out. Caps
and the threat model are in [04-plugin-security.md](04-plugin-security.md) §5.1.

### net
```ts
pi.net.fetch(input: {
 url: string
 method?: string
 headers?: Record<string, string>
 body?: string
 timeoutMs?: number
}): Promise<{ status: number; headers: Record<string, string>; bodyText: string }>
```

## 4. Error model

```ts
type PluginApiError = {
 code:
 | "PERMISSION_DENIED"
 | "NOT_FOUND"
 | "INVALID_ARGUMENT"
 | "TIMEOUT"
 | "UNSUPPORTED"
 | "LIMIT_EXCEEDED" // a per-plugin cap is full (e.g. bus subscriptions)
 | "RATE_LIMITED" // a rolling window is exhausted (e.g. bus publishes)
 | "INTERNAL"
 message: string
}
```

All API failures throw an error carrying a `code`.

## 5. Events (host -> plugin)

```ts
pi.events.on(event, handler)
pi.events.off(event, handler)
```

The host pushes events to the plugin process as one-way frames. Delivered today:

- `bus.message` — a bus delivery, with the `PluginBusMessage` as the single
  argument. `pi.bus.subscribe` is the normal way to receive these; `events.on`
  sees the raw stream of every subscription the plugin holds.

A throwing handler is logged and does not affect other listeners or the plugin.

Planned events:
- `workspace:changed`
- `session:activated`
- `plugin:settingsChanged` is delivered after edits from the generated Plugins
  settings UI.
- `app:themeChanged`

## 6. Panel bridge API

The Panel UI does not get the full `pi` directly; instead:

```ts
window.pluginBridge.invoke(channel, payload?)
window.pluginBridge.on(event, handler)
```

The host-owned preload forwards only fixed channels to the plugin runtime:

| Channel | Required permission |
|---|---|
| `ui.showToast`, `ui.closePanel` | None beyond the loaded panel |
| `ui.notify` | `notify` |
| `ui.getNotificationPermission`, `ui.requestNotificationPermission`, `ui.showNativeNotification` | `notify` |
| `plugin.getSettings`, `workspace.get` | None |
| `fs.readText`, `fs.glob` | `fs.read.workspace` |
| `fs.writeText` | `fs.write.workspace` |
| `clipboard.readText` | `clipboard.read` |
| `clipboard.writeText` | `clipboard.write` |
| `shell.openExternal` | `shell.openExternal` |
| `net.fetch` | `net.fetch` |

`plugin.setSettings`, `fs.remove`, arbitrary Electron IPC, and general custom
panel RPC are not exposed. `onPanelInvoke(channel, payload)` is currently
reachable only for the host-supported `skill.list`, `skill.read`,
`skill.create`, `skill.update`, `skill.remove`, and `skill.setEnabled` channels;
it is not a general-purpose extension point.

## 7. Call auditing

Any of the following calls must be logged for audit:

- fs.writeText
- execute after agent.registerTool (including tools discovered from a plugin's
  MCP servers)
- net.fetch
- shell.openExternal
- clipboard.read/write (may be sampled)
- bus.publish / bus.subscribe / bus.unsubscribe (with the topic and fan-out size)
- service start / stop / restart

Log fields:
- pluginId
- api
- ts
- sessionId?
- ok / errorCode

## 8. Versioning strategy

- The API surface is managed by `apiVersion`
- MVP `apiVersion = 1`
- A deprecated API is retained for at least one major version cycle


## 9. Implementation status

The desktop plugin runtime now implements the MVP host API surface used by local and marketplace plugins:

- `app.*`, `plugin.*`, `commands.*`, `ui.*`, `workspace.*`
- `fs.readText` / `fs.writeText` / `fs.glob` (workspace-bound)
- `agent.registerTool` / `unregisterTool`
- `clipboard.*`, `shell.openExternal`, `net.fetch`
- `services.register` / `unregister`, `bus.publish` / `subscribe`, `events.on` / `off`

Native plugin notifications use the Electron main-process notification surface;
they do not create durable rows in the task notification inbox and do not
activate a session on click.

Declarative contributions have no `pi.*` counterpart on purpose: skills, themes,
and MCP servers are read from the manifest by the host, so a plugin cannot add
one at runtime.

All high-risk entry points assert declared+granted permissions and emit audit log lines.
Plugin panels no longer receive the full `pi` object; they use `window.pluginBridge.invoke`.
