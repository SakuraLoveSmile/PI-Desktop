import type { GoalReportChangedEvent, GoalReportSummary } from "@pi-desktop/shared";

/**
 * Determines whether a goal report should be rendered in the chat transcript.
 * Only reports that have reached terminal settlement ("ready" status and terminal execution
 * "completed" or "interrupted") are presented. In-flight drafts, pending, or failed executions
 * are excluded from completion card rendering.
 */
export function shouldPresentGoalReportInTranscript(
  report: GoalReportSummary | null | undefined,
): boolean {
  if (!report) return false;
  if (report.status !== "ready" && report.status !== "failed") return false;
  return (
    report.executionStatus === "completed" ||
    report.executionStatus === "interrupted"
  );
}

/**
 * Determines whether a `goalReports.changed` event should trigger automatically
 * opening the right-hand goal report work panel.
 *
 * Constraints:
 * 1. The report must belong to the currently active session.
 * 2. It must be a ready (final) report; draft, pending, or failed events do not trigger auto-open.
 * 3. The execution must not have been auto-opened previously (at most once per execution).
 */
export function shouldAutoOpenGoalReportWorkPanel({
  event,
  activeSessionId,
  openedExecutionIds,
}: {
  event: GoalReportChangedEvent;
  activeSessionId: string | null | undefined;
  openedExecutionIds?: ReadonlySet<string>;
}): boolean {
  if (!activeSessionId || event.sessionId !== activeSessionId) return false;
  if (event.status !== "ready") return false;
  if (openedExecutionIds?.has(event.executionId)) return false;
  return true;
}
