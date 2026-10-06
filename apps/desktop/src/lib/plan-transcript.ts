import type { PlanProposal, UiMessage } from "@pi-desktop/shared";
import type {
  AssistantTurnEntry,
  AssistantTurnPart,
  TranscriptEntry,
} from "./assistant-turns";

function entryMessages(entry: TranscriptEntry): UiMessage[] {
  if (entry.kind === "compaction") return [];
  if (entry.kind === "message") return [entry.message];
  return entry.parts.flatMap((part) => part.kind === "message"
    ? [part.message]
    : part.items.map((item) => item.message));
}

export type PlanTranscriptIndex = {
  byEntry: ReadonlyMap<string, readonly PlanProposal[]>;
  beforeEntries: readonly PlanProposal[];
};

export function planTranscriptEntryKey(entry: TranscriptEntry): string {
  if (entry.kind === "compaction") return entry.mark.id;
  return entry.kind === "assistant-turn" ? entry.id : entry.message.id;
}

/** Keep proposal placement independent of its changing execution status. */
export function buildPlanTranscriptIndex(
  entries: readonly TranscriptEntry[],
  proposals: readonly PlanProposal[],
  sessionId: string | undefined,
  previous?: PlanTranscriptIndex,
): PlanTranscriptIndex {
  const byEntry = new Map<string, readonly PlanProposal[]>();
  const beforeEntries: PlanProposal[] = [];
  const toolOwners = new Map<string, string>();
  const timedEntries: Array<{ key: string; at: number }> = [];
  for (const entry of entries) {
    const key = planTranscriptEntryKey(entry);
    const messages = entryMessages(entry);
    if (messages.length) timedEntries.push({ key, at: Date.parse(messages[0].createdAt) });
    for (const message of messages) {
      if (message.role === "tool" && message.toolCallId && !message.parentToolCallId) {
        toolOwners.set(message.toolCallId, key);
      }
    }
  }
  const unique = new Map<string, PlanProposal>();
  for (const proposal of proposals) {
    if (sessionId && proposal.sessionId === sessionId) unique.set(proposal.id, proposal);
  }
  const ordered = [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const proposal of ordered) {
    let key = toolOwners.get(proposal.toolCallId);
    if (!key) {
      // Older/paged transcripts may lack the submit row. Insert at the original
      // chronological boundary, never after later execution output.
      const at = Date.parse(proposal.createdAt);
      for (const entry of timedEntries) {
        if (entry.at <= at) key = entry.key;
      }
    }
    if (!key) {
      beforeEntries.push(proposal);
      continue;
    }
    byEntry.set(key, [...(byEntry.get(key) ?? []), proposal]);
  }
  // Keep unaffected turns memoized when one proposal changes status.
  for (const [key, group] of byEntry) {
    const existing = previous?.byEntry.get(key);
    if (existing && existing.length === group.length && group.every((item, index) => item === existing[index])) {
      byEntry.set(key, existing);
    }
  }
  return { byEntry, beforeEntries };
}

export type PlanTurnSection = {
  key: string;
  parts: AssistantTurnPart[];
  proposal?: PlanProposal;
};

/** A SubmitPlan/SubmitGoal card divides one contiguous assistant turn. */
export function splitPlanTurn(
  entry: AssistantTurnEntry,
  proposals: readonly PlanProposal[],
): PlanTurnSection[] {
  if (!proposals.length) return [{ key: entry.id, parts: entry.parts }];
  const toolCalls = new Set(entryMessages(entry).filter((message) => message.role === "tool" && !message.parentToolCallId)
    .map((message) => message.toolCallId));
  const byCall = new Map(proposals.filter((proposal) => toolCalls.has(proposal.toolCallId))
    .map((proposal) => [proposal.toolCallId, proposal]));
  const fallback = proposals.filter((proposal) => !toolCalls.has(proposal.toolCallId));
  const sections: PlanTurnSection[] = [];
  let parts: AssistantTurnPart[] = [];
  let key = entry.id;
  const close = (proposal: PlanProposal) => {
    sections.push({ key, parts, proposal });
    key = proposal.id;
    parts = [];
  };
  const insertEarlier = (at: string) => {
    while (fallback.length && Date.parse(fallback[0].createdAt) < Date.parse(at)) {
      close(fallback.shift()!);
    }
  };
  for (const part of entry.parts) {
    if (part.kind === "message") {
      insertEarlier(part.message.createdAt);
      parts.push(part);
      continue;
    }
    let start = 0;
    for (let index = 0; index < part.items.length; index += 1) {
      const item = part.items[index];
      if (fallback.length && Date.parse(fallback[0].createdAt) < Date.parse(item.message.createdAt)) {
        if (index > start) parts.push({ ...part, items: part.items.slice(start, index), endedAt: undefined });
        insertEarlier(item.message.createdAt);
        start = index;
      }
      const proposal = item.kind === "tool" && !item.message.parentToolCallId && item.message.toolCallId
        ? byCall.get(item.message.toolCallId)
        : undefined;
      if (!proposal) continue;
      parts.push({ ...part, items: part.items.slice(start, index + 1), endedAt: item.message.toolCompletedAt });
      close(proposal);
      byCall.delete(proposal.toolCallId);
      start = index + 1;
    }
    if (start < part.items.length) {
      parts.push(start === 0 ? part : { ...part, items: part.items.slice(start) });
    }
  }
  for (const proposal of fallback) close(proposal);
  if (parts.length) sections.push({ key, parts });
  return sections;
}
