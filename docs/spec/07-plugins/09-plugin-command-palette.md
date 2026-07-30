# 09. Plugin Command Palette

## 1. Goals

Provide a fast command entry point that unifies discovery and execution of built-in and plugin capabilities in a single searchable surface.

## 2. Entry point

Suggested shortcut:

- macOS: `Command + Shift + P`
- Windows/Linux: `Ctrl + Shift + P`

Also configurable:
- Custom shortcut
- Launcher mode (later)

## 3. Command model

```ts
type PaletteCommand = {
 id: string // e.g. builtin.session.new / plugin.demo.hello.open
 title: string
 keywords: string[]
 category?: string
 source: "builtin" | "plugin"
 pluginId?: string
 icon?: string
 enabled: boolean
 risk?: "low" | "medium" | "high"
}
```

## 4. Command sources

1. Built-in commands
 - New session
 - Open settings
 - Open project
 - Switch mode
2. Plugin `contributes.commands`
3. Later: skill shortcuts / marketplace search entry

## 5. Search rules

- Match by title / keywords / category / pluginName
- Support prefix and substring matching
- Chinese keywords are supported
- Result ordering:
 1. Recently used
 2. Exact prefix
 3. Built-in priority or user weighting (configurable)
 4. Alphabetical

## 6. Execution flow

```text
open palette
 → input query
 → select command
 → execute
 → builtin handler
 → or plugin command bridge
 → close palette / keep open (optional)
```

If the command needs a panel:
- Open PluginPanelHost after execution

If the command needs a permission:
- Go through the permission gateway first

## 7. UI structure

```text
-------------------------------------------------
[ search input ]
-------------------------------------------------
Builtin
 New Task
 Open Project
Demo
 Hello: Open Panel
Tools
 ...
-------------------------------------------------
Enter to run · Esc to close · Tab to preview source
-------------------------------------------------
```

Each item shows:
- Title
- Source badge (builtin/plugin)
- Shortcut hint (optional)

## 8. Empty state / errors

- No match: show "No commands, try installing a plugin"
- Plugin command execution failed: toast + log
- Disabled plugin: its commands do not appear

## 9. Relationship to the Agent

The command palette is not a replacement for the chat composer.
It is responsible for "launching actions"; chat is responsible for "conversational tasks".

Possible command to support:
- "Send the currently selected command result to the session" (later)

## 10. Acceptance

1. Shortcut opens it
2. Built-in and plugin commands are searchable
3. Executing a plugin command succeeds
4. Commands disappear after a plugin is disabled
5. Recently-used ordering takes effect
