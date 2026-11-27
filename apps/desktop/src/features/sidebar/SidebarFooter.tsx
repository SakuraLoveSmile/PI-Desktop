import { useTranslation } from "react-i18next";
import { NotificationCenter } from "../../components/NotificationCenter";
import { TooltipButton } from "../../components/ui";
import { IconSettings } from "../../components/icons";
import type { AppState } from "../../stores/app-state";

export type SidebarFooterProps = {
  page: AppState["page"];
  setPage: (page: AppState["page"]) => void;
  updateReady: boolean;
  updateVersion: string;
  onUpdateClick: () => void;
  onBeforeNotificationsOpen: () => void;
};

/**
 * The sidebar's bottom bar: settings and the notification inbox on the left,
 * and a pill only while an update is actually ready. It owns no state — the
 * sidebar keeps the update status and the settings routing.
 */
export function SidebarFooter({
  page,
  setPage,
  updateReady,
  updateVersion,
  onUpdateClick,
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
        <NotificationCenter onBeforeOpen={onBeforeNotificationsOpen} />
      </div>

      {updateReady ? (
        <button
          type="button"
          className="sidebar-update-pill"
          data-nav="build"
          onClick={onUpdateClick}
        >
          <span className="sidebar-update-pill-dot" aria-hidden />
          {t("nav.updateReady", { version: updateVersion })}
        </button>
      ) : null}
    </div>
  );
}
