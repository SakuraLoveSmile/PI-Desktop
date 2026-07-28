import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/app-store";
import type { WorkPanelTab } from "../../stores/app-store";
import { api } from "../../lib/api";
import { toolWorkPanelTab } from "../../lib/work-panel-tabs";
import { cx } from "../ui";
import {
  IconChevronDown,
  IconClose,
  IconDiff,
  IconFileText,
  IconGlobe,
  IconPanel,
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
  { kind: "file", Icon: IconFileText },
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

export function WorkPanel({ browserBlocked = false, onCollapse }: { browserBlocked?: boolean; onCollapse?: () => void }) {
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
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const switcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const switcherFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const resizeCommitTimer = useRef(0);
  const skipWindowResizeUntil = useRef(0);
  const viewportGeometry = useRef<WindowHorizontalGeometry>({
    x: window.screenX,
    width: window.innerWidth,
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    if (!switcherOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (switcherRef.current?.contains(e.target as Node)) return;
      setSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSwitcherOpen(false);
      switcherButtonRef.current?.focus();
    };
    const onViewportChange = () => setSwitcherOpen(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [switcherOpen]);

  useEffect(() => {
    if (!switcherOpen) return;
    requestAnimationFrame(() => switcherFirstItemRef.current?.focus());
  }, [switcherOpen]);

  useEffect(() => setSwitcherOpen(false), [activeTabId]);

  const onSwitcherKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSwitcherOpen(false);
      switcherButtonRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[data-work-panel-menu-item]:not(:disabled)',
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
  const activeLabel = activeTab ? tabLabel(activeTab, t) : t("panel.title");
  const ActiveIcon = activeTab ? TAB_ICONS[activeTab.kind] : IconDiff;

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
      <nav
        className="work-panel-rail no-drag"
        aria-label={t("panel.openTool")}
      >
        {onCollapse && (
          <button
            type="button"
            className="work-panel-rail-button work-panel-rail-collapse"
            data-action="collapse-work-panel"
            title={t("panel.collapse")}
            aria-label={t("panel.collapse")}
            onClick={onCollapse}
          >
            <IconPanel size={16} />
          </button>
        )}
        <div className="work-panel-rail-spacer" />
        {HEADER_TOOLS.map(({ kind, Icon }) => {
          const selected = activeTab?.kind === kind;
          const open = tabs.some((tab) => tab.kind === kind);
          const label = t(`panel.tabs.${kind}`, { defaultValue: kind });
          return (
            <button
              key={kind}
              type="button"
              className={cx(
                "work-panel-rail-button",
                selected && "active",
                open && "is-open",
              )}
              data-action={`open-work-panel-${kind}`}
              title={label}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => openWorkPanelTab(toolWorkPanelTab(kind))}
            >
              <Icon size={16} />
              {open && !selected && <span className="work-panel-open-dot" aria-hidden />}
            </button>
          );
        })}
      </nav>
      <div className="work-panel-main">
        <header className="work-panel-header" data-work-panel-section="current">
          <div className="work-panel-switcher-wrap no-drag" ref={switcherRef}>
            <button
              ref={switcherButtonRef}
              type="button"
              className="work-panel-switcher-trigger"
              aria-label={t("panel.openItems")}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              title={activeTab?.resource ?? activeLabel}
              onClick={() => setSwitcherOpen((open) => !open)}
            >
              <span className="work-panel-current-icon" aria-hidden>
                <ActiveIcon size={15} />
              </span>
              <span
                id={activeTab ? `work-panel-title-${activeTab.id}` : undefined}
                className="work-panel-current-label"
              >
                {activeLabel}
              </span>
              <IconChevronDown
                size={13}
                className={cx("work-panel-switcher-chevron", switcherOpen && "open")}
              />
            </button>
            {switcherOpen && (
              <div
                className="work-panel-switcher-menu"
                role="menu"
                aria-label={t("panel.openItems")}
                onKeyDown={onSwitcherKeyDown}
              >
                <div className="work-panel-switcher-title">{t("panel.openItems")}</div>
                <div className="work-panel-switcher-list">
                  {tabs.map((tab, index) => {
                    const label = tabLabel(tab, t);
                    const Icon = TAB_ICONS[tab.kind];
                    const selected = tab.id === activeTabId;
                    return (
                      <div
                        key={tab.id}
                        className={cx("work-panel-switcher-row", selected && "active")}
                        data-work-panel-tab={tab.id}
                      >
                        <button
                          ref={index === 0 ? switcherFirstItemRef : undefined}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          data-work-panel-switch-item=""
                          data-work-panel-menu-item=""
                          className="work-panel-switcher-item"
                          title={tab.resource ?? label}
                          onClick={() => {
                            activateTab(tab.id);
                            setSwitcherOpen(false);
                            requestAnimationFrame(() => switcherButtonRef.current?.focus());
                          }}
                        >
                          <Icon size={14} />
                          <span>{label}</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          data-work-panel-menu-item=""
                          className="work-panel-switcher-close"
                          title={t("panel.closeTab", { name: label })}
                          aria-label={t("panel.closeTab", { name: label })}
                          onClick={() => closeTab(tab.id)}
                        >
                          <IconClose size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {activeTab && (
            <button
              type="button"
              className="work-panel-current-close no-drag"
              title={t("panel.closeTab", { name: activeLabel })}
              aria-label={t("panel.closeTab", { name: activeLabel })}
              onClick={() => closeTab(activeTab.id)}
            >
              <IconClose size={13} />
            </button>
          )}
        </header>
        <div className="work-panel-body">
          {activeTab?.kind === "review" && (
            <div
              id={`work-panel-surface-${activeTab.id}`}
              className="work-panel-tabpane"
              role="tabpanel"
              aria-labelledby={`work-panel-title-${activeTab.id}`}
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
              aria-labelledby="work-panel-title-terminal"
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
              aria-labelledby={`work-panel-title-${activeTab.id}`}
            >
              <BrowserTab
                blocked={browserBlocked || switcherOpen}
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
              aria-labelledby={`work-panel-title-${activeTab.id}`}
            >
              <FilesTab />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
