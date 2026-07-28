import { create } from "zustand";
import i18n from "i18next";
import type {
  AgentEventEnvelope,
  AppError,
  AppNotification,
  AppSettings,
  AppVersionInfo,
  ModelInfo,
  OnboardingState,
  PluginSummary,
  PermissionMode,
  ProjectWorkspace,
  ProviderPublic,
  SessionSummary,
  ThinkingLevel,
  UiMessage,
  WorkspaceDiff,
} from "@pi-desktop/shared";
import {
  highestSupportedThinkingLevel,
  PROTOCOL_VERSION,
} from "@pi-desktop/shared";
import { api } from "../lib/api";
import { createNavigationIntentController } from "../lib/navigation-intent";
import { rememberProject, setProjectPinned } from "../lib/recent-projects";
import { normalizeProjectPath, sessionMatchesProject } from "../lib/sidebar-session-groups";
import {
  latestSessionOutcomes,
  type SidebarSessionOutcome,
} from "../lib/sidebar-session-status";
import {
  loadSidebarPreferences,
  projectIsArchived,
  projectIsCollapsed,
  projectIsPinned,
  projectWorkspaceFromPath,
  saveSidebarPreferences,
  sessionIsArchived,
  sessionIsPinned,
  sortProjects,
  sortSessions,
  type ProjectMeta,
  type ProjectSort,
  type SessionMeta,
  type SessionSort,
} from "../lib/sidebar-preferences";
import { formatToolValue } from "../lib/tool-display";
import {
  withoutWorkspaceReviewSessions,
  type WorkspaceReviewSessions,
} from "../lib/workspace-review";
import {
  activateWorkPanelTabState,
  closeWorkPanelTabState,
  emptyWorkPanelContext,
  fileWorkPanelTab,
  openWorkPanelTabState,
  shouldOpenReviewArtifact,
  switchWorkPanelContextState,
  toolWorkPanelTab,
  type WorkPanelContext,
  type WorkPanelTab,
} from "../lib/work-panel-tabs";
import {
  clearPendingPermission,
  setPendingPermission,
  type PendingPermission,
} from "../lib/pending-permissions";
import {
  WORK_PANEL_DEFAULT_WIDTH,
  WORK_PANEL_MAX_WIDTH,
  WORK_PANEL_MIN_WIDTH,
  workPanelWindowResizeAttributor,
} from "../lib/work-panel-resize";

export type { WorkPanelTab } from "../lib/work-panel-tabs";

// Sessions created before locale switches keep their old default title, so
// match against every locale's defaults (case-insensitive), not just the
// active locale's.
const LEGACY_DEFAULT_TITLES = new Set(["new task", "new chat", "新建任务", "新对话"]);

function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss delay in ms; 0 keeps the toast until dismissed. */
  duration: number;
};

export type ToastOptions = {
  variant?: ToastVariant;
  /** Override the variant default (4s, error 8s); 0 disables auto-dismiss. */
  duration?: number;
};

const WORK_PANEL_STORAGE_KEY = "pi.desktop.workPanel";
// Preserve the original 320px tool-content minimum beside the 44px activity rail.
export { WORK_PANEL_DEFAULT_WIDTH, WORK_PANEL_MIN_WIDTH };

// Opening the panel grows the OS window outward so the chat column keeps its
// width; closing shrinks it back by whatever the expansion actually achieved.
// Windows keeps the native bounds stable because a frameless BrowserWindow
// visibly repaints between the renderer layout and asynchronous bounds update.
let panelWindowGrowth: number | null = null;
let workspaceDiffRequestSeq = 0;
let workPanelFileRequestSeq = 0;
const navigationIntents = createNavigationIntentController();
let sessionSelectionQueue: Promise<void> = Promise.resolve();
let pendingSessionSelection: { id: string; intent: number } | null = null;

type NavigationOptions = {
  /** Reuse an owning navigation's generation across nested async operations. */
  navigationIntent?: number;
};

function beginNavigationIntent() {
  return navigationIntents.begin();
}

function navigationIntentIsCurrent(intent: number) {
  return navigationIntents.isCurrent(intent);
}

function canResizeWindowForPanel() {
  return window.piDesktop?.platform !== "win32";
}

function resizeWindowForPanel(deltaWidth: number) {
  const ticket = workPanelWindowResizeAttributor.begin(deltaWidth);
  return api.windowResizeBy(deltaWidth).then(
    (result) => {
      workPanelWindowResizeAttributor.settle(ticket, result.applied);
      return result;
    },
    (error) => {
      workPanelWindowResizeAttributor.settle(ticket, 0);
      throw error;
    },
  );
}

function expandWindowForPanel(width: number) {
  if (!canResizeWindowForPanel()) {
    panelWindowGrowth = 0;
    return;
  }
  panelWindowGrowth = null;
  resizeWindowForPanel(width).then(
    (r) => {
      panelWindowGrowth = r.applied;
    },
    () => {
      panelWindowGrowth = 0;
    },
  );
}

function shrinkWindowForPanel(width: number) {
  if (!canResizeWindowForPanel()) {
    panelWindowGrowth = null;
    return;
  }
  // After a restart the growth is unknown, but the persisted window bounds
  // already include it — shrinking by the panel width restores the chat size.
  const growth = panelWindowGrowth ?? width;
  panelWindowGrowth = null;
  if (growth !== 0) void resizeWindowForPanel(-growth).catch(() => {});
}

function messageErrorFromUnknown(error: unknown): AppError {
  const value = error as {
    code?: string;
    message?: string;
    retriable?: boolean;
  };
  return {
    code: value?.code || "INTERNAL",
    message:
      error instanceof Error
        ? error.message
        : typeof value?.message === "string"
          ? value.message
          : String(error),
    retriable: value?.retriable === true,
  };
}

function assistantErrorMessage(error: AppError): UiMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    status: "error",
    isError: true,
    error,
  };
}

function loadWorkPanelWidth(): number {
  try {
    const raw = localStorage.getItem(WORK_PANEL_STORAGE_KEY);
    if (!raw) return WORK_PANEL_DEFAULT_WIDTH;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const width = Number(parsed.width);
    return Number.isFinite(width)
      ? Math.max(WORK_PANEL_MIN_WIDTH, Math.min(WORK_PANEL_MAX_WIDTH, width))
      : WORK_PANEL_DEFAULT_WIDTH;
  } catch {
    return WORK_PANEL_DEFAULT_WIDTH;
  }
}

function saveWorkPanelWidth(width: number) {
  try {
    localStorage.setItem(
      WORK_PANEL_STORAGE_KEY,
      JSON.stringify({ width }),
    );
  } catch {
    // best-effort persistence
  }
}


// Design-system §11.8: default 4s auto-dismiss, errors linger 8s.
const TOAST_DURATION_MS = 4000;
const TOAST_ERROR_DURATION_MS = 8000;
// Visible stack cap — oldest toasts drop first when exceeded.
const TOAST_STACK_LIMIT = 4;
let toastSeq = 0;

function untitledTaskTitle() {
  return i18n.t("chat.untitledTask");
}

export function isDefaultSessionTitle(title?: string | null) {
  const trimmed = (title || "").trim().toLowerCase();
  return (
    !trimmed ||
    LEGACY_DEFAULT_TITLES.has(trimmed) ||
    trimmed === untitledTaskTitle().toLowerCase() ||
    trimmed === i18n.t("nav.newChat").toLowerCase()
  );
}

export type SessionView = {
  sort: SessionSort;
  /** Alias retained for sidebar consumers that use the explicit name. */
  sortBy?: SessionSort;
  /** Whether archived sessions are included in sidebar queries. */
  archived: boolean;
  showArchived?: boolean;
};

export type AppState = {
  ready: boolean;
  version?: AppVersionInfo;
  healthOk: boolean;
  settings?: AppSettings;
  sessions: SessionSummary[];
  /** Renderer-owned conversation presentation metadata. */
  sessionMeta: Record<string, SessionMeta>;
  sessionView: SessionView;
  /** Open project tabs and the host's currently active workspace. */
  openProjects: ProjectWorkspace[];
  openProjectPaths: string[];
  activeProjectPath?: string;
  projectMeta: Record<string, ProjectMeta>;
  /** Kept as a flat map for lightweight consumers (Sidebar). */
  projectCollapsed: Record<string, boolean>;
  projectSort: ProjectSort;
  activeSessionId?: string;
  messages: UiMessage[];
  isRunning: boolean;
  /** Run state per session id — sessions run independent agents. */
  runningSessions: Record<string, boolean>;
  /** Latest terminal outcome per session for compact sidebar feedback. */
  sessionOutcomes: Record<string, SidebarSessionOutcome>;
  providers: ProviderPublic[];
  /** Discovered model lists per provider id (composer model menu). */
  providerModels: Record<string, ModelInfo[]>;
  workspace?: ProjectWorkspace | null;
  onboarding?: OnboardingState;
  plugins: PluginSummary[];
  pendingPermissions: Record<string, PendingPermission>;
  toasts: ToastItem[];
  notifications: AppNotification[];
  unreadNotificationCount: number;
  page: "chat" | "pulls" | "scheduled" | "plugins" | "settings";
  settingsTab: "general" | "agent" | "import" | "projects" | "about";
  /** Pending row anchor (i18n key) to flash after landing on a settings tab. */
  settingsAnchor: string | null;
  navStack: Array<{ page: AppState["page"]; sessionId?: string }>;
  navIndex: number;
  error?: string | null;
  errorCode?: string | null;
  /** Whether the current error is worth a one-click retry (agent errors). */
  errorRetriable?: boolean | null;
  bootstrap: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  selectSession: (
    id: string,
    opts?: { record?: boolean } & NavigationOptions,
  ) => Promise<void>;
  newSession: (options?: { projectPath?: string | null }) => Promise<void>;
  forkSession: (id: string) => Promise<void>;
  forkAssistantMessage: (messageId: string) => Promise<void>;
  configureActiveSession: (config: {
    mode: "chat" | "agent";
    providerId?: string;
    modelId?: string;
    thinkingLevel: ThinkingLevel;
    permissionMode?: PermissionMode;
  }) => Promise<void>;
  sendPrompt: (content: string) => Promise<void>;
  retryAssistantMessage: (messageId: string) => Promise<void>;
  /** Replace a user prompt and regenerate from it; the old branch stays in the revision pager. */
  editUserMessage: (messageId: string, content: string) => Promise<boolean>;
  retryLastPrompt: () => Promise<void>;
  clearError: () => void;
  activateMessageRevision: (rootUserId: string, revisionIndex: number) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  abort: () => Promise<void>;
  openProject: () => Promise<void>;
  activateProject: (
    path: string,
    opts?: NavigationOptions,
  ) => Promise<ProjectWorkspace | null>;
  openProjectPath: (path: string) => Promise<ProjectWorkspace | null>;
  switchProjectPath: (path: string) => Promise<ProjectWorkspace | null>;
  closeProjectPath: (path: string) => Promise<void>;
  clearProject: (opts?: NavigationOptions) => Promise<void>;
  toggleSessionPinned: (id: string) => void;
  toggleSessionArchived: (id: string) => void;
  archiveSession: (id: string) => void;
  restoreSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  setSessionSort: (sort: SessionSort) => void;
  setSessionArchiveVisibility: (show: boolean) => void;
  setSessionView: (view: Partial<SessionView> | boolean) => void;
  setShowArchived: (show: boolean) => void;
  toggleProjectPinned: (path: string, pinned?: boolean) => void;
  toggleProjectArchived: (path: string) => void;
  restoreProject: (path: string) => void;
  archiveProject: (path: string) => void;
  setProjectCollapsed: (path: string, collapsed?: boolean) => void;
  toggleProjectCollapsed: (path: string) => void;
  closeProject: (path: string) => Promise<void>;
  setProjectSort: (sort: ProjectSort) => void;
  getVisibleSessions: (options?: {
    projectPath?: string | null;
    includeArchived?: boolean;
  }) => SessionSummary[];
  getSortedProjects: () => ProjectWorkspace[];
  refreshProviders: () => Promise<void>;
  /** Load a provider's model list into the cache (no-op when cached). */
  loadProviderModels: (providerId: string) => Promise<void>;
  refreshPlugins: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  receiveNotification: (notification: AppNotification) => void;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearNotifications: () => Promise<void>;
  openNotification: (id: string) => Promise<void>;
  /** Drop a session's sidebar outcome badge and read its task notifications. */
  acknowledgeSessionOutcome: (sessionId: string) => Promise<void>;
  handleAgentEvent: (envelope: AgentEventEnvelope) => void;
  setPage: (page: AppState["page"], opts?: { record?: boolean }) => void;
  setSettingsTab: (tab: AppState["settingsTab"]) => void;
  setSettingsAnchor: (key: string | null) => void;
  navBack: () => void;
  navForward: () => void;
  canNavBack: () => boolean;
  canNavForward: () => boolean;
  resolvePermission: (
    sessionId: string,
    requestId: string,
    decision: "allow-once" | "allow-session" | "deny",
  ) => Promise<void>;
  showToast: (message: string, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
  composerPrefill: string | null;
  clearComposerPrefill: () => void;
  workPanelOpen: boolean;
  workPanelTabs: WorkPanelTab[];
  activeWorkPanelTabId: string | null;
  /** Runtime-only work panel state owned by each conversation. */
  workPanelContexts: Record<string, WorkPanelContext>;
  workPanelWidth: number;
  /** Bumped on agent Write/Edit/Bash completion; review tab refetches. */
  reviewRev: number;
  workspaceDiff: WorkspaceDiff | null;
  workspaceDiffPath: string | null;
  workspaceDiffLoading: boolean;
  /** Sessions that produced reviewable edits, keyed to their workspace path. */
  workspaceReviewSessions: WorkspaceReviewSessions;
  refreshWorkspaceDiff: () => Promise<void>;
  /** Chat-initiated "preview this file" request consumed by the files tab. */
  workPanelFileRequest: { path: string; seq: number } | null;
  openWorkPanelTab: (tab: WorkPanelTab) => void;
  openWorkPanelTabForSession: (sessionId: string, tab: WorkPanelTab) => void;
  activateWorkPanelTab: (tabId: string) => void;
  closeWorkPanelTab: (tabId: string) => void;
  collapseWorkPanel: () => void;
  /** Hide the visible panel while retaining its session-owned context. */
  resetWorkPanelContext: () => void;
  setWorkPanelWidth: (
    width: number,
    options?: { resizeWindow?: boolean; persist?: boolean },
  ) => void;
  /** Open a workspace-relative file in the work panel files viewer. */
  openFileInWorkPanel: (path: string) => void;
  /** Open a URL in the work panel browser tab. */
  openUrlInWorkPanel: (url: string) => void;
  /** Open the interactive terminal from a completed command artifact. */
  openTerminalInWorkPanel: () => void;
};

const initialSidebarPreferences = loadSidebarPreferences();
const initialWorkPanelWidth = loadWorkPanelWidth();

function currentWorkPanelContext(state: AppState): WorkPanelContext {
  return {
    open: state.workPanelOpen,
    tabs: state.workPanelTabs,
    activeTabId: state.activeWorkPanelTabId,
    fileRequest: state.workPanelFileRequest,
  };
}

function switchWorkPanelSession(
  state: AppState,
  nextSessionId?: string,
): Pick<
  AppState,
  | "workPanelContexts"
  | "workPanelOpen"
  | "workPanelTabs"
  | "activeWorkPanelTabId"
  | "workPanelFileRequest"
> {
  const switched = switchWorkPanelContextState(
    state.workPanelContexts,
    state.activeSessionId,
    currentWorkPanelContext(state),
    nextSessionId,
  );
  return {
    workPanelContexts: switched.contexts,
    workPanelOpen: switched.visible.open,
    workPanelTabs: switched.visible.tabs,
    activeWorkPanelTabId: switched.visible.activeTabId,
    workPanelFileRequest: switched.visible.fileRequest,
  };
}

function syncPanelWindowForVisibility(
  previousOpen: boolean,
  nextOpen: boolean,
  width: number,
) {
  if (previousOpen === nextOpen) return;
  if (nextOpen) expandWindowForPanel(width);
  else shrinkWindowForPanel(width);
}

// tool_end events carry no tool name, and cross-session tool calls never
// enter `messages`, so remember names from tool_start envelopes here.
const WORKSPACE_MUTATING_TOOLS = new Set(["Write", "Edit", "Bash"]);
const toolNamesByCallId = new Map<string, string>();
const TOOL_NAME_CACHE_LIMIT = 512;
const providerModelLoads = new Map<string, Promise<void>>();
const refreshedProviderModels = new Set<string>();
let providerModelsGeneration = 0;

function decorateSessions(
  sessions: SessionSummary[],
  meta: Record<string, SessionMeta>,
): SessionSummary[] {
  return sessions.map((session) => ({
    ...session,
    pinned: sessionIsPinned(session.id, meta),
    archived: sessionIsArchived(session.id, meta),
  }));
}

function promoteProjectPath(paths: string[], rawPath: string): string[] {
  const key = normalizeProjectPath(rawPath);
  if (!key) return paths;
  const withoutPath = paths.filter(
    (path) => normalizeProjectPath(path) !== key,
  );
  return [...withoutPath, rawPath];
}

function removeProjectPath(paths: string[], rawPath: string): string[] {
  const key = normalizeProjectPath(rawPath);
  return key
    ? paths.filter((path) => normalizeProjectPath(path) !== key)
    : paths;
}

function upsertWorkspace(
  projects: ProjectWorkspace[],
  workspace: ProjectWorkspace,
): ProjectWorkspace[] {
  const key = normalizeProjectPath(workspace.path);
  if (!key) return projects;
  const index = projects.findIndex((item) => normalizeProjectPath(item.path) === key);
  if (index < 0) return [...projects, workspace];
  const next = projects.slice();
  next[index] = { ...next[index], ...workspace };
  return next;
}

function preferencesFromState(state: Pick<
  AppState,
  | "sessionMeta"
  | "projectMeta"
  | "projectSort"
  | "sessionView"
  | "openProjectPaths"
>) {
  return {
    sessionMeta: state.sessionMeta,
    projectMeta: state.projectMeta,
    projectSort: state.projectSort,
    sessionView: state.sessionView,
    openProjectPaths: state.openProjectPaths,
  };
}

function persistCurrentSidebar(getState: () => AppState): void {
  saveSidebarPreferences(preferencesFromState(getState()));
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  healthOk: false,
  sessions: [],
  sessionMeta: initialSidebarPreferences.sessionMeta,
  sessionView: {
    ...initialSidebarPreferences.sessionView,
    sortBy: initialSidebarPreferences.sessionView.sort,
    showArchived: initialSidebarPreferences.sessionView.archived,
  },
  openProjects: initialSidebarPreferences.openProjectPaths.map(projectWorkspaceFromPath),
  openProjectPaths: initialSidebarPreferences.openProjectPaths,
  activeProjectPath: undefined,
  projectMeta: initialSidebarPreferences.projectMeta,
  projectCollapsed: Object.fromEntries(
    Object.entries(initialSidebarPreferences.projectMeta)
      .filter(([, meta]) => meta.collapsed === true)
      .map(([path]) => [path, true]),
  ),
  workPanelOpen: false,
  workPanelTabs: [],
  activeWorkPanelTabId: null,
  workPanelContexts: {},
  workPanelWidth: initialWorkPanelWidth,
  reviewRev: 0,
  workspaceDiff: null,
  workspaceDiffPath: null,
  workspaceDiffLoading: false,
  workspaceReviewSessions: {},
  workPanelFileRequest: null,
  projectSort: initialSidebarPreferences.projectSort,
  messages: [],
  isRunning: false,
  runningSessions: {},
  sessionOutcomes: {},
  providers: [],
  providerModels: {},
  plugins: [],
  pendingPermissions: {},
  page: "chat",
  settingsTab: "general",
  settingsAnchor: null,
  navStack: [{ page: "chat" }],
  navIndex: 0,
  toasts: [],
  notifications: [],
  unreadNotificationCount: 0,
  composerPrefill: null,
  error: null,
  errorCode: null,
  errorRetriable: null,

  bootstrap: async () => {
    try {
      const [
        version,
        health,
        settingsRaw,
        sessions,
        providers,
        project,
        onboarding,
        plugins,
        notifications,
      ] =
        await Promise.all([
          api.getVersion(),
          api.health(),
          api.getSettings(),
          api.listSessions(),
          api.listProviders(),
          api.getProject(),
          api.getOnboarding(),
          api.listPlugins(),
          api.listNotifications({ limit: 200 }),
        ]);
      let settings = settingsRaw;
      // First-run default per D003: Agent. Never force-rewrite an existing
      // user choice on boot (a previous build reset it to chat each launch).
      if (settings && !settings.defaultMode) {
        const next = { ...settings, defaultMode: "agent" as const };
        try {
          await api.setSettings(next);
          settings = next;
        } catch {
          settings = next;
        }
      }
      if (version.protocolVersion !== PROTOCOL_VERSION) {
        set({
          error: `Protocol mismatch: UI ${PROTOCOL_VERSION} vs app ${version.protocolVersion}`,
          errorCode: "PROTOCOL_MISMATCH",
        });
      }
      const cachedProviderModels = Object.fromEntries(
        (
          await Promise.all(
            providers.providers.map(async (provider) => {
              try {
                const cached = await api.listProviderModels({
                  providerId: provider.id,
                  source: "cache",
                });
                return cached.models.length > 0
                  ? ([provider.id, cached.models] as const)
                  : null;
              } catch {
                return null;
              }
            }),
          )
        ).filter((entry): entry is readonly [string, ModelInfo[]] => entry !== null),
      );
      const currentWorkspace = project.workspace;
      const persistedPaths = get().openProjectPaths;
      // Only explicitly retained tabs are restored. Historical sessions stay
      // available in Projects, but must not silently reopen a tab that was
      // intentionally closed.
      const openProjectPaths = currentWorkspace?.path
        ? promoteProjectPath(persistedPaths, currentWorkspace.path)
        : persistedPaths;
      const openProjects = openProjectPaths.map((path) => projectWorkspaceFromPath(path));
      const hydratedProjects = currentWorkspace
        ? upsertWorkspace(openProjects, currentWorkspace)
        : openProjects;
      const hydratedSessions = decorateSessions(sessions.sessions, get().sessionMeta);
      set({
        ready: true,
        version,
        healthOk: health.ok,
        settings,
        sessions: hydratedSessions,
        providers: providers.providers,
        providerModels: cachedProviderModels,
        workspace: currentWorkspace,
        activeProjectPath: currentWorkspace?.path,
        openProjectPaths,
        openProjects: hydratedProjects,
        onboarding,
        plugins: plugins.plugins,
        notifications: notifications.notifications,
        unreadNotificationCount: notifications.unreadCount,
        sessionOutcomes: latestSessionOutcomes(notifications.notifications),
      });
      saveSidebarPreferences(preferencesFromState(get()));
      if (currentWorkspace?.path) {
        rememberProject({
          path: currentWorkspace.path,
          name: currentWorkspace.name || currentWorkspace.path,
          branch: currentWorkspace.branch,
        });
      }
      // Codex opens an empty draft home ("What should we build…") rather than
      // restoring a prior transcript as the first paint.
      await get().newSession();
    } catch (e) {
      set({
        ready: true,
        healthOk: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  refreshSessions: async () => {
    const sessions = await api.listSessions();
    set({ sessions: decorateSessions(sessions.sessions, get().sessionMeta) });
  },

  selectSession: async (id, opts) => {
    const intent = opts?.navigationIntent ?? beginNavigationIntent();
    const selection = { id, intent };
    pendingSessionSelection = selection;
    const selectLatest = async () => {
      if (!navigationIntentIsCurrent(intent)) return;
      const detail = await api.getSession(id);
      if (!navigationIntentIsCurrent(intent)) return;
      const sessionProjectPath = detail.session?.projectPath;
      // Serialize project activation with transcript selection. A slower,
      // superseded request must never commit after the latest user choice.
      if (sessionProjectPath) {
        if (
          !sessionMatchesProject(
            { projectPath: get().activeProjectPath },
            sessionProjectPath,
          )
        ) {
          const workspace = await get().activateProject(sessionProjectPath, {
            navigationIntent: intent,
          });
          if (!navigationIntentIsCurrent(intent)) return;
          if (!workspace) throw new Error("Unable to activate project workspace");
        }
      } else if (get().workspace) {
        await get().clearProject({ navigationIntent: intent });
        if (!navigationIntentIsCurrent(intent)) return;
      }
      const record = opts?.record !== false;
      const panelWasOpen = get().workPanelOpen;
      if (!record) {
        set((s) => ({
          ...switchWorkPanelSession(s, id),
          activeSessionId: id,
          messages: detail.session?.messages ?? [],
          page: "chat",
          isRunning: s.runningSessions[id] ?? false,
        }));
        syncPanelWindowForVisibility(
          panelWasOpen,
          get().workPanelOpen,
          get().workPanelWidth,
        );
        void get().acknowledgeSessionOutcome(id);
        return;
      }
      const entry = { page: "chat" as const, sessionId: id };
      set((s) => {
        const stack = s.navStack.slice(0, s.navIndex + 1);
        const last = stack[stack.length - 1];
        const same = last?.page === "chat" && last?.sessionId === id;
        const nextStack = same ? stack : [...stack, entry].slice(-50);
        return {
          ...switchWorkPanelSession(s, id),
          activeSessionId: id,
          messages: detail.session?.messages ?? [],
          page: "chat" as const,
          isRunning: s.runningSessions[id] ?? false,
          navStack: nextStack,
          navIndex: nextStack.length - 1,
        };
      });
      syncPanelWindowForVisibility(
        panelWasOpen,
        get().workPanelOpen,
        get().workPanelWidth,
      );
      void get().acknowledgeSessionOutcome(id);
    };
    const queued = sessionSelectionQueue.then(selectLatest, selectLatest);
    sessionSelectionQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    try {
      await queued;
    } finally {
      if (pendingSessionSelection === selection) pendingSessionSelection = null;
    }
  },

  newSession: async (options) => {
    const intent = beginNavigationIntent();
    const requestedProjectPath =
      options && "projectPath" in options
        ? options.projectPath ?? null
        : get().workspace?.path ?? null;
    if (
      requestedProjectPath &&
      !sessionMatchesProject(
        { projectPath: get().activeProjectPath },
        requestedProjectPath,
      )
    ) {
      const workspace = await get().activateProject(requestedProjectPath, {
        navigationIntent: intent,
      });
      if (!navigationIntentIsCurrent(intent)) return;
      if (!workspace) throw new Error("Unable to activate project workspace");
    }

    // Codex reuses an empty draft thread instead of stacking "New task" rows.
    for (const session of get().sessions) {
      if (
        !isDefaultSessionTitle(session.title) ||
        sessionIsArchived(session.id, get().sessionMeta) ||
        !sessionMatchesProject(session, requestedProjectPath)
      ) {
        continue;
      }
      let messages: UiMessage[];
      try {
        const detail = await api.getSession(session.id);
        if (!navigationIntentIsCurrent(intent)) return;
        messages = detail.session?.messages ?? [];
      } catch {
        if (!navigationIntentIsCurrent(intent)) return;
        // A stale summary must not prevent creating a replacement draft.
        continue;
      }
      if (messages.length === 0) {
        if (requestedProjectPath === null && get().workspace) {
          await get().clearProject({ navigationIntent: intent });
          if (!navigationIntentIsCurrent(intent)) return;
        }
        await get().selectSession(session.id, { navigationIntent: intent });
        return;
      }
    }
    if (requestedProjectPath === null && get().workspace) {
      await get().clearProject({ navigationIntent: intent });
      if (!navigationIntentIsCurrent(intent)) return;
    }
    const settings = get().settings;
    const defaultProvider = get().providers.find(
      (provider) => provider.id === settings?.defaultProviderId,
    );
    // New reasoning sessions start at the strongest level published by pi.
    // Missing capability metadata remains the conservative off fallback.
    const defaultThinkingLevel = defaultProvider?.supportsReasoning
      ? highestSupportedThinkingLevel(defaultProvider.supportedThinkingLevels)
      : "off";
    // No providerId/modelId here: sessions without an explicit pick resolve
    // them at prompt time, so later default-model changes apply everywhere.
    // The Composer pins both onto the session when the user chooses a model.
    const created = await api.createSession({
      title: untitledTaskTitle(),
      mode: settings?.defaultMode ?? "chat",
      thinkingLevel: defaultThinkingLevel,
      projectPath: requestedProjectPath ?? undefined,
    });
    if (!navigationIntentIsCurrent(intent)) return;
    await get().refreshSessions();
    if (!navigationIntentIsCurrent(intent)) return;
    const detail = await api.getSession(created.session.id);
    if (!navigationIntentIsCurrent(intent)) return;
    const panelWasOpen = get().workPanelOpen;
    const entry = { page: "chat" as const, sessionId: created.session.id };
    set((s) => {
      const stack = s.navStack.slice(0, s.navIndex + 1);
      const nextStack = [...stack, entry].slice(-50);
      return {
        ...switchWorkPanelSession(s, created.session.id),
        activeSessionId: created.session.id,
        messages: detail.session?.messages ?? [],
        page: "chat" as const,
        navStack: nextStack,
        navIndex: nextStack.length - 1,
      };
    });
    syncPanelWindowForVisibility(
      panelWasOpen,
      get().workPanelOpen,
      get().workPanelWidth,
    );
  },

  forkSession: async (id) => {
    const intent = beginNavigationIntent();
    const state = get();
    if (!id || state.runningSessions[id]) return;
    const source = state.sessions.find((session) => session.id === id);
    if (!source) throw new Error("Session not found");

    if (source.projectPath) {
      if (
        !sessionMatchesProject(
          { projectPath: state.activeProjectPath },
          source.projectPath,
        )
      ) {
        const workspace = await get().activateProject(source.projectPath, {
          navigationIntent: intent,
        });
        if (!navigationIntentIsCurrent(intent)) return;
        if (!workspace) throw new Error("Unable to activate project workspace");
      }
    } else if (state.workspace) {
      await get().clearProject({ navigationIntent: intent });
      if (!navigationIntentIsCurrent(intent)) return;
    }

    const sourceTitle = source.title.trim() || i18n.t("chat.untitledTask");
    const result = await api.forkSession(
      id,
      i18n.t("nav.branchTitle", { title: sourceTitle }),
    );
    if (!navigationIntentIsCurrent(intent)) return;
    const { messages, ...summary } = result.session;
    const panelWasOpen = get().workPanelOpen;
    set((current) => {
      const sessions = decorateSessions(
        [
          summary,
          ...current.sessions.filter((session) => session.id !== summary.id),
        ],
        current.sessionMeta,
      );
      const stack = current.navStack.slice(0, current.navIndex + 1);
      const entry = { page: "chat" as const, sessionId: summary.id };
      const nextStack = [...stack, entry].slice(-50);
      return {
        ...switchWorkPanelSession(current, summary.id),
        sessions,
        activeSessionId: summary.id,
        messages,
        page: "chat" as const,
        isRunning: false,
        navStack: nextStack,
        navIndex: nextStack.length - 1,
      };
    });
    syncPanelWindowForVisibility(
      panelWasOpen,
      get().workPanelOpen,
      get().workPanelWidth,
    );
  },

  forkAssistantMessage: async (messageId) => {
    const intent = beginNavigationIntent();
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId || state.runningSessions[sessionId]) return;
    const message = state.messages.find((candidate) => candidate.id === messageId);
    const source = state.sessions.find((session) => session.id === sessionId);
    if (!message || message.role !== "assistant" || !source) return;

    try {
      const sourceTitle = source.title.trim() || i18n.t("chat.untitledTask");
      const result = await api.forkSession(
        sessionId,
        i18n.t("nav.branchTitle", { title: sourceTitle }),
        messageId,
      );
      if (!navigationIntentIsCurrent(intent)) return;
      const { messages, ...summary } = result.session;
      const panelWasOpen = get().workPanelOpen;
      set((current) => {
        const sessions = decorateSessions(
          [summary, ...current.sessions.filter((session) => session.id !== summary.id)],
          current.sessionMeta,
        );
        const stack = current.navStack.slice(0, current.navIndex + 1);
        const entry = { page: "chat" as const, sessionId: summary.id };
        const nextStack = [...stack, entry].slice(-50);
        return {
          ...switchWorkPanelSession(current, summary.id),
          sessions,
          activeSessionId: summary.id,
          messages,
          page: "chat" as const,
          isRunning: false,
          navStack: nextStack,
          navIndex: nextStack.length - 1,
          error: null,
          errorCode: null,
        };
      });
      syncPanelWindowForVisibility(
        panelWasOpen,
        get().workPanelOpen,
        get().workPanelWidth,
      );
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as { code?: string })?.code ?? null,
      });
    }
  },

  configureActiveSession: async (config) => {
    const sessionId = get().activeSessionId;
    if (!sessionId || get().runningSessions[sessionId]) return;
    const result = await api.configureSession(sessionId, config);
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...result.session,
              pinned: sessionIsPinned(sessionId, state.sessionMeta),
              archived: sessionIsArchived(sessionId, state.sessionMeta),
            }
          : session,
      ),
    }));
  },

  sendPrompt: async (content) => {
    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().newSession();
      sessionId = get().activeSessionId;
    }
    if (!sessionId) throw new Error("No active session");
    const startedIn = sessionId;
    set((s) => ({
      isRunning: true,
      error: null,
      errorCode: null,
      errorRetriable: null,
      runningSessions: { ...s.runningSessions, [startedIn]: true },
      sessionOutcomes: withoutRecordKey(s.sessionOutcomes, startedIn),
    }));
    try {
      const current = get().sessions.find((s) => s.id === sessionId);
      if (isDefaultSessionTitle(current?.title)) {
        const nextTitle =
          content.trim().replace(/\s+/g, " ").slice(0, 48) || untitledTaskTitle();
        try {
          await api.renameSession(sessionId, nextTitle);
          await get().refreshSessions();
        } catch {
          // non-fatal
        }
      }
      await api.prompt({ sessionId, content });
    } catch (e) {
      const messageError = messageErrorFromUnknown(e);
      set((s) => ({
        // The user may have switched sessions while the request was in
        // flight; only reset the spinner if the failed session is visible.
        isRunning: s.activeSessionId === startedIn ? false : s.isRunning,
        runningSessions: { ...s.runningSessions, [startedIn]: false },
        sessionOutcomes: { ...s.sessionOutcomes, [startedIn]: "failed" },
        ...(s.activeSessionId === startedIn
          ? { messages: [...s.messages, assistantErrorMessage(messageError)] }
          : {}),
      }));
    }
  },

  retryAssistantMessage: async (messageId) => {
    const state = get();
    if (state.isRunning) return;
    const index = state.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = state.messages[index];
    if (target.role !== "assistant") return;

    // Branch from the nearest preceding user prompt, resending it verbatim.
    // Slash prompts resend their expanded body so the model sees exactly what
    // it saw before (D123).
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = state.messages[i];
      if (candidate.role === "user" && candidate.content.trim()) {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;
    const root = state.messages[userIndex];
    await get().editUserMessage(root.id, root.content);
  },

  editUserMessage: async (messageId, content) => {
    // Editing a prompt is a regenerate with different text: keep history up to
    // that prompt (exclusive), then send the new text so the durable
    // transcript and live agent both drop the discarded assistant/tool tail.
    // Main archives the replaced branch as a revision, so the pager can walk
    // back to the original prompt and its answer.
    const state = get();
    if (state.isRunning) return false;
    const sessionId = state.activeSessionId;
    if (!sessionId) return false;
    const prompt = content.trim();
    if (!prompt) return false;
    const userIndex = state.messages.findIndex(
      (message) => message.id === messageId,
    );
    if (userIndex < 0 || state.messages[userIndex].role !== "user") return false;
    const kept = state.messages.slice(0, userIndex);

    set((s) => ({
      messages: kept,
      isRunning: true,
      error: null,
      errorCode: null,
      errorRetriable: null,
      runningSessions: { ...s.runningSessions, [sessionId]: true },
      sessionOutcomes: withoutRecordKey(s.sessionOutcomes, sessionId),
    }));

    try {
      await api.prompt({
        sessionId,
        content: prompt,
        truncateBefore: userIndex,
      });
      return true;
    } catch (e) {
      // Reload durable state if the branch failed mid-flight.
      try {
        const detail = await api.getSession(sessionId);
        set((s) => ({
          messages:
            s.activeSessionId === sessionId
              ? detail.session?.messages ?? kept
              : s.messages,
          isRunning: s.activeSessionId === sessionId ? false : s.isRunning,
          runningSessions: { ...s.runningSessions, [sessionId]: false },
          sessionOutcomes: { ...s.sessionOutcomes, [sessionId]: "failed" },
          error: e instanceof Error ? e.message : String(e),
          errorCode: (e as { code?: string })?.code ?? null,
        }));
      } catch {
        set((s) => ({
          isRunning: s.activeSessionId === sessionId ? false : s.isRunning,
          runningSessions: { ...s.runningSessions, [sessionId]: false },
          sessionOutcomes: { ...s.sessionOutcomes, [sessionId]: "failed" },
          error: e instanceof Error ? e.message : String(e),
          errorCode: (e as { code?: string })?.code ?? null,
        }));
      }
      return false;
    }
  },

  retryLastPrompt: async () => {
    // Re-send the newest user prompt after a failed turn (error banner
    // "Retry"). Same branch semantics as retryAssistantMessage, anchored on
    // the last user message so it also works when the turn died before any
    // assistant output.
    const state = get();
    if (state.isRunning) return;
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    let userIndex = -1;
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const candidate = state.messages[i];
      if (candidate.role === "user" && candidate.content.trim()) {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;
    const prompt = state.messages[userIndex].content;
    const kept = state.messages.slice(0, userIndex);
    set((s) => ({
      messages: kept,
      isRunning: true,
      error: null,
      errorCode: null,
      errorRetriable: null,
      runningSessions: { ...s.runningSessions, [sessionId]: true },
      sessionOutcomes: withoutRecordKey(s.sessionOutcomes, sessionId),
    }));
    try {
      await api.prompt({
        sessionId,
        content: prompt,
        truncateBefore: userIndex,
      });
    } catch (e) {
      set((s) => ({
        isRunning: s.activeSessionId === sessionId ? false : s.isRunning,
        runningSessions: { ...s.runningSessions, [sessionId]: false },
        sessionOutcomes: { ...s.sessionOutcomes, [sessionId]: "failed" },
        error: e instanceof Error ? e.message : String(e),
        errorCode: (e as { code?: string })?.code ?? null,
        errorRetriable: false,
      }));
    }
  },

  clearError: () => set({ error: null, errorCode: null, errorRetriable: null }),

  activateMessageRevision: async (rootUserId, revisionIndex) => {
    const state = get();
    if (state.isRunning) return;
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    const rootIndex = state.messages.findIndex((message) => message.id === rootUserId);
    if (rootIndex < 0) return;
    const root = state.messages[rootIndex];
    // Live regenerate prompts get new ids; the durable family key stays on
    // revisionRootId so all variants remain one linear set.
    const revisionFamilyId = root.revisionRootId || root.id;
    const prefix = state.messages.slice(0, rootIndex);
    try {
      const result = await api.activateSessionRevision({
        sessionId,
        rootUserId: revisionFamilyId,
        revisionIndex,
        prefix,
      });
      set((s) => ({
        messages:
          s.activeSessionId === sessionId ? result.messages ?? prefix : s.messages,
        error: null,
        errorCode: null,
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
        errorCode: (e as { code?: string })?.code ?? null,
      });
    }
  },

  deleteMessage: async (messageId) => {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId || state.isRunning) return;
    const index = state.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = state.messages[index];
    // A prompt owns its exchange: deleting a user turn also drops the tool
    // and assistant tail up to the next user turn, so no orphaned replies
    // remain (retry resolves answers via the nearest preceding prompt).
    let end = index + 1;
    if (target.role === "user") {
      while (end < state.messages.length && state.messages[end].role !== "user") {
        end += 1;
      }
    }
    const previous = state.messages;
    const next = [...previous.slice(0, index), ...previous.slice(end)];
    set({ messages: next, error: null, errorCode: null });
    try {
      await api.replaceSessionMessages(sessionId, next);
    } catch (e) {
      set((s) => ({
        messages: s.activeSessionId === sessionId ? previous : s.messages,
        error: e instanceof Error ? e.message : String(e),
        errorCode: (e as { code?: string })?.code ?? null,
      }));
    }
  },

  abort: async () => {
    const stateBeforeAbort = get();
    const sessionId = stateBeforeAbort.activeSessionId;
    if (!sessionId) return;
    const pendingPermission = stateBeforeAbort.pendingPermissions[sessionId];
    await Promise.allSettled([
      api.abort(sessionId),
      ...(pendingPermission
        ? [
            api.resolvePermission({
              requestId: pendingPermission.requestId,
              decision: "deny",
            }),
          ]
        : []),
    ]);
    set((state) => ({
      pendingPermissions: clearPendingPermission(
        state.pendingPermissions,
        sessionId,
        pendingPermission?.requestId,
      ),
    }));
    const state = get();
    if (state.activeSessionId !== sessionId) {
      set((s) => ({
        runningSessions: { ...s.runningSessions, [sessionId]: false },
      }));
      return;
    }
    const messages = state.messages;
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }
    const tail = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : [];
    const replyStarted = tail.some(
      (message) =>
        message.role === "tool" ||
        (message.role === "assistant" &&
          Boolean(
            (message.content || "").trim() ||
              (typeof message.thinking === "string" && message.thinking.trim()),
          )),
    );
    if (lastUserIndex >= 0 && !replyStarted) {
      // Nothing came back yet — undo the send: pull the prompt into the
      // composer and drop the turn from the transcript.
      const prompt = messages[lastUserIndex].content;
      const kept = messages.slice(0, lastUserIndex);
      set((s) => ({
        messages: kept,
        composerPrefill: prompt,
        isRunning: false,
        runningSessions: { ...s.runningSessions, [sessionId]: false },
      }));
      try {
        await api.replaceSessionMessages(sessionId, kept);
      } catch {
        // Best effort — the local transcript already reflects the undo.
      }
      return;
    }
    // A partial reply exists: settle it in place. Streaming assistant text
    // becomes an aborted-but-kept answer; still-running tools close out.
    const settled = messages.map((message) => {
      if (message.role === "assistant" && message.status === "streaming") {
        return { ...message, status: "aborted" as const };
      }
      if (message.role === "tool" && message.toolStatus === "running") {
        return {
          ...message,
          toolStatus: "error" as const,
          status: "aborted" as const,
          toolCompletedAt: message.toolCompletedAt ?? new Date().toISOString(),
        };
      }
      return message;
    });
    set((s) => ({
      messages: settled,
      isRunning: false,
      runningSessions: { ...s.runningSessions, [sessionId]: false },
    }));
    try {
      await api.replaceSessionMessages(sessionId, settled);
    } catch {
      // Best effort — the host may persist its own copy of the turn.
    }
  },

  activateProject: async (path, opts) => {
    const intent = opts?.navigationIntent ?? beginNavigationIntent();
    const preserveConversation = pendingSessionSelection?.intent === intent;
    const requestedPath = path.trim();
    if (!requestedPath) return null;
    const result = await api.setProject(requestedPath);
    if (!navigationIntentIsCurrent(intent)) return null;
    const workspace = result.workspace;
    if (!workspace?.path) return null;
    if (
      normalizeProjectPath(get().activeProjectPath) !==
        normalizeProjectPath(workspace.path) &&
      !preserveConversation
    ) {
      get().resetWorkPanelContext();
    }

    set((state) => {
      const switchesVisibleProject =
        normalizeProjectPath(state.activeProjectPath) !==
        normalizeProjectPath(workspace.path);
      const openProjectPaths = promoteProjectPath(
        state.openProjectPaths,
        workspace.path,
      );
      const openProjects = upsertWorkspace(state.openProjects, workspace);
      return {
        workspace,
        activeProjectPath: workspace.path,
        openProjectPaths,
        openProjects,
        page: "chat" as const,
        ...(switchesVisibleProject && !preserveConversation
          ? {
              activeSessionId: undefined,
              messages: [],
              isRunning: false,
            }
          : {}),
      };
    });
    rememberProject({
      path: workspace.path,
      name: workspace.name || workspace.path,
      branch: workspace.branch,
    });
    persistCurrentSidebar(get);
    return workspace;
  },

  openProjectPath: async (path) => get().activateProject(path),
  switchProjectPath: async (path) => get().activateProject(path),

  closeProjectPath: async (path) => {
    const intent = beginNavigationIntent();
    const key = normalizeProjectPath(path);
    if (!key) return;
    const state = get();
    const isActive = normalizeProjectPath(state.activeProjectPath) === key;
    const nextPaths = removeProjectPath(state.openProjectPaths, path);
    if (isActive) {
      const fallbackPath = nextPaths[nextPaths.length - 1];
      try {
        if (fallbackPath) {
          await get().activateProject(fallbackPath, { navigationIntent: intent });
        } else {
          await get().clearProject({ navigationIntent: intent });
        }
        if (!navigationIntentIsCurrent(intent)) return;
      } catch (error) {
        // Keep the current workspace/tab intact when the fallback fails.
        throw error;
      }
    }
    set((current) => ({
      openProjectPaths: removeProjectPath(current.openProjectPaths, path),
      openProjects: current.openProjects.filter(
        (project) => normalizeProjectPath(project.path) !== key,
      ),
    }));
    persistCurrentSidebar(get);
  },
  closeProject: async (path) => get().closeProjectPath(path),

  openProject: async () => {
    const intent = beginNavigationIntent();
    const result = await api.openProject();
    if (!navigationIntentIsCurrent(intent)) return;
    if (!result.canceled && result.workspace) {
      const workspace = result.workspace;
      if (
        normalizeProjectPath(get().activeProjectPath) !==
        normalizeProjectPath(workspace.path)
      ) {
        get().resetWorkPanelContext();
      }
      set((state) => {
        const switchesVisibleProject =
          normalizeProjectPath(state.activeProjectPath) !==
          normalizeProjectPath(workspace.path);
        const openProjectPaths = promoteProjectPath(
          state.openProjectPaths,
          workspace.path,
        );
        return {
          workspace,
          activeProjectPath: workspace.path,
          openProjectPaths,
          openProjects: upsertWorkspace(state.openProjects, workspace),
          page: "chat" as const,
          ...(switchesVisibleProject
            ? {
                activeSessionId: undefined,
                messages: [],
                isRunning: false,
              }
            : {}),
        };
      });
      if (workspace.path) {
        rememberProject({
          path: workspace.path,
          name: workspace.name || workspace.path,
          branch: workspace.branch,
        });
      }
      persistCurrentSidebar(get);
      const onboarding = await api.getOnboarding();
      if (!navigationIntentIsCurrent(intent)) return;
      set({ onboarding, page: "chat" });
    }
  },

  clearProject: async (opts) => {
    const intent = opts?.navigationIntent ?? beginNavigationIntent();
    const preserveConversation = pendingSessionSelection?.intent === intent;
    await api.clearProject();
    if (!navigationIntentIsCurrent(intent)) return;
    if (!preserveConversation) get().resetWorkPanelContext();
    set({
      workspace: null,
      activeProjectPath: undefined,
      ...(preserveConversation
        ? {}
        : {
            activeSessionId: undefined,
            messages: [],
            isRunning: false,
          }),
    });
    persistCurrentSidebar(get);
    const onboarding = await api.getOnboarding();
    if (!navigationIntentIsCurrent(intent)) return;
    set({ onboarding });
  },

  toggleSessionPinned: (id) => {
    if (!id) return;
    set((state) => {
      const pinned = !sessionIsPinned(id, state.sessionMeta);
      const sessionMeta = {
        ...state.sessionMeta,
        [id]: { ...(state.sessionMeta[id] || {}), pinned },
      };
      const sessions = state.sessions.map((session) =>
        session.id === id ? { ...session, pinned } : session,
      );
      return { sessionMeta, sessions };
    });
    persistCurrentSidebar(get);
  },

  toggleSessionArchived: (id) => {
    if (!id) return;
    set((state) => {
      const archived = !sessionIsArchived(id, state.sessionMeta);
      const sessionMeta = {
        ...state.sessionMeta,
        [id]: { ...(state.sessionMeta[id] || {}), archived },
      };
      const sessions = state.sessions.map((session) =>
        session.id === id ? { ...session, archived } : session,
      );
      return { sessionMeta, sessions };
    });
    persistCurrentSidebar(get);
  },

  archiveSession: (id) => {
    if (!id) return;
    set((state) => ({
      sessionMeta: {
        ...state.sessionMeta,
        [id]: { ...(state.sessionMeta[id] || {}), archived: true },
      },
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, archived: true } : session,
      ),
    }));
    persistCurrentSidebar(get);
  },

  restoreSession: (id) => {
    if (!id) return;
    set((state) => ({
      sessionMeta: {
        ...state.sessionMeta,
        [id]: { ...(state.sessionMeta[id] || {}), archived: false },
      },
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, archived: false } : session,
      ),
    }));
    persistCurrentSidebar(get);
  },

  deleteSession: async (id) => {
    if (!id) return;
    await api.deleteSession(id);
    if (get().activeSessionId === id) get().resetWorkPanelContext();
    set((state) => {
      const sessionMeta = { ...state.sessionMeta };
      delete sessionMeta[id];
      const sessions = state.sessions.filter((session) => session.id !== id);
      const runningSessions = { ...state.runningSessions };
      delete runningSessions[id];
      const sessionOutcomes = { ...state.sessionOutcomes };
      delete sessionOutcomes[id];
      const workPanelContexts = withoutRecordKey(state.workPanelContexts, id);
      const pendingPermissions = clearPendingPermission(
        state.pendingPermissions,
        id,
      );
      const workspaceReviewSessions = withoutRecordKey(
        state.workspaceReviewSessions,
        id,
      );
      const retainedNav = state.navStack.filter(
        (entry) => entry.sessionId !== id,
      );
      const navStack =
        retainedNav.length > 0 ? retainedNav : [{ page: "chat" as const }];
      return {
        sessionMeta,
        sessions,
        runningSessions,
        sessionOutcomes,
        workPanelContexts,
        activeSessionId:
          state.activeSessionId === id ? undefined : state.activeSessionId,
        messages: state.activeSessionId === id ? [] : state.messages,
        isRunning: state.activeSessionId === id ? false : state.isRunning,
        pendingPermissions,
        workspaceReviewSessions,
        navStack,
        navIndex: Math.min(state.navIndex, navStack.length - 1),
      };
    });
    persistCurrentSidebar(get);
    await get().refreshSessions();
  },

  setSessionSort: (sort) => {
    set((state) => ({
      sessionView: { ...state.sessionView, sort, sortBy: sort },
    }));
    persistCurrentSidebar(get);
  },

  setSessionArchiveVisibility: (show) => {
    set((state) => ({
      sessionView: { ...state.sessionView, archived: show, showArchived: show },
    }));
    persistCurrentSidebar(get);
  },

  setSessionView: (view) => {
    if (typeof view === "boolean") {
      get().setSessionArchiveVisibility(view);
      return;
    }
    if (view.sort || view.sortBy) {
      get().setSessionSort(view.sort ?? view.sortBy ?? get().sessionView.sort);
    }
    if (view.archived !== undefined || view.showArchived !== undefined) {
      get().setSessionArchiveVisibility(view.archived ?? view.showArchived ?? false);
    }
  },

  setShowArchived: (show) => {
    get().setSessionArchiveVisibility(show);
  },

  archiveProject: (path) => {
    const key = normalizeProjectPath(path);
    if (!key) return;
    set((state) => ({
      projectMeta: {
        ...state.projectMeta,
        [key]: { ...(state.projectMeta[key] || {}), archived: true },
      },
    }));
    persistCurrentSidebar(get);
  },

  toggleProjectPinned: (path, requestedPinned) => {
    const key = normalizeProjectPath(path);
    if (!key) return;
    set((state) => {
      const pinned = requestedPinned ?? !projectIsPinned(key, state.projectMeta);
      return {
        projectMeta: {
          ...state.projectMeta,
          [key]: { ...(state.projectMeta[key] || {}), pinned },
        },
      };
    });
    // Keep the projects page's legacy recents index in sync as well.
    try {
      setProjectPinned(path, projectIsPinned(key, get().projectMeta));
    } catch {
      // The durable recent-project index is optional in restricted contexts.
    }
    persistCurrentSidebar(get);
  },

  toggleProjectArchived: (path) => {
    const key = normalizeProjectPath(path);
    if (!key) return;
    set((state) => {
      const archived = !projectIsArchived(key, state.projectMeta);
      return {
        projectMeta: {
          ...state.projectMeta,
          [key]: { ...(state.projectMeta[key] || {}), archived },
        },
      };
    });
    persistCurrentSidebar(get);
  },

  restoreProject: (path) => {
    const key = normalizeProjectPath(path);
    if (!key) return;
    set((state) => ({
      projectMeta: {
        ...state.projectMeta,
        [key]: { ...(state.projectMeta[key] || {}), archived: false },
      },
    }));
    persistCurrentSidebar(get);
  },

  setProjectCollapsed: (path, collapsed) => {
    const key = normalizeProjectPath(path);
    if (!key) return;
    set((state) => {
      const next = collapsed ?? !projectIsCollapsed(key, state.projectMeta);
      return {
        projectCollapsed: { ...state.projectCollapsed, [key]: next },
        projectMeta: {
          ...state.projectMeta,
          [key]: { ...(state.projectMeta[key] || {}), collapsed: next },
        },
      };
    });
    persistCurrentSidebar(get);
  },

  toggleProjectCollapsed: (path) => get().setProjectCollapsed(path),

  setProjectSort: (sort) => {
    set({ projectSort: sort });
    persistCurrentSidebar(get);
  },

  getVisibleSessions: (options) => {
    const state = get();
    const includeArchived = options?.includeArchived ?? state.sessionView.archived;
    const scoped = options && "projectPath" in options
      ? state.sessions.filter((session) =>
          sessionMatchesProject(session, options.projectPath),
        )
      : state.sessions;
    return sortSessions(scoped, state.sessionMeta, state.sessionView.sort, includeArchived);
  },

  getSortedProjects: () => {
    const state = get();
    const projects = state.openProjects.filter(
      (project) => !projectIsArchived(project.path, state.projectMeta),
    );
    return sortProjects(projects, state.projectMeta, state.projectSort);
  },

  refreshProviders: async () => {
    const [providers, sessions, settings, onboarding] = await Promise.all([
      api.listProviders(),
      api.listSessions(),
      api.getSettings(),
      api.getOnboarding(),
    ]);
    providerModelsGeneration += 1;
    refreshedProviderModels.clear();
    set((state) => ({
      providers: providers.providers,
      // Provider edits may change discovery settings. The next load hydrates
      // from SQLite first, then refreshes without presenting an empty menu.
      providerModels: {},
      sessions: decorateSessions(sessions.sessions, state.sessionMeta),
      settings,
      onboarding,
    }));
  },

  loadProviderModels: async (providerId) => {
    if (refreshedProviderModels.has(providerId)) return;
    const generation = providerModelsGeneration;
    const existing = providerModelLoads.get(providerId);
    if (existing) {
      await existing;
      if (providerModelLoads.get(providerId) === existing) {
        providerModelLoads.delete(providerId);
      }
      if (!refreshedProviderModels.has(providerId)) {
        await get().loadProviderModels(providerId);
      }
      return;
    }

    const load = (async () => {
      let hydrated = (get().providerModels[providerId]?.length ?? 0) > 0;
      if (!hydrated) {
        try {
          const cached = await api.listProviderModels({ providerId, source: "cache" });
          if (generation !== providerModelsGeneration) return;
          hydrated = cached.models.length > 0;
          set((state) => ({
            providerModels: {
              ...state.providerModels,
              [providerId]: cached.models,
            },
          }));
        } catch {
          // Continue to live discovery when the local cache is unavailable.
        }
      }

      try {
        const refreshed = await api.listProviderModels({
          providerId,
          source: "refresh",
        });
        if (generation !== providerModelsGeneration) return;
        if (refreshed.source === "remote" && refreshed.models.length > 0) {
          set((state) => ({
            providerModels: {
              ...state.providerModels,
              [providerId]: refreshed.models,
            },
          }));
        } else if (!hydrated && refreshed.models.length > 0) {
          set((state) => ({
            providerModels: {
              ...state.providerModels,
              [providerId]: refreshed.models,
            },
          }));
        }
      } catch {
        // Keep the cached catalog; the menu already has a usable fallback.
      } finally {
        if (generation === providerModelsGeneration) {
          refreshedProviderModels.add(providerId);
        }
      }
    })();
    providerModelLoads.set(providerId, load);
    try {
      await load;
    } finally {
      if (providerModelLoads.get(providerId) === load) {
        providerModelLoads.delete(providerId);
      }
    }
  },

  refreshPlugins: async () => {
    const plugins = await api.listPlugins();
    set({ plugins: plugins.plugins });
  },

  refreshNotifications: async () => {
    const result = await api.listNotifications({ limit: 200 });
    set((state) => ({
      notifications: result.notifications,
      unreadNotificationCount: result.unreadCount,
      sessionOutcomes: {
        ...state.sessionOutcomes,
        ...latestSessionOutcomes(result.notifications),
      },
    }));
  },

  receiveNotification: (notification) => {
    set((state) => {
      const withoutCurrent = state.notifications.filter(
        (item) => item.id !== notification.id,
      );
      const notifications = [notification, ...withoutCurrent].slice(0, 200);
      return {
        notifications,
        sessionOutcomes: {
          ...state.sessionOutcomes,
          [notification.sessionId]:
            notification.kind === "task.failed" ? "failed" : "completed",
        },
        unreadNotificationCount: notifications.reduce(
          (count, item) => count + (item.readAt ? 0 : 1),
          0,
        ),
      };
    });
  },

  markNotificationRead: async (id) => {
    const item = get().notifications.find((notification) => notification.id === id);
    if (!item || item.readAt) return;
    await api.markNotificationRead(id);
    const readAt = new Date().toISOString();
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id ? { ...notification, readAt } : notification,
      ),
      unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1),
    }));
  },

  markAllNotificationsRead: async () => {
    if (get().unreadNotificationCount === 0) return;
    await api.markAllNotificationsRead();
    const readAt = new Date().toISOString();
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt },
      ),
      unreadNotificationCount: 0,
    }));
  },

  clearNotifications: async () => {
    await api.clearNotifications();
    set({ notifications: [], unreadNotificationCount: 0 });
  },

  openNotification: async (id) => {
    const intent = beginNavigationIntent();
    const notification = get().notifications.find((item) => item.id === id);
    if (!notification) return;
    await get().markNotificationRead(id);
    if (!navigationIntentIsCurrent(intent)) return;
    await get().selectSession(notification.sessionId, {
      navigationIntent: intent,
    });
  },

  acknowledgeSessionOutcome: async (sessionId) => {
    // The sidebar check / cross flags an unseen result, so opening the
    // conversation clears it. Reading the backing notifications keeps it
    // cleared across a notification refresh or an app restart.
    set((s) =>
      s.sessionOutcomes[sessionId]
        ? { sessionOutcomes: withoutRecordKey(s.sessionOutcomes, sessionId) }
        : {},
    );
    const unread = get().notifications.filter(
      (item) => item.sessionId === sessionId && !item.readAt,
    );
    for (const item of unread) {
      await get().markNotificationRead(item.id);
    }
  },

  handleAgentEvent: (envelope) => {
    const event = envelope.event;
    // Per-session run state: agents run independently per session, so track
    // running/finished for every envelope, visible session or not.
    if (event.type === "agent_start" || event.type === "turn_start") {
      set((s) => ({
        runningSessions: { ...s.runningSessions, [envelope.sessionId]: true },
        sessionOutcomes: withoutRecordKey(s.sessionOutcomes, envelope.sessionId),
      }));
    } else if (
      event.type === "agent_end" ||
      event.type === "turn_end" ||
      event.type === "error"
    ) {
      set((s) => ({
        runningSessions: { ...s.runningSessions, [envelope.sessionId]: false },
        pendingPermissions: clearPendingPermission(
          s.pendingPermissions,
          envelope.sessionId,
        ),
        sessionOutcomes:
          event.type === "error" && event.error.code === "TURN_ABORTED"
            ? withoutRecordKey(s.sessionOutcomes, envelope.sessionId)
            : {
                ...s.sessionOutcomes,
                [envelope.sessionId]:
                  event.type === "error" ||
                  s.sessionOutcomes[envelope.sessionId] === "failed"
                    ? "failed"
                    : "completed",
              },
      }));
    }
    // Any session's workspace mutation invalidates the review diff; this
    // must precede the cross-session early-return below.
    if (event.type === "tool_start") {
      if (toolNamesByCallId.size >= TOOL_NAME_CACHE_LIMIT) {
        const oldest = toolNamesByCallId.keys().next().value;
        if (oldest !== undefined) toolNamesByCallId.delete(oldest);
      }
      toolNamesByCallId.set(event.toolCallId, event.toolName);
    } else if (event.type === "tool_end") {
      const toolName = toolNamesByCallId.get(event.toolCallId);
      toolNamesByCallId.delete(event.toolCallId);
      set((state) => {
        const pending = state.pendingPermissions[envelope.sessionId];
        return pending?.toolCallId === event.toolCallId
          ? {
              pendingPermissions: clearPendingPermission(
                state.pendingPermissions,
                envelope.sessionId,
                pending.requestId,
              ),
            }
          : {};
      });
      if (toolName && WORKSPACE_MUTATING_TOOLS.has(toolName) && !event.isError) {
        set((s) => ({ reviewRev: s.reviewRev + 1 }));
      }
      const reviewArtifact = shouldOpenReviewArtifact({
        toolName,
        isError: event.isError,
        result: event.result,
      });
      if (reviewArtifact) {
        const state = get();
        const workspacePath =
          state.sessions.find((session) => session.id === envelope.sessionId)
            ?.projectPath ??
          (state.activeSessionId === envelope.sessionId
            ? state.workspace?.path
            : undefined);
        if (workspacePath) {
          set((current) => ({
            workspaceReviewSessions: {
              ...current.workspaceReviewSessions,
              [envelope.sessionId]: workspacePath,
            },
          }));
        }
        get().openWorkPanelTabForSession(
          envelope.sessionId,
          toolWorkPanelTab("review"),
        );
      }
    }
    if (envelope.sessionId !== get().activeSessionId) {
      // Cross-session events update only their scoped state. They never
      // replace the visible transcript, page, project, or focus.
      if (event.type === "tool_permission_request") {
        set((state) => ({
          pendingPermissions: setPendingPermission(state.pendingPermissions, {
            ...event.request,
            receivedAt: envelope.ts,
          }),
        }));
      } else if (event.type === "agent_end" || event.type === "turn_end") {
        void get().refreshSessions();
      }
      return;
    }
    switch (event.type) {
      case "agent_start":
      case "turn_start":
        set({ isRunning: true });
        break;
      case "agent_end":
      case "turn_end":
        set({ isRunning: false });
        void get().refreshSessions();
        break;
      case "message_start":
        set((s) => {
          const exists = s.messages.some((m) => m.id === event.message.id);
          return exists
            ? s
            : { messages: [...s.messages, event.message] };
        });
        break;
      case "message_update":
        // Append when missing: switching back to a mid-stream session reloads
        // the persisted transcript, which doesn't yet contain the message
        // that is still streaming.
        set((s) => {
          const exists = s.messages.some((m) => m.id === event.message.id);
          return {
            messages: exists
              ? s.messages.map((m) =>
                  m.id === event.message.id ? event.message : m,
                )
              : [...s.messages, event.message],
          };
        });
        break;
      case "message_end":
        set((s) => {
          // Remove only legacy failures without structured detail and empty
          // aborts. Provider failures with AppError metadata are real
          // assistant transcript messages.
          if (
            event.message.role === "assistant" &&
            (event.message.status === "error" ||
              event.message.status === "aborted") &&
            !event.message.content.trim() &&
            !(event.message.thinking || "").trim() &&
            !event.message.error
          ) {
            return {
              messages: s.messages.filter((m) => m.id !== event.message.id),
            };
          }
          const exists = s.messages.some((m) => m.id === event.message.id);
          return {
            messages: exists
              ? s.messages.map((m) =>
                  m.id === event.message.id ? event.message : m,
                )
              : [...s.messages, event.message],
          };
        });
        break;
      case "tool_start":
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: event.toolCallId,
              role: "tool",
              content: "",
              createdAt: new Date().toISOString(),
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              toolArgs: event.args,
              toolStatus: "running",
              status: "streaming",
            },
          ],
        }));
        break;
      case "tool_update":
        if (event.partialResult === undefined) break;
        set((s) => ({
          messages: s.messages.map((message) =>
            message.toolCallId === event.toolCallId &&
            message.toolStatus === "running"
              ? {
                  ...message,
                  content:
                    typeof event.partialResult === "string"
                      ? event.partialResult
                      : formatToolValue(event.partialResult),
                  toolResult: event.partialResult,
                }
              : message,
          ),
        }));
        break;
      case "tool_end":
        set((s) => ({
          messages: s.messages.map((m) =>
            m.toolCallId === event.toolCallId
              ? {
                  ...m,
                  toolCompletedAt: new Date(envelope.ts).toISOString(),
                  toolDurationMs: Math.max(
                    0,
                    envelope.ts - (Date.parse(m.createdAt) || envelope.ts),
                  ),
                  toolStatus: event.isError ? "error" : "success",
                  toolResult: event.result,
                  content:
                    typeof event.result === "string"
                      ? event.result
                      : JSON.stringify(event.result, null, 2),
                  status: "complete",
                  isError: event.isError,
                }
              : m,
          ),
        }));
        break;
      case "tool_permission_request":
        set((state) => ({
          pendingPermissions: setPendingPermission(state.pendingPermissions, {
            ...event.request,
            receivedAt: envelope.ts,
          }),
        }));
        break;
      case "error": {
        // A user-initiated stop is not an error; just settle the run state.
        const aborted = event.error.code === "TURN_ABORTED";
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          const hasErrorMessage =
            last?.role === "assistant" &&
            (last.status === "error" || last.isError === true);
          const messages: UiMessage[] = s.messages
            // A turn that died before producing text leaves an empty
            // aborted bubble. Provider failures stay as assistant messages.
            .filter(
              (message) =>
                !(
                  message.role === "assistant" &&
                  message.status === "aborted" &&
                  !message.content.trim() &&
                  !(message.thinking || "").trim()
                ),
            )
            .map((message) =>
              message.role === "tool" && message.toolStatus === "running"
                ? {
                    ...message,
                    toolStatus: "error" as const,
                    status: "error" as const,
                    isError: true,
                  }
                : message.role === "assistant" &&
                    message.status === "streaming"
                  ? {
                      ...message,
                      status: aborted ? ("aborted" as const) : ("error" as const),
                    }
                  : message,
            );
          return {
            isRunning: false,
            error: null,
            errorCode: null,
            errorRetriable: null,
            messages:
              aborted || hasErrorMessage
                ? messages
                : [...messages, assistantErrorMessage(event.error)],
          };
        });
        break;
      }
      default:
        break;
    }
  },

  setPage: (page, opts) => {
    beginNavigationIntent();
    const record = opts?.record !== false;
    set((s) => {
      if (!record) return { page };
      const entry = {
        page,
        sessionId: page === "chat" ? s.activeSessionId : undefined,
      };
      const stack = s.navStack.slice(0, s.navIndex + 1);
      const last = stack[stack.length - 1];
      const same =
        last?.page === entry.page && last?.sessionId === entry.sessionId;
      const nextStack = same ? stack : [...stack, entry].slice(-50);
      return {
        page,
        navStack: nextStack,
        navIndex: nextStack.length - 1,
      };
    });
  },
  setSettingsTab: (settingsTab) => {
    get().setPage("settings");
    set({ settingsTab });
  },
  setSettingsAnchor: (settingsAnchor) => set({ settingsAnchor }),
  canNavBack: () => get().navIndex > 0,
  canNavForward: () => get().navIndex < get().navStack.length - 1,
  navBack: () => {
    const intent = beginNavigationIntent();
    const s = get();
    if (s.navIndex <= 0) return;
    const idx = s.navIndex - 1;
    const entry = s.navStack[idx];
    set({ navIndex: idx, page: entry.page });
    if (entry.page === "chat" && entry.sessionId) {
      void get().selectSession(entry.sessionId, {
        record: false,
        navigationIntent: intent,
      });
      set({ navIndex: idx });
    }
  },
  navForward: () => {
    const intent = beginNavigationIntent();
    const s = get();
    if (s.navIndex >= s.navStack.length - 1) return;
    const idx = s.navIndex + 1;
    const entry = s.navStack[idx];
    set({ navIndex: idx, page: entry.page });
    if (entry.page === "chat" && entry.sessionId) {
      void get().selectSession(entry.sessionId, {
        record: false,
        navigationIntent: intent,
      });
      set({ navIndex: idx });
    }
  },
  resolvePermission: async (sessionId, requestId, decision) => {
    const permission = get().pendingPermissions[sessionId];
    if (!permission || permission.requestId !== requestId) return;
    try {
      await api.resolvePermission({
        requestId,
        decision,
      });
    } finally {
      // A late response for an expired request must not clear its replacement.
      set((state) => ({
        pendingPermissions: clearPendingPermission(
          state.pendingPermissions,
          sessionId,
          requestId,
        ),
      }));
    }
  },
  showToast: (message, options) => {
    const variant = options?.variant ?? "info";
    const duration =
      options?.duration ??
      (variant === "error" ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
    set((state) => {
      // Re-raising an identical toast restarts it instead of stacking a twin.
      const kept = state.toasts.filter(
        (item) => item.message !== message || item.variant !== variant,
      );
      const next = [...kept, { id: ++toastSeq, message, variant, duration }];
      return { toasts: next.slice(-TOAST_STACK_LIMIT) };
    });
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),

  refreshWorkspaceDiff: async () => {
    const workspacePath = get().workspace?.path ?? null;
    const requestSeq = ++workspaceDiffRequestSeq;
    if (!workspacePath) {
      set({
        workspaceDiff: null,
        workspaceDiffPath: null,
        workspaceDiffLoading: false,
      });
      return;
    }

    set((state) => ({
      workspaceDiffLoading: true,
      workspaceDiffPath: workspacePath,
      ...(state.workspaceDiffPath === workspacePath ? {} : { workspaceDiff: null }),
    }));
    try {
      const workspaceDiff = await api.workspaceDiff();
      if (
        requestSeq === workspaceDiffRequestSeq &&
        get().workspace?.path === workspacePath
      ) {
        set((state) => ({
          workspaceDiff,
          workspaceDiffPath: workspacePath,
          ...(!workspaceDiff.repo || workspaceDiff.clean
            ? {
                workspaceReviewSessions: withoutWorkspaceReviewSessions(
                  state.workspaceReviewSessions,
                  workspacePath,
                ),
              }
            : {}),
        }));
      }
    } catch {
      if (
        requestSeq === workspaceDiffRequestSeq &&
        get().workspace?.path === workspacePath
      ) {
        set({ workspaceDiff: null, workspaceDiffPath: workspacePath });
      }
    } finally {
      if (requestSeq === workspaceDiffRequestSeq) {
        set({ workspaceDiffLoading: false });
      }
    }
  },

  openWorkPanelTabForSession: (sessionId, tab) => {
    if (!sessionId) return;
    let openedVisiblePanel = false;
    set((state) => {
      const affectsVisibleSession =
        pendingSessionSelection === null && state.activeSessionId === sessionId;
      const context = affectsVisibleSession
        ? currentWorkPanelContext(state)
        : state.workPanelContexts[sessionId] ?? emptyWorkPanelContext();
      const next = openWorkPanelTabState(
        {
          tabs: context.tabs,
          activeTabId: context.activeTabId,
        },
        tab,
      );
      const fileRequest =
        tab.kind === "file" && tab.resource
          ? {
              path: tab.resource,
              seq: ++workPanelFileRequestSeq,
            }
          : context.fileRequest;
      const nextContext: WorkPanelContext = {
        open: true,
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        fileRequest,
      };
      openedVisiblePanel = affectsVisibleSession && !context.open;
      return {
        workPanelContexts: {
          ...state.workPanelContexts,
          [sessionId]: nextContext,
        },
        ...(affectsVisibleSession
          ? {
              workPanelOpen: true,
              workPanelTabs: next.tabs,
              activeWorkPanelTabId: next.activeTabId,
              workPanelFileRequest: fileRequest,
            }
          : {}),
      };
    });
    if (openedVisiblePanel) expandWindowForPanel(get().workPanelWidth);
  },
  openWorkPanelTab: (tab) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    get().openWorkPanelTabForSession(sessionId, tab);
  },
  activateWorkPanelTab: (tabId) => {
    set((state) => {
      const sessionId = state.activeSessionId;
      if (!sessionId) return {};
      const next = activateWorkPanelTabState(
        {
          tabs: state.workPanelTabs,
          activeTabId: state.activeWorkPanelTabId,
        },
        tabId,
      );
      const activeTab = next.tabs.find((tab) => tab.id === next.activeTabId);
      const fileRequest =
        activeTab?.kind === "file" && activeTab.resource
          ? {
              path: activeTab.resource,
              seq: ++workPanelFileRequestSeq,
            }
          : state.workPanelFileRequest;
      const nextContext: WorkPanelContext = {
        open: state.workPanelOpen,
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        fileRequest,
      };
      return {
        activeWorkPanelTabId: next.activeTabId,
        workPanelFileRequest: fileRequest,
        workPanelContexts: {
          ...state.workPanelContexts,
          [sessionId]: nextContext,
        },
      };
    });
  },
  closeWorkPanelTab: (tabId) => {
    const wasOpen = get().workPanelOpen;
    let closePanel = false;
    set((state) => {
      const sessionId = state.activeSessionId;
      if (!sessionId) return {};
      const next = closeWorkPanelTabState(
        {
          tabs: state.workPanelTabs,
          activeTabId: state.activeWorkPanelTabId,
        },
        tabId,
      );
      const activeTab = next.tabs.find((tab) => tab.id === next.activeTabId);
      closePanel = next.activeTabId === null;
      const fileRequest =
        activeTab?.kind === "file" && activeTab.resource
          ? {
              path: activeTab.resource,
              seq: ++workPanelFileRequestSeq,
            }
          : state.workPanelFileRequest;
      const nextContext: WorkPanelContext = {
        open: closePanel ? false : state.workPanelOpen,
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        fileRequest,
      };
      return {
        workPanelTabs: next.tabs,
        activeWorkPanelTabId: next.activeTabId,
        workPanelOpen: closePanel ? false : state.workPanelOpen,
        workPanelFileRequest: fileRequest,
        workPanelContexts: {
          ...state.workPanelContexts,
          [sessionId]: nextContext,
        },
      };
    });
    if (wasOpen && closePanel) shrinkWindowForPanel(get().workPanelWidth);
  },
  collapseWorkPanel: () => {
    const state = get();
    const sessionId = state.activeSessionId;
    if (!sessionId || !state.workPanelOpen) return;
    set({
      workPanelOpen: false,
      workPanelContexts: {
        ...state.workPanelContexts,
        [sessionId]: { ...currentWorkPanelContext(state), open: false },
      },
    });
    shrinkWindowForPanel(get().workPanelWidth);
  },
  resetWorkPanelContext: () => {
    const wasOpen = get().workPanelOpen;
    set((state) => switchWorkPanelSession(state));
    syncPanelWindowForVisibility(wasOpen, false, get().workPanelWidth);
  },
  setWorkPanelWidth: (width, options) => {
    const prev = get().workPanelWidth;
    set({
      workPanelWidth: Math.max(
        WORK_PANEL_MIN_WIDTH,
        Math.min(WORK_PANEL_MAX_WIDTH, width),
      ),
    });
    if (options?.persist !== false) saveWorkPanelWidth(get().workPanelWidth);
    // Committed drag-resize also extends the window instead of the chat.
    const next = get().workPanelWidth;
    if (canResizeWindowForPanel() && get().workPanelOpen && next !== prev) {
      if (options?.resizeWindow === false) return;
      resizeWindowForPanel(next - prev).then(
        (r) => {
          if (panelWindowGrowth !== null) panelWindowGrowth += r.applied;
        },
        () => {},
      );
    }
  },

  openFileInWorkPanel: (path) => {
    get().openWorkPanelTab(fileWorkPanelTab(path));
  },
  openUrlInWorkPanel: (url) => {
    get().openWorkPanelTab({ ...toolWorkPanelTab("browser"), resource: url });
  },
  openTerminalInWorkPanel: () => {
    get().openWorkPanelTab(toolWorkPanelTab("terminal"));
  },

  clearComposerPrefill: () => set({ composerPrefill: null }),
}));
