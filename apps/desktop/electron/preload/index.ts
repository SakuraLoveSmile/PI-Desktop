import { app, contextBridge, ipcRenderer } from "electron";
import { IPC, IPC_WHITELIST } from "@pi-desktop/shared";

function assertChannel(channel: string) {
  if (!IPC_WHITELIST.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
}

const api = {
  invoke: async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    assertChannel(channel);
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  },
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    assertChannel(channel);
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  channels: IPC,
  // Synchronous platform info so the renderer can style window chrome
  // (traffic lights on macOS vs. controls overlay on Windows/Linux)
  // before first paint, without an IPC round-trip.
  platform: process.platform,
  // Authoritative OS locale. `app.getLocale()` reads the system display
  // language, unlike `navigator.language` in the renderer which defaults
  // to `en-US` regardless of the actual OS language. Surfaced
  // synchronously so the "auto" language resolves correctly without an
  // IPC round-trip.
  locale: app.getLocale(),
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopPreloadApi = typeof api;
