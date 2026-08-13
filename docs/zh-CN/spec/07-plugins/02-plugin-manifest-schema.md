# 02. 插件Manifest Schema

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/02-plugin-manifest-schema) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 目的

冻结插件清单字段以保证：

- 主机可以验证
- 开发人员可以依赖它
- 未来版本可以迁移

架构版本：`1`

## 2. 根对象

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

## 3. 用户界面配置

```ts
type PluginUiConfig = {
 panel?: string; // html entry
 width?: number;
 height?: number;
 resizable?: boolean;
 title?: string;
};
```

## 4. 贡献

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
 command?: string; // shortcut 设置调用这个已声明的插件命令
 scope?: "plugin"; // 暂不支持全局插件快捷键
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

## 5. 权限枚举

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

未知权限=验证失败。

## 5. 1 总线主题语法

主题最多是与 `[a-zA-Z0-9][a-zA-Z0-9_-]*` 匹配的点分隔段
8段128个字符。 `contributes.bus.publish` 列出了具体主题；
`contributes.bus.subscribe` 列出 `*` 与一个段完全匹配的模式
`**` 匹配一个或多个尾随段（仅最后一个段）。

```json
{
 "bus": {
 "publish": ["build.done"],
 "subscribe": ["build.*", "deploy.**"]
 }
}
```

## 6. activationEvents（可选）

示例：

- `onStartup`
- `onCommand:demo.hello.say`
- `onAgentMode`
- `onWorkspaceOpen`

MVP 只能实现：
- `onStartup`
- `onCommand:*`

## 7. 验证规则

1. `schemaVersion` 必须是 `1`
2. 需要 `id` / `name` / `version`
3. 声明 `ui.panel` 的清单是否需要隐式（自动填充）或通过显式声明获得 `ui.panel` 权限是一个 **悬而未决的问题**（在 [08-meta/open-questions.md](/zh-CN/spec/08-meta/open-questions) 中跟踪）
4. 如果存在 `agentTools`，则必须声明 `agent.tool.register`
5. 路径字段不得使用绝对路径或 `..`
6. `main` / `ui.panel` / 技能路径必须存在
7.工具`name`仅允许`[a-zA-Z][a-zA-Z0-9_]*`
8. 贡献 ID（`themes`、`mcpServers`、`services`）必须匹配
   `[a-zA-Z][a-zA-Z0-9_-]{0,63}` 并在自己的列表中保持唯一
9. `themes[].path` 必须存在且以 `.css` 结尾； `themes[].base` 可能只是
   `light` 或 `dark`
10. `mcpServers[]` 必须准确设置一个传输字段：`stdio` 要求
   `command`（裸路径名称或插件相对，从不绝对）并拒绝
   `onStartup`/`onCommand:*`； `http` 需要 `url`（`https` 或 `http` 仅用于环回）
   并拒绝 `onStartup`/`onCommand:*`/`schemaVersion`
11. `bus.publish` 条目必须是具体主题，`bus.subscribe` 条目必须是具体主题
   有效模式（§5.1）
12. 需要权限的贡献在权限验证时失败
   缺少：`themes` → `ui.theme`，stdio 服务器 → `mcp.server.local`，远程
   服务器 → `mcp.server.remote`、`services` → `background.service`、
   `bus.publish` → `bus.publish`，`bus.subscribe` → `bus.subscribe`。
`skills` 是一个例外 - 它早于权限门，因此清单
   没有 `agent.prompt.inject` 仍然有效并且运行时只是跳过
   技能

## 8. 示例：最小插件

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

## 9. 示例：Agent 工具插件

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

## 9. 1 示例：能力贡献

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

`{ "setting": "<key>" }`读取插件自身的设置；宿主环境是
从未通过（D018）。

## 10. 兼容性策略

- 未来的 `schemaVersion: 2` 需要迁移器
- 主机应拒绝过高的主要版本
- 未知的可选字段可能会被忽略；未知所需的权限必须失败
