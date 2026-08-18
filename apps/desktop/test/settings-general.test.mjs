import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

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
const pluginsPageSource = await readFile(
  new URL("../src/pages/PluginsPage.tsx", import.meta.url),
  "utf8",
);
const marketplaceSettingsSource = await readFile(
  new URL(
    "../src/components/plugins/MarketplaceSourceSettings.tsx",
    import.meta.url,
  ),
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
const electronMainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const preloadSource = await readFile(
  new URL("../electron/preload/index.ts", import.meta.url),
  "utf8",
);
const sharedTypesSource = await readFile(
  new URL("../../../packages/shared/src/types.ts", import.meta.url),
  "utf8",
);
const stylesSource = await loadStyles();

test("General and AI tabs expose their respective app and AI controls", () => {
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
  assert.ok(
    settingsPageSource.indexOf('{tab === "ai" && settings && (') <
      settingsPageSource.indexOf("defaultPermissionMode: e.target.value"),
    "permission mode remains in the AI tab",
  );
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

test("sandboxed preload receives the OS locale without importing main-only APIs", () => {
  assert.match(electronMainSource, /additionalArguments:\s*\[`--pi-desktop-locale=\$\{app\.getLocale\(\)\}`\]/);
  assert.match(preloadSource, /const LOCALE_ARGUMENT_PREFIX = "--pi-desktop-locale="/);
  assert.match(preloadSource, /process\.argv[\s\S]*startsWith\(LOCALE_ARGUMENT_PREFIX\)/);
  assert.doesNotMatch(preloadSource, /import\s*\{[^}]*\bapp\b[^}]*\}\s*from "electron"/);
  assert.doesNotMatch(preloadSource, /locale:\s*app\.getLocale\(\)/);
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
  assert.match(settingsPageSource, /instructions: <IconFileText/);
  assert.match(settingsPageSource, /agent: <IconBot/);
  assert.match(settingsPageSource, /import: <IconDownload/);
  assert.match(settingsPageSource, /projects: <IconArchive/);
  assert.match(settingsPageSource, /about: <IconInfo/);
  assert.doesNotMatch(settingsPageSource, /general: <IconSettings/);
  assert.doesNotMatch(settingsPageSource, /agent: <IconConfig/);
  assert.doesNotMatch(settingsPageSource, /import: <IconSnapshot/);
});

test("settings nav is a flat eight-destination directory with keyword search", () => {
  assert.match(settingsPageSource, /filteredItems\.map/);
  assert.doesNotMatch(settingsPageSource, /settings-nav-group-label/);
  assert.doesNotMatch(settingsSearchSource, /settings\.groupPersonal/);
  assert.doesNotMatch(settingsSearchSource, /settings\.groupIntegrations/);
  assert.doesNotMatch(settingsSearchSource, /id: "extensions"/);
  const navOrder = [
    "general",
    "ai",
    "shortcuts",
    "instructions",
    "agent",
    "import",
    "projects",
    "about",
  ].map((id) => settingsSearchSource.indexOf(`id: "${id}"`));
  assert.ok(navOrder.every((index) => index >= 0));
  assert.deepEqual(navOrder, [...navOrder].sort((a, b) => a - b));
  assert.match(settingsSearchSource, /keywordKeys/);
  assert.match(settingsSearchSource, /settings\.projectArchive/);
  assert.match(stylesSource, /\.settings-nav-item\s*\{/);
  assert.match(
    stylesSource,
    /\.settings-row\.settings-row-plain\s*\{[^}]*border-bottom:\s*0/s,
  );
});

test("marketplace source settings live inside the Plugins marketplace surface", () => {
  assert.match(pluginsPageSource, /<MarketplaceSourceSettings/);
  assert.match(marketplaceSettingsSource, /api\.marketRefresh\(true\)/);
  assert.match(marketplaceSettingsSource, /settings\.marketProvider/);
  assert.doesNotMatch(settingsPageSource, /ExtensionMarketSection/);
  assert.doesNotMatch(settingsPageSource, /tab === "extensions"/);
});

test("native select menus keep readable theme colors across the app on Windows", () => {
  assert.match(
    stylesSource,
    /select option,\s*select optgroup\s*\{[^}]*background-color:\s*var\(--ds-bg-elevated-opaque\);[^}]*color:\s*var\(--ds-text-primary\);/s,
  );
  assert.match(stylesSource, /select\s*\{[^}]*color-scheme:\s*inherit;/s);
  assert.match(
    stylesSource,
    /:root,\s*:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark;/s,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\]\s*\{[^}]*color-scheme:\s*light;/s,
  );
});
