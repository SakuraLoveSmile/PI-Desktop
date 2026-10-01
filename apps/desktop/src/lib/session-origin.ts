import type { SessionSummary } from "@pi-desktop/shared";

/**
 * A scheduled-task run owns its transcript: `scheduled.run` creates the session
 * and records it in `task_runs`, and the host reports that ownership back as
 * `scheduledRun` on every session summary (issue #1291).
 *
 * Those transcripts are entered from the Scheduled page — the task's own run
 * history reads them in place — so the SessionList's project groups, its pinned
 * rows, and global session search never list them. The session is still in the
 * store, because opening it from the Scheduled page must resolve its title,
 * source, and capabilities like any other conversation.
 *
 * Ownership is derived, never stored on the session: deleting the task removes
 * the `task_runs` row, so its transcripts return to the ordinary lists instead
 * of becoming unreachable.
 */
export function isAutomationSession(
  session: Pick<SessionSummary, "scheduledRun"> | null | undefined,
): boolean {
  return session?.scheduledRun === true;
}
