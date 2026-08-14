# 03. 插件 API

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/03-plugin-api) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 设计原则

1. 小巧稳定
2. 权限驱动
3. 异步优先
4. 可审计
5、不要暴露主机内部对象

## 2. 运行时注入的对象

在插件运行时内部，有一个全局可用：

```ts
declare const pi: PiPluginHostApi;
```

## 3. API 概述（MVP）

### 应用程序
```ts
pi.app.getVersion(): Promise<string>
pi.app.getLocale(): Promise<string>
```

### 插件
```ts
pi.plugin.getId(): string
pi.plugin.getManifest(): PluginManifestV1
pi.plugin.getSettings<T=Record<string, unknown>>(): Promise<T>
pi.plugin.setSettings(partial: Record<string, unknown>): Promise<void>
pi.plugin.getDataPath(): Promise<string> // plugin-private directory
```

插件页面会渲染 `contributes.settings` 中声明的字段，并将修改持久化到插件私有设置文件。
支持生成字符串、数字、布尔、枚举、JSON 和 `shortcut` 控件。快捷键仅属于插件域：只有在
PI-Desktop 窗口聚焦且插件激活范围匹配当前项目时，才会调用声明的命令；本版本不会注册操作系统
全局快捷键。用户编辑后，主机会向插件发送 `plugin:settingsChanged`，便于刷新内存中的配置。

### 命令
```ts
pi.commands.register(def: {
 id: string
 title: string
 keywords?: string[]
 run: () => Promise<void> | void
}): Promise<void>

pi.commands.unregister(id: string): Promise<void>
```

### 用户界面
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

`ui.notify` 仍然是应用内 Toast。本机交付可通过以下方式选择加入
`ui.showNativeNotification` 并由相同的清单 `notify` 保护
许可。 `requestNotificationPermission` 执行平台原生
通过显示简短的确认通知来进行权限探测； Electron 确实
不暴露跨平台只读通知权限API，所以
`unknown` 在第一次探测之前以及操作系统执行探测操作时返回
不报告结果。本机交付是尽力而为：操作系统策略可能会抑制
横幅而不更改持久任务通知收件箱。

### 工作区/fs
```ts
pi.workspace.get(): Promise<{ path: string; name: string } | null>

pi.fs.readText(pathFromRoot: string): Promise<string>
pi.fs.writeText(pathFromRoot: string, content: string): Promise<void>
pi.fs.glob(pattern: string): Promise<string[]>
pi.fs.remove(pathFromRoot: string): Promise<void>
pi.fs.requestDirectory(): Promise<{ path: string; name: string } | null>
```

路径相对于该模式的 root —— 工作区，或者当该模式声明
`root: "userSelected"` 时，用户通过 `requestDirectory()` 选中的目录。
每种模式能到哪些路径由 `manifest.fs` 决定；范围之外会问用户，
而凭证 deny-list 压过两者（参见
[04-plugin-security.md](/zh-CN/spec/07-plugins/04-plugin-security) §6）。
`remove` 不递归，并且把路径移进系统回收站。

###代理
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

注册的插件代理工具是仅代理的贡献。在 Plan 期间
主机将它们从模型工具列表中过滤出来并拒绝直接执行
`PLUGIN_DISABLED_IN_PLAN`，包括当明显风险为 `low` 时，用户
具有 `allow-session` 授予，或者会话权限模式为 `auto`。一个
成功的计划批准使相同的注册工具再次符合资格
所选的 Agent 权限策略。

```ts
type ToolExecContext = {
 sessionId: string
 turnId?: string
 signal?: AbortSignal
 log: (msg: string) => void
}
```

### 剪贴板/外壳
```ts
pi.clipboard.readText(): Promise<string>
pi.clipboard.writeText(text: string): Promise<void>
pi.shell.openExternal(url: string): Promise<void>
```

### 服务（需要 `background.service`）
```ts
pi.services.register(service: {
 id: string // must match a contributes.services[].id
 start: (ctx: { log: (msg: string) => void }) => Promise<void> | void
 stop?: () => Promise<void> | void
}): void

pi.services.unregister(id: string): Promise<void>
```

注册是本地簿记：它记录处理程序，以便经纪人可以
打电话给他们。主机在卸载前调用 `onLoad` 和 `stop` 之后调用 `start`，并且
根据 [05-plugin-lifecycle.md](/zh-CN/spec/07-plugins/05-plugin-lifecycle) 重新启动崩溃的插件。
`start` 在一个进程内是幂等的——在已经运行的进程上进行第二次启动
服务是无操作的。

### 总线（需要 `bus.publish` / `bus.subscribe`）
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

`topic` 必须出现在 `contributes.bus.publish` 中； `pattern` 必须出现在
`contributes.bus.subscribe`。发布者被排除在自己的扇出之外。帽子
威胁模型位于 [04-plugin-security.md](/zh-CN/spec/07-plugins/04-plugin-security) §5.1 中。

### 网
```ts
pi.net.fetch(input: {
 url: string
 method?: string
 headers?: Record<string, string>
 body?: string
 timeoutMs?: number
}): Promise<{ status: number; headers: Record<string, string>; bodyText: string }>
```

## 4. 错误模型

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

所有 API 失败都会引发携带 `code` 的错误。

## 5. 事件（主机 -> 插件）

```ts
pi.events.on(event, handler)
pi.events.off(event, handler)
```

主机将事件作为单向帧推送到插件进程。今天交付：

- `bus.message` — 公交车交付，以 `PluginBusMessage` 作为单一
  论点。 `pi.bus.subscribe` 是接收这些信息的正常方式； `events.on`
查看插件持有的每个订阅的原始流。

抛出的处理程序会被记录下来，并且不会影响其他侦听器或插件。

计划活动：
- `workspace:changed`
- `session:activated`
- `plugin:settingsChanged`（由插件设置页面编辑触发）
- `app:themeChanged`

## 6. 面板桥 API

面板UI不直接获取完整的`pi`；相反：

```ts
window.pluginBridge.invoke(channel, payload?)
window.pluginBridge.on(event, handler)
```

主机拥有的 preload 仅将固定通道转发到插件运行时：

| 频道 | 所需许可 |
|---|---|
| `ui.showToast`、`ui.closePanel` | 没有超出加载的面板 |
| `ui.notify` | `notify` |
| `ui.getNotificationPermission`、`ui.requestNotificationPermission`、`ui.showNativeNotification` | `notify` |
| `plugin.getSettings`、`workspace.get` | 无 |
| `fs.readText`、`fs.glob` | `fs.read` |
| `fs.writeText` | `fs.write` |
| `clipboard.readText` | `clipboard.read` |
| `clipboard.writeText` | `clipboard.write` |
| `shell.openExternal` | `shell.openExternal` |
| `net.fetch` | `net.fetch` |

`plugin.setSettings`、`fs.remove` 和任意 Electron IPC 未暴露。主机自己
没有实现的通道会被转发到插件的 `onPanelInvoke(channel, payload)`，
因此插件可以自定义面板 ↔ 主进程通道；没有导出 `onPanelInvoke` 的插件
会从自己的进程收到 `UNSUPPORTED`。主机支持的通道包括
`skill.list`、`skill.read`、`skill.create`、`skill.update`、`skill.remove`
和 `skill.setEnabled`。

## 7. 通话审计

必须记录以下任何调用以供审核：

- fs.writeText
- fs.remove、fs.requestDirectory，以及每一次被拒绝的 fs 调用（连同路径与
  `errorCode`），还有每一次同意的答复及其被问的原因（`scope` / `rate`）
- 在agent.registerTool之后执行（包括从插件发现的工具）
  MCP 服务器）
- 网络获取
- shell.openExternal
- clipboard.read/write（可能是样品）
-bus.publish/bus.subscribe/bus.unsubscribe（带有主题和扇出大小）
- 服务启动/停止/重新启动

日志字段：
- 插件ID
- API
- TS
- 会话 ID？
- 好的/错误代码

## 8. 版本控制策略

- API 表面由 `apiVersion` 管理
- MVP `apiVersion = 1`
- 已弃用的 API 至少保留一个主要版本周期


## 9. 实施情况

桌面插件运行时现在实现本地和市场插件使用的 MVP 主机 API 表面：

- `app.*`、`plugin.*`、`commands.*`、`ui.*`、`workspace.*`
- `fs.readText` / `fs.writeText` / `fs.glob` / `fs.remove` /
  `fs.requestDirectory`，范围由 `manifest.fs` 限定（ADR 0087）
- `agent.registerTool` / `unregisterTool`
- `clipboard.*`、`shell.openExternal`、`net.fetch`
- `services.register` / `unregister`、`bus.publish` / `subscribe`、`events.on` / `off`

本机插件通知使用 Electron 主进程通知界面；
他们不会在任务通知收件箱中创建持久行，并且不会
单击激活会话。

声明性贡献没有故意与 `pi.*` 对应：技能、主题、
MCP 服务器由主机从清单中读取，因此插件无法添加
一个在运行时。

所有高风险入口点都会断言声明+授予的权限并发出审核日志行。
插件面板不再接收完整的 `pi` 对象；他们使用 `window.pluginBridge.invoke`。
