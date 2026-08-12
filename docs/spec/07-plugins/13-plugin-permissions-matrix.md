# 13. Plugin Permissions Matrix

## 1. Goals

Provide a permission–capability–risk–default-policy reference table for reuse by UI copy and validation.

## 2. Matrix

| Permission | Risk | Allowed API / capability | Default policy | Notes |
|---|---|---|---|---|
| `ui.panel` | low | Open the plugin panel | Granted at install | Needed by almost all UI plugins |
| `ui.theme` | low | `contributes.themes` CSS is loaded and offered in Settings | Granted at install | CSS is sanitized by the host; it cannot script |
| `clipboard.read` | medium | `clipboard.readText` | Confirm on first use | May read sensitive information |
| `clipboard.write` | medium | `clipboard.writeText` | Confirm on first use | Prevents clipboard pollution |
| `notify` | low | `ui.notify`, `ui.getNotificationPermission`, `ui.requestNotificationPermission`, `ui.showNativeNotification` | Can be granted by default | Native delivery is OS-controlled; avoid notification-spam abuse |
| `fs.read.workspace` | medium | `fs.readText` / `fs.glob` | Confirm on first use | Workspace only |
| `fs.write.workspace` | high | `fs.writeText` | Confirm each time or per session | High risk |
| `fs.delete.workspace` | high | `fs.remove` | Confirm each time or per session | Non-recursive; workspace root is protected |
| `agent.tool.register` | high | Register an agent tool | Confirm at install | Tool execution is audited separately |
| `agent.prompt.inject` | high | Inject a system prompt; activates `contributes.skills` | Deny by default / strong confirmation | Easily leads to behavior hijacking |
| `net.fetch` | high | `net.fetch` | Deny by default | Must show target-domain policy (later) |
| `shell.openExternal` | medium | Open external link | Confirm on first use | Prevents phishing links |
| `mcp.server.local` | high | Spawn a `transport: "stdio"` MCP server declared in the manifest | Deny by default | Runs a local executable; its tools reach the agent |
| `mcp.server.remote` | high | Connect a `transport: "http"` MCP server | Deny by default | Sends tool arguments to a third-party endpoint |
| `background.service` | medium | Start `contributes.services` and keep the plugin process resident | Confirm at install | Supervised with backoff; visible on the Plugins page |
| `bus.publish` | medium | `bus.publish` to declared topics | Confirm at install | Other plugins can act on the message |
| `bus.subscribe` | medium | `bus.subscribe` to declared patterns | Confirm at install | Can observe another plugin's messages |

## 3. Permission dependencies

- `ui.panel` is required to load a panel entry
- `agent.tool.register` is required to contribute agentTools
- When `fs.write.workspace` is present, it is recommended to also declare `fs.read.workspace`
- A contribution whose permission is missing fails manifest validation
  (`themes`, `mcpServers`, `services`, `bus`); `skills` is the exception and is
  skipped at load time instead (see
  [02-plugin-manifest-schema.md](02-plugin-manifest-schema.md) §7)

## 3A. Plan operating-state rule

Every `agentTools` contribution is denied in Plan, regardless of this matrix's
risk or default policy. `agent.tool.register` authorizes registration for
Agent, not visibility in Plan. The host returns `PLUGIN_DISABLED_IN_PLAN` for a
direct Plan call and records the denial. Plugin tools become eligible only
after the same Agent is approved into Agent mode.

## 4. Permission display copy

English is the primary copy. The zh-CN column holds the localized example strings.

| Permission | English copy | zh-CN example |
|---|---|---|
| `fs.read.workspace` | Read files in the current project | 读取当前项目文件 |
| `fs.write.workspace` | Modify files in the current project | 修改当前项目文件 |
| `fs.delete.workspace` | Delete files in the current project | 删除当前项目文件 |
| `notify` | Show in-app and native notifications | 显示应用内和系统通知 |
| `agent.tool.register` | Provide executable tools to the AI Agent | 向 AI Agent 提供可执行工具 |
| `agent.prompt.inject` | Adjust agent instructions | 调整智能体指令 |
| `net.fetch` | Access the network | 访问网络 |
| `shell.openExternal` | Open external links | 打开外部链接 |
| `ui.theme` | Provide a theme | 提供主题 |
| `mcp.server.local` | Run a local MCP server | 运行本地 MCP 服务 |
| `mcp.server.remote` | Reach a remote MCP server | 连接远端 MCP 服务 |
| `background.service` | Keep a background service running | 保持后台服务运行 |
| `bus.publish` | Send messages to other plugins | 向其他插件发送消息 |
| `bus.subscribe` | Receive messages from other plugins | 接收其他插件的消息 |

## 5. Adding permissions on upgrade

If new permissions appear on upgrade:

1. Compute the diff
2. Force user confirmation
3. If not confirmed, cancel the upgrade or disable the new capabilities (canceling the upgrade is recommended)

## 6. Runtime check pseudocode

```ts
assertPermission(pluginId, perm) {
 if (!granted(pluginId, perm)) throw ERROR_PERMISSION_DENIED
}
```

Every Host API entry point must assert first.

## 7. Acceptance

1. Unauthorized API calls fail
2. Permission copy is visible in the install UI
3. Upgrades that add permissions prompt the user
