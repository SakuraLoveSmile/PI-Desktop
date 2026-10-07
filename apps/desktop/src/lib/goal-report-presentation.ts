import type { GoalReportChangedEvent, GoalReportSummary } from "@pi-desktop/shared";

/**
 * Determines whether a goal report should be rendered in the chat transcript.
 * Only completed executions may present a ready report or publication-failure card.
 * Interrupted executions and historical interruption reports are not completion results.
 */
export function shouldPresentGoalReportInTranscript(
  report: GoalReportSummary | null | undefined,
): boolean {
  if (!report) return false;
  if (report.status !== "ready" && report.status !== "failed") return false;
  return report.executionStatus === "completed";
}

/**
 * Determines whether a `goalReports.changed` event should trigger automatically
 * opening the right-hand goal report work panel.
 *
 * Constraints:
 * 1. The report must belong to the currently active session.
 * 2. A matching refreshed report must be ready for a completed execution.
 * 3. The execution must not have been auto-opened previously (at most once per execution).
 */
export function shouldAutoOpenGoalReportWorkPanel({
  event,
  report,
  activeSessionId,
  openedExecutionIds,
}: {
  event: GoalReportChangedEvent;
  report?: GoalReportSummary | null;
  activeSessionId: string | null | undefined;
  openedExecutionIds?: ReadonlySet<string>;
}): boolean {
  if (!activeSessionId || event.sessionId !== activeSessionId) return false;
  if (event.status !== "ready") return false;
  if (report?.status !== "ready" || report.executionStatus !== "completed") return false;
  if (report.sessionId !== event.sessionId || report.executionId !== event.executionId ||
    report.reportId !== event.reportId) return false;
  if (openedExecutionIds?.has(event.executionId)) return false;
  return true;
}
