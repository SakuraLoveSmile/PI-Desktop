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
  assert.match(hostSource, /frame: false/);
  assert.doesNotMatch(hostSource, /titleBarStyle|trafficLightPosition/);
  assert.match(hostSource, /request\.theme === "light"/);
  assert.match(hostSource, /win\.setMenu\(null\)/);
  assert.doesNotMatch(hostSource, /pi-plugin-panel-development=1/);
  assert.match(chromeSource, /PLUGIN_PANEL_TITLEBAR_HEIGHT = 46/);
  assert.match(preloadSource, /-webkit-app-region: drag/);
  assert.match(preloadSource, /className = "capsule"/);
  assert.match(preloadSource, /top: 7px/);
  assert.match(preloadSource, /right: 10px/);
  assert.match(preloadSource, /width: 104px/);
  assert.match(preloadSource, /border-radius: 999px/);
  assert.match(preloadSource, /controls\.append\(minimize, maximize, close\)/);
  assert.doesNotMatch(preloadSource, /platform-darwin|padding-left: 76px|width: 112px/);
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
  assert.match(preloadSource, /pageColor\("backgroundColor"/);
  assert.match(preloadSource, /--pi-plugin-panel-page-background/);
  assert.match(preloadSource, /cursor: pointer/);
  const publicBridgeSource = preloadSource.slice(
    preloadSource.indexOf("const bridge ="),
    preloadSource.indexOf('contextBridge.exposeInMainWorld("pluginBridge"'),
  );
  assert.doesNotMatch(
    publicBridgeSource,
    /windowControl|PLUGIN_PANEL_WINDOW_CONTROL_CHANNEL/,
  );
});

test("plugin content is offset below the host-owned safe area", () => {
  assert.match(preloadSource, /getComputedStyle\(body\)\.paddingTop/);
  assert.match(preloadSource, /padding-top/);
  assert.match(preloadSource, /PLUGIN_PANEL_TITLEBAR_HEIGHT/);
  assert.match(preloadSource, /--pi-plugin-titlebar-height/);
  assert.match(preloadSource, /--pi-plugin-panel-theme=/);
  assert.match(preloadSource, /PLUGIN_PANEL_LOCALE_ARGUMENT_PREFIX/);
  assert.match(preloadSource, /panelLocale\(\)\.toLowerCase\(\)/);
  assert.match(preloadSource, /host\.dataset\.theme = theme/);
  assert.match(preloadSource, /className = "drag-region"/);
  assert.doesNotMatch(preloadSource, /panelTitle|safe-area-hint|isDevelopmentPanel|46px safe area/);
  assert.match(preloadSource, /prefers-reduced-motion: reduce/);
});
