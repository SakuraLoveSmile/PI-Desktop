import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  TeamMemberRecord,
  TeamSnapshot,
  TeamTaskRecord,
  UiMessage,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { getPanoramaViewport, savePanoramaViewport } from "../../lib/panorama-memory";
import type { PanoramaViewport } from "./agent-panorama-viewport";
import { useTeamSnapshot } from "../../hooks/useTeamSnapshot";
import {
  buildTeamTaskRows,
  deriveTeamLeadVisualState,
  projectMemberIdentities,
  selectOverviewTaskRows,
  type BoardFilter,
  type MemberView,
} from "../../lib/team-presentation";
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
import { CompactTeamBoard } from "./team/CompactTeamBoard";
import { TeamStatusBadge } from "./team/TeamStatusBadge";
import { MemberIdentity, TeamTaskProgress } from "./team/TeamTaskProgress";
import "../../styles/team-panel.css";
import { AgentPanorama, type PanoramaNode } from "./AgentPanorama";

type TeamDetailView =
  | { kind: "aggregate" }
  | { kind: "board" }
  | { kind: "member"; memberSessionId: string }
  | { kind: "task"; taskId: string }
  | { kind: "panorama" };
type TeamTaskReadiness = TeamSnapshot["readiness"][number];

function requestedView(initialTaskId?: string, initialView: TeamPanelProps["initialView"] = "aggregate"): TeamDetailView {
  if (initialTaskId) return { kind: "task", taskId: initialTaskId };
  if (initialView === "task") return { kind: "aggregate" };
  return { kind: initialView ?? "aggregate" };
}

export type TeamPanelProps = {
  teamSessionId: string;
  onSelectSession?: (sessionId: string) => void;
  initialTaskId?: string;
  navigationSeq?: number;
  initialView?: "aggregate" | "board" | "task" | "panorama";
};

export function TeamPanel({
  teamSessionId,
  onSelectSession,
  initialTaskId,
  navigationSeq,
  initialView = "aggregate",
}: TeamPanelProps) {
  const { t } = useTranslation();
  const { snapshot, loading, error: snapshotError, refresh, lastSuccessAt } = useTeamSnapshot(teamSessionId);
  const error = snapshotError && ["TEAM_DISSOLVED", "TEAM_SCOPE_MISMATCH"].includes(snapshotError)
    ? t(`team.snapshotErrors.${snapshotError}`) : snapshotError;
  const [resuming, setResuming] = useState(false);
  const [view, setView] = useState<TeamDetailView>(() => requestedView(initialTaskId, initialView));
  const [viewStack, setViewStack] = useState<TeamDetailView[]>([]);
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [boardQuery, setBoardQuery] = useState("");
  const [progressExpanded, setProgressExpanded] = useState(true);
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const boardScrollTopRef = useRef(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const panoramaScopeKey = `team:desktop:${teamSessionId}`;
  const [savedViewport, setSavedViewport] = useState<PanoramaViewport | undefined>(() =>
    getPanoramaViewport(panoramaScopeKey),
  );

  const loadData = useCallback(() => refresh(), [refresh]);
  const handleViewportSave = useCallback((scopeKey: string, viewport: PanoramaViewport) => {
    savePanoramaViewport(scopeKey, viewport);
    if (scopeKey === panoramaScopeKey) setSavedViewport(viewport);
  }, [panoramaScopeKey]);
  const navigate = useCallback((next: TeamDetailView) => {
    setViewStack((stack) => [...stack, view]);
    setView(next);
  }, [view]);
  const goBack = useCallback(() => {
    const next = viewStack.at(-1);
    setViewStack(viewStack.slice(0, -1));
    setView(next ?? { kind: "aggregate" });
  }, [viewStack]);

  useEffect(() => {
    setResuming(false);
    setViewStack([]);
    setBoardFilter("all");
    setBoardQuery("");
    setProgressExpanded(true);
    setActionError(null);
    boardScrollTopRef.current = 0;
    setView(requestedView(initialTaskId, initialView));
  }, [initialTaskId, initialView, teamSessionId, navigationSeq]);

  useEffect(() => {
    setSavedViewport(getPanoramaViewport(panoramaScopeKey));
  }, [panoramaScopeKey]);

  useEffect(() => {
    if (view.kind === "board" && boardScrollRef.current) {
      boardScrollRef.current.scrollTop = boardScrollTopRef.current;
    }
  }, [view]);

  const handleResume = async () => {
    if (!teamSessionId || resuming) return;
    setResuming(true);
    try {
      await api.teamResume(teamSessionId);
      setActionError(null);
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setResuming(false);
    }
  };

  if (snapshot && snapshot.teamSessionId !== teamSessionId) {
    return (
      <div className="team-panel">
        <div className="team-loading-state">
          <IconRefresh className="animate-spin" size={20} />
          <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }
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

  const roster = snapshot?.members ?? [];
  const tasks = snapshot?.tasks.filter((task) => !task.deleted) ?? [];
  const readiness = new Map((snapshot?.readiness ?? []).map((item) => [item.taskId, item]));
  const overlaps = snapshot?.scopeOverlaps ?? [];
  const isPaused = snapshot?.paused ?? false;
  const memberIdentities = projectMemberIdentities(roster, isPaused);
  const identityBySession = new Map(memberIdentities.map((identity) => [identity.sessionId, identity]));
  const taskRows = buildTeamTaskRows(tasks, roster, snapshot?.readiness ?? [], isPaused);
  const overviewRows = selectOverviewTaskRows(taskRows);
  const completedCount = tasks.filter((task) => task.status === "completed").length;

  if (view.kind === "panorama" && snapshot) {
    const leadState = deriveTeamLeadVisualState(
      snapshot.leadPhase,
      isPaused,
      roster,
      tasks,
      snapshot.queuedMessageCount,
    );
    const rootNode: PanoramaNode = {
      id: snapshot.teamSessionId,
      name: t("team.lead"),
      task: t("team.coordinatingExperts"),
      status: leadState.status,
      statusLabel: leadState.waitingForMembers ? t("team.waitingForMembers") : undefined,
      avatarSeed: snapshot.teamSessionId,
      isLead: true,
      avatarIcon: "users",
      isRoot: true,
    };

    const identities = projectMemberIdentities(roster, isPaused);
    const childNodes: PanoramaNode[] = roster.map((member, index) => {
      const memberTasks = tasks.filter((t) => t.ownerSessionId === member.memberSessionId);
      const activeTask = memberTasks.find((t) => t.status === "in_progress") ?? memberTasks[0];
      const identity = identities[index];
      const status = isPaused ? "paused" : member.phase === "provisioning" ? "idle" : member.phase;

      return {
        id: member.memberSessionId,
        name: identity.displayName,
        roleLabel: t(`team.roles.${identity.role}`),
        avatarSeed: member.memberSessionId,
        task: activeTask?.subject ?? member.description ?? t("team.noCurrentTask"),
        status,
        contextKind: member.contextKind,
        avatarIcon: "bot",
      };
    });

    return (
      <AgentPanorama
        title={t("team.panoramaTitle")}
        rootNode={rootNode}
        childNodes={childNodes}
        onBack={goBack}
        onSelectNode={(memberSessionId) => navigate({ kind: "member", memberSessionId })}
        emptyMessage={t("team.emptyRoster")}
        loading={loading && !snapshot}
        error={snapshot ? null : error}
        staleError={snapshot ? error : null}
        onRetry={() => void loadData()}
        viewportScopeKey={panoramaScopeKey}
        savedViewport={savedViewport}
        onViewportSave={handleViewportSave}
      />
    );
  }
  if (view.kind === "member") {
    const selectedMember = roster.find((m) => m.memberSessionId === view.memberSessionId);
    if (selectedMember) {
      return (
        <TeamMemberDetail
          member={selectedMember}
          identity={identityBySession.get(selectedMember.memberSessionId)!}
          tasks={tasks}
          readiness={readiness}
          onBack={goBack}
          onSelectSession={onSelectSession}
          onSelectTask={(taskId) => navigate({ kind: "task", taskId })}
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
          identities={identityBySession}
          overlaps={overlaps}
          onBack={goBack}
          onSelectMember={(memberSessionId) => navigate({ kind: "member", memberSessionId })}
        />
      );
    }
  }

  if (view.kind === "board") {
    return (
      <div className="team-panel team-board-view" data-testid="team-task-board">
        <header className="team-panel-header">
          <div className="team-detail-back-row">
            <Button type="button" size="sm" variant="ghost" onClick={goBack} className="team-back-btn">
              <IconChevronLeft size={16} />
              <span>{t("team.back")}</span>
            </Button>
            <span className="team-detail-title-tag">{t("team.board")}</span>
            <span className="team-section-count">{tasks.length}</span>
          </div>
          <div className="team-panel-actions">
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
        {error ? (
          <div className="team-error-state" role="alert">
            <IconCircleAlert size={18} />
            <span>{t("team.staleData")}</span>
            <Button type="button" size="sm" onClick={() => void loadData()}>{t("team.retry")}</Button>
          </div>
        ) : null}
        {overlaps.length > 0 ? (
          <aside className="team-warning-box" aria-label={t("team.warnings")}>
            <div className="team-warning-title">
              <IconTriangleAlert size={14} />
              <span>{t("team.scopeOverlapCount", { count: overlaps.length })}</span>
            </div>
            {overlaps[0]?.taskIds[0] ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => navigate({ kind: "task", taskId: overlaps[0]!.taskIds[0]! })}
              >
                {t("team.openOverlapTask")}
              </Button>
            ) : null}
          </aside>
        ) : null}
        <div
          ref={boardScrollRef}
          className="team-board-scroll"
          onScroll={(event) => { boardScrollTopRef.current = event.currentTarget.scrollTop; }}
        >
          <CompactTeamBoard
            rows={taskRows}
            filter={boardFilter}
            query={boardQuery}
            onFilter={setBoardFilter}
            onQuery={setBoardQuery}
            onOpenTask={(taskId) => navigate({ kind: "task", taskId })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="team-panel" data-testid="team-panel" data-last-success-at={lastSuccessAt ?? undefined}>
      <header className="team-panel-header">
        <div className="team-panel-title">
          <IconUsers size={18} />
          <span>{t("team.title")}</span>
          <TeamStatusBadge snapshot={snapshot} />
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
            tooltip={t("team.viewPanorama")}
            ariaLabel={t("team.viewPanorama")}
            onClick={() => navigate({ kind: "panorama" })}
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
            <span>{t("team.scopeOverlapCount", { count: overlaps.length })}</span>
          </div>
          {overlaps[0]?.taskIds[0] ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => navigate({ kind: "task", taskId: overlaps[0]!.taskIds[0]! })}
            >
              {t("team.openOverlapTask")}
            </Button>
          ) : null}
        </aside>
      )}
      {snapshot?.review && (
        <TeamLaunchReviewPanel
          key={`${teamSessionId}:${snapshot.review.reviewId}`}
          teamSessionId={teamSessionId}
          review={snapshot.review}
          decision={snapshot.decision}
          onReviewChanged={() => void loadData()}
        />
      )}
      {snapshot?.decision?.strategy === "lead_only" && snapshot.decision.reason && (
        <section className="team-launch-review team-launch-review-decision" data-testid="team-lead-decision">
          <div className="team-launch-review-reason">
            <span className="team-launch-review-reason-label">
              {t("team.review.leadOnlyReason")}
            </span>
            <p className="team-launch-review-reason-text">{snapshot.decision.reason}</p>
          </div>
        </section>
      )}
      {error && (
        <div className="team-error-state" role="alert">
          <IconCircleAlert size={18} />
          <span>{snapshot ? t("team.staleData") : error}</span>
          <Button type="button" size="sm" onClick={() => void loadData()}>
            {t("team.retry")}
          </Button>
        </div>
      )}
      {actionError ? (
        <div className="team-error-state" role="alert">
          <IconCircleAlert size={18} />
          <span>{actionError}</span>
        </div>
      ) : null}

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
                className="team-member-card"
              >
                <div className="team-card-top">
                  <Button
                    type="button"
                    variant="ghost"
                    className="team-member-open-detail"
                    onClick={() => navigate({ kind: "member", memberSessionId: member.memberSessionId })}
                  >
                    <MemberIdentity member={identityBySession.get(member.memberSessionId)!} />
                  </Button>
                  <div className="team-card-meta">
                    <span className="team-badge team-badge-context">
                      {t(`team.context.${member.contextKind}`)}
                    </span>
                    <span className={`team-badge team-phase-${member.phase}`}>
                      {t(`team.phase.${member.phase}`)}
                    </span>
                  </div>
                </div>
                {member.error ? <div className="team-card-error">{member.error}</div> : null}
                <div className="team-card-footer">
                  <div className="team-card-details">
                    {member.modelId ? <span>{member.modelId}</span> : null}
                  </div>
                  {onSelectSession ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onSelectSession(member.memberSessionId)}
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

      <TeamTaskProgress
        rows={overviewRows}
        completed={completedCount}
        total={tasks.length}
        expanded={progressExpanded}
        onToggle={() => setProgressExpanded((expanded) => !expanded)}
        onOpenTask={(taskId) => navigate({ kind: "task", taskId })}
        onOpenPanorama={() => navigate({ kind: "panorama" })}
        onOpenBoard={() => navigate({ kind: "board" })}
      />
    </div>
  );
}

function TeamMemberDetail({
  member,
  identity,
  tasks,
  readiness,
  onBack,
  onSelectSession,
  onSelectTask,
}: {
  member: TeamMemberRecord;
  identity: MemberView;
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
          <span className="team-card-title team-detail-name">
            <MemberIdentity member={identity} />
            <code className="team-member-handle">{member.name}</code>
          </span>
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
                <Button
                  type="button"
                  variant="ghost"
                  key={task.taskId}
                  className="team-task-card team-clickable-card"
                  onClick={() => onSelectTask(task.taskId)}
                >
                  <div className="team-card-top">
                    <span className="team-card-title">{task.subject}</span>
                    <div className="team-card-meta">
                      <span className={`team-badge team-task-status-${task.status}`}>
                        {t(`team.taskStatus.${task.status}`)}
                      </span>
                      {task.status === "pending" && taskReadiness ? (
                        <span
                          className={`team-badge team-task-readiness-${taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}`}
                          data-readiness={taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}
                        >
                          {t(`team.readiness.${taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}`)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Button>
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
  identities,
  overlaps,
  onBack,
  onSelectMember,
}: {
  task: TeamTaskRecord;
  taskReadiness?: TeamTaskReadiness;
  members: TeamMemberRecord[];
  identities: Map<string, MemberView>;
  overlaps: TeamSnapshot["scopeOverlaps"];
  onBack: () => void;
  onSelectMember: (memberSessionId: string) => void;
}) {
  const { t } = useTranslation();
  const ownerMember = members.find(
    (m) =>
      (task.ownerSessionId && m.memberSessionId === task.ownerSessionId) ||
      (task.ownerMemberName && m.name === task.ownerMemberName),
  );
  const taskOverlaps = overlaps.filter((overlap) => overlap.taskIds.includes(task.taskId));

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
            {task.status === "pending" && taskReadiness ? (
              <span
                className={`team-badge team-task-readiness-${taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}`}
                data-readiness={taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}
              >
                {t(`team.readiness.${taskReadiness.unresolvedBlockedBy.length > 0 ? "blocked" : "ready"}`)}
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
              {identities.get(ownerMember.memberSessionId) ? (
                <MemberIdentity member={identities.get(ownerMember.memberSessionId)!} />
              ) : ownerMember.name}
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
        {taskOverlaps.map((overlap) => (
          <div key={`${overlap.scope}-${overlap.taskIds.join("-")}`} className="team-detail-field">
            <span className="team-detail-field-label">{t("team.warnings")}</span>
            <span className="team-detail-field-value">
              {t("team.overlapTask", {
                tasks: overlap.taskIds.map((id) => `#${id}`).join(", "),
                scope: overlap.scope,
              })}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
