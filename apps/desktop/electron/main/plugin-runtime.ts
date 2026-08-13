import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  busTopicAllowed,
  isValidBusTopic,
  isValidBusTopicPattern,
  matchesBusTopic,
  parseSkillFrontmatter,
  pluginMcpToolKey,
  pluginSkillId,
  pluginThemeId,
  pluginToolName,
  resolveMcpRefs,
  sanitizeThemeCss,
  skillIdFromPath,
  validateManifest,
  validateMcpServer,
  type PluginManifest,
  type PluginNativeNotificationInput,
  type PluginNativeNotificationResult,
  type PluginNotificationPermission,
  type PluginServiceContrib,
  type PluginSkillContrib,
} from "@pi-desktop/plugin-sdk";
import type { PluginServiceStatus } from "@pi-desktop/shared";
import { McpServerClient, type McpServerClientOptions } from "./plugin-mcp";
import { DevPluginWatcher, type DevPluginWatcherDeps } from "./plugin-watcher";

export type RegisteredCommand = {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  pluginId: string;
  run: () => Promise<void>;
};

export type RegisteredPluginTool = {
  fullName: string;
  pluginId: string;
  name: string;
  description: string;
  risk?: string;
  schema?: unknown;
  execute: (args: unknown) => Promise<unknown>;
};

/**
 * A skill document a plugin taught the agent (spec 07 §3). Only the metadata
 * travels into the system prompt; the body is loaded on demand by the model.
 */
export type RegisteredPluginSkill = {
  /** `<pluginId>/<skillId>` — what the model passes to the Skill tool. */
  id: string;
  pluginId: string;
  skillId: string;
  name: string;
  description: string;
  /** Absolute path to the skill document inside the plugin directory. */
  path: string;
  bytes: number;
};

/**
 * A theme a plugin contributed (spec 07 §3). The CSS is read and sanitized once
 * at load time; the renderer injects the stored text verbatim.
 */
export type RegisteredPluginTheme = {
  /** `plugin:<pluginId>:<themeId>` — the value stored in `AppSettings.theme`. */
  id: string;
  pluginId: string;
  themeId: string;
  label: string;
  /** Palette the overrides layer on; drives `data-theme` in the renderer. */
  base: "light" | "dark";
  css: string;
};

export type PluginPanelRequest = {
  pluginId: string;
  title: string;
  width: number;
  height: number;
  htmlPath: string;
  /** Development panels show the host safe-area reminder in their chrome. */
  development?: boolean;
};

/** Transport to one plugin host process (ADR 0008). */
export type PluginProcessHandle = {
  postMessage: (message: unknown) => void;
  onMessage: (handler: (message: any) => void) => void;
  onExit: (handler: (code: number) => void) => void;
  onLog?: (handler: (level: string, message: string) => void) => void;
  kill: () => void;
};

export type PluginProcessSpawner = (options: {
  pluginId: string;
  entry: string;
  pluginPath: string;
}) => PluginProcessHandle | Promise<PluginProcessHandle>;

export type PluginHostServices = {
  getWorkspacePath: () => string | null;
  getLocale?: () => string;
  getAppVersion?: () => string;
  showToast: (message: string, level?: "info" | "warn" | "error") => void;
  notify: (input: { title: string; body?: string }) => void;
  getNotificationPermission: () => PluginNotificationPermission | Promise<PluginNotificationPermission>;
  requestNotificationPermission: () => Promise<PluginNotificationPermission>;
  showNativeNotification: (
    input: PluginNativeNotificationInput,
  ) => Promise<PluginNativeNotificationResult>;
  openExternal: (url: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  openPanel: (request: PluginPanelRequest) => Promise<void>;
  closePanel: (pluginId: string) => Promise<void>;
  fetch?: (input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }) => Promise<{ status: number; headers: Record<string, string>; bodyText: string }>;
  audit?: (entry: Record<string, unknown>) => void;
  /** Overrides the forked host-process entry; tests point this at the source file. */
  hostEntry?: string;
  /** Overrides how a plugin host process is created; defaults to Electron utilityProcess. */
  spawnProcess?: PluginProcessSpawner;
  /** Transport overrides for plugin-declared MCP servers; tests inject stubs. */
  mcp?: Pick<
    McpServerClientOptions,
    "spawnImpl" | "fetchImpl" | "connectTimeoutMs" | "callTimeoutMs"
  >;
  /** Fired when a plugin host process dies on its own (crash, OOM, hard exit). */
  onPluginCrash?: (info: { pluginId: string; name: string; exitCode: number }) => void;
  /** Fired when a resident service changes supervision state. */
  onServiceChange?: (status: PluginServiceStatus) => void;
  /** Fired after a development plugin was reloaded from disk, or failed to. */
  onPluginReloaded?: (info: {
    pluginId: string;
    name: string;
    ok: boolean;
    message?: string;
  }) => void;
};

/** Host APIs a plugin process may reach. Anything else does not exist (spec 04 §2). */
const HOST_API_ALLOWLIST = new Set([
  "app.getVersion",
  "app.getLocale",
  "plugin.getSettings",
  "plugin.setSettings",
  "plugin.getDataPath",
  "ui.openPanel",
  "ui.closePanel",
  "ui.showToast",
  "ui.notify",
  "ui.getNotificationPermission",
  "ui.requestNotificationPermission",
  "ui.showNativeNotification",
  "workspace.get",
  "fs.readText",
  "fs.writeText",
  "fs.glob",
  "fs.remove",
  "clipboard.readText",
  "clipboard.writeText",
  "shell.openExternal",
  "net.fetch",
  "bus.publish",
  "bus.subscribe",
  "bus.unsubscribe",
]);

/** Load must finish (module eval + onLoad) inside this budget. */
const PLUGIN_LOAD_TIMEOUT_MS = 15_000;
/** Lifecycle hooks time out per spec 05 §3. */
const PLUGIN_HOOK_TIMEOUT_MS = 5_000;
/** Command palette invocations are user-facing; fail fast. */
const PLUGIN_COMMAND_TIMEOUT_MS = 30_000;
/** Kept under host-core's 120s tool budget so the plugin-side error wins. */
const PLUGIN_TOOL_TIMEOUT_MS = 110_000;
/** Fixed panel operations are user-facing and must not hang the renderer. */
const PLUGIN_PANEL_TIMEOUT_MS = 30_000;
const PANEL_SKILL_CHANNELS = new Set([
  "skill.list",
  "skill.read",
  "skill.create",
  "skill.update",
  "skill.remove",
  "skill.setEnabled",
]);
/** A plugin may teach at most this many skills; the rest are ignored. */
const MAX_SKILLS_PER_PLUGIN = 32;
/** Skill documents above this size are refused (prompt budget, not disk). */
const MAX_SKILL_BYTES = 128 * 1024;
/** Catalog lines stay short — the body carries the detail. */
const MAX_SKILL_DESCRIPTION_CHARS = 240;
/** A plugin may contribute at most this many themes. */
const MAX_THEMES_PER_PLUGIN = 8;
/** A plugin may bring at most this many MCP servers. */
const MAX_MCP_SERVERS_PER_PLUGIN = 8;
/** A plugin may keep at most this many resident services alive. */
const MAX_SERVICES_PER_PLUGIN = 4;
/** A resident service starts inside the hook budget or is marked failed. */
const SERVICE_START_TIMEOUT_MS = PLUGIN_HOOK_TIMEOUT_MS;
/** Restart backoff: 1s, 2s, 4s … so a crash loop cannot busy-spin the app. */
const SERVICE_RESTART_BASE_MS = 1_000;
const SERVICE_RESTART_MAX_DELAY_MS = 30_000;
/** After this many failed restarts the plugin is left down for the user to fix. */
const MAX_SERVICE_RESTARTS = 5;
/** A host process that stays up this long is healthy; the backoff resets. */
const SERVICE_HEALTHY_MS = 60_000;
/** Bus payloads are messages, not file transfers. */
const MAX_BUS_PAYLOAD_BYTES = 64 * 1024;
/** A plugin may hold at most this many live subscriptions. */
const MAX_BUS_SUBSCRIPTIONS_PER_PLUGIN = 16;
/** Publish budget per plugin, so a hot loop cannot flood every other plugin. */
const MAX_BUS_PUBLISH_PER_WINDOW = 100;
const BUS_RATE_WINDOW_MS = 10_000;

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LoadedPlugin = {
  manifest: PluginManifest;
  path: string;
  development: boolean;
  permissions: Set<string>;
  child?: PluginProcessHandle;
  pending: Map<string, PendingCall>;
  nextCallId: number;
  disposing: boolean;
};

type PluginApiError = Error & { code?: string };

/** Crash-restart bookkeeping for one plugin's resident services. */
type RestartRecord = {
  attempts: number;
  /** Pending restart, so an explicit unload can cancel it. */
  timer?: ReturnType<typeof setTimeout>;
  /** Clears `attempts` once the process has stayed up long enough. */
  healthy?: ReturnType<typeof setTimeout>;
};

function apiError(code: string, message: string): PluginApiError {
  const err = new Error(message) as PluginApiError;
  err.code = code;
  return err;
}

/** Key for the per-service supervision map. */
function serviceStateKey(pluginId: string, serviceId: string): string {
  return `${pluginId}:${serviceId}`;
}

/** One live bus subscription; the handler itself lives in the plugin process. */
type BusSubscription = {
  id: string;
  pluginId: string;
  pattern: string;
};

/**
 * A runtime subscription is allowed when the manifest declared exactly that
 * pattern, or declared a wider one that covers it — narrowing `a.*` down to
 * `a.b` at runtime is fine, widening is not.
 */
function busSubscribeAllowed(declared: string[] | undefined, pattern: string): boolean {
  if (!declared?.length) return false;
  if (declared.includes(pattern)) return true;
  return isValidBusTopic(pattern) && busTopicAllowed(declared, pattern);
}

/**
 * Permissions a plugin directory currently declares. Throws on a manifest that
 * is missing or unparseable, which is what a reload wants: nothing is granted
 * against a manifest nobody can read.
 */
function readDeclaredPermissions(pluginPath: string): string[] {
  const manifestPath = join(pluginPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("PLUGIN_INVALID: manifest.json missing");
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  const declared = (raw as { permissions?: unknown }).permissions;
  if (!Array.isArray(declared)) return [];
  return declared.filter((entry): entry is string => typeof entry === "string");
}

function ensureWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw apiError("INVALID_ARGUMENT", "path escapes workspace root");
  }
  return resolved;
}

/**
 * Resolve a plugin-relative path, or null when it would leave the plugin
 * directory. Manifest validation already rejects `..`, so this is defense in
 * depth against symlinked or oddly-cased contributions.
 */
function resolveInsidePlugin(pluginPath: string, relative: string): string | null {
  const root = resolve(pluginPath);
  const target = resolve(root, relative);
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target !== root && target.startsWith(prefix) ? target : null;
}

/**
 * Minimal environment for a plugin process: the host's own env may carry
 * provider keys and shell secrets, and plugins have no business seeing them.
 */
function pluginProcessEnv(pluginId: string): Record<string, string> {
  const env: Record<string, string> = {
    PI_PLUGIN_ID: pluginId,
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const key of ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "LANG"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

/** Default spawner: an Electron utilityProcess per plugin. */
const spawnUtilityProcess: PluginProcessSpawner = async ({ pluginId, entry }) => {
  const { utilityProcess } = await import("electron");
  const child = utilityProcess.fork(entry, [], {
    serviceName: `pi-plugin-${pluginId.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    stdio: "pipe",
    env: pluginProcessEnv(pluginId),
  });
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (handler) => child.on("message", handler),
    onExit: (handler) => child.on("exit", (code) => handler(code ?? 0)),
    onLog: (handler) => {
      child.stdout?.on("data", (chunk: Buffer | string) => handler("info", String(chunk).trimEnd()));
      child.stderr?.on("data", (chunk: Buffer | string) => handler("error", String(chunk).trimEnd()));
    },
    kill: () => {
      child.kill();
    },
  };
};

export class PluginRuntime {
  private commands = new Map<string, RegisteredCommand>();
  private tools = new Map<string, RegisteredPluginTool>();
  private skills = new Map<string, RegisteredPluginSkill>();
  private themes = new Map<string, RegisteredPluginTheme>();
  private mcpClients = new Map<string, McpServerClient[]>();
  private serviceStates = new Map<string, PluginServiceStatus>();
  private restarts = new Map<string, RestartRecord>();
  private busSubscriptions = new Map<string, BusSubscription>();
  private busRate = new Map<string, { windowStart: number; count: number }>();
  private nextBusSubscription = 1;
  /** Plugins being reloaded by the supervisor; their backoff must survive. */
  private restarting = new Set<string>();
  private loaded = new Map<string, LoadedPlugin>();
  private toasts: Array<{ message: string; level?: string }> = [];
  private services: PluginHostServices;
  /**
   * Development plugins under watch, with the permission ceiling the user
   * approved when they picked the folder. Survives a failed reload so the fix
   * that follows a syntax error still gets picked up.
   */
  private devPlugins = new Map<string, { path: string; permissions: string[] }>();
  /** Plugin ids inside `reloadDevPlugin`, whose watch must outlive the unload. */
  private reloading = new Set<string>();
  private watcher: DevPluginWatcher;

  constructor(
    services?: Partial<PluginHostServices>,
    watcherOptions?: Pick<DevPluginWatcherDeps, "watch" | "debounceMs" | "max">,
  ) {
    this.services = {
      getWorkspacePath: () => null,
      showToast: (message, level) => {
        this.toasts.push({ message, level });
      },
      notify: (input) => {
        this.toasts.push({ message: `${input.title}${input.body ? `: ${input.body}` : ""}` });
      },
      getNotificationPermission: () => "unsupported",
      requestNotificationPermission: async () => "unsupported",
      showNativeNotification: async () => ({
        shown: false,
        permission: "unsupported",
      }),
      openExternal: async () => {
        throw apiError("UNSUPPORTED", "openExternal service missing");
      },
      readClipboard: async () => "",
      writeClipboard: async () => undefined,
      openPanel: async (request) => {
        this.toasts.push({ message: `Opened panel for ${request.pluginId}` });
      },
      closePanel: async () => undefined,
      ...services,
    };
    this.watcher = new DevPluginWatcher({
      ...watcherOptions,
      reload: (pluginId) => this.reloadDevPlugin(pluginId),
      onProblem: (pluginId, message) => {
        this.services.audit?.({
          pluginId,
          api: "plugin.watch.error",
          ok: false,
          message,
          ts: Date.now(),
        });
      },
    });
  }

  setServices(services: Partial<PluginHostServices>): void {
    this.services = { ...this.services, ...services };
  }

  getCommands(): RegisteredCommand[] {
    return [...this.commands.values()];
  }

  getTools(): RegisteredPluginTool[] {
    return [...this.tools.values()];
  }

  /** Catalog of active plugin skills, ordered by id for a stable prompt. */
  getSkills(): RegisteredPluginSkill[] {
    return [...this.skills.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Themes contributed by loaded plugins, ordered by id for a stable list. */
  getThemes(): RegisteredPluginTheme[] {
    return [...this.themes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Supervision state of every resident service, ordered for a stable list. */
  getServiceStates(): PluginServiceStatus[] {
    return [...this.serviceStates.values()].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.serviceId.localeCompare(b.serviceId),
    );
  }

  /**
   * Read one skill document on demand (the model asks for it by id through the
   * `Skill` tool). Front matter is stripped so the model sees instructions
   * only, and the size cap is re-checked because the file may have changed
   * since load.
   */
  loadSkillBody(id: string): { id: string; name: string; body: string } {
    const skill = this.skills.get(id);
    if (!skill) throw apiError("NOT_FOUND", `unknown skill: ${id}`);
    if (!this.loaded.has(skill.pluginId)) {
      throw apiError("NOT_FOUND", `plugin not loaded: ${skill.pluginId}`);
    }
    let raw: string;
    try {
      raw = readFileSync(skill.path, "utf8");
    } catch {
      throw apiError("NOT_FOUND", `skill document missing: ${id}`);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_SKILL_BYTES) {
      throw apiError("INVALID_ARGUMENT", `skill document too large: ${id}`);
    }
    const parsed = parseSkillFrontmatter(raw);
    if (!parsed.body) {
      throw apiError("INVALID_ARGUMENT", `skill document is empty: ${id}`);
    }
    this.services.audit?.({
      pluginId: skill.pluginId,
      api: "plugin.skill.load",
      ok: true,
      skillId: skill.id,
      ts: Date.now(),
    });
    return { id: skill.id, name: skill.name, body: parsed.body };
  }

  getLoaded(pluginId: string): LoadedPlugin | undefined {
    return this.loaded.get(pluginId);
  }

  listLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  drainToasts(): string[] {
    const t = this.toasts.map((x) => x.message);
    this.toasts = [];
    return t;
  }

  /**
   * Validate the manifest, start a dedicated host process and run `onLoad`
   * inside it. Contribution points arrive over RPC while `onLoad` runs; a
   * failure anywhere rolls the whole load back (spec 05 §7).
   */
  async loadFromPath(
    pluginPath: string,
    grantedPermissions?: string[],
    options: { development?: boolean } = {},
  ): Promise<PluginManifest> {
    const manifestPath = join(pluginPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("PLUGIN_INVALID: manifest.json missing");
    }
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const validated = validateManifest(raw);
    if (!validated.ok || !validated.manifest) {
      throw new Error(`PLUGIN_INVALID: ${validated.error}`);
    }
    const manifest = validated.manifest;
    await this.unload(manifest.id);

    const mainPath = join(pluginPath, manifest.main);
    if (!existsSync(mainPath)) {
      throw new Error("PLUGIN_LOAD_FAILED: main entry missing");
    }

    const declared = new Set(manifest.permissions ?? []);
    const granted = new Set(grantedPermissions ?? manifest.permissions ?? []);
    for (const perm of declared) {
      if (!granted.has(perm)) {
        // Install-time grants win; undeclared runtime use still fails later.
        granted.add(perm);
      }
    }

    const entry = this.services.hostEntry ?? join(__dirname, "plugin-host-process.js");
    const spawn = this.services.spawnProcess ?? spawnUtilityProcess;
    const child = await spawn({ pluginId: manifest.id, entry, pluginPath });

    const loaded: LoadedPlugin = {
      manifest,
      path: pluginPath,
      development: options.development ?? this.devPlugins.has(manifest.id),
      permissions: granted,
      child,
      pending: new Map(),
      nextCallId: 1,
      disposing: false,
    };
    this.loaded.set(manifest.id, loaded);

    child.onMessage((message) => this.handleChildMessage(loaded, message));
    child.onExit((code) => this.handleChildExit(loaded, code));
    child.onLog?.((level, message) => {
      if (!message) return;
      this.services.audit?.({
        pluginId: manifest.id,
        api: "plugin.stdio",
        level,
        message,
        ts: Date.now(),
      });
    });

    try {
      await this.sendToChild(
        loaded,
        {
          t: "init",
          pluginId: manifest.id,
          pluginPath,
          main: manifest.main,
          manifest,
        },
        PLUGIN_LOAD_TIMEOUT_MS,
      );
    } catch (error) {
      await this.unload(manifest.id);
      this.services.audit?.({
        pluginId: manifest.id,
        api: "plugin.load.error",
        ok: false,
        errorCode: (error as PluginApiError).code ?? "PLUGIN_LOAD_FAILED",
        ts: Date.now(),
      });
      throw error;
    }

    this.registerSkills(loaded);
    this.registerThemes(loaded);
    await this.registerMcpServers(loaded);
    await this.startServices(loaded);
    this.services.audit?.({
      pluginId: manifest.id,
      api: "plugin.load.success",
      ok: true,
      ts: Date.now(),
    });
    return manifest;
  }

  /** Deregister contributions, run `onUnload` in the child, then stop it. */
  async unload(pluginId: string): Promise<void> {
    const loaded = this.loaded.get(pluginId);
    if (loaded) {
      // An explicit stop ends supervision; a supervisor-driven reload keeps it.
      if (!this.restarting.has(pluginId)) this.cancelRestarts(pluginId);
      await this.stopServices(loaded);
    }
    if (loaded?.child) {
      loaded.disposing = true;
      try {
        await this.sendToChild(
          loaded,
          { t: "call", method: "lifecycle.unload", payload: {} },
          PLUGIN_HOOK_TIMEOUT_MS,
        );
      } catch {
        // A stuck or already-dead child must never block teardown.
      }
      this.rejectPending(loaded, apiError("PLUGIN_UNLOADED", `plugin unloaded: ${pluginId}`));
      try {
        loaded.child.kill();
      } catch {
        // Already gone.
      }
    }
    this.clearContributions(pluginId);
    this.loaded.delete(pluginId);
    // A reload unloads before it loads; its watch has to outlive that, and so
    // does the permission ceiling it reloads against.
    if (!this.reloading.has(pluginId)) {
      this.watcher.remove(pluginId);
      this.devPlugins.delete(pluginId);
    }
    await this.services.closePanel(pluginId);
    if (loaded) {
      this.services.audit?.({ pluginId, api: "plugin.unload", ok: true, ts: Date.now() });
    }
  }

  /**
   * Watch a loaded development plugin so source edits reload it in place.
   *
   * The permission set recorded here is the ceiling for every later reload:
   * grants were approved against the manifest as it looked when the user chose
   * the folder, and no file edit may widen them.
   */
  watchDevPlugin(pluginId: string): void {
    const loaded = this.loaded.get(pluginId);
    if (!loaded) return;
    this.devPlugins.set(pluginId, {
      path: loaded.path,
      permissions: [...loaded.permissions],
    });
    this.watcher.add(pluginId, loaded.path);
  }

  isWatchingDevPlugin(pluginId: string): boolean {
    return this.watcher.isWatching(pluginId);
  }

  /** Stop every watch; called on app quit alongside the other subsystems. */
  disposeWatchers(): void {
    this.watcher.disposeAll();
    this.devPlugins.clear();
  }

  /**
   * Re-run a watched development plugin from disk.
   *
   * A manifest that now declares permissions outside the recorded ceiling stops
   * here: hot reload must never widen a permission set behind the gateway. The
   * plugin stays watched either way, so the edit that fixes a broken reload is
   * picked up like any other.
   */
  async reloadDevPlugin(pluginId: string): Promise<void> {
    const dev = this.devPlugins.get(pluginId);
    if (!dev) return;
    const name = this.loaded.get(pluginId)?.manifest.name ?? pluginId;
    this.reloading.add(pluginId);
    try {
      const declared = readDeclaredPermissions(dev.path);
      const ceiling = new Set(dev.permissions);
      const added = declared.filter((permission) => !ceiling.has(permission));
      if (added.length) {
        throw new Error(
          `PERMISSION_DENIED: manifest now requests ${added.join(", ")}; load the plugin again to review`,
        );
      }
      // Grants follow the manifest downwards, never upwards: a permission the
      // author removed stops being available on the next reload.
      const manifest = await this.loadFromPath(dev.path, declared, { development: true });
      this.devPlugins.set(pluginId, { path: dev.path, permissions: dev.permissions });
      this.services.audit?.({
        pluginId,
        api: "plugin.reload.success",
        ok: true,
        ts: Date.now(),
      });
      this.services.onPluginReloaded?.({ pluginId, name: manifest.name, ok: true });
    } catch (error) {
      const message = (error as Error).message;
      this.services.audit?.({
        pluginId,
        api: "plugin.reload.error",
        ok: false,
        message,
        ts: Date.now(),
      });
      this.services.onPluginReloaded?.({ pluginId, name, ok: false, message });
    } finally {
      this.reloading.delete(pluginId);
    }
  }

  async invokePanelBridge(
    pluginId: string,
    channel: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const loaded = this.loaded.get(pluginId);
    if (!loaded) throw apiError("NOT_FOUND", `plugin not loaded: ${pluginId}`);
    if (PANEL_SKILL_CHANNELS.has(channel)) {
      return this.sendToChild(
        loaded,
        {
          t: "call",
          method: "panel.invoke",
          payload: { channel, payload: payload ?? {} },
        },
        PLUGIN_PANEL_TIMEOUT_MS,
      );
    }
    const api = this.hostApi(loaded);
    switch (channel) {
      case "ui.showToast":
        await api.ui.showToast(String(payload?.message ?? ""), payload?.level as any);
        return { ok: true };
      case "ui.notify":
        await api.ui.notify({
          title: String(payload?.title ?? "Plugin"),
          body: payload?.body ? String(payload.body) : undefined,
        });
        return { ok: true };
      case "ui.getNotificationPermission":
        return api.ui.getNotificationPermission();
      case "ui.requestNotificationPermission":
        return api.ui.requestNotificationPermission();
      case "ui.showNativeNotification":
        return api.ui.showNativeNotification({
          title: String(payload?.title ?? "Plugin"),
          body: payload?.body ? String(payload.body) : undefined,
        });
      case "ui.closePanel":
        await api.ui.closePanel();
        return { ok: true };
      case "fs.readText":
        return api.fs.readText(String(payload?.path ?? ""));
      case "fs.writeText":
        await api.fs.writeText(String(payload?.path ?? ""), String(payload?.content ?? ""));
        return { ok: true };
      case "fs.glob":
        return api.fs.glob(String(payload?.pattern ?? "*"));
      case "clipboard.readText":
        return api.clipboard.readText();
      case "clipboard.writeText":
        await api.clipboard.writeText(String(payload?.text ?? ""));
        return { ok: true };
      case "shell.openExternal":
        await api.shell.openExternal(String(payload?.url ?? ""));
        return { ok: true };
      case "net.fetch":
        return api.net.fetch({
          url: String(payload?.url ?? ""),
          method: payload?.method ? String(payload.method) : undefined,
          headers: (payload?.headers as Record<string, string> | undefined) ?? undefined,
          body: payload?.body ? String(payload.body) : undefined,
          timeoutMs: typeof payload?.timeoutMs === "number" ? payload.timeoutMs : undefined,
        });
      case "plugin.getSettings":
        return api.plugin.getSettings();
      case "workspace.get":
        return api.workspace.get();
      default:
        throw apiError("UNSUPPORTED", `unknown panel channel: ${channel}`);
    }
  }

  // --- plugin host process plumbing -------------------------------------

  private sendToChild(
    loaded: LoadedPlugin,
    message: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const child = loaded.child;
    if (!child) {
      return Promise.reject(apiError("NOT_FOUND", `plugin host process gone: ${loaded.manifest.id}`));
    }
    const id = `h${loaded.nextCallId++}`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        loaded.pending.delete(id);
        rejectPromise(
          apiError("TIMEOUT", `plugin ${loaded.manifest.id} did not answer ${String(message.t)}`),
        );
      }, timeoutMs);
      loaded.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        child.postMessage({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        loaded.pending.delete(id);
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleChildMessage(loaded: LoadedPlugin, message: any): void {
    if (!message || typeof message !== "object") return;
    if (message.t === "res") {
      const entry = loaded.pending.get(message.id);
      if (!entry) return;
      loaded.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(apiError(message.error?.code ?? "UNKNOWN", message.error?.message ?? "plugin call failed"));
      return;
    }
    if (message.t === "log") {
      this.services.audit?.({
        pluginId: loaded.manifest.id,
        api: "plugin.log",
        level: message.level,
        message: String(message.message ?? ""),
        ts: Date.now(),
      });
      return;
    }
    if (message.t === "call") {
      void this.dispatchHostCall(loaded, String(message.api ?? ""), message.args ?? [])
        .then((value) =>
          loaded.child?.postMessage({ t: "res", id: message.id, ok: true, value: value ?? null }),
        )
        .catch((error: PluginApiError) =>
          loaded.child?.postMessage({
            t: "res",
            id: message.id,
            ok: false,
            error: {
              code: error?.code ?? "PLUGIN_API_FAILED",
              message: error?.message ?? String(error),
            },
          }),
        );
    }
  }

  /**
   * The broker: every plugin API call crosses here, so the permission gateway
   * and the allowlist run in the host, never in plugin-controlled code.
   */
  private async dispatchHostCall(
    loaded: LoadedPlugin,
    api: string,
    args: unknown[],
  ): Promise<unknown> {
    const pluginId = loaded.manifest.id;
    switch (api) {
      case "commands.register": {
        const descriptor = (args[0] ?? {}) as {
          id?: string;
          title?: string;
          keywords?: string[];
          category?: string;
        };
        const id = String(descriptor.id ?? "");
        if (!id) throw apiError("INVALID_ARGUMENT", "command.id is required");
        this.commands.set(id, {
          id,
          title: String(descriptor.title ?? id),
          category: descriptor.category,
          keywords: descriptor.keywords,
          pluginId,
          run: async () => {
            const target = this.loaded.get(pluginId);
            if (!target?.child) throw apiError("NOT_FOUND", `plugin not loaded: ${pluginId}`);
            await this.sendToChild(
              target,
              { t: "call", method: "command.run", payload: { id } },
              PLUGIN_COMMAND_TIMEOUT_MS,
            );
          },
        });
        return { ok: true };
      }
      case "commands.unregister": {
        this.commands.delete(String(args[0] ?? ""));
        return { ok: true };
      }
      case "agent.registerTool": {
        this.assertPermission(loaded, "agent.tool.register");
        const descriptor = (args[0] ?? {}) as {
          name?: string;
          description?: string;
          risk?: string;
          schema?: unknown;
        };
        const name = String(descriptor.name ?? "");
        if (!name) throw apiError("INVALID_ARGUMENT", "tool.name is required");
        const fullName = pluginToolName(pluginId, name);
        this.tools.set(fullName, {
          fullName,
          pluginId,
          name,
          description: String(descriptor.description ?? ""),
          risk: descriptor.risk,
          schema: descriptor.schema,
          execute: async (toolArgs) => {
            const target = this.loaded.get(pluginId);
            if (!target?.child) throw apiError("NOT_FOUND", `plugin not loaded: ${pluginId}`);
            return this.sendToChild(
              target,
              { t: "call", method: "tool.execute", payload: { name, args: toolArgs } },
              PLUGIN_TOOL_TIMEOUT_MS,
            );
          },
        });
        return { ok: true };
      }
      case "agent.unregisterTool": {
        this.tools.delete(pluginToolName(pluginId, String(args[0] ?? "")));
        return { ok: true };
      }
      default: {
        if (!HOST_API_ALLOWLIST.has(api)) {
          this.services.audit?.({
            pluginId,
            api,
            ok: false,
            errorCode: "UNSUPPORTED",
            ts: Date.now(),
          });
          throw apiError("UNSUPPORTED", `host api not available: ${api}`);
        }
        const [group, member] = api.split(".");
        const target = (this.hostApi(loaded) as any)[group]?.[member];
        if (typeof target !== "function") {
          throw apiError("UNSUPPORTED", `host api not available: ${api}`);
        }
        return target(...args);
      }
    }
  }

  private handleChildExit(loaded: LoadedPlugin, code: number): void {
    if (loaded.disposing) return;
    if (this.loaded.get(loaded.manifest.id) !== loaded) return;
    const pluginId = loaded.manifest.id;
    this.rejectPending(loaded, apiError("PLUGIN_CRASHED", `plugin host process exited: ${pluginId}`));
    this.clearContributions(pluginId);
    this.loaded.delete(pluginId);
    void this.services.closePanel(pluginId);
    this.services.audit?.({
      pluginId,
      api: "plugin.crash",
      ok: false,
      errorCode: "PLUGIN_CRASHED",
      exitCode: code,
      ts: Date.now(),
    });
    this.services.showToast(`Plugin stopped unexpectedly: ${loaded.manifest.name}`, "error");
    this.services.onPluginCrash?.({ pluginId, name: loaded.manifest.name, exitCode: code });
    this.superviseCrash(loaded);
  }

  /**
   * A crashed host process takes its resident services down with it. Restart it
   * with exponential backoff, and after `MAX_SERVICE_RESTARTS` leave the plugin
   * down rather than spin forever — the failed state is what the user sees.
   */
  private superviseCrash(loaded: LoadedPlugin): void {
    const pluginId = loaded.manifest.id;
    const declared = this.declaredServices(loaded);
    if (!declared.length) return;
    const record = this.restarts.get(pluginId) ?? { attempts: 0 };
    if (record.healthy) clearTimeout(record.healthy);
    record.healthy = undefined;
    this.markServices(loaded, "failed", record.attempts, "plugin host process exited");

    const restartable =
      loaded.permissions.has("background.service") &&
      declared.some((service) => service.autoRestart !== false);
    if (!restartable) return;

    record.attempts += 1;
    this.restarts.set(pluginId, record);
    if (record.attempts > MAX_SERVICE_RESTARTS) {
      this.markServices(loaded, "failed", record.attempts - 1, "restart limit reached");
      this.services.audit?.({
        pluginId,
        api: "plugin.service.restart",
        ok: false,
        errorCode: "LIMIT_EXCEEDED",
        attempts: record.attempts - 1,
        ts: Date.now(),
      });
      return;
    }
    const delayMs = Math.min(
      SERVICE_RESTART_BASE_MS * 2 ** (record.attempts - 1),
      SERVICE_RESTART_MAX_DELAY_MS,
    );
    this.services.audit?.({
      pluginId,
      api: "plugin.service.restart.scheduled",
      ok: true,
      attempt: record.attempts,
      delayMs,
      ts: Date.now(),
    });
    record.timer = setTimeout(() => {
      record.timer = undefined;
      void this.restartAfterCrash(loaded, record.attempts);
    }, delayMs);
  }

  private async restartAfterCrash(loaded: LoadedPlugin, attempt: number): Promise<void> {
    const pluginId = loaded.manifest.id;
    // The user may have re-enabled or removed the plugin while we waited.
    if (this.loaded.has(pluginId) || !existsSync(loaded.path)) return;
    this.restarting.add(pluginId);
    try {
      await this.loadFromPath(loaded.path, [...loaded.permissions]);
      this.services.audit?.({
        pluginId,
        api: "plugin.service.restart",
        ok: true,
        attempt,
        ts: Date.now(),
      });
    } catch (error) {
      this.markServices(loaded, "failed", attempt, (error as Error).message);
      this.services.audit?.({
        pluginId,
        api: "plugin.service.restart",
        ok: false,
        attempt,
        errorCode: (error as PluginApiError).code ?? "PLUGIN_LOAD_FAILED",
        message: (error as Error).message,
        ts: Date.now(),
      });
    } finally {
      this.restarting.delete(pluginId);
    }
  }

  private rejectPending(loaded: LoadedPlugin, error: Error): void {
    for (const entry of loaded.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    loaded.pending.clear();
  }

  private clearContributions(pluginId: string): void {
    for (const [id, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) this.commands.delete(id);
    }
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) this.tools.delete(name);
    }
    for (const [id, skill] of this.skills) {
      if (skill.pluginId === pluginId) this.skills.delete(id);
    }
    for (const [id, theme] of this.themes) {
      if (theme.pluginId === pluginId) this.themes.delete(id);
    }
    // Closing the client kills the stdio child / drops the HTTP session, so a
    // disabled plugin leaves no process behind.
    for (const client of this.mcpClients.get(pluginId) ?? []) {
      try {
        client.close();
      } catch {
        // Teardown is best effort; a wedged transport must not block unload.
      }
    }
    this.mcpClients.delete(pluginId);
    // A gone plugin cannot receive: drop its routes so publishers stop paying
    // the fan-out cost, and reset its publish window.
    for (const [id, subscription] of this.busSubscriptions) {
      if (subscription.pluginId === pluginId) this.busSubscriptions.delete(id);
    }
    this.busRate.delete(pluginId);
  }

  /**
   * Index `contributes.skills` after the plugin loaded. Skills are declarative
   * (no code runs), so the manifest is the whole source of truth; the child
   * process is not consulted.
   *
   * Skills predate the permission gate, so a plugin that declares them without
   * `agent.prompt.inject` still loads — it just teaches the agent nothing.
   */
  private registerSkills(loaded: LoadedPlugin): void {
    const declared = loaded.manifest.contributes?.skills ?? [];
    if (!declared.length) return;
    const pluginId = loaded.manifest.id;
    if (!loaded.permissions.has("agent.prompt.inject")) {
      this.services.audit?.({
        pluginId,
        api: "plugin.skills.skipped",
        ok: false,
        errorCode: "PERMISSION_DENIED",
        count: declared.length,
        ts: Date.now(),
      });
      return;
    }

    let accepted = 0;
    for (const entry of declared) {
      if (accepted >= MAX_SKILLS_PER_PLUGIN) {
        this.services.audit?.({
          pluginId,
          api: "plugin.skills.skipped",
          ok: false,
          errorCode: "LIMIT_EXCEEDED",
          count: declared.length - accepted,
          ts: Date.now(),
        });
        break;
      }
      const contrib: PluginSkillContrib =
        typeof entry === "string" ? { path: entry } : entry;
      const relative = String(contrib.path ?? "").trim();
      if (!relative) continue;
      const skillPath = resolveInsidePlugin(loaded.path, relative);
      if (!skillPath || !existsSync(skillPath)) {
        this.skipSkill(pluginId, relative, "NOT_FOUND");
        continue;
      }
      let raw: string;
      try {
        const stats = statSync(skillPath);
        if (stats.size > MAX_SKILL_BYTES) {
          this.skipSkill(pluginId, relative, "TOO_LARGE");
          continue;
        }
        raw = readFileSync(skillPath, "utf8");
      } catch {
        this.skipSkill(pluginId, relative, "READ_FAILED");
        continue;
      }
      const parsed = parseSkillFrontmatter(raw);
      if (!parsed.body) {
        this.skipSkill(pluginId, relative, "EMPTY");
        continue;
      }
      const skillId = String(contrib.id ?? "").trim() || skillIdFromPath(relative);
      const id = pluginSkillId(pluginId, skillId);
      if (this.skills.has(id)) {
        this.skipSkill(pluginId, relative, "DUPLICATE");
        continue;
      }
      const description = (contrib.description ?? parsed.description ?? "").trim();
      this.skills.set(id, {
        id,
        pluginId,
        skillId,
        name: (contrib.name ?? parsed.name ?? skillId).trim() || skillId,
        description:
          description.length > MAX_SKILL_DESCRIPTION_CHARS
            ? `${description.slice(0, MAX_SKILL_DESCRIPTION_CHARS - 1).trimEnd()}…`
            : description,
        path: skillPath,
        bytes: Buffer.byteLength(raw, "utf8"),
      });
      accepted += 1;
    }
    if (accepted) {
      this.services.audit?.({
        pluginId,
        api: "plugin.skills.register",
        ok: true,
        count: accepted,
        ts: Date.now(),
      });
    }
  }

  private skipSkill(pluginId: string, path: string, errorCode: string): void {
    this.services.audit?.({
      pluginId,
      api: "plugin.skills.skipped",
      ok: false,
      errorCode,
      path,
      ts: Date.now(),
    });
  }

  /**
   * Index `contributes.themes`. Like skills this is declarative, but the CSS is
   * read and sanitized here so a bad sheet never reaches the renderer: the
   * shell injects the stored text with no further filtering.
   */
  private registerThemes(loaded: LoadedPlugin): void {
    const declared = loaded.manifest.contributes?.themes ?? [];
    if (!declared.length) return;
    const pluginId = loaded.manifest.id;
    if (!loaded.permissions.has("ui.theme")) {
      this.services.audit?.({
        pluginId,
        api: "plugin.themes.skipped",
        ok: false,
        errorCode: "PERMISSION_DENIED",
        count: declared.length,
        ts: Date.now(),
      });
      return;
    }

    let accepted = 0;
    for (const contrib of declared) {
      if (accepted >= MAX_THEMES_PER_PLUGIN) {
        this.services.audit?.({
          pluginId,
          api: "plugin.themes.skipped",
          ok: false,
          errorCode: "LIMIT_EXCEEDED",
          count: declared.length - accepted,
          ts: Date.now(),
        });
        break;
      }
      const themeId = String(contrib?.id ?? "").trim();
      const relative = String(contrib?.path ?? "").trim();
      if (!themeId || !relative) continue;
      const cssPath = resolveInsidePlugin(loaded.path, relative);
      if (!cssPath || !existsSync(cssPath)) {
        this.skipTheme(pluginId, themeId, "NOT_FOUND");
        continue;
      }
      let raw: string;
      try {
        raw = readFileSync(cssPath, "utf8");
      } catch {
        this.skipTheme(pluginId, themeId, "READ_FAILED");
        continue;
      }
      const sanitized = sanitizeThemeCss(raw);
      if (!sanitized.ok) {
        this.skipTheme(pluginId, themeId, "INVALID_CSS", sanitized.error);
        continue;
      }
      const id = pluginThemeId(pluginId, themeId);
      if (this.themes.has(id)) {
        this.skipTheme(pluginId, themeId, "DUPLICATE");
        continue;
      }
      this.themes.set(id, {
        id,
        pluginId,
        themeId,
        label: String(contrib.label ?? "").trim() || themeId,
        base: contrib.base === "light" ? "light" : "dark",
        css: sanitized.css,
      });
      accepted += 1;
    }
    if (accepted) {
      this.services.audit?.({
        pluginId,
        api: "plugin.themes.register",
        ok: true,
        count: accepted,
        ts: Date.now(),
      });
    }
  }

  private skipTheme(
    pluginId: string,
    themeId: string,
    errorCode: string,
    message?: string,
  ): void {
    this.services.audit?.({
      pluginId,
      api: "plugin.themes.skipped",
      ok: false,
      errorCode,
      themeId,
      ...(message ? { message } : {}),
      ts: Date.now(),
    });
  }

  /**
   * Connect the plugin's declared MCP servers and publish their tools under the
   * plugin's own namespace, so they travel the existing `plugin_*` tool path
   * with no extra routing (ADR 0038).
   *
   * A server that fails to answer is audited and contributes no tools; the
   * plugin still loads, and the next tool call retries the handshake.
   */
  private async registerMcpServers(loaded: LoadedPlugin): Promise<void> {
    const declared = loaded.manifest.contributes?.mcpServers ?? [];
    if (!declared.length) return;
    const pluginId = loaded.manifest.id;
    // Credentials come from the plugin's own settings, never from host env.
    let settings: Record<string, unknown> = {};
    try {
      settings = await this.hostApi(loaded).plugin.getSettings();
    } catch {
      settings = {};
    }

    const clients: McpServerClient[] = [];
    for (const raw of declared) {
      if (clients.length >= MAX_MCP_SERVERS_PER_PLUGIN) {
        this.services.audit?.({
          pluginId,
          api: "plugin.mcp.skipped",
          ok: false,
          errorCode: "LIMIT_EXCEEDED",
          count: declared.length - clients.length,
          ts: Date.now(),
        });
        break;
      }
      const parsed = validateMcpServer(raw);
      if (!parsed.ok) {
        this.skipMcpServer(pluginId, String((raw as { id?: unknown })?.id ?? ""), "PLUGIN_INVALID", parsed.error);
        continue;
      }
      const server = parsed.server;
      const permission =
        server.transport === "stdio" ? "mcp.server.local" : "mcp.server.remote";
      if (!loaded.permissions.has(permission)) {
        this.skipMcpServer(pluginId, server.id, "PERMISSION_DENIED", `missing ${permission}`);
        continue;
      }
      const refs = resolveMcpRefs(
        server.transport === "stdio" ? server.env : server.headers,
        settings,
      );
      if (!refs.ok) {
        this.skipMcpServer(pluginId, server.id, "CONFIG_MISSING", refs.error);
        continue;
      }

      const client = new McpServerClient({
        pluginId,
        rootPath: loaded.path,
        server,
        values: refs.values,
        audit: this.services.audit,
        ...this.services.mcp,
      });
      clients.push(client);
      let tools: Awaited<ReturnType<McpServerClient["connect"]>> = [];
      try {
        tools = await client.connect();
      } catch {
        // The client already audited the failure; leave the server toolless.
        continue;
      }
      for (const tool of tools) {
        const name = pluginMcpToolKey(server.id, tool.name);
        const fullName = pluginToolName(pluginId, name);
        this.tools.set(fullName, {
          fullName,
          pluginId,
          name,
          description:
            tool.description ?? `${server.label ?? server.id} tool "${tool.name}" (MCP)`,
          // Remote code the desktop cannot inspect; never silently auto-approved.
          risk: "medium",
          schema: tool.inputSchema,
          execute: async (toolArgs) => client.callTool(tool.name, toolArgs),
        });
      }
    }
    if (clients.length) this.mcpClients.set(pluginId, clients);
  }

  private skipMcpServer(
    pluginId: string,
    serverId: string,
    errorCode: string,
    message?: string,
  ): void {
    this.services.audit?.({
      pluginId,
      api: "plugin.mcp.skipped",
      ok: false,
      errorCode,
      serverId,
      ...(message ? { message } : {}),
      ts: Date.now(),
    });
  }

  /** Declared resident services, capped so one plugin cannot hold many workers. */
  private declaredServices(loaded: LoadedPlugin): PluginServiceContrib[] {
    const declared = loaded.manifest.contributes?.services ?? [];
    return declared.slice(0, MAX_SERVICES_PER_PLUGIN);
  }

  /**
   * Start the plugin's resident services once `onLoad` returned, so the plugin
   * has had its chance to call `pi.services.register` (spec 07 §5).
   *
   * A service that refuses to start is marked failed and left alone: the plugin
   * itself stays loaded, because its commands and tools may still work.
   */
  private async startServices(loaded: LoadedPlugin): Promise<void> {
    const all = loaded.manifest.contributes?.services ?? [];
    if (!all.length) return;
    const pluginId = loaded.manifest.id;
    if (!loaded.permissions.has("background.service")) {
      this.services.audit?.({
        pluginId,
        api: "plugin.services.skipped",
        ok: false,
        errorCode: "PERMISSION_DENIED",
        count: all.length,
        ts: Date.now(),
      });
      return;
    }
    if (all.length > MAX_SERVICES_PER_PLUGIN) {
      this.services.audit?.({
        pluginId,
        api: "plugin.services.skipped",
        ok: false,
        errorCode: "LIMIT_EXCEEDED",
        count: all.length - MAX_SERVICES_PER_PLUGIN,
        ts: Date.now(),
      });
    }
    const restarts = this.restarts.get(pluginId)?.attempts ?? 0;
    for (const service of this.declaredServices(loaded)) {
      const label = service.label || service.id;
      this.setServiceState({
        pluginId,
        serviceId: service.id,
        label,
        state: "starting",
        restarts,
      });
      try {
        await this.sendToChild(
          loaded,
          { t: "call", method: "service.start", payload: { id: service.id } },
          SERVICE_START_TIMEOUT_MS,
        );
        this.setServiceState({
          pluginId,
          serviceId: service.id,
          label,
          state: "running",
          restarts,
        });
        this.services.audit?.({
          pluginId,
          api: "plugin.service.start",
          ok: true,
          serviceId: service.id,
          ts: Date.now(),
        });
      } catch (error) {
        this.setServiceState({
          pluginId,
          serviceId: service.id,
          label,
          state: "failed",
          restarts,
          message: (error as Error).message,
        });
        this.services.audit?.({
          pluginId,
          api: "plugin.service.start",
          ok: false,
          serviceId: service.id,
          errorCode: (error as PluginApiError).code ?? "SERVICE_START_FAILED",
          message: (error as Error).message,
          ts: Date.now(),
        });
      }
    }
    // Surviving the grace window means the backoff can start from zero again.
    if (restarts > 0) this.scheduleHealthyReset(pluginId);
  }

  /** Ask the child to stop its services, then forget them: the plugin is going. */
  private async stopServices(loaded: LoadedPlugin): Promise<void> {
    const pluginId = loaded.manifest.id;
    for (const service of this.declaredServices(loaded)) {
      const key = serviceStateKey(pluginId, service.id);
      const current = this.serviceStates.get(key);
      if (!current) continue;
      if (current.state === "running" || current.state === "starting") {
        try {
          await this.sendToChild(
            loaded,
            { t: "call", method: "service.stop", payload: { id: service.id } },
            PLUGIN_HOOK_TIMEOUT_MS,
          );
        } catch {
          // The child is killed right after this; a stuck stop must not block.
        }
      }
      this.serviceStates.delete(key);
      this.services.onServiceChange?.({ ...current, state: "stopped", updatedAt: Date.now() });
      this.services.audit?.({
        pluginId,
        api: "plugin.service.stop",
        ok: true,
        serviceId: service.id,
        ts: Date.now(),
      });
    }
  }

  private markServices(
    loaded: LoadedPlugin,
    state: PluginServiceStatus["state"],
    restarts: number,
    message?: string,
  ): void {
    for (const service of this.declaredServices(loaded)) {
      this.setServiceState({
        pluginId: loaded.manifest.id,
        serviceId: service.id,
        label: service.label || service.id,
        state,
        restarts,
        ...(message ? { message } : {}),
      });
    }
  }

  private setServiceState(status: Omit<PluginServiceStatus, "updatedAt">): void {
    const next: PluginServiceStatus = { ...status, updatedAt: Date.now() };
    this.serviceStates.set(serviceStateKey(status.pluginId, status.serviceId), next);
    this.services.onServiceChange?.(next);
  }

  private scheduleHealthyReset(pluginId: string): void {
    const record = this.restarts.get(pluginId);
    if (!record) return;
    if (record.healthy) clearTimeout(record.healthy);
    record.healthy = setTimeout(() => {
      this.restarts.delete(pluginId);
    }, SERVICE_HEALTHY_MS);
    // Supervision must never be the reason the process stays alive.
    record.healthy.unref?.();
  }

  private cancelRestarts(pluginId: string): void {
    const record = this.restarts.get(pluginId);
    if (!record) return;
    if (record.timer) clearTimeout(record.timer);
    if (record.healthy) clearTimeout(record.healthy);
    this.restarts.delete(pluginId);
  }

  /**
   * Fan one message out to the plugins subscribed to its topic (spec 07 §3).
   *
   * The publisher is excluded: a plugin talking to itself needs no bus, and
   * echoing its own messages back is a surprising default. Delivery is
   * fire-and-forget — a slow or wedged subscriber must never stall the sender.
   */
  private async busPublish(
    loaded: LoadedPlugin,
    topic: unknown,
    payload?: unknown,
  ): Promise<{ ok: true; delivered: number }> {
    const pluginId = loaded.manifest.id;
    this.assertPermission(loaded, "bus.publish");
    const name = String(topic ?? "");
    if (!isValidBusTopic(name)) {
      throw apiError("INVALID_ARGUMENT", `invalid bus topic: ${name}`);
    }
    if (!busTopicAllowed(loaded.manifest.contributes?.bus?.publish, name)) {
      this.auditBus(pluginId, "bus.publish", false, name, "TOPIC_NOT_DECLARED");
      throw apiError("PERMISSION_DENIED", `topic not declared for publish: ${name}`);
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(payload ?? null);
    } catch {
      throw apiError("INVALID_ARGUMENT", "bus payload is not serializable");
    }
    if (Buffer.byteLength(encoded, "utf8") > MAX_BUS_PAYLOAD_BYTES) {
      this.auditBus(pluginId, "bus.publish", false, name, "PAYLOAD_TOO_LARGE");
      throw apiError("INVALID_ARGUMENT", "bus payload too large");
    }
    if (this.busRateExceeded(pluginId)) {
      this.auditBus(pluginId, "bus.publish", false, name, "RATE_LIMITED");
      throw apiError("RATE_LIMITED", "bus publish rate exceeded");
    }

    const message = {
      topic: name,
      from: pluginId,
      payload: payload ?? undefined,
      at: new Date().toISOString(),
    };
    let delivered = 0;
    for (const subscription of this.busSubscriptions.values()) {
      if (subscription.pluginId === pluginId) continue;
      if (!matchesBusTopic(subscription.pattern, name)) continue;
      const target = this.loaded.get(subscription.pluginId);
      if (!target?.child || target.disposing) continue;
      try {
        target.child.postMessage({
          t: "event",
          event: "bus.message",
          subscriptionId: subscription.id,
          message,
        });
        delivered += 1;
      } catch {
        // The subscriber is going away; its subscription dies with it.
      }
    }
    this.services.audit?.({
      pluginId,
      api: "plugin.bus.publish",
      ok: true,
      topic: name,
      delivered,
      ts: Date.now(),
    });
    return { ok: true, delivered };
  }

  private async busSubscribe(
    loaded: LoadedPlugin,
    pattern: unknown,
  ): Promise<{ subscriptionId: string; pattern: string }> {
    const pluginId = loaded.manifest.id;
    this.assertPermission(loaded, "bus.subscribe");
    const name = String(pattern ?? "");
    if (!isValidBusTopicPattern(name)) {
      throw apiError("INVALID_ARGUMENT", `invalid bus topic pattern: ${name}`);
    }
    if (!busSubscribeAllowed(loaded.manifest.contributes?.bus?.subscribe, name)) {
      this.auditBus(pluginId, "bus.subscribe", false, name, "TOPIC_NOT_DECLARED");
      throw apiError("PERMISSION_DENIED", `topic not declared for subscribe: ${name}`);
    }
    let held = 0;
    for (const subscription of this.busSubscriptions.values()) {
      if (subscription.pluginId === pluginId) held += 1;
    }
    if (held >= MAX_BUS_SUBSCRIPTIONS_PER_PLUGIN) {
      this.auditBus(pluginId, "bus.subscribe", false, name, "LIMIT_EXCEEDED");
      throw apiError("LIMIT_EXCEEDED", "too many bus subscriptions");
    }
    const id = `bus${this.nextBusSubscription++}`;
    this.busSubscriptions.set(id, { id, pluginId, pattern: name });
    this.auditBus(pluginId, "bus.subscribe", true, name);
    return { subscriptionId: id, pattern: name };
  }

  private async busUnsubscribe(
    loaded: LoadedPlugin,
    subscriptionId: unknown,
  ): Promise<{ ok: true }> {
    const id = String(subscriptionId ?? "");
    const subscription = this.busSubscriptions.get(id);
    // Only the owner may drop a subscription, and dropping twice is fine.
    if (subscription && subscription.pluginId === loaded.manifest.id) {
      this.busSubscriptions.delete(id);
      this.auditBus(loaded.manifest.id, "bus.unsubscribe", true, subscription.pattern);
    }
    return { ok: true };
  }

  /** Rolling publish window per plugin; the first publish opens the window. */
  private busRateExceeded(pluginId: string): boolean {
    const now = Date.now();
    const record = this.busRate.get(pluginId);
    if (!record || now - record.windowStart >= BUS_RATE_WINDOW_MS) {
      this.busRate.set(pluginId, { windowStart: now, count: 1 });
      return false;
    }
    record.count += 1;
    return record.count > MAX_BUS_PUBLISH_PER_WINDOW;
  }

  private auditBus(
    pluginId: string,
    api: string,
    ok: boolean,
    topic: string,
    errorCode?: string,
  ): void {
    this.services.audit?.({
      pluginId,
      api: `plugin.${api}`,
      ok,
      topic,
      ...(errorCode ? { errorCode } : {}),
      ts: Date.now(),
    });
  }

  private assertPermission(loaded: LoadedPlugin, perm: string): void {
    if (!loaded.permissions.has(perm)) {
      this.services.audit?.({
        pluginId: loaded.manifest.id,
        api: perm,
        ok: false,
        errorCode: "PERMISSION_DENIED",
        ts: Date.now(),
      });
      throw apiError("PERMISSION_DENIED", `missing permission: ${perm}`);
    }
  }

  /** Host-side implementation of the allowlisted APIs; shared with panel bridge. */
  private hostApi(loaded: LoadedPlugin) {
    const pluginId = loaded.manifest.id;
    const pluginPath = loaded.path;

    const dataPath = () => {
      const root = process.env.PI_DESKTOP_DATA_DIR
        ? resolve(process.env.PI_DESKTOP_DATA_DIR)
        : join(homedir(), ".pi-desktop");
      const dir = join(root, "plugins", "data", pluginId.replace(/[^a-zA-Z0-9._-]/g, "_"));
      mkdirSync(dir, { recursive: true });
      return dir;
    };

    return {
      app: {
        getVersion: async () => this.services.getAppVersion?.() ?? "0.2.1",
        getLocale: async () => this.services.getLocale?.() ?? "en",
      },
      plugin: {
        getId: () => pluginId,
        getManifest: () => loaded.manifest,
        getSettings: async () => {
          const defaults: Record<string, unknown> = {};
          for (const s of loaded.manifest.contributes?.settings ?? []) {
            defaults[s.key] = s.default;
          }
          const file = join(dataPath(), "settings.json");
          if (!existsSync(file)) return defaults;
          try {
            return { ...defaults, ...JSON.parse(readFileSync(file, "utf8")) };
          } catch {
            return defaults;
          }
        },
        setSettings: async (partial: Record<string, unknown>) => {
          const current = await this.hostApi(loaded).plugin.getSettings();
          const next = { ...current, ...partial };
          writeFileSync(join(dataPath(), "settings.json"), JSON.stringify(next, null, 2), "utf8");
        },
        getDataPath: async () => dataPath(),
      },
      ui: {
        openPanel: async (options?: { title?: string }) => {
          this.assertPermission(loaded, "ui.panel");
          const panel = loaded.manifest.ui?.panel;
          if (!panel) throw apiError("NOT_FOUND", "plugin does not declare ui.panel");
          const htmlPath = join(pluginPath, panel);
          if (!existsSync(htmlPath)) {
            throw apiError("NOT_FOUND", `panel html missing: ${panel}`);
          }
          await this.services.openPanel({
            pluginId,
            title: options?.title || loaded.manifest.ui?.title || loaded.manifest.name,
            width: loaded.manifest.ui?.width ?? 480,
            height: loaded.manifest.ui?.height ?? 360,
            htmlPath,
            ...(loaded.development ? { development: true } : {}),
          });
          this.services.audit?.({
            pluginId,
            api: "ui.openPanel",
            ok: true,
            ts: Date.now(),
          });
        },
        closePanel: async () => {
          await this.services.closePanel(pluginId);
        },
        showToast: async (message: string, level?: "info" | "warn" | "error") => {
          this.services.showToast(message, level);
        },
        notify: async (input: { title: string; body?: string }) => {
          this.assertPermission(loaded, "notify");
          this.services.notify(input);
        },
        getNotificationPermission: async () => {
          this.assertPermission(loaded, "notify");
          return this.services.getNotificationPermission();
        },
        requestNotificationPermission: async () => {
          this.assertPermission(loaded, "notify");
          return this.services.requestNotificationPermission();
        },
        showNativeNotification: async (input: PluginNativeNotificationInput) => {
          this.assertPermission(loaded, "notify");
          return this.services.showNativeNotification(input);
        },
      },
      workspace: {
        get: async () => {
          const path = this.services.getWorkspacePath();
          if (!path) return null;
          return { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path };
        },
      },
      fs: {
        readText: async (pathFromWorkspaceRoot: string) => {
          this.assertPermission(loaded, "fs.read.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const full = ensureWithinRoot(root, pathFromWorkspaceRoot);
          const content = readFileSync(full, "utf8");
          this.services.audit?.({
            pluginId,
            api: "fs.readText",
            ok: true,
            ts: Date.now(),
            path: pathFromWorkspaceRoot,
          });
          return content;
        },
        writeText: async (pathFromWorkspaceRoot: string, content: string) => {
          this.assertPermission(loaded, "fs.write.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const full = ensureWithinRoot(root, pathFromWorkspaceRoot);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf8");
          this.services.audit?.({
            pluginId,
            api: "fs.writeText",
            ok: true,
            ts: Date.now(),
            path: pathFromWorkspaceRoot,
          });
        },
        glob: async (pattern: string) => {
          this.assertPermission(loaded, "fs.read.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const matches: string[] = [];
          const visit = (dir: string, rel = "") => {
            for (const entry of readdirSync(dir)) {
              const full = join(dir, entry);
              const nextRel = rel ? `${rel}/${entry}` : entry;
              const st = statSync(full);
              if (st.isDirectory()) visit(full, nextRel);
              else if (matchGlob(nextRel, pattern)) matches.push(nextRel);
            }
          };
          visit(root);
          return matches.slice(0, 500);
        },
        remove: async (pathFromWorkspaceRoot: string) => {
          this.assertPermission(loaded, "fs.delete.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const full = ensureWithinRoot(root, pathFromWorkspaceRoot);
          if (full === resolve(root)) {
            throw apiError("INVALID_ARGUMENT", "cannot remove workspace root");
          }
          if (!existsSync(full)) {
            throw apiError("NOT_FOUND", `workspace path not found: ${pathFromWorkspaceRoot}`);
          }
          // Never recurse: Skill removal may delete a file or an empty directory,
          // but it must fail closed for a non-empty directory.
          rmSync(full, { recursive: false, force: false });
          this.services.audit?.({
            pluginId,
            api: "fs.remove",
            ok: true,
            ts: Date.now(),
            path: pathFromWorkspaceRoot,
          });
        },
      },
      clipboard: {
        readText: async () => {
          this.assertPermission(loaded, "clipboard.read");
          const text = await this.services.readClipboard();
          this.services.audit?.({
            pluginId,
            api: "clipboard.readText",
            ok: true,
            ts: Date.now(),
          });
          return text;
        },
        writeText: async (text: string) => {
          this.assertPermission(loaded, "clipboard.write");
          await this.services.writeClipboard(text);
          this.services.audit?.({
            pluginId,
            api: "clipboard.writeText",
            ok: true,
            ts: Date.now(),
          });
        },
      },
      shell: {
        openExternal: async (url: string) => {
          this.assertPermission(loaded, "shell.openExternal");
          if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
            throw apiError("INVALID_ARGUMENT", "only http(s)/mailto URLs allowed");
          }
          await this.services.openExternal(url);
          this.services.audit?.({
            pluginId,
            api: "shell.openExternal",
            ok: true,
            ts: Date.now(),
            url,
          });
        },
      },
      net: {
        fetch: async (input: {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
          timeoutMs?: number;
        }) => {
          this.assertPermission(loaded, "net.fetch");
          if (!/^https?:\/\//i.test(input.url)) {
            throw apiError("INVALID_ARGUMENT", "only http(s) URLs allowed");
          }
          if (this.services.fetch) {
            const result = await this.services.fetch(input);
            this.services.audit?.({
              pluginId,
              api: "net.fetch",
              ok: true,
              ts: Date.now(),
              url: input.url,
              status: result.status,
            });
            return result;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
          try {
            const res = await fetch(input.url, {
              method: input.method ?? "GET",
              headers: input.headers,
              body: input.body,
              signal: controller.signal,
            });
            const headers: Record<string, string> = {};
            res.headers.forEach((value, key) => {
              headers[key] = value;
            });
            const bodyText = await res.text();
            this.services.audit?.({
              pluginId,
              api: "net.fetch",
              ok: true,
              ts: Date.now(),
              url: input.url,
              status: res.status,
            });
            return { status: res.status, headers, bodyText };
          } finally {
            clearTimeout(timer);
          }
        },
      },
      bus: {
        publish: async (topic: string, payload?: unknown) => this.busPublish(loaded, topic, payload),
        subscribe: async (pattern: string) => this.busSubscribe(loaded, pattern),
        unsubscribe: async (subscriptionId: string) =>
          this.busUnsubscribe(loaded, subscriptionId),
      },
    };
  }
}

function matchGlob(path: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPattern === "*" || normalizedPattern === "**/*") return true;
  const escape = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escape}$`, "i").test(normalizedPath);
}
