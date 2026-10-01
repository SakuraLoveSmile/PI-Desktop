import type { TeamSnapshot } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { deriveTeamLeadVisualState } from "../../../lib/team-presentation";

export function TeamStatusBadge({ snapshot }: { snapshot: TeamSnapshot | null }) {
  const { t } = useTranslation();
  const leadState = deriveTeamLeadVisualState(
    snapshot?.leadPhase ?? "idle", snapshot?.paused ?? false,
    snapshot?.members ?? [], snapshot?.tasks.filter((task) => !task.deleted) ?? [],
    snapshot?.queuedMessageCount ?? 0,
  );
  const running = !snapshot?.paused && (snapshot?.leadPhase === "running" ||
    snapshot?.members.some((member) => member.phase === "running"));
  const status = running ? "active" : leadState.status;
  const label = status === "active" ? t("team.activeBadge")
    : status === "paused" ? t("team.pausedBadge") : t(`team.phase.${status}`);
  return <span className={`team-status-badge team-status-${status}`} data-team-status={status}>{label}</span>;
}
