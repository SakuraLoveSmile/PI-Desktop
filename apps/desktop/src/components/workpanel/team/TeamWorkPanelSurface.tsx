import { useAppStore } from "../../../stores/app-store";
import { teamWorkPanelTab, type TeamWorkPanelTarget, type WorkPanelTab } from "../../../lib/work-panel-tabs";
import { TeamPanel } from "../TeamPanel";
import "../../../styles/team-work-tab.css";
import { TeamTaskTab } from "./TeamTaskTab";
import { TeamMemberTab } from "./TeamMemberTab";
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
  if (tab.teamTarget?.kind === "task" && tab.teamTarget.taskId) return <TeamTaskTab key={tab.id} teamSessionId={teamSessionId}
    taskId={tab.teamTarget.taskId} taskLabel={tab.label} onSelectSession={onSelectSession}
    onOpenMember={(memberSessionId, label) => open({ kind: "member", memberSessionId }, label)} />;
  if (tab.teamTarget?.kind === "member" && tab.teamTarget.memberSessionId) return <TeamMemberTab key={tab.id} teamSessionId={teamSessionId}
    memberSessionId={tab.teamTarget.memberSessionId} onSelectSession={onSelectSession}
    onOpenTask={(taskId, subject) => open({ kind: "task", taskId }, subject)} />;
  return (
    <TeamPanel teamSessionId={teamSessionId} navigationSeq={tab.teamNavigationSeq}
      onSelectSession={onSelectSession} onOpenPanorama={() => open({ kind: "panorama" })}
      onOpenTask={(taskId, subject) => open({ kind: "task", taskId }, subject)}
      initialView={tab.teamTarget?.kind === "board" ? "board" : "aggregate"} />
  );
}
