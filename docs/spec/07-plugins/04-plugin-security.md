# 04. Plugin Security

## 1. Threat model

Plugins may come from:
- The user's own development
- Shared by colleagues
- Third parties in a future marketplace

Main risks:
1. Malicious file read/write
2. Malicious command execution
3. Stealing API keys / session content
4. Hijacking agent tools
5. Phishing via the UI

## 2. Default-deny principle

- Undeclared permission = unavailable
- Disabled plugin = code not loaded
- Unconfirmed high-risk action = not executed
- Host API not on the allowlist = does not exist

## 3. Isolation strategy

### Must
1. Plugin UI is isolated from the host UI DOM
2. Plugins cannot directly require host modules
3. The secret store is not open to plugins
4. The plugin-private data directory is separate from the host core library

### Goals
1. Plugin main runs in a separate process
2. Crash isolation
3. Resource limits (later: CPU/memory/timeout)

## 4. Permission-grant UX

At install/load time, show:

- Permission list
- Risk description
- Developer info
- Source path

User actions:
- Accept and enable
- Cancel

First use of a high-risk API may re-confirm.

## 5. Data isolation

Plugins can access:
- Their own settings
- Their own data path

Plugins cannot access:
- Other plugins' data
- Host secrets
- The host's full session database (unless a controlled API exists in the future)

## 6. Path safety

For `fs.*`:
- Workspace-relative paths only
- normalize + root boundary
- Reject absolute paths and escapes

## 7. Agent security

- Plugin tool names are namespaced to avoid collisions using the frozen forced prefix `plugin_<pluginIdSafe>_<toolName>` (D015)
- tool execution timeout
- tools can be disabled by the user in one click
- the prompt-injection API is high-risk by default and requires an explicit permission

## 8. Network and external links

- `net.fetch` is not granted by default
- `openExternal` should confirm
- Plugins are forbidden from silently downloading and executing binaries (not done at all in MVP)

## 9. Auditing and emergency response

Users should be able to:
- View plugin permissions
- View plugin error logs
- Disable in one click
- Uninstall in one click

The host should be able to:
- Auto-disable a plugin on anomaly
- Guarantee the main app can start

## 10. Security acceptance

1. Writing a file fails without the `fs.write.workspace` permission
2. After disabling a plugin, its tools are no longer visible
3. A plugin cannot read API keys
4. A plugin panel cannot call arbitrary host IPC
5. An uncaught exception from a plugin does not cause the app to exit


## 11. Implementation status

Current enforcement:

1. Default-deny permission checks in `PluginRuntime`
2. Workspace path boundary checks for plugin fs APIs
3. Panel windows use sandboxed preload + isolated session partitions
4. Secrets / host DB remain inaccessible to plugins
5. Marketplace/package install requires explicit permission acceptance in UI
6. Auto-update refuses silent permission expansion
