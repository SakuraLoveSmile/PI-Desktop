import type {
  ContextCompactionRecord,
  ContextCompactionStatus,
} from "./types.js";

/**
 * The generation counter rides inside the checkpoint's opaque `details` value:
 * the host persists that field verbatim, so it survives the transcript round
 * trip without a record schema change.
 */
export function checkpointGeneration(details: unknown): number {
  const value = (details as { generation?: unknown } | null | undefined)
    ?.generation;
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

/** Same four-characters-per-token heuristic the runtime uses for estimates. */
export function estimateSummaryTokens(summary: string): number {
  return Math.ceil(summary.length / 4);
}

export function contextCompactionStatus(
  record: ContextCompactionRecord | undefined | null,
): ContextCompactionStatus | undefined {
  if (!record) return undefined;
  return {
    generation: checkpointGeneration(record.details),
    summaryTokens: estimateSummaryTokens(record.summary ?? ""),
  };
}
