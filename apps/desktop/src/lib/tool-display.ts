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

type ToolMessageLike = {
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
};

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

export function getToolSummary(toolName: string | undefined, args: unknown) {
  const action = getToolAction(toolName);
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    for (const key of SUMMARY_KEYS[action]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return compact(value);
    }
    const fallback = formatToolValue(record);
    if (fallback && fallback !== "{}") return compact(fallback);
  }
  if (action === "use") return getToolDisplayName(toolName);
  return "";
}

/**
 * Cheap "has expandable details" check. getToolSections stringifies the full
 * args/result; collapsed rows (the default) only need to know whether the
 * caret should show.
 */
export function hasToolSections(message: ToolMessageLike) {
  if (message.toolArgs !== undefined) return true;
  const outputValue =
    message.toolResult !== undefined ? message.toolResult : message.content;
  return outputValue !== undefined && outputValue !== "";
}

export function getToolSections(message: ToolMessageLike) {
  const input =
    message.toolArgs === undefined ? "" : formatToolValue(message.toolArgs);
  const outputValue =
    message.toolResult !== undefined ? message.toolResult : message.content;
  const output =
    outputValue === undefined || outputValue === ""
      ? ""
      : formatToolValue(outputValue);
  return { input, output };
}

export function formatToolDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
