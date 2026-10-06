import { useTranslation } from "react-i18next";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { localizedTeamSnapshotError, memberFocusTask, projectMemberIdentities } from "../../../lib/team-presentation";
import { IconCircle, IconCircleCheck, IconCirclePause, IconCircleX, IconExternal, IconLoader } from "../../icons";
import { Button, TooltipButton } from "../../ui";
import { MemberIdentity } from "./TeamTaskProgress";
import { TeamMemberTranscript } from "./TeamMemberTranscript";

export function TeamMemberTab({ teamSessionId, memberSessionId, onOpenTask, onSelectSession }: {
  teamSessionId: string; memberSessionId: string;
  onOpenTask: (taskId: string, subject: string) => void;
  onSelectSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const { snapshot, error, refresh } = useTeamSnapshot(teamSessionId);
  const member = snapshot?.members.find((item) => item.memberSessionId === memberSessionId);
  const identity = projectMemberIdentities(snapshot?.members ?? [], snapshot?.paused).find((item) => item.sessionId === memberSessionId);
  const focus = member ? memberFocusTask(member, snapshot?.tasks ?? []) : undefined;
  const phase = member?.phase ?? "idle";
  const visualPhase = snapshot?.paused ? "paused" : phase;
  const Glyph = visualPhase === "running" ? IconLoader : visualPhase === "completed" ? IconCircleCheck
    : visualPhase === "failed" ? IconCircleX : visualPhase === "paused" ? IconCirclePause : IconCircle;
  return (
    <section className="team-work-tab" data-testid="team-member-tab" aria-label={t("team.memberDetail")}>
      <header className="team-work-tab-header">
        <div className="team-work-tab-row">
          <span className="team-work-tab-identity">{identity ? <MemberIdentity member={identity} avatarSize={16} /> : t("team.memberDetail")}</span>
          {member ? <span className="team-work-tab-status" data-phase={visualPhase}><Glyph size={12} aria-hidden /><span>{t(visualPhase === "paused" ? "team.pausedBadge" : `team.phase.${visualPhase}`)}</span></span> : null}
        </div>
        <div className="team-work-tab-row">
          <span className="team-work-tab-connector" aria-hidden="true" />
          <h2 className="team-work-tab-title">{focus ? <TooltipButton className="team-work-tab-task-link" tooltip={focus.subject} ariaLabel={focus.subject}
            onClick={() => onOpenTask(focus.taskId, focus.subject)}>{focus.subject}</TooltipButton> : t("team.noCurrentTask")}</h2>
          <div className="team-work-tab-actions">
            <TooltipButton className="team-work-tab-action" tooltip={t("team.openInMain")} ariaLabel={t("team.openInMain")}
              disabled={!onSelectSession} onClick={() => onSelectSession?.(memberSessionId)}><IconExternal size={16} aria-hidden /></TooltipButton>
          </div>
        </div>
      </header>
      {error ? <div className="team-error-state team-error-banner" role="alert">
        <span>{localizedTeamSnapshotError(error, t)}</span>
        <Button size="sm" onClick={() => void refresh()}>{t("team.retry")}</Button>
      </div> : null}
      <TeamMemberTranscript key={memberSessionId} memberSessionId={memberSessionId} teamSessionId={teamSessionId} isRunning={phase === "running"} tabBody />
    </section>
  );
}
