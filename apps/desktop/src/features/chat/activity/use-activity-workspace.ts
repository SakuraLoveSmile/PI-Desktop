import { useEffect, useMemo, useRef } from "react";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";
import { latestTurnContextInspector, type LatestTurnContextInspector } from "../../../lib/latest-turn-context";
import { EMPTY_TRANSCRIPT } from "../../../lib/transcript-reading";
import { reviewChangesFromMessages, summarizeReviewChanges } from "../../../lib/workspace-review";
import { useAppStore } from "../../../stores/app-store";
import { useComposerWorkspaceGit } from "../composer/hooks/useComposerWorkspaceGit";
import type { ActivityChanges, ActivityEnvironment } from "./activity-rail-types";
import { projectFolderName } from "./activity-workspace-view";

/**
 * What the rail mirrors of the workspace: the project and its branch, the changes the Review tab lists and the newest
 * context usage. Each comes from the source the composer or the Review tab reads, and only the visible pane reads it.
 * The branch snapshot is Host-owned and comes from the composer's own hook, so a snapshot of another project is dropped.
 */
export function useActivityWorkspace({ sessionId, visible, supported }: { sessionId: string; visible: boolean; supported: boolean }): {
  environment?: ActivityEnvironment; changes?: ActivityChanges; context?: LatestTurnContextInspector;
} {
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const live = useAppStore((state) => (visible && state.activeSessionId === sessionId ? state.messages : EMPTY_TRANSCRIPT));
  const providerModels = useAppStore((state) => state.providerModels);
  const providers = useAppStore((state) => state.providers);
  const compactions = useAppStore((state) => state.sessionCompactions[sessionId]);
  const projectPath = session?.projectPath ?? undefined;
  const git = useComposerWorkspaceGit(projectPath, sessionId, !visible || !supported || !projectPath);
  // The composer's branch menu writes the new branch into the store; the snapshot here is read again when it does.
  const storedBranch = useAppStore((state) => {
    const same = (path?: string | null) => normalizeProjectPath(path) === normalizeProjectPath(projectPath);
    return same(state.workspace?.path) ? state.workspace?.branch : state.openProjects.find((project) => same(project.path))?.branch;
  });
  const reload = useRef(git.onReload);
  reload.current = git.onReload;
  const seenBranch = useRef(storedBranch);
  useEffect(() => {
    if (seenBranch.current === storedBranch) return;
    seenBranch.current = storedBranch;
    if (visible) reload.current();
  }, [storedBranch, visible]);

  const snapshot = git.git && projectPath && normalizeProjectPath(git.git.projectPath) === normalizeProjectPath(projectPath) ? git.git : null;
  const environment: ActivityEnvironment | undefined = snapshot && projectPath
    ? { name: session?.projectName?.trim() || projectFolderName(projectPath), path: projectPath, branch: snapshot.branch } : undefined;
  const changes = useMemo<ActivityChanges | undefined>(() => {
    if (live === EMPTY_TRANSCRIPT) return undefined;
    const summary = summarizeReviewChanges(reviewChangesFromMessages(live));
    return summary.changeCount > 0 ? { count: summary.changeCount, additions: summary.additions, deletions: summary.deletions } : undefined;
  }, [live]);
  const context = useMemo(
    () => (live === EMPTY_TRANSCRIPT ? undefined : latestTurnContextInspector(live, providerModels, providers, compactions)),
    [live, providerModels, providers, compactions],
  );
  return { environment, changes, context };
}
