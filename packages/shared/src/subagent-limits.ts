import type { AppSettings } from "./types/settings.js";

export const DEFAULT_SUBAGENT_MAX_DEPTH = 1;
export const MAX_SUBAGENT_MAX_DEPTH = 8;
export const DEFAULT_SUBAGENT_MAX_CONCURRENCY = 10;
export const MAX_SUBAGENT_MAX_CONCURRENCY = 32;

export type SubagentLimitSettings = Pick<AppSettings, "subagentMaxDepth" | "subagentMaxConcurrency">;
export type SubagentLimitField = keyof SubagentLimitSettings;

/** Writes reject invalid limits; legacy/invalid persisted reads use safe defaults. */
export function isValidSubagentLimit(field: SubagentLimitField, value: unknown): value is number {
  const min = field === "subagentMaxDepth" ? 0 : 1;
  const max = field === "subagentMaxDepth" ? MAX_SUBAGENT_MAX_DEPTH : MAX_SUBAGENT_MAX_CONCURRENCY;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Root is depth 0; concurrency counts active descendants across that root's tree. */
export function normalizeSubagentLimits(settings?: SubagentLimitSettings): { maxDepth: number; maxConcurrency: number } {
  return {
    maxDepth: isValidSubagentLimit("subagentMaxDepth", settings?.subagentMaxDepth)
      ? settings.subagentMaxDepth : DEFAULT_SUBAGENT_MAX_DEPTH,
    maxConcurrency: isValidSubagentLimit("subagentMaxConcurrency", settings?.subagentMaxConcurrency)
      ? settings.subagentMaxConcurrency : DEFAULT_SUBAGENT_MAX_CONCURRENCY,
  };
}
