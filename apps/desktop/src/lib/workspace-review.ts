import type { WorkspaceDiff } from "@pi-desktop/shared";

export type WorkspaceChangeSummary = {
  fileCount: number;
  additions: number;
  deletions: number;
  truncated: boolean;
};

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
