# 13. Plugin Permissions Matrix

## 1. Goals

Provide a permission–capability–risk–default-policy reference table for reuse by UI copy and validation.

## 2. Matrix

| Permission | Risk | Allowed API / capability | Default policy | Notes |
|---|---|---|---|---|
| `ui.panel` | low | Open the plugin panel | Granted at install | Needed by almost all UI plugins |
| `clipboard.read` | medium | `clipboard.readText` | Confirm on first use | May read sensitive information |
| `clipboard.write` | medium | `clipboard.writeText` | Confirm on first use | Prevents clipboard pollution |
| `notify` | low | `ui.notify` | Can be granted by default | Avoid notification-spam abuse |
| `fs.read.workspace` | medium | `fs.readText` / `fs.glob` | Confirm on first use | Workspace only |
| `fs.write.workspace` | high | `fs.writeText` | Confirm each time or per session | High risk |
| `agent.tool.register` | high | Register an agent tool | Confirm at install | Tool execution is audited separately |
| `agent.prompt.inject` | high | Inject a system prompt | Deny by default / strong confirmation | Easily leads to behavior hijacking |
| `net.fetch` | high | `net.fetch` | Deny by default | Must show target-domain policy (later) |
| `shell.openExternal` | medium | `openExternal` | Confirm on first use | Prevents phishing links |

## 3. Permission dependencies

- `ui.panel` is required to load a panel entry
- `agent.tool.register` is required to contribute agentTools
- When `fs.write.workspace` is present, it is recommended to also declare `fs.read.workspace`

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
| `agent.tool.register` | Provide executable tools to the AI Agent | 向 AI Agent 提供可执行工具 |
| `net.fetch` | Access the network | 访问网络 |
| `shell.openExternal` | Open external links | 打开外部链接 |

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
