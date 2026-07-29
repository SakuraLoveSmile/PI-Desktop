import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);
const zhLocale = await readFile(
  new URL("../../../packages/i18n/src/locales/zh-CN/index.ts", import.meta.url),
  "utf8",
);
const enLocale = await readFile(
  new URL("../../../packages/i18n/src/locales/en/index.ts", import.meta.url),
  "utf8",
);

test("the sidebar footer is an action bar, not a fabricated identity", () => {
  // The app has no accounts; an avatar with a name implied one that never existed.
  assert.doesNotMatch(sidebarSource, /footer-profile/);
  assert.doesNotMatch(sidebarSource, /profile-menu/);
  assert.doesNotMatch(sidebarSource, /sidebar-profile-menu/);
  assert.doesNotMatch(sidebarSource, /IconUser/);
  assert.doesNotMatch(globalStyles, /\.footer-profile/);
  assert.doesNotMatch(globalStyles, /\.profile-menu/);
  for (const locale of [zhLocale, enLocale]) {
    assert.doesNotMatch(locale, /localProfile:/);
    assert.doesNotMatch(locale, /openProfileMenu:/);
  }
});

test("footer exposes settings, theme and notifications in one row", () => {
  assert.match(sidebarSource, /className="footer-actions"/);
  assert.match(sidebarSource, /data-nav="settings"/);
  assert.match(sidebarSource, /data-nav="theme"/);
  assert.match(
    sidebarSource,
    /<NotificationCenter onBeforeOpen=\{\(\) => closeMenus\(false\)\} \/>/,
  );
  // Logs live in Settings → About; the footer stays down to daily controls.
  assert.doesNotMatch(sidebarSource, /openLogs/);
  // Every action is icon-only, so each needs a label for pointer and AT users.
  const actions = sidebarSource
    .split("<button")
    .filter((chunk) => /className=(?:"footer-action"|\{`footer-action )/.test(chunk));
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const attrs = action.slice(0, action.indexOf(">"));
    assert.match(attrs, /title=/);
    assert.match(attrs, /aria-label=/);
  }
});

test("footer sits on the sidebar content grid under a hairline", () => {
  const block = globalStyles.match(/\.sidebar-footer\s*\{[^}]+\}/)?.[0] ?? "";
  // Zero side padding keeps the chip text and trailing icon aligned with the
  // nav rows that .sidebar-body already insets by 8px.
  assert.match(block, /padding:\s*5px 0 2px/);
  assert.match(block, /border-top:\s*1px solid/);
  assert.match(globalStyles, /\.footer-build\s*\{[^}]*padding:\s*5px 8px/s);
});

test("footer action buttons share the notification trigger's hit target", () => {
  const block = globalStyles.match(/\.footer-action\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(block, /width:\s*32px/);
  assert.match(block, /height:\s*32px/);
  assert.match(block, /transition:[^;]*var\(--motion-duration-fast\)/);
});

test("theme toggle rotates system → light → dark and mirrors the current choice", () => {
  assert.match(sidebarSource, /const THEME_ORDER = \["system", "light", "dark"\] as const/);
  assert.match(sidebarSource, /THEME_ORDER\[\(index \+ 1\) % THEME_ORDER\.length\]/);
  assert.match(
    sidebarSource,
    /theme === "light" \? IconSun : theme === "dark" \? IconMoon : IconMonitor/,
  );
  assert.match(sidebarSource, /api\.setSettings\(\{ \.\.\.current, theme: next \}\)/);
});

test("build chip surfaces the version and only dots an actionable update", () => {
  assert.match(sidebarSource, /const update = useUpdateState\(\)/);
  assert.match(
    sidebarSource,
    /update\?\.status === "available" \|\| update\?\.status === "downloaded"/,
  );
  assert.match(sidebarSource, /className="footer-build-dot"/);
  // An actionable update routes to the Settings row that can act on it.
  assert.match(sidebarSource, /setSettingsAnchor\("updates\.title"\)/);
  assert.match(sidebarSource, /setSettingsTab\("about"\)/);
  assert.match(sidebarSource, /api\.updatesCheck\(\)/);
  const dot = globalStyles.match(/\.footer-build-dot\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(dot, /background:\s*var\(--ds-accent\)/);
});
