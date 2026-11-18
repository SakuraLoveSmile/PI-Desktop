import type {
  ContextInsightsCategory,
  ContextInsightsRequest,
} from "@pi-desktop/shared";
import { selectAgentRequests } from "./model";

export type ContextBucket = "system" | "tools" | "messages";

export type ContextCompositionSegment = {
  bucket: ContextBucket;
  /** Uncalibrated entry estimate, printed on the legend row. */
  tokens: number;
  /** Share of the whole bar, so the filled length equals the headline ratio. */
  percent: number;
};

export type ContextComposition = {
  segments: ContextCompositionSegment[];
  totalEstimate: number;
};

const BUCKET_OF: Record<ContextInsightsCategory, ContextBucket> = {
  system: "system",
  tools: "tools",
  user: "messages",
  injected: "messages",
  skill: "messages",
  assistant: "messages",
  toolResult: "messages",
};

const BUCKET_ORDER: ContextBucket[] = ["system", "tools", "messages"];

/**
 * The composer describes the main agent's newest request: subagent captures and
 * compaction passes bill tokens but are not what the user is talking to.
 */
export function selectLatestMainRequest(
  requests: ContextInsightsRequest[],
): ContextInsightsRequest | undefined {
  let latest: ContextInsightsRequest | undefined;
  for (const request of selectAgentRequests(requests, "main")) {
    if (request.purpose === "compaction") continue;
    if (!latest || request.startedAt > latest.startedAt) latest = request;
  }
  return latest;
}

/**
 * Entry estimates are uncalibrated, so they compose the bar rather than measure
 * it: shares are scaled onto the provider-reported occupancy, which keeps one
 * authoritative percentage while each row still prints its own estimate.
 */
export function composeBreakdown(
  request: ContextInsightsRequest,
  usedRatio: number,
): ContextComposition | undefined {
  const sums: Record<ContextBucket, number> = { system: 0, tools: 0, messages: 0 };
  for (const entry of request.entries) {
    const bucket = BUCKET_OF[entry.category];
    if (!bucket) continue;
    sums[bucket] += Math.max(0, Math.round(entry.estimatedTokens));
  }
  const totalEstimate = sums.system + sums.tools + sums.messages;
  if (totalEstimate <= 0 || usedRatio <= 0) return undefined;
  const segments = BUCKET_ORDER.filter((bucket) => sums[bucket] > 0).map((bucket) => ({
    bucket,
    tokens: sums[bucket],
    percent: (sums[bucket] / totalEstimate) * usedRatio * 100,
  }));
  return { segments, totalEstimate };
}