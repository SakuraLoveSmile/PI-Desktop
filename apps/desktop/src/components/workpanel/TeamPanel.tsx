import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TeamProjection } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import {
  IconCircleAlert,
  IconRefresh,
  IconTriangleAlert,
  IconUsers,
} from "../icons";
import { TooltipButton } from "../ui";
import "../../styles/team-panel.css";

export type TeamPanelProps = {
  teamSessionId: string;
  onSelectSession?: (sessionId: string) => void;
};

export function TeamPanel({ teamSessionId, onSelectSession }: TeamPanelProps) {
  const { t } = useTranslation();
  const [projection, setProjection] = useState<TeamProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!teamSessionId) return;
    try {
      const data = await api.getTeamBoard(teamSessionId);
      setProjection(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [teamSessionId]);

  useEffect(() => {
    setLoading(true);
    void loadData();
    const timer = setInterval(() => {
      void loadData();
    }, 3000);
    return () => clearInterval(timer);
  }, [loadData]);

  const handleResume = async () => {
    if (!teamSessionId || resuming) return;
    setResuming(true);
    try {
      await api.teamResume(teamSessionId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResuming(false);
    }
  };

  if (loading && !projection) {
    return (
      <div className="team-panel">
        <div className="team-loading-state">
          <IconRefresh className="animate-spin" size={20} />
          <span>{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (error && !projection) {
    return (
      <div className="team-panel">
        <div className="team-error-state">
          <IconCircleAlert size={24} />
          <span>{error}</span>
          <button
            type="button"
            className="team-resume-btn"
            onClick={() => void loadData()}
          >
            {t("team.retry") || "Retry"}
          </button>
        </div>
      </div>
    );
  }

  const isPaused = projection?.team.paused ?? false;
  const roster = projection?.roster ?? [];
  const tasks = projection?.tasks.filter((task) => !task.deleted) ?? [];
  const warnings = projection?.warnings ?? [];

  return (
    <div className="team-panel" data-testid="team-panel">
      <header className="team-panel-header">
        <div className="team-panel-title">
          <IconUsers size={18} />
          <span>{t("team.title")}</span>
          <span
            className={`team-status-badge ${
              isPaused ? "team-status-paused" : "team-status-active"
            }`}
          >
            {isPaused ? t("team.pausedBadge") : t("team.activeBadge")}
          </span>
        </div>

        <div className="team-panel-actions">
          {isPaused && (
            <button
              type="button"
              className="team-resume-btn"
              disabled={resuming}
              onClick={() => void handleResume()}
            >
              {resuming ? t("common.saving") : t("team.resumeButton")}
            </button>
          )}
          <TooltipButton
            type="button"
            className="icon-btn icon-btn-square"
            tooltip={t("team.refresh") || "Refresh"}
            ariaLabel={t("team.refresh") || "Refresh"}
            onClick={() => void loadData()}
          >
            <IconRefresh size={14} />
          </TooltipButton>
        </div>
      </header>

      {warnings.length > 0 && (
        <aside className="team-warning-box" aria-label={t("team.warnings")}>
          <div className="team-warning-title">
            <IconTriangleAlert size={14} />
            <span>{t("team.warnings")}</span>
          </div>
          {warnings.map((w) => (
            <div
              key={`${w.taskAId}-${w.taskBId}-${w.scope}`}
              className="team-warning-item"
            >
              Tasks #{w.taskAId} and #{w.taskBId} overlap on scope:{" "}
              <code>{w.scope}</code>
            </div>
          ))}
        </aside>
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
              <div key={member.memberSessionId} className="team-member-card">
                <div className="team-card-top">
                  <span className="team-card-title">{member.name}</span>
                  <div className="team-card-meta">
                    <span className="team-badge team-badge-context">
                      {member.contextKind}
                    </span>
                    <span className={`team-badge team-phase-${member.phase}`}>
                      {member.phase}
                    </span>
                  </div>
                </div>

                {member.description ? (
                  <div className="team-card-desc">{member.description}</div>
                ) : null}

                {member.error ? (
                  <div className="team-card-error">{member.error}</div>
                ) : null}

                <div className="team-card-footer">
                  <div className="team-card-details">
                    {member.modelId ? <span>{member.modelId}</span> : null}
                  </div>
                  {onSelectSession ? (
                    <button
                      type="button"
                      className="team-open-session-btn"
                      onClick={() => onSelectSession(member.memberSessionId)}
                    >
                      {t("team.openSession")}
                    </button>
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
            {tasks.map((task) => (
              <div key={task.taskId} className="team-task-card">
                <div className="team-card-top">
                  <span className="team-card-title">{task.subject}</span>
                  <span
                    className={`team-badge team-task-status-${task.status}`}
                  >
                    {task.status.replace("_", " ")}
                  </span>
                </div>

                {task.description ? (
                  <div className="team-card-desc">{task.description}</div>
                ) : null}

                <div className="team-card-footer">
                  <div className="team-card-details">
                    <span>
                      {task.ownerMemberName ?? t("team.unassigned")}
                    </span>
                    {task.blockedBy.length > 0 ? (
                      <span>
                        Blocked by: {task.blockedBy.map((b) => `#${b}`).join(", ")}
                      </span>
                    ) : null}
                    {task.writeScopes.length > 0 ? (
                      <span>Scopes: {task.writeScopes.join(", ")}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
