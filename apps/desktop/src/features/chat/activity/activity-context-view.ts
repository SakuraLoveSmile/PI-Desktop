import type { ContextInsightsRequest, ContextUsageDisplay, MessageUsage } from "@pi-desktop/shared";
import { calculateContextUsage, contextCapacityLevel, contextUsageLabelKey, contextUsageView, type ContextCapacityLevel } from "../../../lib/context-usage";
import { composeBreakdown, type ContextBucket } from "../../context-insights/composition";

const BUCKETS: readonly ContextBucket[] = ["system", "tools", "messages"];

/**
 * The headline's label. The rail reads 已使用 as the approved canvas does where the composer says 已用; the remaining
 * framing keeps the composer's own word, so a person who chose it still reads what the percentage counts.
 */
export function activityContextLabelKey(display: ContextUsageDisplay): "panel.activity.contextUsed" | ReturnType<typeof contextUsageLabelKey> {
  return display === "used" ? "panel.activity.contextUsed" : contextUsageLabelKey(display);
}

export type ActivityContextView = {
  display: ContextUsageDisplay;
  /** The leading figure in the person's chosen framing (used or remaining), the same one the composer shows. */
  percent: number;
  usedPercent: number;
  usedTokens: number;
  windowTokens: number;
  /** The composer's capacity levels, so a warning means the same thing in both places. */
  level: ContextCapacityLevel;
  /** One entry per bucket in the composer's order; absent until the newest request's breakdown is known. */
  buckets?: { bucket: ContextBucket; tokens: number; percent: number }[];
  free: { tokens: number; percent: number };
};

/** What the rail's Context section prints, derived by the same functions as the composer's inspector so the numbers agree. */
export function activityContextView(usage: MessageUsage, contextWindow: number, display: ContextUsageDisplay,
  request?: ContextInsightsRequest): ActivityContextView {
  const context = calculateContextUsage(usage, contextWindow);
  const view = contextUsageView(context, display);
  const composition = request ? composeBreakdown(request, context.usedRatio) : undefined;
  const segments = new Map(composition?.segments.map((segment) => [segment.bucket, segment]));
  return {
    display, percent: view.percent, usedPercent: context.usedPercent, usedTokens: context.usedTokens, windowTokens: contextWindow,
    level: contextCapacityLevel(context.remainingPercent),
    ...(composition ? { buckets: BUCKETS.map((bucket) => ({ bucket, tokens: segments.get(bucket)?.tokens ?? 0, percent: segments.get(bucket)?.percent ?? 0 })) } : {}),
    free: { tokens: context.remainingTokens, percent: context.remainingRatio * 100 },
  };
}
