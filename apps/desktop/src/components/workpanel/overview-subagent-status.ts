import type { SubagentOutcome } from "../../lib/subagent-topology";

/** The one tone a delegation outcome reads as: the panorama node and the rail row agree on it. */
export type OverviewSubagentTone = "running" | "completed" | "paused" | "failed";

export function overviewSubagentTone(status: SubagentOutcome): OverviewSubagentTone {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "stopped":
    case "aborted":
    case "timed_out":
      return "paused";
    default:
      return "failed";
  }
}
