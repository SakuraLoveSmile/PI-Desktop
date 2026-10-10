import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/app-store";
import { IconFolderOpen, IconMonitor, IconBranch } from "../../../components/icons";
import { Tooltip } from "../../../components/ui";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";

export function ComposerWorkspaceContext() {
  const { t } = useTranslation();
  const session = useAppStore((s) => s.sessions.find((item) => item.id === s.activeSessionId));
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workspace = useAppStore((s) => s.workspace);
  const projects = useAppStore((s) => s.openProjects);
  const remote = session?.source === "remote";
  const path = activeSessionId ? session?.projectPath : workspace?.path;
  const project = !remote && path ? [workspace, ...projects].find((item) =>
    item && normalizeProjectPath(item.path) === normalizeProjectPath(path)) : undefined;
  const name = session?.projectName || project?.name || path?.replace(/[\\/]$/, "").split(/[\\/]/).at(-1);
  return <div className="composer-workspace-context">
    {name && <Tooltip label={path || name} className="composer-workspace-item"><IconFolderOpen size={14} /><span>{name}</span></Tooltip>}
    <span className="composer-workspace-item"><IconMonitor size={14} /><span>{t(remote ? "chat.workspaceRemote" : "chat.workspaceLocal")}</span></span>
    {project?.branch && <Tooltip label={project.branch} className="composer-workspace-item"><IconBranch size={14} /><span>{project.branch}</span></Tooltip>}
  </div>;
}
