import { useAppStore } from "../../../stores/app-store";
import { teamWorkPanelTab, type TeamWorkPanelTarget, type WorkPanelTab } from "../../../lib/work-panel-tabs";
import { TeamPanel } from "../TeamPanel";
import { TeamPanoramaTab } from "./TeamPanoramaTab";

export function TeamWorkPanelSurface({ tab, fallbackTeamSessionId, onSelectSession }: {
  tab: WorkPanelTab;
  fallbackTeamSessionId: string;
  onSelectSession?: (sessionId: string) => void;
}) {
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const openWorkPanelTabForSession = useAppStore((state) => state.openWorkPanelTabForSession);
  const teamSessionId = tab.resource ?? fallbackTeamSessionId;
  const open = (target: TeamWorkPanelTarget, label?: string) => {
    if (activeSessionId) openWorkPanelTabForSession(activeSessionId, teamWorkPanelTab(teamSessionId, target, label));
  };
  if (tab.teamTarget?.kind === "panorama") return <TeamPanoramaTab teamSessionId={teamSessionId} />;
  return (
    <TeamPanel teamSessionId={teamSessionId} navigationSeq={tab.teamNavigationSeq}
      onSelectSession={onSelectSession} onOpenPanorama={() => open({ kind: "panorama" })}
      onOpenTask={(taskId, subject) => open({ kind: "task", taskId }, subject)}
      initialTaskId={tab.teamTarget?.kind === "task" ? tab.teamTarget.taskId : undefined}
      initialMemberSessionId={tab.teamTarget?.kind === "member" ? tab.teamTarget.memberSessionId : undefined}
      initialView={tab.teamTarget?.kind === "board" ? "board" : "aggregate"} />
  );
}
