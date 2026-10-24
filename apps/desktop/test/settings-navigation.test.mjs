import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";

let server;
let SettingsNavigation;
let visibleSettingsNav;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    esbuild: { jsx: "automatic" }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ SettingsNavigation } = await server.ssrLoadModule("/src/features/settings/SettingsNavigation.tsx"));
  ({ visibleSettingsNav } = await server.ssrLoadModule("/src/lib/settings-search.ts"));
});
after(async () => { await server?.close(); });

async function render(locale = "en", overrides = {}) {
  const i18n = createInstance();
  await i18n.init({ lng: locale, keySeparator: false,
    resources: { [locale]: { translation: flattenCatalog(catalogs[locale]) } },
    interpolation: { escapeValue: false } });
  const developerMode = overrides.developerMode ?? false;
  const includeDevelopmentOnly = overrides.includeDevelopmentOnly ?? false;
  const entries = visibleSettingsNav(developerMode, includeDevelopmentOnly);
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(SettingsNavigation, {
      entries, tab: "general", developerMode, includeDevelopmentOnly,
      extensions: [], activeExtension: null, onSelect() {}, onSelectExtension() {}, onBack() {},
      ...overrides,
    })));
  return { html, entries, t: key => i18n.t(key) };
}

// These patterns inspect executed component output, never source text.
function navigationButtons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attributes]) => attributes.includes("settings-nav-item"))
    .map(([, attributes, content]) => ({ attributes, content,
      label: content.match(/<span class="settings-nav-label">([^<]*)<\/span>/)?.[1] }));
}

test("the localized directory keeps ordered flat destinations and named visual groups", async () => {
  const ids = ["general", "ai", "voice", "shortcuts", "instructions", "agent", "skills", "mcp",
    "subagents", "expertTeam", "import", "projects", "memory", "about"];
  for (const locale of ["en", "zh-CN", "zh-TW", "tr"]) {
    const { html, entries, t } = await render(locale);
    assert.deepEqual(entries.map(entry => entry.id), ids);
    assert.deepEqual(navigationButtons(html).map(button => button.label), entries.map(entry => t(entry.labelKey)));
    assert.deepEqual([...html.matchAll(/<div class="settings-nav-group-label">([^<]*)<\/div>/g)].map(match => match[1]),
      ["settings.groupPreferences", "settings.groupAgent", "settings.groupWorkspace", "settings.groupSystem"].map(t));
    assert.ok(html.includes(`aria-label="${t("settings.search")}"`));
    assert.ok(html.includes(`placeholder="${t("settings.searchPlaceholder")}"`));
    assert.ok(html.includes(t("settings.backToApp")));
    assert.match(html, /<aside class="settings-nav sidebar-surface"/);
  }
});

test("destinations render monochrome decorative semantic icons", async () => {
  const { html, entries } = await render();
  const glyphs = {
    general: "sliders-horizontal", ai: "sparkles", voice: "mic", shortcuts: "keyboard",
    instructions: "file-text", agent: "bot", skills: "book-open", mcp: "server", subagents: "bot",
    expertTeam: "bot", import: "download", projects: "archive", memory: "book-open", about: "info",
  };
  for (const [index, button] of navigationButtons(html).entries()) {
    const glyph = glyphs[entries[index].id];
    assert.ok(button.content.includes(`lucide-${glyph}`), `${entries[index].id} uses ${glyph}`);
    assert.match(button.content, /<svg[^>]*aria-hidden="true"/);
  }
});

test("the current built-in or plugin is the only current page and extensions remain last", async () => {
  const extension = { ref: "fixture:themes", pluginId: "fixture", label: "Scenic themes", keywords: [], icon: "palette" };
  for (const activeExtension of [null, extension]) {
    const { html } = await render("en", { tab: "projects", extensions: [extension], activeExtension });
    const buttons = navigationButtons(html);
    const current = buttons.filter(button => button.attributes.includes('aria-current="page"'));
    assert.equal(current.length, 1);
    assert.equal(current[0].label, activeExtension ? "Scenic themes" : "Projects");
    assert.equal(buttons.at(-1).label, "Scenic themes");
    assert.ok(buttons.at(-1).content.includes("lucide-palette"));
    assert.match(html, /<div class="settings-nav-group-label">Extensions<\/div>/);
  }
});

test("developer-only destinations carry experimental badges and stay absent from packaged builds", async () => {
  for (const developerMode of [false, true]) {
    const { html } = await render("en", { developerMode, includeDevelopmentOnly: false });
    assert.ok(!navigationButtons(html).some(button => ["Cloud sync", "Remote Hosts"].includes(button.label)));
  }
  const { html, entries, t } = await render("en", { developerMode: true, includeDevelopmentOnly: true });
  for (const id of ["sync", "remoteHosts"]) {
    const entry = entries.find(entry => entry.id === id);
    assert.ok(entry);
    const button = navigationButtons(html).find(button => button.label === t(entry.labelKey));
    assert.ok(button);
    assert.ok(button.content.includes(t(entry.experimentalBadgeKey)));
    assert.ok(button.content.includes("settings-nav-experimental"));
  }
});

test("short rail labels retain descriptive page titles and search ownership", async () => {
  const { entries, t } = await render();
  const model = entries.find(entry => entry.id === "agent");
  const projects = entries.find(entry => entry.id === "projects");
  assert.equal(t(model.labelKey), "Models");
  assert.equal(t(model.titleKey), "Model configuration");
  assert.equal(t(projects.labelKey), "Projects");
  assert.equal(t(projects.titleKey), "Project archive");
  const general = entries.find(entry => entry.id === "general");
  const ai = entries.find(entry => entry.id === "ai");
  assert.ok(!general.keywordKeys.includes("settings.defaultsTitle"));
  for (const key of ["settings.defaultsTitle", "settings.commandShell", "settings.promptEnhancementModelTitle"]) {
    assert.ok(ai.keywordKeys.includes(key), `${key} belongs to AI`);
  }
  assert.ok(!entries.some(entry => ["usage", "extensions"].includes(entry.id)));
});
