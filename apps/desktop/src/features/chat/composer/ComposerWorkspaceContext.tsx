import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";
import { useAppStore } from "../../../stores/app-store";
import { ComposerBranchMenu } from "./ComposerBranchMenu";
import { ComposerLocationMenu } from "./ComposerLocationMenu";
import { ComposerProjectMenu } from "./ComposerProjectMenu";
import { useComposerWorkspaceGit } from "./hooks/useComposerWorkspaceGit";

export function ComposerWorkspaceContext() {
  const sessionId = useAppStore(s => s.activeSessionId);
  const session = useAppStore(s => s.sessions.find(item => item.id === s.activeSessionId));
  const workspace = useAppStore(s => s.workspace);
  const projects = useAppStore(s => s.openProjects);
  const path = sessionId ? session?.projectPath : workspace?.path;
  const remote = session?.source === "remote";
  const disabled = Boolean((session?.source && session.source !== "desktop") || session?.team?.role === "member");
  const project = !remote && path ? [workspace, ...projects].find(item => item && normalizeProjectPath(item.path) === normalizeProjectPath(path)) : undefined;
  const name = session?.projectName || project?.name || path?.replace(/[\\/]$/, "").split(/[\\/]/).at(-1);
  // Remount scoped menus and requests when their session/directory owner changes.
  return <ComposerWorkspaceControls key={`${sessionId ?? "home"}:${path ?? ""}`} path={path} name={name} sessionId={sessionId} remote={remote} disabled={disabled} />;
}

function ComposerWorkspaceControls({ path, name, sessionId, remote, disabled }: {
  path?: string | null; name?: string | null; sessionId: string | undefined; remote: boolean; disabled: boolean;
}) {
  const controller = useComposerWorkspaceGit(path, sessionId, disabled);
  const running = useAppStore(s => s.sessions.some(session => session.projectPath && normalizeProjectPath(session.projectPath) === normalizeProjectPath(path) && s.runningSessions[session.id]));
  const common = { ...controller, disabled: disabled || running };
  return <div className="composer-workspace-context">
    <ComposerProjectMenu path={path} name={name} disabled={disabled} />
    <ComposerLocationMenu {...common} remote={remote} />
    {path && !remote && <ComposerBranchMenu {...common} />}
  </div>;
}
