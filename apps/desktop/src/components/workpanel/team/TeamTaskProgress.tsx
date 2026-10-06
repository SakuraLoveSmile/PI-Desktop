import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, TooltipButton } from "../../ui";
import { IconArrowUpRight, IconChevronDown } from "../../icons";
import { PixelAvatar } from "./PixelAvatar";
import { TaskStateGlyph } from "./TaskStateGlyph";
import { taskStateLabelKey, type MemberView, type TaskRow } from "../../../lib/team-presentation";

export function MemberIdentity({ member, avatarSize = 20 }: { member: MemberView; avatarSize?: 12 | 16 | 20 }) {
  const { t } = useTranslation();
  return (
    <span className="team-person">
      <PixelAvatar seed={member.sessionId} size={avatarSize} />
      <span className="team-person-name">
        {t(`team.roles.${member.role}`)} {member.displayName}
      </span>
    </span>
  );
}

export function TeamTaskProgress({
  rows, completed, total, expanded, onToggle, onOpenTask, onOpenPanorama, onOpenBoard, extra,
}: {
  rows: TaskRow[];
  completed: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenPanorama: () => void;
  onOpenBoard: () => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const [groupOpen, setGroupOpen] = useState(true);
  const bodyId = useId();
  const groupId = useId();
  return (
    <section className="team-progress" aria-label={t("team.taskProgress")}
      data-completed={completed} data-total={total}>
      <header className="team-progress-header">
        <h3 className="team-progress-title">{t("team.taskProgress")}</h3>
        <TooltipButton className="team-progress-panorama" tooltip={t("team.viewInPanorama")}
          ariaLabel={t("team.viewInPanorama")} onClick={onOpenPanorama}>
          <span>{t("team.viewInPanorama")}</span>
          <IconArrowUpRight size={16} aria-hidden />
        </TooltipButton>
        <span className="team-progress-divider" aria-hidden="true" />
        <TooltipButton className="team-progress-toggle" tooltip={t("team.taskProgress")}
          ariaLabel={t("team.taskProgress")} aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
          <IconChevronDown size={16} aria-hidden />
        </TooltipButton>
      </header>
      <div id={bodyId} className="team-progress-body" hidden={!expanded}>
        {total > 0 ? (
          <>
            <TooltipButton className="team-progress-group-toggle" tooltip={t("team.adHocGroup")}
              ariaLabel={t("team.adHocGroup")} aria-expanded={groupOpen} aria-controls={groupId}
              onClick={() => setGroupOpen((open) => !open)}>
              <span>{t("team.adHocGroup")}</span>
              <span className="team-progress-group-count">{total}</span>
              <IconChevronDown size={14} aria-hidden />
            </TooltipButton>
            <ol id={groupId} className="team-progress-rows" hidden={!groupOpen}>
              {rows.map(({ task, state, owner }) => (
                <li key={task.taskId}>
                  <TooltipButton className="team-progress-row" tooltip={task.subject}
                    ariaLabel={t("team.openTaskWithStatus", { subject: task.subject, status: t(taskStateLabelKey(state)) })}
                    onClick={() => onOpenTask(task.taskId)}>
                    <TaskStateGlyph state={state} />
                    <span className="team-progress-task">{t("team.adHocTaskTitle", { subject: task.subject })}</span>
                    {owner ? <MemberIdentity member={owner} avatarSize={12} />
                      : <span className="team-person">{t("team.unassigned")}</span>}
                  </TooltipButton>
                </li>
              ))}
            </ol>
            {total > rows.length ? (
              <Button variant="ghost" size="sm" className="team-progress-view-all" onClick={onOpenBoard}>
                {t("team.viewAllTasks", { count: total })}
              </Button>
            ) : null}
          </>
        ) : <p className="team-empty-copy">{t("team.noTasks")}</p>}
        {extra}
      </div>
    </section>
  );
}
