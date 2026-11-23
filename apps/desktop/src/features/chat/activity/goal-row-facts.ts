import type { PlanProposal } from "@pi-desktop/shared";
import type { GoalActivityState } from "../../../stores/runtime/goal-activity-runtime";
import { activityRowState } from "./ActivityRowStatus";

/**
 * What the Goal row and the Goal section's folded heading both read from one goal: its step count, the report's state
 * and whether the goal is done. One rule, so the folded heading never disagrees with the row it stands in for.
 */
export function goalRowFacts(goal: Pick<GoalActivityState, "progress" | "reportState" | "reportError">,
  proposal: Pick<PlanProposal, "executionState" | "status">) {
  const completed = goal.progress?.items.filter((item) => item.status === "completed").length ?? 0;
  const total = goal.progress?.items.length ?? 0;
  const reportState = goal.reportError && goal.reportState !== "failed" && goal.reportState !== "blocked" ? "unavailable" as const : goal.reportState;
  const status = reportState === "blocked" ? "degraded" : proposal.executionState ?? proposal.status;
  const done = (total > 0 && completed === total) || activityRowState(status) === "done";
  return { completed, total, reportState, status, done };
}

export type GoalFoldedSummaryKind = "failed" | "done" | "steps" | "unknown";

/** What a folded Goal heading says: a failed report first, then a finished goal, then the step count; before any of those it says nothing of its own. */
export function goalFoldedSummaryKind(facts: ReturnType<typeof goalRowFacts>): GoalFoldedSummaryKind {
  if (facts.reportState === "failed") return "failed";
  if (facts.done) return "done";
  return facts.total > 0 ? "steps" : "unknown";
}
