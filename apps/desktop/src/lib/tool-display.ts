export type ToolAction =
  | "read"
  | "list"
  | "search"
  | "write"
  | "edit"
  | "run"
  | "fetch"
  | "fork"
  | "use";

const SUMMARY_KEYS: Record<ToolAction, string[]> = {
  read: ["path", "file_path", "filePath"],
  list: ["path", "pattern", "glob"],
  search: ["query", "pattern", "path"],
  write: ["path", "file_path", "filePath"],
  edit: ["path", "file_path", "filePath"],
  run: ["command", "cmd"],
  fetch: ["url", "query"],
  fork: ["prompt", "task", "description", "name"],
  use: [
    "command",
    "cmd",
    "path",
    "file_path",
    "filePath",
    "url",
    "query",
    "pattern",
    "prompt",
  ],
};

function compact(value: string, limit = 220) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > limit
    ? `${singleLine.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
    : singleLine;
}

export function formatToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getToolAction(toolName?: string): ToolAction {
  const normalized = (toolName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const matches = (aliases: string[]) =>
    aliases.some(
      (alias) => normalized === alias || normalized.endsWith(alias),
    );
  if (matches(["websearch", "searchquery", "fetch", "http", "browser"])) {
    return "fetch";
  }
  if (matches(["read", "readfile", "fileread"])) return "read";
  if (matches(["glob", "list", "listfiles", "findfiles"])) return "list";
  if (matches(["grep", "rg", "search", "searchfiles"])) return "search";
  if (matches(["write", "writefile", "createfile"])) return "write";
  if (matches(["edit", "editfile", "applypatch", "patch"])) return "edit";
  if (matches(["fork", "forkagent", "forktask", "forksession"])) {
    return "fork";
  }
  if (
    matches(["bash", "shell", "exec", "execcommand", "runcommand", "terminal"])
  ) {
    return "run";
  }
  return "use";
}

export function getToolDisplayName(toolName?: string) {
  const raw = (toolName || "").replace(/^plugin[_-]/i, "");
  const spaced = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "";
  return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Which argument the collapsed row summary is showing, so expanded detail
 * blocks can skip repeating it.
 */
export function getToolSummaryKey(
  toolName: string | undefined,
  args: unknown,
): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of SUMMARY_KEYS[getToolAction(toolName)]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return key;
  }
  return null;
}

export function getToolSummary(toolName: string | undefined, args: unknown) {
  const action = getToolAction(toolName);
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const key = getToolSummaryKey(toolName, args);
    if (key) return compact(record[key] as string);
    const fallback = formatToolValue(record);
    if (fallback && fallback !== "{}") return compact(fallback);
  }
  if (action === "use") return getToolDisplayName(toolName);
  return "";
}

export function formatToolDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
