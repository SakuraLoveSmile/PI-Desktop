// Mounted production SettingsPage; only the preload boundary uses fixture data.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { IPC } from "@pi-desktop/shared";
import { SettingsPage } from "../../apps/desktop/src/features/settings/SettingsPage";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { initLanguageSync } from "../../apps/desktop/src/lib/app-language";
import { createSkillsFixture, exerciseSkillsPage, exerciseSkillsNarrow } from "./settings-skills-fixture";

import { createModelsFixture } from "./settings-models-fixture";
import { createPreferencesFixture } from "./settings-preferences-fixture";
import { createWorkspaceFixture } from "./settings-workspace-fixture";
import { createCapabilitiesFixture } from "./settings-capabilities-fixture";
import { createExtensionsFixture } from "./settings-extensions-fixture";

const destinations = ["A", "B"].map((id) => ({
  ref: `fixture:${id}`, pluginId: "fixture", label: `Themes ${id}`, keywords: [],
  icon: id === "A" ? "bell" : "future-icon",
  description: "Fixture theme collection", themes: Array.from({ length: 12 }, (_, index) => ({
    themeId: `plugin:fixture:${id}${index}`, label: `Theme ${index}`, description: "Preview",
    previewUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", blur: 6,
  })),
}));
const fixtureParameters = new URLSearchParams(window.location.search);
const requestedLocale = fixtureParameters.get("locale");
const locale = ["en", "zh-CN", "zh-TW"].includes(requestedLocale) ? requestedLocale : "en";
const theme = fixtureParameters.get("theme") === "dark" ? "dark" : "light";
const skillsFixture = createSkillsFixture(fixtureParameters);
const allPages = fixtureParameters.get("preview") === "all";
const modelsFixture = createModelsFixture(fixtureParameters);
const preferencesFixture = createPreferencesFixture(fixtureParameters);
const workspaceFixture = createWorkspaceFixture(fixtureParameters);
const capabilitiesFixture = createCapabilitiesFixture(fixtureParameters);
const extensionsFixture = createExtensionsFixture({
  configured: fixtureParameters.get("sync") === "configured",
  approvals: fixtureParameters.get("sync") === "configured",
  remoteError: fixtureParameters.get("remote") === "error",
  remoteHosts: allPages ? [{ hostKey: "fixture-linux", label: "Development server", url: "ssh://dev@192.0.2.10:22", connected: true, transport: "ssh" }] : [],
});
const saveControls = { failSave: false, failRefresh: false, deferRefresh: false };
let resolveSettingsRefresh;
const fixtures = allPages
  ? [preferencesFixture, workspaceFixture, capabilitiesFixture, modelsFixture, extensionsFixture, skillsFixture]
  : [preferencesFixture, skillsFixture];
let settings = {
  defaultMode: "agent",
  theme,
  language: locale,
  enterToSend: true,
  developerMode: allPages,
  ...(allPages ? preferencesFixture.initialSettings : {}),
};
let updateState = {
  mode: "in-app",
  preference: "automatic",
  defaultPreference: "automatic",
  automaticSupported: true,
  manualReminder: false,
  status: "available",
  currentVersion: "0.15.8",
  availableVersion: "0.15.9",
  releasesUrl: "https://github.com/vastsa/PI-Desktop/releases/latest",
};
const updateStateListeners = new Set();
window.piDesktop = {
  platform: "darwin",
  on(channel, listener) {
    if (channel === IPC.event.updatesState) updateStateListeners.add(listener);
    const dispose = extensionsFixture.on(channel, listener);
    const disposeModels = modelsFixture.on(channel, listener);
    return () => { updateStateListeners.delete(listener); dispose(); disposeModels(); };
  },
  async invoke(channel, input) {
    for (const fixture of fixtures) {
      const result = await fixture.invoke(channel, input);
      if (result.handled) return { ok: true, data: result.data };
    }
    let data;
    switch (channel) {
      case IPC.invoke.pluginScenicThemesDestinations: data = destinations; break;
      case IPC.invoke.settingsGet:
        if (saveControls.failRefresh) throw new Error("Fixture settings refresh failed");
        data = structuredClone(settings);
        if (saveControls.deferRefresh) await new Promise(resolve => { resolveSettingsRefresh = resolve; });
        break;
      case IPC.invoke.settingsSet:
        if (saveControls.failSave) throw new Error("Fixture settings write failed");
        settings = { ...settings, ...input };
        data = settings;
        if (settings.updatePreference === "automatic" || settings.updatePreference === "manual") {
          updateState = {
            ...updateState,
            preference: settings.updatePreference,
            mode: settings.updatePreference === "automatic" ? "in-app" : "manual",
          };
          for (const listener of updateStateListeners) listener(updateState);
        }
        break;
      case IPC.invoke.providersList: data = { providers: [] }; break;
      case IPC.invoke.sessionList: data = { sessions: [] }; break;
      case IPC.invoke.appGetOnboarding: data = {}; break;
      case IPC.invoke.updatesGetState: data = updateState; break;
      case IPC.invoke.systemFontsList: data = ["Arial", "Helvetica"]; break;
      case IPC.invoke.storageGet:
        data = { dataPath: "/fixture/data", browserPath: "/fixture/browser", managed: true,
          cacheBytes: 1024, pendingPath: null, lastError: null, backupPaths: [] };
        break;
      case IPC.invoke.configSyncGetState:
        data = {
          configured: false,
          enabled: false,
          paused: false,
          locked: false,
          status: "notConfigured",
          remoteMode: "strict",
          categories: {},
          includeSecrets: false,
          includeMemory: false,
          automaticSync: false,
          pendingApprovals: [],
          mappings: [],
        };
        break;
      case IPC.invoke.commandShellList: data = { choices: [], effective: null }; break;
      default: throw new Error(`Unexpected fixture IPC: ${channel}`);
    }
    return { ok: true, data };
  },
};
await i18n.use(initReactI18next).init({
  lng: locale,
  fallbackLng: "en",
  keySeparator: false,
  resources: {
    en: { translation: flattenCatalog(catalogs.en) },
    "pt-BR": { translation: flattenCatalog(catalogs["pt-BR"]) },
    "zh-CN": { translation: flattenCatalog(catalogs["zh-CN"]) },
    "zh-TW": { translation: flattenCatalog(catalogs["zh-TW"]) },
  },
  interpolation: { escapeValue: false },
});
document.documentElement.dataset.theme = theme;
const knownTabs = ["general", "ai", "voice", "shortcuts", "instructions", "agent", "skills", "mcp", "subagents", "expertTeam", "import", "projects", "memory", "sync", "remoteHosts", "about"];
useAppStore.setState({ settings, settingsTab: knownTabs.includes(fixtureParameters.get("tab")) ? fixtureParameters.get("tab") : "ai", page: "settings",
  version: { name: "Pi-Desktop-Plus", version: "0.15.8", protocolVersion: 1, hostVersion: "0.15.8" },
  ...(allPages ? { sessions: workspaceFixture.sessions, projects: workspaceFixture.projects, projectGroups: workspaceFixture.groups,
    providers: fixtureParameters.has("voice") ? preferencesFixture.providers : modelsFixture.providers } : {}),
});
initLanguageSync();
const root = createRoot(document.getElementById("root"));
flushSync(() => root.render(<SettingsPage />));
const frame = () => new Promise(requestAnimationFrame);
async function settle() { await frame(); await frame(); }
function assert(value, message) { if (!value) throw new Error(message); }
const pane = () => document.querySelector(".settings-content");
const navButton = (label) => [...document.querySelectorAll(".settings-nav-item")]
  .find((node) => node.querySelector(".settings-nav-label")?.textContent?.trim() === label);
async function select(label) {
  const trigger = document.querySelector(".settings-categories-toggle");
  if (trigger && !document.querySelector(".settings-directory-dialog[open]")) {
    flushSync(() => trigger.click()); await settle();
  }
  const button = navButton(label);
  assert(button, `Missing destination: ${label}`);
  flushSync(() => button.click());
  await settle();
}
async function setSettingsSearch(value) {
  const input = document.querySelector(".settings-search");
  assert(input instanceof HTMLInputElement, "Settings search input must be rendered");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert(setter, "Settings search input must expose its value setter");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
async function pressSettingsKey(key, options = {}) {
  const target = document.activeElement;
  assert(target instanceof HTMLElement, "A settings control must own keyboard focus");
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  await settle();
}
async function exerciseSearchNavigation() {
  assert(navButton("Themes A").querySelector("svg")?.classList.contains("lucide-bell"),
    "Plugin navigation must render the declared host icon");
  assert(navButton("Themes B").querySelector("svg")?.classList.contains("lucide-palette"),
    "Unknown plugin icons must retain the host fallback icon");
  await select("Shortcuts");
  await setSettingsSearch("Enter to send");
  const match = navButton("Enter to send");
  assert(match, "Rail search must show the actual matching setting rather than only its category");
  assert(match.querySelector(".settings-search-result-context")?.textContent?.includes("AI"),
    "A setting search result must identify its owning category");

  const input = document.querySelector(".settings-search");
  input.focus();
  await pressSettingsKey("Enter", { isComposing: true });
  assert(useAppStore.getState().settingsTab === "shortcuts" && !document.querySelector(".settings-anchor-flash"),
    "IME confirmation must not open a search result");
  await pressSettingsKey("ArrowDown");
  assert(document.activeElement === match, "Arrow Down from search must focus its first result");
  input.focus();
  await pressSettingsKey("ArrowUp");
  assert(document.activeElement === [...document.querySelectorAll(".settings-nav-item")].at(-1),
    "Arrow Up from search must focus its last result");
  input.focus();
  await pressSettingsKey("Enter");
  assert(useAppStore.getState().settingsTab === "ai", "Enter from search must open the matching category");
  const target = document.querySelector(".settings-anchor-flash");
  assert(target?.textContent?.includes("Enter to send"), "Search must locate and highlight the matching setting");
  const bounds = target.getBoundingClientRect(), viewport = pane().getBoundingClientRect();
  assert(bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
    "The matched setting must be visible without a second manual search");
  assert(input.value === "Enter to send", "Opening a match must retain the query for orientation");

  input.focus();
  await pressSettingsKey("Escape");
  assert(input.value === "" && navButton("General") && navButton("Info"),
    "Escape must clear search and restore the full directory");
  await setSettingsSearch("Themes A");
  assert(navButton("Themes A"), "Search must find matching plugin destinations");
  assert(!document.querySelector(".settings-nav").textContent.includes(i18n.t("settings.noResults")),
    "Plugin matches must not coexist with a no-results message");
  await select("Themes A");
  const extension = document.querySelector(".plugin-scenic-themes-destination");
  const blurSlider = extension?.querySelector('input[type="range"]');
  assert(extension && !extension.querySelector("iframe") && extension.querySelector('button[aria-pressed]') &&
    blurSlider?.labels?.[0]?.textContent === i18n.t("settings.pluginScenic.backdropBlur") &&
    [...extension.querySelectorAll("button")].some(button => button.textContent.trim() === i18n.t("settings.pluginScenic.apply")),
    "Scenic destinations must expose host-rendered theme controls and an explicit Apply action");
  const clear = document.querySelector(`button[aria-label="${i18n.t("settings.clearSearch")}"]`);
  assert(clear instanceof HTMLButtonElement, "An active search must offer a named clear action");
  flushSync(() => clear.click());
  await settle();
  assert(input.value === "" && document.activeElement === input, "Clear search must restore the directory and input focus");
  assert(document.querySelectorAll(".settings-nav-item.active").length === 1,
    "Opening a plugin must leave exactly one highlighted navigation item");
  const current = document.querySelectorAll('.settings-nav-item[aria-current="page"]');
  assert(current.length === 1 && current[0] === navButton("Themes A"),
    "Only the currently open plugin may identify itself as the current page");
  await select("AI");
  assert(!document.querySelector(".plugin-scenic-themes-destination") &&
    document.querySelector('[role="radiogroup"][aria-label="' + i18n.t("settings.thinkingDisplayMode") + '"]'),
    "Core navigation must replace the plugin destination with the selected Settings page");
  assert(document.querySelectorAll('.settings-nav-item[aria-current="page"]').length === 1 &&
    navButton("AI").getAttribute("aria-current") === "page", "Returning to a built-in page must update the unique current item");

  await setSettingsSearch("no-such-setting-or-plugin");
  assert(document.querySelector('.settings-nav [role="status"]')?.textContent?.includes(i18n.t("settings.noResults")),
    "An unmatched query must explain that no settings matched");
  assert(!document.querySelector(".settings-nav-group"), "Unmatched queries must not leave empty group headings");
  document.querySelector(".settings-search").focus();
  await pressSettingsKey("Escape");
  return { directSearch: true, keyboardSearch: true, pluginSearch: true, uniqueCurrentPage: true };
}
async function checkCloudSyncVisibility() {
  await setSettingsSearch("Cloud sync");
  assert(!navButton("Cloud sync"), "Cloud sync must be absent from search without developer mode");
  await setSettingsSearch("");

  settings = { ...settings, developerMode: true };
  flushSync(() => useAppStore.setState({ settings }));
  await settle();
  await setSettingsSearch("Cloud sync");
  const syncButton = navButton("Cloud sync");
  assert(syncButton, "Cloud sync must appear in settings search with developer mode");
  assert(
    syncButton.querySelector(".settings-nav-experimental")?.textContent?.trim() === "Experimental",
    "Cloud sync's rail entry must be marked Experimental",
  );

  flushSync(() => syncButton.click());
  await settle();
  assert(
    document.querySelector(".settings-section-title")?.textContent?.includes("Experimental"),
    "Cloud sync's page title must be marked Experimental",
  );

  settings = { ...settings, developerMode: false };
  flushSync(() => useAppStore.setState({ settings }));
  await settle();
  assert(
    useAppStore.getState().settingsTab === "general",
    "A Cloud sync page hidden by developer mode must return to General",
  );
  assert(!navButton("Cloud sync"), "Cloud sync must leave the rail when developer mode is off");
  await setSettingsSearch("");
}
async function scroll() {
  pane().scrollTop = 220;
  await settle();
  assert(pane().scrollTop > 0, "Destination must be scrollable for this check");
  return pane().scrollTop;
}
async function exerciseUpdatePreference() {
  await select("Info");
  await settle();
  const trigger = () => document.querySelector('button[aria-label="Update behavior"]');
  assert(trigger() instanceof HTMLButtonElement, "Update behavior selector must render");
  assert(trigger().textContent?.includes("Automatic"), "Installed package defaults to Automatic");
  const notes = [...document.querySelectorAll(".update-settings-actions button")]
    .find(button => button.textContent.trim() === i18n.t("updates.releaseNotes"));
  assert(notes instanceof HTMLButtonElement, "Info must expose release notes as a named action");
  notes.focus();
  flushSync(() => notes.click());
  const notesDeadline = performance.now() + 4000;
  while (!document.querySelector('[role="dialog"] [data-release-version]') && performance.now() < notesDeadline) await settle();
  const notesDialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  assert(notesDialog?.querySelector('[data-release-version]') && notesDialog.textContent.includes(i18n.t("updates.releaseNotes")),
    "Release notes must load the bundled catalog in an accessible dialog");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle();
  assert(!document.querySelector('[role="dialog"]') && document.activeElement === notes,
    "Escape must close release notes and restore the Info action's focus");
  assert(
    [...document.querySelectorAll(".update-settings-actions button")]
      .some((button) => button.textContent?.includes("Check for updates")),
    "Automatic mode keeps the existing update check action",
  );

  async function choosePreference(label, value) {
    const selectTrigger = trigger();
    assert(selectTrigger instanceof HTMLButtonElement, "Update selector trigger must remain mounted");
    flushSync(() => selectTrigger.click());
    await settle();
    const option = [...document.querySelectorAll('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === label);
    assert(option instanceof HTMLButtonElement, `Missing update preference option: ${label}`);
    flushSync(() => option.click());
    await settle();
    assert(settings.updatePreference === value, `${label} preference must persist through settings IPC`);
    assert(settings.language === "en", "Saving update preference must preserve unrelated language settings");
    assert(useAppStore.getState().settings?.updatePreference === value, `${label} preference must update the renderer store`);
    assert(updateState.preference === value, `${label} preference must update the shared update state`);
  }

  await choosePreference("Manual", "manual");
  assert(trigger().textContent?.includes("Manual"), "Manual must become the selected value");
  assert(
    [...document.querySelectorAll(".update-settings-actions button")]
      .some((button) => button.textContent?.includes("View release")),
    "Manual mode must offer the release page for an available version",
  );

  await select("AI");
  await select("Info");
  await settle();
  assert(trigger().textContent?.includes("Manual"), "Manual preference must survive leaving and reopening Info");
  await choosePreference("Automatic", "automatic");
  assert(trigger().textContent?.includes("Automatic"), "Automatic must be selectable again");
  return { updatePreference: settings.updatePreference, updateMode: updateState.mode, releaseNotes: true };
}

async function exerciseThinkingDisplay() {
  await select("AI");
  const group = () => document.querySelector('[role="radiogroup"][aria-label="' + i18n.t("settings.thinkingDisplayMode") + '"]');
  const choose = async (label, value) => {
    const option = [...(group()?.querySelectorAll('[role="radio"]') ?? [])].find(button => button.textContent.trim() === i18n.t(label));
    assert(option instanceof HTMLButtonElement, "Thinking display option is available in Settings");
    flushSync(() => option.click());
    await settle();
    assert(settings.thinkingDisplayMode === value && useAppStore.getState().settings?.thinkingDisplayMode === value &&
      option.getAttribute("aria-checked") === "true", "Thinking display choice must persist and become visibly selected");
  };
  await choose("settings.thinkingDisplayCompact", "compact");
  await select("General");
  await select("AI");
  assert([...group().querySelectorAll('[role="radio"]')].some(option =>
    option.textContent.trim() === i18n.t("settings.thinkingDisplayCompact") && option.getAttribute("aria-checked") === "true"),
    "Thinking display must survive leaving and reopening its Settings page");
  await choose("settings.thinkingDisplayDetailed", "detailed");
  return { thinkingDisplay: true };
}

async function exerciseBrazilianPortuguese() {
  await select("General");
  const trigger = document.querySelector(".settings-language-trigger");
  assert(trigger instanceof HTMLButtonElement, "Language picker trigger must render");
  flushSync(() => trigger.click());
  await settle();

  const search = document.querySelector(".settings-language-search input");
  assert(search instanceof HTMLInputElement, "Language picker search must render");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  assert(setter, "Language search input must expose its value setter");
  setter.call(search, "Português (Brasil)");
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();

  const option = [...document.querySelectorAll(".settings-language-option")]
    .find((candidate) => candidate.textContent?.includes("Português (Brasil)"));
  assert(option instanceof HTMLButtonElement, "Brazilian Portuguese must be searchable");
  const languageChanged = new Promise((resolve) => i18n.once("languageChanged", resolve));
  flushSync(() => option.click());
  await languageChanged;
  await settle();

  assert(settings.language === "pt-BR", "Choosing Portuguese must persist pt-BR");
  assert(useAppStore.getState().settings?.language === "pt-BR", "App settings must retain pt-BR");
  assert(document.documentElement.lang === "pt-BR", "Document language must update to pt-BR");
  assert(navButton("Geral"), "Settings navigation must switch to Brazilian Portuguese");
  assert(!navButton("General"), "English navigation must be replaced after switching locales");
  const languageTitle = [...document.querySelectorAll(".settings-row-title")]
    .find((node) => node.textContent?.trim() === "Idioma");
  assert(languageTitle, "The language setting label must be translated");
  const selectedLabel = document.querySelector(".settings-language-trigger-label");
  assert(selectedLabel?.textContent?.trim() === "Português (Brasil)", "Picker must show the selected native name");
  return { locale: i18n.language, language: settings.language, label: selectedLabel.textContent.trim() };
}
window.settingsScrollProbe = async () => {
  await settle();
  assert(
    document.activeElement === document.querySelector(".settings-search"),
    "Mounting Settings must move focus to its search control",
  );
  const checks = [];
  checks.push(await exerciseSearchNavigation());
  checks.push(await exerciseThinkingDisplay());
  await checkCloudSyncVisibility();
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    await select("AI");
    const position = await scroll();
    await select("AI");
    assert(pane().scrollTop === position, "Re-selecting AI must retain scroll");
    flushSync(() => useAppStore.setState({ settings: { ...settings, enterToSend: false } }));
    await settle();
    assert(pane().scrollTop === position, "Settings updates must retain scroll");
    await select("Shortcuts");
    assert(pane().scrollTop === 0, "AI → Shortcuts must start at top");
    await scroll();
    await select("AI");
    assert(pane().scrollTop === 0, "Returning to AI must start at top");
    await scroll();
    await select("Themes A");
    assert(pane().scrollTop === 0, "Built-in → extension must start at top");
    const extensionPosition = await scroll();
    await select("Themes A");
    assert(pane().scrollTop === extensionPosition, "Re-selecting extension must retain scroll");
    await select("Themes B");
    assert(pane().scrollTop === 0, "Extension → extension must start at top");
    await scroll();
    await select("AI");
    assert(pane().scrollTop === 0, "Extension → unchanged built-in tab must start at top");
    await select("Themes A");
    await scroll();
    flushSync(() => useAppStore.getState().setSettingsTab("shortcuts"));
    assert(!document.querySelector(".plugin-scenic-theme-card"), "External tab change must leave the plugin");
    assert(document.querySelector(".settings-section-title")?.textContent?.includes("Shortcuts"), "Shortcuts must replace the plugin");
    assert(pane().scrollTop === 0, "External tab change must start at the top");
    await select("Themes A");
    await scroll();
    flushSync(() => {
      useAppStore.getState().setSettingsAnchor("settings.enterToSend");
      useAppStore.getState().setSettingsTab("ai");
    });
    assert(!document.querySelector(".plugin-scenic-theme-card"), "Search must leave the plugin destination");
    const fromPlugin = document.querySelector(".settings-anchor-flash");
    assert(fromPlugin && pane().scrollTop > 0, "Search from a plugin must be positioned before paint");
    const fromPluginBounds = fromPlugin.getBoundingClientRect();
    const fromPluginViewport = pane().getBoundingClientRect();
    assert(fromPluginBounds.top >= fromPluginViewport.top && fromPluginBounds.bottom <= fromPluginViewport.bottom,
      "Search from a plugin must show the target");
    // The same public store entry points used by SearchDialog.openSettingsHit.
    await select("Shortcuts");
    await scroll();
    flushSync(() => {
      useAppStore.getState().setSettingsAnchor("settings.enterToSend");
      useAppStore.getState().setSettingsTab("ai");
    });
    const target = document.querySelector(".settings-anchor-flash");
    assert(target && pane().scrollTop > 0, "Search anchor must be positioned before paint");
    const bounds = target.getBoundingClientRect();
    const viewport = pane().getBoundingClientRect();
    assert(bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
      "Search target must be visible");
    assert(useAppStore.getState().settingsAnchor === null, "Search anchor must be consumed");
    const anchoredPosition = pane().scrollTop;
    await settle();
    assert(pane().scrollTop === anchoredPosition, "Consuming anchor must not reset scroll");
    pane().scrollTop = 0;
    flushSync(() => useAppStore.getState().setSettingsAnchor("settings.enterToSend"));
    const withinTab = document.querySelector(".settings-anchor-flash");
    assert(withinTab && pane().scrollTop > 0, "Search within the active tab must be positioned before paint");
    await settle();
    assert(pane().scrollTop > 0, "Search within the active tab must still locate its row");
    checks.push({ theme, ok: true });
  }
  checks.push(await exerciseUpdatePreference());
  checks.push(await exerciseBrazilianPortuguese());
  return { ok: true, checks };
};

window.settingsSkillsProbe = () => exerciseSkillsPage({
  fixture: skillsFixture, t: i18n.t.bind(i18n), select, settle, flushSync, assert,
});

window.settingsSkillsNarrowProbe = () => exerciseSkillsNarrow({
  t: i18n.t.bind(i18n), select, settle, flushSync, assert,
});

window.settingsDirectoryProbe = async () => {
  await settle();
  const compact = window.innerWidth <= 720;
  const trigger = document.querySelector(".settings-categories-toggle");
  assert(Boolean(trigger) === compact, "Directory breakpoint must match the available width");
  if (!compact) return { width: window.innerWidth, compact: false };
  assert(!document.querySelector(".settings-directory-dialog[open]"), "Directory starts closed");
  flushSync(() => trigger.click()); await settle();
  const dialog = document.querySelector(".settings-directory-dialog");
  const input = document.querySelector(".settings-search");
  assert(dialog.open && document.activeElement === input, "Opening directory must focus search");
  await setSettingsSearch(i18n.t("settings.enterToSend"));
  await pressSettingsKey("Enter", { isComposing: true });
  assert(dialog.open, "IME confirmation must not navigate or close the directory");
  await pressSettingsKey("Escape");
  assert(dialog.open && input.value === "", "First Escape clears search only");
  let shellEscapeCount = 0;
  const shellEscape = event => { if (event.key === "Escape") { shellEscapeCount += 1; event.preventDefault(); } };
  window.addEventListener("keydown", shellEscape);
  try { await pressSettingsKey("Escape"); }
  finally { window.removeEventListener("keydown", shellEscape); }
  await settle();
  assert(shellEscapeCount === 0, "Closing the directory must not run app-wide Escape shortcuts");
  assert(!dialog.open && document.activeElement === trigger, "Second Escape closes and restores trigger focus");
  flushSync(() => trigger.click()); await settle();
  await setSettingsSearch(i18n.t("settings.enterToSend"));
  await pressSettingsKey("Enter");
  assert(!dialog.open && useAppStore.getState().settingsTab === "ai", "Selection closes the directory and opens its category");
  assert(document.activeElement === trigger, "Selection returns focus to the categories button");
  assert(document.querySelector(".settings-anchor-flash"), "Selection locates its matching setting");
  assert(document.documentElement.scrollWidth <= window.innerWidth + 1, "Narrow Settings must not overflow horizontally");
  return { width: window.innerWidth, compact: true, searchEscape: true, focusReturn: true, ime: true };
};
window.settingsSaveProbe = async () => {
  await select(i18n.t("settings.nav.general"));
  assert([...document.querySelectorAll(".settings-card-heading")].map(node => node.textContent).join("|") ===
    ["settings.appearance", "settings.power", "settings.network", "settings.storage.title"].map(key => i18n.t(key)).join("|"),
    "General groups must keep appearance, runtime, network and storage order");
  const toggle = () => document.querySelector(`button[aria-label="${i18n.t("settings.keepAwakeWhileRunning")}"]`);
  saveControls.failSave = true;
  flushSync(() => toggle().click()); await settle();
  assert(document.querySelector(".settings-save-feedback.is-failed"), "Persistence failure must remain visible");
  assert(toggle().getAttribute("aria-checked") === "false", "Failed save must retain the confirmed setting");
  saveControls.failSave = false; saveControls.failRefresh = true;
  flushSync(() => toggle().click()); await settle();
  assert(document.querySelector(".settings-save-feedback.is-refreshFailed"), "Post-save refresh failure must identify the successful save");
  saveControls.failRefresh = false;
  flushSync(() => document.querySelector(".settings-save-feedback button").click()); await settle();
  assert(toggle().getAttribute("aria-checked") === "true", "Refresh retry must display the already-saved value");
  assert(document.querySelector(".settings-save-feedback.is-saved"), "Refresh retry must confirm completion");
  saveControls.failRefresh = true;
  flushSync(() => toggle().click()); await settle();
  saveControls.failRefresh = false; saveControls.deferRefresh = true;
  flushSync(() => document.querySelector(".settings-save-feedback button").click()); await settle();
  assert(document.querySelector(".settings-save-feedback button").disabled, "Refresh retry must block repeated pending retries");
  saveControls.failSave = true;
  flushSync(() => toggle().click()); await settle();
  saveControls.deferRefresh = false; resolveSettingsRefresh(); await settle();
  assert(document.querySelector(".settings-save-feedback.is-failed"), "Old refresh completion must not overwrite a newer save failure");
  assert(toggle().getAttribute("aria-checked") === "true", "Old refresh must not replace newer confirmed view state");
  return { failedSave: true, savedRefreshFailure: true, refreshRetry: true, staleRetry: true };
};

window.settingsAllPagesLayoutProbe = async () => {
  await settle();
  const trigger = document.querySelector('.settings-categories-toggle');
  if (trigger) { flushSync(() => trigger.click()); await settle(); }
  const labels = [...document.querySelectorAll('.settings-nav-label')].map(node => node.textContent.trim());
  for (const label of labels) {
    await select(label);
    const content = pane();
    assert(content && content.scrollWidth <= content.clientWidth + 1, `${label}: content must fit the available width`);
    assert(document.documentElement.scrollWidth <= innerWidth + 1, `${label}: shell must not overflow horizontally`);
    assert(document.querySelector('.settings-section-title')?.textContent.trim(), `${label}: destination title must render`);
    assert(!document.querySelector('.settings-content [role="alert"]'), `${label}: normal fixture must not render an error`);
  }
  await select(i18n.t('settings.nav.models'));
  const row = document.querySelector('.model-provider-row');
  assert(row, 'Configured service row must be available');
  flushSync(() => row.click()); await settle();
  const dialog = document.querySelector('.provider-setup-dialog');
  assert(dialog, 'Service row must open the editor');
  const footer = document.querySelector('.provider-setup-actions').getBoundingClientRect();
  assert(footer.top >= 0 && footer.bottom <= innerHeight + 1, 'Model save actions must stay inside the viewport');
  for (const list of document.querySelectorAll('.provider-models, .provider-chosen')) {
    assert(list.scrollHeight <= list.clientHeight + 1, 'Model panes must grow with their content instead of clipping it');
  }
  assert(dialog.scrollWidth <= dialog.clientWidth + 1, 'Model editor must not overflow horizontally');
  const cancel = [...dialog.querySelectorAll('button')].find(node => node.textContent.trim() === i18n.t('settings.cancel'));
  flushSync(() => cancel.click()); await settle();
  return { locale, theme, width: innerWidth, height: innerHeight, destinations: labels.length, modelFooter: true, modelContent: true };
};
