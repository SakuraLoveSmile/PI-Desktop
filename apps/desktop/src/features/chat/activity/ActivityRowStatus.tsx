import { IconCheck } from "../../../components/icons";
import { activityStatusTone } from "./activity-rail-presentation";

const activeStates = new Set(["running", "starting", "stopping", "working", "in_progress", "queued"]);
const doneStates = new Set(["completed", "complete", "success", "done"]);

export type ActivityRowState = "active" | "done" | "attention" | "idle";

/** What a row's trailing status looks like: a spinner, a check, a coloured word, or a quiet word. */
export function activityRowState(status: string): ActivityRowState {
  if (activeStates.has(status)) return "active";
  if (doneStates.has(status)) return "done";
  const tone = activityStatusTone(status);
  return tone === "error" || tone === "warning" ? "attention" : "idle";
}

/**
 * A row's trailing status. It spins while the work runs and shows a check once it is done, so no chip repeats
 * what the row already says; only a state that needs attention (or a plain state word) is written out.
 */
export function ActivityRowStatus({ status, label, className }: { status: string; label: string; className?: string }) {
  const state = activityRowState(status);
  const tone = activityStatusTone(status);
  return <span className={className ? `session-activity-status ${className}` : "session-activity-status"}
    data-tone={tone === "neutral" ? "muted" : tone} data-state={state}>
    {state === "active" ? <span className="session-activity-spinner" role="img" aria-label={label} />
      : state === "done" ? <IconCheck size={14} role="img" aria-label={label} />
      : label}
  </span>;
}
