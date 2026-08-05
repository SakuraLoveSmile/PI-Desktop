import type { CommandItem, ComposerCommand } from "@pi-desktop/shared";

/**
 * Single source of truth for first-party commands: the palette search list
 * and the composer "/" menu aliases both derive from it (D123, spec 04 §7).
 */
export type BuiltinCommandDef = CommandItem & {
  /** Composer slash alias, unique across the merged command namespace. */
  slash: string;
};

export const BUILTIN_COMMANDS: BuiltinCommandDef[] = [
  { id: "builtin.session.new", title: "New task", category: "Session", keywords: ["new", "chat", "task"], source: "builtin", slash: "new" },
  { id: "builtin.session.delete", title: "Delete current task", category: "Session", keywords: ["delete", "remove", "session"], source: "builtin", slash: "delete-task" },
  { id: "builtin.agent.abort", title: "Abort current run", category: "Session", keywords: ["stop", "abort", "cancel"], source: "builtin", slash: "abort" },
  { id: "builtin.agent.compact", title: "Compact conversation context", category: "Session", keywords: ["compact", "context", "tokens"], source: "builtin", slash: "compact" },
  { id: "builtin.mode.agent", title: "Switch to Agent mode", category: "Session", keywords: ["mode", "agent"], source: "builtin", slash: "agent-mode" },
  { id: "builtin.mode.plan", title: "Switch to Plan mode", category: "Session", keywords: ["mode", "plan", "planning"], source: "builtin", slash: "plan-mode" },
  { id: "builtin.project.open", title: "Open project", category: "Project", keywords: ["open", "folder", "workspace"], source: "builtin", slash: "open-project" },
  { id: "builtin.project.clear", title: "Clear project", category: "Project", keywords: ["clear", "close", "workspace"], source: "builtin", slash: "clear-project" },
  { id: "builtin.settings.open", title: "Open settings", category: "App", keywords: ["settings", "preferences"], source: "builtin", slash: "settings" },
  { id: "builtin.settings.providers", title: "Open provider settings", category: "Settings", keywords: ["provider", "model", "key"], source: "builtin", slash: "providers" },
  { id: "builtin.settings.import", title: "Import from other tools", category: "Settings", keywords: ["import", "claude", "codex", "opencode", "pi", "migrate"], source: "builtin", slash: "import" },
  { id: "builtin.plugins.open", title: "Open plugins", category: "Plugins", keywords: ["plugins", "extensions"], source: "builtin", slash: "plugins" },
  { id: "builtin.plugins.loadDev", title: "Load development plugin", category: "Plugins", keywords: ["load", "dev", "plugin"], source: "builtin", slash: "load-plugin" },
  { id: "builtin.logs.open", title: "Open logs folder", category: "Diagnostics", keywords: ["logs", "diagnostics"], source: "builtin", slash: "logs" },
];

/** Palette-shaped items (no slash field leaks into the palette contract). */
export function builtinPaletteItems(): CommandItem[] {
  return BUILTIN_COMMANDS.map(({ slash: _slash, ...item }) => item);
}

/** Composer "/" menu entries for the builtin group. */
export function builtinComposerCommands(): ComposerCommand[] {
  return BUILTIN_COMMANDS.map((def) => ({
    name: def.slash,
    kind: "builtin",
    title: def.title,
    ...(def.category ? { description: def.category } : {}),
    id: def.id,
  }));
}
