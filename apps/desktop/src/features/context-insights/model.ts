import i18n from "i18next";
import type {
  ContextInsightsRequest,
  ContextInsightsEntry,
  MessageUsage,
  SessionSummary,
} from "@pi-desktop/shared";
import type { ContextInsightsPreferences } from "./preferences";

export const categories = [
  "system",
  "tools",
  "user",
  "injected",
  "skill",
  "assistant",
  "toolResult",
] as const;
export const count = (value: number) =>
  new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language ?? "en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
export const money = (value: number | undefined) =>
  value === undefined ? "—" : `$${value.toFixed(4)}`;
export const duration = (value: number | undefined) =>
  value === undefined ? "—" : `${(value / 1000).toFixed(1)}s`;

/** Provider reports are kept distinct from character-derived content estimates. */
export function usageTotals(requests: ContextInsightsRequest[]) {
  return requests.reduce(
    (total, request) => {
      const usage = request.usage;
      if (usage) {
        total.reports++;
        total.input += usage.inputTokens;
        total.output += usage.outputTokens;
        total.read += usage.cacheReadTokens ?? 0;
        total.write += usage.cacheWriteTokens ?? 0;
        total.reasoning += usage.reasoningTokens ?? 0;
        total.tokens +=
          usage.totalTokens ??
          usage.inputTokens +
            usage.outputTokens +
            (usage.cacheReadTokens ?? 0) +
            (usage.cacheWriteTokens ?? 0);
        if (usage.cost !== undefined && usage.costStatus !== "unknown") {
          total.cost += usage.cost.total;
          total.costReports++;
        }
      }
      if (request.durationMs !== undefined) {
        total.ms += request.durationMs;
        total.timed++;
      }
      return total;
    },
    {
      reports: 0,
      input: 0,
      output: 0,
      read: 0,
      write: 0,
      reasoning: 0,
      tokens: 0,
      cost: 0,
      costReports: 0,
      ms: 0,
      timed: 0,
    },
  );
}

export function requestActual(usage: MessageUsage | undefined) {
  return usage
    ? usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    : undefined;
}

/** Dispatch replaces the logical capture with the final provider payload. */
export function capturedContentSignature(request: ContextInsightsRequest) {
  return JSON.stringify([
    request.captureSource,
    request.contentRevision,
    request.contentTruncated,
    request.providerPayload?.originalChars,
    request.providerPayload?.truncated,
    request.providerPayload?.redacted,
    request.entries.map((entry) => [entry.id, entry.originalChars, entry.truncated]),
  ]);
}

export function hydrateCapturedRequest(
  metadata: ContextInsightsRequest,
  captured: ContextInsightsRequest | undefined,
) {
  if (!captured || capturedContentSignature(metadata) !== capturedContentSignature(captured))
    return undefined;
  return {
    ...captured,
    ...metadata,
    entries: captured.entries,
    providerPayload: captured.providerPayload,
  };
}

export function trendRequests(
  requests: ContextInsightsRequest[],
  granularity: ContextInsightsPreferences["granularity"],
) {
  if (granularity === "step") return requests;
  const groups = new Map<string, ContextInsightsRequest>();
  for (const request of requests) groups.set(request.turnId ?? request.id, request);
  return [...groups.values()];
}

export function selectAgentRequests(requests: ContextInsightsRequest[], scope: string) {
  return requests.filter(
    (request) =>
      scope === "all" ||
      (scope === "main"
        ? !request.parentToolCallId && request.purpose !== "subagent"
        : request.parentToolCallId === scope),
  );
}

export function searchEntries(
  entries: ContextInsightsEntry[],
  query: string,
  assistantFilter: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (needle && !`${entry.label}\n${entry.content}`.toLocaleLowerCase().includes(needle))
      return false;
    if (entry.category !== "assistant" || assistantFilter === "all") return true;
    if (assistantFilter === "thinking") return entry.kind === "thinking";
    if (assistantFilter === "calls") return entry.kind === "toolCall";
    return entry.kind === "answer";
  });
}

export function relatedSessions(sessions: SessionSummary[], sessionId: string) {
  const current = sessions.find((session) => session.id === sessionId);
  const teamId = current?.team?.teamSessionId;
  return teamId
    ? sessions.filter((session) => session.team?.teamSessionId === teamId)
    : current
      ? [current]
      : [];
}
