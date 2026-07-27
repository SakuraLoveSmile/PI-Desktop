import type { WorkspaceDiff } from "@pi-desktop/shared";

export type WorkspaceChangeSummary = {
  fileCount: number;
  additions: number;
  deletions: number;
  truncated: boolean;
};

export type WorkspaceReviewSessions = Record<string, string>;

function normalizeWorkspacePath(path?: string | null): string | null {
  const value = path?.trim();
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

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

export function summarizeSessionWorkspaceChanges({
  diff,
  diffPath,
  workspacePath,
  sessionId,
  reviewSessions,
}: {
  diff: WorkspaceDiff | null;
  diffPath: string | null;
  workspacePath?: string | null;
  sessionId?: string | null;
  reviewSessions: WorkspaceReviewSessions;
}): WorkspaceChangeSummary | null {
  if (!sessionId || !workspacePath || !diffPath) return null;

  const workspaceKey = normalizeWorkspacePath(workspacePath);
  if (
    normalizeWorkspacePath(diffPath) !== workspaceKey ||
    normalizeWorkspacePath(reviewSessions[sessionId]) !== workspaceKey
  ) {
    return null;
  }

  return summarizeWorkspaceChanges(diff);
}

export function withoutWorkspaceReviewSessions(
  reviewSessions: WorkspaceReviewSessions,
  workspacePath: string,
): WorkspaceReviewSessions {
  const workspaceKey = normalizeWorkspacePath(workspacePath);
  return Object.fromEntries(
    Object.entries(reviewSessions).filter(
      ([, path]) => normalizeWorkspacePath(path) !== workspaceKey,
    ),
  );
}
