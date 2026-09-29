import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { EventEmitter } from "node:events";
import test from "node:test";

const electron = `data:text/javascript,${encodeURIComponent(`
  import { EventEmitter } from "node:events";
  let nextId = 1;
  export const shell = { openExternal() {} };
  export const session = { fromPartition() { return {}; } };
  export class WebContentsView {
    constructor() {
      this.bounds = null;
      this.webContents = new EventEmitter();
      this.webContents.id = nextId++;
      this.webContents.isDestroyed = () => false;
      this.webContents.loadURL = async () => {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.close = () => {};
    }
    setBounds(bounds) { this.bounds = { ...bounds }; }
  }
`)}`;
const panelHost = `data:text/javascript,${encodeURIComponent(`
  export function applyPluginEgressPolicy() {}
  export function pluginSessionPartition(pluginId) { return "persist:" + pluginId; }
`)}`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: electron, shortCircuit: true };
    if (specifier === "./plugin-panel-host") return { url: panelHost, shortCircuit: true };
    return next(specifier, context);
  },
});
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
globalThis.__dirname = "/tmp";

const { PluginViewHost } = await import("../electron/main/plugin-view-host.ts");

function browserWindow(zoomFactor = 1) {
  const webContents = new EventEmitter();
  webContents.isDestroyed = () => false;
  webContents.getZoomFactor = () => zoomFactor;
  const children = [];
  return {
    webContents,
    isDestroyed: () => false,
    contentView: {
      children,
      addChildView(view) { children.push(view); },
      removeChildView(view) {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      },
    },
    setZoomFactor(value) { zoomFactor = value; },
  };
}

function openVisibleView(host, window) {
  host.setWindow(window);
  host.open({
    pluginId: "fixture.plugin",
    viewId: "zoom",
    locale: "en",
    theme: "light",
    htmlPath: "/tmp/fixture-plugin.html",
  });
  host.setBounds({ x: 10, y: 20, width: 300, height: 200 });
  host.setVisible("fixture.plugin", "zoom", true);
  return window.contentView.children[0];
}

test("PluginViewHost rescales the visible view when the window zoom changes", () => {
  const window = browserWindow();
  const host = new PluginViewHost();
  const view = openVisibleView(host, window);

  assert.deepEqual(view.bounds, { x: 10, y: 20, width: 300, height: 200 });
  window.setZoomFactor(1.25);
  window.webContents.emit("zoom-changed");
  assert.deepEqual(view.bounds, { x: 13, y: 25, width: 375, height: 250 });
  assert.equal(window.webContents.listenerCount("zoom-changed"), 1);
});

test("PluginViewHost removes the zoom listener when detached or disposed", () => {
  const detachedWindow = browserWindow();
  const detachedHost = new PluginViewHost();
  openVisibleView(detachedHost, detachedWindow);
  detachedHost.setWindow(null);
  assert.equal(detachedWindow.webContents.listenerCount("zoom-changed"), 0);

  const disposedWindow = browserWindow();
  const disposedHost = new PluginViewHost();
  openVisibleView(disposedHost, disposedWindow);
  disposedHost.dispose();
  assert.equal(disposedWindow.webContents.listenerCount("zoom-changed"), 0);
});
