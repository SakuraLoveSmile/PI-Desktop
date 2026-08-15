import type { UiMessage } from "@pi-desktop/shared";
import type { AssistantActivityItem } from "./assistant-turns";
import { getToolAction, isDelegationStartTool } from "./tool-display";
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
  | "stopped"
  | "denied";

export function isDelegationActivityItem(
  item: AssistantActivityItem,
): item is DelegationActivityItem {
  // Only the tool that STARTS a subagent is a delegation activity item (ADR
  // 0062): the lifecycle tools (TaskWait/TaskList/TaskStop, ADR 0089) drive an
  // existing delegation and must not inflate the topology's subagent counts.
  return (
    item.kind === "tool" &&
    isDelegationStartTool(item.message.toolName) &&
    getToolAction(item.message.toolName) === "delegate"
  );
}

const DELEGATION_STATUSES = new Set<SubagentOutcome>([
  "running",
  "completed",
  "truncated",
  "aborted",
  "failed",
  "stopped",
]);

function asDelegationStatus(value: unknown): SubagentOutcome | null {
  return DELEGATION_STATUSES.has(value as SubagentOutcome)
    ? (value as SubagentOutcome)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Latest status per delegation id, read from the lifecycle tools' results.
 *
 * `Task` returns the moment the delegate starts (ADR 0089), so its own result
 * says `running` for the rest of the transcript no matter how the delegate
 * ended. TaskWait/TaskList/TaskStop each report `details.delegations[]` with
 * the live status, so their rows — which are deliberately not topology nodes —
 * are what tells a delegation card how its subagent actually finished.
 */
export function collectDelegationStatuses(
  items: readonly AssistantActivityItem[],
): ReadonlyMap<string, SubagentOutcome> {
  const statuses = new Map<string, SubagentOutcome>();
  for (const item of items) {
    if (item.kind !== "tool") continue;
    // Read the row before the guard narrows `item` away: every tool item is a
    // potential delegation node, so excluding them leaves TS with `never`.
    const { message } = item;
    if (isDelegationActivityItem(item)) continue;
    const payload = asRecord(toolResultPayload(message));
    const delegations = payload?.delegations;
    if (!Array.isArray(delegations)) continue;
    for (const entry of delegations) {
      const record = asRecord(entry);
      const id = record?.delegationId;
      const status = asDelegationStatus(record?.status);
      // Later rows win: a delegation reported running by an early TaskList is
      // settled by the TaskWait that follows it.
      if (typeof id === "string" && id && status) statuses.set(id, status);
    }
  }
  return statuses;
}

export function subagentOutcome(
  message: UiMessage,
  statuses?: ReadonlyMap<string, SubagentOutcome>,
): SubagentOutcome {
  const payload = asRecord(toolResultPayload(message));
  if (payload) {
    const delegationId = payload.delegationId;
    if (typeof delegationId === "string") {
      const settled = statuses?.get(delegationId);
      if (settled) return settled;
    }
    const status = asDelegationStatus(payload.status);
    if (status) return status;
  }
  if (message.toolStatus === "running") return "running";
  if (message.toolStatus === "error") return "failed";
  if (message.toolStatus === "denied") return "denied";
  return "completed";
}

export function summarizeSubagentActivity(
  items: readonly DelegationActivityItem[],
  statuses?: ReadonlyMap<string, SubagentOutcome>,
) {
  const outcomes = items.map((item) => subagentOutcome(item.message, statuses));
  return {
    total: outcomes.length,
    finished: outcomes.filter((outcome) => outcome !== "running").length,
    running: outcomes.filter((outcome) => outcome === "running").length,
    issues: outcomes.filter(
      (outcome) => outcome === "failed" || outcome === "denied",
    ).length,
    warnings: outcomes.filter(
      (outcome) =>
        outcome === "truncated" ||
        outcome === "aborted" ||
        outcome === "stopped",
    ).length,
  };
}
