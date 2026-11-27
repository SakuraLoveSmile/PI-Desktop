export type SidebarSessionStatus =
  | "running"
  | "selected"
  | "completed"
  | "failed"
  | "permission";
export type SidebarSessionOutcome = Extract<
  SidebarSessionStatus,
  "completed" | "failed"
>;

export { latestSessionOutcomes } from "@pi-desktop/shared";

/**
 * What a folded project should say about the work inside it: one prompt wins
 * over activity, and a project with neither stays quiet. The caller passes every
 * unarchived session of the project, including rows a cap hides and the members
 * a folded team group holds.
 */
export function collapsedProjectStatus(
  sessionIds: readonly string[],
  isRunning: (id: string) => boolean,
  needsPermission: (id: string) => boolean,
): "permission" | "running" | null {
  let running = false;
  for (const sessionId of sessionIds) {
    if (needsPermission(sessionId)) return "permission";
    if (!running && isRunning(sessionId)) running = true;
  }
  return running ? "running" : null;
}

export function sidebarSessionStatus({
  running,
  selected,
  outcome,
  hasPendingPermission,
}: {
  running: boolean;
  selected: boolean;
  outcome?: "completed" | "failed";
  hasPendingPermission?: boolean;
}): SidebarSessionStatus | null {
  if (hasPendingPermission) return "permission";
  if (running) return "running";
  if (selected) return "selected";
  return outcome ?? null;
}
