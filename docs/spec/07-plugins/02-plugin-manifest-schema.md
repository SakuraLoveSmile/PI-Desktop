# 02. Plugin Manifest Schema

## 1. Purpose

Freeze the plugin manifest fields to guarantee:

- The host can validate
- Developers can depend on it
- Future versions can migrate

Schema Version: `1`

## 2. Root object

```ts
type PluginManifestV1 = {
 schemaVersion: 1;
 id: string; // ^[a-z0-9]+(\.[a-z0-9_-]+)+$
 name: string;
 version: string; // semver
 description?: string;
 author?: string | { name: string; url?: string; email?: string };
 homepage?: string;
 repository?: string;
 icon?: string; // relative path
 main?: string; // plugin runtime entry
 ui?: PluginUiConfig;
 contributes?: PluginContributes;
 permissions?: PluginPermission[];
 engines?: {
 piDesktop?: string; // semver range
 };
 entrypoints?: {
 onInstall?: string;
 onLoad?: string;
 onEnable?: string;
 onDisable?: string;
 onUnload?: string;
 onUninstall?: string;
 };
 activationEvents?: string[]; // e.g. onCommand:xxx / onStartup
};
```

## 3. UI config

```ts
type PluginUiConfig = {
 panel?: string; // html entry
 width?: number;
 height?: number;
 resizable?: boolean;
 title?: string | {
   en: string;
   "zh-CN": string;
 }; // localized panel title; both locales are required for an object
};
```

## 4. contributes

```ts
type PluginContributes = {
 commands?: PluginCommandContrib[];
 agentTools?: PluginAgentToolContrib[];
 skills?: Array<string | PluginSkillContrib>; // relative paths, or metadata overrides
 settings?: PluginSettingContrib[];
 themes?: PluginThemeContrib[];
 mcpServers?: PluginMcpServerContrib[];
 services?: PluginServiceContrib[];
 bus?: PluginBusContrib;
};

type PluginCommandContrib = {
 id: string; // plugin-local or fully-qualified
 title: string;
 keywords?: string[];
 category?: string;
 icon?: string;
 requires?: PluginPermission[]; // extra per-command perms
};

type PluginAgentToolContrib = {
 name: string; // tool name exposed to agent
 description: string;
 risk: "low" | "medium" | "high";
 schema: Record<string, unknown>; // JSON schema object
 timeoutMs?: number;
 permissions?: PluginPermission[];
};

type PluginSettingContrib = {
 key: string;
 title: string;
 description?: string;
 type: "string" | "number" | "boolean" | "select" | "json" | "shortcut";
 default?: unknown;
 enum?: Array<{ label: string; value: string | number | boolean }>;
 /** Required for shortcut settings; invokes a declared plugin command. */
 command?: string;
 /** Fixed to plugin for now; global shortcut registration is not supported. */
 scope?: "plugin";
 secret?: boolean;
};

type PluginThemeContrib = {
 id: string; // ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$
 label: string;
 path: string; // relative `.css` file
 base?: "light" | "dark"; // palette the overrides layer on, default `dark`
};

type PluginSkillContrib = {
 id?: string; // defaults to the file name without its extension
 path: string; // relative path to the skill document
 name?: string; // overrides the front-matter `name`
 description?: string; // overrides the front-matter `description`
};

type PluginMcpServerContrib = {
 id: string; // ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$
 label?: string;
 transport: "stdio" | "http";
 // stdio only
 command?: string; // bare PATH name, or plugin-relative executable
 args?: string[];
 env?: Record<string, string | { setting: string }>;
 // http only
 url?: string; // https, or http when the host is loopback
 headers?: Record<string, string | { setting: string }>;
};

type PluginServiceContrib = {
 id: string; // ^[a-zA-Z][a-zA-Z0-9_-]{0,63}$
 label?: string;
 autoRestart?: boolean; // default true
};

type PluginBusContrib = {
 publish?: string[]; // concrete topics, e.g. `build.done`
 subscribe?: string[]; // patterns, e.g. `build.*` / `build.**`
};
```

## 5. permissions enum

```ts
type PluginPermission =
 | "ui.panel"
 | "ui.theme"
 | "clipboard.read"
 | "clipboard.write"
 | "notify"
 | "fs.read.workspace"
 | "fs.write.workspace"
 | "fs.delete.workspace"
 | "agent.tool.register"
 | "agent.prompt.inject"
 | "net.fetch"
 | "shell.openExternal"
 | "mcp.server.local"
 | "mcp.server.remote"
 | "background.service"
 | "bus.publish"
 | "bus.subscribe";
```

Unknown permission = validation failure.

## 5.1 Bus topic grammar

Topics are dot-separated segments matching `[a-zA-Z0-9][a-zA-Z0-9_-]*`, at most
8 segments and 128 characters. `contributes.bus.publish` lists concrete topics;
`contributes.bus.subscribe` lists patterns where `*` matches exactly one segment
and `**` matches one or more trailing segments (final segment only).

```json
{
 "bus": {
 "publish": ["build.done"],
 "subscribe": ["build.*", "deploy.**"]
 }
}
```

## 6. activationEvents (optional)

Examples:

- `onStartup`
- `onCommand:demo.hello.say`
- `onAgentMode`
- `onWorkspaceOpen`

MVP may implement only:
- `onStartup`
- `onCommand:*`

## 7. Validation rules

1. `schemaVersion` must be `1`
2. `id` / `name` / `version` are required
3. Whether a manifest that declares `ui.panel` needs the `ui.panel` permission implicitly (auto-filled) or by explicit declaration is an **open question** (tracked in [08-meta/open-questions.md](../08-meta/open-questions.md))
4. If `agentTools` are present, `agent.tool.register` must be declared
5. Path fields must not use absolute paths or `..`
6. `main` / `ui.panel` / skills paths must exist
7. tool `name` allows only `[a-zA-Z][a-zA-Z0-9_]*`
8. Contribution ids (`themes`, `mcpServers`, `services`) must match
   `[a-zA-Z][a-zA-Z0-9_-]{0,63}` and be unique within their own list
9. `themes[].path` must exist and end in `.css`; `themes[].base` may only be
   `light` or `dark`
10. `mcpServers[]` must set exactly one transport's fields: `stdio` requires
   `command` (bare PATH name or plugin-relative, never absolute) and rejects
   `url`/`headers`; `http` requires `url` (`https`, or `http` only for loopback)
   and rejects `command`/`args`/`env`
11. `bus.publish` entries must be concrete topics and `bus.subscribe` entries
   valid patterns (§5.1)
12. A contribution that needs a permission fails validation when the permission
   is missing: `themes` → `ui.theme`, stdio servers → `mcp.server.local`, remote
   servers → `mcp.server.remote`, `services` → `background.service`,
   `bus.publish` → `bus.publish`, `bus.subscribe` → `bus.subscribe`.
   `skills` is the exception — it predates the permission gate, so a manifest
   without `agent.prompt.inject` still validates and the runtime simply skips
   the skills
13. Settings keys are unique. `shortcut` settings require `command`, may only
    use the `plugin` scope, and are validated as modifier-plus-key or F-key
    bindings. Secrets are rejected until secure plugin-secret storage exists.

## 8. Example: minimal plugin

```json
{
 "schemaVersion": 1,
 "id": "demo.hello",
 "name": "Hello",
 "version": "0.1.0",
 "main": "main.js",
 "ui": {
 "panel": "renderer/index.html"
 },
 "contributes": {
 "commands": [
 {
 "id": "hello.open",
 "title": "Open Hello Panel",
 "keywords": ["hello"]
 }
 ]
 },
 "permissions": ["ui.panel"]
}
```

## 9. Example: Agent Tool plugin

```json
{
 "schemaVersion": 1,
 "id": "demo.echo-tool",
 "name": "Echo Tool",
 "version": "0.1.0",
 "main": "main.js",
 "contributes": {
 "agentTools": [
 {
 "name": "echo_text",
 "description": "Echo a text value",
 "risk": "low",
 "schema": {
 "type": "object",
 "properties": {
 "text": { "type": "string" }
 },
 "required": ["text"]
 }
 }
 ]
 },
 "permissions": ["agent.tool.register"]
}
```

## 9.1 Example: capability contributions

```json
{
 "schemaVersion": 1,
 "id": "demo.capabilities",
 "name": "Capabilities",
 "version": "0.1.0",
 "main": "main.js",
 "contributes": {
 "skills": [{ "path": "skills/release.md", "id": "release-notes" }],
 "themes": [
 { "id": "midnight", "label": "Midnight", "path": "themes/midnight.css", "base": "dark" }
 ],
 "mcpServers": [
 {
 "id": "docs",
 "transport": "stdio",
 "command": "npx",
 "args": ["-y", "@example/docs-mcp"],
 "env": { "DOCS_TOKEN": { "setting": "docsToken" } }
 },
 {
 "id": "issues",
 "transport": "http",
 "url": "https://mcp.example.com/issues",
 "headers": { "Authorization": { "setting": "issuesAuth" } }
 }
 ],
 "services": [{ "id": "watcher", "label": "Repo watcher" }],
 "bus": { "publish": ["demo.build.done"], "subscribe": ["demo.**"] }
 },
 "permissions": [
 "agent.prompt.inject",
 "ui.theme",
 "mcp.server.local",
 "mcp.server.remote",
 "background.service",
 "bus.publish",
 "bus.subscribe"
 ]
}
```

`{ "setting": "<key>" }` reads the plugin's own settings; the host environment is
never passed through (D018).

## 10. Compatibility strategy

- A future `schemaVersion: 2` needs a migrator
- The host should reject a too-high major version
- Unknown optional fields may be ignored; unknown required permissions must fail
