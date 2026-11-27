import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";

const buttons = (html) => [...html.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g)]
  .map((match) => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;

test("the sidebar nav lists five destinations in one grid with shortcut hints", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { SidebarNav } = await server.ssrLoadModule("/src/features/sidebar/SidebarNav.tsx");
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const render = (props) =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(SidebarNav, {
            page: "chat",
            setPage() {},
            canNavBack: () => false,
            navBack() {},
            onNewTask() {},
            onOpenSearch() {},
            newTaskShortcut: "Mod+N",
            searchShortcut: "Mod+K",
            ...props,
          }),
        ),
      );
    const html = render();
    const rows = buttons(html).filter((tag) => attribute(tag, "class")?.includes("sidebar-nav-row"));
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((tag) => attribute(tag, "data-action") ?? attribute(tag, "data-nav")),
      ["new-task", "open-search", "scheduled", "plugins", "context-insights"],
    );
    for (const row of rows) {
      assert.ok(attribute(row, "class")?.includes("sidebar-nav-row"));
      const label = row.match(/class="sidebar-nav-label">([^<]+)</)?.[1] ?? "";
      assert.ok(label.length > 0, "every destination has a label");
    }
    assert.ok(rows[0].includes("Mod+N") && rows[1].includes("Mod+K"));
    assert.ok(!rows[2].includes("sidebar-nav-shortcut"), "only the first two rows carry a hint");
    assert.ok(!html.includes('aria-current="page"'), "the chat page is none of the destinations");

    const plugins = render({ page: "plugins" });
    const current = buttons(plugins).find((tag) => attribute(tag, "data-nav") === "plugins");
    assert.equal(attribute(current ?? "", "aria-current"), "page");
    assert.equal(buttons(plugins).filter((tag) => attribute(tag, "aria-current") === "page").length, 1);
  } finally {
    await server.close();
  }
});
