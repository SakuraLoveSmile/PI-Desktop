import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GoalReportChangedEvent, PlanProposal } from "@pi-desktop/shared";
import { api } from "../../../lib/api";
import { IconChevronDown, IconChevronRight } from "../../../components/icons";
import { usePendingTeamExecutionReview } from "../../../hooks/useTeamExecutionReview";
import { useAppStore } from "../../../stores/app-store";
import {
  shouldShowGoalProgressBar,
  resolveGoalCapsuleState,
  selectExecutionProgressState,
  shouldAcceptGoalProgressSnapshot,
  type GoalProgressViewState,
} from "../../../lib/goal-progress-presentation";

const sessionCollapsePreferences = new Map<string, boolean>();

export type GoalProgressBarProps = {
  sessionId: string;
  proposal: PlanProposal;
};

export function GoalProgressBar({ sessionId, proposal }: GoalProgressBarProps) {
  const { t } = useTranslation();
  const currentExecution = useAppStore((state) => state.planCheckpoints[sessionId]);
  const isCurrentExecution = proposal.sessionId === sessionId &&
    currentExecution?.id === proposal.id && currentExecution.executionId === proposal.executionId &&
    currentExecution.executionState === "running" && proposal.executionState === "running";
  const pendingTeamReview = usePendingTeamExecutionReview(sessionId, isCurrentExecution);
  const [expanded, setExpanded] = useState<boolean>(() => {
    return sessionCollapsePreferences.get(sessionId) ?? false;
  });
  const executionId = proposal.executionId ?? "";
  const stateKey = `${sessionId}\u0000${executionId}`;
  const [progressState, setProgressState] = useState<GoalProgressViewState>(() => ({
    executionId: stateKey,
    progress: null,
    reportReady: false,
    error: null,
    loading: Boolean(executionId),
  }));
  const currentState = selectExecutionProgressState(progressState, stateKey);
  const { progress, loading, error, reportReady } = currentState;

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

  // Poll / subscribe to report status and progress snapshot
  useEffect(() => {
    if (!executionId) {
      setProgressState({
        executionId: stateKey,
        progress: null,
        reportReady: false,
        error: null,
        loading: false,
      });
      return;
    }

    let isMounted = true;
    let progressRequestSequence = 0;
    const resetState = () => setProgressState({
      executionId: stateKey,
      progress: null,
      reportReady: false,
      error: null,
      loading: true,
    });
    resetState();

    // Check existing report status
    api.getGoalReport({ sessionId, executionId })
      .then((res) => {
        if (isMounted && res?.report?.status === "ready") {
          setProgressState((state) => state.executionId === stateKey
            ? { ...state, reportReady: true }
            : state);
        }
      })
      .catch(() => {
        // Report might not exist yet
      });

    // Check existing progress
    const initialRequestSequence = ++progressRequestSequence;
    api.getGoalProgress({ sessionId, executionId })
      .then((res) => {
        if (isMounted && initialRequestSequence === progressRequestSequence) {
          const candidate = res?.progress ?? null;
          const incoming = candidate?.executionId === executionId && candidate.sessionId === sessionId
            ? candidate
            : null;
          setProgressState((state) => {
            if (state.executionId !== stateKey) return state;
            return {
              ...state,
              progress: shouldAcceptGoalProgressSnapshot(state.progress, incoming)
                ? incoming
                : state.progress,
              error: null,
              loading: false,
            };
          });
        }
      })
      .catch((err: unknown) => {
        if (isMounted && initialRequestSequence === progressRequestSequence) {
          setProgressState((state) => state.executionId === stateKey
            ? { ...state, error: err instanceof Error ? err.message : String(err), loading: false }
            : state);
        }
      });

    // Subscribe to report changes
    const unsubReport = api.onGoalReportChanged((event: GoalReportChangedEvent) => {
      if (!isMounted) return;
      if (event?.sessionId === sessionId && event?.executionId === executionId && event?.status === "ready") {
        setProgressState((state) => state.executionId === stateKey
          ? { ...state, reportReady: true }
          : state);
      }
    });

    // Subscribe to progress changes
    const unsubProgress = api.onGoalProgressChanged((event) => {
      if (!isMounted) return;
      if (event?.sessionId === sessionId && event?.executionId === executionId) {
        const requestSequence = ++progressRequestSequence;
        api.getGoalProgress({ sessionId, executionId })
          .then((res) => {
            if (isMounted && requestSequence === progressRequestSequence) {
              const candidate = res?.progress ?? null;
              const incoming = candidate?.executionId === executionId && candidate.sessionId === sessionId
                ? candidate
                : null;
              setProgressState((state) => {
                if (state.executionId !== stateKey) return state;
                return {
                  ...state,
                  progress: shouldAcceptGoalProgressSnapshot(state.progress, incoming)
                    ? incoming
                    : state.progress,
                  error: null,
                  loading: false,
                };
              });
            }
          })
          .catch((err: unknown) => {
            if (isMounted && requestSequence === progressRequestSequence) {
              setProgressState((state) => state.executionId === stateKey
                ? { ...state, error: err instanceof Error ? err.message : String(err) }
                : state);
            }
          });
      }
    });

    return () => {
      isMounted = false;
      unsubReport();
      unsubProgress();
    };
  }, [sessionId, executionId, stateKey]);

  if (!shouldShowGoalProgressBar({ proposal, reportReady })) {
    return null;
  }

  const capsuleState = resolveGoalCapsuleState({
    loading,
    error,
    progress,
    labels: {
      initializing: t("goal.progressInitializing", "准备中..."),
      failed: t("goal.progressFailed", "进度读取失败"),
    },
  });

  const items = progress?.items ?? [];

  const stateBadgeText =
    pendingTeamReview
      ? t("team.review.status.pending")
      : proposal.executionState === "queued"
      ? t("chat.scheduleExecutionState.queued", "排队中")
      : proposal.executionState === "interrupted"
      ? t("chat.scheduleExecutionState.interrupted", "已中断")
      : proposal.executionState === "completed"
      ? t("chat.scheduleExecutionState.completed", "已完成")
      : t("chat.scheduleExecutionState.running", "执行中");

  const circumference = 37.7; // 2 * pi * 6
  const dashOffset =
    capsuleState.kind === "progress"
      ? circumference * (1 - capsuleState.ratio)
      : circumference;

  return (
    <div className="goal-progress-stack" data-testid="goal-progress-bar">
      {/* Centered Progress Capsule */}
      <div className="goal-progress-capsule" role="status" aria-live="polite">
        {pendingTeamReview && capsuleState.kind !== "error" ? (
          <span className="goal-progress-status-text">
            {t("team.review.status.pending")}
          </span>
        ) : capsuleState.kind === "error" || capsuleState.kind === "initializing" ? (
          <span className="goal-progress-status-text">
            {capsuleState.message}
          </span>
        ) : (
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
        )}
      </div>

      {/* Collapsible Goal Bar */}
      <div className="goal-progress-bar">
        <div className="goal-progress-bar-header">
          <div className="goal-progress-bar-left">
            <span
              className="goal-progress-badge"
              data-state={proposal.executionState}
            >
              {stateBadgeText}
            </span>
            <span
              className="goal-progress-bar-title"
              title={proposal.title}
            >
              {proposal.title}
            </span>
          </div>
          <button
            type="button"
            className="goal-progress-toggle-btn"
            onClick={toggleExpanded}
            aria-label={
              expanded
                ? t("chat.subagentTaskCollapse")
                : t("chat.subagentTaskExpand")
            }
          >
            <span>
              {expanded
                ? t("chat.subagentTaskCollapse")
                : t("chat.subagentTaskExpand")}
            </span>
            {expanded ? (
              <IconChevronDown size={14} aria-hidden />
            ) : (
              <IconChevronRight size={14} aria-hidden />
            )}
          </button>
        </div>

        {expanded ? (
          <div className="goal-progress-expanded-content">
            <div className="goal-progress-body-text">
              {proposal.markdown || proposal.plan}
            </div>
            {items.length > 0 ? (
              <div className="goal-progress-items-container">
                {items.map((item) => (
                  <div className="goal-progress-item-entry" key={item.id}>
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
