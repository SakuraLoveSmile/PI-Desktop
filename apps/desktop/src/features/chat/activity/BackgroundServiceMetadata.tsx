import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";

/** Service policy and recorded outcome stay distinct, including on Windows. */
export function BackgroundServiceMetadata({ process }: { process: BackgroundProcessSummary }) {
  const { t, i18n } = useTranslation();
  if (process.backgroundKind !== "service") return null;
  const time = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(i18n.language)}</time>;
  return <dl className="session-process-metadata">
    <dt>{t("panel.activity.service.kind")}</dt><dd>{t("panel.activity.service.label")}</dd>
    <dt>{t("panel.activity.service.owner")}</dt><dd><code>{process.sessionId}</code></dd>
    {process.teamSessionId && <><dt>{t("panel.activity.service.team")}</dt><dd><code>{process.teamSessionId}</code></dd></>}
    {process.teamRunId && <><dt>{t("panel.activity.service.run")}</dt><dd><code>{process.teamRunId}</code></dd></>}
    {process.deadlineAt && <><dt>{t("panel.activity.service.deadline")}</dt><dd>{time(process.deadlineAt)}</dd></>}
    {process.stopMode && <><dt>{t("panel.activity.service.stopPolicy")}</dt><dd>{t(`panel.activity.service.stopModes.${process.stopMode}`)}</dd></>}
    {process.stopReason && <><dt>{t("panel.activity.service.stopReason")}</dt><dd>{t(`panel.activity.service.stopReasons.${process.stopReason}`)}</dd></>}
    {process.stopRequestedAt && <><dt>{t("panel.activity.service.stopRequested")}</dt><dd>{time(process.stopRequestedAt)}</dd></>}
    {process.stopMode === "unix-term-then-kill" && process.serviceStopEscalated !== undefined && <>
      <dt>{t("panel.activity.service.stopOutcome")}</dt><dd>{t(process.serviceStopEscalated
        ? "panel.activity.service.escalated" : "panel.activity.service.termCompleted")}</dd>
    </>}
  </dl>;
}
