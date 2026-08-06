# 04. Builtin Commands

## 1. Goal

Define first-party command palette entries available without plugins.

Shortcut: **Cmd/Ctrl + Shift + P** (D014)

## 2. Command ID convention

```text
builtin.<domain>.<action>
```

## 3. MVP builtin catalog

| id | title | keywords | category | risk | behavior |
|---|---|---|---|---|---|
| `builtin.session.new` | New Task | new, task, session | Session | low | create session and focus composer |
| `builtin.session.delete` | Delete Current Session | delete, session | Session | medium | confirm then delete active session |
| `builtin.session.rename` | Rename Current Session | rename, session | Session | low | open rename UI |
| `builtin.mode.plan` | Switch to Plan | mode, plan, planning | Mode | low | set idle session mode=plan |
| `builtin.mode.goal` | Switch to Goal | mode, goal, objective, autonomous | Mode | low | set idle session mode=goal |
| `builtin.mode.agent` | Switch to Agent | mode, agent, execute | Mode | low | set idle session mode=agent |
| `builtin.agent.abort` | Abort Active Turn | abort, stop | Agent | low | abort current turn/permission wait |
| `builtin.agent.compact` | Compact Conversation Context | compact, context, tokens | Agent | low | create a model-context checkpoint for the idle active session |
| `builtin.project.open` | Open Project | open, project, folder | Project | low | open folder picker and bind workspace |
| `builtin.project.clear` | Clear Project | clear, project | Project | low | unbind workspace |
| `builtin.settings.open` | Open Settings | settings, preferences | App | low | navigate settings root |
| `builtin.settings.providers` | Open Provider Settings | provider, model, key | Settings | low | navigate Settings → Agent → Providers card |
| `builtin.plugins.open` | Open Plugins | plugins, extensions | Plugins | low | navigate plugins page |
| `builtin.plugins.loadDev` | Load Development Plugin | load, dev, plugin | Plugins | medium | choose local plugin directory |
| `builtin.commandPalette.show` | Show Command Palette | palette, commands | App | low | open palette |
| `builtin.app.reloadWindow` | Reload Window | reload, window | App | low | renderer reload |
| `builtin.app.toggleDevtools` | Toggle DevTools | devtools, debug | Debug | low | toggle devtools (dev/nightly) |
| `builtin.logs.open` | Open Logs | logs, diagnostics | Diagnostics | low | open logs panel/path |

> Keep MVP set small. Plugin commands extend this list dynamically.

## 4. Visibility rules

- Debug commands may be hidden in production release builds
- Plugin management commands always available
- Project commands available even without active session
- `SubmitPlan` and `SubmitGoal` are model tools, not palette commands. Mode
  commands are
  accepted only for an idle session; there is no Chat mode or request-changes
  alias.
- Mode commands use the same active-session configuration path as the Composer
  Agent/Plan/Goal chip. When no session is active, they update the persisted
  default
  for the next session; a running session or pending approval is not changed.

## 5. Execution results

Commands return:

```ts
type CommandExecutionResult =
  | { ok: true; navigation?: string; message?: string }
  | { ok: false; error: AppError }
```

## 6. Acceptance

1. All builtin IDs are unique and prefixed
2. Palette search matches title/keywords
3. Mode switch commands update the idle session mode immediately; Plan, Goal,
   and Agent refer to the same pi Agent
4. Abort command works during stream and permission pending
5. Compact works while idle even when automatic context protection is disabled
   and returns `AGENT_BUSY` during an active turn/checkpoint

## 7. Composer slash aliases (D123, ADR 0024)

Builtin commands surface in the composer `/` menu through short aliases
defined in the same registry that feeds palette search
(`electron/main/builtin-commands.ts`); execution reuses the renderer switch.

| alias | palette id |
|---|---|
| `/new` | `builtin.session.new` |
| `/delete-task` | `builtin.session.delete` |
| `/abort` | `builtin.agent.abort` |
| `/compact` | `builtin.agent.compact` |
| `/agent-mode` | `builtin.mode.agent` |
| `/plan-mode` | `builtin.mode.plan` |
| `/goal-mode` | `builtin.mode.goal` |
| `/open-project` | `builtin.project.open` |
| `/clear-project` | `builtin.project.clear` |
| `/settings` | `builtin.settings.open` |
| `/providers` | `builtin.settings.providers` |
| `/import` | `builtin.settings.import` |
| `/plugins` | `builtin.plugins.open` |
| `/load-plugin` | `builtin.plugins.loadDev` |
| `/logs` | `builtin.logs.open` |

Aliases share one namespace with template and plugin command names; builtin
aliases win collisions, then project templates, then user templates, then
plugin commands. Selecting an alias inserts `/alias `; sending executes it
locally without creating a session or a prompt when the alias is sent alone.
The Agent/Plan/Goal aliases also support a prompt body: `/agent-mode <prompt>`,
`/plan-mode <prompt>`, or `/goal-mode <prompt>` switches the idle session (or
the next-session default)
and sends `<prompt>` through the normal prompt path. The prompt body remains
the visible user turn; a failed dispatch does not clear the composer draft.
