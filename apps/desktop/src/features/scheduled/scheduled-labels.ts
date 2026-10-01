import type { ScheduledTaskRun } from "@pi-desktop/shared";

/** One vocabulary for run status and cadence labels, shared by the rail, the
 * history rows, the detail facts, and the run-content header. */
export const RUN_STATUS_I18N_KEYS: Record<ScheduledTaskRun["status"], string> = {
  running: "scheduled.statusRunning",
  completed: "scheduled.statusCompleted",
  aborted: "scheduled.statusAborted",
  error: "scheduled.statusError",
};

export const CADENCE_I18N_KEYS = {
  manual: "scheduled.cadenceManual",
  hourly: "scheduled.cadenceHourly",
  daily: "scheduled.cadenceDaily",
  weekly: "scheduled.cadenceWeekly",
} as const;
