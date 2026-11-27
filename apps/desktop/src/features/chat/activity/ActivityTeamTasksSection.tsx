import { useTranslation } from "react-i18next";
import { IconChevronRight } from "../../../components/icons";
import { Button } from "../../../components/ui";
import { TaskStateGlyph } from "../../../components/workpanel/team/TaskStateGlyph";
import { useTeamTaskSummary } from "../../../hooks/useTeamTaskSummary";
import { taskStateLabelKey, type TaskRow, type TaskVisualState } from "../../../lib/team-presentation";
import { teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { useAppStore } from "../../../stores/app-store";
import { ActivityRailGroup } from "./ActivityRailGroup";

/**
 * The Team board as one rail group: how far the run is, the tasks a reader should see first, and two ways into the
 * board itself. A Team session only; a session with no Team has no board to summarise.
 */
export function ActivityTeamTasksSection({ sessionId, teamSessionId, visible }: {
  sessionId: string; teamSessionId: string; visible: boolean;
}) {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.openWorkPanelTabForSession);
  const team = useTeamTaskSummary(teamSessionId, { enabled: visible });
  if (!team.snapshot || team.rows.length === 0) return null;
  const label = t("panel.activity.teamTasks", { completed: team.completed, total: team.total });
  const openBoard = () => open(sessionId, teamWorkPanelTab(teamSessionId, { kind: "board" }));
  return <ActivityRailGroup sessionId={sessionId} group="teamTasks" sectionHeading trackAttention={visible} label={label}
    action={<Button variant="ghost" size="sm" className="session-activity-team-board" onClick={openBoard}>
      <span>{t("panel.activity.teamTasksBoard")}</span><IconChevronRight size={14} aria-hidden />
    </Button>}>
    <ActivityTeamTasksList rows={team.visibleRows} completed={team.completed} total={team.total} label={label}
      onOpenBoard={openBoard}
      onOpenTask={(taskId, subject) => open(sessionId, teamWorkPanelTab(teamSessionId, { kind: "task", taskId }, subject))} />
  </ActivityRailGroup>;
}

/** The board summary without the panel wiring around it: a progress bar, the count, then the selected task rows. */
export function ActivityTeamTasksList({ rows, completed, total, label, onOpenBoard, onOpenTask }: {
  rows: readonly TaskRow[]; completed: number; total: number; label: string;
  onOpenBoard: () => void; onOpenTask: (taskId: string, subject: string) => void;
}) {
  const { t } = useTranslation();
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return <>
    <div className="session-activity-team-throughput">
      <div className="session-activity-team-progress" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}>
        <span className="session-activity-team-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="session-activity-team-count">{t("panel.activity.teamTasks", { completed, total })}</span>
    </div>
    <ol className="session-activity-team-tasks" aria-label={label}>
      {rows.map((row) => <li key={row.task.taskId}>
        <button type="button" className="session-activity-team-task" title={row.task.subject}
          aria-label={t("team.openTaskWithStatus", { subject: row.task.subject, status: t(taskStateLabelKey(row.state)) })}
          onClick={() => onOpenTask(row.task.taskId, row.task.subject)}>
          <span className="session-activity-team-state-glyph" aria-hidden><TeamTaskGlyph state={row.state} /></span>
          <span className="session-activity-team-task-name">{t("team.numberedTask", { number: row.ordinal, subject: row.task.subject })}</span>
          <span className="session-activity-team-task-status">{t(taskStateLabelKey(row.state))}</span>
          {row.owner && <span className="session-activity-team-task-owner">{t(`team.roles.${row.owner.role}`)}</span>}
        </button>
      </li>)}
    </ol>
    {total > rows.length ? <Button variant="ghost" size="sm" className="session-activity-team-more" onClick={onOpenBoard}>
      {t("team.viewAllTasks", { count: total })}
    </Button> : null}
  </>;
}

/** Work that is under way spins, as a running sub-agent row does; every other state keeps its board glyph. */
function TeamTaskGlyph({ state }: { state: TaskVisualState }) {
  return state === "in_progress" ? <span className="session-activity-spinner" /> : <TaskStateGlyph state={state} />;
}
