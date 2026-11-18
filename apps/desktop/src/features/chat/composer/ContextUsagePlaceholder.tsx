import { useTranslation } from "react-i18next";
import { TooltipButton } from "../../../components/ui";

/** Keep the context entry recognizable before the first usage report. */
export function ContextUsagePlaceholder() {
  const { t } = useTranslation();
  return <div className="composer-usage-footer">
    <div className="composer-usage-item composer-usage-context" data-unavailable="true">
      <TooltipButton type="button" disabled className="composer-usage-btn composer-usage-context-btn"
        ariaLabel={t("chat.usageContextUnavailable")} tooltip={t("chat.usageContextUnavailable")}>
        <span className="composer-usage-context-meter" aria-hidden="true">
          <svg className="context-inspector-ring" viewBox="0 0 24 24">
            <circle className="context-inspector-ring-track" cx="12" cy="12" r="9" />
          </svg>
        </span>
        <span className="composer-usage-label">{t("chat.usageContextLabel")}</span>
        <span className="composer-usage-value">—</span>
      </TooltipButton>
    </div>
  </div>;
}