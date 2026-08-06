import type { MessageUsage, UiMessage } from "@pi-desktop/shared";

export type AssistantActivityItem =
  | { kind: "thinking"; message: UiMessage }
  | {
      kind: "tool";
      message: UiMessage;
      /** Present on a `Task` call: what the delegate it spawned did. */
      delegate?: SubagentRun;
    };

/** One row a delegate produced, in the order the delegate produced it. */
export type SubagentRunItem =
  | { kind: "thinking"; message: UiMessage }
  | { kind: "tool"; message: UiMessage }
  | { kind: "answer"; message: UiMessage };

/**
 * Everything one delegate did inside a single `Task` call (ADR 0060).
 *
 * Delegate rows arrive on the session stream interleaved with the parent's —
 * parallel delegates guarantee it — so they are collected by the `Task` call
 * that spawned them and rendered under it. That mirrors the model's view: the
 * parent only ever sees the report, never these rows.
 */
export type SubagentRun = {
  /** Definition name, when the runtime attributed the rows to one. */
  agentName?: string;
  items: SubagentRunItem[];
};

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

/** Delegate rows grouped by the `Task` call that produced them. */
function collectSubagentRuns(
  messages: readonly UiMessage[],
): Map<string, SubagentRun> {
  const runs = new Map<string, SubagentRun>();
  for (const message of messages) {
    const parent = message.parentToolCallId;
    if (!parent) continue;
    let run = runs.get(parent);
    if (!run) {
      run = { items: [] };
      runs.set(parent, run);
    }
    if (message.agentName && !run.agentName) run.agentName = message.agentName;
    if (message.role === "tool") {
      run.items.push({ kind: "tool", message });
      continue;
    }
    // A delegate turn can carry reasoning and text at once, and both are worth
    // showing: the text is the only place its narration and report exist.
    const thinking = messageThinking(message);
    if (thinking) run.items.push({ kind: "thinking", message });
    if ((message.content || "").trim() || message.error) {
      run.items.push({ kind: "answer", message });
    }
  }
  return runs;
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
  const runs = collectSubagentRuns(messages);
  // Delegate rows are not transcript rows of their own: they hang off their
  // `Task` call, so they stay out of the turn stream and the minimap.
  const visible = messages.filter(
    (message) => !message.parentToolCallId && isVisibleMessage(message),
  );
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
      const delegate = message.toolCallId
        ? runs.get(message.toolCallId)
        : undefined;
      pushActivity({
        kind: "tool",
        message,
        ...(delegate ? { delegate } : {}),
      });
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

/**
 * Whether two delegate runs render the same rows.
 *
 * `buildTranscriptEntries` rebuilds run objects on every message change, so
 * memoized activity groups cannot compare them by identity; without this a
 * delegate's rows would either never update or re-render on every tick.
 */
export function subagentRunsEqual(
  previous: SubagentRun | undefined,
  next: SubagentRun | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  if (
    previous.agentName !== next.agentName ||
    previous.items.length !== next.items.length
  ) {
    return false;
  }
  return previous.items.every(
    (item, index) =>
      item.kind === next.items[index].kind &&
      item.message === next.items[index].message,
  );
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

export function assistantTurnResponseDuration(
  entry: AssistantTurnEntry,
): number | undefined {
  const durations = assistantTurnMessages(entry).flatMap((message) =>
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
