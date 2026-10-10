import { backgroundProcessIsActive } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { IconRefresh, IconSquare, IconX } from "../../../components/icons";
import { Button, TooltipButton } from "../../../components/ui";
import { ActivityStatus } from "./SessionActivityRail";
import { useBackgroundProcessDetails } from "./useBackgroundProcessDetails";

export function BackgroundProcessDetails({ sessionId, id, visible, onClose }: {
  sessionId: string; id: string; visible: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { detail, loading, stopping, error, refresh, stop } = useBackgroundProcessDetails(sessionId, id, visible);
  if (!visible) return null;
  return <section className="session-process-detail" aria-label={t("panel.activity.openProcess")}>
    <div className="session-process-detail-heading">
      {detail && <ActivityStatus status={detail.process.status} label={t(`panel.activity.status.${detail.process.status}`)} />}
      <div className="session-process-detail-actions">
        <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.refresh")} disabled={loading} onClick={refresh}><IconRefresh size={14} aria-hidden /></TooltipButton>
        <TooltipButton type="button" className="session-activity-action" tooltip={t("panel.activity.closeProcess")} onClick={onClose}><IconX size={14} aria-hidden /></TooltipButton>
      </div>
    </div>
    {loading && <p className="session-activity-empty" role="status">{t("panel.activity.loading")}</p>}
    {error && <div className="session-activity-error" role="alert"><p>{error}</p>
      <Button variant="ghost" size="sm" disabled={stopping} onClick={refresh}>{t("panel.activity.retry")}</Button></div>}
    {detail && <>
      {(detail.errorCode || detail.errorMessage) && <div className="session-activity-error" role="alert">
        {detail.errorCode && <p><code>{detail.errorCode}</code></p>}
        {detail.errorMessage && <p>{detail.errorMessage}</p>}
      </div>}
      {detail.persistenceError && <div className="session-activity-error" role="alert">
        <p>{detail.persistenceError}</p>
        <Button variant="ghost" size="sm" disabled={loading} onClick={refresh}>{t("panel.activity.retry")}</Button>
      </div>}
      <dl className="session-process-metadata">
        <dt>{t("panel.activity.command")}</dt><dd><code>{detail.process.command}</code></dd>
        <dt>{t("panel.activity.cwd")}</dt><dd><code>{detail.process.cwd}</code></dd>
      </dl>
      {backgroundProcessIsActive(detail.process.status) && <Button variant="secondary" size="sm" className="session-process-stop"
        disabled={stopping || detail.process.status === "stopping"} onClick={stop}>
        <IconSquare size={12} aria-hidden />{t(stopping || detail.process.status === "stopping" ? "panel.activity.status.stopping" : "panel.activity.stopProcess")}
      </Button>}
      {(["stdout", "stderr"] as const).map((stream) => <div key={stream} className="session-process-stream">
        <div className="session-process-stream-label">{t(`panel.activity.${stream}`)}</div>
        <pre tabIndex={0} aria-label={t(`panel.activity.${stream}`)}>{detail[stream] || t("panel.activity.empty")}</pre>
        {detail[`${stream}Truncated`] && <p className="session-activity-notice">{t("panel.activity.outputTruncated")}</p>}
      </div>)}
    </>}
  </section>;
}
