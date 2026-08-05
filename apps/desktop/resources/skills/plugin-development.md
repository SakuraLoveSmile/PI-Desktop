---
name: PI-Desktop plugin development
description: the user is writing, checking, packaging or debugging a PI-Desktop plugin
---

You are working inside a PI-Desktop plugin. Use the `PluginScaffold`, `PluginCheck` and
`PluginPack` tools instead of hand-rolling files or shell commands — they enforce the same
rules the installer does, so anything they accept will install.

## Development loop

1. `PluginScaffold` — create a plugin from a template. It writes the directory and loads the
   plugin immediately, so it is live before you edit anything.
2. Edit the source. A plugin loaded from a directory hot-reloads on save: no re-picking the
   folder, no restart. Widening `permissions` in `manifest.json` is the one exception — that
   needs an explicit re-load, because hot reload must never grant a permission the user did
   not approve.
3. `PluginCheck` — validate the plugin. Fix every error; treat warnings as review notes.
4. `PluginPack` — produce `dist/<id>-<version>.piplug`, installable from the plugins page.

Templates: `panel-basic` (a webview panel), `agent-tool-basic` (a tool the agent can call),
`skill-pack` (instruction documents only), `full-demo` (all three plus a setting).

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "local.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "main": "main.js",
  "permissions": ["ui.panel"],
  "ui": { "panel": "renderer/index.html" },
  "contributes": {
    "commands": [{ "id": "my-plugin.hello", "title": "Say hello" }],
    "agentTools": [{ "name": "echo_text", "description": "Echo the input" }],
    "skills": ["skills/my-plugin.md"],
    "settings": [{ "key": "greeting", "type": "string", "default": "Hello" }]
  }
}
```

`schemaVersion`, `id`, `name`, `version` and `main` are required. `id` must match
`[a-zA-Z0-9][a-zA-Z0-9._-]*`; prefix personal plugins with `local.`. Every path is relative to
the plugin directory and may not escape it.

## Entry point

`main.js` is CommonJS, evaluated in a dedicated process with no access to the host's
environment variables. Export lifecycle hooks and receive the host API as `pi`:

```js
module.exports = {
  async onLoad(pi) {
    pi.registerCommand("my-plugin.hello", async () => {
      await pi.ui.showToast("Hello from my plugin");
    });
  },
  async onUnload() {},
};
```

`onLoad` must finish within 15s, other hooks within 5s, agent tools within 110s. An
uncaught error during load rolls the whole load back and leaves the plugin in `load_error`.

## Permissions

Every permission is declared in the manifest and granted at install time; an undeclared call
fails at runtime. Ask for the least you need — the plugins page shows the risk tier to the
user.

- High risk: `net.fetch`, `fs.write.workspace`, `fs.delete.workspace`, `agent.prompt.inject`, `agent.tool.register`
- Medium: `fs.read.workspace`, `clipboard.read`, `clipboard.write`, `shell.openExternal`
- Low: `ui.panel`, `notify`

Host APIs, and nothing else: `app.getVersion`, `app.getLocale`, `plugin.getSettings`,
`plugin.setSettings`, `plugin.getDataPath`, `ui.openPanel`, `ui.closePanel`, `ui.showToast`,
`ui.notify`, `workspace.get`, `fs.readText`, `fs.writeText`, `fs.glob`, `fs.remove`, `clipboard.readText`,
`clipboard.writeText`, `shell.openExternal`, `net.fetch`. There is no archive, process or
network-server API.

## Skills

A file listed in `contributes.skills` is injected into the agent's system prompt, so it needs
`agent.prompt.inject`. Without that permission the file is simply ignored. Give each skill
`name` and `description` front matter — the description is what tells the model when the skill
applies:

```markdown
---
name: Release notes
description: the user asks for release notes or a changelog entry
---

Write one line per user-visible change, imperative mood, newest first.
```

Skills share a 16 KiB budget (8 KiB per skill) and are read fresh on every prompt, so an edit
takes effect on the next message. Keep them short and specific; a skill that always applies is
a skill that wastes context.

## Packaging

A `.piplug` is a **store-only (uncompressed) zip** — the installer rejects deflated entries.
Always produce one with `PluginPack`, never with `zip` or `tar`. `.git`, `node_modules` and
`dist` are excluded automatically; the package must stay under 2000 files and 50 MB, and may
not contain symlinks.
