import { useTranslation } from "react-i18next";
import type { TeamSnapshot } from "@pi-desktop/shared";

export function TeamRunLimitNotice({ limits, safelyFinishing }: {
  limits: NonNullable<TeamSnapshot["runLimits"]>; safelyFinishing: boolean;
}) {
  const { t } = useTranslation();
  const canResume = !limits.enabled || limits.elapsedMs < limits.hardMs;
  return <aside className="team-warning-box" role="status">
    <span>{t("team.runLimitHours", { elapsed: (limits.elapsedMs / 3_600_000).toFixed(1),
      soft: limits.softMs / 3_600_000, hard: limits.hardMs / 3_600_000 })}</span>
    {!limits.enabled && <p>{t("team.runLimitDisabled")}</p>}
    {limits.hardReachedAt !== null ? <p>{t(safelyFinishing ? "team.runLimitStopping" : canResume ? "team.runLimitReadyToResume" : "team.runLimitPaused")}</p>
      : limits.softMessageId !== null ? <p>{t("team.runLimitSoft")}</p> : null}
  </aside>;
}
