import { useTranslation } from "react-i18next";
import { TooltipButton } from "../../../components/ui";

/** Keep the context entry recognizable before the first usage report. */
export function ContextUsagePlaceholder() {
  const { t } = useTranslation();
  return <div className="composer-usage-footer">
    <div className="composer-usage-item composer-usage-context" data-unavailable="true">
      <TooltipButton type="button" disabled className="composer-usage-btn composer-usage-context-btn"
        ariaLabel={t("chat.usageContextUnavailable")} tooltip={t("chat.usageContextUnavailable")}>
        <span className="composer-usage-context-track" aria-hidden="true" />
        <span className="composer-usage-value">—</span>
      </TooltipButton>
    </div>
  </div>;
}
