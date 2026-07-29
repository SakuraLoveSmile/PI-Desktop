# 12. Plugin IPC and Host Services

## 1. Goals

Complete the plugin-related host services and UI IPC so implementation does not rely on ad-hoc conventions.

## 2. Main-process services

```text
PluginManager
 ├─ PluginRegistryStore
 ├─ ManifestValidator
 ├─ PackageInstaller
 ├─ PermissionGateway
 ├─ ContributionRegistry
 │ ├─ CommandRegistry
 │ ├─ AgentToolRegistry
 │ └─ SkillRegistry
 ├─ PluginRuntimeBroker
 ├─ PluginPanelHostService
 └─ MarketClient
```

## 3. UI IPC (additions)

### plugin domain
- `plugin/list`
- `plugin/detail`
- `plugin/loadDev`
- `plugin/installFromPath` ✅
- `plugin/installFromPackage` ✅
- `plugin/enable`
- `plugin/disable`
- `plugin/uninstall`
- `plugin/reload`
- `plugin/getLogs`
- `plugin/getPermissions`
- `plugin/grantPermissions`
- `plugin/revokePermissions`
- `plugin/openDataDir`
- `plugin/openInstallDir`
- `plugin/openPanel`
- `plugin/setAutoUpdate`

### commandPalette domain
- `commandPalette/search`
- `commandPalette/execute`
- `commandPalette/listRecent`

### market domain (implemented)
- `market/search`
- `market/getDetail`
- `market/install`
- `market/checkUpdates`
- `market/applyUpdates`
- `market/listProviders` (single official provider for now)

## 4. Events (main → renderer)

- `plugin/event/changed` (installed/enabled change)
- `plugin/event/loadError`
- `plugin/event/permissionRequired`
- `market/event/updateAvailable`

## 5. ContributionRegistry behavior

### Registration
- key must be unique
- Plugin commands share the prefix: `plugin.<pluginId>.<commandId>`
- Plugin tool prefix policy: `plugin_<pluginIdSafe>_<toolName>` (fixed in the implementation)

### Query
- The command palette only queries contributions that are enabled + loaded successfully
- The Agent only sees registered tools

### Deregistration
- Remove everything on disable/unload/uninstall

## 6. RuntimeBroker call chain

Plugin API call:

```text
plugin runtime
 → RPC to PluginRuntimeBroker
 → PermissionGateway.check
 → Host service execute
 → audit log
 → response
```

## 7. PanelHost interaction

- Create an isolated view when opening a panel
- Pass in pluginId / theme tokens
- Destroy the view and message subscriptions on close

## 8. Failure isolation

- Plugin API timeout: return TIMEOUT
- runtime crash: mark load_error, clean up contributions
- panel crash: only close the panel, do not unload the plugin (can prompt to reload)

**Implemented (2026-07-29, ADR 0008):** the broker lives in
`electron/main/plugin-runtime.ts` and every plugin call is a request to the
plugin's own `utilityProcess`. Budgets: load 15s, lifecycle hook 5s, command 30s,
tool 110s (under host-core's 120s tool budget). On process exit the broker
rejects pending calls with `PLUGIN_CRASHED`, deregisters that plugin's commands
and tools, closes its panel, writes a `plugin.crash` audit entry, and emits a
toast plus `pluginChanged` to the renderer.

## 9. Acceptance

1. The plugin list IPC works
2. The command palette IPC can execute plugin commands
3. Start/stop triggers contribution registration/deregistration
4. The market IPC runs end-to-end under a mock provider (later milestone)

## Appendix: agent-tool dispatch protocol (implemented M5)

Plugin agent tools execute in the desktop runner (Electron main), while the
permission gate and result envelope stay in host-core:

1. Model calls `plugin_<pluginIdSafe>_<toolName>`; the sidecar forwards it
   to host `tools.execute` like any built-in tool.
2. host-core runs the normal permission flow (risk, session grants,
   120s timeout), then emits notification `plugins.execute`
   `{ executionId, sessionId, toolCallId, toolName, args }`.
3. Electron main executes the registered plugin tool JS and answers via RPC
   `plugins.resolveExecution` `{ executionId, ok, content, errorCode? }`.
4. host-core resolves the pending execution and returns a standard
   `ToolsExecuteResult` to the sidecar. Dispatch timeout maps to
   `TOOL_TIMEOUT`; an unknown/unloaded tool maps to `TOOL_NOT_FOUND`.

The model-facing toolset gains plugin tools per prompt: main passes
registered defs (`fullName`, description, JSON-schema parameters) to
`agent.prompt`, and the runtime appends them to the built-in six.
Covered by protocol smoke scenario E2E-024.
