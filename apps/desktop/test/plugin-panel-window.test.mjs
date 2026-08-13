import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hostSource = await readFile(
  new URL("../electron/main/plugin-panel-host.ts", import.meta.url),
  "utf8",
);
const preloadSource = await readFile(
  new URL("../electron/preload/plugin-panel.ts", import.meta.url),
  "utf8",
);
const chromeSource = await readFile(
  new URL("../electron/shared/plugin-panel-chrome.ts", import.meta.url),
  "utf8",
);

test("plugin panels match the cross-platform main-window chrome contract", () => {
  assert.match(
    hostSource,
    /process\.platform === "darwin"[\s\S]*titleBarStyle: "hiddenInset"[\s\S]*trafficLightPosition: \{ x: 16, y: 16 \}[\s\S]*frame: false/,
  );
  assert.match(hostSource, /nativeTheme\.shouldUseDarkColors/);
  assert.match(chromeSource, /PLUGIN_PANEL_TITLEBAR_HEIGHT = 46/);
  assert.match(preloadSource, /-webkit-app-region: drag/);
  assert.match(preloadSource, /width: 112px/);
  assert.match(preloadSource, /padding-left: 76px/);
});

test("plugin panel window controls stay private, bounded, and accessible", () => {
  for (const action of ["getState", "minimize", "toggleMaximize", "close"]) {
    assert.match(chromeSource, new RegExp(`"${action}"`));
  }
  assert.match(hostSource, /isPluginPanelWindowControlAction\(rawAction\)/);
  assert.match(hostSource, /this\.windowForSender\(event\.sender\.id\)/);
  assert.match(preloadSource, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(preloadSource, /setAttribute\("aria-label", label\)/);
  assert.match(preloadSource, /focus-visible/);
  const publicBridgeSource = preloadSource.slice(
    preloadSource.indexOf("const bridge ="),
    preloadSource.indexOf('contextBridge.exposeInMainWorld("pluginBridge"'),
  );
  assert.doesNotMatch(
    publicBridgeSource,
    /windowControl|PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL/,
  );
});

test("plugin content is offset below the host-owned titlebar", () => {
  assert.match(preloadSource, /getComputedStyle\(body\)\.paddingTop/);
  assert.match(preloadSource, /padding-top/);
  assert.match(preloadSource, /PLUGIN_PANEL_TITLEBAR_HEIGHT/);
  assert.match(preloadSource, /prefers-color-scheme: light/);
  assert.match(preloadSource, /prefers-reduced-motion: reduce/);
});
