import { useTranslation } from "react-i18next";
import { NotificationCenter } from "../../components/NotificationCenter";
import { TooltipButton } from "../../components/ui";
import { IconClock, IconMap, IconPlug, IconSettings } from "../../components/icons";
import type { AppState } from "../../stores/app-state";

export type SidebarFooterProps = {
  page: AppState["page"];
  setPage: (page: AppState["page"]) => void;
  canNavBack: () => boolean;
  navBack: () => void;
  updateReady: boolean;
  buildLabel: string;
  buildTitle: string;
  onBuildClick: () => void;
  onBeforeNotificationsOpen: () => void;
};

/**
 * The sidebar's bottom action bar: the daily destinations on the left and the
 * build chip on the right. It owns no state — the sidebar keeps the update
 * status and the settings routing.
 */
export function SidebarFooter({
  page,
  setPage,
  canNavBack,
  navBack,
  updateReady,
  buildLabel,
  buildTitle,
  onBuildClick,
  onBeforeNotificationsOpen,
}: SidebarFooterProps) {
  const { t } = useTranslation();
  return (
    <div className="sidebar-footer no-drag">
      <div className="footer-actions">
        <TooltipButton
          type="button"
          className={`footer-action ${page === "settings" ? "active" : ""}`}
          data-nav="settings"
          tooltip={t("nav.settings")}
          ariaLabel={t("nav.settings")}
          onClick={() => setPage("settings")}
          aria-pressed={page === "settings"}
        >
          <IconSettings size={14} aria-hidden />
        </TooltipButton>
        <TooltipButton
          type="button"
          className={`footer-action ${page === "plugins" ? "active" : ""}`}
          data-nav="plugins"
          tooltip={t("nav.plugins")}
          ariaLabel={t("nav.plugins")}
          onClick={() => page === "plugins"
            ? (canNavBack() ? navBack() : setPage("chat"))
            : setPage("plugins")}
          aria-pressed={page === "plugins"}
        >
          <IconPlug size={14} aria-hidden />
        </TooltipButton>
        <TooltipButton
          type="button"
          className={`footer-action ${page === "scheduled" ? "active" : ""}`}
          data-nav="scheduled"
          tooltip={t("scheduled.title")}
          ariaLabel={t("scheduled.title")}
          onClick={() => setPage("scheduled")}
          aria-pressed={page === "scheduled"}
        >
          <IconClock size={14} aria-hidden />
        </TooltipButton>
        <TooltipButton type="button" className={`footer-action ${page === "contextInsights" ? "active" : ""}`}
          data-nav="context-insights" tooltip={t("contextInsights.title")} ariaLabel={t("contextInsights.title")}
          onClick={() => setPage("contextInsights")} aria-pressed={page === "contextInsights"}>
          <IconMap size={14} aria-hidden />
        </TooltipButton>
        <NotificationCenter onBeforeOpen={onBeforeNotificationsOpen} />
      </div>

      <TooltipButton
        type="button"
        className={`footer-build ${updateReady ? "has-update" : ""}`}
        data-nav="build"
        tooltip={buildTitle}
        ariaLabel={buildTitle}
        onClick={onBuildClick}
      >
        <span className="footer-build-version">{buildLabel}</span>
        {updateReady ? <span className="footer-build-dot" aria-hidden /> : null}
      </TooltipButton>
    </div>
  );
}
