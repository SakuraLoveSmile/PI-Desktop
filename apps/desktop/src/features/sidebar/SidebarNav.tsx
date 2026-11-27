import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  IconClock,
  IconMap,
  IconPlug,
  IconSearch,
  IconSquarePen,
} from "../../components/icons";
import type { AppState } from "../../stores/app-state";

type SidebarNavProps = {
  page: AppState["page"];
  setPage: (page: AppState["page"]) => void;
  canNavBack: () => boolean;
  navBack: () => void;
  onNewTask?: () => void;
  onOpenSearch?: () => void;
  newTaskShortcut?: string;
  searchShortcut?: string;
};

type SidebarNavRowProps = {
  icon: ReactNode;
  label: string;
  shortcut?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

function SidebarNavRow({
  icon,
  label,
  shortcut,
  ...buttonProps
}: SidebarNavRowProps) {
  return (
    <button type="button" className="sidebar-nav-row" {...buttonProps}>
      <span className="sidebar-nav-icon" aria-hidden>
        {icon}
      </span>
      <span className="sidebar-nav-label">{label}</span>
      {shortcut ? (
        <span className="sidebar-nav-shortcut" aria-hidden>
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The sidebar's top destinations: the two shell actions that used to live in
 * the topbar or nowhere, then the three pages the footer used to carry. It is
 * outside the scrolling list, so it never moves with the session history.
 */
export function SidebarNav({
  page,
  setPage,
  canNavBack,
  navBack,
  onNewTask,
  onOpenSearch,
  newTaskShortcut = "",
  searchShortcut = "",
}: SidebarNavProps) {
  const { t } = useTranslation();
  return (
    <nav className="sidebar-nav no-drag">
      <SidebarNavRow
        icon={<IconSquarePen size={15} />}
        label={t("nav.newTask")}
        shortcut={newTaskShortcut}
        data-action="new-task"
        onClick={() => onNewTask?.()}
      />
      <SidebarNavRow
        icon={<IconSearch size={15} />}
        label={t("nav.search")}
        shortcut={searchShortcut}
        data-action="open-search"
        onClick={() => onOpenSearch?.()}
      />
      <SidebarNavRow
        icon={<IconClock size={15} />}
        label={t("scheduled.title")}
        data-nav="scheduled"
        aria-current={page === "scheduled" ? "page" : undefined}
        onClick={() => setPage("scheduled")}
      />
      <SidebarNavRow
        icon={<IconPlug size={15} />}
        label={t("nav.plugins")}
        data-nav="plugins"
        aria-current={page === "plugins" ? "page" : undefined}
        onClick={() => page === "plugins"
          ? (canNavBack() ? navBack() : setPage("chat"))
          : setPage("plugins")}
      />
      <SidebarNavRow
        icon={<IconMap size={15} />}
        label={t("contextInsights.title")}
        data-nav="context-insights"
        aria-current={page === "contextInsights" ? "page" : undefined}
        onClick={() => setPage("contextInsights")}
      />
    </nav>
  );
}
