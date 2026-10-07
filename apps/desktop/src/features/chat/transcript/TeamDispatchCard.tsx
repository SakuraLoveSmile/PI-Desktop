import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/app-store";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { PixelAvatar } from "../../../components/workpanel/team/PixelAvatar";
import { IconFlag } from "../../../components/icons";
import { TooltipButton } from "../../../components/ui";
import { dispatchFallbackState, type TeamDispatchCardItem } from "../../../lib/team-dispatch";
import { buildTeamTaskRows, taskStateLabelKey } from "../../../lib/team-presentation";

export const TeamDispatchCard = memo(function TeamDispatchCard({
  card,
}: {
  card: TeamDispatchCardItem;
}) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const openWorkPanelTabForSession = useAppStore(
    (s) => s.openWorkPanelTabForSession,
  );
  const teamSessionId = card.teamSessionId || activeSessionId || "";
  const { snapshot } = useTeamSnapshot(teamSessionId, {
    enabled: Boolean(teamSessionId),
  });
  const liveRow = useMemo(() => snapshot
    ? buildTeamTaskRows(snapshot.tasks, snapshot.members, snapshot.readiness, snapshot.paused)
        .find((row) => row.task.taskId === card.taskId)
    : undefined, [snapshot, card.taskId]);
  const subject = liveRow?.task.subject || card.task.subject || t("team.untitledTask", "Untitled task");
  const state = liveRow?.state ?? dispatchFallbackState(card.task.status);
  const statusLabel = t(taskStateLabelKey(state));
  const owner = liveRow?.owner;
  const identity = owner
    ? `${t(`team.roles.${owner.role}`)} ${owner.displayName}`
    : card.task.ownerMemberName || t("team.unassigned", "Unassigned");
  const avatarSeed = owner?.sessionId || card.task.ownerSessionId || card.task.ownerMemberName || card.taskId;

  const handleOpen = (event: React.MouseEvent) => {
    event.stopPropagation();
    const session = activeSessionId || teamSessionId;
    if (!session) return;
    openWorkPanelTabForSession(
      session,
      teamWorkPanelTab(teamSessionId, { kind: "task", taskId: card.taskId }, subject),
    );
  };

  return (
    <article className="team-dispatch-card" data-task-id={card.taskId}
      data-team-session-id={teamSessionId} data-message-id={card.firstCreateMessageId} data-state={state} aria-label={subject}>
      <TooltipButton type="button" className="team-dispatch-card-open" tooltip={subject}
        ariaLabel={t("team.openTaskWithStatus", { subject, status: statusLabel })} onClick={handleOpen}>
        <span className="team-dispatch-card-row">
          <PixelAvatar seed={avatarSeed} size={16} />
          <span className="team-dispatch-identity">{identity}</span>
          <span className="team-dispatch-status">{statusLabel}</span>
        </span>
        <span className="team-dispatch-card-row">
          <span className="team-dispatch-connector" aria-hidden="true" />
          <span className="team-dispatch-title">{subject}</span>
        </span>
      </TooltipButton>
    </article>
  );
});

export const TeamDispatchCardsGroup = memo(function TeamDispatchCardsGroup({
  cards,
  joining = false,
}: {
  cards: TeamDispatchCardItem[];
  joining?: boolean;
}) {
  const { t } = useTranslation();
  if (cards.length === 0 && !joining) return null;
  return (
    <div
      className="team-dispatch-cards-group"
      role="region"
      aria-label={t("team.dispatchCardsLabel", "Expert task dispatches")}
    >
      {cards.map((card) => (
        <TeamDispatchCard
          key={`${card.teamSessionId}:${card.taskId}`}
          card={card}
        />
      ))}
      {joining ? (
        <div className="team-dispatch-joining" role="status">
          <IconFlag size={16} aria-hidden />
          <span className="team-dispatch-joining-label">{t("team.expertJoining")}</span>
        </div>
      ) : null}
    </div>
  );
});
