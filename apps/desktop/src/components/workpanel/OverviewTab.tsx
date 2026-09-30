import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanProposal, TeamMemberRecord, TeamTaskRecord, UiMessage } from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { IconBot, IconFileText, IconInfo, IconUsers } from "../icons";
import { fileWorkPanelTab, teamWorkPanelTab } from "../../lib/work-panel-tabs";
import { resolvePlanArtifactPath } from "../../lib/plan-artifact";
import { isDelegationStartTool } from "../../lib/tool-display";
import { delegationIdForMessage } from "../../lib/subagent-panel";
import {
  collectDelegationStatuses,
  subagentOutcome,
  type SubagentOutcome,
} from "../../lib/subagent-topology";
import { delegateAgentName } from "../../features/chat/transcript/model";
import { delegateTaskDescription } from "../../lib/subagent-transcript";
import { api } from "../../lib/api";

type OverviewItem = {
  id: string;
  label: string;
  path?: string;
  detail?: string;
  proposal?: PlanProposal;
};

type TeamOverviewData = {
  members: TeamMemberRecord[];
  tasks: TeamTaskRecord[];
  paused: boolean;
};

function proposalLabel(proposal: PlanProposal): string {
  return proposal.title.trim() || proposal.question.trim() || proposal.kind;
}

function proposalStatus(proposal: PlanProposal): string {
  if (proposal.executionState) return proposal.executionState;
  return proposal.status;
}

function messageReferences(messages: UiMessage[]): OverviewItem[] {
  const items: OverviewItem[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      const id = `${message.id}:${attachment.ref}`;
      if (items.some((item) => item.id === id)) continue;
      items.push({ id, label: attachment.name || attachment.ref, path: attachment.ref });
    }
  }
  return items;
}

export function OverviewTab() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const providers = useAppStore((state) => state.providers);
  const messages = useAppStore((state) => state.messages);
  const pendingPlans = useAppStore((state) => state.pendingPlans);
  const planCheckpoints = useAppStore((state) => state.planCheckpoints);
  const planHistory = useAppStore((state) => state.planHistory);
  const planningStates = useAppStore((state) => state.planningStates);
  const runningSessions = useAppStore((state) => state.runningSessions);
  const sessionOutcomes = useAppStore((state) => state.sessionOutcomes);
  const openFileInWorkPanel = useAppStore((state) => state.openFileInWorkPanel);
  const openSubagentTab = useAppStore((state) => state.openSubagentTab);
  const openWorkPanelTabForSession = useAppStore((state) => state.openWorkPanelTabForSession);
  const showToast = useAppStore((state) => state.showToast);

  const session = sessions.find((candidate) => candidate.id === activeSessionId);
  const proposals = useMemo(() => {
    if (!activeSessionId) return [];
    const candidates = [
      pendingPlans[activeSessionId],
      planCheckpoints[activeSessionId],
      ...(planHistory[activeSessionId] ?? []),
    ];
    const seen = new Set<string>();
    return candidates.filter((proposal): proposal is PlanProposal => {
      if (!proposal || seen.has(proposal.id)) return false;
      seen.add(proposal.id);
      return true;
    });
  }, [activeSessionId, pendingPlans, planCheckpoints, planHistory]);

  const artifactItems = useMemo<OverviewItem[]>(() => {
    const items: OverviewItem[] = [];
    for (const proposal of proposals) {
      const artifact = proposal.artifact;
      if (!artifact?.relativePath) continue;
      items.push({
        id: `proposal:${proposal.id}`,
        label: artifact.relativePath,
        path: artifact.relativePath,
        detail: proposalLabel(proposal),
        proposal,
      });
    }
    for (const item of messageReferences(messages)) {
      if (item.path && items.some((candidate) => candidate.path === item.path)) continue;
      items.push(item);
    }
    return items;
  }, [messages, proposals]);

  const references = useMemo(() => messageReferences(messages), [messages]);
  const openItem = async (item: OverviewItem) => {
    if (!item.path) return;
    if (!item.proposal) {
      openFileInWorkPanel(item.path);
      return;
    }
    try {
      const resolved = await resolvePlanArtifactPath(item.proposal);
      if (!resolved) return;
      openWorkPanelTabForSession(
        item.proposal.sessionId,
        fileWorkPanelTab(resolved.path),
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  };
  const planningState = activeSessionId ? planningStates[activeSessionId] : undefined;
  const outcome = activeSessionId ? sessionOutcomes[activeSessionId] : undefined;
  const running = activeSessionId ? runningSessions[activeSessionId] === true : false;

  const isTeam = session?.executionProfile === "team";
  const [teamData, setTeamData] = useState<TeamOverviewData | null>(null);

  useEffect(() => {
    if (!isTeam || !activeSessionId) {
      setTeamData(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      api.getTeamRoster(activeSessionId) as Promise<{
        teamSessionId: string;
        paused: boolean;
        members: TeamMemberRecord[];
      }>,
      api.getTeamBoard(activeSessionId) as Promise<{
        teamSessionId: string;
        tasks: TeamTaskRecord[];
      }>,
    ])
      .then(([roster, board]) => {
        if (!cancelled && roster.teamSessionId === activeSessionId) {
          setTeamData({
            members: roster.members,
            tasks: board.tasks.filter((t) => !t.deleted),
            paused: roster.paused,
          });
        }
      })
      .catch(() => {
        // Silently tolerate overview team polling errors
      });
    return () => {
      cancelled = true;
    };
  }, [isTeam, activeSessionId]);

  const subagents = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    const seen = new Set<string>();
    const list: {
      delegationId: string;
      agentName: string;
      task: string;
      status: SubagentOutcome;
    }[] = [];

    const statuses = collectDelegationStatuses(
      messages
        .filter((m) => m.role === "tool")
        .map((m) => ({ kind: "tool" as const, message: m })),
      { turnLive: running },
    );

    for (const m of messages) {
      if (m.role === "tool" && isDelegationStartTool(m.toolName)) {
        const delegationId = delegationIdForMessage(m);
        if (seen.has(delegationId)) continue;
        seen.add(delegationId);
        const agent = delegateAgentName(m);
        const task = delegateTaskDescription(m);
        const status = subagentOutcome(m, statuses);
        list.push({
          delegationId,
          agentName: agent || t("chat.subagentUnnamed"),
          task,
          status,
        });
      }
    }
    return list;
  }, [messages, running, t]);

  if (!session) {
    return (
      <div className="work-panel-overview work-panel-overview-empty" data-testid="overview-tab">
        <IconInfo size={22} aria-hidden />
        <p>{t("panel.overview.noSession")}</p>
      </div>
    );
  }

  const providerName = providers.find((provider) => provider.id === session.providerId)?.name ?? session.providerId;
  const model = [providerName, session.modelId].filter(Boolean).join(" / ");
  const mode = t(`panel.overview.mode.${session.mode}`, { defaultValue: session.mode });
  const status = running
    ? "running"
    : planningState && planningState !== "inactive"
      ? planningState
      : outcome ?? "idle";

  return (
    <div className="work-panel-overview" data-testid="overview-tab">
      <header className="work-panel-overview-header">
        <div className="work-panel-overview-icon" aria-hidden>
          <IconInfo size={18} />
        </div>
        <div className="work-panel-overview-heading">
          <h2>{session.title || t("panel.overview.untitled")}</h2>
          <dl className="work-panel-overview-meta">
            <div><dt>{t("panel.overview.project")}</dt><dd>{session.projectPath || t("panel.overview.notAvailable")}</dd></div>
            <div><dt>{t("panel.overview.model")}</dt><dd>{model || t("panel.overview.notAvailable")}</dd></div>
            <div><dt>{t("panel.overview.modeLabel")}</dt><dd>{mode}</dd></div>
            <div><dt>{t("panel.overview.messages")}</dt><dd>{session.messageCount}</dd></div>
          </dl>
        </div>
      </header>

      <div className="work-panel-overview-scroll">
        {isTeam && (
          <details className="work-panel-overview-section" open>
            <summary>{t("panel.overview.teamSection")}</summary>
            <div className="work-panel-overview-section-body">
              <div className="work-panel-overview-team-card">
                <div className="work-panel-overview-row">
                  <span className="work-panel-overview-row-label">
                    <IconUsers size={14} aria-hidden />
                    <span>{t("team.lead")}</span>
                  </span>
                  <span className={`team-status-badge ${teamData?.paused ? "team-status-paused" : "team-status-active"}`}>
                    {teamData?.paused ? t("team.pausedBadge") : t("team.activeBadge")}
                  </span>
                </div>
                {teamData ? (
                  <>
                    <div className="work-panel-overview-row">
                      <span className="work-panel-overview-row-label">
                        {t("team.membersCount", { count: teamData.members.length })}
                      </span>
                      <span className="work-panel-overview-row-detail">
                        {t("team.tasksProgress", {
                          completed: teamData.tasks.filter((task) => task.status === "completed").length,
                          total: teamData.tasks.length,
                        })}
                      </span>
                    </div>
                  </>
                ) : null}
                <div className="work-panel-overview-team-action">
                  <button
                    type="button"
                    className="work-panel-overview-action-btn"
                    onClick={() =>
                      openWorkPanelTabForSession(session.id, teamWorkPanelTab(session.id))
                    }
                  >
                    {t("team.viewTeam")}
                  </button>
                </div>
              </div>
            </div>
          </details>
        )}

        <details className="work-panel-overview-section" open>
          <summary>{t("panel.overview.subagents")}</summary>
          <div className="work-panel-overview-section-body">
            {subagents.length > 0 ? (
              subagents.map((sub) => (
                <button
                  className="work-panel-overview-file work-panel-overview-subagent-row"
                  key={sub.delegationId}
                  type="button"
                  title={sub.task || sub.agentName}
                  onClick={() => openSubagentTab(sub.delegationId, sub.agentName)}
                >
                  <IconBot size={15} aria-hidden />
                  <span className="work-panel-overview-file-copy">
                    <span className="work-panel-overview-file-label">{sub.agentName}</span>
                    {sub.task && <span className="work-panel-overview-file-detail">{sub.task}</span>}
                  </span>
                  <span className={`team-badge team-phase-${sub.status === "completed" ? "completed" : sub.status === "running" ? "running" : "failed"}`}>
                    {sub.status}
                  </span>
                </button>
              ))
            ) : (
              <p className="work-panel-overview-empty-copy">{t("panel.overview.noSubagents")}</p>
            )}
          </div>
        </details>

        <details className="work-panel-overview-section" open>
          <summary>{t("panel.overview.progress")}</summary>
          <div className="work-panel-overview-section-body">
            <div className="work-panel-overview-status">
              <span>{t("panel.overview.statusLabel")}</span>
              <strong>{t(`panel.overview.status.${status}`, { defaultValue: status })}</strong>
            </div>
            {proposals.length > 0 ? proposals.map((proposal) => (
              <div className="work-panel-overview-row" key={proposal.id}>
                <span className="work-panel-overview-row-label">{proposalLabel(proposal)}</span>
                <span className="work-panel-overview-row-detail">
                  {t(`panel.overview.status.${proposalStatus(proposal)}`, { defaultValue: proposalStatus(proposal) })}
                </span>
              </div>
            )) : (
              <p className="work-panel-overview-empty-copy">{t("panel.overview.noPlans")}</p>
            )}
          </div>
        </details>

        <details className="work-panel-overview-section" open>
          <summary>{t("panel.overview.artifacts")}</summary>
          <div className="work-panel-overview-section-body">
            {artifactItems.length > 0 ? artifactItems.map((item) => (
              <button
                className="work-panel-overview-file"
                key={item.id}
                type="button"
                title={item.path ?? item.label}
                onClick={() => void openItem(item)}
                disabled={!item.path}
              >
                <IconFileText size={15} aria-hidden />
                <span className="work-panel-overview-file-copy">
                  <span className="work-panel-overview-file-label">{item.label}</span>
                  {item.detail && <span className="work-panel-overview-file-detail">{item.detail}</span>}
                </span>
              </button>
            )) : (
              <p className="work-panel-overview-empty-copy">{t("panel.overview.noArtifacts")}</p>
            )}
          </div>
        </details>

        <details className="work-panel-overview-section" open>
          <summary>{t("panel.overview.references")}</summary>
          <div className="work-panel-overview-section-body">
            {references.length > 0 ? references.map((reference) => (
              <button
                className="work-panel-overview-reference"
                key={reference.id}
                type="button"
                onClick={() => reference.path && openFileInWorkPanel(reference.path)}
              >
                {reference.label}
              </button>
            )) : (
              <p className="work-panel-overview-empty-copy">{t("panel.overview.noReferences")}</p>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
