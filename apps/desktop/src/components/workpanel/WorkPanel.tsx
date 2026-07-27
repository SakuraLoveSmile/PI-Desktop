import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, WORK_PANEL_MIN_WIDTH } from "../../stores/app-store";
import type { WorkPanelTab } from "../../stores/app-store";
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
  const setWidth = useAppStore((s) => s.setWorkPanelWidth);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const terminalOpen = tabs.some((tab) => tab.kind === "terminal");

  // Live width during a drag stays local; the store (and localStorage)
  // only sees the committed value on pointer-up.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragState = useRef<{ pointerId: number } | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

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
        <header className="work-panel-header">
          <nav
            className="work-panel-tabs no-drag"
            role="tablist"
            aria-label={t("panel.title")}
          >
            {tabs.map((tab) => {
              const label = tabLabel(tab, t);
              const Icon = TAB_ICONS[tab.kind];
              const selected = tab.id === activeTabId;
              return (
                <div
                  ref={selected ? activeTabRef : undefined}
                  className={cx("work-panel-tab", selected && "active")}
                  key={tab.id}
                >
                  <button
                    id={`work-panel-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`work-panel-surface-${tab.id}`}
                    className="work-panel-tab-trigger"
                    onClick={() => activateTab(tab.id)}
                    title={tab.resource ?? label}
                  >
                    <span className="work-panel-tab-icon" aria-hidden>
                      <Icon size={14} />
                    </span>
                    <span className="work-panel-tab-label">{label}</span>
                  </button>
                  <button
                    type="button"
                    className="work-panel-tab-close"
                    aria-label={t("panel.closeTab", { name: label })}
                    title={t("panel.closeTab", { name: label })}
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
    </aside>
  );
}
