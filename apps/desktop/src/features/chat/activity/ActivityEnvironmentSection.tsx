import { useTranslation } from "react-i18next";
import { IconBranch, IconFolder } from "../../../components/icons";
import { Tooltip } from "../../../components/ui";
import { ActivityRailGroup } from "./ActivityRailGroup";
import type { ActivityEnvironment } from "./activity-rail-types";
import { shortProjectPath } from "./activity-workspace-view";
import "./session-activity-workspace.css";

/** The project the session runs in and its git branch. Read-only: the composer's workspace menu is where either changes. */
export function ActivityEnvironmentSection({ sessionId, environment }: { sessionId: string; environment: ActivityEnvironment }) {
  const { t } = useTranslation();
  return <ActivityRailGroup sessionId={sessionId} group="environment" sectionHeading trackAttention={false}
    label={t("panel.activity.environment")} collapsedSummary={environment.name}>
    <div className="session-activity-row-shell">
      <Tooltip label={environment.path} className="session-activity-row session-activity-readonly">
        <span className="session-activity-icon" aria-hidden><IconFolder size={16} /></span>
        <span className="session-activity-two">
          <span className="session-activity-label">{environment.name}</span>
          <span className="session-activity-caption">{shortProjectPath(environment.path)}</span>
        </span>
      </Tooltip>
    </div>
    {environment.branch && <div className="session-activity-row-shell">
      <Tooltip label={`${t("panel.activity.environmentBranch")} · ${environment.branch}`} className="session-activity-row session-activity-readonly">
        <span className="session-activity-icon"><IconBranch size={16} role="img" aria-label={t("panel.activity.environmentBranch")} /></span>
        <span className="session-activity-label">{environment.branch}</span>
      </Tooltip>
    </div>}
  </ActivityRailGroup>;
}
