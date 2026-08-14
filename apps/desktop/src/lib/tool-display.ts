export type ToolAction =
  | "read"
  | "list"
  | "search"
  | "write"
  | "edit"
  | "run"
  | "fetch"
  | "fork"
  | "delegate"
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
  // `description` is the short label the model writes for the delegation; the
  // `task` brief is a paragraph and belongs in the expanded detail. The
  // lifecycle tools (ADR 0087) summarize by delegation id.
  delegate: ["description", "agent", "delegationids", "delegationId"],
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

/** The tool that STARTS a subagent (ADR 0062). The lifecycle tools of ADR 0087
 * (TaskWait/TaskList/TaskStop) drive an existing delegation and are not
 * delegation activity items themselves. */
export function isDelegationStartTool(toolName?: string): boolean {
  const bare = (toolName || "")
    .split(".")
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return bare === "task" || bare === "subagent";
}

export function getToolAction(toolName?: string): ToolAction {
  const normalized = (toolName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const matches = (aliases: string[]) =>
    aliases.some(
      (alias) => normalized === alias || normalized.endsWith(alias),
    );
  // Delegation (ADR 0062, ADR 0087) is matched on the exact name, minus any
  // provider namespace: a plugin tool called "CreateTask" is not a subagent
  // call and keeps its generic presentation.
  const bare = (toolName || "")
    .split(".")
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (
    isDelegationStartTool(toolName) ||
    bare === "taskwait" ||
    bare === "tasklist" ||
    bare === "taskstop"
  ) {
    return "delegate";
  }
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

/**
 * The whole argument the collapsed row summarizes, unwrapped and untrimmed.
 * The summary is squeezed onto one line to fit the row; a reader copying a
 * multi-line command out of the head needs it the way it was written (D226).
 */
export function getToolSummaryValue(
  toolName: string | undefined,
  args: unknown,
): string {
  const key = getToolSummaryKey(toolName, args);
  if (!key) return "";
  return (args as Record<string, unknown>)[key] as string;
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
