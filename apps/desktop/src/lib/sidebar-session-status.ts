import type { AppNotification } from "@pi-desktop/shared";

export type SidebarSessionStatus =
  | "running"
  | "selected"
  | "completed"
  | "failed";
export type SidebarSessionOutcome = Extract<
  SidebarSessionStatus,
  "completed" | "failed"
>;

export function latestSessionOutcomes(
  notifications: AppNotification[],
): Record<string, SidebarSessionOutcome> {
  const outcomes: Record<string, SidebarSessionOutcome> = {};

  // The host and renderer both keep notifications newest-first. Preserve the
  // first terminal result for each session so read state does not erase the
  // task outcome shown in the sidebar.
  for (const notification of notifications) {
    if (outcomes[notification.sessionId]) continue;
    outcomes[notification.sessionId] =
      notification.kind === "task.failed" ? "failed" : "completed";
  }

  return outcomes;
}

export function sidebarSessionStatus({
  running,
  selected,
  outcome,
}: {
  running: boolean;
  selected: boolean;
  outcome?: "completed" | "failed";
}): SidebarSessionStatus | null {
  if (running) return "running";
  if (selected) return "selected";
  return outcome ?? null;
}
