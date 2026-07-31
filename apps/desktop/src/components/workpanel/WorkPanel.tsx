import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { toolWorkPanelTab } from "../../lib/work-panel-tabs";
import { useAppStore } from "../../stores/app-store";
import type { WorkPanelTab } from "../../stores/app-store";
import { cx } from "../ui";
import {
  IconChevronDown,
  IconChevronRight,
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
  committedWorkPanelWidth,
  workPanelWidthFromPointer,
  workPanelWidthLimits,
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

type HeaderToolKind = (typeof HEADER_TOOLS)[number]["kind"];

function headerToolTab(kind: HeaderToolKind): WorkPanelTab {
  if (kind === "file") return { id: "file", kind };
  return toolWorkPanelTab(kind);
}

/** Tool tabs are singletons keyed by kind; every other tab carries a resource. */
function isToolTab(tab: WorkPanelTab) {
  return tab.id === tab.kind;
}

function clampWidth(width: number) {
  return clampWorkPanelWidth(width);
}

function tabLabel(tab: WorkPanelTab, t: (key: string) => string) {
  if (tab.kind !== "file") return t(`panel.tabs.${tab.kind}`);
  const path = tab.resource ?? "";
  return path.split("/").filter(Boolean).pop() || t("panel.tabs.file");
}

export function WorkPanel({
  browserBlocked = false,
  onCollapse,
  exiting = false,
  onExitAnimationEnd,
}: {
  browserBlocked?: boolean;
  onCollapse?: () => void;
  /** Plays work-panel-out; parent unmounts after animationend. */
  exiting?: boolean;
  onExitAnimationEnd?: () => void;
}) {
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
  /** Resources opened from the transcript; the tool singletons list above. */
  const resourceTabs = tabs.filter((tab) => !isToolTab(tab));

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
    width: number;
    frame: number;
  } | null>(null);
  const contextRef = useRef<HTMLDivElement | null>(null);
  const contextButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Where focus lands when the menu opens: the active row, or its last row. */
  const contextOpenFocus = useRef<"active" | "last">("active");
  const [contextOpen, setContextOpen] = useState(false);
  const [nativeSurfaceReadyForExit, setNativeSurfaceReadyForExit] =
    useState(false);

  const menuItems = useCallback(
    () =>
      Array.from(
        contextRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-work-panel-menu-item]",
        ) ?? [],
      ),
    [],
  );

  const closeContext = useCallback(() => {
    setContextOpen(false);
    contextButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!exiting) {
      setNativeSurfaceReadyForExit(false);
      return;
    }

    let current = true;
    // WebContentsView is composited above the renderer and cannot follow the
    // panel's CSS animation. Detach it before the dock starts moving.
    void api
      .browserSetVisible(false)
      .catch(() => undefined)
      .then(() => {
        if (current) setNativeSurfaceReadyForExit(true);
      });
    return () => {
      current = false;
    };
  }, [exiting]);

  useEffect(() => {
    if (!contextOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (contextRef.current?.contains(e.target as Node)) return;
      setContextOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeContext();
    };
    const onViewportChange = () => setContextOpen(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [closeContext, contextOpen]);

  // Menu rows own focus (ARIA menu pattern), and the row that is already
  // active is the one the pointer or keyboard most likely wants next.
  useEffect(() => {
    if (!contextOpen) return;
    const target = contextOpenFocus.current;
    contextOpenFocus.current = "active";
    requestAnimationFrame(() => {
      const items = menuItems();
      if (!items.length) return;
      if (target === "last") {
        items[items.length - 1]?.focus();
        return;
      }
      const checked = items.find(
        (item) => item.getAttribute("aria-checked") === "true",
      );
      (checked ?? items[0])?.focus();
    });
  }, [contextOpen, menuItems]);

  // Selecting a resource closes the menu explicitly; only a context switch
  // dismisses it behind the user's back.
  useEffect(() => {
    setContextOpen(false);
  }, [activeSessionId]);

  /** Close a tab from the menu without dismissing it, keeping focus in place. */
  const closeTabFromMenu = useCallback(
    (tabId: string, index: number) => {
      closeTab(tabId);
      requestAnimationFrame(() => {
        const items = menuItems();
        if (!items.length) return;
        items[Math.min(index, items.length - 1)]?.focus();
      });
    },
    [closeTab, menuItems],
  );

  const selectTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
      closeContext();
    },
    [activateTab, closeContext],
  );

  const openTool = useCallback(
    (kind: HeaderToolKind) => {
      // Reuse the singleton tab so an open tool keeps its resource instead of
      // being replaced by a blank one.
      const existing = tabs.find((tab) => tab.id === kind);
      if (existing) activateTab(existing.id);
      else openWorkPanelTab(headerToolTab(kind));
      closeContext();
    },
    [activateTab, closeContext, openWorkPanelTab, tabs],
  );

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    contextOpenFocus.current = event.key === "ArrowUp" ? "last" : "active";
    setContextOpen(true);
  };

  const onContextKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closeContext();
      return;
    }
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Delete" || event.key === "Backspace") {
      const closable = items[current]?.dataset.workPanelCloseId;
      if (!closable) return;
      event.preventDefault();
      closeTabFromMenu(closable, current);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") {
      next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    }
    items[next]?.focus();
  };

  const finishResize = useCallback(
    (target: HTMLDivElement, pointerId: number, commit: boolean) => {
      const drag = dragState.current;
      if (drag?.pointerId !== pointerId) return;
      dragState.current = null;
      if (drag.frame) cancelAnimationFrame(drag.frame);
      document.documentElement.removeAttribute("data-work-panel-resizing");
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      const committedWidth = committedWorkPanelWidth(drag, drag.width, commit);
      if (committedWidth !== null) setWidth(committedWidth);
      setDragWidth(null);
    },
    [setWidth],
  );

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      const startWidth = clampWidth(width);
      dragState.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startWidth,
        width: startWidth,
        frame: 0,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.documentElement.setAttribute("data-work-panel-resizing", "true");
      setDragWidth(startWidth);
    },
    [width],
  );

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (drag?.pointerId !== e.pointerId) return;
    drag.width = workPanelWidthFromPointer(
      drag,
      e.clientX,
    );
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (dragState.current !== drag) return;
      drag.frame = 0;
      setDragWidth(drag.width);
    });
  }, []);

  const onResizeCommit = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      finishResize(e.currentTarget, e.pointerId, true);
    },
    [finishResize],
  );

  const onResizeCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      finishResize(e.currentTarget, e.pointerId, false);
    },
    [finishResize],
  );

  useEffect(
    () => () => {
      const drag = dragState.current;
      if (drag?.frame) cancelAnimationFrame(drag.frame);
      document.documentElement.removeAttribute("data-work-panel-resizing");
    },
    [],
  );

  const renderWidth = clampWidth(dragWidth ?? width);
  const widthLimits = workPanelWidthLimits();
  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        finishResize(event.currentTarget, drag.pointerId, false);
        return;
      }
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
    [finishResize, renderWidth, setWidth, widthLimits.max, widthLimits.min],
  );
  const activeLabel = activeTab ? tabLabel(activeTab, t) : t("panel.title");
  const ActiveIcon = activeTab ? TAB_ICONS[activeTab.kind] : IconDiff;
  const exitAnimationReady = exiting && nativeSurfaceReadyForExit;

  return (
    <aside
      className={cx(
        "work-panel",
        exiting && !exitAnimationReady && "is-exit-pending",
        exitAnimationReady && "is-exiting",
      )}
      style={{ width: renderWidth }}
      data-testid="work-panel"
      data-resizing={dragWidth === null ? undefined : "true"}
      data-exiting={exiting ? "true" : undefined}
      onAnimationEnd={(event) => {
        if (!exitAnimationReady) return;
        // Bubbled tab/chrome animations must not finish the shell exit.
        if (event.target !== event.currentTarget) return;
        if (!event.animationName.startsWith("work-panel-out")) return;
        onExitAnimationEnd?.();
      }}
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
        onPointerUp={onResizeCommit}
        onPointerCancel={onResizeCancel}
        onLostPointerCapture={onResizeCancel}
        onKeyDown={onResizeKeyDown}
        onDoubleClick={() => setWidth(clampWidth(WORK_PANEL_DEFAULT_WIDTH))}
      />
      <div className="work-panel-main">
        <header className="work-panel-header" data-work-panel-section="current">
          <div className="work-panel-context no-drag" ref={contextRef}>
            <button
              ref={contextButtonRef}
              type="button"
              className="work-panel-switcher-trigger"
              aria-haspopup="menu"
              aria-expanded={contextOpen}
              aria-controls="work-panel-context-menu"
              title={activeTab?.resource ?? activeLabel}
              onClick={() => setContextOpen((open) => !open)}
              onKeyDown={onTriggerKeyDown}
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
                className={cx("work-panel-switcher-chevron", contextOpen && "open")}
              />
            </button>
            {contextOpen && (
              <div
                id="work-panel-context-menu"
                className="work-panel-context-menu"
                role="menu"
                aria-label={t("panel.title")}
                onKeyDown={onContextKeyDown}
              >
                {/* Tools keep fixed positions so switching stays muscle
                    memory; open tools carry their own close control here
                    instead of repeating in a second list. */}
                <div
                  className="work-panel-menu-group"
                  role="group"
                  aria-labelledby="work-panel-menu-tools"
                >
                  <div className="work-panel-menu-title" id="work-panel-menu-tools">
                    {t("panel.tools")}
                  </div>
                  {HEADER_TOOLS.map(({ kind, Icon }, index) => {
                    const tab = tabs.find((candidate) => candidate.id === kind);
                    const selected = tab?.id === activeTabId;
                    const label = t(`panel.tabs.${kind}`);
                    return (
                      <div
                        className={cx("work-panel-menu-row", selected && "active")}
                        role="none"
                        key={kind}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          tabIndex={-1}
                          data-work-panel-menu-item=""
                          data-work-panel-close-id={tab ? tab.id : undefined}
                          data-action={`open-work-panel-${kind}`}
                          className="work-panel-menu-item"
                          title={label}
                          onClick={() => openTool(kind)}
                        >
                          <Icon size={15} />
                          <span className="work-panel-menu-label">{label}</span>
                          {tab && !selected && (
                            <span className="work-panel-open-dot" aria-hidden />
                          )}
                        </button>
                        <span className="work-panel-menu-slot">
                          {tab && (
                            <button
                              type="button"
                              tabIndex={-1}
                              data-work-panel-menu-close=""
                              className="work-panel-menu-close"
                              title={t("panel.closeTab", { name: label })}
                              aria-label={t("panel.closeTab", { name: label })}
                              onClick={() => closeTabFromMenu(tab.id, index)}
                            >
                              <IconClose size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {resourceTabs.length > 0 && (
                  <>
                    <div className="work-panel-context-divider" />
                    <div
                      className="work-panel-menu-group"
                      role="group"
                      aria-labelledby="work-panel-menu-resources"
                    >
                      <div
                        className="work-panel-menu-title"
                        id="work-panel-menu-resources"
                      >
                        {t("panel.openItems")}
                      </div>
                      {resourceTabs.map((tab, index) => {
                        const label = tabLabel(tab, t);
                        const Icon = TAB_ICONS[tab.kind];
                        const selected = tab.id === activeTabId;
                        const itemIndex = HEADER_TOOLS.length + index;
                        return (
                          <div
                            className={cx("work-panel-menu-row", selected && "active")}
                            role="none"
                            key={tab.id}
                            data-work-panel-tab={tab.id}
                          >
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              tabIndex={-1}
                              data-work-panel-switch-item=""
                              data-work-panel-menu-item=""
                              data-work-panel-close-id={tab.id}
                              className="work-panel-menu-item"
                              title={tab.resource ?? label}
                              onClick={() => selectTab(tab.id)}
                            >
                              <Icon size={15} />
                              <span className="work-panel-menu-label">{label}</span>
                            </button>
                            <span className="work-panel-menu-slot">
                              <button
                                type="button"
                                tabIndex={-1}
                                data-work-panel-menu-close=""
                                className="work-panel-menu-close"
                                title={t("panel.closeTab", { name: label })}
                                aria-label={t("panel.closeTab", { name: label })}
                                onClick={() => closeTabFromMenu(tab.id, itemIndex)}
                              >
                                <IconClose size={12} />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="work-panel-actions no-drag">
            {activeTab && (
              <button
                type="button"
                className="work-panel-current-close"
                title={t("panel.closeTab", { name: activeLabel })}
                aria-label={t("panel.closeTab", { name: activeLabel })}
                onClick={() => closeTab(activeTab.id)}
              >
                <IconClose size={14} />
              </button>
            )}
            {onCollapse && (
              <button
                type="button"
                className="work-panel-toolbar-collapse"
                data-action="collapse-work-panel"
                title={t("panel.collapse")}
                aria-label={t("panel.collapse")}
                onClick={onCollapse}
              >
                <IconChevronRight size={16} />
              </button>
            )}
          </div>
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
                blocked={
                  exiting || browserBlocked || contextOpen || dragWidth !== null
                }
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
