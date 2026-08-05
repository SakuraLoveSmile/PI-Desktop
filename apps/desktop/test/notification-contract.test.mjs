import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [protocolSource, mainSource, apiSource, storeSource, appSource, sidebarSource] =
  await Promise.all([
    read("../../../packages/shared/src/protocol.ts"),
    read("../electron/main/index.ts"),
    read("../src/lib/api.ts"),
    read("../src/stores/app-store.ts"),
    read("../src/App.tsx"),
    read("../src/components/Sidebar.tsx"),
  ]);

test("notification IPC stays behind the shared preload allowlist", () => {
  assert.match(protocolSource, /PROTOCOL_VERSION = 9/);
  for (const channel of [
    "notificationList",
    "notificationMarkRead",
    "notificationMarkAllRead",
    "notificationClear",
    "notificationShowNative",
    "notificationSetViewingSession",
    "notificationChanged",
    "notificationActivated",
  ]) {
    assert.match(protocolSource, new RegExp(`${channel}:`), channel);
  }
  assert.match(apiSource, /listNotifications:/);
  assert.match(apiSource, /setNotificationViewingSession:/);
  assert.match(apiSource, /onNotificationChanged:/);
  assert.match(apiSource, /onNotificationActivated:/);
});

test("terminal notifications flow from host completion to the renderer", () => {
  assert.match(mainSource, /session\.endTurn/);
  assert.match(mainSource, /result\.notification/);
  assert.match(mainSource, /IPC\.event\.notificationChanged/);
  assert.match(storeSource, /receiveNotification:/);
  assert.match(storeSource, /unreadNotificationCount/);
  assert.match(appSource, /api\.onNotificationChanged/);
  assert.match(sidebarSource, /<NotificationCenter onBeforeOpen=\{\(\) => closeMenus\(false\)\} \/>/);
  assert.doesNotMatch(appSource, /<NotificationCenter \/>/);
  const changedHandler = appSource.match(
    /api\.onNotificationChanged[\s\S]*?\n\s*\}\);/,
  )?.[0] ?? "";
  assert.match(changedHandler, /receiveNotification/);
  assert.doesNotMatch(changedHandler, /selectSession|openNotification/);
});

test("the visible chat session suppresses durable task notifications", () => {
  assert.match(mainSource, /notificationViewingSessionId === sessionId/);
  assert.match(mainSource, /mainWindow\.isVisible\(\)/);
  assert.match(mainSource, /mainWindow\.isFocused\(\)/);
  assert.match(mainSource, /createNotification,/);
  assert.match(mainSource, /"did-start-loading"[\s\S]*notificationViewingSessionId = null/);
  assert.match(mainSource, /"render-process-gone"[\s\S]*notificationViewingSessionId = null/);
  assert.match(appSource, /page === "chat" \? activeSessionId \?\? null : null/);
  assert.match(appSource, /setNotificationViewingSession\(viewingSessionId\)/);
});

test("native notifications only show for an unfocused window and navigate back", () => {
  assert.match(mainSource, /app\.setAppUserModelId\(APP_ID\)/);
  assert.match(mainSource, /mainWindow\.isFocused\(\)/);
  assert.match(mainSource, /SystemNotification\.isSupported\(\)/);
  assert.match(mainSource, /new SystemNotification/);
  assert.match(mainSource, /IPC\.event\.notificationActivated/);
  assert.match(mainSource, /mainWindow\.restore\(\)/);
  assert.match(appSource, /showNativeNotification/);
  assert.match(appSource, /openNotification\(id\)/);
  assert.match(
    storeSource,
    /await get\(\)\.selectSession\(notification\.sessionId,\s*\{\s*navigationIntent: intent/,
  );
});
