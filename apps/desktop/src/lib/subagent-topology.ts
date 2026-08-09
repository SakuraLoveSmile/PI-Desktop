import type { UiMessage } from "@pi-desktop/shared";
import type { AssistantActivityItem } from "./assistant-turns";
import { getToolAction } from "./tool-display";
import { toolResultPayload } from "./tool-presentation";

export type DelegationActivityItem = Extract<
  AssistantActivityItem,
  { kind: "tool" }
>;

export type SubagentOutcome =
  | "running"
  | "completed"
  | "truncated"
  | "aborted"
  | "failed"
  | "denied";

export function isDelegationActivityItem(
  item: AssistantActivityItem,
): item is DelegationActivityItem {
  return (
    item.kind === "tool" && getToolAction(item.message.toolName) === "delegate"
  );
}

export function subagentOutcome(message: UiMessage): SubagentOutcome {
  const payload = toolResultPayload(message);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const status = (payload as { status?: unknown }).status;
    if (
      status === "completed" ||
      status === "truncated" ||
      status === "aborted" ||
      status === "failed"
    ) {
      return status;
    }
  }
  if (message.toolStatus === "running") return "running";
  if (message.toolStatus === "error") return "failed";
  if (message.toolStatus === "denied") return "denied";
  return "completed";
}

export function summarizeSubagentActivity(
  items: readonly DelegationActivityItem[],
) {
  const outcomes = items.map((item) => subagentOutcome(item.message));
  return {
    total: outcomes.length,
    finished: outcomes.filter((outcome) => outcome !== "running").length,
    running: outcomes.filter((outcome) => outcome === "running").length,
    issues: outcomes.filter(
      (outcome) => outcome === "failed" || outcome === "denied",
    ).length,
    warnings: outcomes.filter(
      (outcome) => outcome === "truncated" || outcome === "aborted",
    ).length,
  };
}
