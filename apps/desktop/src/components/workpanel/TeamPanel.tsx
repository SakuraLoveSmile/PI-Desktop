import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TeamExecutionDecision,
  TeamLaunchReview,
  TeamMemberRecord,
  TeamTaskRecord,
  UiMessage,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { TeamLaunchReviewPanel } from "./TeamLaunchReviewPanel";
import {
  IconChevronLeft,
  IconCircleAlert,
  IconRefresh,
  IconTriangleAlert,
  IconUsers,
  IconWorkflow,
} from "../icons";
import { Button, TooltipButton } from "../ui";
import { TranscriptDisclosureProvider } from "../../features/chat/transcript/disclosure";
import { ToolRow } from "../../features/chat/transcript/ToolRow";
import { Markdown } from "../Markdown";
import { AssistantErrorMessage } from "../../features/chat/transcript/shared";
import { ReviewChangeCard } from "../ReviewChangeCard";
import "../../styles/team-panel.css";
import { AgentPanorama, type PanoramaNode, type PanoramaNodeStatus } from "./AgentPanorama";

type TeamRosterSnapshot = {
  teamSessionId: string;
  revision: number;
  paused: boolean;
  members: TeamMemberRecord[];
};

type TeamTaskReadiness = {
  taskId: string;
  isReady: boolean;
  unresolvedBlockedBy: string[];
};

type TeamScopeOverlap = { scope: string; taskIds: string[] };

type TeamBoardSnapshot = {
  teamSessionId: string;
  revision: number;
  tasks: TeamTaskRecord[];
  readiness: TeamTaskReadiness[];
  scopeOverlaps: TeamScopeOverlap[];
};

type TeamPanelSnapshot = {
  roster: TeamRosterSnapshot;
  board: TeamBoardSnapshot;
  review?: TeamLaunchReview | null;
  decision?: TeamExecutionDecision | null;
};
type TeamDetailView =
  | { kind: "aggregate" }
  | { kind: "member"; memberSessionId: string }
  | { kind: "task"; taskId: string }
  | { kind: "panorama" };

export type TeamPanelProps = {
  teamSessionId: string;
  onSelectSession?: (sessionId: string) => void;
};

export function TeamPanel({ teamSessionId, onSelectSession }: TeamPanelProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<TeamPanelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TeamDetailView>({ kind: "aggregate" });
  const requestSequenceRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!teamSessionId) return;
    const requestId = ++requestSequenceRef.current;
    try {
      const [roster, board, reviewRes] = await Promise.all([
        api.getTeamRoster(teamSessionId) as unknown as Promise<TeamRosterSnapshot>,
        api.getTeamBoard(teamSessionId) as unknown as Promise<TeamBoardSnapshot>,
        api.getTeamLaunchReview(teamSessionId).catch(() => ({ review: null })),
      ]);
      const review = reviewRes?.review ?? null;
      let decision: TeamExecutionDecision | null = null;
      if (review?.leadTurnId) {
        const decRes = await api
          .getTeamExecutionDecision(teamSessionId, review.leadTurnId)
          .catch(() => ({ decision: null }));
        decision = decRes?.decision ?? null;
      }
      // complete pair from the current team and revision.
      if (
        requestId !== requestSequenceRef.current ||
        roster.teamSessionId !== teamSessionId ||
        board.teamSessionId !== teamSessionId
      ) return;
      if (roster.revision !== board.revision) {
        throw new Error(t("team.snapshotChanged"));
      }
      setSnapshot({ roster, board, review, decision });
    } catch (err) {
      if (requestId === requestSequenceRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }, [t, teamSessionId]);

  useEffect(() => {
    setLoading(true);
    setView({ kind: "aggregate" });
    void loadData();
    const timer = setInterval(() => void loadData(), 3000);
    return () => {
      requestSequenceRef.current += 1;
      clearInterval(timer);
    };
  }, [loadData]);

  const handleResume = async () => {
    if (!teamSessionId || resuming) return;
    const requestId = ++requestSequenceRef.current;
    setResuming(true);
    try {
      await api.teamResume(teamSessionId);
      if (requestId === requestSequenceRef.current) await loadData();
    } catch (err) {
      if (requestId === requestSequenceRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setResuming(false);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="team-panel">
        <div className="team-loading-state">
          <IconRefresh className="animate-spin" size={20} />
          <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }
  if (error && !snapshot) {
    return (
      <div className="team-panel">
        <div className="team-error-state">
          <IconCircleAlert size={24} />
          <span>{error}</span>
          <Button type="button" size="sm" onClick={() => void loadData()}>
            {t("team.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const roster = snapshot?.roster.members ?? [];
  const tasks = snapshot?.board.tasks.filter((task) => !task.deleted) ?? [];
  const readiness = new Map((snapshot?.board.readiness ?? []).map((item) => [item.taskId, item]));
  const overlaps = snapshot?.board.scopeOverlaps ?? [];
  const isPaused = snapshot?.roster.paused ?? false;

  if (view.kind === "panorama" && snapshot) {
    const rootNode: PanoramaNode = {
      id: snapshot.roster.teamSessionId,
      name: t("team.lead", { defaultValue: "Team Lead" }),
      task: t("team.membersCount", { count: roster.length }),
      status: isPaused ? "paused" : "running",
      avatarIcon: "users",
      isRoot: true,
    };

    const childNodes: PanoramaNode[] = roster.map((member) => {
      const memberTasks = tasks.filter((t) => t.ownerSessionId === member.memberSessionId);
      const activeTask = memberTasks.find((t) => t.status === "in_progress") ?? memberTasks[0];
      const taskLabel = activeTask ? activeTask.subject : (member.description || undefined);

      let status: PanoramaNodeStatus = "idle";
      if (member.phase === "running" || activeTask?.status === "in_progress") {
        status = "running";
      } else if (member.phase === "completed" || (memberTasks.length > 0 && memberTasks.every((t) => t.status === "completed"))) {
        status = "completed";
      } else if (member.phase === "failed" || activeTask?.status === "failed") {
        status = "failed";
      } else if (isPaused) {
        status = "paused";
      }

      return {
        id: member.memberSessionId,
        name: member.name,
        task: taskLabel,
        status,
        contextKind: member.contextKind,
        avatarIcon: "bot",
      };
    });

    return (
      <AgentPanorama
        title={t("team.panoramaTitle", { defaultValue: "Agent Panorama" })}
        rootNode={rootNode}
        childNodes={childNodes}
        onBack={() => setView({ kind: "aggregate" })}
        onSelectNode={(memberSessionId) => setView({ kind: "member", memberSessionId })}
        emptyMessage={t("team.emptyRoster")}
        loading={loading}
        error={error}
        onRetry={() => void loadData()}
      />
    );
  }
  if (view.kind === "member") {
    const selectedMember = roster.find((m) => m.memberSessionId === view.memberSessionId);
    if (selectedMember) {
      return (
        <TeamMemberDetail
          member={selectedMember}
          tasks={tasks}
          readiness={readiness}
          onBack={() => setView({ kind: "aggregate" })}
          onSelectSession={onSelectSession}
          onSelectTask={(taskId) => setView({ kind: "task", taskId })}
        />
      );
    }
  }

  if (view.kind === "task") {
    const selectedTask = tasks.find((t) => t.taskId === view.taskId);
    if (selectedTask) {
      return (
        <TeamTaskDetail
          task={selectedTask}
          taskReadiness={readiness.get(selectedTask.taskId)}
          members={roster}
          onBack={() => setView({ kind: "aggregate" })}
          onSelectMember={(memberSessionId) => setView({ kind: "member", memberSessionId })}
        />
      );
    }
  }

  return (
    <div className="team-panel" data-testid="team-panel">
      <header className="team-panel-header">
        <div className="team-panel-title">
          <IconUsers size={18} />
          <span>{t("team.title")}</span>
          <span className={`team-status-badge ${isPaused ? "team-status-paused" : "team-status-active"}`}>
            {isPaused ? t("team.pausedBadge") : t("team.activeBadge")}
          </span>
        </div>
        <div className="team-panel-actions">
          {isPaused && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              {resuming ? t("common.saving") : t("team.resumeButton")}
            </Button>
          )}
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square"
            tooltip={t("team.viewPanorama", { defaultValue: "View panorama" })}
            ariaLabel={t("team.viewPanorama", { defaultValue: "View panorama" })}
            onClick={() => setView({ kind: "panorama" })}
          >
            <IconWorkflow size={14} />
          </TooltipButton>
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square"
            tooltip={t("team.refresh")}
            ariaLabel={t("team.refresh")}
            onClick={() => void loadData()}
          >
            <IconRefresh size={14} />
          </TooltipButton>
        </div>
      </header>

      {overlaps.length > 0 && (
        <aside className="team-warning-box" aria-label={t("team.warnings")}>
          <div className="team-warning-title">
            <IconTriangleAlert size={14} />
            <span>{t("team.warnings")}</span>
          </div>
          {overlaps.map((overlap) => (
            <div key={`${overlap.scope}-${overlap.taskIds.join("-")}`} className="team-warning-item">
              {t("team.overlapTask", {
                tasks: overlap.taskIds.map((id) => `#${id}`).join(", "),
                scope: overlap.scope,
              })}
            </div>
          ))}
        </aside>
      )}
      {snapshot?.review && (
        <TeamLaunchReviewPanel
          teamSessionId={teamSessionId}
          review={snapshot.review}
          decision={snapshot.decision}
          onReviewChanged={() => void loadData()}
        />
      )}

      <section className="team-section">
        <div className="team-section-header">
          <span>{t("team.roster")}</span>
          <span className="team-section-count">{roster.length}</span>
        </div>
        {roster.length === 0 ? (
          <div className="team-empty-state">{t("team.emptyRoster")}</div>
        ) : (
          <div className="team-card-list">
            {roster.map((member) => (
              <div
                key={member.memberSessionId}
                className="team-member-card team-clickable-card"
                onClick={() => setView({ kind: "member", memberSessionId: member.memberSessionId })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setView({ kind: "member", memberSessionId: member.memberSessionId });
                  }
                }}
              >
                <div className="team-card-top">
                  <span className="team-card-title">{member.name}</span>
                  <div className="team-card-meta">
                    <span className="team-badge team-badge-context">
                      {t(`team.context.${member.contextKind}`)}
                    </span>
                    <span className={`team-badge team-phase-${member.phase}`}>
                      {t(`team.phase.${member.phase}`)}
                    </span>
                  </div>
                </div>
                {member.description ? <div className="team-card-desc">{member.description}</div> : null}
                {member.error ? <div className="team-card-error">{member.error}</div> : null}
                <div className="team-card-footer">
                  <div className="team-card-details">
                    {member.modelId ? <span>{member.modelId}</span> : null}
                  </div>
                  {onSelectSession ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSession(member.memberSessionId);
                      }}
                    >
                      {t("team.openSession")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="team-section">
        <div className="team-section-header">
          <span>{t("team.board")}</span>
          <span className="team-section-count">{tasks.length}</span>
        </div>
        {tasks.length === 0 ? (
          <div className="team-empty-state">{t("team.emptyTasks")}</div>
        ) : (
          <div className="team-card-list">
            {tasks.map((task) => {
              const taskReadiness = readiness.get(task.taskId);
              return (
                <div
                  key={task.taskId}
                  className="team-task-card team-clickable-card"
                  onClick={() => setView({ kind: "task", taskId: task.taskId })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setView({ kind: "task", taskId: task.taskId });
                    }
                  }}
                >
                  <div className="team-card-top">
                    <span className="team-card-title">{task.subject}</span>
                    <div className="team-card-meta">
                      <span className={`team-badge team-task-status-${task.status}`}>
                        {t(`team.taskStatus.${task.status}`)}
                      </span>
                      {taskReadiness ? (
                        <span
                          className={`team-badge team-task-readiness-${taskReadiness.isReady ? "ready" : "blocked"}`}
                          data-readiness={taskReadiness.isReady ? "ready" : "blocked"}
                        >
                          {t(`team.readiness.${taskReadiness.isReady ? "ready" : "blocked"}`)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {task.description ? <div className="team-card-desc">{task.description}</div> : null}
                  <div className="team-card-footer">
                    <div className="team-card-details">
                      <span>{task.ownerMemberName ?? t("team.unassigned")}</span>
                      {task.blockedBy.length > 0 ? (
                        <span>
                          {t("team.blockedBy", {
                            tasks: task.blockedBy.map((id) => `#${id}`).join(", "),
                          })}
                        </span>
                      ) : null}
                      {task.writeScopes.length > 0 ? (
                        <span>
                          {t("team.scopes", { scopes: task.writeScopes.join(", ") })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TeamMemberDetail({
  member,
  tasks,
  readiness,
  onBack,
  onSelectSession,
  onSelectTask,
}: {
  member: TeamMemberRecord;
  tasks: TeamTaskRecord[];
  readiness: Map<string, TeamTaskReadiness>;
  onBack: () => void;
  onSelectSession?: (sessionId: string) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    api.getSession(member.memberSessionId)
      .then((detail) => {
        if (seq !== loadSeqRef.current) return;
        setMessages(detail?.session?.messages ?? []);
      })
      .catch((err) => {
        if (seq !== loadSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === loadSeqRef.current) setLoading(false);
      });
  }, [member.memberSessionId]);

  const assignedTasks = tasks.filter(
    (task) =>
      task.ownerSessionId === member.memberSessionId ||
      task.ownerMemberName === member.name,
  );

  return (
    <div className="team-panel team-detail-view" data-testid="team-member-detail">
      <header className="team-panel-header">
        <div className="team-detail-back-row">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onBack}
            className="team-back-btn"
          >
            <IconChevronLeft size={16} />
            <span>{t("team.back")}</span>
          </Button>
          <span className="team-detail-title-tag">{t("team.memberDetail")}</span>
        </div>
        {onSelectSession ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onSelectSession(member.memberSessionId)}
          >
            {t("team.openInMain")}
          </Button>
        ) : null}
      </header>

      <section className="team-member-profile">
        <div className="team-card-top">
          <span className="team-card-title team-detail-name">{member.name}</span>
          <div className="team-card-meta">
            <span className="team-badge team-badge-context">
              {t(`team.context.${member.contextKind}`)}
            </span>
            <span className={`team-badge team-phase-${member.phase}`}>
              {t(`team.phase.${member.phase}`)}
            </span>
          </div>
        </div>
        {member.description ? (
          <p className="team-card-desc">{member.description}</p>
        ) : null}
        {member.modelId ? (
          <div className="team-card-details">
            <span>{member.modelId}</span>
          </div>
        ) : null}
        {member.error ? (
          <div className="team-card-error">{member.error}</div>
        ) : null}
      </section>

      <section className="team-section">
        <div className="team-section-header">
          <span>{t("team.assignedTasks")}</span>
          <span className="team-section-count">{assignedTasks.length}</span>
        </div>
        {assignedTasks.length === 0 ? (
          <div className="team-empty-state">{t("team.noAssignedTasks")}</div>
        ) : (
          <div className="team-card-list">
            {assignedTasks.map((task) => {
              const taskReadiness = readiness.get(task.taskId);
              return (
                <div
                  key={task.taskId}
                  className="team-task-card team-clickable-card"
                  onClick={() => onSelectTask(task.taskId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectTask(task.taskId);
                    }
                  }}
                >
                  <div className="team-card-top">
                    <span className="team-card-title">{task.subject}</span>
                    <div className="team-card-meta">
                      <span className={`team-badge team-task-status-${task.status}`}>
                        {t(`team.taskStatus.${task.status}`)}
                      </span>
                      {taskReadiness ? (
                        <span
                          className={`team-badge team-task-readiness-${taskReadiness.isReady ? "ready" : "blocked"}`}
                          data-readiness={taskReadiness.isReady ? "ready" : "blocked"}
                        >
                          {t(`team.readiness.${taskReadiness.isReady ? "ready" : "blocked"}`)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="team-section team-transcript-section">
        <div className="team-section-header">
          <span>{t("team.transcript")}</span>
        </div>
        {loading ? (
          <div className="team-loading-state">
            <IconRefresh className="animate-spin" size={18} />
            <span>{t("common.loading")}</span>
          </div>
        ) : error ? (
          <div className="team-error-state">
            <IconCircleAlert size={20} />
            <span>{error}</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="team-empty-state">{t("team.noTranscript")}</div>
        ) : (
          <TranscriptDisclosureProvider key={member.memberSessionId}>
            <div className="team-transcript-list">
              {messages.map((message) => {
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="message-row user">
                      <div className="message-col">
                        <div className="message-bubble">
                          <div className="message-user-text selectable">
                            {message.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (message.role === "assistant") {
                  if (message.toolName) {
                    return (
                      <div key={message.id} className="team-transcript-tool-item">
                        <ToolRow message={message} />
                        <ReviewChangeCard message={message} />
                      </div>
                    );
                  }
                  if (message.content) {
                    return (
                      <div
                        key={message.id}
                        className="message-row assistant"
                        data-message-id={message.id}
                      >
                        <div className="message-col">
                          <div className="message-bubble">
                            <div className="prose-chat selectable">
                              <Markdown source={message.content} />
                            </div>
                            {message.error ? (
                              <AssistantErrorMessage message={message} />
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (message.error) {
                    return (
                      <div key={message.id} className="message-row assistant">
                        <div className="message-col">
                          <div className="message-bubble">
                            <AssistantErrorMessage message={message} />
                          </div>
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })}
            </div>
          </TranscriptDisclosureProvider>
        )}
      </section>
    </div>
  );
}

function TeamTaskDetail({
  task,
  taskReadiness,
  members,
  onBack,
  onSelectMember,
}: {
  task: TeamTaskRecord;
  taskReadiness?: TeamTaskReadiness;
  members: TeamMemberRecord[];
  onBack: () => void;
  onSelectMember: (memberSessionId: string) => void;
}) {
  const { t } = useTranslation();
  const ownerMember = members.find(
    (m) =>
      (task.ownerSessionId && m.memberSessionId === task.ownerSessionId) ||
      (task.ownerMemberName && m.name === task.ownerMemberName),
  );

  return (
    <div className="team-panel team-detail-view" data-testid="team-task-detail">
      <header className="team-panel-header">
        <div className="team-detail-back-row">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onBack}
            className="team-back-btn"
          >
            <IconChevronLeft size={16} />
            <span>{t("team.back")}</span>
          </Button>
          <span className="team-detail-title-tag">{t("team.taskDetail")}</span>
        </div>
      </header>

      <section className="team-task-profile">
        <div className="team-card-top">
          <span className="team-card-title team-detail-name">{task.subject}</span>
          <div className="team-card-meta">
            <span className={`team-badge team-task-status-${task.status}`}>
              {t(`team.taskStatus.${task.status}`)}
            </span>
            {taskReadiness ? (
              <span
                className={`team-badge team-task-readiness-${taskReadiness.isReady ? "ready" : "blocked"}`}
                data-readiness={taskReadiness.isReady ? "ready" : "blocked"}
              >
                {t(`team.readiness.${taskReadiness.isReady ? "ready" : "blocked"}`)}
              </span>
            ) : null}
          </div>
        </div>
        {task.description ? (
          <p className="team-card-desc">{task.description}</p>
        ) : null}
      </section>

      <section className="team-section">
        <div className="team-detail-field">
          <span className="team-detail-field-label">{t("team.taskOwner")}</span>
          {ownerMember ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onSelectMember(ownerMember.memberSessionId)}
              className="team-owner-btn"
            >
              {ownerMember.name}
            </Button>
          ) : (
            <span className="team-detail-field-value">
              {task.ownerMemberName ?? t("team.unassigned")}
            </span>
          )}
        </div>

        {task.blockedBy.length > 0 ? (
          <div className="team-detail-field">
            <span className="team-detail-field-label">{t("team.taskReadiness")}</span>
            <span className="team-detail-field-value">
              {t("team.blockedBy", {
                tasks: task.blockedBy.map((id) => `#${id}`).join(", "),
              })}
            </span>
          </div>
        ) : null}

        {task.writeScopes.length > 0 ? (
          <div className="team-detail-field">
            <span className="team-detail-field-label">Scopes</span>
            <span className="team-detail-field-value">
              {t("team.scopes", { scopes: task.writeScopes.join(", ") })}
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
