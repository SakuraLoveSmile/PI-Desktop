import type { PlanProposal, UiMessage } from "@pi-desktop/shared";
import { recordedOverviewResources } from "../../../components/workpanel/overview-recorded-resources";
import { delegateAgentName } from "../transcript/model";
import { isDelegationStartTool } from "../../../lib/tool-display";
import { delegationIdForMessage } from "../../../lib/subagent-panel";
import { delegateTaskDescription } from "../../../lib/subagent-transcript";
import { collectDelegationStatuses, collectDelegationTimings, subagentOutcome, type SubagentOutcome, type SubagentTiming } from "../../../lib/subagent-topology";
import { subagentItemTiming } from "./subagent-row-presentation";

/** Shared with Overview: only actual installed/pending session proposals. */
export function activityPlans(sessionId: string | undefined, pending?: PlanProposal, checkpoint?: PlanProposal, history: readonly PlanProposal[] = []): PlanProposal[] {
  if (!sessionId) return [];
  const seen = new Set<string>();
  return [pending, checkpoint, ...history].filter((proposal): proposal is PlanProposal => {
    if (!proposal || proposal.sessionId !== sessionId || seen.has(proposal.id)) return false;
    seen.add(proposal.id);
    return true;
  });
}

export type ActivitySubagent = { delegationId: string; agentName: string; task: string; status: SubagentOutcome; timing?: SubagentTiming };

/** Loaded transcript records, not a claim that unseen history has no work. */
export function activitySubagents(messages: readonly UiMessage[], running: boolean): ActivitySubagent[] {
  const items = messages.filter((message) => message.role === "tool").map((message) => ({ kind: "tool" as const, message }));
  const statuses = collectDelegationStatuses(items, { turnLive: running });
  const timings = collectDelegationTimings(items);
  const seen = new Set<string>();
  const result: ActivitySubagent[] = [];
  for (const message of messages) {
    if (message.role !== "tool" || !isDelegationStartTool(message.toolName)) continue;
    const delegationId = delegationIdForMessage(message);
    if (seen.has(delegationId)) continue;
    seen.add(delegationId);
    const timing = subagentItemTiming({ kind: "tool", message }, timings);
    result.push({ delegationId, agentName: delegateAgentName(message), task: delegateTaskDescription(message), status: subagentOutcome(message, statuses), ...(timing ? { timing } : {}) });
  }
  return result;
}

export function activityResources(messages: UiMessage[]) {
  const recorded = recordedOverviewResources(messages);
  const websites = new Map<string, { id: string; label: string; url: string }>();
  for (const message of messages) for (const round of message.hostedSearch?.rounds ?? []) {
    for (const source of round.sources ?? []) {
      try {
        const url = new URL(source.url);
        if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) continue;
        websites.set(url.href, { id: url.href, label: source.title || url.hostname, url: url.href });
      } catch { /* A malformed captured URL is not an actionable source. */ }
    }
  }
  return { ...recorded, websites: [...websites.values()] };
}
