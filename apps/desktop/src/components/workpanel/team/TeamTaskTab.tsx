import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { buildTeamTaskRows, localizedTeamSnapshotError, projectMemberIdentities, taskStateLabelKey } from "../../../lib/team-presentation";
import { IconExternal, IconInfo, IconLoader } from "../../icons";
import { Button, TooltipButton } from "../../ui";
import { MemberIdentity } from "./TeamTaskProgress";
import { TaskStateGlyph } from "./TaskStateGlyph";
import { TeamTaskBrief } from "./TeamTaskBrief";
import { TeamMemberTranscript } from "./TeamMemberTranscript";

export function TeamTaskTab({ teamSessionId, taskId, taskLabel, onOpenMember, onSelectSession }: {
  teamSessionId: string; taskId: string; taskLabel?: string;
  onOpenMember: (memberSessionId: string, label?: string) => void;
  onSelectSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const { snapshot, loading, error, refresh } = useTeamSnapshot(teamSessionId);
  const [briefExpanded, setBriefExpanded] = useState<boolean | null>(null);
  const tasks = snapshot?.tasks ?? [];
  const members = snapshot?.members ?? [];
  const row = buildTeamTaskRows(tasks, members, snapshot?.readiness ?? [], snapshot?.paused).find(({ task }) => task.taskId === taskId);
  const task = row?.task;
  const owner = row?.owner;
  const ownerMember = owner ? members.find((member) => member.memberSessionId === owner.sessionId) : undefined;
  const identities = new Map(projectMemberIdentities(members, snapshot?.paused).map((member) => [member.sessionId, member]));
  const briefOpen = briefExpanded ?? !owner;
  return (
    <section className="team-work-tab" data-testid="team-task-tab" aria-label={t("team.taskDetail")}>
      <header className="team-work-tab-header">
        <div className="team-work-tab-row">
          <TooltipButton className="team-work-tab-identity" tooltip={owner?.displayName ?? t("team.unassigned")}
            ariaLabel={owner ? t("team.memberDetail") : t("team.unassigned")} disabled={!owner}
            onClick={() => { if (owner) onOpenMember(owner.sessionId, owner.displayName); }}>
            {owner ? <MemberIdentity member={owner} avatarSize={16} /> : t("team.unassigned")}
          </TooltipButton>
          {row ? <span className="team-work-tab-status">
            {row.state === "in_progress" ? <IconLoader size={12} aria-hidden /> : <TaskStateGlyph state={row.state} size={12} />}
            <span>{t(taskStateLabelKey(row.state))}</span>
          </span> : null}
        </div>
        <div className="team-work-tab-row">
          <span className="team-work-tab-connector" aria-hidden="true" />
          <h2 className="team-work-tab-title" title={task?.subject ?? taskLabel}>{task?.subject ?? taskLabel ?? t("team.noCurrentTask")}</h2>
          <div className="team-work-tab-actions">
            <TooltipButton className="team-work-tab-action" tooltip={t("team.openInMain")} ariaLabel={t("team.openInMain")}
              disabled={!owner || !onSelectSession} onClick={() => { if (owner) onSelectSession?.(owner.sessionId); }}><IconExternal size={16} aria-hidden /></TooltipButton>
            <TooltipButton className="team-work-tab-action" tooltip={t("team.taskDetail")} ariaLabel={t("team.taskDetail")}
              disabled={!task} aria-expanded={briefOpen} onClick={() => setBriefExpanded(!briefOpen)}><IconInfo size={16} aria-hidden /></TooltipButton>
          </div>
        </div>
      </header>
      {error ? <div className="team-error-state team-error-banner" role="alert">
        <span>{localizedTeamSnapshotError(error, t)}</span>
        <Button size="sm" onClick={() => void refresh()}>{t("team.retry")}</Button>
      </div> : null}
      {task && briefOpen ? <div className="team-work-tab-brief">
        {task.description ? <p className="team-card-desc">{task.description}</p> : null}
        <TeamTaskBrief task={task} ownerMember={ownerMember} identities={identities}
          taskOverlaps={snapshot?.scopeOverlaps.filter((overlap) => overlap.taskIds.includes(taskId)) ?? []}
          onSelectMember={(memberSessionId) => onOpenMember(memberSessionId, identities.get(memberSessionId)?.displayName)} />
      </div> : null}
      {task && owner ? <TeamMemberTranscript key={owner.sessionId} teamSessionId={teamSessionId} memberSessionId={owner.sessionId}
        isRunning={ownerMember?.phase === "running"} tabBody /> : (
        <div className="team-work-tab-body" role="log" aria-label={t("team.transcript")}>
          <div className="team-empty-state">{loading ? t("common.loading") : task ? t("team.noTranscript") : t("team.noCurrentTask")}</div>
        </div>
      )}
    </section>
  );
}
