import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button, TooltipButton } from "../../ui";
import { IconCheck, IconChevronDown, IconChevronRight, IconExternal, IconRefresh } from "../../icons";
import { PixelAvatar } from "./PixelAvatar";
import type { MemberView, TaskRow, TaskVisualState } from "../../../lib/team-presentation";

export function MemberIdentity({ member }: { member: MemberView }) {
  const { t } = useTranslation();
  return (
    <span className="team-person">
      <PixelAvatar seed={member.sessionId} />
      <span className="team-person-name">
        {t(`team.roles.${member.role}`)} {member.displayName}
      </span>
    </span>
  );
}

function TaskStateIcon({ state }: { state: TaskVisualState }) {
  return (
    <span className={`team-task-state team-task-state-${state}`} aria-hidden="true">
      {state === "completed" ? (
        <IconCheck size={12} />
      ) : state === "in_progress" ? (
        <IconRefresh size={13} className="team-task-spinner" />
      ) : state === "blocked" ? (
        "!"
      ) : state === "failed" ? (
        "×"
      ) : (
        "·"
      )}
    </span>
  );
}

export function TeamTaskProgress({
  rows,
  completed,
  total,
  expanded,
  onToggle,
  onOpenTask,
  onOpenPanorama,
  onOpenBoard,
}: {
  rows: TaskRow[];
  completed: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenPanorama: () => void;
  onOpenBoard: () => void;
}) {
  const { t } = useTranslation();
  const rowsId = useId();
  return (
    <section className="team-progress" aria-label={t("team.taskProgress")}>
      <header className="team-progress-header">
        <Button
          variant="ghost"
          size="sm"
          className="team-progress-disclosure"
          aria-expanded={expanded}
          aria-controls={rowsId}
          onClick={onToggle}
        >
          {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span>{t("team.taskProgress")}</span>
          <span className="team-progress-count">{completed}/{total}</span>
        </Button>
        <TooltipButton
          className="team-progress-panorama"
          tooltip={t("team.viewInPanorama")}
          ariaLabel={t("team.viewInPanorama")}
          onClick={onOpenPanorama}
        >
          <span>{t("team.viewInPanorama")}</span>
          <IconExternal size={13} />
        </TooltipButton>
      </header>
      <ol id={rowsId} className="team-progress-rows" hidden={!expanded}>
        {rows.map(({ task, ordinal, state, owner }) => (
          <li key={task.taskId}>
            <Button
              variant="ghost"
              className="team-progress-row"
              aria-label={t("team.openTaskWithStatus", {
                subject: task.subject,
                status: state === "blocked"
                  ? t("team.waitingForDependencies")
                  : t(`team.taskStatus.${state}`),
              })}
              onClick={() => onOpenTask(task.taskId)}
            >
              <TaskStateIcon state={state} />
              <span className="team-progress-copy">
                <span className="team-progress-task" title={task.subject}>
                  {t("team.numberedTask", { number: ordinal, subject: task.subject })}
                </span>
                {owner ? (
                  <MemberIdentity member={owner} />
                ) : (
                  <span className="team-person">{t("team.unassigned")}</span>
                )}
              </span>
            </Button>
          </li>
        ))}
      </ol>
      {expanded && total > rows.length ? (
        <Button variant="ghost" size="sm" onClick={onOpenBoard}>
          {t("team.viewAllTasks", { count: total })}
        </Button>
      ) : null}
      {expanded && total === 0 ? <p className="team-empty-copy">{t("team.noTasks")}</p> : null}
    </section>
  );
}
