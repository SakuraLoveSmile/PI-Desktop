import type { TeamMessageRecord } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

export interface PendingMailboxSummary {
  pendingMessagesCount: number;
  pendingMessageSenders: string[];
  oldestPendingMessageAgeSeconds: number | null;
}

function createdAtMillis(message: TeamMessageRecord): number | undefined {
  if (!message.createdAt?.trim()) return undefined;
  const timestamp = Number(message.createdAt);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : undefined;
}

/** ACK is a queue receipt, not evidence that the authenticated body was consumed. */
export function summarizePendingMailbox(
  messages: readonly TeamMessageRecord[], callerSessionId: string, now: number,
): PendingMailboxSummary {
  const pending = messages.filter(message => message.targetSessionId === callerSessionId &&
    message.sourceSessionId !== callerSessionId && message.status === "queued" && message.turnId == null)
    .map(message => ({ message, timestamp: createdAtMillis(message) }))
    .sort((a, b) => {
      const left = a.timestamp ?? Infinity, right = b.timestamp ?? Infinity;
      if (left !== right) return left < right ? -1 : 1;
      return a.message.id < b.message.id ? -1 : a.message.id === b.message.id ? 0 : 1;
    });
  const senders = new Set<string>();
  for (const { message } of pending) if (message.sourceMemberName) senders.add(message.sourceMemberName);
  // An undated report may be older than every dated report; do not guess its age.
  const oldest = pending.some(entry => entry.timestamp === undefined) ? undefined : pending[0]?.timestamp;
  return {
    pendingMessagesCount: pending.length,
    pendingMessageSenders: [...senders],
    oldestPendingMessageAgeSeconds: oldest === undefined ? null : Math.max(0, Math.floor((now - oldest) / 1000)),
  };
}

export async function readPendingMailbox(host: RuntimeHost, teamSessionId: string, callerSessionId: string) {
  const { messages } = await host.call<{ messages: TeamMessageRecord[] }>("team.listMessages", {
    teamSessionId, callerSessionId, sessionId: callerSessionId,
  });
  return { count: messages.length, summary: summarizePendingMailbox(messages, callerSessionId, Date.now()) };
}

export function pendingMailboxNextStep(mode: string | undefined, approvedExecution: boolean): string {
  if (approvedExecution) return "Expert messages are pending. Use wait_for_updates to consume the authenticated execution inbox in this approved turn; do not end the execution turn to retrieve reports.";
  if (mode === "plan") return "Expert messages are pending. Finish the current aggregation turn to let the mailbox consume their full contents; do not keep waiting while holding the Lead turn. Resume synthesis after those messages are consumed, then call SubmitPlan.";
  return "Expert reports are queued and their authenticated bodies will arrive after you end the current turn. This summary does not consume their contents. Do not redo delegated work that has already completed; finish this turn to receive the reports.";
}
