import { useLayoutEffect } from "react";
import type { PlanProposal } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { IconListChecks } from "../../../components/icons";
import { Badge, TooltipButton } from "../../../components/ui";
import type { GoalActivityReportState } from "../../../stores/runtime/goal-activity-runtime";
import { useGoalActivity } from "../../../hooks/useGoalActivity";
import { goalReportWorkPanelTab } from "../../../lib/work-panel-tabs";
import { useAppStore } from "../../../stores/app-store";
import { ActivityStatus } from "./ActivityStatus";

export function GoalActivityRow({ sessionId, proposal, visible, onOpenArtifact, onReportStateChange }: {
  sessionId: string; proposal: PlanProposal; visible: boolean; onOpenArtifact?: () => void;
  onReportStateChange?: (executionId: string, state: GoalActivityReportState) => void;
}) {
  const { t } = useTranslation();
  const goal = useGoalActivity(sessionId, proposal.executionId, visible);
  useLayoutEffect(() => {
    if (visible && goal.reportKnown && (!goal.reportError || goal.reportState === "failed") && proposal.executionId) onReportStateChange?.(proposal.executionId, goal.reportState);
  }, [visible, proposal.executionId, goal.reportState, goal.reportKnown, goal.reportError, onReportStateChange]);
  const open = useAppStore((state) => state.openWorkPanelTabForSession);
  const completed = goal.progress?.items.filter((item) => item.status === "completed").length ?? 0;
  const total = goal.progress?.items.length ?? 0;
  const reportState = goal.reportError && goal.reportState !== "failed" ? "unavailable" : goal.reportState;
  const reportKey = reportState === "fallback" ? "reportFallback" : reportState === "ready" ? "reportReady"
    : reportState === "failed" ? "reportFailed" : reportState === "unavailable" ? "reportUnavailable"
    : reportState === "generating" ? "reportGenerating" : "reportPending";
  const reportLabel = reportState === "none" && proposal.executionState === "interrupted"
    ? t("panel.overview.status.interrupted") : t(`panel.activity.goal.${reportKey}`);
  const progressLabel = goal.error ? t("goal.progressFailed") : total > 0 ? `${completed}/${total}` : t("panel.activity.goal.progressUnavailable");
  const title = proposal.title.trim() || proposal.question.trim();
  const canOpen = Boolean(proposal.executionId && (goal.reportState !== "none" || goal.reportError));
  const reportBadge = <Badge className="session-activity-goal-report" tone={reportState === "fallback" || reportState === "unavailable" ? "warning" : reportState === "failed" ? "error" : reportState === "ready" ? "success" : "neutral"}>{reportLabel}</Badge>;
  const status = proposal.executionState ?? proposal.status;
  return <div className="session-activity-goal-row" data-activity-id={proposal.id} data-goal-execution-id={proposal.executionId}>
    <div className="session-activity-goal-main">
      <span className="session-activity-icon" aria-hidden><IconListChecks size={15} /></span>
      {onOpenArtifact ? <TooltipButton type="button" className="session-activity-goal-title session-activity-goal-title-action"
        tooltip={title} onClick={onOpenArtifact}>{title}</TooltipButton>
        : <span className="session-activity-goal-title" title={title}>{title}</span>}
      <ActivityStatus status={status} label={t(`panel.overview.status.${status}`)} compact />
    </div>
    <div className="session-activity-goal-meta">
      <span className="session-activity-goal-progress" role="status" aria-live="polite">{progressLabel}</span>
      {canOpen ? <TooltipButton type="button" className="session-activity-goal-report-action" tooltip={t("panel.activity.goal.openReport")}
        ariaLabel={`${t("panel.activity.goal.openReport")} · ${title} · ${reportLabel}`}
        onClick={() => { if (proposal.executionId) open(sessionId, goalReportWorkPanelTab(proposal.executionId, title)); }}>{reportBadge}</TooltipButton>
        : <span role="status" aria-live="polite">{reportBadge}</span>}
    </div>
  </div>;
}
