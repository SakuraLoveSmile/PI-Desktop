# 10. Plugin Developer Experience

## 1. Goals

Let a developer create and load a local plugin within 10 minutes.

## 2. Developer path

```text
Create from template
 → edit manifest / main / panel   (hot reload keeps it live)
 → verify in the command palette
 → check
 → pack piplug
```

The first step has three entry points, all calling the same
`@pi-desktop/plugin-devkit` implementation:

- **Plugins page** — the overflow menu's "New plugin from template", or the
  button on the empty state. Picks a template, asks for a folder, writes the
  files, and loads the result as a development plugin in one step.
- **Agent** — `PluginScaffold`, in a conversation ("write me a plugin that …").
- **CLI** — `pnpm pi-plugin init <template> <dir>`.

## 3. Template types

Official templates, all four available:

1. `panel-basic`: panel + command
2. `agent-tool-basic`: register a tool
3. `skill-pack`: skills only
4. `full-demo`: panel + command + tool + skill + settings

Every template scaffolds a manifest with `schemaVersion: 1`, a `main.js`, a
README, and only the permissions the template actually uses. Scaffolding refuses
to write into a non-empty directory.

Current repo example:
- `examples/plugins/hello`

## 4. SDK and devkit

`@pi-desktop/plugin-sdk` is imported by plugin code itself and stays
dependency-free and Node-free. It provides:
- manifest types
- permission enums
- API types (`PiPluginHostApi`)
- manifest validation function
- test helper (mock host)

`@pi-desktop/plugin-devkit` is tooling, not runtime, and may use Node. It owns
`scaffold` / `check` / `pack` and the `pi-plugin` CLI. All three developer
surfaces (CLI, agent tools, plugins page) call it, so a rule enforced once holds
everywhere.

## 5. Local development commands

```bash
# create from a template
pnpm pi-plugin init full-demo /tmp/my-plugin

# validate manifest and package contents
pnpm pi-plugin check .

# pack
pnpm pi-plugin pack .

# outputs dist/demo.hello-0.1.0.piplug
```

`check` reproduces every rule the installer enforces, so `check` passing implies
install will pass. It reports errors — a missing or unparseable `manifest.json`,
missing `main` / `ui.panel` / skill files, a skill path escaping the plugin
directory, an unknown permission, a symlink, more than 2000 files, more than
50 MB — and warnings, which do not block: high-risk permissions, permissions
declared but never used by the code, `contributes.skills` without
`agent.prompt.inject` (the skills would be inert), and an empty `contributes`.

`pack` writes `dist/<id>-<version>.piplug`, skipping `.git` and `node_modules`
exactly as the installer's copy does, and prints the sha256. It runs `check`
first and refuses to pack a plugin with errors. **Entries are stored
uncompressed (method 0)**: the installer accepts nothing else, so a `.piplug`
must never be built with `zip` or another shell tool.

## 6. Agent tools

Three tools are served from Electron main (host-core never sees them), each
resolving its `directory` argument against the session's workspace root and
refusing to escape it:

| Tool | Modes | Effect |
|---|---|---|
| `PluginCheck` | all | Validates a plugin directory; read-only |
| `PluginScaffold` | agent | Writes a template, then loads it as a development plugin |
| `PluginPack` | agent | Validates, then writes `dist/<id>-<version>.piplug` |

A built-in skill, `apps/desktop/resources/skills/plugin-development.md`,
documents the manifest schema, the permission tiers, the host API surface, and
this loop. It activates only when the session workspace looks like plugin
development — a plugin `manifest.json` at the workspace root, or a loaded
development plugin inside it — so ordinary sessions pay only for the three tool
descriptions. Scaffolding writes a manifest, which turns the full skill on from
the next prompt.

## 7. Hot reload

A plugin loaded from a folder is watched from then on, including across
restarts: the folder is picked once, not once per edit.

- Any change under the plugin directory reloads it, debounced 300 ms, so one
  save burst is one reload. `node_modules`, `.git`, `dist`, `target` and editor
  scratch files are ignored — a plugin writing into its own `dist/` must not
  reload itself forever.
- A reload unloads the previous process and runs the plugin again from disk, so
  a manifest, `main`, or skill change all take effect the same way. Panels are
  re-created from the reloaded contribution.
- **A reload can never widen permissions.** The reload reads the manifest first
  and compares it against the set approved when the folder was picked; anything
  new stops the reload with `PERMISSION_DENIED` and a message to load the plugin
  again so the grant can be reviewed. Removed permissions do take effect
  immediately — grants follow the manifest downwards, never upwards.
- A failed reload (syntax error, invalid manifest) leaves the plugin unloaded
  but still watched, so the save that fixes it recovers the plugin. The failure
  is reported as a toast plus a plugin-changed event; the registry row does not
  currently move to `load_error`, because host-core has no RPC for a
  runtime-side load failure.
- Watchers are released on unload, disable, uninstall and quit, and are capped
  at 16 plugins; past the cap the app logs and edits need a manual reload.

## 8. Debugging

Minimum requirements:
- Plugin log panel (filter by pluginId)
- View registered commands/tools
- Copy error stack traces

Later:
- Dedicated DevTools for the panel
- mock tool invoker

## 9. Documentation checklist (developer site / repo docs)

- Quick start
- manifest fields
- Permission reference
- API manual
- Publishing manual (pack/sign)
- Security best practices

## 10. Quality gate (recommended before publishing)

- `pi-plugin check` reports no errors
- No calls to undeclared permissions
- Has a README
- Has a version changelog
- If it includes a tool: provide parameter examples

## 11. Acceptance

1. A new plugin can be created from a template, from the plugins page, the agent
   or the CLI
2. Development load succeeds
3. An edit reloads the plugin without re-picking its folder, and a broken edit
   recovers on the next save
4. `check` passes and the `pack` artifact installs
5. A declared skill reaches the model when `agent.prompt.inject` is granted, and
   stops reaching it when the permission is revoked
