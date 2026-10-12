import type { GitWorkspaceSnapshot } from "@pi-desktop/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../../lib/api";
import { normalizeProjectPath } from "../../../../lib/sidebar-session-groups";
import { useAppStore } from "../../../../stores/app-store";
import { projectPathInCheckout } from "../composer-git-menu";

/** Session-scoped checkout controller. Host remains authoritative for Git safety. */
export function useComposerWorkspaceGit(path: string | null | undefined, sessionId: string | undefined, disabled: boolean) {
  const { t } = useTranslation();
  const [git, setGit] = useState<GitWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const owns = useCallback(() => {
    const state = useAppStore.getState();
    const currentPath = state.activeSessionId ? state.sessions.find(item => item.id === state.activeSessionId)?.projectPath : state.workspace?.path;
    return mounted.current && state.activeSessionId === sessionId && normalizeProjectPath(currentPath) === normalizeProjectPath(path);
  }, [path, sessionId]);
  const request = useCallback(() => ({ projectPath: path!, ...(sessionId ? { sessionId } : {}) }), [path, sessionId]);
  const reload = useCallback(async () => {
    if (!path || disabled || inFlight.current) return;
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getWorkspaceGit(request());
      if (owns() && generation.current === version) setGit(result.git);
    } catch (cause) {
      if (owns() && generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (owns() && generation.current === version) setLoading(false);
    }
  }, [path, disabled, request, owns]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current++; };
  }, [reload]);

  const navigate = async (targetRoot: string) => {
    const target = git && projectPathInCheckout(git, targetRoot);
    if (!target) throw new Error(t("errors.workspaceActivationFailed"));
    if (!owns() || disabled) return;
    await useAppStore.getState().newSession({ projectPath: target });
  };
  const mutate = async (branch: string, action: "switch" | "branch" | "worktree") => {
    if (!git || disabled || inFlight.current || !owns()) return;
    inFlight.current = true;
    ++generation.current;
    setLoading(false);
    setBusy(true);
    setError(null);
    const input = { ...request(), branch, expectedHead: git.head, expectedBranch: git.branch };
    try {
      if (action === "worktree") {
        const result = await api.createWorkspaceWorktree(input);
        if (owns()) await navigate(result.worktree.path);
      } else {
        const result = await (action === "switch" ? api.switchWorkspaceBranch(input) : api.createWorkspaceBranch(input));
        if (owns()) {
          setGit(result.git);
          const matches = (target: string) => normalizeProjectPath(target) === normalizeProjectPath(path);
          useAppStore.setState(state => ({
            workspace: state.workspace && matches(state.workspace.path) ? { ...state.workspace, branch: result.git.branch ?? undefined } : state.workspace,
            openProjects: state.openProjects.map(project => matches(project.path) ? { ...project, branch: result.git.branch ?? undefined } : project),
          }));
        }
      }
    } catch (cause) {
      if (owns()) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
    } finally {
      inFlight.current = false;
      if (owns()) setBusy(false);
    }
  };
  return {
    git, loading, busy, error, onReload: () => { void reload(); },
    onSwitch: (branch: string) => mutate(branch, "switch"),
    onCreate: (branch: string) => mutate(branch, "branch"),
    onCreateWorktree: (branch: string) => mutate(branch, "worktree"),
    onLocal: async () => { if (git?.isWorktree) await navigate(git.mainPath); },
    onWorktree: async (target: string) => {
      if (git?.worktrees.some(tree => tree.managed && normalizeProjectPath(tree.path) === normalizeProjectPath(target))) await navigate(target);
    },
  };
}
