import type { TFunction } from "i18next";
import { useState } from "react";
import { IconChevronDown, IconChevronUp } from "../../../components/icons";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";
import { useAppStore } from "../../../stores/app-store";
import { ComposerBranchMenu } from "./ComposerBranchMenu";
import { ComposerLocationMenu } from "./ComposerLocationMenu";
import { ComposerProjectMenu } from "./ComposerProjectMenu";
import {
  initialTopStripState,
  syncTopStripState,
  toggleTopStrip,
  topStripExpanded,
} from "./composer-top-strip-state";
import { useComposerWorkspaceGit } from "./hooks/useComposerWorkspaceGit";

/** Workspace strip above the input card: project, location and branch while idle, the branch alone during a run. */
export function ComposerWorkspaceContext({ t, running }: { t: TFunction; running: boolean }) {
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
  return <ComposerWorkspaceControls key={`${sessionId ?? "home"}:${path ?? ""}`} t={t} running={running} path={path} name={name} sessionId={sessionId} remote={remote} disabled={disabled} />;
}

function ComposerWorkspaceControls({ t, running, path, name, sessionId, remote, disabled }: {
  t: TFunction; running: boolean; path?: string | null; name?: string | null; sessionId: string | undefined; remote: boolean; disabled: boolean;
}) {
  const controller = useComposerWorkspaceGit(path, sessionId, disabled);
  // Menus lock while any session in this project runs, which is wider than this strip's run.
  const projectRunning = useAppStore(s => s.sessions.some(session => session.projectPath && normalizeProjectPath(session.projectPath) === normalizeProjectPath(path) && s.runningSessions[session.id]));
  const [stored, setStored] = useState(() => initialTopStripState(running));
  const strip = syncTopStripState(stored, running);
  if (strip !== stored) setStored(strip);
  const expanded = topStripExpanded(strip);
  const common = { ...controller, disabled: disabled || projectRunning };
  return <div className="composer-top-strip" data-expanded={expanded ? "true" : "false"}>
    <div className="composer-workspace-context">
      {expanded ? <ComposerProjectMenu path={path} name={name} disabled={disabled} /> : null}
      {expanded ? <ComposerLocationMenu {...common} remote={remote} /> : null}
      {path && !remote && <ComposerBranchMenu {...common} />}
    </div>
    {running ? <button
      type="button"
      className="composer-top-strip-toggle"
      aria-expanded={expanded}
      aria-label={expanded ? t("chat.topStripCollapse") : t("chat.topStripExpand")}
      onClick={() => setStored(toggleTopStrip(strip))}
    >
      {expanded ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />}
    </button> : null}
  </div>;
}
