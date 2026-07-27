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
```

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

### net (high risk by default, can be deferred)
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

MVP events:
- `workspace:changed`
- `session:activated`
- `plugin:settingsChanged`
- `app:themeChanged`

## 6. Panel bridge API

The Panel UI does not get the full `pi` directly; instead:

```ts
window.pluginBridge.invoke(channel, payload?)
window.pluginBridge.on(event, handler)
```

The plugin's own preload/main forwards to the plugin runtime.

## 7. Call auditing

Any of the following calls must be logged for audit:

- fs.writeText
- execute after agent.registerTool
- net.fetch
- shell.openExternal
- clipboard.read/write (may be sampled)

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

All high-risk entry points assert declared+granted permissions and emit audit log lines.
Plugin panels no longer receive the full `pi` object; they use `window.pluginBridge.invoke`.
