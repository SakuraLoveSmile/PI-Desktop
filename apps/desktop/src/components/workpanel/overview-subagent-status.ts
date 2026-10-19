import type { SubagentOutcome } from "../../lib/subagent-topology";

/** One tone for the Overview badge and the panorama node, so an outcome reads the same in both. */
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

/** The team phase palette has no paused entry, so paused rows borrow the neutral idle tone. */
export function overviewSubagentBadgeClass(tone: OverviewSubagentTone): string {
  return `team-phase-${tone === "paused" ? "idle" : tone}`;
}

/** Same catalog keys the Activity rail uses, so both surfaces show one label per outcome. */
export function overviewSubagentLabelKey(status: SubagentOutcome): string {
  return `panel.activity.status.${status}`;
}
