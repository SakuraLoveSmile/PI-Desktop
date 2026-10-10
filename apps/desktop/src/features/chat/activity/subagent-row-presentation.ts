import { formatToolDuration } from "../../../lib/tool-display";
import { delegationTimingBounds, type DelegationActivityItem, type SubagentTiming } from "../../../lib/subagent-topology";

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

/** Settled rows require an actual runtime end; a Task receipt duration is not elapsed runtime. */
export function subagentElapsed(status: string | undefined, timing: SubagentTiming | undefined, now: number): string | undefined {
  if (timing?.startedAt === undefined) return undefined;
  const end = timing.completedAt ?? (status === "running" ? now : undefined);
  if (end === undefined || end < timing.startedAt) return undefined;
  return formatToolDuration((end - timing.startedAt) / 1000);
}

export function subagentRowText(name: string, task: string | undefined, statusLabel: string | undefined, elapsed: string | undefined): string {
  return [name, task, [statusLabel, elapsed].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}
