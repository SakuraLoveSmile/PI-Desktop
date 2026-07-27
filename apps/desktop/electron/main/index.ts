import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification as SystemNotification,
  screen,
  shell,
} from "electron";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  APP_MENU_COMMANDS,
  ErrorCodes,
  IPC,
  IPC_WHITELIST,
  NATIVE_MENU_ACTIONS,
  PROTOCOL_VERSION,
  THINKING_LEVELS,
  WINDOW_CONTROL_ACTIONS,
  err,
  ok,
  type AgentEventEnvelope,
  type AppMenuCommand,
  type AppNotification,
  type KeybindingOverrides,
  type NativeMenuAction,
  type Result,
  type ThinkingLevel,
  type WindowControlAction,
} from "@pi-desktop/shared";
import {
  clampThinkingLevel,
  resolvePiModelConfig,
  resolveThinkingCapabilities,
  expandSlashInvocation,
  loadComposerTemplates,
  type ComposerTemplate,
  type ThinkingCapabilities,
} from "@pi-desktop/agent-runtime";
import { HostProcess } from "./host-process";
import { AgentSidecar } from "./agent-sidecar";
import { PluginRuntime } from "./plugin-runtime";
import { Logger } from "./logger";
import { collectWorkspaceDiff } from "./git-diff";
import { PtyManager } from "./terminal";
import { BrowserPane, resolveLocalFile } from "./browser-view";
import { discoverProviderModels } from "./model-discovery";
import { listDir, readWorkspaceFile, resolveWithinRoot } from "./fs-panel";
import { getWorkspaceFileIndex } from "./fs-index";
import { builtinComposerCommands, builtinPaletteItems } from "./builtin-commands";
import {
  convertSession,
  scanAllSources,
  type ExternalSessionSummary,
  type ExternalSource,
} from "./importers";
import { installApplicationMenu } from "./application-menu";
import { AppUpdaterController } from "./updater";

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

let mainWindow: BrowserWindow | null = null;
let windowCreationPromise: Promise<void> | null = null;
let applicationBooted = false;
const isDevelopmentBuild =
  process.env.PI_DESKTOP_DEV === "1" || !app.isPackaged;
const pendingApplicationMenuCommands: AppMenuCommand[] = [];
type MenuRendererReadyGate = {
  window: BrowserWindow;
  ready: boolean;
  promise: Promise<void>;
  resolve: () => void;
};
let menuRendererReadyGate: MenuRendererReadyGate | null = null;
let panelWindowWidthOffset = 0;
let host: HostProcess | null = null;
let sidecar: AgentSidecar | null = null;
let quitting = false;
const plugins = new PluginRuntime();
const ptys = new PtyManager({
  onData: (termId, data) =>
    sendToRenderer(IPC.event.terminalData, { termId, data }),
  onExit: (termId, exitCode) =>
    sendToRenderer(IPC.event.terminalExit, { termId, exitCode }),
});
const browserPane = new BrowserPane((state) =>
  sendToRenderer(IPC.event.browserState, state),
);
let scannedImportSessions = new Map<string, ExternalSessionSummary>();

const IMPORT_SOURCES = new Set<ExternalSource>([
  "claude-code",
  "opencode",
  "codex",
  "pi",
]);

const dataDir =
  process.env.PI_DESKTOP_DATA_DIR || join(homedir(), ".pi-desktop");
const logger = new Logger(
  dataDir,
  process.env.NODE_ENV === "production" ? "info" : "debug",
);

const updater = new AppUpdaterController({
  logger,
  send: sendToRenderer,
  currentVersion: APP_VERSION,
  isPackaged: !isDevelopmentBuild,
});

type RuntimeProvider = {
  id: string;
  name: string;
  vendorKey?: string;
  baseUrl?: string;
  modelId?: string;
  defaultModelId?: string;
  apiKey?: string;
  authKind?: string;
  apiStyle?: string;
  hasSecret?: boolean;
  enabled?: boolean;
};

type RuntimeSession = {
  providerId?: string;
  modelId?: string;
};

function enrichProvider<T extends RuntimeProvider>(
  provider: T,
  selectedModelId?: string,
): T & ThinkingCapabilities {
  const modelId =
    selectedModelId || provider.modelId || provider.defaultModelId || "";
  const capabilities = resolveThinkingCapabilities({
    vendorKey: provider.vendorKey || "custom",
    modelId,
    apiStyle: provider.apiStyle,
  });
  return {
    ...provider,
    ...capabilities,
  };
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  return typeof value === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : "off";
}

function enrichProviderList<T extends RuntimeProvider>(result: { providers: T[] }) {
  return {
    ...result,
    providers: result.providers.map((provider) => enrichProvider(provider)),
  };
}

function enrichSession<T extends RuntimeSession>(
  session: T,
  providers: readonly RuntimeProvider[],
): T & ThinkingCapabilities {
  const provider = providers.find((candidate) => candidate.id === session.providerId);
  if (!provider || !session.modelId) {
    return {
      ...session,
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    };
  }
  const capabilities = resolveThinkingCapabilities({
    vendorKey: provider.vendorKey || "custom",
    modelId: session.modelId,
    apiStyle: provider.apiStyle,
  });
  return {
    ...session,
    ...capabilities,
  };
}

async function listRuntimeProviders(includeDisabled = true) {
  if (!host) throw new Error("host unavailable");
  const result = await host.call<{ providers: RuntimeProvider[] }>(
    "providers.list",
    { includeDisabled },
  );
  return result.providers;
}

function applyDevelopmentBranding() {
  if (process.platform !== "darwin" || !isDevelopmentBuild || !app.dock) return;

  const iconPath = join(app.getAppPath(), "build", "icon_1024.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    logger.app("warn", "development dock icon missing", {
      data: { iconPath },
    });
    return;
  }

  app.dock.setIcon(icon);
}

function sendToRenderer(channel: string, payload: unknown) {
  if (!IPC_WHITELIST.has(channel)) return;
  const window = mainWindow;
  if (
    !window ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return;
  }
  window.webContents.send(channel, payload);
}

function resetMenuRendererReady(window: BrowserWindow) {
  menuRendererReadyGate?.resolve();
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  menuRendererReadyGate = {
    window,
    ready: false,
    promise,
    resolve,
  };
}

function markMenuRendererReady(window: BrowserWindow): boolean {
  const gate = menuRendererReadyGate;
  if (gate?.window !== window || window.isDestroyed()) return false;
  gate.ready = true;
  gate.resolve();
  return true;
}

async function waitForMenuRenderer(window: BrowserWindow): Promise<boolean> {
  const gate = menuRendererReadyGate;
  if (gate?.window !== window) return false;
  await gate.promise;
  return (
    menuRendererReadyGate === gate &&
    gate.ready &&
    mainWindow === window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed()
  );
}

async function ensureWindow(): Promise<boolean> {
  if (windowCreationPromise) {
    await windowCreationPromise;
    return true;
  }
  if (mainWindow && !mainWindow.isDestroyed()) return false;

  const creation = createWindow();
  windowCreationPromise = creation;
  try {
    await creation;
    return true;
  } finally {
    if (windowCreationPromise === creation) windowCreationPromise = null;
  }
}

async function deliverApplicationMenuCommand(command: AppMenuCommand) {
  await ensureWindow();
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (!(await waitForMenuRenderer(window))) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  sendToRenderer(IPC.event.menuCommand, { command });
}

function dispatchApplicationMenuCommand(command: AppMenuCommand) {
  if (!APP_MENU_COMMANDS.includes(command)) return;
  if (!applicationBooted) {
    pendingApplicationMenuCommands.push(command);
    return;
  }
  void deliverApplicationMenuCommand(command).catch((error) => {
    logger.app("error", "application menu command failed", {
      data: String(error),
    });
  });
}

let appliedMenuSettings: string | null = null;

/**
 * Devtools stay locked until the user opts in via settings (D-dev mode);
 * mirrors `AppSettings.developerMode` so the IPC handler, the F12 shortcut
 * and the macOS View menu all read one flag.
 */
let developerMode = false;

function applyDeveloperMode(settings?: { developerMode?: unknown } | null) {
  const next = settings?.developerMode === true;
  if (next === developerMode) return;
  developerMode = next;
  // Leaving developer mode should not strand an open console.
  if (!next && mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    }
  }
}

/** Keep native labels and accelerators aligned with persisted app settings. */
function applyApplicationMenuSettings(settings?: {
  language?: unknown;
  keybindings?: unknown;
  developerMode?: unknown;
} | null) {
  const locale =
    typeof settings?.language === "string" &&
    settings.language &&
    settings.language !== "auto"
      ? settings.language
      : app.getLocale();
  const keybindings =
    settings?.keybindings && typeof settings.keybindings === "object"
      ? (settings.keybindings as KeybindingOverrides)
      : undefined;
  const devMode = settings?.developerMode === true;
  const signature = JSON.stringify({ locale, keybindings, devMode });
  if (appliedMenuSettings === signature) return;
  appliedMenuSettings = signature;
  installApplicationMenu({
    locale,
    keybindings,
    developerMode: devMode,
    dispatch: dispatchApplicationMenuCommand,
  });
}

function flushPendingApplicationMenuCommands() {
  const commands = pendingApplicationMenuCommands.splice(0);
  void (async () => {
    for (const command of commands) {
      await deliverApplicationMenuCommand(command);
    }
  })().catch((error) => {
    logger.app("error", "queued application menu command failed", {
      data: String(error),
    });
  });
}

function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn()
    .then((data) => ok(data))
    .catch((e: any) =>
      err(
        e?.data?.errorCode || e?.errorCode || ErrorCodes.INTERNAL,
        e instanceof Error ? e.message : String(e),
        { retriable: e?.data?.retriable === true, details: e?.data },
      ),
    );
}

function importSelectionKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const source = Reflect.get(value, "source");
  const externalId = Reflect.get(value, "externalId");
  if (
    typeof source !== "string" ||
    !IMPORT_SOURCES.has(source as ExternalSource) ||
    typeof externalId !== "string" ||
    !externalId
  ) {
    return null;
  }
  return `${source}:${externalId}`;
}


function scheduledPath() {
  return join(dataDir, "scheduled-tasks.json");
}

/// Scheduled tasks live in host-core SQLite (schema v2, D086). This one-shot
/// import moves the legacy Electron JSON store into the host, then renames the
/// file so it never imports twice. Idempotent on the host side too.
async function importLegacyScheduled() {
  if (!host) return;
  const { readFile, rename } = await import("node:fs/promises");
  const path = scheduledPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const res = await host.call<{ imported: number }>("scheduled.import", {
        tasks: parsed,
      });
      logger.app("info", "legacy scheduled tasks imported", {
        data: { imported: res.imported, total: parsed.length },
      });
    }
    await rename(path, `${path}.imported.bak`);
  } catch (e: any) {
    if (e?.code !== "ENOENT") {
      logger.app("warn", "legacy scheduled import failed", { data: String(e) });
    }
  }
}

/** sessionId → open host turn id, for turn bookkeeping across agent events. */
const activeTurns = new Map<string, string>();
/** sessionId → scheduled task_run id awaiting completion. */
const scheduledRunsBySession = new Map<string, string>();
/** Session currently rendered on the chat page; focus remains Main-owned. */
let notificationViewingSessionId: string | null = null;
/** Preserve tool metadata until the result is persisted at tool_end. */
const activeToolCalls = new Map<
  string,
  { toolName: string; args: unknown; createdAt: string }
>();

function activeToolCallKey(sessionId: string, toolCallId: string) {
  return `${sessionId}:${toolCallId}`;
}

function shouldCreateTaskNotification(sessionId: string) {
  const userIsViewingResult =
    mainWindow !== null &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    mainWindow.isFocused() &&
    notificationViewingSessionId === sessionId;
  return !userIsViewingResult;
}

async function withGitBranch<T extends { path?: string; name?: string } | null | undefined>(
  workspace: T,
): Promise<T> {
  if (!workspace || !workspace.path) return workspace;
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const head = await readFile(join(workspace.path, ".git/HEAD"), "utf8");
    const match = head.match(/ref:\s*refs\/heads\/(.+)$/m);
    return {
      ...workspace,
      branch: match?.[1]?.trim() || "detached",
    };
  } catch {
    return { ...workspace, branch: undefined };
  }
}

type WindowState = { x: number; y: number; width: number; height: number };

function windowStatePath() {
  return join(dataDir, "window-state.json");
}

async function readWindowState(): Promise<WindowState | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = JSON.parse(await readFile(windowStatePath(), "utf8"));
    const s = {
      x: Number(raw.x),
      y: Number(raw.y),
      width: Number(raw.width),
      height: Number(raw.height),
    };
    if (![s.x, s.y, s.width, s.height].every(Number.isFinite)) return null;
    if (s.width < 1040 || s.height < 700) return null;
    return s;
  } catch {
    return null;
  }
}

function writeWindowState(state: WindowState) {
  void (async () => {
    const { writeFile } = await import("node:fs/promises");
    try {
      mkdirSync(dataDir, { recursive: true });
      await writeFile(windowStatePath(), JSON.stringify(state), "utf8");
    } catch {
      // best-effort persistence
    }
  })();
}

async function createWindow() {
  panelWindowWidthOffset = 0;
  notificationViewingSessionId = null;
  const savedState = await readWindowState();
  mainWindow = new BrowserWindow({
    ...(savedState ?? { width: 1200, height: 800 }),
    // Fits the full three-column layout at comfortable widths without
    // squishing: sidebar (240) + chat (≥400) + work panel (default 420).
    minWidth: 1040,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff",
    show: false,
    // One frameless look everywhere: macOS keeps inset traffic lights;
    // Windows/Linux hide native chrome entirely — the renderer draws its
    // own Codex-style window controls (see WindowControls.tsx).
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const window = mainWindow;
  resetMenuRendererReady(window);
  const isLiveWindow = () =>
    mainWindow === window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed();

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("did-start-loading", () => {
    notificationViewingSessionId = null;
    if (mainWindow === window) resetMenuRendererReady(window);
  });
  window.webContents.on("render-process-gone", () => {
    notificationViewingSessionId = null;
  });

  // Devtools shortcut, gated on developer mode. Frameless windows get no
  // default binding, and Windows/Linux run with the application menu set to
  // null, so F12 is wired here; macOS additionally inherits Cmd+Alt+I from
  // the View menu role (see application-menu.ts).
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !developerMode) return;
    // `code` rather than `key`: Option+I on macOS produces a dead key.
    const isDevToolsChord =
      input.code === "F12" ||
      (process.platform !== "darwin" &&
        input.code === "KeyI" &&
        input.control &&
        input.shift);
    if (!isDevToolsChord) return;
    event.preventDefault();
    if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
    else window.webContents.openDevTools({ mode: "detach" });
  });

  // Fullscreen hides the macOS traffic lights; the renderer shifts its
  // titlebar controls left to reclaim the space.
  const sendFullScreen = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC.event.windowFullScreen, {
      fullScreen: window.isFullScreen(),
    });
  };
  window.on("enter-full-screen", sendFullScreen);
  window.on("leave-full-screen", sendFullScreen);
  window.webContents.on("did-finish-load", sendFullScreen);

  // Custom window controls (Windows/Linux) need maximize state to swap the
  // maximize/restore glyph.
  if (process.platform !== "darwin") {
    const sendMaximized = () => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send(IPC.event.windowMaximized, {
        maximized: window.isMaximized(),
      });
    };
    window.on("maximize", sendMaximized);
    window.on("unmaximize", sendMaximized);
    // Native-runner E2E fixture: establish the initial native state before
    // the renderer mounts, then let WindowControls query it through IPC.
    if (process.env.PI_DESKTOP_START_MAXIMIZED === "1") window.maximize();
  }

  browserPane.setWindow(window);
  window.on("closed", () => {
    if (menuRendererReadyGate?.window === window) {
      menuRendererReadyGate.resolve();
      menuRendererReadyGate = null;
    }
    if (mainWindow !== window) return;
    mainWindow = null;
    browserPane.setWindow(null);
  });

  // Block navigation away from the app shell (dev server origin or local file).
  window.webContents.on("will-navigate", (event, url) => {
    const devOrigin = process.env.ELECTRON_RENDERER_URL;
    if (devOrigin && url.startsWith(devOrigin)) return;
    event.preventDefault();
    logger.app("warn", "blocked navigation attempt", { data: { url } });
  });

  // Codex-like default footprint. CG bounds are truth under Stage Manager.
  const CODEX_BOUNDS = { x: 40, y: 30, width: 1200, height: 800 } as const;
  let boundsGuard = false;
  let boundsTimer: NodeJS.Timeout | null = null;
  let pinUntil = 0;
  let captureViewportOverride = false;
  let lastCgAt = 0;
  let lastCg: { x: number; y: number; width: number; height: number } | null = null;
  let missingCgStreak = 0;
  // The CG helper is dev tooling; without it, CG-based shelf detection must
  // stay inert or every machine would look permanently "shelved".
  const cgHelperPath = "/tmp/pi-window-bounds";
  const cgHelperAvailable = existsSync(cgHelperPath);

  const readCgBounds = (): { x: number; y: number; width: number; height: number } | null => {
    if (!cgHelperAvailable) return null;
    // Cache briefly — Stage Manager checks should not spawn tools every frame.
    if (Date.now() - lastCgAt < 700) return lastCg;
    try {
      const out = execFileSync(cgHelperPath, [String(process.pid)], {
        encoding: "utf8",
        timeout: 800,
      }).trim();
      lastCgAt = Date.now();
      if (!out) {
        lastCg = null;
        return null;
      }
      const [x, y, w, h] = out.split(",").map((n: string) => Number(n));
      if (![x, y, w, h].every((n: number) => Number.isFinite(n))) {
        lastCg = null;
        return null;
      }
      lastCg = { x, y, width: w, height: h };
      return lastCg;
    } catch {
      lastCgAt = Date.now();
      lastCg = null;
      return null;
    }
  };

  const ensureStableBounds = (force = false) => {
    if (!isLiveWindow() || boundsGuard || captureViewportOverride) return;
    const electronBounds = window.getBounds();
    const cg = readCgBounds();
    if (!cg && cgHelperAvailable) missingCgStreak += 1;
    else missingCgStreak = 0;
    // Tiny/offscreen CG footprint is Stage Manager shelf. Missing CG alone is not
    // conclusive (alwaysOnTop can change window layer); require a short streak.
    const shelved =
      (!!cg && (cg.width < 500 || cg.height < 400 || cg.x < -40)) ||
      (!cg && cgHelperAvailable && missingCgStreak >= 3);
    const electronTiny =
      electronBounds.width < 500 || electronBounds.height < 400;
    if (!force && !shelved && !electronTiny) return;

    boundsGuard = true;
    try {
      if (window.isMinimized()) window.restore();
      window.setMinimumSize(1040, 700);
      // Prefer normal layer so CG helpers and Stage Manager stay stable.
      window.setAlwaysOnTop(false);
      window.show();
      window.focus();
      window.moveTop();
      if (shelved) {
        window.hide();
        window.setBounds({ ...CODEX_BOUNDS }, false);
        window.show();
      } else {
        window.setBounds({ ...CODEX_BOUNDS }, false);
      }
      window.setSize(CODEX_BOUNDS.width, CODEX_BOUNDS.height, false);
      window.setPosition(CODEX_BOUNDS.x, CODEX_BOUNDS.y, false);
      // Brief pin only when actively recovering from a shelf.
      if (shelved || electronTiny) {
        window.setAlwaysOnTop(true, "floating");
        pinUntil = Date.now() + 4000;
      } else {
        pinUntil = 0;
      }
      // bust CG cache after mutation
      lastCgAt = 0;
      console.log("BOUNDS_RESTORE", {
        electron: electronBounds,
        cg,
        shelved,
        afterElectron: window.getBounds(),
        afterCg: readCgBounds(),
      });
    } finally {
      setTimeout(() => {
        boundsGuard = false;
      }, 350);
    }
  };

  const scheduleBoundsCheck = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => ensureStableBounds(false), 100);
  };

  window.on("show", () => ensureStableBounds(false));
  window.on("focus", () => ensureStableBounds(false));
  window.on("restore", () => ensureStableBounds(false));
  window.on("resize", scheduleBoundsCheck);
  window.on("move", scheduleBoundsCheck);

  // Persist last good user bounds so relaunch restores them.
  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleStateSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!isLiveWindow() || boundsGuard) return;
      if (window.isMinimized() || window.isFullScreen()) return;
      const bounds = window.getBounds();
      const persistedBounds = {
        ...bounds,
        width: bounds.width - panelWindowWidthOffset,
      };
      if (persistedBounds.width >= 1040 && persistedBounds.height >= 700) {
        writeWindowState(persistedBounds);
      }
    }, 600);
  };
  window.on("resize", scheduleStateSave);
  window.on("move", scheduleStateSave);

  const boundsWatchdog = setInterval(() => {
    if (!isLiveWindow()) {
      clearInterval(boundsWatchdog);
      return;
    }
    const cg = readCgBounds();
    const electronBounds = window.getBounds();
    if (!cg && cgHelperAvailable) missingCgStreak += 1;
    else missingCgStreak = 0;
    const shelved =
      (!!cg && (cg.width < 500 || cg.height < 400 || cg.x < -40)) ||
      (!cg && cgHelperAvailable && missingCgStreak >= 3);
    const electronTiny =
      electronBounds.width < 500 || electronBounds.height < 400;
    if (shelved || electronTiny) {
      ensureStableBounds(true);
      return;
    }
    if (Date.now() > pinUntil) {
      try {
        window.setAlwaysOnTop(false);
      } catch {
        // ignore
      }
    }
  }, 1500);
  window.on("closed", () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (saveTimer) clearTimeout(saveTimer);
    clearInterval(boundsWatchdog);
  });

  window.once("ready-to-show", () => {
    if (!isLiveWindow()) return;
    // Capture runs need the deterministic Codex footprint; normal launches
    // must respect restored user bounds and only fix real shelf states.
    ensureStableBounds(process.env.PI_DESKTOP_CAPTURE === "1");
    window.show();
    window.focus();
    // Burst re-assert only while Stage Manager initially settles / shelves us.
    for (const ms of [100, 250, 500, 1000, 2000, 3500, 5000, 8000, 12000]) {
      setTimeout(() => ensureStableBounds(false), ms);
    }
    if (process.env.PI_DESKTOP_CAPTURE === "1") {
      setTimeout(() => {
        void (async () => {
          try {
            if (!mainWindow) return;
            const { writeFileSync } = await import("node:fs");
            const shot = async (name: string) => {
              const img = await mainWindow!.webContents.capturePage();
              writeFileSync(`/tmp/codex-screens/${name}.png`, img.toPNG());
              console.log("CAPTURE", name, img.getSize());
            };
            const clickNav = async (nav: string) => {
              await mainWindow!.webContents.executeJavaScript(
                `document.querySelector('[data-nav="${nav}"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
              );
            };
            const setPage = async (page: string) => {
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.setPage?.(${JSON.stringify(page)})`,
              );
            };
            const setSettingsTab = async (tab: string) => {
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.setSettingsTab?.(${JSON.stringify(tab)})`,
              );
            };
            const setTheme = async (theme: "light" | "dark") => {
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.setThemeAttr?.(${JSON.stringify(theme)})`,
              );
            };
            // Wait until React leaves the starting gate.
            for (let i = 0; i < 40; i++) {
              const state = await mainWindow!.webContents.executeJavaScript(`({
                readyText: document.body?.innerText?.slice(0,80) || "",
                theme: document.documentElement.dataset.theme || "",
                hasShell: !!document.querySelector(".app-shell"),
                hasSidebar: !!document.querySelector(".sidebar, .sidebar-rail"),
                sidebarClass: document.querySelector(".sidebar, .sidebar-rail")?.className || "",
                navCount: document.querySelectorAll("[data-nav]").length,
              })`);
              console.log("CAPTURE_STATE", i, state);
              if (state.hasShell && state.navCount > 0) break;
              await new Promise((r) => setTimeout(r, 250));
            }
            await mainWindow!.webContents.executeJavaScript(`
              window.__PI_DESKTOP__?.setThemeAttr?.("light");
              window.__PI_DESKTOP__?.setPage?.("chat");
              // ensure expanded sidebar if rail-only
              if (document.querySelector(".sidebar-rail") && !document.querySelector(".sidebar")) {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
              }
            `);
            await new Promise((r) => setTimeout(r, 400));
            try {
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_CAPTURE__ = 1; void window.__PI_DESKTOP__?.ensureVisualFixtures?.()`,
              );
            } catch {
              // fixtures optional
            }
            // Focused sidebar-status capture: one row per D135 state, in both
            // themes. The status-only mode exits before the broader visual
            // suite and is intended for narrow UI verification.
            if (process.env.PI_DESKTOP_CAPTURE_STATUS_ONLY === "1") {
              if (process.env.PI_DESKTOP_CAPTURE_REDUCED_MOTION === "1") {
                mainWindow!.webContents.debugger.attach("1.3");
                await mainWindow!.webContents.debugger.sendCommand(
                  "Emulation.setEmulatedMedia",
                  {
                    features: [
                      { name: "prefers-reduced-motion", value: "reduce" },
                    ],
                  },
                );
              }
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.ensureVisualFixtures?.()`,
              );
              await new Promise((r) => setTimeout(r, 300));
              const statusFixture = await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.seedSidebarStatuses?.()`,
              );
              const probeStatuses = async (theme: "light" | "dark") => {
                await setTheme(theme);
                await new Promise((r) => setTimeout(r, 350));
                const probe = await mainWindow!.webContents.executeJavaScript(`(() => ({
                  theme: document.documentElement.dataset.theme,
                  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
                  rows: [...document.querySelectorAll('.thread-item-status')].map((status) => {
                    const row = status.closest('.thread-item');
                    const rect = status.getBoundingClientRect();
                    const before = getComputedStyle(status, '::before');
                    return {
                      state: [...status.classList].find((name) => name !== 'thread-item-status'),
                      label: status.getAttribute('aria-label'),
                      color: getComputedStyle(status).color,
                      fill: before.backgroundColor,
                      animation: before.animationName,
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                      rowHeight: Math.round(row?.getBoundingClientRect().height || 0),
                    };
                  }),
                }))()`);
                console.log("SIDEBAR_STATUS_PROBE", probe);
                await shot(`pi-sidebar-status-${theme}`);
              };
              console.log("SIDEBAR_STATUS_FIXTURE", statusFixture);
              await probeStatuses("light");
              await probeStatuses("dark");
              console.log("CAPTURE_STATUS_DONE");
              app.quit();
              return;
            }
            // Provider fixture so settings/model-picker scenes have content.
            try {
              const existing = await host?.call<{ providers?: unknown[] }>(
                "providers.list",
                { includeDisabled: true },
              );
              if (host && (existing?.providers?.length ?? 0) === 0) {
                await host.call("providers.create", {
                  name: "OJ Gateway",
                  vendorKey: "custom",
                  type: "openai_compatible",
                  protocol: "openai_compatible",
                  baseUrl: "https://api.oj.ink/v1",
                  authKind: "api_key_and_base_url",
                  defaultModelId: "mimo-v2.5",
                  secretValue: "sk-capture-fixture",
                  apiStyle: "chat_completions",
                });
                await mainWindow!.webContents.executeJavaScript(
                  `void window.__PI_DESKTOP__?.refreshProviders?.()`,
                );
                await new Promise((r) => setTimeout(r, 300));
              }
            } catch {
              // provider fixture optional
            }
            await new Promise((r) => setTimeout(r, 500));
            // Prefer a titled empty recent (Codex gold selects a real title, not "New task").
            try {
              await mainWindow!.webContents.executeJavaScript(`
                (() => {
                  const items = [...document.querySelectorAll('.thread-item .thread-item-main, .thread-item-main, .thread-item')];
                  const prefer =
                    items.find((el) => /同步代码/.test(el.textContent || '')) ||
                    items.find((el) => !/新\s*建\s*任\s*务|New task|未命名/i.test(el.textContent || ''));
                  if (prefer) prefer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                })()
              `);
              await new Promise((r) => setTimeout(r, 450));
            } catch {
              await clickNav("new-task");
              await new Promise((r) => setTimeout(r, 500));
            }
            try {
              if (mainWindow!.isMinimized()) mainWindow!.restore();
              mainWindow!.show();
              mainWindow!.focus();
              mainWindow!.moveTop();
            } catch {
              // ignore
            }
            await new Promise((r) => setTimeout(r, 350));
            // Composer visibility probe (empty draft must not collapse)
            const composerProbe = await mainWindow!.webContents.executeJavaScript(`(() => { const ta=document.querySelector("textarea.composer-input"); if(!ta) return null; const r=ta.getBoundingClientRect(); return {value:ta.value, ph:ta.placeholder, h:ta.offsetHeight, y:Math.round(r.y), mark:document.querySelector(".composer-thread-mark")?.textContent||""}; })()`);
            console.log("COMPOSER_PROBE", composerProbe);
            await shot("pi-final");
            // Work panel scenes are opened by simulated artifacts; production
            // exposes no empty/manual panel entry point (D119).
            const openPanelArtifact = (kind: string, resource?: string) =>
              mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.openWorkPanelArtifact(${JSON.stringify(kind)}, ${JSON.stringify(resource)})`,
              );
            await openPanelArtifact("review");
            await new Promise((r) => setTimeout(r, 500));
            await shot("pi-panel-review");
            await openPanelArtifact("terminal");
            // The PTY needs a beat for the login shell prompt to settle.
            await new Promise((r) => setTimeout(r, 1200));
            await shot("pi-panel-terminal");
            await openPanelArtifact("browser");
            await new Promise((r) => setTimeout(r, 400));
            await shot("pi-panel-browser");
            await openPanelArtifact("file", "apps/desktop/src/App.tsx");
            await new Promise((r) => setTimeout(r, 500));
            await shot("pi-panel-files");
            await mainWindow!.webContents.executeJavaScript(
              `window.__PI_DESKTOP__?.collapseWorkPanel()`,
            );
            await new Promise((r) => setTimeout(r, 300));
            // Open composer + menu for chrome parity proof.
            await mainWindow!.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('.composer-plus button, .composer-plus .icon-btn');
                if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              })()
            `);
            await new Promise((r) => setTimeout(r, 250));
            await shot("pi-plus-menu");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            await mainWindow!.webContents.executeJavaScript(`
              (() => {
                const btn = document.querySelector('.composer-model button, .model-chip');
                if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              })()
            `);
            await new Promise((r) => setTimeout(r, 250));
            await shot("pi-model-menu");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            // Composer autocomplete scenes (D123–D125): "/" command menu and
            // "@" file menu. React's controlled textarea needs the native
            // value setter + input event to register the draft.
            const setComposerDraft = (draft: string) =>
              mainWindow!.webContents.executeJavaScript(`
                (() => {
                  const ta = document.querySelector("textarea.composer-input");
                  if (!ta) return false;
                  ta.focus();
                  const set = Object.getOwnPropertyDescriptor(
                    HTMLTextAreaElement.prototype,
                    "value",
                  ).set;
                  set.call(ta, ${JSON.stringify(draft)});
                  ta.dispatchEvent(new Event("input", { bubbles: true }));
                  return true;
                })()
              `);
            await setComposerDraft("/");
            await new Promise((r) => setTimeout(r, 450));
            const slashProbe = await mainWindow!.webContents.executeJavaScript(
              `(() => { const m = document.querySelector(".composer-autocomplete"); return m ? { rows: m.querySelectorAll(".composer-ac-item").length, groups: [...m.querySelectorAll(".composer-model-group-label")].map((g) => g.textContent) } : null; })()`,
            );
            console.log("COMPOSER_AC_SLASH", slashProbe);
            await shot("pi-composer-slash");
            await setComposerDraft("@");
            await new Promise((r) => setTimeout(r, 450));
            const atProbe = await mainWindow!.webContents.executeJavaScript(
              `(() => { const m = document.querySelector(".composer-autocomplete"); return m ? { rows: m.querySelectorAll(".composer-ac-item").length, empty: m.querySelector(".composer-model-empty")?.textContent || "" } : null; })()`,
            );
            console.log("COMPOSER_AC_AT", atProbe);
            await shot("pi-composer-at");
            await setComposerDraft("");
            await new Promise((r) => setTimeout(r, 200));
            // Conversation minimap: seed a capture-only transcript, magnify
            // mid-rail (Dock effect + preview popover), then restore.
            await mainWindow!.webContents.executeJavaScript(
              `void window.__PI_DESKTOP__?.seedTranscript?.()`,
            );
            await new Promise((r) => setTimeout(r, 600));
            await shot("pi-minimap");
            const minimapProbe = await mainWindow!.webContents.executeJavaScript(`
              (() => {
                const rail = document.querySelector(".minimap-rail");
                if (!rail) return null;
                const r = rail.getBoundingClientRect();
                rail.dispatchEvent(new MouseEvent("mousemove", {
                  bubbles: true,
                  clientX: r.left + 10,
                  clientY: r.top + r.height / 2,
                }));
                return { markers: rail.querySelectorAll(".minimap-marker").length };
              })()
            `);
            console.log("MINIMAP_PROBE", minimapProbe);
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-minimap-hover");
            await mainWindow!.webContents.executeJavaScript(
              `void window.__PI_DESKTOP__?.seedTranscript?.(0)`,
            );
            await new Promise((r) => setTimeout(r, 250));
            // Notification inbox: mixed status, long title, read state, 99+ badge,
            // both themes, then the responsive fixed-position popover.
            const openNotificationFixture = async () => {
              await mainWindow!.webContents.executeJavaScript(`
                window.__PI_DESKTOP__?.seedNotifications?.(105);
                document.querySelector('.notification-trigger')?.dispatchEvent(
                  new MouseEvent('click', { bubbles: true })
                );
              `);
              // Opening refreshes the durable inbox; reapply the capture-only
              // fixture after that request settles.
              await new Promise((r) => setTimeout(r, 350));
              await mainWindow!.webContents.executeJavaScript(
                `window.__PI_DESKTOP__?.seedNotifications?.(105)`,
              );
              await new Promise((r) => setTimeout(r, 150));
            };
            const probeNotificationFixture = async (scene: string) => {
              const probe = await mainWindow!.webContents.executeJavaScript(`(() => {
                const popover = document.querySelector('.notification-popover');
                const title = document.querySelector('.notification-item-title');
                const badge = document.querySelector('.notification-badge');
                if (!popover || !title) return null;
                const rect = popover.getBoundingClientRect();
                const titleStyle = getComputedStyle(title);
                return {
                  scene: ${JSON.stringify(scene)},
                  viewport: { width: innerWidth, height: innerHeight },
                  popover: {
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    right: Math.round(rect.right),
                    bottom: Math.round(rect.bottom),
                    position: getComputedStyle(popover).position,
                  },
                  withinViewport:
                    rect.left >= 0 && rect.top >= 0 &&
                    rect.right <= innerWidth && rect.bottom <= innerHeight,
                  badge: badge?.textContent?.trim() || '',
                  rowCount: document.querySelectorAll('.notification-item').length,
                  unreadRows: document.querySelectorAll('.notification-item.unread').length,
                  failedRows: document.querySelectorAll('.notification-kind-icon.failed').length,
                  titleTruncated:
                    title.scrollWidth > title.clientWidth &&
                    titleStyle.textOverflow === 'ellipsis',
                };
              })()`);
              console.log("NOTIFICATION_PROBE", probe);
            };
            await setTheme("light");
            await setPage("chat");
            await openNotificationFixture();
            await probeNotificationFixture("light");
            await shot("pi-notifications-light");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            await setTheme("dark");
            await openNotificationFixture();
            await probeNotificationFixture("dark");
            await shot("pi-notifications-dark");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            captureViewportOverride = true;
            try {
              mainWindow!.setMinimumSize(420, 640);
              mainWindow!.setSize(420, 760, false);
              await new Promise((r) => setTimeout(r, 250));
              await setTheme("light");
              await openNotificationFixture();
              await probeNotificationFixture("narrow");
              await shot("pi-notifications-narrow");
              await mainWindow!.webContents.executeJavaScript(`
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                window.__PI_DESKTOP__?.seedNotifications?.(0);
              `);
            } finally {
              mainWindow!.setSize(CODEX_BOUNDS.width, CODEX_BOUNDS.height, false);
              mainWindow!.setMinimumSize(1040, 700);
              captureViewportOverride = false;
            }
            await new Promise((r) => setTimeout(r, 300));
            // Destination + theme captures (robust via __PI_DESKTOP__ hooks).
            await setTheme("dark");
            await setPage("chat");
            await new Promise((r) => setTimeout(r, 250));
            await shot("pi-dark-home");
            await setSettingsTab("projects");
            await new Promise((r) => setTimeout(r, 300));
            await shot("pi-dark-project-archive");
            await setPage("pulls");
            await new Promise((r) => setTimeout(r, 300));
            await shot("pi-dark-pulls");
            await setPage("settings");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-dark-settings");
            await setTheme("light");
            await setPage("pulls");
            await new Promise((r) => setTimeout(r, 450));
            await shot("pi-pulls-live");
            await setSettingsTab("projects");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-project-archive-live");
            await setPage("scheduled");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-scheduled-live");
            await mainWindow!.webContents.executeJavaScript(
              `window.__PI_DESKTOP__?.seedPlugins?.(3)`,
            );
            await setPage("plugins");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-plugins-live");
            await mainWindow!.webContents.executeJavaScript(
              `window.__PI_DESKTOP__?.seedPlugins?.(0)`,
            );
            await setPage("settings");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-settings-live");
            // Model configuration tab: provider cards, defaults, edit dialog.
            await mainWindow!.webContents.executeJavaScript(`
              [...document.querySelectorAll('.settings-nav-item')][1]?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
            `);
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-settings-models");
            await mainWindow!.webContents.executeJavaScript(`
              (() => {
                const edit = [...document.querySelectorAll('.provider-row-actions .provider-icon-btn')][0];
                const add = document.querySelector('.provider-section-head button');
                (edit ?? add)?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
              })()
            `);
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-settings-provider-dialog");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            await new Promise((r) => setTimeout(r, 200));
            await setPage("chat");
            await new Promise((r) => setTimeout(r, 250));
            await mainWindow!.webContents.executeJavaScript(`
              document.querySelector('[data-nav="profile"], .footer-profile')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
            `);
            await new Promise((r) => setTimeout(r, 250));
            await shot("pi-profile-menu");
            await setTheme("light");
            await setPage("chat");
            // Global search modal (⌘K): recents view, query view, dark theme.
            // Close the profile menu left open by the previous scene first.
            await mainWindow!.webContents.executeJavaScript(`
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            `);
            await new Promise((r) => setTimeout(r, 200));
            const openSearch = () =>
              mainWindow!.webContents.executeJavaScript(`
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
              `);
            const typeSearch = (value: string) =>
              mainWindow!.webContents.executeJavaScript(`
                (() => {
                  const input = document.querySelector(".search-input");
                  if (!input) return;
                  const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value",
                  ).set;
                  setter.call(input, ${JSON.stringify(value)});
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                })()
              `);
            const searchKey = (key: string) =>
              mainWindow!.webContents.executeJavaScript(`
                document.querySelector(".search-input")?.dispatchEvent(
                  new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }),
                );
              `);
            await openSearch();
            await new Promise((r) => setTimeout(r, 450));
            await shot("pi-search");
            await typeSearch("设计");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-search-query");
            // Settings hits: "主题" resolves to 通用 tab's theme row.
            await typeSearch("主题");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-search-settings");
            await setTheme("dark");
            await new Promise((r) => setTimeout(r, 250));
            await shot("pi-search-dark");
            await setTheme("light");
            await new Promise((r) => setTimeout(r, 250));
            // Page hits: "插件" surfaces the plugins page entry.
            await typeSearch("插件");
            await new Promise((r) => setTimeout(r, 350));
            await shot("pi-search-pages");
            // Anchor flash: Enter on the 主题 settings hit lands on 基础 and
            // flashes the theme row.
            await typeSearch("主题");
            await new Promise((r) => setTimeout(r, 350));
            await searchKey("ArrowDown");
            await searchKey("Enter");
            await new Promise((r) => setTimeout(r, 400));
            await shot("pi-search-anchor");
            await setPage("chat");
            await new Promise((r) => setTimeout(r, 250));
            // Toast stack proof (ToastHost variants) in both themes.
            const raiseToasts = () =>
              mainWindow!.webContents.executeJavaScript(`
                window.__PI_DESKTOP__?.showToast?.("Provider saved", { variant: "success" });
                window.__PI_DESKTOP__?.showToast?.("Reconnecting to local backend…", { variant: "warning" });
                window.__PI_DESKTOP__?.showToast?.("Model request failed: 401 Unauthorized", { variant: "error" });
              `);
            await raiseToasts();
            await new Promise((r) => setTimeout(r, 400));
            await shot("pi-toasts-light");
            await setTheme("dark");
            await raiseToasts();
            await new Promise((r) => setTimeout(r, 400));
            await shot("pi-toasts-dark");
            await setTheme("light");
            console.log("CAPTURE_DONE");
            await mainWindow!.webContents.executeJavaScript(`
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            `);
            } catch (e) {
            console.error(e);
          }
        })();
      }, 1800);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.PI_DESKTOP_DEVTOOLS === "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

const RESTART_WINDOW_MS = 120_000;
const MAX_RESTARTS_PER_WINDOW = 3;
const restartState = {
  host: { count: 0, windowStart: 0 },
  sidecar: { count: 0, windowStart: 0 },
};

function wireHost(h: HostProcess) {
  h.onNotification((method, params) => {
    if (method === "permissions.request") {
      logger.app("info", "permission requested", {
        sessionId: (params as any).sessionId,
        toolCallId: (params as any).toolCallId,
        data: { toolName: (params as any).toolName, risk: (params as any).risk },
      });
      const envelope: AgentEventEnvelope = {
        sessionId: (params as any).sessionId,
        ts: Date.now(),
        event: {
          type: "tool_permission_request",
          request: {
            requestId: (params as any).requestId,
            sessionId: (params as any).sessionId,
            toolCallId: (params as any).toolCallId,
            toolName: (params as any).toolName,
            argsPreview: (params as any).argsPreview,
            risk: (params as any).risk,
            reason: (params as any).reason,
          },
        },
      };
      sendToRenderer(IPC.event.agentMessage, envelope);
    } else if (method === "plugins.execute") {
      // Host dispatches plugin_* tools to us; run the plugin JS and answer.
      void (async () => {
        const q = params as {
          executionId: string;
          toolCallId?: string;
          toolName: string;
          args: unknown;
        };
        const tool = plugins.getTools().find((t) => t.fullName === q.toolName);
        let payload: Record<string, unknown>;
        if (!tool) {
          payload = {
            executionId: q.executionId,
            ok: false,
            errorCode: "TOOL_NOT_FOUND",
            content: { error: `plugin tool not loaded: ${q.toolName}` },
          };
        } else {
          try {
            const result = await tool.execute(q.args);
            payload = {
              executionId: q.executionId,
              ok: true,
              content: result ?? null,
            };
          } catch (e) {
            payload = {
              executionId: q.executionId,
              ok: false,
              errorCode: "TOOL_FAILED",
              content: { error: e instanceof Error ? e.message : String(e) },
            };
          }
        }
        logger.app("info", "plugin tool executed", {
          toolCallId: q.toolCallId,
          pluginId: tool?.pluginId,
          data: { toolName: q.toolName, ok: payload.ok === true },
        });
        try {
          await h.call("plugins.resolveExecution", payload);
        } catch (e) {
          logger.app("warn", "plugin execution resolve failed", {
            data: String(e),
          });
        }
        for (const toast of plugins.drainToasts()) {
          sendToRenderer(IPC.event.toast, { message: toast });
        }
      })();
    }
  });
  h.onExit(({ code, signal, intentional }) => {
    if (intentional || quitting) return;
    logger.app("error", "host-core exited unexpectedly", {
      code: ErrorCodes.HOST_UNAVAILABLE,
      data: { exitCode: code, signal },
    });
    sendToRenderer(IPC.event.hostStatus, {
      ok: false,
      component: "host",
      restarting: true,
    });
    void superviseRestart("host");
  });
}

async function startHost(): Promise<void> {
  const h = new HostProcess(dataDir, (text) => logger.child("host", text));
  wireHost(h);
  host = h;
  await h.handshake();
  logger.app("info", "host-core handshake ok");
  void importLegacyScheduled();
}

function wireSidecar(s: AgentSidecar) {
  s.onNotification((method, params) => {
    if (method === "agent.event") {
      const envelope = params as AgentEventEnvelope;
      const event = envelope.event;
      if (event.type === "tool_start") {
        logger.app("info", "tool start", {
          sessionId: envelope.sessionId,
          toolCallId: (event as any).toolCallId,
          data: { toolName: (event as any).toolName },
        });
      } else if (event.type === "tool_end") {
        logger.app("info", "tool end", {
          sessionId: envelope.sessionId,
          toolCallId: (event as any).toolCallId,
          data: { isError: (event as any).isError === true },
        });
      }
      sendToRenderer(IPC.event.agentMessage, params);
      persistAgentEvent(envelope);
    }
    // permissions.request reaches the renderer once, via wireHost; the
    // sidecar no longer relays it (agent-sidecar.setHost filters it out).
  });
  s.onExit(({ code, signal, intentional }) => {
    if (intentional || quitting) return;
    logger.app("error", "agent sidecar exited unexpectedly", {
      data: { exitCode: code, signal },
    });
    sendToRenderer(IPC.event.hostStatus, {
      ok: false,
      component: "sidecar",
      restarting: true,
    });
    void superviseRestart("sidecar");
  });
}

async function startSidecar(): Promise<void> {
  const s = new AgentSidecar((text) => logger.child("agent", text));
  wireSidecar(s);
  // Agent-driven work panel preview (D100): open a workspace HTML file in
  // the embedded browser; live reload keeps it current through later edits.
  s.setLocalTool("BrowserPreview", async ({ args }) => {
    const raw = String((args as { path?: unknown })?.path ?? "").trim();
    if (!raw) {
      return {
        ok: false,
        isError: true,
        content: "BrowserPreview: `path` is required.",
      };
    }
    let root: string | null = null;
    try {
      const res = (await host?.call("workspace.get")) as
        | { workspace: { path: string } | null }
        | undefined;
      root = res?.workspace?.path ?? null;
    } catch {
      root = null;
    }
    if (!root) {
      return {
        ok: false,
        isError: true,
        content: "BrowserPreview: no workspace is open.",
      };
    }
    if (!resolveLocalFile(raw, root)) {
      return {
        ok: false,
        isError: true,
        content: `BrowserPreview: "${raw}" does not resolve to an existing file inside the workspace.`,
      };
    }
    const state = browserPane.navigate(raw, root);
    sendToRenderer(IPC.event.browserPreview, {
      path: raw,
      url: state?.url ?? null,
    });
    return {
      ok: true,
      content: `Previewing ${raw} in the built-in browser panel. Live reload is active — subsequent edits to the file or sibling assets re-render automatically.`,
    };
  });
  sidecar = s;
  if (host) s.setHost(host);
  await s.call("sidecar.configure", {
    hostBinary: host?.binaryPath,
    dataDir,
  });
  logger.app("info", "agent sidecar configured");
}

/// Close the open turn + scheduled run (if any) for a session. Both host
/// updates are idempotent (guarded on status='running').
function finishTurn(
  sessionId: string,
  status: "completed" | "aborted" | "error",
  errorCode?: string,
) {
  const turnId = activeTurns.get(sessionId);
  activeTurns.delete(sessionId);
  if (host && turnId) {
    const createNotification = shouldCreateTaskNotification(sessionId);
    void host
      .call<{ ok: boolean; notification?: AppNotification }>("session.endTurn", {
        turnId,
        status,
        errorCode,
        createNotification,
      })
      .then((result) => {
        if (result.notification) {
          sendToRenderer(IPC.event.notificationChanged, {
            notification: result.notification,
          });
        }
      })
      .catch((e) =>
        logger.app("warn", "endTurn failed", { sessionId, data: String(e) }),
      );
  }
  const runId = scheduledRunsBySession.get(sessionId);
  if (runId) {
    scheduledRunsBySession.delete(sessionId);
    if (host) {
      void host
        .call("scheduled.finishRun", { runId, status, errorCode })
        .catch((e) =>
          logger.app("warn", "finishRun failed", { sessionId, data: String(e) }),
        );
    }
  }
  const toolPrefix = `${sessionId}:`;
  // A host tool can finish shortly after the turn is aborted. Keep metadata
  // long enough for a late tool_end to persist a readable historical row.
  setTimeout(() => {
    for (const key of activeToolCalls.keys()) {
      if (key.startsWith(toolPrefix)) activeToolCalls.delete(key);
    }
  }, 5 * 60 * 1000).unref();
}

function persistAgentEvent(envelope: AgentEventEnvelope) {
  if (!host) return;
  const event = envelope.event;
  const turnId = activeTurns.get(envelope.sessionId);
  if (event.type === "tool_start") {
    activeToolCalls.set(activeToolCallKey(envelope.sessionId, event.toolCallId), {
      toolName: event.toolName,
      args: event.args,
      createdAt: new Date(envelope.ts).toISOString(),
    });
  }
  if (event.type === "error") {
    // Async provider failures must close the durable turn / scheduled run the
    // same way agent_end does; otherwise they stay 'running' in the DB.
    logger.app("error", "agent turn failed", {
      sessionId: envelope.sessionId,
      code: event.error.code,
      data: { message: event.error.message, retriable: event.error.retriable },
    });
    finishTurn(
      envelope.sessionId,
      event.error.code === "TURN_ABORTED" ? "aborted" : "error",
      event.error.code,
    );
    return;
  }
  if (event.type === "agent_end") {
    finishTurn(envelope.sessionId, "completed");
    // Persist the completed branch as the active regenerate revision when the
    // latest user turn carries revision metadata (ChatGPT-style history).
    void (async () => {
      try {
        if (!host) return;
        const detail = await host.call<{ session?: { messages?: any[] } }>(
          "session.get",
          { id: envelope.sessionId },
        );
        const messages = detail.session?.messages ?? [];
        let rootIndex = -1;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i]?.role === "user" && messages[i]?.revisionCount) {
            rootIndex = i;
            break;
          }
        }
        if (rootIndex < 0) return;
        const root = messages[rootIndex];
        const branch = messages.slice(rootIndex);
        const stableRootUserId =
          typeof root.revisionRootId === "string" && root.revisionRootId
            ? root.revisionRootId
            : root.id;
        const listedBefore = await host.call<{
          revisions?: Array<{ revisionIndex: number; isActive?: boolean }>
        }>("session.listRevisions", {
          sessionId: envelope.sessionId,
          rootUserId: stableRootUserId,
        });
        const existing = listedBefore.revisions ?? [];
        const desiredActive = Number(root.activeRevision ?? 0);
        const alreadyPresent = existing.some((revision) => revision.revisionIndex === desiredActive);
        let active = desiredActive || existing.length + 1;
        if (!alreadyPresent) {
          const saved = await host.call<{ revision?: { revisionIndex?: number } }>(
            "session.saveRevision",
            {
              sessionId: envelope.sessionId,
              rootUserId: stableRootUserId,
              messages: branch,
              makeActive: true,
            },
          );
          active = Number(saved.revision?.revisionIndex ?? active) || active;
        }
        const listed = await host.call<{ revisions?: Array<{ revisionIndex: number }> }>(
          "session.listRevisions",
          { sessionId: envelope.sessionId, rootUserId: stableRootUserId },
        );
        const total = listed.revisions?.length ?? Number(root.revisionCount ?? 1);
        if (!active || active < 1) active = total;
        const stamped = {
          ...root,
          revisionRootId: stableRootUserId,
          revisionCount: total,
          activeRevision: active,
        };
        const nextMessages = messages.map((message: any, index: number) =>
          index === rootIndex ? stamped : message,
        );
        await host.call("session.replaceMessages", {
          sessionId: envelope.sessionId,
          messages: nextMessages,
        });
        sendToRenderer(IPC.event.agentMessage, {
          sessionId: envelope.sessionId,
          ts: Date.now(),
          event: { type: "message_end", message: stamped },
        } satisfies AgentEventEnvelope);
      } catch (error) {
        logger.app("warn", "save active regenerate branch failed", {
          sessionId: envelope.sessionId,
          data: String(error),
        });
      }
    })();
    return;
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    // Empty aborted bubbles are not useful transcript rows. Structured
    // provider failures remain durable assistant messages so their details
    // stay attached to the failed turn after reload.
    const failed =
      event.message.status === "error" || event.message.status === "aborted";
    const empty =
      !(event.message.content || "").trim() &&
      !(event.message.thinking || "").trim();
    if (failed && empty && !event.message.error) return;
    void host
      .call("session.appendMessage", {
        sessionId: envelope.sessionId,
        message: event.message,
        turnId,
      })
      .catch((e) =>
        logger.app("warn", "assistant message persistence failed", {
          sessionId: envelope.sessionId,
          data: String(e),
        }),
      );
  }
  if (event.type === "tool_end") {
    const key = activeToolCallKey(envelope.sessionId, event.toolCallId);
    const started = activeToolCalls.get(key);
    activeToolCalls.delete(key);
    void host
      .call("session.appendMessage", {
        sessionId: envelope.sessionId,
        message: {
          id: crypto.randomUUID(),
          role: "tool",
          content:
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result),
          createdAt: started?.createdAt ?? new Date(envelope.ts).toISOString(),
          toolCallId: event.toolCallId,
          toolName: started?.toolName,
          toolArgs: started?.args,
          toolStatus: event.isError ? "error" : "success",
          toolResult: event.result,
          toolCompletedAt: new Date(envelope.ts).toISOString(),
          toolDurationMs: started
            ? Math.max(0, envelope.ts - Date.parse(started.createdAt))
            : undefined,
          isError: event.isError,
          status: "complete",
        },
        turnId,
      })
      .catch((e) =>
        logger.app("warn", "tool message persistence failed", {
          sessionId: envelope.sessionId,
          toolCallId: (event as any).toolCallId,
          data: String(e),
        }),
      );
  }
}

async function superviseRestart(kind: "host" | "sidecar"): Promise<void> {
  const st = restartState[kind];
  const now = Date.now();
  if (now - st.windowStart > RESTART_WINDOW_MS) {
    st.windowStart = now;
    st.count = 0;
  }
  st.count += 1;
  if (st.count > MAX_RESTARTS_PER_WINDOW) {
    logger.app("error", `${kind} restart limit reached; giving up`, {
      code: ErrorCodes.HOST_UNAVAILABLE,
    });
    sendToRenderer(IPC.event.hostStatus, {
      ok: false,
      component: kind,
      fatal: true,
    });
    return;
  }
  const delay = Math.min(500 * 2 ** (st.count - 1), 4000);
  await new Promise((r) => setTimeout(r, delay));
  if (quitting) return;
  try {
    if (kind === "host") {
      await startHost();
      if (sidecar && host) sidecar.setHost(host);
    } else {
      await startSidecar();
    }
    logger.app("warn", `${kind} restarted after crash`);
    sendToRenderer(IPC.event.hostStatus, {
      ok: true,
      component: kind,
      restarted: true,
    });
  } catch (e) {
    logger.app("error", `${kind} restart failed`, { data: String(e) });
    void superviseRestart(kind);
  }
}

async function bootBackends() {
  mkdirSync(join(dataDir, "logs"), { recursive: true });
  logger.app("info", `app boot ${APP_NAME} ${APP_VERSION}`, {
    data: { protocolVersion: PROTOCOL_VERSION },
  });
  await startHost();
  await startSidecar();

  // Restore enabled plugins
  try {
    const listed = await host!.call<{ plugins: any[] }>("plugins.list");
    for (const p of listed.plugins ?? []) {
      if (p.enabled && p.path) {
        try {
          await plugins.loadFromPath(p.path);
          logger.app("info", "plugin restored", { pluginId: p.id });
        } catch (e) {
          logger.app("error", "plugin restore failed", {
            pluginId: p.id,
            data: String(e),
          });
        }
      }
    }
  } catch (e) {
    logger.app("error", "plugin list failed", { data: String(e) });
  }
}

function registerIpc() {
  const handle = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    ipcMain.handle(channel, async (_event, ...args) => wrap(() => fn(...args)));
  };

  handle(IPC.invoke.appGetVersion, async () => {
    const hostVersion = host
      ? await host.call<{ version: string; protocolVersion: number }>(
          "app.getVersion",
        )
      : undefined;
    return {
      name: APP_NAME,
      version: APP_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      hostProtocolVersion: hostVersion?.protocolVersion,
      hostVersion: hostVersion?.version,
      platform: process.platform,
      arch: process.arch,
    };
  });

  handle(IPC.invoke.appHealth, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("app.health");
  });

  handle(IPC.invoke.appGetOnboarding, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("app.getOnboarding");
  });

  handle(IPC.invoke.appDismissOnboarding, async () => {
    if (!host) throw new Error("host unavailable");
    const settings = await host.call<any>("settings.get");
    await host.call("settings.set", { ...settings, onboardingDismissed: true });
    return { ok: true };
  });

  handle(IPC.invoke.updatesGetState, async () => updater.getState());

  handle(IPC.invoke.updatesCheck, async () => updater.check({ manual: true }));

  handle(IPC.invoke.updatesDownload, async () => updater.download());

  handle(IPC.invoke.updatesInstall, async () => {
    updater.install();
    return { ok: true };
  });

  handle(IPC.invoke.updatesOpenReleases, async () => {
    await updater.openReleases();
    return { ok: true };
  });

  handle(IPC.invoke.notificationList, async (input: {
    unreadOnly?: boolean;
    limit?: number;
  } = {}) => {
    if (!host) throw new Error("host unavailable");
    return host.call("notification.list", input);
  });

  handle(IPC.invoke.notificationMarkRead, async (input: { id?: string } = {}) => {
    if (!host) throw new Error("host unavailable");
    return host.call("notification.markRead", input);
  });

  handle(IPC.invoke.notificationMarkAllRead, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("notification.markAllRead");
  });

  handle(IPC.invoke.notificationClear, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("notification.clear");
  });

  handle(
    IPC.invoke.notificationSetViewingSession,
    async (input: { sessionId?: unknown } = {}) => {
      const sessionId =
        typeof input.sessionId === "string" ? input.sessionId.trim() : "";
      notificationViewingSessionId = sessionId || null;
      return { ok: true };
    },
  );

  handle(IPC.invoke.notificationShowNative, async (input: {
    id?: string;
    sessionId?: string;
    title?: string;
    body?: string;
  } = {}) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.isFocused() ||
      !SystemNotification.isSupported()
    ) {
      return { shown: false };
    }
    const id = String(input.id ?? "");
    const sessionId = String(input.sessionId ?? "");
    const title = String(input.title ?? "").trim().slice(0, 100);
    const body = String(input.body ?? "").trim().slice(0, 240);
    if (!id || !sessionId || !title) return { shown: false };

    const notification = new SystemNotification({ title, body });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      sendToRenderer(IPC.event.notificationActivated, { id, sessionId });
    });
    notification.show();
    return { shown: true };
  });

  handle(IPC.invoke.sessionList, async () => {
    if (!host) throw new Error("host unavailable");
    const [result, providers] = await Promise.all([
      host.call<{ sessions: RuntimeSession[] }>("session.list"),
      listRuntimeProviders(),
    ]);
    return {
      ...result,
      sessions: result.sessions.map((session) => enrichSession(session, providers)),
    };
  });
  handle(IPC.invoke.sessionCreate, async (input = {}) => {
    if (!host) throw new Error("host unavailable");
    const res = await host.call<{ session?: (RuntimeSession & { id?: string }) | null }>(
      "session.create",
      input,
    );
    logger.app("info", "session created", { sessionId: res.session?.id });
    if (!res.session) return res;
    const providers = await listRuntimeProviders();
    return { ...res, session: enrichSession(res.session, providers) };
  });
  handle(
    IPC.invoke.sessionFork,
    async (
      input: { sessionId?: string; title?: string; throughMessageId?: string } = {},
    ) => {
      if (!host) throw new Error("host unavailable");
      const sessionId = String(input.sessionId ?? "").trim();
      if (!sessionId) {
        throw Object.assign(new Error("sessionId required"), {
          errorCode: ErrorCodes.INVALID_ARGUMENT,
        });
      }
      if (activeTurns.has(sessionId)) {
        throw Object.assign(new Error("Cannot fork a running session"), {
          errorCode: ErrorCodes.AGENT_BUSY,
        });
      }
      // Resolve enrichment before the mutation so a provider-list failure
      // cannot report a failed IPC after the child has already been committed.
      const providers = await listRuntimeProviders();
      let result: { session?: RuntimeSession | null };
      try {
        result = await host.call("session.fork", {
          sessionId,
          title: String(input.title ?? "").trim() || undefined,
          throughMessageId:
            String(input.throughMessageId ?? "").trim() || undefined,
        });
      } catch (error: any) {
        if (error?.data?.errorCode === ErrorCodes.CONFLICT) {
          throw Object.assign(new Error("Cannot fork a running session"), {
            errorCode: ErrorCodes.AGENT_BUSY,
          });
        }
        throw error;
      }
      if (!result.session) return result;
      logger.app("info", "session forked", {
        sessionId: (result.session as { id?: string }).id,
        data: { sourceSessionId: sessionId },
      });
      return {
        ...result,
        session: enrichSession(result.session, providers),
      };
    },
  );
  handle(IPC.invoke.sessionGet, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    const [result, providers] = await Promise.all([
      host.call<{ session?: RuntimeSession | null }>("session.get", { id }),
      listRuntimeProviders(),
    ]);
    return result.session
      ? { ...result, session: enrichSession(result.session, providers) }
      : result;
  });
  handle(IPC.invoke.sessionOpenFolder, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    const sessionId = String(id ?? "").trim();
    if (!sessionId) {
      throw Object.assign(new Error("sessionId required"), {
        errorCode: ErrorCodes.INVALID_ARGUMENT,
      });
    }
    // Resolve the folder in main from the session record so the renderer
    // never passes a raw filesystem path over IPC.
    const res = await host.call<{
      session?: { projectPath?: string } | null;
    }>("session.get", { id: sessionId });
    if (!res.session) {
      throw Object.assign(new Error("session not found"), {
        errorCode: ErrorCodes.NOT_FOUND,
      });
    }
    const projectPath = res.session.projectPath?.trim();
    // Project sessions open their project folder; temporary sessions open
    // the per-session scratch dir (D114), created on demand so the folder
    // opens even before the agent has written anything there.
    const target = projectPath || join(dataDir, "scratch", sessionId);
    if (!projectPath) mkdirSync(target, { recursive: true });
    if (!existsSync(target)) {
      throw Object.assign(new Error("folder not found"), {
        errorCode: ErrorCodes.NOT_FOUND,
      });
    }
    const openError = await shell.openPath(target);
    if (openError) throw new Error(openError);
    return { ok: true, path: target };
  });
  handle(IPC.invoke.sessionDelete, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    const res = await host.call("session.delete", { id });
    // Drop the session's pi-agent so a later session with the same id (or a
    // stale runtime) can't answer with this session's context.
    if (sidecar) {
      await sidecar
        .call("agent.disposeSession", { sessionId: id })
        .catch(() => undefined);
    }
    logger.app("info", "session deleted", { sessionId: id });
    return res;
  });
  handle(IPC.invoke.sessionRename, async (id: string, title: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("session.rename", { id, title });
  });
  handle(
    IPC.invoke.sessionReplaceMessages,
    async (input: { sessionId: string; messages: unknown[] }) => {
      if (!host) throw new Error("host unavailable");
      const sessionId = String(input?.sessionId || "");
      if (!sessionId) throw new Error("sessionId required");
      // Drop the live pi-agent so the next prompt reseeds from the truncated
      // transcript instead of replaying the discarded branch in memory.
      if (sidecar) {
        await sidecar
          .call("agent.disposeSession", { sessionId })
          .catch(() => undefined);
      }
      return host.call("session.replaceMessages", {
        sessionId,
        messages: input.messages ?? [],
      });
    },
  );
  handle(
    IPC.invoke.sessionSaveRevision,
    async (input: {
      sessionId: string;
      rootUserId: string;
      messages: unknown[];
      makeActive?: boolean;
    }) => {
      if (!host) throw new Error("host unavailable");
      return host.call("session.saveRevision", {
        sessionId: String(input?.sessionId || ""),
        rootUserId: String(input?.rootUserId || ""),
        messages: input?.messages ?? [],
        makeActive: input?.makeActive === true,
      });
    },
  );
  handle(
    IPC.invoke.sessionListRevisions,
    async (input: { sessionId: string; rootUserId: string }) => {
      if (!host) throw new Error("host unavailable");
      return host.call("session.listRevisions", {
        sessionId: String(input?.sessionId || ""),
        rootUserId: String(input?.rootUserId || ""),
      });
    },
  );
  handle(
    IPC.invoke.sessionActivateRevision,
    async (input: {
      sessionId: string;
      rootUserId: string;
      revisionIndex: number;
      prefix?: unknown[];
    }) => {
      if (!host) throw new Error("host unavailable");
      const sessionId = String(input?.sessionId || "");
      if (sidecar) {
        await sidecar
          .call("agent.disposeSession", { sessionId })
          .catch(() => undefined);
      }
      return host.call("session.activateRevision", {
        sessionId,
        rootUserId: String(input?.rootUserId || ""),
        revisionIndex: Number(input?.revisionIndex || 0),
        prefix: input?.prefix ?? [],
      });
    },
  );
  handle(
    IPC.invoke.sessionConfigure,
    async (
      id: string,
      config: {
        mode: "chat" | "agent";
        providerId?: string;
        modelId?: string;
        thinkingLevel?: ThinkingLevel;
        permissionMode?: "inherit" | "ask" | "accept-edits" | "auto";
      },
    ) => {
      if (!host) throw new Error("host unavailable");
      const result = await host.call<{ session?: RuntimeSession | null }>(
        "session.configure",
        { id, ...config },
      );
      if (!result.session) return result;
      const providers = await listRuntimeProviders();
      return { ...result, session: enrichSession(result.session, providers) };
    },
  );

  handle(IPC.invoke.sessionImportScan, async () => {
    const sessions = await scanAllSources();
    scannedImportSessions = new Map(
      sessions.map((session) => [`${session.source}:${session.externalId}`, session]),
    );
    return {
      sessions: sessions.map(({ filePath: _filePath, ...candidate }) => candidate),
    };
  });
  handle(
    IPC.invoke.sessionImportRun,
    async (selections: unknown) => {
      if (!host) throw new Error("host unavailable");
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const items = Array.isArray(selections) ? selections : [];
      for (const selection of items) {
        const key = importSelectionKey(selection);
        const item = key ? scannedImportSessions.get(key) : undefined;
        if (!item) {
          failed += 1;
          logger.app("warn", "session import selection rejected", {
            data: { reason: "candidate was not returned by the latest scan" },
          });
          continue;
        }
        try {
          const converted = await convertSession(item);
          const res = await host.call<{ imported?: boolean }>("session.import", {
            session: converted.session,
            messages: converted.messages,
          });
          if (res.imported) imported += 1;
          else skipped += 1;
        } catch (e) {
          failed += 1;
          logger.app("warn", "session import failed", {
            data: { source: item?.source, externalId: item?.externalId, error: String(e) },
          });
        }
      }
      logger.app("info", "session import finished", {
        data: { imported, skipped, failed },
      });
      return { imported, skipped, failed };
    },
  );

  handle(IPC.invoke.settingsGet, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("settings.get");
  });
  handle(IPC.invoke.settingsSet, async (settings: unknown) => {
    if (!host) throw new Error("host unavailable");
    const result = await host.call("settings.set", settings);
    applyApplicationMenuSettings(
      settings as {
        language?: unknown;
        keybindings?: unknown;
        developerMode?: unknown;
      } | null,
    );
    applyDeveloperMode(settings as { developerMode?: unknown } | null);
    return result;
  });

  handle(IPC.invoke.providersList, async () => {
    return enrichProviderList({ providers: await listRuntimeProviders() });
  });
  handle(IPC.invoke.providersCreate, async (input: unknown) => {
    if (!host) throw new Error("host unavailable");
    const result = await host.call<{ provider: RuntimeProvider }>(
      "providers.create",
      input,
    );
    return { ...result, provider: enrichProvider(result.provider) };
  });
  handle(IPC.invoke.providersUpdate, async (input: unknown) => {
    if (!host) throw new Error("host unavailable");
    const result = await host.call<{ provider?: RuntimeProvider | null }>(
      "providers.update",
      input,
    );
    return result.provider
      ? { ...result, provider: enrichProvider(result.provider) }
      : result;
  });
  handle(IPC.invoke.providersDelete, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("providers.delete", { id });
  });
  handle(IPC.invoke.providersTest, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    // Config-level validation first (secret present etc.)
    const local = await host.call<{ ok: boolean; message?: string }>(
      "providers.testConnection",
      { id },
    );
    if (!local.ok) return { ...local, network: "skipped" };
    const detail = await host.call<{ provider?: { baseUrl?: string; authKind?: string } }>(
      "providers.get",
      { id },
    );
    const baseUrl = detail.provider?.baseUrl;
    if (!baseUrl) return { ...local, network: "skipped" };
    const secret = await host.call<{ value?: string }>("providers.getSecret", { id });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: secret.value ? { Authorization: `Bearer ${secret.value}` } : {},
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          network: "failed",
          status: res.status,
          errorCode: ErrorCodes.PROVIDER_UNAUTHORIZED,
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          network: "failed",
          status: res.status,
          errorCode: ErrorCodes.PROVIDER_RATE_LIMITED,
        };
      }
      return { ok: res.ok, network: res.ok ? "ok" : "failed", status: res.status };
    } catch (e) {
      return {
        ok: false,
        network: "failed",
        errorCode: ErrorCodes.TIMEOUT,
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  });
  handle(
    IPC.invoke.providersListModels,
    async (
      input?:
        | string
          | {
            providerId?: string;
            baseUrl?: string;
            apiKey?: string;
            apiStyle?: string;
            source?: "cache" | "refresh";
          },
    ) => {
      if (!host) throw new Error("host unavailable");
      const req = typeof input === "string" ? { providerId: input } : input ?? {};
      const providers = await listRuntimeProviders();
      const provider = req.providerId
        ? providers.find((p) => p.id === req.providerId)
        : undefined;
      const baseUrl = (req.baseUrl ?? provider?.baseUrl ?? "").trim();
      const apiStyle = req.apiStyle ?? provider?.apiStyle ?? "chat_completions";
      const decorate = (model: {
        modelId: string;
        displayName: string;
        capabilities?: string[];
        contextWindow?: number;
        source?: "bundled" | "discovered" | "user";
      }) => {
        const capabilities = new Set(model.capabilities ?? ["text"]);
        capabilities.add("text");
        const thinking = resolveThinkingCapabilities({
          vendorKey: provider?.vendorKey || "custom",
          modelId: model.modelId,
          apiStyle,
        });
        if (thinking.supportsReasoning) capabilities.add("reasoning");
        else capabilities.delete("reasoning");
        return {
          modelId: model.modelId,
          displayName: model.displayName,
          providerId: provider?.id ?? "",
          contextWindow: model.contextWindow,
          capabilities: [...capabilities],
          supportedThinkingLevels: thinking.supportedThinkingLevels,
          source: model.source ?? ("discovered" as const),
        };
      };

      if (req.source === "cache" && provider) {
        const cached = await host.call<{
          models: Array<{
            modelId: string;
            displayName: string;
            capabilities?: string[];
            contextWindow?: number;
            source?: "bundled" | "discovered" | "user";
          }>;
        }>("providers.listModels", { providerId: provider.id });
        if (cached.models.length > 0) {
          return { models: cached.models.map(decorate), source: "cache" as const };
        }
        const fallback = provider.defaultModelId
          ? [decorate({
              modelId: provider.defaultModelId,
              displayName: provider.defaultModelId,
              source: "user",
            })]
          : [];
        return { models: fallback, source: "fallback" as const };
      }

      // Dialog edits can omit the key to reuse the stored secret; the raw key
      // never travels back to the renderer either way.
      let apiKey = req.apiKey ?? "";
      if (!apiKey && provider) {
        const secret = await host.call<{ value?: string }>("providers.getSecret", {
          id: provider.id,
        });
        apiKey = secret.value ?? "";
      }
      let discoveryError: string | undefined;
      if (baseUrl) {
        try {
          const discovered = await discoverProviderModels({ baseUrl, apiKey, apiStyle });
          if (discovered.length > 0) {
            const models = discovered.map(decorate);
            const savedBaseUrl = (provider?.baseUrl ?? "").trim().replace(/\/+$/, "");
            const requestBaseUrl = baseUrl.replace(/\/+$/, "");
            const usesSavedEndpoint =
              !!provider &&
              requestBaseUrl === savedBaseUrl &&
              apiStyle === (provider.apiStyle ?? "chat_completions");
            if (usesSavedEndpoint) {
              try {
                const latestProvider = (await listRuntimeProviders()).find(
                  (candidate) => candidate.id === provider.id,
                );
                const endpointStillCurrent =
                  (latestProvider?.baseUrl ?? "").trim().replace(/\/+$/, "") ===
                    requestBaseUrl &&
                  (latestProvider?.apiStyle ?? "chat_completions") === apiStyle;
                if (endpointStillCurrent) {
                  await host.call("providers.cacheModels", {
                    providerId: provider.id,
                    models,
                  });
                }
              } catch (e) {
                logger.app("warn", "model cache update failed", {
                  data: {
                    providerId: provider.id,
                    error: e instanceof Error ? e.message : String(e),
                  },
                });
              }
            }
            return { models, source: "remote" as const };
          }
        } catch (e) {
          discoveryError = e instanceof Error ? e.message : String(e);
          logger.app("warn", "model discovery failed", {
            data: { providerId: provider?.id, error: discoveryError },
          });
        }
      }
      // Fallback: the provider's configured model, so pickers stay usable
      // for gateways without a /models endpoint.
      const fallback = provider?.defaultModelId
        ? [decorate({ modelId: provider.defaultModelId, displayName: provider.defaultModelId })]
        : [];
      return { models: fallback, source: "fallback", error: discoveryError };
    },
  );

  // Secret material never crosses to the renderer: set/delete/has only.
  handle(IPC.invoke.secretsSet, async (input: { secretRef: string; value: string }) => {
    if (!host) throw new Error("host unavailable");
    return host.call("secrets.set", {
      secretRef: input?.secretRef,
      value: input?.value,
    });
  });
  handle(IPC.invoke.secretsDelete, async (secretRef: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("secrets.delete", { secretRef });
  });
  handle(IPC.invoke.secretsHas, async (secretRef: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("secrets.has", { secretRef });
  });

  handle(IPC.invoke.projectGet, async () => {
    if (!host) throw new Error("host unavailable");
    let res = (await host.call("workspace.get")) as {
      workspace: { path: string; name: string } | null;
    };
    // Dev convenience only: never auto-open the app bundle directory as the
    // workspace in a packaged build.
    const seed =
      process.env.PI_DESKTOP_SEED_WORKSPACE ||
      process.env.PI_DESKTOP_WORKSPACE ||
      (isDevelopmentBuild ? join(__dirname, "../../..") : "");
    if (!res.workspace && seed) {
      try {
        res = (await host.call("workspace.set", { path: seed })) as {
          workspace: { path: string; name: string } | null;
        };
      } catch {
        // ignore seed failures
      }
    }
    return { workspace: await withGitBranch(res.workspace) };
  });
  handle(IPC.invoke.projectList, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("projects.list");
  });
  handle(IPC.invoke.projectOpen, async () => {
    if (!host) throw new Error("host unavailable");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { workspace: null, canceled: true };
    }
    const res = (await host.call("workspace.set", {
      path: result.filePaths[0],
    })) as { workspace: { path: string; name: string } | null };
    return { workspace: await withGitBranch(res.workspace), canceled: false };
  });
  handle(IPC.invoke.projectSet, async (path: string) => {
    if (!host) throw new Error("host unavailable");
    const res = (await host.call("workspace.set", { path })) as {
      workspace: { path: string; name: string } | null;
    };
    return { workspace: await withGitBranch(res.workspace) };
  });
  handle(IPC.invoke.projectClear, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("workspace.clear");
  });

  handle(IPC.invoke.composerPickFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (result.canceled) return { paths: [] as string[], canceled: true };
    return { paths: result.filePaths, canceled: false };
  });

  handle(IPC.invoke.composerPickPhotos, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff"] },
      ],
    });
    if (result.canceled) return { paths: [] as string[], canceled: true };
    return { paths: result.filePaths, canceled: false };
  });

  handle(IPC.invoke.workspaceDiff, async () => {
    if (!host) throw new Error("host unavailable");
    const res = (await host.call("workspace.get")) as {
      workspace: { path: string } | null;
    };
    const cwd = res.workspace?.path;
    if (!cwd) {
      return { repo: false, clean: true, files: [] };
    }
    return collectWorkspaceDiff(cwd);
  });

  handle(
    IPC.invoke.terminalCreate,
    async (input: { cwd?: string; cols?: number; rows?: number } = {}) => {
      if (!host) throw new Error("host unavailable");
      const res = (await host.call("workspace.get")) as {
        workspace: { path: string } | null;
      };
      // The workspace root is the only allowed cwd: the renderer's value is
      // advisory and never trusted with arbitrary paths.
      const cwd = res.workspace?.path;
      if (!cwd || (input.cwd && input.cwd !== cwd)) {
        throw Object.assign(new Error("workspace required"), {
          errorCode: ErrorCodes.INVALID_ARGUMENT,
        });
      }
      const created = await ptys.create({
        cwd,
        cols: input.cols,
        rows: input.rows,
      });
      logger.app("info", "terminal session attached", {
        data: { termId: created.termId },
      });
      return created;
    },
  );

  handle(IPC.invoke.terminalWrite, async (input: { termId: string; data: string }) => {
    ptys.write(String(input?.termId ?? ""), String(input?.data ?? ""));
    return { ok: true };
  });

  handle(
    IPC.invoke.terminalResize,
    async (input: { termId: string; cols: number; rows: number }) => {
      ptys.resize(String(input?.termId ?? ""), Number(input?.cols), Number(input?.rows));
      return { ok: true };
    },
  );

  handle(IPC.invoke.terminalDispose, async (input: { termId: string }) => {
    ptys.dispose(String(input?.termId ?? ""));
    return { ok: true };
  });

  handle(IPC.invoke.browserNavigate, async (input: { url?: string } = {}) => {
    // Workspace root gates file previews (agent-generated HTML); http(s)
    // navigation works without a workspace.
    let root: string | null = null;
    try {
      const res = (await host?.call("workspace.get")) as
        | { workspace: { path: string } | null }
        | undefined;
      root = res?.workspace?.path ?? null;
    } catch {
      root = null;
    }
    return browserPane.navigate(String(input.url ?? ""), root);
  });

  handle(IPC.invoke.browserAction, async (input: { action?: string } = {}) => {
    const action = String(input.action ?? "");
    if (
      action === "back" ||
      action === "forward" ||
      action === "reload" ||
      action === "stop"
    ) {
      browserPane.action(action);
    }
    return { ok: true };
  });

  handle(
    IPC.invoke.browserSetBounds,
    async (bounds: { x: number; y: number; width: number; height: number }) => {
      browserPane.setBounds(bounds ?? { x: 0, y: 0, width: 0, height: 0 });
      return { ok: true };
    },
  );

  handle(IPC.invoke.browserSetVisible, async (input: { visible?: boolean } = {}) => {
    browserPane.setVisible(input.visible === true);
    return { ok: true };
  });

  handle(IPC.invoke.browserOpenExternal, async () => {
    browserPane.openExternal();
    return { ok: true };
  });

  handle(IPC.invoke.browserGetState, async () => {
    return browserPane.getState();
  });

  const requireWorkspaceRoot = async () => {
    if (!host) throw new Error("host unavailable");
    const res = (await host.call("workspace.get")) as {
      workspace: { path: string } | null;
    };
    const root = res.workspace?.path;
    if (!root) {
      throw Object.assign(new Error("workspace required"), {
        errorCode: ErrorCodes.INVALID_ARGUMENT,
      });
    }
    return root;
  };

  handle(IPC.invoke.fsList, async (input: { path?: string } = {}) => {
    const root = await requireWorkspaceRoot();
    return { entries: await listDir(root, String(input.path ?? "")) };
  });

  handle(IPC.invoke.fsRead, async (input: { path?: string } = {}) => {
    const root = await requireWorkspaceRoot();
    return readWorkspaceFile(root, String(input.path ?? ""));
  });

  handle(IPC.invoke.fsReveal, async (input: { path?: string } = {}) => {
    const root = await requireWorkspaceRoot();
    const target = resolveWithinRoot(root, String(input.path ?? ""));
    if (!target) {
      throw Object.assign(new Error("path escapes workspace root"), {
        errorCode: ErrorCodes.INVALID_ARGUMENT,
      });
    }
    shell.showItemInFolder(target);
    return { ok: true };
  });

  // Composer input APIs (D123/D124, ADR 0024). Both fail soft: the menus
  // simply have less to show when the workspace or host is unavailable.
  const optionalWorkspaceRoot = async (): Promise<string | null> => {
    try {
      return await requireWorkspaceRoot();
    } catch {
      return null;
    }
  };

  let composerTemplateCache: {
    key: string;
    at: number;
    templates: ComposerTemplate[];
  } | null = null;
  const loadComposerTemplatesCached = async (
    root: string | null,
  ): Promise<ComposerTemplate[]> => {
    const key = root ?? "";
    const now = Date.now();
    if (
      composerTemplateCache &&
      composerTemplateCache.key === key &&
      now - composerTemplateCache.at < 5000
    ) {
      return composerTemplateCache.templates;
    }
    const { templates, diagnostics } = await loadComposerTemplates(root);
    for (const diagnostic of diagnostics) {
      logger.app("warn", "composer template diagnostic", { data: diagnostic });
    }
    composerTemplateCache = { key, at: now, templates };
    return templates;
  };

  handle(IPC.invoke.fsIndex, async () => {
    const root = await optionalWorkspaceRoot();
    if (!root) return { entries: [], truncated: false };
    return getWorkspaceFileIndex(root);
  });

  handle(IPC.invoke.composerCommands, async () => {
    const root = await optionalWorkspaceRoot();
    const templates = await loadComposerTemplatesCached(root).catch(() => []);
    const templateCommands = templates.map((template) => ({
      name: template.name,
      kind: "template" as const,
      title: template.name,
      ...(template.description ? { description: template.description } : {}),
      ...(template.argumentHint ? { argumentHint: template.argumentHint } : {}),
      source: template.source,
    }));
    const pluginCommands = plugins.getCommands().map((command) => ({
      name: command.id,
      kind: "plugin" as const,
      title: command.title,
      ...(command.category ? { description: command.category } : {}),
      id: command.id,
    }));
    // One namespace: builtin aliases win, then project templates, then user
    // templates, then plugin commands (spec 04 §7).
    const merged = new Map<
      string,
      ReturnType<typeof builtinComposerCommands>[number]
    >();
    for (const command of [
      ...builtinComposerCommands(),
      ...templateCommands,
      ...pluginCommands,
    ]) {
      if (!merged.has(command.name)) merged.set(command.name, command);
    }
    return { commands: [...merged.values()] };
  });

  // Grow/shrink the window horizontally, keeping the left edge anchored so
  // the chat column keeps its width when the work panel opens. Returns the
  // delta actually applied (0 when maximized/fullscreen or out of room).
  handle(
    IPC.invoke.windowResizeBy,
    async (input: { deltaWidth?: number } = {}) => {
      const delta = Math.trunc(Number(input.deltaWidth ?? 0));
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        !Number.isFinite(delta) ||
        delta === 0 ||
        mainWindow.isFullScreen() ||
        mainWindow.isMaximized()
      ) {
        return { applied: 0 };
      }
      const bounds = mainWindow.getBounds();
      const workArea = screen.getDisplayMatching(bounds).workArea;
      const [minWidth] = mainWindow.getMinimumSize();
      let width = Math.max(minWidth || 1040, bounds.width + delta);
      let x = bounds.x;
      const workRight = workArea.x + workArea.width;
      if (x + width > workRight) {
        x = Math.max(workArea.x, workRight - width);
        width = Math.min(width, workRight - x);
      }
      mainWindow.setBounds({ x, y: bounds.y, width, height: bounds.height }, false);
      const applied = width - bounds.width;
      panelWindowWidthOffset = Math.max(0, panelWindowWidthOffset + applied);
      return { applied };
    },
  );


  // Custom window-chrome buttons on Windows/Linux (renderer-drawn).
  handle(
    IPC.invoke.windowControl,
    async (input: { action?: string } = {}) => {
      if (
        !input.action ||
        !WINDOW_CONTROL_ACTIONS.includes(input.action as WindowControlAction)
      ) {
        throw new Error("unsupported window control action");
      }
      if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false };
      const window = mainWindow;
      switch (input.action as WindowControlAction) {
        case "getState":
          break;
        case "minimize":
          window.minimize();
          break;
        case "toggleMaximize":
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          break;
        case "close":
          window.close();
          break;
      }
      return {
        maximized: !window.isDestroyed() && window.isMaximized(),
      };
    },
  );

  ipcMain.handle(IPC.invoke.menuRendererReady, async (event) =>
    wrap(async () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window !== mainWindow || !markMenuRendererReady(window)) {
        throw new Error("menu renderer is not attached to the main window");
      }
      return { ready: true };
    }),
  );

  handle(
    IPC.invoke.nativeMenuAction,
    async (input: { action?: string } = {}) => {
      if (
        !input.action ||
        !NATIVE_MENU_ACTIONS.includes(input.action as NativeMenuAction)
      ) {
        throw new Error("unsupported native menu action");
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { maximized: false, fullScreen: false };
      }

      const window = mainWindow;
      const action = input.action as NativeMenuAction;
      const contents = window.webContents;
      switch (action) {
        case "undo":
          contents.undo();
          break;
        case "redo":
          contents.redo();
          break;
        case "cut":
          contents.cut();
          break;
        case "copy":
          contents.copy();
          break;
        case "paste":
          contents.paste();
          break;
        case "selectAll":
          contents.selectAll();
          break;
        case "reload":
          contents.reload();
          break;
        case "zoomIn":
          contents.setZoomFactor(Math.min(3, contents.getZoomFactor() * 1.1));
          break;
        case "zoomOut":
          contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() / 1.1));
          break;
        case "resetZoom":
          contents.setZoomFactor(1);
          break;
        case "toggleFullScreen":
          window.setFullScreen(!window.isFullScreen());
          break;
        case "minimize":
          window.minimize();
          break;
        case "toggleMaximize":
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          break;
        case "close":
          window.close();
          break;
      }

      return {
        maximized: !window.isDestroyed() && window.isMaximized(),
        fullScreen: !window.isDestroyed() && window.isFullScreen(),
      };
    },
  );

  handle(IPC.invoke.pullsList, async () => {
    if (!host) throw new Error("host unavailable");
    const res = (await host.call("workspace.get")) as {
      workspace: { path: string; name: string } | null;
    };
    const cwd = res.workspace?.path;
    if (!cwd) {
      return { pulls: [], error: "NO_WORKSPACE" as const };
    }
    const { spawn } = await import("node:child_process");
    const run = (cmd: string, args: string[]) =>
      new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(cmd, args, { cwd, env: process.env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += String(d)));
        child.stderr.on("data", (d) => (stderr += String(d)));
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
        child.on("error", (err) =>
          resolve({ code: 1, stdout: "", stderr: String(err) }),
        );
      });
    const result = await run("gh", [
      "pr",
      "list",
      "--limit",
      "30",
      "--json",
      "number,title,url,author,headRefName,baseRefName,updatedAt,isDraft",
    ]);
    if (result.code !== 0) {
      return {
        pulls: [],
        error: result.stderr.trim() || result.stdout.trim() || "GH_FAILED",
      };
    }
    try {
      const pulls = JSON.parse(result.stdout || "[]") as Array<Record<string, unknown>>;
      return {
        pulls: pulls.map((p) => ({
          number: Number(p.number),
          title: String(p.title || ""),
          url: String(p.url || ""),
          author:
            typeof p.author === "object" && p.author
              ? String((p.author as any).login || "")
              : undefined,
          headRefName: p.headRefName ? String(p.headRefName) : undefined,
          baseRefName: p.baseRefName ? String(p.baseRefName) : undefined,
          updatedAt: p.updatedAt ? String(p.updatedAt) : undefined,
          isDraft: Boolean(p.isDraft),
        })),
      };
    } catch (e) {
      return { pulls: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle(IPC.invoke.scheduledList, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("scheduled.list");
  });
  handle(IPC.invoke.scheduledCreate, async (input: any = {}) => {
    if (!host) throw new Error("host unavailable");
    const prompt = String(input.prompt || "").trim();
    if (!prompt) throw new Error("prompt required");
    return host.call("scheduled.create", { ...input, prompt });
  });
  handle(IPC.invoke.scheduledUpdate, async (input: any = {}) => {
    if (!host) throw new Error("host unavailable");
    return host.call("scheduled.update", input);
  });
  handle(IPC.invoke.scheduledDelete, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    return host.call("scheduled.delete", { id });
  });
  handle(IPC.invoke.scheduledRun, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    const res = await host.call<{
      sessionId: string;
      prompt: string;
      task: unknown;
      runId: string;
    }>("scheduled.run", { id });
    // The renderer sends the prompt through the normal agent path; remember
    // the run so agent_end can close it via scheduled.finishRun.
    scheduledRunsBySession.set(res.sessionId, res.runId);
    return res;
  });

  handle(IPC.invoke.agentPrompt, async (req: {
    sessionId: string;
    content: string;
    truncateBefore?: number;
  }) => {
    if (!host || !sidecar) throw new Error("backend unavailable");
    const settings = await host.call<any>("settings.get");
    const sessionResult = await host.call<{ session?: any }>("session.get", {
      id: req.sessionId,
    });
    let session = sessionResult.session;
    if (!session) {
      throw Object.assign(new Error("Session not found"), {
        errorCode: ErrorCodes.NOT_FOUND,
      });
    }
    if (
      typeof req.truncateBefore === "number" &&
      Number.isFinite(req.truncateBefore) &&
      req.truncateBefore >= 0
    ) {
      const all = Array.isArray(session.messages) ? session.messages : [];
      const cut = Math.floor(req.truncateBefore);
      const kept = all.slice(0, cut);
      const discarded = all.slice(cut);
      // ChatGPT-style regenerate history: archive the discarded branch under
      // its root user turn before truncating the live transcript.
      const rootUser = discarded.find(
        (message: any) => message?.role === "user" && message?.id,
      );
      if (rootUser && discarded.length > 0) {
        try {
          // Prefer an existing revision-family key so regenerates keep one
          // linear variant set instead of forking a new root on every redo.
          const stableRootUserId =
            typeof rootUser.revisionRootId === "string" && rootUser.revisionRootId
              ? rootUser.revisionRootId
              : rootUser.id;
          const listed = await host.call<{ revisions?: Array<{ revisionIndex: number }> }>(
            "session.listRevisions",
            { sessionId: req.sessionId, rootUserId: stableRootUserId },
          );
          const existing = listed.revisions ?? [];
          // First regenerate only: the original live tail is not stored yet.
          // Later regenerates already persisted the active branch on agent_end,
          // so re-archiving here would duplicate variants.
          if (existing.length === 0) {
            await host.call("session.saveRevision", {
              sessionId: req.sessionId,
              rootUserId: stableRootUserId,
              messages: discarded,
              makeActive: false,
            });
          }
          const revisions = await host.call<{ revisions?: Array<{ revisionIndex: number }> }>(
            "session.listRevisions",
            { sessionId: req.sessionId, rootUserId: stableRootUserId },
          );
          const count = revisions.revisions?.length ?? 0;
          // Stamp the upcoming user prompt with pager metadata after append.
          (req as any).__revisionMeta = {
            rootUserId: stableRootUserId,
            revisionCount: count + 1, // +1 for the branch about to be generated
            activeRevision: count + 1,
          };
        } catch (error) {
          logger.app("warn", "save regenerate revision failed", {
            sessionId: req.sessionId,
            data: String(error),
          });
          // Regenerate is destructive after this point. If the running host is
          // stale or revision persistence is unavailable, abort before
          // truncating the live transcript so the renderer can reload the
          // untouched branch.
          throw error;
        }
      }
      await host.call("session.replaceMessages", {
        sessionId: req.sessionId,
        messages: kept,
      });
      if (sidecar) {
        await sidecar
          .call("agent.disposeSession", { sessionId: req.sessionId })
          .catch(() => undefined);
      }
      const refreshed = await host.call<{ session?: any }>("session.get", {
        id: req.sessionId,
      });
      session = refreshed.session ?? { ...session, messages: kept };
    }
    const providers = await host.call<{ providers: RuntimeProvider[] }>(
      "providers.list",
      { includeDisabled: false },
    );
    const provider =
      providers.providers.find((p) => p.id === session.providerId) ||
      providers.providers.find((p) => p.id === settings.defaultProviderId) ||
      providers.providers.find((p) => p.hasSecret) ||
      providers.providers[0];
    if (!provider) {
      throw Object.assign(new Error("No provider configured"), {
        errorCode: ErrorCodes.MODEL_NOT_CONFIGURED,
      });
    }
    const secret = await host.call<{ value?: string }>("providers.getSecret", {
      id: provider.id,
    });
    if (!secret.value && provider.authKind !== "none") {
      throw Object.assign(new Error("Provider API key missing"), {
        errorCode: ErrorCodes.PROVIDER_SECRET_MISSING,
      });
    }
    const modelId =
      (provider.id === session.providerId ? session.modelId : undefined) ||
      (provider.id === settings.defaultProviderId
        ? settings.defaultModelId
        : undefined) ||
      provider.defaultModelId;
    if (!modelId) {
      throw Object.assign(new Error("No model selected for provider"), {
        errorCode: ErrorCodes.MODEL_NOT_CONFIGURED,
      });
    }
    const thinkingCapabilities = enrichProvider(provider, modelId);
    const thinkingLevel = clampThinkingLevel(
      thinkingCapabilities,
      normalizeThinkingLevel(session.thinkingLevel),
    );
    // Keep the sidecar catalog-free: main serializes pi-ai's complete model
    // record and the runtime only replaces connection identity. Unknown
    // free-form ids intentionally use the generic runtime fallback.
    const modelConfig = resolvePiModelConfig({
      vendorKey: provider.vendorKey || "custom",
      modelId,
      apiStyle: provider.apiStyle,
    });

    // Open a durable turn row, then persist the user message under it.
    const turn = await host
      .call<{ turnId: string }>("session.beginTurn", {
        sessionId: req.sessionId,
        providerId: provider.id,
        modelId,
      })
      .catch(() => null);
    if (turn) activeTurns.set(req.sessionId, turn.turnId);

    // Slash template expansion (D123, ADR 0024): templates expand before
    // persistence so reseed replays exactly what the model saw; the typed
    // form rides along as `command` for transcript display. Builtin/plugin
    // slash aliases never reach this channel, and unknown /names stay
    // literal text.
    let promptContent = req.content;
    let slashCommand: string | undefined;
    if (req.content.startsWith("/")) {
      try {
        const root = await optionalWorkspaceRoot();
        const templates = await loadComposerTemplatesCached(root);
        const expansion = expandSlashInvocation(req.content, templates);
        if (expansion) {
          promptContent = expansion.expanded;
          slashCommand = expansion.command;
        }
      } catch (error) {
        logger.app("warn", "slash expansion failed; sending literal text", {
          sessionId: req.sessionId,
          data: String(error),
        });
      }
    }

    // Persist user message
    const revisionMeta = (req as any).__revisionMeta as
      | {
          rootUserId?: string;
          revisionCount?: number;
          activeRevision?: number;
        }
      | undefined;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: promptContent,
      createdAt: new Date().toISOString(),
      status: "complete" as const,
      ...(slashCommand ? { command: slashCommand } : {}),
      ...(revisionMeta?.revisionCount
        ? {
            revisionRootId: revisionMeta.rootUserId,
            revisionCount: revisionMeta.revisionCount,
            activeRevision: revisionMeta.activeRevision,
          }
        : {}),
    };
    await host.call("session.appendMessage", {
      sessionId: req.sessionId,
      message: userMessage,
      turnId: turn?.turnId,
    });
    sendToRenderer(IPC.event.agentMessage, {
      sessionId: req.sessionId,
      ts: Date.now(),
      event: { type: "message_start", message: userMessage },
    } satisfies AgentEventEnvelope);
    sendToRenderer(IPC.event.agentMessage, {
      sessionId: req.sessionId,
      ts: Date.now(),
      event: { type: "message_end", message: userMessage },
    } satisfies AgentEventEnvelope);

    let result: { accepted: boolean; turnId: string };
    try {
      result = await sidecar.call<{ accepted: boolean; turnId: string }>(
        "agent.prompt",
        {
          sessionId: req.sessionId,
          content: promptContent,
          mode: session.mode || settings.defaultMode || "agent",
          thinkingLevel,
          // Per-session scratch dir for temp files (D114). Same layout as
          // host-core computes from its data dir; host-core is the enforcing
          // side, this only tells the model where scratch lives.
          scratchDir: join(dataDir, "scratch", req.sessionId),
          provider: {
            id: provider.id,
            name: provider.name,
            vendorKey: provider.vendorKey,
            baseUrl: provider.baseUrl,
            modelId,
            apiKey: secret.value || "",
            authKind: provider.authKind,
            apiStyle: provider.apiStyle,
            supportsReasoning: thinkingCapabilities.supportsReasoning,
            supportedThinkingLevels:
              thinkingCapabilities.supportedThinkingLevels,
            ...(modelConfig ? { modelConfig } : {}),
          },
          // Registered plugin agent tools join the model's toolset; execution
          // round-trips host -> main (plugins.execute) -> plugin JS.
          pluginTools: plugins.getTools().map((t) => ({
            name: t.fullName,
            description: t.description,
            parameters: t.schema ?? { type: "object", properties: {} },
          })),
        },
      );
    } catch (e) {
      void finishTurn(req.sessionId, "error", (e as any)?.errorCode);
      throw e;
    }
    logger.app("info", "prompt accepted", {
      sessionId: req.sessionId,
      turnId: result.turnId,
      data: { providerId: provider.id, modelId },
    });
    return result;
  });

  handle(IPC.invoke.agentAbort, async (req: { sessionId: string }) => {
    if (!sidecar) throw new Error("sidecar unavailable");
    logger.app("info", "prompt aborted", { sessionId: req.sessionId });
    const result = await sidecar.call("agent.abort", req);
    finishTurn(req.sessionId, "aborted");
    return result;
  });

  handle(IPC.invoke.agentGetStatus, async (sessionId: string) => {
    if (!sidecar) throw new Error("sidecar unavailable");
    return sidecar.call("agent.getStatus", { sessionId });
  });

  handle(IPC.invoke.toolResolvePermission, async (resolution: {
    requestId: string;
    decision: string;
  }) => {
    if (!host) throw new Error("host unavailable");
    logger.app("info", "permission resolved", {
      data: { requestId: resolution.requestId, decision: resolution.decision },
    });
    return host.call("permissions.resolve", resolution);
  });

  handle(IPC.invoke.pluginList, async () => {
    if (!host) throw new Error("host unavailable");
    return host.call("plugins.list");
  });

  handle(IPC.invoke.pluginLoadDev, async () => {
    if (!host) throw new Error("host unavailable");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    const path = result.filePaths[0];
    const loaded = await host.call<{ plugin: any }>("plugins.loadDev", { path });
    await plugins.loadFromPath(path);
    for (const toast of plugins.drainToasts()) {
      sendToRenderer(IPC.event.toast, { message: toast });
    }
    return loaded;
  });

  handle(IPC.invoke.pluginEnable, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    const res = await host.call<{ plugin: any }>("plugins.enable", { id });
    if (res.plugin?.path) await plugins.loadFromPath(res.plugin.path);
    logger.app("info", "plugin enabled", { pluginId: id });
    return res;
  });

  handle(IPC.invoke.pluginDisable, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    await plugins.unload(id);
    logger.app("info", "plugin disabled", { pluginId: id });
    return host.call("plugins.disable", { id });
  });

  handle(IPC.invoke.pluginUninstall, async (id: string) => {
    if (!host) throw new Error("host unavailable");
    await plugins.unload(id);
    logger.app("info", "plugin uninstalled", { pluginId: id });
    return host.call("plugins.uninstall", { id });
  });

  handle(IPC.invoke.commandPaletteSearch, async (query: string) => {
    const q = (query || "").toLowerCase();
    const builtin = builtinPaletteItems();
    const pluginCmds = plugins.getCommands().map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      keywords: c.keywords,
      source: "plugin" as const,
      pluginId: c.pluginId,
    }));
    return {
      commands: [...builtin, ...pluginCmds].filter((c) => {
        if (!q) return true;
        const hay = `${c.title} ${c.category ?? ""} ${(c as any).keywords?.join(" ") ?? ""}`.toLowerCase();
        return hay.includes(q);
      }),
    };
  });

  handle(IPC.invoke.commandPaletteExecute, async (commandId: string) => {
    if (commandId.startsWith("builtin.")) {
      return { ok: true, commandId };
    }
    const cmd = plugins.getCommands().find((c) => c.id === commandId);
    if (!cmd) throw new Error("command not found");
    await cmd.run();
    for (const toast of plugins.drainToasts()) {
      sendToRenderer(IPC.event.toast, { message: toast });
    }
    return { ok: true, commandId };
  });

  handle(IPC.invoke.logOpenFolder, async () => {
    const logs = join(dataDir, "logs");
    mkdirSync(logs, { recursive: true });
    await shell.openPath(logs);
    return { ok: true, path: logs };
  });

  handle(IPC.invoke.devtoolsToggle, async (input: unknown) => {
    if (!developerMode) throw new Error("developer mode is disabled");
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("window unavailable");
    }
    const contents = mainWindow.webContents;
    const desired = (input as { open?: unknown } | null)?.open;
    const open =
      typeof desired === "boolean" ? desired : !contents.isDevToolsOpened();
    if (open) contents.openDevTools({ mode: "detach" });
    else contents.closeDevTools();
    return { open };
  });
}

app.whenReady().then(async () => {
  applyDevelopmentBranding();
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: APP_VERSION,
    version: APP_VERSION,
  });
  installApplicationMenu({
    locale: app.getLocale(),
    dispatch: dispatchApplicationMenuCommand,
  });
  registerIpc();
  updater.startAutoCheck();
  let bootError: unknown = null;
  try {
    await bootBackends();
  } catch (e) {
    bootError = e;
    logger.app("error", "backend boot failed", {
      code: ErrorCodes.HOST_UNAVAILABLE,
      data: String(e),
    });
  }
  if (host) {
    try {
      const stored = (await host.call("settings.get")) as {
        language?: unknown;
        keybindings?: unknown;
        developerMode?: unknown;
      } | null;
      applyApplicationMenuSettings(stored);
      applyDeveloperMode(stored);
    } catch {
      // keep the OS-locale menu until settings can be read again
    }
  }
  await ensureWindow();
  // createWindow awaits the initial load (loadFile resolves on
  // did-finish-load), so the page is up; give React a beat to mount its
  // event subscriptions before pushing the boot outcome.
  setTimeout(() => {
    sendToRenderer(IPC.event.hostStatus, {
      ok: !bootError,
      ...(bootError
        ? { component: "host", fatal: true, message: String(bootError) }
        : {}),
    });
    applicationBooted = true;
    flushPendingApplicationMenuCommands();
  }, 300);

  // Headless boot probe for automated e2e (scripts/e2e-electron-boot.mjs):
  // verifies sandboxed preload bridge + a full IPC round-trip, then quits.
  if (process.env.PI_DESKTOP_BOOT_PROBE === "1") {
    setTimeout(() => {
      void (async () => {
        try {
          const probe = await mainWindow!.webContents.executeJavaScript(
            `(async () => {
               const api = window.piDesktop;
               if (!api || typeof api.invoke !== "function") {
                 return { ok: false, reason: "preload api missing" };
               }
               const version = await api.invoke(api.channels.invoke.appGetVersion);
               const windowState =
                 api.platform === "darwin"
                   ? null
                   : await api.invoke(api.channels.invoke.windowControl, {
                       action: "getState",
                     });
               return {
                 ok: version?.ok === true,
                 version: version?.data?.version,
                 hostProtocol: version?.data?.hostProtocolVersion,
                 platform: api.platform,
                 maximized: windowState?.data?.maximized ?? null,
               };
             })()`,
          );
          probe.appName = app.getName();
          probe.menuCount = Menu.getApplicationMenu()?.items.length ?? 0;
          console.log("BOOT_PROBE", JSON.stringify(probe));
        } catch (e) {
          console.log(
            "BOOT_PROBE",
            JSON.stringify({ ok: false, reason: String(e) }),
          );
        } finally {
          app.quit();
        }
      })();
    }, 800);
  }
  // Supervision probe (scripts/e2e-supervision.mjs): SIGKILL our own
  // host-core child, then assert the supervisor brings a fresh one back
  // that answers RPCs. Deterministic crash-recovery e2e without pid hunts.
  if (process.env.PI_DESKTOP_SUPERVISION_PROBE === "1") {
    const initialHost = host;
    setTimeout(() => {
      logger.app("info", "supervision probe: killing host-core");
      (initialHost as any)?.child?.kill("SIGKILL");
    }, 1500);
    const t0 = Date.now();
    const poll = setInterval(() => {
      void (async () => {
        if (Date.now() - t0 > 30_000) {
          clearInterval(poll);
          console.log(
            "SUPERVISION_PROBE",
            JSON.stringify({ ok: false, reason: "timeout" }),
          );
          app.quit();
          return;
        }
        if (!host || host === initialHost) return;
        try {
          const health = await host.call<{ ok: boolean }>("app.health");
          clearInterval(poll);
          console.log(
            "SUPERVISION_PROBE",
            JSON.stringify({ ok: health.ok === true, restarted: true }),
          );
          app.quit();
        } catch {
          // restart still settling; keep polling
        }
      })();
    }, 500);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  updater.dispose();
  logger.app("info", "app shutdown");
  ptys.disposeAll();
  browserPane.dispose();
  void host?.dispose();
  void sidecar?.dispose();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void ensureWindow();
});
