import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore, WORK_PANEL_MIN_WIDTH } from "../../stores/app-store";
import type { WorkPanelTab } from "../../stores/app-store";
import { toolWorkPanelTab } from "../../lib/work-panel-tabs";
import { cx } from "../ui";
import {
  IconClose,
  IconDiff,
  IconFileText,
  IconGlobe,
  IconTerminal,
} from "../icons";
import { ReviewTab } from "./ReviewTab";
import { TerminalTab } from "./TerminalTab";
import { BrowserTab } from "./BrowserTab";
import { FilesTab } from "./FilesTab";

const WORK_PANEL_MAX_WIDTH_RATIO = 0.6;
const MAIN_PANE_MIN_WIDTH = 360;

const TAB_ICONS = {
  review: IconDiff,
  terminal: IconTerminal,
  browser: IconGlobe,
  file: IconFileText,
} as const;

const HEADER_TOOLS = [
  { kind: "review", Icon: IconDiff },
  { kind: "terminal", Icon: IconTerminal },
  { kind: "browser", Icon: IconGlobe },
] as const;

function clampWidth(width: number) {
  const sidebar = document.querySelector<HTMLElement>(".sidebar, .sidebar-rail");
  const sidebarWidth = sidebar?.getBoundingClientRect().width ?? 0;
  const mainPaneSafeMax = Math.floor(
    window.innerWidth - sidebarWidth - MAIN_PANE_MIN_WIDTH,
  );
  const max = Math.max(
    WORK_PANEL_MIN_WIDTH,
    Math.min(
      720,
      Math.floor(window.innerWidth * WORK_PANEL_MAX_WIDTH_RATIO),
      mainPaneSafeMax,
    ),
  );
  return Math.max(WORK_PANEL_MIN_WIDTH, Math.min(max, width));
}

function tabLabel(tab: WorkPanelTab, t: (key: string) => string) {
  if (tab.kind !== "file") return t(`panel.tabs.${tab.kind}`);
  const path = tab.resource ?? "";
  return path.split("/").filter(Boolean).pop() || path;
}

export function WorkPanel({ browserBlocked = false }: { browserBlocked?: boolean }) {
  const { t } = useTranslation();
  const tabs = useAppStore((s) => s.workPanelTabs);
  const activeTabId = useAppStore((s) => s.activeWorkPanelTabId);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const width = useAppStore((s) => s.workPanelWidth);
  const activateTab = useAppStore((s) => s.activateWorkPanelTab);
  const closeTab = useAppStore((s) => s.closeWorkPanelTab);
  const openWorkPanelTab = useAppStore((s) => s.openWorkPanelTab);
  const setWidth = useAppStore((s) => s.setWorkPanelWidth);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const terminalOpen = tabs.some((tab) => tab.kind === "terminal");

  // Live width during a drag stays local; the store (and localStorage)
  // only sees the committed value on pointer-up.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragState = useRef<{ pointerId: number } | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const menuFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const [toolsMenu, setToolsMenu] = useState<{ top: number; right: number } | null>(
    null,
  );

  const closeToolsMenu = useCallback(() => setToolsMenu(null), []);

  const openToolsMenuAt = useCallback((x: number, y: number) => {
    setToolsMenu({
      top: Math.max(8, Math.min(y + 4, window.innerHeight - 220)),
      right: Math.min(
        Math.max(8, window.innerWidth - x),
        Math.max(8, window.innerWidth - 192),
      ),
    });
  }, []);

  const onHeaderContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as Element).closest?.("[data-work-panel-tab]")) return;
      event.preventDefault();
      event.stopPropagation();
      openToolsMenuAt(event.clientX, event.clientY);
    },
    [openToolsMenuAt],
  );

  useEffect(() => {
    if (!toolsMenu) return;
    const onPointer = (e: PointerEvent) => {
      if (e.button === 2 || (e.pointerType === "mouse" && e.buttons === 2)) return;
      const target = e.target as Element | null;
      if (target?.closest?.(".work-panel-tools-menu")) return;
      closeToolsMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeToolsMenu();
    };
    const onViewportChange = () => closeToolsMenu();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [toolsMenu, closeToolsMenu]);

  useEffect(() => {
    if (!toolsMenu) return;
    requestAnimationFrame(() => menuFirstItemRef.current?.focus());
  }, [toolsMenu]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToolsMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    );
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    }
    items[next]?.focus();
  };

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragState.current = { pointerId: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragWidth(clampWidth(window.innerWidth - e.clientX));
    },
    [],
  );

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    setDragWidth(clampWidth(window.innerWidth - e.clientX));
  }, []);

  const onResizeEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return;
      dragState.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setWidth(clampWidth(window.innerWidth - e.clientX));
      setDragWidth(null);
    },
    [setWidth],
  );

  // The persisted width is a preference, not a guarantee: window growth on
  // open can be denied (maximized / screen edge), so clamp the rendered width
  // to what actually fits and re-clamp whenever the window resizes.
  const [, bumpViewport] = useState(0);
  useEffect(() => {
    const onWindowResize = () => bumpViewport((v) => v + 1);
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);
  const renderWidth = clampWidth(dragWidth ?? width);

  const toolsMenuPortal =
    toolsMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            className="sidebar-row-menu sidebar-floating-menu work-panel-tools-menu"
            role="menu"
            data-work-panel-tools-menu=""
            aria-label={t("panel.openTool")}
            onKeyDown={onMenuKeyDown}
            style={{ top: toolsMenu.top, right: toolsMenu.right }}
          >
            <div className="sidebar-popover-title">{t("panel.openTool")}</div>
            {HEADER_TOOLS.map(({ kind, Icon }, index) => (
              <button
                key={kind}
                ref={index === 0 ? menuFirstItemRef : undefined}
                type="button"
                role="menuitem"
                data-action={`open-work-panel-${kind}`}
                onClick={() => {
                  closeToolsMenu();
                  openWorkPanelTab(toolWorkPanelTab(kind));
                }}
              >
                <Icon size={14} />
                <span>{t(`panel.tabs.${kind}`)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <aside
      className="work-panel"
      style={{ width: renderWidth }}
      data-testid="work-panel"
    >
      <div
        className="work-panel-resize no-drag"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
      <div className="work-panel-main">
        <header
          className="work-panel-header"
          data-work-panel-section="tools"
          onContextMenu={onHeaderContextMenu}
          onPointerDown={(event) => {
            if (event.button === 2) event.preventDefault();
          }}
        >
          <nav
            className="work-panel-tabs no-drag"
            role="tablist"
            aria-label={t("panel.title")}
            onContextMenu={onHeaderContextMenu}
          >
            {tabs.map((tab) => {
              const label = tabLabel(tab, t);
              const Icon = TAB_ICONS[tab.kind];
              const selected = tab.id === activeTabId;
              return (
                <div
                  ref={selected ? activeTabRef : undefined}
                  key={tab.id}
                  className={cx("work-panel-tab", selected && "active")}
                  data-work-panel-tab={tab.id}
                >
                  <button
                    type="button"
                    id={`work-panel-tab-${tab.id}`}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`work-panel-surface-${tab.id}`}
                    className="work-panel-tab-trigger"
                    title={label}
                    onClick={() => activateTab(tab.id)}
                  >
                    <span className="work-panel-tab-icon" aria-hidden>
                      <Icon size={14} />
                    </span>
                    <span className="work-panel-tab-label">{label}</span>
                  </button>
                  <button
                    type="button"
                    className="work-panel-tab-close"
                    title={t("panel.closeTab", { name: label })}
                    aria-label={t("panel.closeTab", { name: label })}
                    onClick={() => closeTab(tab.id)}
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              );
            })}
          </nav>
        </header>
        <div className="work-panel-body">
          {activeTab?.kind === "review" && (
            <div
              id={`work-panel-surface-${activeTab.id}`}
              className="work-panel-tabpane"
              role="tabpanel"
              aria-labelledby={`work-panel-tab-${activeTab.id}`}
            >
              <ReviewTab />
            </div>
          )}
          {/* The terminal mounts only after a command artifact opens it, then
              survives tab switches so its PTY and scrollback stay intact. */}
          {terminalOpen && (
            <div
              id="work-panel-surface-terminal"
              className={cx(
                "work-panel-tabpane",
                activeTab?.kind !== "terminal" && "is-hidden",
              )}
              role="tabpanel"
              aria-labelledby="work-panel-tab-terminal"
            >
              <TerminalTab active={activeTab?.kind === "terminal"} />
            </div>
          )}
          {activeTab?.kind === "browser" && (
            <div
              key={`${activeSessionId ?? "none"}:${activeTab.id}`}
              id={`work-panel-surface-${activeTab.id}`}
              className="work-panel-tabpane"
              role="tabpanel"
              aria-labelledby={`work-panel-tab-${activeTab.id}`}
            >
              <BrowserTab
                blocked={browserBlocked}
                sessionId={activeSessionId}
                initialUrl={activeTab.resource}
              />
            </div>
          )}
          {activeTab?.kind === "file" && (
            <div
              key={activeTab.id}
              id={`work-panel-surface-${activeTab.id}`}
              className="work-panel-tabpane"
              role="tabpanel"
              aria-labelledby={`work-panel-tab-${activeTab.id}`}
            >
              <FilesTab />
            </div>
          )}
        </div>
      </div>
      {toolsMenuPortal}
    </aside>
  );
}
