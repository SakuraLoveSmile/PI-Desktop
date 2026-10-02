import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../stores/app-store";
import { useTeamSnapshot } from "../../../hooks/useTeamSnapshot";
import { teamWorkPanelTab } from "../../../lib/work-panel-tabs";
import { PixelAvatar } from "../../../components/workpanel/team/PixelAvatar";
import type { TeamDispatchCardItem } from "../../../lib/team-dispatch";

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

  const member = snapshot?.members?.find(
    (m) =>
      (card.task.ownerMemberName && m.name === card.task.ownerMemberName) ||
      (card.task.ownerSessionId && m.memberSessionId === card.task.ownerSessionId),
  );

  const displayName =
    member?.presentation?.displayName ||
    card.task.ownerMemberName ||
    t("team.unassigned", "Unassigned");
  const subject = card.task.subject || t("team.untitledTask", "Untitled task");
  const role = member?.presentation?.role
    ? t(`team.roles.${member.presentation.role}`, member.presentation.role)
    : card.task.ownerMemberName
      ? t("team.roles.expert", "Expert")
      : "";
  const avatarSeed =
    member?.memberSessionId ||

    card.task.ownerSessionId ||
    card.task.ownerMemberName ||
    card.taskId;

  const status = card.task.status || "pending";
  const localizedStatus = t(`team.taskStatus.${status}`, status);

  const handleOpenTask = (event: React.MouseEvent) => {
    event.stopPropagation();
    const session = activeSessionId || teamSessionId;
    if (!session) return;
    openWorkPanelTabForSession(
      session,
      teamWorkPanelTab(teamSessionId, { kind: "task", taskId: card.taskId }),
    );
  };

  const memberSessionId = member?.memberSessionId || card.task.ownerSessionId;

  const handleOpenExpert = (event: React.MouseEvent) => {
    event.stopPropagation();
    const session = activeSessionId || teamSessionId;
    if (!session || !memberSessionId) return;
    openWorkPanelTabForSession(
      session,
      teamWorkPanelTab(teamSessionId, { kind: "member", memberSessionId }),
    );
  };

  return (
    <article
      className="team-dispatch-card"
      data-task-id={card.taskId}
      data-team-session-id={teamSessionId}
      aria-label={subject}
    >
      <header className="team-dispatch-card-header">
        <button
          type="button"
          className="team-dispatch-card-expert"
          onClick={handleOpenExpert}
          disabled={!memberSessionId}
          title={displayName}
          aria-label={memberSessionId
            ? t("team.viewMemberDetail", { name: displayName })
            : t("team.memberDetailUnavailable", "Member details unavailable")}
        >
          <PixelAvatar seed={avatarSeed} size={20} />
          <span className="team-dispatch-expert-name">
            {role ? (
              <span className="team-dispatch-role-tag">{role}</span>
            ) : null}
            <span className="team-dispatch-display-name">{displayName}</span>
          </span>
        </button>
        <span
          className="team-dispatch-status-badge"
          data-status={status}
          aria-label={localizedStatus}
        >
          {localizedStatus}
        </span>
      </header>
      <div className="team-dispatch-card-task-row">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="team-dispatch-l-connector"
          aria-hidden="true"
        >
          <path
            d="M2 1v6a2 2 0 0 0 2 2h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <button
          type="button"
          className="team-dispatch-task-title-btn"
          title={subject}
          onClick={handleOpenTask}
        >
          <strong>{subject}</strong>
        </button>
      </div>
    </article>
  );
});

export const TeamDispatchCardsGroup = memo(function TeamDispatchCardsGroup({
  cards,
}: {
  cards: TeamDispatchCardItem[];
}) {
  const { t } = useTranslation();
  if (!cards || cards.length === 0) return null;
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
    </div>
  );
});
