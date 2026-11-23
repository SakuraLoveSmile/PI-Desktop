import type { PlanProposal } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { useGoalActivity } from "../../../hooks/useGoalActivity";
import { goalFoldedSummaryKind, goalRowFacts } from "./goal-row-facts";

/**
 * What the Goal section's heading says once it is folded and holds one goal: the failed report in the failure colour,
 * the finished word in the success colour, otherwise how many steps are done (`3/6`). Until the goal's steps are known
 * the heading keeps its default counts. It reads the same shared reader as the goal's own row.
 */
export function GoalFoldedSummary({ sessionId, proposal, visible, fallback }: {
  sessionId: string; proposal: PlanProposal; visible: boolean; fallback: string;
}) {
  const { t } = useTranslation();
  const goal = useGoalActivity(sessionId, proposal.executionId, visible);
  const facts = goalRowFacts(goal, proposal);
  switch (goalFoldedSummaryKind(facts)) {
    case "failed": return <span data-tone="critical">{t("panel.activity.goal.reportFailed")}</span>;
    case "done": return <span data-tone="success">{t("panel.overview.status.completed")}</span>;
    case "steps": return <>{facts.completed}/{facts.total}</>;
    default: return <>{fallback}</>;
  }
}
