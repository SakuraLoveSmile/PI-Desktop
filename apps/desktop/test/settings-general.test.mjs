import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPageSource = await readFile(
  new URL("../src/pages/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const settingsSearchSource = await readFile(
  new URL("../src/lib/settings-search.ts", import.meta.url),
  "utf8",
);
const providersSource = await readFile(
  new URL("../src/components/settings/ProvidersSection.tsx", import.meta.url),
  "utf8",
);
const languageSource = await readFile(
  new URL("../src/lib/app-language.ts", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const sharedTypesSource = await readFile(
  new URL("../../../packages/shared/src/types.ts", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

test("basics tab exposes language, default mode, enter-to-send, and permission mode", () => {
  assert.match(settingsPageSource, /settings\.language/);
  assert.match(settingsPageSource, /settings\.languageAuto/);
  assert.match(settingsPageSource, /"zh-CN"/);
  assert.match(settingsPageSource, /defaultMode: value/);
  assert.match(settingsPageSource, /enterToSend: !settings\.enterToSend/);
  assert.match(
    settingsPageSource,
    /defaultPermissionMode: e\.target\.value as GlobalPermissionMode/,
  );
  assert.match(settingsPageSource, /"accept-edits"/);
});

test("language persists as part of shared app settings", () => {
  assert.match(sharedTypesSource, /language\?: "auto" \| "en" \| "zh-CN"/);
});

test("basics gates developer tools behind a persisted developer mode", () => {
  assert.match(sharedTypesSource, /developerMode\?: boolean/);
  assert.match(settingsPageSource, /function DeveloperSection/);
  assert.match(settingsPageSource, /role="switch"/);
  assert.match(settingsPageSource, /saveSettings\(\{ developerMode: !enabled \}\)/);
  assert.match(settingsPageSource, /api\.toggleDevTools\(true\)/);
  assert.match(settingsPageSource, /disabled=\{!enabled\}/);
  for (const key of [
    "settings.developer",
    "settings.developerMode",
    "settings.devTools",
  ]) {
    assert.match(settingsSearchSource, new RegExp(key.replace(".", "\\.")));
  }
});

test("stored language drives i18n at startup and on settings change", () => {
  assert.match(languageSource, /export function initLanguageSync/);
  assert.match(languageSource, /changeLanguage/);
  assert.match(languageSource, /resolveLocale/);
  assert.match(mainSource, /initLanguageSync\(\)/);
});

test("model configuration keeps model defaults; basics owns app behavior", () => {
  assert.match(providersSource, /settings\.defaultModel/);
  assert.doesNotMatch(providersSource, /enterToSend/);
  assert.doesNotMatch(providersSource, /settings\.modeAgent/);
});


test("settings nav icons map each destination to a semantic lucide glyph", () => {
  assert.match(settingsPageSource, /general: <IconSliders/);
  assert.match(settingsPageSource, /ai: <IconSparkles/);
  assert.match(settingsPageSource, /shortcuts: <IconKeyboard/);
  assert.match(settingsPageSource, /agent: <IconBot/);
  assert.match(settingsPageSource, /import: <IconDownload/);
  assert.match(settingsPageSource, /projects: <IconArchive/);
  assert.match(settingsPageSource, /about: <IconInfo/);
  assert.doesNotMatch(settingsPageSource, /general: <IconSettings/);
  assert.doesNotMatch(settingsPageSource, /agent: <IconConfig/);
  assert.doesNotMatch(settingsPageSource, /import: <IconSnapshot/);
});

test("settings nav renders grouped sections with keyword search", () => {
  assert.match(settingsPageSource, /settings-nav-group-label/);
  assert.match(settingsSearchSource, /settings\.groupPersonal/);
  assert.match(settingsSearchSource, /settings\.groupIntegrations/);
  assert.match(settingsSearchSource, /keywordKeys/);
  assert.match(settingsSearchSource, /settings\.projectArchive/);
  assert.match(stylesSource, /\.settings-nav-group-label\s*\{/);
  assert.match(
    stylesSource,
    /\.settings-row\.settings-row-plain\s*\{[^}]*border-bottom:\s*0/s,
  );
});

test("settings native select menus keep readable theme colors on Windows", () => {
  assert.match(
    stylesSource,
    /\.settings-shell select option,\s*\.settings-shell select optgroup\s*\{[^}]*background-color:\s*var\(--ds-bg-elevated-opaque\);[^}]*color:\s*var\(--ds-text-primary\);/s,
  );
  assert.match(
    stylesSource,
    /:root,\s*:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark;/s,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light;/s,
  );
});
