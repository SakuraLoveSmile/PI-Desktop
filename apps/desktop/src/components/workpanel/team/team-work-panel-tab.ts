import type { WorkPanelTab } from "../../../lib/work-panel-tabs";
import { IconMessageCircle, IconUsers } from "../../icons";

export function teamTabLabel(tab: WorkPanelTab, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (tab.teamTarget?.kind) {
    case "panorama": return t("team.teamPanoramaTitle");
    case "task": return tab.label ? t("team.adHocTaskTitle", { subject: tab.label }) : t("panel.tabs.team");
    case "member": return tab.label ?? t("panel.tabs.team");
    default: return t("panel.tabs.team");
  }
}

export function teamTabIcon(tab: WorkPanelTab) {
  return tab.teamTarget?.kind === "task" || tab.teamTarget?.kind === "member" ? IconMessageCircle : IconUsers;
}
