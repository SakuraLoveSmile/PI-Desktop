import { BrowserWindow, ipcMain, session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { isNetUrlAllowed } from "@pi-desktop/plugin-sdk";
import {
  isPluginPanelWindowControlAction,
  PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL,
  PLUGIN_PANEL_WINDOW_STATE_CHANNEL,
  PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX,
  type PluginPanelTheme,
  type PluginPanelWindowControlAction,
} from "../shared/plugin-panel-chrome";

export type PluginPanelOpenRequest = {
  pluginId: string;
  title: string;
  locale: string;
  theme: PluginPanelTheme;
  width: number;
  height: number;
  htmlPath: string;
  /**
   * Egress allowlist from `manifest.net.domains`. A panel is a full web page:
   * `sandbox: true` removes Node, not the network, so without this the panel is
   * an unmetered outbound channel that bypasses the `net.fetch` permission.
   */
  netDomains?: readonly string[];
  /** Adds a development-only reminder for the non-clickable drag band. */
  development?: boolean;
};

/** Schemes a panel may always load: its own bundle and devtools plumbing. */
const PANEL_LOCAL_SCHEMES = new Set([
  "file:",
  "data:",
  "blob:",
  "devtools:",
  "chrome-extension:",
]);


type BridgeHandler = (
  pluginId: string,
  channel: string,
  payload?: Record<string, unknown>,
) => Promise<unknown>;

/** Reports an egress attempt a panel was not allowed to make. */
export type PluginPanelBlockedRequest = (input: {
  pluginId: string;
  url: string;
}) => void;

/**
 * Hosts isolated plugin panel windows.
 * Each plugin panel gets a dedicated session partition and no Node integration.
 */
export class PluginPanelHost {
  private windows = new Map<string, BrowserWindow>();
  private bridge: BridgeHandler;
  private onBlockedRequest?: PluginPanelBlockedRequest;
  private handlerReady = false;

  constructor(bridge: BridgeHandler, onBlockedRequest?: PluginPanelBlockedRequest) {
    this.bridge = bridge;
    this.onBlockedRequest = onBlockedRequest;
    this.ensureHandlers();
  }

  private ensureHandlers(): void {
    if (this.handlerReady) return;
    this.handlerReady = true;

    ipcMain.handle(
      "pi-plugin-panel-invoke",
      async (event, rawChannel: unknown, rawPayload: unknown) => {
        const pluginId = this.pluginIdForSender(event.sender.id);
        if (!pluginId) throw new Error("invalid panel invoker");
        const channel = String(rawChannel ?? "");
        const payload =
          rawPayload && typeof rawPayload === "object"
            ? (rawPayload as Record<string, unknown>)
            : undefined;
        return this.bridge(pluginId, channel, payload);
      },
    );

    // Legacy sync bridge used by older sample panels.
    ipcMain.on(
      "pi-plugin-panel-bridge",
      (event, rawChannel: unknown, rawPayload: unknown) => {
        const pluginId = this.pluginIdForSender(event.sender.id);
        if (!pluginId) {
          event.returnValue = {
            ok: false,
            error: { code: "NOT_FOUND", message: "invalid panel invoker" },
          };
          return;
        }
        const channel = String(rawChannel ?? "");
        const payload =
          rawPayload && typeof rawPayload === "object"
            ? (rawPayload as Record<string, unknown>)
            : undefined;
        // Sync IPC cannot await; kick async work and return ack.
        void this.bridge(pluginId, channel, payload);
        event.returnValue = { ok: true, accepted: true };
      },
    );

    ipcMain.handle(
      PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL,
      async (event, rawAction: unknown) => {
        const window = this.windowForSender(event.sender.id);
        if (!window) throw new Error("invalid panel window control invoker");
        if (!isPluginPanelWindowControlAction(rawAction)) {
          throw new Error("unsupported panel window control action");
        }
        this.applyWindowControl(window, rawAction);
        return {
          maximized: !window.isDestroyed() && window.isMaximized(),
        };
      },
    );
  }

  private pluginIdForSender(senderId: number): string | null {
    for (const [pluginId, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents.id === senderId) return pluginId;
    }
    return null;
  }

  private windowForSender(senderId: number): BrowserWindow | null {
    const pluginId = this.pluginIdForSender(senderId);
    return pluginId ? (this.windows.get(pluginId) ?? null) : null;
  }

  private applyWindowControl(
    window: BrowserWindow,
    action: PluginPanelWindowControlAction,
  ): void {
    switch (action) {
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
  }

  /**
   * Confine everything the panel's web contents can reach to the plugin's
   * declared domains. Registering again on the same persisted partition simply
   * replaces the previous handlers, so re-opening a panel re-reads the current
   * allowlist rather than stacking filters.
   */
  private applyEgressPolicy(
    ses: Electron.Session,
    request: PluginPanelOpenRequest,
  ): void {
    const domains = request.netDomains ?? [];
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      let scheme = "";
      try {
        scheme = new URL(details.url).protocol;
      } catch {
        // An unparseable URL cannot be matched against the allowlist; drop it.
        callback({ cancel: true });
        return;
      }
      if (PANEL_LOCAL_SCHEMES.has(scheme)) {
        callback({ cancel: false });
        return;
      }
      if (isNetUrlAllowed(details.url, domains)) {
        callback({ cancel: false });
        return;
      }
      this.onBlockedRequest?.({ pluginId: request.pluginId, url: details.url });
      callback({ cancel: true });
    });
    // A panel is a document, not a device. Nothing in this list is reachable
    // over the bridge either, so denying wholesale costs the plugin nothing.
    ses.setPermissionRequestHandler((_contents, _permission, callback) => {
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);
  }

  async open(request: PluginPanelOpenRequest): Promise<void> {
    const existing = this.windows.get(request.pluginId);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }

    const partition = `persist:pi-plugin-${request.pluginId.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const ses = session.fromPartition(partition, { cache: true });
    this.applyEgressPolicy(ses, request);

    const win = new BrowserWindow({
      width: Math.max(360, request.width || 480),
      height: Math.max(280, request.height || 360),
      title: request.title,
      show: false,
      autoHideMenuBar: true,
      // The host theme is only a fallback; the preload samples the actual
      // plugin page colors after it has loaded and paints the chrome from them.
      backgroundColor: request.theme === "light" ? "#ffffff" : "#181818",
      // Every platform uses the same frameless surface. The preload owns the
      // only visible window controls: a fixed three-button capsule.
      frame: false,
      webPreferences: {
        session: ses,
        preload: join(__dirname, "../preload/plugin-panel.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        additionalArguments: [
          `${PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX}${encodeURIComponent(request.locale)}`,
          `--pi-plugin-panel-theme=${request.theme}`,
          ...(request.development
            ? ["--pi-plugin-panel-development=1"]
            : []),
        ],
      },
    });
    // A panel owns its visible surface; do not add a native application menu
    // to the window around the plugin's own UI.
    win.setMenu(null);

    // A panel gets exactly one web contents. `window.open` would otherwise mint
    // a chromeless window outside the egress policy applied above.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const sendWindowState = () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      win.webContents.send(PLUGIN_PANEL_WINDOW_STATE_CHANNEL, {
        maximized: win.isMaximized(),
      });
    };
    win.on("maximize", sendWindowState);
    win.on("unmaximize", sendWindowState);
    win.webContents.on("did-finish-load", sendWindowState);

    win.on("closed", () => {
      this.windows.delete(request.pluginId);
    });

    this.windows.set(request.pluginId, win);
    await win.loadURL(pathToFileURL(request.htmlPath).toString());
    win.show();
  }

  async close(pluginId: string): Promise<void> {
    const win = this.windows.get(pluginId);
    if (!win || win.isDestroyed()) {
      this.windows.delete(pluginId);
      return;
    }
    win.close();
    this.windows.delete(pluginId);
  }

  async closeAll(): Promise<void> {
    for (const pluginId of [...this.windows.keys()]) {
      await this.close(pluginId);
    }
  }

  /**
   * Push a one-way event to every open plugin panel. The preload maps
   * `pluginBridge.on(event, handler)` to `pi-plugin-panel-event:<event>`, so
   * the host sends on that channel. Panels that do not subscribe are inert
   * receivers; the event names are fixed by the host (e.g. `appearance:changed`).
   */
  broadcast(event: string, payload: unknown): void {
    const channel = `pi-plugin-panel-event:${event}`;
    for (const win of this.windows.values()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(channel, payload);
    }
  }
}
