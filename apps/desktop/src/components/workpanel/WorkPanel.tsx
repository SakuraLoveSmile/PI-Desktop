import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/app-store";
import type { WorkPanelTab } from "../../stores/app-store";
import { api } from "../../lib/api";
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
import {
  WORK_PANEL_DEFAULT_WIDTH,
  clampWorkPanelWidth,
  rightWindowEdgeDelta,
  userRightEdgeDelta,
  workPanelWidthLimits,
  workPanelWindowResizeAttributor,
  type WindowHorizontalGeometry,
} from "../../lib/work-panel-resize";

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

function workPanelWidthContext() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar, .sidebar-rail");
  return {
    viewportWidth: window.innerWidth,
    sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
  };
}

function clampWidth(width: number) {
  return clampWorkPanelWidth(width, workPanelWidthContext());
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
  const dragState = useRef<{ pointerId: number; width: number } | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const menuFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const resizeCommitTimer = useRef(0);
  const skipWindowResizeUntil = useRef(0);
  const viewportGeometry = useRef<WindowHorizontalGeometry>({
    x: window.screenX,
    width: window.innerWidth,
  });
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
      if (e.button !== 0) return;
      e.preventDefault();
      const nextWidth = clampWidth(window.innerWidth - e.clientX);
      dragState.current = { pointerId: e.pointerId, width: nextWidth };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragWidth(nextWidth);
    },
    [],
  );

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== e.pointerId) return;
    const nextWidth = clampWidth(window.innerWidth - e.clientX);
    dragState.current.width = nextWidth;
    setDragWidth(nextWidth);
  }, []);

  const onResizeEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragState.current?.pointerId !== e.pointerId) return;
      const nextWidth = dragState.current.width;
      dragState.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setWidth(nextWidth);
      setDragWidth(null);
    },
    [setWidth],
  );

  const [, bumpViewport] = useState(0);
  const renderWidth = clampWidth(dragWidth ?? width);
  const renderWidthRef = useRef(renderWidth);
  renderWidthRef.current = renderWidth;
  const widthLimits = workPanelWidthLimits(workPanelWidthContext());

  // Native right-edge resizing belongs to the outermost visible column. The
  // work panel absorbs that delta first; opening/collapse and divider commits
  // are attributed separately so their programmatic resize is not counted twice.
  useEffect(() => {
    const offMaximized = api.onWindowMaximized(() => {
      skipWindowResizeUntil.current = Date.now() + 300;
    });
    const offFullScreen = api.onWindowFullScreen(() => {
      skipWindowResizeUntil.current = Date.now() + 300;
    });
    const persistWidthSoon = () => {
      window.clearTimeout(resizeCommitTimer.current);
      resizeCommitTimer.current = window.setTimeout(() => {
        setWidth(useAppStore.getState().workPanelWidth, {
          resizeWindow: false,
        });
      }, 160);
    };
    const onWindowResize = () => {
      const previous = viewportGeometry.current;
      const next = { x: window.screenX, width: window.innerWidth };
      viewportGeometry.current = next;
      if (Date.now() <= skipWindowResizeUntil.current) {
        bumpViewport((value) => value + 1);
        return;
      }
      const viewportDelta = next.width - previous.width;
      const unattributedDelta =
        workPanelWindowResizeAttributor.consume(viewportDelta);
      const outerDelta = userRightEdgeDelta(
        viewportDelta,
        rightWindowEdgeDelta(previous, next),
        unattributedDelta,
      );
      if (outerDelta !== 0) {
        const nextPanelWidth = clampWidth(renderWidthRef.current + outerDelta);
        if (nextPanelWidth !== renderWidthRef.current) {
          renderWidthRef.current = nextPanelWidth;
          setWidth(nextPanelWidth, { resizeWindow: false, persist: false });
          persistWidthSoon();
        }
      }
      bumpViewport((value) => value + 1);
    };
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      offMaximized();
      offFullScreen();
      window.clearTimeout(resizeCommitTimer.current);
      setWidth(useAppStore.getState().workPanelWidth, {
        resizeWindow: false,
      });
    };
  }, [setWidth]);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId]);
  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 16;
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") nextWidth = renderWidth + step;
      else if (event.key === "ArrowRight") nextWidth = renderWidth - step;
      else if (event.key === "Home") nextWidth = widthLimits.min;
      else if (event.key === "End") nextWidth = widthLimits.max;
      if (nextWidth === null) return;
      event.preventDefault();
      setWidth(clampWidth(nextWidth));
    },
    [renderWidth, setWidth, widthLimits.max, widthLimits.min],
  );

  const toolsMenuPortal =
    toolsMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            className="sidebar-row-menu sidebar-floating-menu work-panel-tools-menu"
            role="menu"
            data-work-panel-tools-menu=""
            aria-label={t("panel.openTool", { defaultValue: "Open tool" })}
            onKeyDown={onMenuKeyDown}
            style={{ top: toolsMenu.top, right: toolsMenu.right }}
          >
            <div className="sidebar-popover-title">{t("panel.openTool", { defaultValue: "Open tool" })}</div>
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
                <span>{t(`panel.tabs.${kind}`, { defaultValue: kind })}</span>
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
        aria-label={t("panel.resize")}
        aria-valuemin={widthLimits.min}
        aria-valuemax={widthLimits.max}
        aria-valuenow={Math.round(renderWidth)}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onLostPointerCapture={onResizeEnd}
        onKeyDown={onResizeKeyDown}
        onDoubleClick={() => setWidth(clampWidth(WORK_PANEL_DEFAULT_WIDTH))}
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
