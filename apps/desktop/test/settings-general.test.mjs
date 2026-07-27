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
