import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { en } from "../../../packages/i18n/src/locales/en/index.ts";
import { zhCN } from "../../../packages/i18n/src/locales/zh-CN/index.ts";

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
    "fs.write",
    "fs.delete",
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
  assert.match(runtimeSrc, /cannot remove the root itself/);
  // Deleting goes to the OS trash, so a delete this gate got wrong is still
  // recoverable; `rmSync` survives only as the fallback for a host that has no
  // trash to offer.
  assert.match(runtimeSrc, /this\.services\.trashItem\(full\)/);
  // A single-file remove in a loop empties a workspace as well as `rm -rf`;
  // the rolling window is what tells the two apart.
  assert.match(runtimeSrc, /MAX_DELETES_PER_WINDOW/);
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
  assert.match(
    readFileSync(join(desktopRoot, "src/stores/app-store.ts"), "utf8"),
    /pluginRefreshInFlight[\s\S]*if \(pluginRefreshInFlight\) return pluginRefreshInFlight/,
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

// A publisher can list a version before uploading its package. The host then
// refuses the download, so the UI must not offer an install that can only end
// in PLUGIN_MARKET_INVALID.
test("marketplace blocks install for a version with no published package", () => {
  assert.match(pageSrc, /function versionInstallable\(/);
  assert.match(pageSrc, /const packagePending = item\.installable === false/);
  assert.match(pageSrc, /disabled=\{busyId === item\.id \|\| packagePending\}/);
  assert.match(pageSrc, /disabled=\{busyId === detail\.id \|\| detailPackagePending\}/);
  assert.match(pageSrc, /t\("plugins\.packagePending"\)/);
  assert.match(pageSrc, /t\("plugins\.packagePendingHint", \{/);

  const hostSrc = readFileSync(join(repoRoot, "crates/host-core/src/plugins.rs"), "utf8");
  assert.match(hostSrc, /fn has_package_metadata\(version: &MarketVersion\) -> bool/);
  assert.match(hostSrc, /installable: latest_version\.map\(has_package_metadata\)/);
  for (const catalog of [en, zhCN]) {
    assert.equal(typeof catalog.plugins.packagePending, "string");
    assert.equal(typeof catalog.plugins.packagePendingHint, "string");
  }
});
