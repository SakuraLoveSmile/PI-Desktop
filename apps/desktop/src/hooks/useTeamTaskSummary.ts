import { useMemo } from "react";
import { buildTeamTaskRows, selectOverviewTaskRows, type TaskRow } from "../lib/team-presentation";
import { useTeamSnapshot } from "./useTeamSnapshot";

/** How many task rows a compact summary shows before it sends the reader to the board. */
export const TEAM_TASK_SUMMARY_LIMIT = 6;

/**
 * The Team task summary both surfaces show: the rows a reader should see first, and how far the Team is.
 * The snapshot, its loading and error state and the refresh callback come along, because a summary that
 * cannot read the board has to say so instead of looking empty.
 */
export function useTeamTaskSummary(teamSessionId: string | null | undefined, options?: {
  limit?: number;
  enabled?: boolean;
}) {
  const limit = options?.limit ?? TEAM_TASK_SUMMARY_LIMIT;
  const team = useTeamSnapshot(teamSessionId, options?.enabled === undefined ? undefined : { enabled: options.enabled });
  const rows = useMemo<TaskRow[]>(() => team.snapshot
    ? buildTeamTaskRows(team.snapshot.tasks, team.snapshot.members, team.snapshot.readiness, team.snapshot.paused)
    : [], [team.snapshot]);
  const visibleRows = useMemo(() => selectOverviewTaskRows(rows, limit), [rows, limit]);
  return {
    snapshot: team.snapshot,
    loading: team.loading,
    error: team.error,
    refresh: team.refresh,
    rows,
    visibleRows,
    completed: rows.filter(({ task }) => task.status === "completed").length,
    total: rows.length,
  };
}
