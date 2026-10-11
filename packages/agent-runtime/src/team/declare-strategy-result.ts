import type { AgentMessage, AgentToolResult } from "@earendil-works/pi-agent-core";
import { DECLARE_TEAM_STRATEGY_TOOL_NAME, type TeamExecutionDecision, type TeamLaunchReview } from "@pi-desktop/shared";
import { isRecord } from "../agent-messages.js";

type DeclareStrategyResult = {
  decision: Pick<TeamExecutionDecision, "strategy" | "reason"> & Partial<TeamExecutionDecision>;
  review: TeamLaunchReview | null;
};

/** One payload rule for the live tool and the confirmed model-only projection. */
export function buildDeclareStrategyResult(result: DeclareStrategyResult, approvedExecution: boolean): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({
      strategy: result.decision.strategy,
      reason: result.decision.reason,
      reviewId: result.review?.reviewId,
      status: result.review?.status ?? "none",
      launchPolicy: result.review?.launchPolicy ?? "user_confirmed",
      awaitingUserApproval: result.review?.status === "pending",
      ...(result.review?.status === "pending" ? {
        nextStep: approvedExecution
          ? "Explain the proposal and keep this approved execution open while waiting for trusted roster confirmation. After confirmation use wait_for_updates to consume authenticated Team messages in this same execution; dispatch owned expert tasks and await their full results before completion."
          : "Explain the proposal and stop this turn. Wait for trusted user review confirmation before executing work or submitting a plan.",
      } : result.review?.status === "confirmed" ? {
        nextStep: result.review.launchPolicy === "automatic_plan"
          ? "The read-only researchers are ready automatically. Do not ask for roster confirmation or stop to explain dispatch: create owned research tasks, send_message each taskId to its researcher, and await full structured research results. Synthesize settled findings and questions, then call SubmitPlan for user approval of the implementation plan."
          : "The user confirmed the execution roster. Create owned tasks and dispatch the approved experts; await actual expert participation before substantive execution or completion.",
      } : {}),
      memberSessionIds: result.decision.memberSessionIds,
      members: result.review?.members.map(member => ({
        name: member.name, modelId: member.selection.modelId, providerId: member.selection.providerId,
      })),
    }) }],
    details: result,
  };
}

/** Never mutate the original tool event/entry: UI and persistence retain the pending timeline. */
export function refreshDeclareStrategyResult(messages: AgentMessage[], review: TeamLaunchReview): AgentMessage[] {
  if (review.status !== "confirmed") return messages;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "toolResult" || message.toolName !== DECLARE_TEAM_STRATEGY_TOOL_NAME || message.isError) continue;
    const details = message.details;
    if (!isRecord(details) || "error" in details || !isRecord(details.review) || details.review.reviewId !== review.reviewId) continue;
    if (!isRecord(details.decision) || details.decision.strategy !== "delegate" || typeof details.decision.reason !== "string") return messages;
    // getLaunchReview cannot refresh declaration-time session IDs. Omit the
    // stale snapshot; approved routing names suffice, or query team_status.
    const { memberSessionIds: _stale, ...snapshot } = details.decision;
    const decision = { ...snapshot, strategy: "delegate" as const, reason: details.decision.reason };
    const result = buildDeclareStrategyResult({ decision, review }, true);
    if (JSON.stringify(message.content) === JSON.stringify(result.content) &&
        JSON.stringify(details) === JSON.stringify(result.details)) return messages;
    const refreshed = [...messages];
    refreshed[index] = { ...message, content: result.content, details: result.details };
    return refreshed;
  }
  return messages;
}
