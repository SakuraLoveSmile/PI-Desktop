/** Native Git metadata and mutations are owned by Host Core. */
export type GitWorkspaceRequest = { projectPath: string; sessionId?: string };
export type GitBranch = { name: string; current: boolean; checkedOutPath?: string };
export type GitWorktree = { path: string; branch: string | null; isMain: boolean; managed: boolean };
export type GitWorkspaceSnapshot = {
  projectPath: string;
  rootPath: string;
  mainPath: string;
  branch: string | null;
  head: string | null;
  isWorktree: boolean;
  dirty: boolean;
  branches: GitBranch[];
  worktrees: GitWorktree[];
};
export type GitWorkspaceMutation = GitWorkspaceRequest & {
  expectedHead: string | null;
  expectedBranch: string | null;
  branch: string;
};
