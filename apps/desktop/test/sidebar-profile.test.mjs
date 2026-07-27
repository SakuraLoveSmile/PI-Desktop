import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);

test("sidebar footer presents a local profile with the notification entry", () => {
  assert.match(sidebarSource, /className="footer-profile-avatar"/);
  assert.match(sidebarSource, /t\("nav\.localProfile"\)/);
  assert.match(sidebarSource, /aria-haspopup="menu"/);
  assert.match(sidebarSource, /aria-controls="sidebar-profile-menu"/);
  assert.match(sidebarSource, /aria-expanded=\{profileOpen\}/);
  assert.match(sidebarSource, /<NotificationCenter onBeforeOpen=\{\(\) => closeMenus\(false\)\} \/>/);
  assert.doesNotMatch(sidebarSource, /IconHelp/);
  assert.doesNotMatch(sidebarSource, /<IconGear size=\{15\}/);
});

test("profile popover keeps its keyboard menu semantics and real actions", () => {
  assert.match(
    sidebarSource,
    /id="sidebar-profile-menu" className="profile-menu" role="menu"/,
  );
  assert.match(sidebarSource, /role="menuitem" data-nav="settings"/);
  assert.match(sidebarSource, /api\.openLogs\(\)/);
  assert.match(sidebarSource, /<IconFileText size=\{15\}/);
  assert.doesNotMatch(sidebarSource, /IconCloudDown/);
  assert.match(sidebarSource, /t\("nav\.profileTheme"\)/);
});
