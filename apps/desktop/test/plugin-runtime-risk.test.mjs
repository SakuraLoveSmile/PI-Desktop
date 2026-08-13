import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRoot = join(desktopRoot, "../..");

const runtimeSrc = readFileSync(join(desktopRoot, "electron/main/plugin-runtime.ts"), "utf8");
const panelSrc = readFileSync(join(desktopRoot, "electron/main/plugin-panel-host.ts"), "utf8");
const mainSrc = readFileSync(join(desktopRoot, "electron/main/index.ts"), "utf8");
const pageSrc = readFileSync(join(desktopRoot, "src/pages/PluginsPage.tsx"), "utf8");
const protocolSrc = readFileSync(join(repoRoot, "packages/shared/src/protocol.ts"), "utf8");

test("plugin runtime exposes gated high-risk host APIs", () => {
  for (const token of [
    "fs.write.workspace",
    "fs.delete.workspace",
    "net.fetch",
    "shell.openExternal",
    "clipboard.read",
    "clipboard.write",
    "assertPermission",
  ]) {
    assert.match(runtimeSrc, new RegExp(token.replaceAll(".", "\\.")));
  }
});

test("native plugin notifications stay behind the existing notify permission", () => {
  for (const channel of [
    "ui.getNotificationPermission",
    "ui.requestNotificationPermission",
    "ui.showNativeNotification",
  ]) {
    assert.match(runtimeSrc, new RegExp(`\\"${channel}\\"`));
  }
  assert.match(runtimeSrc, /getNotificationPermission: async \(\) => \{/);
  assert.match(runtimeSrc, /requestNotificationPermission: async \(\) => \{/);
  assert.match(runtimeSrc, /showNativeNotification: async \(input/);
  assert.match(runtimeSrc, /this\.assertPermission\(loaded, "notify"\)/);
});

test("workspace deletion and panel operations stay bounded", () => {
  assert.match(runtimeSrc, /PANEL_SKILL_CHANNELS/);
  assert.match(runtimeSrc, /method: "panel.invoke"/);
  assert.match(runtimeSrc, /"fs.remove"/);
  assert.match(runtimeSrc, /recursive: false/);
  assert.match(runtimeSrc, /cannot remove workspace root/);
});

test("plugin panels use sandboxed isolated host windows", () => {
  assert.match(panelSrc, /session\.fromPartition/);
  assert.match(panelSrc, /sandbox:\s*true/);
  assert.match(panelSrc, /nodeIntegration:\s*false/);
  assert.match(panelSrc, /plugin-panel\.js/);
});

test("plugins page includes marketplace install and auto-update controls", () => {
  assert.match(pageSrc, /tabMarket/);
  assert.match(pageSrc, /marketInstall/);
  assert.match(pageSrc, /applyAutoUpdates|marketApplyUpdates|checkUpdates/);
  assert.match(pageSrc, /permissionReview|grantedPermissions/);
});

test("plugins page refreshes installed update metadata when it opens", () => {
  assert.match(pageSrc, /useEffect\(\(\) => \{[\s\S]*api\.marketCheckUpdates\(false\)[\s\S]*refreshPlugins\(\)/);
  assert.match(
    mainSrc,
    /IPC\.invoke\.marketCheckUpdates[\s\S]*refreshRemote: payload\?\.refreshRemote \?\? true/,
  );
});

test("shared protocol declares marketplace and package install IPC", () => {
  for (const channel of [
    "pluginInstallFromPackage",
    "marketSearch",
    "marketInstall",
    "marketCheckUpdates",
    "marketApplyUpdates",
    "marketRefresh",
    "pluginOpenPanel",
    "pluginSetAutoUpdate",
  ]) {
    assert.match(protocolSrc, new RegExp(channel));
  }
});


test("plugins page can refresh the official marketplace repository", () => {
  assert.match(pageSrc, /marketRefresh|refreshMarket|refreshRemote/);
  assert.match(pageSrc, /pi-desktop-plugins|marketSource/);
});


test("marketplace detail pane renders readme changelog and versions", () => {
  assert.match(pageSrc, /marketGetDetail/);
  assert.match(pageSrc, /viewDetails|detailTitle|readmeMarkdown|versions/);
  assert.match(pageSrc, /installVersion|selectedVersion|changelog/);
});
