import { Button } from "../../../components/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanProposal, UiMessage } from "@pi-desktop/shared";
import { useAppStore } from "../../../stores/app-store";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { localTeamSessionId } from "../../../lib/team-presentation";
import { resolvePlanArtifactPath } from "../../../lib/plan-artifact";
import { browserPluginTab, fileWorkPanelTab, subagentWorkPanelTab, teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { activityPlans, activityResources, activitySubagents } from "./session-activity-model";
import { SessionActivityRail, type ActivityRailItem } from "./SessionActivityRail";
import { BackgroundProcessDetails } from "./BackgroundProcessDetails";
import { SessionSkillSuggestions } from "./SessionSkillSuggestions";
import { useBackgroundProcessList } from "./use-background-process-list";

const EMPTY_HISTORY: PlanProposal[] = [];

/** A retained pane owns its data, navigation callbacks, disclosure and drafts. */
export function SessionActivity({ sessionId, messages, visible, rangeLimited }: {
  sessionId: string; messages: UiMessage[]; visible: boolean; rangeLimited: boolean;
}) {
  const { t } = useTranslation();
  const session = useAppStore((state) => state.sessions.find((item) => item.id === sessionId));
  const running = useAppStore((state) => state.runningSessions[sessionId] ?? false);
  const pending = useAppStore((state) => state.pendingPlans[sessionId]);
  const checkpoint = useAppStore((state) => state.planCheckpoints[sessionId]);
  const history = useAppStore((state) => state.planHistory[sessionId] ?? EMPTY_HISTORY);
  const open = useAppStore((state) => state.openWorkPanelTabForSession);
  const showToast = useAppStore((state) => state.showToast);
  const supported = Boolean(session && (session.source ?? "desktop") === "desktop" && !sessionId.startsWith("remote:") && !sessionId.startsWith("native-pi:"));
  const teamId = localTeamSessionId(session);
  const team = useTeamSnapshot(teamId, { enabled: visible && supported && Boolean(teamId) });
  const processes = useBackgroundProcessList(sessionId, visible && supported);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const plans = useMemo(() => activityPlans(sessionId, pending, checkpoint, history), [sessionId, pending, checkpoint, history]);
  const resources = useMemo(() => activityResources(messages), [messages]);
  const subagents = useMemo(() => activitySubagents(messages, running), [messages, running]);
  const planRows: ActivityRailItem[] = plans.map((proposal) => ({
    id: proposal.id, label: proposal.title.trim() || proposal.question.trim() || proposal.kind,
    status: proposal.executionState ?? proposal.status,
    statusLabel: t(`panel.overview.status.${proposal.executionState ?? proposal.status}`),
    ...(proposal.artifact?.relativePath ? { onOpen: () => {
      void resolvePlanArtifactPath(proposal).then((resolved) => {
        if (resolved) open(sessionId, fileWorkPanelTab(resolved.path));
      }).catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error), { variant: "error" }));
    } } : {}),
  }));
  const agents: ActivityRailItem[] = subagents.map((agent) => ({
    id: agent.delegationId, label: agent.agentName || t("chat.subagentUnnamed"), detail: agent.task,
    status: agent.status, statusLabel: t(`panel.activity.status.${agent.status}`),
    timing: agent.timing,
    onOpen: () => open(sessionId, subagentWorkPanelTab(agent.delegationId, agent.agentName || t("chat.subagentUnnamed"))),
  }));
  if (teamId && team.snapshot) for (const member of team.snapshot.members) {
    if (member.memberSessionId === sessionId) continue;
    agents.push({ id: `team:${member.memberSessionId}`, label: member.presentation?.displayName || member.name,
      detail: member.presentation ? t(`team.roles.${member.presentation.role}`) : member.description, status: member.phase,
      statusLabel: t(`team.phase.${member.phase}`),
      onOpen: () => open(sessionId, teamWorkPanelTab(teamId, { kind: "member", memberSessionId: member.memberSessionId })),
    });
  }
  const outputRows: ActivityRailItem[] = [
    ...resources.changedFiles.map((item) => ({ ...item, id: `change:${item.id}` })),
    ...resources.attachments.map((item) => ({ ...item, id: `attachment:${item.id}` })),
  ].map((item) => {
    const path = item.path;
    return { id: item.id, label: item.label, path,
      ...(path ? { onOpen: () => open(sessionId, fileWorkPanelTab(path)) } : {}),
    };
  });
  outputRows.push(...planRows.filter((item) => item.onOpen).map((item) => ({ ...item, path: plans.find((plan) => plan.id === item.id)?.artifact?.relativePath })));
  const skillReferences = [
    ...resources.references.skills.map((item) => ({ id: `skill:${item.id}`, label: item.label, kind: "skill" as const })),
    ...resources.references.mcp.map((item) => ({ id: `mcp:${item.id}`, label: item.label, kind: "mcp" as const })),
  ];
  const sources: ActivityRailItem[] = [
    ...resources.websites.map((item) => ({ id: item.id, label: item.label, onOpen: () => open(sessionId, browserPluginTab(item.url)) })),
  ];
  return <SessionActivityRail sessionId={sessionId} visible={visible} plans={planRows} agents={agents}
    outputs={outputRows} sources={sources} processes={processes.processes} processesLoading={processes.loading}
    processesError={processes.error} onRefreshProcesses={processes.refresh} onOpenProcess={setSelectedProcess}
    agentsNotice={team.error ? <div role="alert" className="session-activity-error">
      <p>{t("team.staleData")}: {team.error}</p><Button variant="ghost" size="sm" onClick={() => void team.refresh()}>{t("panel.activity.retry")}</Button>
    </div> : team.loading && !team.snapshot ? <p role="status" className="session-activity-empty">{t("panel.activity.loading")}</p> : undefined}
    supported={supported} rangeLimited={rangeLimited}
    processDetails={selectedProcess ? <BackgroundProcessDetails key={selectedProcess} sessionId={sessionId} id={selectedProcess}
      visible={visible} onClose={() => setSelectedProcess(null)} /> : null}
    suggestions={<SessionSkillSuggestions sessionId={sessionId} messages={messages} references={skillReferences} visible={visible} supported={supported} rangeLimited={rangeLimited} />} />;
}
