import { BrowserWindow, ipcMain, session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export type PluginPanelOpenRequest = {
  pluginId: string;
  title: string;
  width: number;
  height: number;
  htmlPath: string;
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
  }

  private pluginIdForSender(senderId: number): string | null {
    for (const [pluginId, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents.id === senderId) return pluginId;
    }
    return null;
  }

  async open(request: PluginPanelOpenRequest): Promise<void> {
    const existing = this.windows.get(request.pluginId);
    if (existing && !existing.isDestroyed()) {
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
      webPreferences: {
        session: ses,
        preload: join(__dirname, "../preload/plugin-panel.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });

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
