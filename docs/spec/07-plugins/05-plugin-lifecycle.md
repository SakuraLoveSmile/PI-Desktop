# 05. Plugin Lifecycle

## 1. Goals

Define the complete state machine from discovery to uninstall, guaranteeing:

- Predictable behavior
- Recoverable failures
- Auditable start/stop
- Consistency with command palette / AgentTool registration

## 2. State machine

```text
discovered
 → validated
 → installed
 → enabled
 → loaded
 → running
 → load_error
 → disabled
 → install_error
 → invalid
```

### State descriptions

| State | Meaning |
|---|---|
| discovered | Plugin directory or package scanned |
| validated | manifest / file integrity passed |
| installed | Written to the installed directory and registered |
| enabled | Enabled by the user, allowed to load |
| loaded | Runtime loaded, contribution points registered |
| running | Has an active panel / background logic |
| disabled | Installed but turned off by the user |
| load_error | Load failed after enabling |
| install_error | Install failed |
| invalid | Validation failed, unusable |

## 3. Lifecycle hooks

**Implemented today:** the runtime (`apps/desktop/electron/main/plugin-runtime.ts`) invokes `onLoad` (when a plugin is loaded on load/enable) and `onUnload` (dispatched into the plugin process on unload/disable/reload, 5s budget, then the process is stopped); unloading tears down the plugin's registered commands and tools. The other hooks below are declared in the API but not yet fired.

**Planned:** once the full lifecycle lands, hooks fire in this order:

1. `onInstall` (once, only after a successful install)
2. `onEnable`
3. `onLoad`
4. runtime events
5. `onUnload`
6. `onDisable`
7. `onUninstall`

### Invocation constraints
- Hooks must be able to time out (default 5s, configurable)
- A hook exception must not crash the host
- If `onLoad` fails, enter `load_error` and automatically roll back the contribution points already registered

## 4. Enable / disable semantics

### enable
- Set state to enabled
- Attempt load
- Success: register commands / tools / skills
- Failure: automatically fall back to disabled and surface the error to the user. This is frozen by D017 (enable→load failure auto-disables the plugin).

### disable
- Unregister commands / tools
- Close panel
- Call `onUnload` / `onDisable`
- Persist as disabled

## 5. Startup recovery

On app startup:

1. Scan installed plugins
2. Read the enabled state
3. Load only enabled plugins
4. Skip a single failed plugin without affecting other plugins or the main app

## 6. Developer mode

`dev-loaded` plugins:

- Not copied to `installed`
- Reference the local path directly
- Can watch and hot reload
- Reload flow: `unload → validate → load`

On hot reload:
- Preserve plugin settings as much as possible
- Panel in-memory state is not guaranteed to be preserved

## 7. Contribution-point register/unregister transaction

Each plugin's load process should be approximately transactional:

```text
begin
 register commands
 register tools
 register skills
commit
```

On mid-way failure:
```text
rollback all registrations from this plugin
```

Avoid a half-loaded state where "the command exists but the tool does not".

## 8. Audit events

Record at least:

- plugin.install
- plugin.uninstall
- plugin.enable
- plugin.disable
- plugin.load.success
- plugin.load.error
- plugin.unload
- plugin.crash

Fields:
- pluginId
- version
- source (`installed` | `dev` | `marketplace`)
- ts
- errorCode?

## 9. Uninstall strategy

Before uninstall:
1. disable + unload
2. Call `onUninstall`
3. Delete installed files
4. Clean up plugin-private data (may ask the user whether to keep it)

Default recommendation:
- Clean up settings/data on uninstall (D016: uninstall deletes plugin data by default)
- Provide a "keep data" advanced option (can be deferred)
