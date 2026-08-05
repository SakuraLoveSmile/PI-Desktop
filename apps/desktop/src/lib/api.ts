import type {
  ActivationScope,
  AgentEventEnvelope,
  AgentCompactRequest,
  AgentCompactResponse,
  AgentPromptRequest,
  UiMessage,
  MessageRevisionSummary,
  AgentPromptResponse,
  AgentStatus,
  AgentInstructionFile,
  AppSettings,
  CommandShellCatalog,
  AppVersionInfo,
  BrowserAction,
  BrowserState,
  CommandItem,
  ComposerCommand,
  FsEntry,
  FsIndexResult,
  FsReadResult,
  HostHealth,
  HostStatusEvent,
  ModelInfo,
  McpServerInput,
  McpServerRecord,
  McpServerStatus,
  OnboardingState,
  PluginSummary,
  PluginServiceStatus,
  PluginTheme,
  MarketPluginSummary,
  MarketPluginDetail,
  PluginInstallResult,
  ProjectRecord,
  ProjectWorkspace,
  PullRequestSummary,
  ScheduledTask,
  ProviderCreateInput,
  ProviderPublic,
  ProviderUpdateInput,
  Result,
  SessionDetail,
  SessionSummary,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  ToolPermissionResolution,
  UserSkillInput,
  UserSkillRecord,
  WorkspaceDiff,
  AppMenuCommand,
  AppNotification,
  NativeMenuAction,
  NotificationListResult,
  ReviewRollbackResult,
  PlanProposal,
  PlanResolveRequest,
  PlanResolutionResult,
  PlanningStateEvent,
  PlansPendingResult,
  UpdateState,
  WindowControlAction,
} from "@pi-desktop/shared";
import {
  defaultCommandShellForPlatform,
  IPC,
  isCommandShellId,
  normalizeMode,
} from "@pi-desktop/shared";

export type ImportSource = "claude-code" | "opencode" | "codex" | "pi";

export interface ImportCandidate {
  source: ImportSource;
  externalId: string;
  title: string;
  projectPath: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ImportRunResult {
  imported: number;
  skipped: number;
  failed: number;
}

declare global {
  interface Window {
    piDesktop?: {
      invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<Result<T>>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      channels: typeof IPC;
      platform: NodeJS.Platform;
      /** Authoritative OS locale passed from the main process at window creation. */
      locale?: string;
    };
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.piDesktop?.invoke) {
    throw new Error("piDesktop preload bridge unavailable");
  }
  const result = await window.piDesktop.invoke<T>(channel, ...args);
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }
  return result.data;
}

function normalizeSession(session: SessionSummary): SessionSummary {
  return {
    ...session,
    mode: normalizeMode((session as { mode?: unknown }).mode),
  };
}

function normalizeSessionDetail(detail: SessionDetail | null): SessionDetail | null {
  return detail
    ? {
        ...detail,
        mode: normalizeMode((detail as { mode?: unknown }).mode),
      }
    : null;
}

export function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    defaultMode: normalizeMode((settings as { defaultMode?: unknown }).defaultMode),
    defaultCommandShell: isCommandShellId(
      (settings as { defaultCommandShell?: unknown }).defaultCommandShell,
    )
      ? (settings as { defaultCommandShell: AppSettings["defaultCommandShell"] })
          .defaultCommandShell
      : defaultCommandShellForPlatform(window.piDesktop?.platform ?? ""),
  };
}

export function validateSettingsWrite(settings: AppSettings): AppSettings {
  const value = settings as AppSettings & {
    defaultCommandShell?: unknown;
  };
  if (
    Object.prototype.hasOwnProperty.call(value, "defaultCommandShell") &&
    !isCommandShellId(value.defaultCommandShell)
  ) {
    throw Object.assign(new Error("defaultCommandShell is invalid"), {
      errorCode: "COMMAND_SHELL_INVALID",
    });
  }
  return settings;
}

function normalizePlanProposal(proposal: PlanProposal): PlanProposal {
  return { ...proposal };
}

function normalizePendingPlans(result: PlansPendingResult): PlansPendingResult {
  return {
    ...result,
    plans: result.plans.map(normalizePlanProposal),
  };
}

function normalizePlansChangedEvent(value: unknown): PlanningStateEvent {
  const raw = (value ?? {}) as PlanningStateEvent & {
    execution?: {
      id?: unknown;
      proposalId?: unknown;
      state?: unknown;
    };
  };
  const execution = raw.execution;
  if (!execution) return raw;
  const executionState =
    execution.state === "queued" ||
    execution.state === "running" ||
    execution.state === "completed" ||
    execution.state === "interrupted"
      ? execution.state
      : undefined;
  return {
    ...raw,
    ...(raw.proposalId || typeof execution.proposalId !== "string"
      ? {}
      : { proposalId: execution.proposalId }),
    ...(raw.executionId || typeof execution.id !== "string"
      ? {}
      : { executionId: execution.id }),
    ...(raw.executionState || !executionState
      ? {}
      : { executionState }),
  };
}

export const api = {
  getVersion: () => invoke<AppVersionInfo>(IPC.invoke.appGetVersion),
  health: () => invoke<HostHealth>(IPC.invoke.appHealth),
  getOnboarding: () => invoke<OnboardingState>(IPC.invoke.appGetOnboarding),
  dismissOnboarding: () => invoke(IPC.invoke.appDismissOnboarding),
  updatesGetState: () => invoke<UpdateState>(IPC.invoke.updatesGetState),
  updatesCheck: () => invoke<UpdateState>(IPC.invoke.updatesCheck),
  updatesDownload: () => invoke<UpdateState>(IPC.invoke.updatesDownload),
  updatesInstall: () => invoke(IPC.invoke.updatesInstall),
  updatesOpenReleases: () => invoke(IPC.invoke.updatesOpenReleases),
  listNotifications: (input?: { unreadOnly?: boolean; limit?: number }) =>
    invoke<NotificationListResult>(IPC.invoke.notificationList, input ?? {}),
  markNotificationRead: (id: string) =>
    invoke<{ ok: boolean }>(IPC.invoke.notificationMarkRead, { id }),
  markAllNotificationsRead: () =>
    invoke<{ ok: boolean }>(IPC.invoke.notificationMarkAllRead),
  clearNotifications: () =>
    invoke<{ ok: boolean }>(IPC.invoke.notificationClear),
  showNativeNotification: (input: {
    id: string;
    sessionId: string;
    title: string;
    body: string;
  }) => invoke<{ shown: boolean }>(IPC.invoke.notificationShowNative, input),
  setNotificationViewingSession: (sessionId: string | null) =>
    invoke<{ ok: boolean }>(IPC.invoke.notificationSetViewingSession, {
      sessionId,
    }),
  listSessions: () =>
    invoke<{ sessions: SessionSummary[] }>(IPC.invoke.sessionList).then((result) => ({
      ...result,
      sessions: result.sessions.map(normalizeSession),
    })),
  createSession: (input?: Partial<SessionSummary>) =>
    invoke<{ session: SessionSummary }>(IPC.invoke.sessionCreate, input ?? {}).then(
      (result) => ({ ...result, session: normalizeSession(result.session) }),
    ),
  forkSession: (sessionId: string, title?: string, throughMessageId?: string) =>
    invoke<{ session: SessionDetail }>(IPC.invoke.sessionFork, {
      sessionId,
      title,
      throughMessageId,
    }).then((result) => ({ ...result, session: normalizeSessionDetail(result.session)! })),
  getSession: (id: string) =>
    invoke<{ session: SessionDetail | null }>(IPC.invoke.sessionGet, id).then((result) => ({
      ...result,
      session: normalizeSessionDetail(result.session),
    })),
  deleteSession: (id: string) => invoke(IPC.invoke.sessionDelete, id),
  openProjectFolder: (path: string) =>
    invoke<{ ok: boolean; path: string }>(IPC.invoke.projectOpenFolder, path),
  renameSession: (id: string, title: string) =>
    invoke(IPC.invoke.sessionRename, id, title),
  configureSession: (
    id: string,
    config: Pick<SessionSummary, "mode" | "providerId" | "modelId"> &
      Partial<Pick<SessionSummary, "thinkingLevel" | "permissionMode">>,
  ) =>
    invoke<{ session: SessionSummary }>(
      IPC.invoke.sessionConfigure,
      id,
      config,
    ).then((result) => ({ ...result, session: normalizeSession(result.session) })),
  scanImportSessions: () =>
    invoke<{ sessions: ImportCandidate[] }>(IPC.invoke.sessionImportScan),
  runImportSessions: (items: ImportCandidate[]) =>
    invoke<ImportRunResult>(IPC.invoke.sessionImportRun, items),
  getSettings: () => invoke<AppSettings>(IPC.invoke.settingsGet).then(normalizeSettings),
  setSettings: (settings: AppSettings) =>
    invoke(IPC.invoke.settingsSet, validateSettingsWrite(settings)),
  listCommandShells: () =>
    invoke<CommandShellCatalog>(IPC.invoke.commandShellList),
  listProviders: () =>
    invoke<{ providers: ProviderPublic[] }>(IPC.invoke.providersList),
  createProvider: (input: ProviderCreateInput) =>
    invoke<{ provider: ProviderPublic }>(IPC.invoke.providersCreate, input),
  updateProvider: (input: ProviderUpdateInput) =>
    invoke<{ provider: ProviderPublic | null }>(
      IPC.invoke.providersUpdate,
      input,
    ),
  deleteProvider: (id: string) => invoke(IPC.invoke.providersDelete, id),
  testProvider: (id: string) => invoke(IPC.invoke.providersTest, id),
  /** Discover models from the provider's own endpoint. Saved providers pass
   * providerId (stored secret is reused); the dialog may pass raw config. */
  listProviderModels: (input: {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
    apiStyle?: string;
    source?: "cache" | "refresh";
  }) =>
    invoke<{
      models: ModelInfo[];
      source: "cache" | "remote" | "fallback";
      error?: string;
    }>(IPC.invoke.providersListModels, input),
  getProject: () =>
    invoke<{ workspace: ProjectWorkspace | null }>(IPC.invoke.projectGet),
  listProjects: () =>
    invoke<{ projects: ProjectRecord[] }>(IPC.invoke.projectList),
  openProject: () =>
    invoke<{ workspace: ProjectWorkspace | null; canceled?: boolean }>(
      IPC.invoke.projectOpen,
    ),
  pickFiles: () =>
    invoke<{ paths: string[]; canceled?: boolean }>(IPC.invoke.composerPickFiles),
  pickPhotos: () =>
    invoke<{ paths: string[]; canceled?: boolean }>(IPC.invoke.composerPickPhotos),
  clearProject: () => invoke(IPC.invoke.projectClear),
  setProject: (path: string) =>
    invoke<{ workspace: ProjectWorkspace | null }>(IPC.invoke.projectSet, path),
  listPullRequests: () =>
    invoke<{ pulls: PullRequestSummary[]; error?: string }>(IPC.invoke.pullsList),
  listScheduled: () =>
    invoke<{ tasks: ScheduledTask[] }>(IPC.invoke.scheduledList),
  createScheduled: (input: {
    title?: string;
    prompt: string;
    cadence?: ScheduledTask["cadence"];
    enabled?: boolean;
  }) => invoke<{ task: ScheduledTask }>(IPC.invoke.scheduledCreate, input),
  updateScheduled: (input: Partial<ScheduledTask> & { id: string }) =>
    invoke<{ task: ScheduledTask }>(IPC.invoke.scheduledUpdate, input),
  deleteScheduled: (id: string) => invoke(IPC.invoke.scheduledDelete, id),
  runScheduled: (id: string) =>
    invoke<{ sessionId: string; prompt: string; task: ScheduledTask }>(
      IPC.invoke.scheduledRun,
      id,
    ),
  replaceSessionMessages: (sessionId: string, messages: UiMessage[]) =>
    invoke(IPC.invoke.sessionReplaceMessages, { sessionId, messages }),
  saveSessionRevision: (input: {
    sessionId: string;
    rootUserId: string;
    messages: UiMessage[];
    makeActive?: boolean;
  }) =>
    invoke<{ revision: MessageRevisionSummary }>(IPC.invoke.sessionSaveRevision, input),
  listSessionRevisions: (sessionId: string, rootUserId: string) =>
    invoke<{ revisions: MessageRevisionSummary[] }>(IPC.invoke.sessionListRevisions, {
      sessionId,
      rootUserId,
    }),
  activateSessionRevision: (input: {
    sessionId: string;
    rootUserId: string;
    revisionIndex: number;
    prefix: UiMessage[];
  }) =>
    invoke<{ messages: UiMessage[] }>(IPC.invoke.sessionActivateRevision, input),
  prompt: (req: AgentPromptRequest) =>
    invoke<AgentPromptResponse>(IPC.invoke.agentPrompt, req),
  compact: (req: AgentCompactRequest) =>
    invoke<AgentCompactResponse>(IPC.invoke.agentCompact, req),
  abort: (sessionId: string) =>
    invoke(IPC.invoke.agentAbort, { sessionId }),
  getStatus: (sessionId: string) =>
    invoke<{ status: AgentStatus }>(IPC.invoke.agentGetStatus, sessionId),
  getAgentInstructions: (projectPath?: string) =>
    invoke<{ global: AgentInstructionFile; project?: AgentInstructionFile }>(
      IPC.invoke.agentInstructionsGet,
      projectPath === undefined ? {} : { projectPath },
    ),
  saveAgentInstructions: (
    scope: AgentInstructionFile["scope"],
    content: string,
    projectPath?: string,
  ) =>
    invoke<{ file: AgentInstructionFile }>(IPC.invoke.agentInstructionsSave, {
      scope,
      content,
      ...(projectPath === undefined ? {} : { projectPath }),
    }),
  resolvePermission: (resolution: ToolPermissionResolution) =>
    invoke(IPC.invoke.toolResolvePermission, resolution),
  pendingPlans: (sessionId?: string) =>
    invoke<PlansPendingResult>(
      IPC.invoke.plansPending,
      sessionId ? { sessionId } : {},
    ).then(normalizePendingPlans),
  resolvePlan: (resolution: PlanResolveRequest) =>
    invoke<PlanResolutionResult>(IPC.invoke.plansResolve, resolution),
  listPlugins: () =>
    invoke<{ plugins: PluginSummary[] }>(IPC.invoke.pluginList),
  loadDevPlugin: () => invoke(IPC.invoke.pluginLoadDev),
  createPluginFromTemplate: (template: string) =>
    invoke<{
      canceled?: boolean;
      id?: string;
      name?: string;
      dir?: string;
      files?: string[];
    }>(IPC.invoke.pluginCreateFromTemplate, { template }),
  installPluginFromPath: () => invoke(IPC.invoke.pluginInstallFromPath),
  installPluginFromPackage: () => invoke(IPC.invoke.pluginInstallFromPackage),
  enablePlugin: (id: string) => invoke(IPC.invoke.pluginEnable, id),
  disablePlugin: (id: string) => invoke(IPC.invoke.pluginDisable, id),
  uninstallPlugin: (id: string) => invoke(IPC.invoke.pluginUninstall, id),
  setPluginAutoUpdate: (id: string, enabled: boolean) =>
    invoke(IPC.invoke.pluginSetAutoUpdate, { id, enabled }),
  /**
   * Where a plugin's contributions apply. Separate from enable/disable so
   * narrowing a plugin to two projects and then switching it off keeps the list.
   */
  setPluginScope: (id: string, scope: ActivationScope) =>
    invoke<{ plugin?: PluginSummary }>(IPC.invoke.pluginSetScope, { id, scope }),

  // --- MCP servers the user owns -------------------------------------------
  listMcpServers: () =>
    invoke<{ servers: McpServerRecord[]; statuses: McpServerStatus[] }>(IPC.invoke.mcpList),
  /** Create or replace a server; the id decides which. */
  upsertMcpServer: (server: McpServerInput) =>
    invoke<{ server: McpServerRecord }>(IPC.invoke.mcpUpsert, server),
  removeMcpServer: (id: string) => invoke(IPC.invoke.mcpRemove, id),
  setMcpServerEnabled: (id: string, enabled: boolean) =>
    invoke(IPC.invoke.mcpSetEnabled, { id, enabled }),
  setMcpServerScope: (id: string, scope: ActivationScope) =>
    invoke(IPC.invoke.mcpSetScope, { id, scope }),
  /** Force one handshake and report what happened, for the editor's test button. */
  testMcpServer: (id: string) =>
    invoke<{ status: McpServerStatus }>(IPC.invoke.mcpTest, id),
  /** Accept a pasted `mcpServers` block; bad entries are reported, not fatal. */
  importMcpServers: (text: string) =>
    invoke<{
      imported: McpServerRecord[];
      failed: Array<{ id: string; reason: string }>;
    }>(IPC.invoke.mcpImport, { text }),

  // --- Skills the user owns -------------------------------------------------
  listUserSkills: () => invoke<{ skills: UserSkillRecord[] }>(IPC.invoke.skillList),
  createUserSkill: (skill: UserSkillInput) =>
    invoke<{ skill: UserSkillRecord }>(IPC.invoke.skillCreate, skill),
  /** Opens a native picker; `canceled` when the user backed out. */
  importUserSkill: () =>
    invoke<{ canceled?: boolean; skill?: UserSkillRecord }>(IPC.invoke.skillImport),
  updateUserSkill: (id: string, skill: Omit<UserSkillInput, "id">) =>
    invoke<{ skill: UserSkillRecord }>(IPC.invoke.skillUpdate, { id, ...skill }),
  /** The record plus the document body, for the editor. */
  readUserSkill: (id: string) =>
    invoke<{ skill: UserSkillRecord | null; body?: string }>(IPC.invoke.skillRead, id),
  removeUserSkill: (id: string) => invoke(IPC.invoke.skillRemove, id),
  setUserSkillEnabled: (id: string, enabled: boolean) =>
    invoke(IPC.invoke.skillSetEnabled, { id, enabled }),
  setUserSkillScope: (id: string, scope: ActivationScope) =>
    invoke(IPC.invoke.skillSetScope, { id, scope }),
  revealUserSkill: (id: string) => invoke(IPC.invoke.skillReveal, id),
  openPluginPanel: (id: string) => invoke(IPC.invoke.pluginOpenPanel, id),
  listPluginThemes: () => invoke<PluginTheme[]>(IPC.invoke.pluginThemes),
  listPluginServices: () => invoke<PluginServiceStatus[]>(IPC.invoke.pluginServices),
  marketRefresh: (force = true) =>
    invoke<{
      providerId: string;
      name?: string;
      homepage?: string;
      updatedAt?: string;
      pluginCount: number;
      sourceUrl: string;
    }>(IPC.invoke.marketRefresh, { force }),
  marketSearch: (query = "", category = "") =>
    invoke<{ plugins: MarketPluginSummary[]; providerId: string }>(
      IPC.invoke.marketSearch,
      { query, category },
    ),
  marketGetDetail: (id: string) =>
    invoke<{ plugin: MarketPluginDetail }>(IPC.invoke.marketGetDetail, id),
  marketInstall: (input: {
    id: string;
    version?: string;
    enable?: boolean;
    autoUpdate?: boolean;
    grantedPermissions?: string[];
  }) =>
    invoke<{ result: PluginInstallResult }>(IPC.invoke.marketInstall, input),
  marketCheckUpdates: () =>
    invoke<{ updates: unknown[]; plugins: PluginSummary[] }>(
      IPC.invoke.marketCheckUpdates,
    ),
  marketApplyUpdates: (onlyAuto = true) =>
    invoke<{ results: PluginInstallResult[]; plugins: PluginSummary[] }>(
      IPC.invoke.marketApplyUpdates,
      { onlyAuto },
    ),
  searchCommands: (query: string) =>
    invoke<{ commands: CommandItem[] }>(
      IPC.invoke.commandPaletteSearch,
      query,
    ),
  executeCommand: (commandId: string) =>
    invoke(IPC.invoke.commandPaletteExecute, commandId),
  openLogs: () => invoke(IPC.invoke.logOpenFolder),
  /** Toggles the devtools console; rejects unless developer mode is on. */
  toggleDevTools: (open?: boolean) =>
    invoke<{ open: boolean }>(IPC.invoke.devtoolsToggle, { open }),
  workspaceDiff: () => invoke<WorkspaceDiff>(IPC.invoke.workspaceDiff),
  workspaceReviewRollback: (input: {
    sessionId: string;
    snapshotId: string;
  }) => invoke<ReviewRollbackResult>(IPC.invoke.workspaceReviewRollback, input),
  terminalCreate: (input: { cwd: string; cols?: number; rows?: number }) =>
    invoke<TerminalCreateResult>(IPC.invoke.terminalCreate, input),
  terminalWrite: (termId: string, data: string) =>
    invoke(IPC.invoke.terminalWrite, { termId, data }),
  terminalResize: (termId: string, cols: number, rows: number) =>
    invoke(IPC.invoke.terminalResize, { termId, cols, rows }),
  terminalDispose: (termId: string) =>
    invoke(IPC.invoke.terminalDispose, { termId }),
  browserNavigate: (url: string, sessionId?: string) =>
    invoke<BrowserState>(IPC.invoke.browserNavigate, { url, sessionId }),
  browserAction: (action: BrowserAction) =>
    invoke(IPC.invoke.browserAction, { action }),
  browserSetBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => invoke(IPC.invoke.browserSetBounds, bounds),
  browserSetVisible: (visible: boolean) =>
    invoke(IPC.invoke.browserSetVisible, { visible }),
  browserOpenExternal: () => invoke(IPC.invoke.browserOpenExternal),
  browserGetState: () =>
    invoke<BrowserState | null>(IPC.invoke.browserGetState),
  fsList: (path?: string) =>
    invoke<{ entries: FsEntry[] }>(IPC.invoke.fsList, { path: path ?? "" }),
  fsRead: (path: string) => invoke<FsReadResult>(IPC.invoke.fsRead, { path }),
  fsReveal: (path: string) => invoke(IPC.invoke.fsReveal, { path }),
  fsIndex: () => invoke<FsIndexResult>(IPC.invoke.fsIndex),
  composerCommands: () =>
    invoke<{ commands: ComposerCommand[] }>(IPC.invoke.composerCommands),
  setWorkPanelReservation: (width: number) =>
    invoke<{ requested: number; reserved: number }>(
      IPC.invoke.windowSetWorkPanelReservation,
      { width },
    ),
  windowControl: (action: WindowControlAction) =>
    invoke<{ maximized: boolean }>(IPC.invoke.windowControl, { action }),
  menuRendererReady: () =>
    invoke<{ ready: boolean }>(IPC.invoke.menuRendererReady),
  nativeMenuAction: (action: NativeMenuAction) =>
    invoke<{ maximized: boolean; fullScreen: boolean }>(
      IPC.invoke.nativeMenuAction,
      { action },
    ),
  onWindowMaximized: (listener: (event: { maximized: boolean }) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.windowMaximized, (payload) =>
      listener(payload as { maximized: boolean }),
    );
  },
  onWindowFullScreen: (listener: (event: { fullScreen: boolean }) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.windowFullScreen, (payload) =>
      listener(payload as { fullScreen: boolean }),
    );
  },
  onMenuCommand: (listener: (command: AppMenuCommand) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.menuCommand, (payload) =>
      listener((payload as { command: AppMenuCommand }).command),
    );
  },
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.terminalData, (payload) =>
      listener(payload as TerminalDataEvent),
    );
  },
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.terminalExit, (payload) =>
      listener(payload as TerminalExitEvent),
    );
  },
  onBrowserState: (listener: (state: BrowserState) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.browserState, (payload) =>
      listener(payload as BrowserState),
    );
  },
  onBrowserPreview: (
    listener: (event: { sessionId: string; path: string }) => void,
  ) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.browserPreview, (payload) =>
      listener(payload as { sessionId: string; path: string }),
    );
  },
  onAgentEvent: (listener: (event: AgentEventEnvelope) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.agentMessage, (payload) =>
      listener(payload as AgentEventEnvelope),
    );
  },
  onPlansChanged: (listener: (event: PlanningStateEvent) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.plansChanged, (payload) =>
      listener(normalizePlansChangedEvent(payload)),
    );
  },
  onToast: (listener: (message: string) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.toast, (payload) =>
      listener((payload as { message: string }).message),
    );
  },
  onHostStatus: (listener: (status: HostStatusEvent) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.hostStatus, (payload) =>
      listener(payload as HostStatusEvent),
    );
  },
  onNotificationChanged: (
    listener: (notification: AppNotification) => void,
  ) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.notificationChanged, (payload) =>
      listener((payload as { notification: AppNotification }).notification),
    );
  },
  onNotificationActivated: (
    listener: (event: { id: string; sessionId: string }) => void,
  ) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.notificationActivated, (payload) =>
      listener(payload as { id: string; sessionId: string }),
    );
  },
  onUpdateState: (listener: (state: UpdateState) => void) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.updatesState, (payload) =>
      listener(payload as UpdateState),
    );
  },
  onPluginChanged: (
    listener: (event: { reason?: string; pluginId?: string }) => void,
  ) => {
    if (!window.piDesktop?.on) return () => undefined;
    return window.piDesktop.on(IPC.event.pluginChanged, (payload) =>
      listener((payload ?? {}) as { reason?: string; pluginId?: string }),
    );
  },
};
