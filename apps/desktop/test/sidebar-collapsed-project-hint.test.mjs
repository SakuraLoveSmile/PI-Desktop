import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";

test("a folded project reports the work it hides and an expanded one stays quiet", async () => {
  const previousDocument = globalThis.document;
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { Sidebar } = await server.ssrLoadModule("/src/components/Sidebar.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const old = "2020-01-01T00:00:00Z";
    const session = (id, projectPath) => ({
      id, title: id, projectPath, createdAt: old, updatedAt: old,
    });
    Object.assign(useAppStore.getInitialState(), {
      sessions: [
        session("alpha-running", "/alpha"),
        session("beta-permission", "/beta"),
        session("gamma-running", "/gamma"),
      ],
      sessionMeta: {},
      projectMeta: {
        "/alpha": { collapsed: true, name: "Alpha" },
        "/beta": { collapsed: true, name: "Beta" },
        "/gamma": { collapsed: false, name: "Gamma" },
      },
      openProjectPaths: ["/alpha", "/beta", "/gamma"],
      openProjects: [],
      workspace: null,
      activeProjectPath: null,
      activeSessionId: null,
      selectingSessionId: null,
      page: "chat",
      projectCollapsed: {},
      sessionView: { sort: "recent", archived: false },
      runningSessions: { "alpha-running": true, "gamma-running": true },
      pendingPermissions: { "beta-permission": [{ id: "perm-1" }] },
    });
    globalThis.document = { documentElement: { dataset: { theme: "light" } } };
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(Sidebar, {
          collapsed: false,
          onToggle() {},
          sidebarWidth: 275,
          onWidthChange() {},
          onWidthCommit() {},
        }),
      ),
    );
    const sections = html.split('data-sidebar-project-group="').slice(1).map((chunk) => ({
      key: chunk.slice(0, chunk.indexOf('"')),
      body: chunk,
    }));
    const sectionFor = (path) => sections.find((entry) => entry.key === path)?.body ?? "";
    assert.match(sectionFor("/alpha"), /data-hint="running"[\s\S]*?aria-label="Working"/);
    assert.match(sectionFor("/beta"), /data-hint="permission"[\s\S]*?aria-label="Permission required"/);
    assert.doesNotMatch(sectionFor("/gamma"), /sidebar-project-hint/);
  } finally {
    globalThis.document = previousDocument;
    await server.close();
  }
});
