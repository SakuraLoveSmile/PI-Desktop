export type WorkPanelTabKind =
  | "review"
  | "terminal"
  | "browser"
  | "file"
  | "plugin";

export type WorkPanelTab = {
  id: string;
  kind: WorkPanelTabKind;
  resource?: string;
};

export type WorkPanelTabsState = {
  tabs: WorkPanelTab[];
  activeTabId: string | null;
};

export type WorkPanelContext = WorkPanelTabsState & {
  open: boolean;
  fileRequest: { path: string; seq: number } | null;
};

export type ReviewArtifactEvent = {
  toolName?: string;
  isError?: boolean;
  result: unknown;
};

export function emptyWorkPanelContext(): WorkPanelContext {
  return { open: false, tabs: [], activeTabId: null, fileRequest: null };
}

export function switchWorkPanelContextState(
  contexts: Record<string, WorkPanelContext>,
  currentSessionId: string | undefined,
  currentVisible: WorkPanelContext,
  nextSessionId: string | undefined,
): { contexts: Record<string, WorkPanelContext>; visible: WorkPanelContext } {
  // A background artifact can update the retained context while an async
  // session selection still renders the older projection. Retained state wins.
  const retainedCurrent = currentSessionId
    ? contexts[currentSessionId] ?? currentVisible
    : currentVisible;
  const nextContexts = currentSessionId
    ? { ...contexts, [currentSessionId]: retainedCurrent }
    : contexts;
  return {
    contexts: nextContexts,
    visible: nextSessionId
      ? nextContexts[nextSessionId] ?? emptyWorkPanelContext()
      : emptyWorkPanelContext(),
  };
}

export function toolWorkPanelTab(
  kind: Exclude<WorkPanelTabKind, "file" | "plugin">,
): WorkPanelTab {
  return { id: kind, kind };
}

/**
 * A plugin-contributed view (ADR 0103).
 *
 * Keyed by `<pluginId>/<viewId>` so two plugins may ship a view with the same
 * local id, and so re-opening the same view reuses its tab instead of stacking
 * duplicates. Like the tool singletons, a view is a *tool* rather than a
 * transcript resource — see `isToolWorkPanelTab`.
 */
export function pluginWorkPanelTab(pluginId: string, viewId: string): WorkPanelTab {
  const resource = `${pluginId}/${viewId}`;
  return { id: `plugin:${resource}`, kind: "plugin", resource };
}

export function parsePluginViewRef(
  resource: string | undefined,
): { pluginId: string; viewId: string } | null {
  if (!resource) return null;
  // A plugin id may itself contain dots but never a slash, and a view id is
  // slash-free by manifest validation, so the first separator splits cleanly.
  const separator = resource.indexOf("/");
  if (separator <= 0 || separator === resource.length - 1) return null;
  return {
    pluginId: resource.slice(0, separator),
    viewId: resource.slice(separator + 1),
  };
}

/**
 * Tools are the panel's stable entry points; everything else is a resource the
 * transcript opened. Tool singletons are keyed by kind; a plugin view is also a
 * tool, so it belongs in the tools half of the menu rather than under "open
 * resources" — its id carries a resource only because that is how it is
 * addressed.
 */
export function isToolWorkPanelTab(tab: WorkPanelTab): boolean {
  return tab.id === tab.kind || tab.kind === "plugin";
}

export function normalizeWorkPanelFilePath(path: string): string {
  const normalizedSeparators = path.replace(/\\/g, "/");
  const absolute = normalizedSeparators.startsWith("/");
  const segments: string[] = [];

  for (const segment of normalizedSeparators.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      const previous = segments.at(-1);
      if (previous && previous !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  const normalized = segments.join("/");
  return absolute ? `/${normalized}` : normalized;
}

export function fileWorkPanelTab(path: string): WorkPanelTab {
  const resource = normalizeWorkPanelFilePath(path);
  return { id: `file:${resource}`, kind: "file", resource };
}

export function toolResultRoot(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const details = (result as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const root = (details as { root?: unknown }).root;
  return typeof root === "string" ? root : null;
}

export function shouldOpenReviewArtifact(event: ReviewArtifactEvent): boolean {
  return (
    (event.toolName === "Write" || event.toolName === "Edit") &&
    event.isError !== true &&
    toolResultRoot(event.result) === "workspace"
  );
}

export function openWorkPanelTabState(
  state: WorkPanelTabsState,
  tab: WorkPanelTab,
): WorkPanelTabsState {
  const index = state.tabs.findIndex((item) => item.id === tab.id);
  if (index === -1) {
    return { tabs: [...state.tabs, tab], activeTabId: tab.id };
  }
  const tabs = [...state.tabs];
  tabs[index] = tab;
  return { tabs, activeTabId: tab.id };
}

export function activateWorkPanelTabState(
  state: WorkPanelTabsState,
  tabId: string,
): WorkPanelTabsState {
  return state.tabs.some((tab) => tab.id === tabId)
    ? { ...state, activeTabId: tabId }
    : state;
}

export function closeWorkPanelTabState(
  state: WorkPanelTabsState,
  tabId: string,
): WorkPanelTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return state;

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (state.activeTabId !== tabId) return { tabs, activeTabId: state.activeTabId };
  return {
    tabs,
    activeTabId: tabs[Math.min(index, tabs.length - 1)]?.id ?? null,
  };
}
