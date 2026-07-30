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
  IconPlus,
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

function clampWidth(width: number) {
  return clampWorkPanelWidth(width);
}

function tabLabel(tab: WorkPanelTab, t: (key: string) => string) {
  if (tab.kind !== "file") return t(`panel.tabs.${tab.kind}`);
  const path = tab.resource ?? "";
  return path.split("/").filter(Boolean).pop() || path;
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

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
    width: number;
    frame: number;
  } | null>(null);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const switcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const switcherFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const createRef = useRef<HTMLDivElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const createFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [nativeSurfaceReadyForExit, setNativeSurfaceReadyForExit] =
    useState(false);

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
    if (!switcherOpen && !createOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (switcherRef.current?.contains(e.target as Node)) return;
      if (createRef.current?.contains(e.target as Node)) return;
      setSwitcherOpen(false);
      setCreateOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSwitcherOpen(false);
      setCreateOpen(false);
      switcherButtonRef.current?.focus();
      createButtonRef.current?.focus();
    };
    const onViewportChange = () => {
      setSwitcherOpen(false);
      setCreateOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [switcherOpen, createOpen]);

  useEffect(() => {
    if (!switcherOpen) return;
    requestAnimationFrame(() => switcherFirstItemRef.current?.focus());
  }, [switcherOpen]);

  useEffect(() => {
    if (!createOpen) return;
    requestAnimationFrame(() => createFirstItemRef.current?.focus());
  }, [createOpen]);

  useEffect(() => {
    setSwitcherOpen(false);
    setCreateOpen(false);
  }, [activeTabId]);

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

  const onCreateKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setCreateOpen(false);
      createButtonRef.current?.focus();
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
            <div className="work-panel-create" ref={createRef}>
              <button
                ref={createButtonRef}
                type="button"
                className="work-panel-create-trigger"
                aria-label={t("panel.openTool")}
                aria-haspopup="menu"
                aria-expanded={createOpen}
                title={t("panel.openTool")}
                onClick={() => setCreateOpen((open) => !open)}
              >
                <IconPlus size={16} />
                <IconChevronDown
                  size={12}
                  className={cx("work-panel-create-chevron", createOpen && "open")}
                />
              </button>
              {createOpen && (
                <div
                  className="work-panel-create-menu"
                  role="menu"
                  aria-label={t("panel.openTool")}
                  onKeyDown={onCreateKeyDown}
                >
                  <div className="work-panel-create-title">{t("panel.openTool")}</div>
                  <div className="work-panel-create-list">
                    {HEADER_TOOLS.map(({ kind, Icon }, index) => {
                      const selected = activeTab?.kind === kind;
                      const open = tabs.some((tab) => tab.kind === kind);
                      const label = t(`panel.tabs.${kind}`, { defaultValue: kind });
                      return (
                        <button
                          key={kind}
                          ref={index === 0 ? createFirstItemRef : undefined}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          data-work-panel-menu-item=""
                          data-action={`open-work-panel-${kind}`}
                          className={cx("work-panel-create-item", selected && "active")}
                          title={label}
                          aria-label={label}
                          onClick={() => {
                            openWorkPanelTab(headerToolTab(kind));
                            setCreateOpen(false);
                            requestAnimationFrame(() => createButtonRef.current?.focus());
                          }}
                        >
                          <Icon size={15} />
                          <span>{label}</span>
                          {open && !selected && <span className="work-panel-open-dot" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
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
                  exiting || browserBlocked || switcherOpen || dragWidth !== null
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
