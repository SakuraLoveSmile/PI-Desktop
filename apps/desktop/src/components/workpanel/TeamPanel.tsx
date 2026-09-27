import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TeamMemberRecord, TeamTaskRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { IconCircleAlert, IconRefresh, IconTriangleAlert, IconUsers } from "../icons";
import { Button, TooltipButton } from "../ui";
import "../../styles/team-panel.css";

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

type TeamPanelSnapshot = { roster: TeamRosterSnapshot; board: TeamBoardSnapshot };

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
  const requestSequenceRef = useRef(0);

  const loadData = useCallback(async () => {
    if (!teamSessionId) return;
    const requestId = ++requestSequenceRef.current;
    try {
      const [roster, board] = await Promise.all([
        api.getTeamRoster(teamSessionId) as unknown as Promise<TeamRosterSnapshot>,
        api.getTeamBoard(teamSessionId) as unknown as Promise<TeamBoardSnapshot>,
      ]);
      // A refresh can finish after Resume or after a newer poll. Only commit a
      // complete pair from the current team and revision.
      if (
        requestId !== requestSequenceRef.current ||
        roster.teamSessionId !== teamSessionId ||
        board.teamSessionId !== teamSessionId
      ) return;
      if (roster.revision !== board.revision) {
        throw new Error(t("team.snapshotChanged"));
      }
      setSnapshot({ roster, board });
      setError(null);
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
    return <div className="team-panel"><div className="team-loading-state"><IconRefresh className="animate-spin" size={20} /><span>{t("common.loading")}</span></div></div>;
  }
  if (error && !snapshot) {
    return <div className="team-panel"><div className="team-error-state"><IconCircleAlert size={24} /><span>{error}</span><Button type="button" size="sm" onClick={() => void loadData()}>{t("team.retry")}</Button></div></div>;
  }

  const roster = snapshot?.roster.members ?? [];
  const tasks = snapshot?.board.tasks.filter((task) => !task.deleted) ?? [];
  const readiness = new Map((snapshot?.board.readiness ?? []).map((item) => [item.taskId, item]));
  const overlaps = snapshot?.board.scopeOverlaps ?? [];
  const isPaused = snapshot?.roster.paused ?? false;

  return (
    <div className="team-panel" data-testid="team-panel">
      <header className="team-panel-header">
        <div className="team-panel-title"><IconUsers size={18} /><span>{t("team.title")}</span><span className={`team-status-badge ${isPaused ? "team-status-paused" : "team-status-active"}`}>{isPaused ? t("team.pausedBadge") : t("team.activeBadge")}</span></div>
        <div className="team-panel-actions">
          {isPaused && <Button type="button" size="sm" variant="primary" disabled={resuming} onClick={() => void handleResume()}>{resuming ? t("common.saving") : t("team.resumeButton")}</Button>}
          <TooltipButton type="button" className="icon-btn icon-btn-square" tooltip={t("team.refresh")} ariaLabel={t("team.refresh")} onClick={() => void loadData()}><IconRefresh size={14} /></TooltipButton>
        </div>
      </header>

      {overlaps.length > 0 && <aside className="team-warning-box" aria-label={t("team.warnings")}><div className="team-warning-title"><IconTriangleAlert size={14} /><span>{t("team.warnings")}</span></div>{overlaps.map((overlap) => <div key={`${overlap.scope}-${overlap.taskIds.join("-")}`} className="team-warning-item">{t("team.overlapTask", { tasks: overlap.taskIds.map((id) => `#${id}`).join(", "), scope: overlap.scope })}</div>)}</aside>}

      <section className="team-section">
        <div className="team-section-header"><span>{t("team.roster")}</span><span className="team-section-count">{roster.length}</span></div>
        {roster.length === 0 ? <div className="team-empty-state">{t("team.emptyRoster")}</div> : <div className="team-card-list">{roster.map((member) => <div key={member.memberSessionId} className="team-member-card">
          <div className="team-card-top"><span className="team-card-title">{member.name}</span><div className="team-card-meta"><span className="team-badge team-badge-context">{t(`team.context.${member.contextKind}`)}</span><span className={`team-badge team-phase-${member.phase}`}>{t(`team.phase.${member.phase}`)}</span></div></div>
          {member.description ? <div className="team-card-desc">{member.description}</div> : null}
          {member.error ? <div className="team-card-error">{member.error}</div> : null}
          <div className="team-card-footer"><div className="team-card-details">{member.modelId ? <span>{member.modelId}</span> : null}</div>{onSelectSession ? <Button type="button" size="sm" onClick={() => onSelectSession(member.memberSessionId)}>{t("team.openSession")}</Button> : null}</div>
        </div>)}</div>}
      </section>

      <section className="team-section">
        <div className="team-section-header"><span>{t("team.board")}</span><span className="team-section-count">{tasks.length}</span></div>
        {tasks.length === 0 ? <div className="team-empty-state">{t("team.emptyTasks")}</div> : <div className="team-card-list">{tasks.map((task) => {
          const taskReadiness = readiness.get(task.taskId);
          return <div key={task.taskId} className="team-task-card">
            <div className="team-card-top"><span className="team-card-title">{task.subject}</span><div className="team-card-meta"><span className={`team-badge team-task-status-${task.status}`}>{t(`team.taskStatus.${task.status}`)}</span>{taskReadiness ? <span className={`team-badge team-task-readiness-${taskReadiness.isReady ? "ready" : "blocked"}`} data-readiness={taskReadiness.isReady ? "ready" : "blocked"}>{t(`team.readiness.${taskReadiness.isReady ? "ready" : "blocked"}`)}</span> : null}</div></div>
            {task.description ? <div className="team-card-desc">{task.description}</div> : null}
            <div className="team-card-footer"><div className="team-card-details"><span>{task.ownerMemberName ?? t("team.unassigned")}</span>{task.blockedBy.length > 0 ? <span>{t("team.blockedBy", { tasks: task.blockedBy.map((id) => `#${id}`).join(", ") })}</span> : null}{task.writeScopes.length > 0 ? <span>{t("team.scopes", { scopes: task.writeScopes.join(", ") })}</span> : null}</div></div>
          </div>;
        })}</div>}
      </section>
    </div>
  );
}
