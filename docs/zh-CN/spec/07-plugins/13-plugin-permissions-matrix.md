# 13. 插件权限矩阵

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/13-plugin-permissions-matrix) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。


## 1. 目标

提供权限-能力-风险-默认策略参考表，供 UI 复制和验证重用。

## 2. 矩阵

| 许可 | 风险 | 允许的 API/功能 | 默认政策 | 注释 |
|---|---|---|---|---|
| `ui.panel` | 低 | 打开插件面板 | 安装时授予 | 几乎所有 UI 插件都需要 |
| `ui.theme` | 低 | `contributes.themes` CSS 已在“设置”中加载并提供 | 安装时授予 | CSS 由主机清理；它无法编写脚本 |
| `clipboard.read` | 中等 | `clipboard.readText` | 首次使用时确认 | 可能会读取敏感信息 |
| `clipboard.write` | 中等 | `clipboard.writeText` | 首次使用时确认 | 防止剪贴板污染 |
| `notify` | 低 | `ui.notify`、`ui.getNotificationPermission`、`ui.requestNotificationPermission`、`ui.showNativeNotification` | 可以默认授予 | 本机交付由操作系统控制；避免通知垃圾邮件滥用 |
| `fs.read.workspace` | 中等 | `fs.readText` / `fs.glob` | 首次使用时确认 | 仅工作区 |
| `fs.write.workspace` | 高 | `fs.writeText` | 每次或每次会话确认 | 高风险 |
| `fs.delete.workspace` | 高 | `fs.remove` | 每次或每次会话确认 | 非递归；工作区根目录受到保护 |
| `agent.tool.register` | 高 | 注册代理工具 | 安装时确认 | 工具执行情况单独审核 |
| `agent.prompt.inject` | 高 | 注入系统提示符；激活 `contributes.skills` | 默认拒绝/强确认 | 容易导致行为劫持 |
| `net.fetch` | 高 | `net.fetch` | 默认拒绝 | 必须显示目标域策略（稍后） |
| `shell.openExternal` | 中等 | 打开外部链接 | 首次使用时确认 | 防止网络钓鱼链接 |
| `mcp.server.local` | 高 | 生成清单中声明的 `transport: "stdio"` MCP 服务器 | 默认拒绝 | 运行本地可执行文件；其工具到达代理 |
| `mcp.server.remote` | 高 | 连接 `transport: "http"` MCP 服务器 | 默认拒绝 | 将工具参数发送到第三方端点 |
| `background.service` | 中等 | 启动 `contributes.services` 并保持插件进程常驻 | 安装时确认 | 受后退监督；在插件页面上可见 |
| `bus.publish` | 中等 | `bus.publish` 声明的主题 | 安装时确认 | 其他插件可以对消息进行操作 |
| `bus.subscribe` | 中等 | `bus.subscribe` 到声明的模式 | 安装时确认 | 可以观察另一个插件的消息 |

## 3. 权限依赖

- 加载面板条目需要 `ui.panel`
- 需要`agent.tool.register`来贡献agent工具
- 当 `fs.write.workspace` 存在时，建议同时声明 `fs.read.workspace`
- 缺少权限的贡献未通过清单验证
  （`themes`、`mcpServers`、`services`、`bus`）； `skills` 是例外，并且是
  相反，在加载时跳过（参见
  [02-plugin-manifest-schema.md](/zh-CN/spec/07-plugins/02-plugin-manifest-schema) §7)

## 3A。 Plan 操作状态规则

每个 `agentTools` 贡献都会在 Plan 中被拒绝，无论此矩阵的值如何
风险或违约政策。 `agent.tool.register` 授权注册
Agent，在 Plan 中不可见。主机返回 `PLUGIN_DISABLED_IN_PLAN`
直接 Plan 调用并记录拒绝。仅插件工具符合资格
在同一个 Agent 被批准进入 Agent 模式后。

## 4. 权限显示副本

英文是主要副本。 zh-CN 列保存本地化的示例字符串。

| 许可 | 英文副本 | zh-CN 示例 |
|---|---|---|
| `fs.read.workspace` | 读取当前项目中的文件 | 读取当前项目文件 |
| `fs.write.workspace` | 修改当前项目中的文件 | 修改当前项目文件 |
| `fs.delete.workspace` | 删除当前项目中的文件 | 删除当前项目文件 |
| `notify` | 显示应用内和本机通知 | 显示应用内和系统通知 |
| `agent.tool.register` | 为AI Agent提供可执行工具 | 向AI Agent提供可执行工具 |
| `agent.prompt.inject` | 调整代理指令 | 调整智能体指令 |
| `net.fetch` | 访问网络 | 访问网络 |
| `shell.openExternal` | 打开外部链接 | 打开外部链接 |
| `ui.theme` | 提供一个主题 | 提供主题 |
| `mcp.server.local` | 运行本地 MCP 服务器 | 运行本地 MCP 服务 |
| `mcp.server.remote` | 到达远程 MCP 服务器 | 连接远端 MCP 服务 |
| `background.service` | 保持后台服务运行 | 保持后台服务运行 |
| `bus.publish` | 向其他插件发送消息 | 向其他插件发送消息 |
| `bus.subscribe` | 接收来自其他插件的消息 | 接收其他插件的消息 |

## 5. 添加升级权限

如果升级时出现新权限：

1. 计算差异
2.强制用户确认
3. 如果没有确认，请取消升级或禁用新功能（建议取消升级）

## 6. 运行时检查伪代码

```ts
assertPermission(pluginId, perm) {
 if (!granted(pluginId, perm)) throw ERROR_PERMISSION_DENIED
}
```

每个主机 API 入口点必须首先置位。

## 7. 验收

1. 未经授权的API调用失败
2. 权限副本在安装 UI 中可见
3.添加权限提示用户的升级
