import { compact, formatToolDuration } from "../../../lib/tool-display";
import { delegationTimingBounds, type DelegationActivityItem, type SubagentTiming } from "../../../lib/subagent-topology";

/** The row tooltip repeats only the opening of a delegation brief; the full brief stays in the subagent tab. */
const ROW_TASK_EXCERPT_LIMIT = 120;

/** Stable presentation identity; the avatar is decorative, never a status signal. */
export function subagentAvatarVariant(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 3;
}

export function subagentItemTiming(item: DelegationActivityItem, timings: ReadonlyMap<string, SubagentTiming>): SubagentTiming | undefined {
  const bounds = delegationTimingBounds([item], timings);
  return bounds.startedAt === undefined ? undefined : bounds;
}

export function subagentTimingIsLive(status: string | undefined, timing?: SubagentTiming): boolean {
  return status === "running" && timing?.startedAt !== undefined && timing.completedAt === undefined;
}

/** The rail's clock for a row's far edge: `02:14`, or `1:02:14` from an hour on. */
export function formatElapsedClock(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(seconds / 3_600);
  const clock = `${pad(Math.floor((seconds % 3_600) / 60))}:${pad(seconds % 60)}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

/**
 * Settled rows require an actual runtime end; a Task receipt duration is not elapsed runtime. `duration` is the spoken
 * form (`2m 14s`) that tooltips and accessible names carry; `clock` is the rail's compact `02:14`.
 */
export function subagentElapsed(status: string | undefined, timing: SubagentTiming | undefined, now: number,
  format: "duration" | "clock" = "duration"): string | undefined {
  if (timing?.startedAt === undefined) return undefined;
  const end = timing.completedAt ?? (status === "running" ? now : undefined);
  if (end === undefined || end < timing.startedAt) return undefined;
  const seconds = (end - timing.startedAt) / 1000;
  return format === "clock" ? formatElapsedClock(seconds) : formatToolDuration(seconds);
}

export function subagentRowText(name: string, task: string | undefined, statusLabel: string | undefined, elapsed: string | undefined): string {
  // A multi-KB brief would otherwise become the whole tooltip and accessible name.
  const excerpt = task ? compact(task, ROW_TASK_EXCERPT_LIMIT) : undefined;
  return [name, excerpt, [statusLabel, elapsed].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}
