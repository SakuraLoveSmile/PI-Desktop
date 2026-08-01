import type { DiffFile, UiMessage, WorkspaceDiff } from "@pi-desktop/shared";

export type WorkspaceChangeSummary = {
  fileCount: number;
  additions: number;
  deletions: number;
  truncated: boolean;
};

const WORKSPACE_CHANGE_TOOLS = new Set(["Write", "Edit"]);

export function summarizeWorkspaceChanges(
  diff: WorkspaceDiff | null,
): WorkspaceChangeSummary | null {
  if (!diff?.repo || diff.clean || diff.files.length === 0) return null;

  return {
    fileCount: diff.files.length,
    additions: diff.files.reduce((total, file) => total + file.additions, 0),
    deletions: diff.files.reduce((total, file) => total + file.deletions, 0),
    truncated: diff.truncated === true,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toolResultDetails(message: UiMessage): Record<string, unknown> | null {
  return recordValue(recordValue(message.toolResult)?.details);
}

/** Return the workspace-relative path written by a successful file tool. */
export function workspaceChangePath(message: UiMessage): string | null {
  if (
    message.role !== "tool" ||
    message.toolStatus !== "success" ||
    !WORKSPACE_CHANGE_TOOLS.has(message.toolName || "")
  ) {
    return null;
  }

  const details = toolResultDetails(message);
  if (details?.root !== "workspace") return null;

  const args = recordValue(message.toolArgs);
  const path =
    typeof details.path === "string"
      ? details.path
      : typeof args?.path === "string"
        ? args.path
        : null;
  return normalizeDiffPath(path);
}

function normalizeDiffPath(path?: string | null): string | null {
  const value = path?.trim();
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized || "/";
}

/** Find the current working-tree diff produced by one transcript tool row. */
export function findWorkspaceChangeForMessage(
  message: UiMessage,
  diff: WorkspaceDiff | null,
): DiffFile | null {
  const path = workspaceChangePath(message);
  if (!path || !diff?.repo || diff.clean) return null;

  return (
    diff.files.find(
      (file) =>
        normalizeDiffPath(file.path) === path ||
        normalizeDiffPath(file.oldPath) === path,
    ) ?? null
  );
}
