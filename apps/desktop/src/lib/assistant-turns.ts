import type { MessageUsage, UiMessage } from "@pi-desktop/shared";

export type AssistantActivityItem =
  | { kind: "thinking"; message: UiMessage }
  | { kind: "tool"; message: UiMessage };

export type AssistantTurnPart =
  | { kind: "message"; message: UiMessage }
  | {
      kind: "activity";
      items: AssistantActivityItem[];
      endedAt?: string;
    };

export type AssistantTurnEntry = {
  kind: "assistant-turn";
  id: string;
  anchorId?: string;
  parts: AssistantTurnPart[];
};

export type TranscriptEntry =
  | { kind: "message"; message: UiMessage }
  | AssistantTurnEntry;

export function messageThinking(message: UiMessage): string {
  if (typeof message.thinking !== "string") return "";
  return message.thinking.trim() ? message.thinking : "";
}

function isVisibleMessage(message: UiMessage): boolean {
  return !(
    message.role === "assistant" &&
    !(message.content || "").trim() &&
    !messageThinking(message) &&
    !message.error
  );
}

/**
 * Group provider-level assistant fragments and tool rows into user-level turns.
 * Providers end an assistant message before each tool call, but that transport
 * boundary is not a separate conversational response.
 */
export function buildTranscriptEntries(messages: UiMessage[]): {
  entries: TranscriptEntry[];
  visible: UiMessage[];
} {
  const visible = messages.filter(isVisibleMessage);
  const entries: TranscriptEntry[] = [];
  let turn: AssistantTurnEntry | undefined;

  const ensureTurn = (message: UiMessage) => {
    if (turn) return turn;
    turn = {
      kind: "assistant-turn",
      id: message.id,
      parts: [],
    };
    entries.push(turn);
    return turn;
  };

  const pushActivity = (item: AssistantActivityItem) => {
    const current = ensureTurn(item.message);
    const last = current.parts[current.parts.length - 1];
    if (last?.kind === "activity") last.items.push(item);
    else current.parts.push({ kind: "activity", items: [item] });
  };

  for (const message of visible) {
    if (message.role === "user" || message.role === "system") {
      turn = undefined;
      entries.push({ kind: "message", message });
      continue;
    }

    if (message.role === "tool") {
      pushActivity({ kind: "tool", message });
      continue;
    }

    const current = ensureTurn(message);
    const thinking = messageThinking(message);
    if (thinking) pushActivity({ kind: "thinking", message });
    if ((message.content || "").trim() || !thinking || message.error) {
      current.parts.push({ kind: "message", message });
      if (!current.anchorId && (message.content || "").trim()) {
        current.anchorId = message.id;
      }
    }
  }

  for (const entry of entries) {
    if (entry.kind !== "assistant-turn") continue;
    for (let index = 0; index < entry.parts.length; index += 1) {
      const part = entry.parts[index];
      const next = entry.parts[index + 1];
      if (
        part.kind === "activity" &&
        next?.kind === "message" &&
        !part.items.some((item) => item.message.id === next.message.id)
      ) {
        part.endedAt = next.message.createdAt;
      }
    }
  }

  return { entries, visible };
}

export function assistantTurnMessages(
  entry: AssistantTurnEntry,
): UiMessage[] {
  return entry.parts.flatMap((part) =>
    part.kind === "message" ? [part.message] : [],
  );
}

export function assistantTurnTools(entry: AssistantTurnEntry): UiMessage[] {
  return entry.parts.flatMap((part) =>
    part.kind === "activity"
      ? part.items.flatMap((item) =>
          item.kind === "tool" ? [item.message] : [],
        )
      : [],
  );
}

export function assistantTurnStreamingMessage(
  entry: AssistantTurnEntry,
): UiMessage | undefined {
  for (
    let partIndex = entry.parts.length - 1;
    partIndex >= 0;
    partIndex -= 1
  ) {
    const part = entry.parts[partIndex];
    if (
      part.kind === "message" &&
      part.message.role === "assistant" &&
      part.message.status === "streaming"
    ) {
      return part.message;
    }
    if (part.kind !== "activity") continue;
    for (
      let itemIndex = part.items.length - 1;
      itemIndex >= 0;
      itemIndex -= 1
    ) {
      const item = part.items[itemIndex];
      if (
        item.kind === "thinking" &&
        item.message.role === "assistant" &&
        item.message.status === "streaming"
      ) {
        return item.message;
      }
    }
  }
  return undefined;
}

export function assistantTurnResponseDuration(
  entry: AssistantTurnEntry,
): number | undefined {
  const messages = new Map<string, UiMessage>();
  for (const part of entry.parts) {
    if (part.kind === "message") {
      messages.set(part.message.id, part.message);
      continue;
    }
    for (const item of part.items) {
      if (item.kind === "thinking") {
        messages.set(item.message.id, item.message);
      }
    }
  }
  const durations = [...messages.values()].flatMap((message) =>
    typeof message.responseDurationMs === "number" &&
    Number.isFinite(message.responseDurationMs) &&
    message.responseDurationMs > 0
      ? [message.responseDurationMs]
      : [],
  );
  if (durations.length === 0) return undefined;
  return durations.reduce((total, duration) => total + duration, 0);
}

export function assistantTurnContent(entry: AssistantTurnEntry): string {
  return assistantTurnMessages(entry)
    .map((message) => (message.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function assistantTurnUsage(
  entry: AssistantTurnEntry,
): MessageUsage | undefined {
  const usages = assistantTurnMessages(entry).flatMap((message) =>
    message.usage ? [message.usage] : [],
  );
  if (usages.length === 0) return undefined;

  const sum = (field: keyof MessageUsage) =>
    usages.reduce((total, usage) => total + (usage[field] ?? 0), 0);
  const optionalSum = (
    field: "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens",
  ) =>
    usages.some((usage) => usage[field] !== undefined) ? sum(field) : undefined;
  const cacheReadTokens = optionalSum("cacheReadTokens");
  const cacheWriteTokens = optionalSum("cacheWriteTokens");
  const reasoningTokens = optionalSum("reasoningTokens");

  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}
