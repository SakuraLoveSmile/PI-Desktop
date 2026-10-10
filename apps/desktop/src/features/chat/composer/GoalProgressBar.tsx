import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanProposal } from "@pi-desktop/shared";
import { useGoalActivity } from "../../../hooks/useGoalActivity";
import { Button } from "../../../components/ui";
import { IconChevronDown, IconChevronRight } from "../../../components/icons";
import { usePendingTeamExecutionReview } from "../../../hooks/useTeamExecutionReview";
import { useAppStore } from "../../../stores/app-store";
import {
  shouldShowGoalProgressBar,
  resolveGoalCapsuleState,
} from "../../../lib/goal-progress-presentation";

const sessionCollapsePreferences = new Map<string, boolean>();

export type GoalProgressBarProps = {
  sessionId: string;
  proposal: PlanProposal;
};

export function GoalProgressBar({ sessionId, proposal }: GoalProgressBarProps) {
  const { t } = useTranslation();
  const listId = useId();
  const currentExecution = useAppStore((state) => state.planCheckpoints[sessionId]);
  const isCurrentExecution = proposal.sessionId === sessionId &&
    currentExecution?.id === proposal.id && currentExecution.executionId === proposal.executionId &&
    currentExecution.executionState === "running" && proposal.executionState === "running";
  const pendingTeamReview = usePendingTeamExecutionReview(sessionId, isCurrentExecution);
  const [expanded, setExpanded] = useState<boolean>(() => {
    return sessionCollapsePreferences.get(sessionId) ?? false;
  });
  const { progress, loading, error, reportReady } = useGoalActivity(sessionId, proposal.executionId);

  useEffect(() => {
    setExpanded(sessionCollapsePreferences.get(sessionId) ?? false);
  }, [sessionId]);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      sessionCollapsePreferences.set(sessionId, next);
      return next;
    });
  };

  if (!shouldShowGoalProgressBar({ proposal, reportReady })) {
    return null;
  }

  const executionBadgeText =
    proposal.executionState === "queued"
      ? t("chat.scheduleExecutionState.queued", "排队中")
      : proposal.executionState === "interrupted"
      ? t("chat.scheduleExecutionState.interrupted", "已中断")
      : proposal.executionState === "completed"
      ? t("chat.scheduleExecutionState.completed", "已完成")
      : t("chat.scheduleExecutionState.running", "执行中");

  const capsuleState = resolveGoalCapsuleState({
    loading,
    error,
    progress,
    labels: {
      initializing: t("goal.progressInitializing", "加载进度..."),
      running: executionBadgeText,
      failed: t("goal.progressFailed", "进度读取失败"),
    },
  });
  const stateBadgeText = capsuleState.kind === "error"
    ? capsuleState.message
    : pendingTeamReview
    ? t("team.review.status.pending")
    : capsuleState.kind === "progress"
    ? executionBadgeText
    : capsuleState.message;
  const items = progress?.items ?? [];

  const circumference = 37.7; // 2 * pi * 6
  const dashOffset =
    capsuleState.kind === "progress"
      ? circumference * (1 - capsuleState.ratio)
      : circumference;

  return (
    <div className="goal-progress-stack" data-testid="goal-progress-bar">
      {/* Collapsible Goal Bar */}
      <div className="goal-progress-bar">
        <Button
          type="button"
          variant="ghost"
          className="goal-progress-bar-header goal-progress-toggle-btn"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={`${t("goal.progressLabel")} · ${proposal.title} · ${expanded ? t("chat.subagentTaskCollapse") : t("chat.subagentTaskExpand")}`}
        >
          <span className="goal-progress-bar-left">
            <span className="goal-progress-capsule">
              <span className="goal-progress-scope">{t("goal.progressLabel")}</span>
              {!pendingTeamReview && (capsuleState.kind === "initializing" || capsuleState.kind === "indeterminate") ? (
                <span className="goal-progress-indeterminate" aria-hidden="true" />
              ) : !pendingTeamReview && capsuleState.kind === "progress" ? (
                <>
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 16 16"
                    className="goal-progress-ring"
                    aria-hidden="true"
                  >
                    <circle
                      cx={8}
                      cy={8}
                      r={6}
                      fill="none"
                      stroke="color-mix(in oklab, var(--ds-text-primary) 15%, transparent)"
                      strokeWidth={2}
                    />
                    <circle
                      cx={8}
                      cy={8}
                      r={6}
                      fill="none"
                      stroke="var(--ds-success)"
                      strokeWidth={2}
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      strokeLinecap="round"
                      transform="rotate(-90 8 8)"
                      className="goal-progress-ring-circle"
                    />
                  </svg>
                  <span className="goal-progress-capsule-text">
                    <span className="goal-progress-completed-num">
                      {capsuleState.completedCount}
                    </span>
                    <span className="goal-progress-total-num">
                      /{capsuleState.totalCount}
                    </span>
                  </span>
                </>
              ) : null}
            </span>
            <span className="goal-progress-bar-title" title={proposal.title}>{proposal.title}</span>
          </span>
          <span
            className="goal-progress-badge"
            data-state={proposal.executionState}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={!pendingTeamReview && capsuleState.kind === "progress"
              ? `${t("goal.progressLabel")} ${capsuleState.completedCount}/${capsuleState.totalCount} · ${stateBadgeText}`
              : stateBadgeText}
          >{stateBadgeText}</span>
          {expanded ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
        </Button>

        {expanded ? (
          <div id={listId} className="goal-progress-expanded-content">
            <div className="goal-progress-body-text">
              {proposal.markdown || proposal.plan}
            </div>
            {items.length > 0 ? (
              <div className="goal-progress-items-container" role="list" aria-label={t("goal.progressListLabel")}>
                {items.map((item) => (
                  <div className="goal-progress-item-entry" role="listitem" key={item.id}>
                    <span
                      className="goal-progress-item-dot"
                      data-status={item.status}
                      aria-hidden="true"
                    />
                    <span
                      className="goal-progress-item-label"
                      data-status={item.status}
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
