import { Button } from "../../../components/ui";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanProposal, UiMessage } from "@pi-desktop/shared";
import { useAppStore } from "../../../stores/app-store";
import { useTranscriptView } from "../../../hooks/use-transcript-view";
import type { GoalActivityReportState } from "../../../stores/runtime/goal-activity-runtime";
import type { ActivityAttentionItem } from "./activity-rail-types";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { localTeamSessionId } from "../../../lib/team-presentation";
import { resolvePlanArtifactPath } from "../../../lib/plan-artifact";
import { browserPluginTab, fileWorkPanelTab, goalReportWorkPanelTab, subagentWorkPanelTab, teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { activityPlans, activityResources, activitySubagents } from "./session-activity-model";
import { SessionActivityRail, type ActivityRailItem } from "./SessionActivityRail";
import { BackgroundProcessDetails } from "./BackgroundProcessDetails";
import { SessionSkillSuggestions } from "./SessionSkillSuggestions";
import { useBackgroundProcessList } from "./use-background-process-list";
import { GoalActivityRow } from "./GoalActivityRow";

const EMPTY_HISTORY: PlanProposal[] = [];
const EMPTY_PERMISSIONS: NonNullable<ReturnType<typeof useAppStore.getState>["pendingPermissions"][string]> = [];

/** A retained pane owns its data, navigation callbacks, disclosure and drafts. */
export function SessionActivity({ sessionId, messages, visible, rangeLimited }: {
  sessionId: string; messages: UiMessage[]; visible: boolean; rangeLimited: boolean;
}) {
  const { t } = useTranslation();
  const transcript = useTranscriptView(sessionId);
  const permissions = useAppStore((state) => state.pendingPermissions[sessionId] ?? EMPTY_PERMISSIONS);
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
  const [reportStates, setReportStates] = useState<Record<string, GoalActivityReportState>>({});
  const onReportStateChange = useCallback((executionId: string, reportState: GoalActivityReportState) => {
    const key = `${sessionId}:${executionId}`;
    setReportStates((current) => current[key] === reportState ? current : { ...current, [key]: reportState });
  }, [sessionId]);
  const plans = useMemo(() => activityPlans(sessionId, pending, checkpoint, history), [sessionId, pending, checkpoint, history]);
  const resources = useMemo(() => activityResources(messages), [messages]);
  const subagents = useMemo(() => activitySubagents(messages, running), [messages, running]);
  const planRows: ActivityRailItem[] = plans.map((proposal) => {
    const onOpen = proposal.artifact?.relativePath ? () => {
      void resolvePlanArtifactPath(proposal).then((resolved) => {
        if (resolved) open(sessionId, fileWorkPanelTab(resolved.path));
      }).catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error), { variant: "error" }));
    } : undefined;
    return {
      id: proposal.id, label: proposal.title.trim() || proposal.question.trim() || proposal.kind,
      status: proposal.executionState ?? proposal.status,
      attentionStatus: reportStates[`${sessionId}:${proposal.executionId}`] === "failed" ? "failed"
        : reportStates[`${sessionId}:${proposal.executionId}`] === "fallback" ? "degraded" : undefined,
      statusLabel: t(`panel.overview.status.${proposal.executionState ?? proposal.status}`),
      ...((proposal.executionKind ?? proposal.kind) === "goal" && proposal.executionId ? {
        content: <GoalActivityRow sessionId={sessionId} proposal={proposal} visible={visible && supported} onOpenArtifact={onOpen} onReportStateChange={onReportStateChange} />,
      } : {}),
      ...(onOpen ? { onOpen } : {}),
    };
  });
  const agents: ActivityRailItem[] = subagents.map((agent) => ({
    id: agent.delegationId, label: agent.agentName || t("chat.subagentUnnamed"), detail: agent.task,
    status: agent.status, statusLabel: t(`panel.activity.status.${agent.status}`),
    timing: agent.timing,
    onOpen: () => open(sessionId, subagentWorkPanelTab(agent.delegationId, agent.agentName || t("chat.subagentUnnamed"))),
  }));
  const teamMembers: ActivityRailItem[] = [];
  if (teamId && team.snapshot) for (const member of team.snapshot.members) {
    if (member.memberSessionId === sessionId) continue;
    teamMembers.push({ id: `team:${member.memberSessionId}`, label: member.presentation?.displayName || member.name,
      detail: member.description, roleLabel: member.presentation ? t(`team.roles.${member.presentation.role}`) : undefined, status: member.phase,
      statusLabel: t(`team.phase.${member.phase}`),
      onOpen: () => open(sessionId, teamWorkPanelTab(teamId, { kind: "member", memberSessionId: member.memberSessionId })),
    });
  }
  const locate = (messageId: string) => () => {
    if (visible && useAppStore.getState().activeSessionId === sessionId) {
      void useAppStore.getState().navigateTranscript({ sessionId, messageId, query: "" });
    }
  };
  const copyPath = (path: string) => () => {
    void navigator.clipboard.writeText(path).then(() => showToast(t("chat.copied"), { variant: "success" }))
      .catch(() => showToast(t("chat.copyFailed"), { variant: "error" }));
  };
  const outputRows: ActivityRailItem[] = [
    ...resources.changedFiles.map((item) => ({ ...item, id: `change:${item.id}` })),
    ...resources.attachments.map((item) => ({ ...item, id: `attachment:${item.id}` })),
  ].map((item) => {
    const path = item.path;
    return { ...item, id: item.id, label: item.label, path,
      ...(path ? { onCopyPath: copyPath(path) } : {}),
      ...("messageId" in item && typeof item.messageId === "string" ? { onLocate: locate(item.messageId) } : {}),
      ...(path ? { onOpen: () => open(sessionId, fileWorkPanelTab(path)) } : {}),
    };
  });
  outputRows.push(...planRows.filter((item) => item.onOpen).map(({ content: _content, attentionStatus: _attentionStatus, ...item }) => ({ ...item, path: plans.find((plan) => plan.id === item.id)?.artifact?.relativePath })));
  const outputByPath = new Map<string, ActivityRailItem>();
  for (const item of outputRows) if (!outputByPath.has(item.path ?? item.id)) outputByPath.set(item.path ?? item.id, item);
  const distinctOutputs = [...outputByPath.values()].map((item) => ({ ...item,
    ...(item.path && !item.onCopyPath ? { onCopyPath: copyPath(item.path) } : {}),
  }));
  const skillReferences = [
    ...resources.references.skills.map((item) => ({ id: `skill:${item.id}`, label: item.label, kind: "skill" as const })),
    ...resources.references.mcp.map((item) => ({ id: `mcp:${item.id}`, label: item.label, kind: "mcp" as const })),
  ];
  const sources: ActivityRailItem[] = [
    ...resources.websites.map((item) => ({ ...item, id: item.id, label: item.domain, detail: [item.label, item.url].join(" · "), onOpen: () => open(sessionId, browserPluginTab(item.url)) })),
  ];
  const revealApproval = (selector: string) => {
    if (!visible || useAppStore.getState().activeSessionId !== sessionId) return;
    useAppStore.getState().returnToLatestTranscript(sessionId);
    requestAnimationFrame(() => {
      if (useAppStore.getState().activeSessionId !== sessionId) return;
      const pane = [...document.querySelectorAll<HTMLElement>(".session-pane")].find((element) => element.dataset.sessionPane === sessionId && element.dataset.visible === "true");
      const card = pane?.querySelector<HTMLElement>(selector);
      card?.scrollIntoView({ block: "center" });
      card?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    });
  };
  const attentionItems: ActivityAttentionItem[] = [];
  if (permissions.length) attentionItems.push({
    id: "pending-approvals", label: t("panel.activity.attentionApprovals", { count: permissions.length }), group: "approvals",
    onOpen: () => revealApproval(".permission-card"),
  });
  if (pending?.status === "pending") attentionItems.push({ id: `approval:${pending.id}`, label: t("panel.activity.attentionPlanApproval", { title: pending.title }), group: "plans", itemId: pending.id, onOpen: () => revealApproval(".plan-approval-bar") });
  for (const proposal of plans) {
    const state = reportStates[`${sessionId}:${proposal.executionId}`];
    if (proposal.executionId && (state === "failed" || state === "fallback")) attentionItems.push({
      id: `report:${proposal.executionId}`, label: t(state === "failed" ? "panel.activity.attentionReportFailed" : "panel.activity.attentionReportFallback", { title: proposal.title }),
      group: "plans", itemId: proposal.id,
      onOpen: () => { if (proposal.executionId) open(sessionId, goalReportWorkPanelTab(proposal.executionId, proposal.title)); },
    });
  }
  return <SessionActivityRail sessionId={sessionId} visible={visible} plans={planRows} agents={agents} teamMembers={teamMembers} attentionItems={attentionItems}
    plansAttentionReady={plans.every((proposal) => (proposal.executionKind ?? proposal.kind) !== "goal" || !proposal.executionId
      || reportStates[`${sessionId}:${proposal.executionId}`] !== undefined)}
    outputs={distinctOutputs} sources={sources} processes={processes.processes} processesLoading={processes.loading}
    processesError={processes.error} onRefreshProcesses={processes.refresh} onOpenProcess={setSelectedProcess}
    showTeamMembers={Boolean(teamId)} teamNotice={team.error ? <div role="alert" className="session-activity-error">
      <p>{t("team.staleData")}: {team.error}</p><Button variant="ghost" size="sm" onClick={() => void team.refresh()}>{t("panel.activity.retry")}</Button>
    </div> : team.loading && !team.snapshot ? <p role="status" className="session-activity-empty">{t("panel.activity.loading")}</p> : undefined}
    supported={supported} rangeLimited={rangeLimited} hasMoreBefore={transcript.hasMoreBefore} historyLoading={transcript.loading}
    onLoadEarlier={() => { if (visible && useAppStore.getState().activeSessionId === sessionId) void useAppStore.getState().loadTranscriptPage(sessionId, "before"); }}
    onReturnToLatest={transcript.historical || transcript.hasMoreAfter ? () => useAppStore.getState().returnToLatestTranscript(sessionId) : undefined}
    processDetails={selectedProcess ? <BackgroundProcessDetails key={selectedProcess} sessionId={sessionId} id={selectedProcess}
      visible={visible} onClose={() => setSelectedProcess(null)} /> : null}
    suggestions={<SessionSkillSuggestions sessionId={sessionId} messages={messages} references={skillReferences} visible={visible} supported={supported} rangeLimited={rangeLimited} />} />;
}
