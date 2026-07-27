import { contextBridge, ipcRenderer } from "electron";

const bridge = {
  invoke: async (channel: string, payload?: Record<string, unknown>) => {
    return ipcRenderer.invoke("pi-plugin-panel-invoke", channel, payload ?? {});
  },
  // Compatibility with the sample panel's older shape.
  send: (channel: string, payload?: Record<string, unknown>) => {
    return ipcRenderer.sendSync("pi-plugin-panel-bridge", channel, payload ?? {});
  },
  on: (event: string, handler: (...args: unknown[]) => void) => {
    const wrapped = (_evt: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args);
    ipcRenderer.on(`pi-plugin-panel-event:${event}`, wrapped);
    return () => ipcRenderer.removeListener(`pi-plugin-panel-event:${event}`, wrapped);
  },
};

contextBridge.exposeInMainWorld("pluginBridge", bridge);

export type PluginPanelBridge = typeof bridge;
