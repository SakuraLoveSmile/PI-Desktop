import type { UiMessage } from "@pi-desktop/shared";
import type { AssistantTurnEntry, AssistantTurnPart } from "./assistant-turns";

export type ThinkingDisplayMode = "detailed" | "compact";

export function resolveThinkingDisplayMode(value: unknown): ThinkingDisplayMode {
  return value === "compact" ? "compact" : "detailed";
}

export function isThinkingActive(message: UiMessage, active: boolean): boolean {
  return active && message.status === "streaming" && !message.content.trim();
}

/**
 * Only a trailing assistant text can be the answer: text followed by tools is
 * progress. The stream carries no final-answer marker, so a live trailing text
 * remains visible until a later activity establishes that it was intermediate.
 * Errors remain outside the disclosure even when more activity follows them.
 */
export function projectTurnProcess(entry: AssistantTurnEntry) {
  const last = entry.parts.at(-1);
  const answer =
    last?.kind === "message" && last.message.content.trim() ? last : undefined;
  const process: AssistantTurnPart[] = [];
  const responses: Extract<AssistantTurnPart, { kind: "message" }>[] = [];
  for (const part of entry.parts) {
    if (part.kind === "message" && (part === answer || part.message.error)) {
      responses.push(part);
    } else {
      process.push(part);
    }
  }
  return { process, responses };
}

export function visibleProcessSteps(
  parts: readonly AssistantTurnPart[],
  mode: ThinkingDisplayMode,
  active: boolean,
): number {
  return parts.reduce(
    (count, part) =>
      count +
      (part.kind === "message"
        ? Number(Boolean(part.message.content.trim()))
        : part.items.filter(
            (item) =>
              item.kind === "tool" ||
              mode === "detailed" ||
              isThinkingActive(item.message, active),
          ).length),
    0,
  );
}

/** Use recorded message/tool timing for history; elapsed live time is UI-only. */
export function turnProcessTiming(parts: readonly AssistantTurnPart[]) {
  const messages = parts.flatMap((part) =>
    part.kind === "message" ? [part.message] : part.items.map((item) => item.message),
  );
  const starts = messages
    .map((message) => Date.parse(message.createdAt))
    .filter(Number.isFinite);
  if (starts.length === 0) return { startedAt: undefined, endedAt: undefined };
  const startedAt = Math.min(...starts);
  const endedAt = Math.max(
    startedAt,
    ...messages.map((message) => {
      const createdAt = Date.parse(message.createdAt);
      if (!Number.isFinite(createdAt)) return startedAt;
      const duration =
        message.role === "tool" ? message.toolDurationMs : message.responseDurationMs;
      const recordedEnd = Date.parse(message.toolCompletedAt ?? "");
      return Number.isFinite(recordedEnd)
        ? recordedEnd
        : createdAt +
            (typeof duration === "number" && Number.isFinite(duration)
              ? Math.max(0, duration)
              : 0);
    }),
  );
  return { startedAt, endedAt };
}
