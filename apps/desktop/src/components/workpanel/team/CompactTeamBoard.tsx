import { useTranslation } from "react-i18next";
import { Badge, Button, Input, SegmentedControl } from "../../ui";
import { IconCheck, IconRefresh } from "../../icons";
import { filterTeamTaskRows, type BoardFilter, type TaskRow, type TaskVisualState } from "../../../lib/team-presentation";
import { MemberIdentity } from "./TeamTaskProgress";

function stateTone(state: TaskVisualState): "neutral" | "success" | "warning" | "error" {
  if (state === "completed") return "success";
  if (state === "blocked") return "warning";
  if (state === "failed") return "error";
  return "neutral";
}

function TaskStateIcon({ state }: { state: TaskVisualState }) {
  return (
    <span className={`team-task-state team-task-state-${state}`} aria-hidden="true">
      {state === "completed" ? (
        <IconCheck size={12} />
      ) : state === "in_progress" ? (
        <IconRefresh size={13} className="team-task-spinner" />
      ) : state === "blocked" ? "!" : state === "failed" ? "×" : "·"}
    </span>
  );
}

export function CompactTeamBoard({
  rows,
  filter,
  query,
  onFilter,
  onQuery,
  onOpenTask,
}: {
  rows: TaskRow[];
  filter: BoardFilter;
  query: string;
  onFilter: (filter: BoardFilter) => void;
  onQuery: (query: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const matching = filterTeamTaskRows(rows, filter, query);
  const options = (["all", "in_progress", "blocked", "completed", "failed"] as const).map((value) => ({
    value,
    label: t(`team.boardFilters.${value}`),
  }));
  return (
    <section className="team-compact-board" aria-label={t("team.taskBoard")}>
      <header className="team-board-filters">
        <SegmentedControl
          value={filter}
          onChange={onFilter}
          options={options}
          label={t("team.boardFiltersLabel")}
          role="group"
          className="team-board-filter-control"
        />
        <Input
          type="search"
          value={query}
          aria-label={t("team.searchTasks")}
          placeholder={t("team.searchTasks")}
          onChange={(event) => onQuery(event.currentTarget.value)}
          className="team-board-search"
        />
      </header>
      {rows.length > 0 ? (
        <ol className="team-board-rows">
          {matching.map(({ task, state, owner }) => (
            <li key={task.taskId}>
              <Button variant="ghost" className="team-board-row" onClick={() => onOpenTask(task.taskId)}>
                <TaskStateIcon state={state} />
                <span className="team-board-task" title={task.subject}>{task.subject}</span>
                <Badge tone={stateTone(state)}>
                  {state === "blocked" ? t("team.waitingForDependencies") : t(`team.taskStatus.${state}`)}
                </Badge>
                <span className="team-board-owner">
                  {owner ? <MemberIdentity member={owner} /> : t("team.unassigned")}
                </span>
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
      {matching.length === 0 ? (
        <p className="team-empty-copy">{rows.length === 0 ? t("team.emptyTasks") : t("team.noMatchingTasks")}</p>
      ) : null}
    </section>
  );
}
