import { BrowserWindow, ipcMain, session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
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
  /** Adds a non-interactive authoring hint to development panels. */
  development?: boolean;
};

type BridgeHandler = (
  pluginId: string,
  channel: string,
  payload?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Hosts isolated plugin panel windows.
 * Each plugin panel gets a dedicated session partition and no Node integration.
 */
export class PluginPanelHost {
  private windows = new Map<string, BrowserWindow>();
  private bridge: BridgeHandler;
  private handlerReady = false;

  constructor(bridge: BridgeHandler) {
    this.bridge = bridge;
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

    const win = new BrowserWindow({
      width: Math.max(360, request.width || 480),
      height: Math.max(280, request.height || 360),
      title: request.title,
      show: false,
      autoHideMenuBar: true,
      // The host theme is only a fallback; the preload samples the actual
      // plugin page colors after it has loaded and paints the chrome from them.
      backgroundColor: request.theme === "light" ? "#ffffff" : "#181818",
      // Match the main application chrome: macOS retains inset traffic lights,
      // while Windows/Linux use renderer-drawn controls in a frameless window.
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 16 },
          }
        : { frame: false }),
      webPreferences: {
        session: ses,
        preload: join(__dirname, "../preload/plugin-panel.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        additionalArguments: [
          `--pi-plugin-panel-title=${encodeURIComponent(request.title)}`,
          `${PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX}${encodeURIComponent(request.locale)}`,
          `--pi-plugin-panel-theme=${request.theme}`,
          ...(request.development
            ? ["--pi-plugin-panel-development=1"]
            : []),
        ],
      },
    });
    if (process.platform !== "darwin") {
      // A frameless panel must not reveal Electron's application menu when the
      // user presses Alt; the host titlebar is the only window chrome.
      win.setMenu(null);
    }

    const sendWindowState = () => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      win.webContents.send(PLUGIN_PANEL_WINDOW_STATE_CHANNEL, {
        maximized: win.isMaximized(),
      });
    };
    if (process.platform !== "darwin") {
      win.on("maximize", sendWindowState);
      win.on("unmaximize", sendWindowState);
      win.webContents.on("did-finish-load", sendWindowState);
    }

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
}
