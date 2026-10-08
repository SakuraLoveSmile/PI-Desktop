import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

test("SessionTodoChecklist renders the complete inline checklist expanded in the Overview", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { SessionTodoChecklist } = await server.ssrLoadModule("/src/components/workpanel/SessionTodoChecklist.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const { catalogs } = await server.ssrLoadModule(
      fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)),
    );
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const render = (sessionId = "session-todo-test") =>
      renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(SessionTodoChecklist, { sessionId }),
        ),
      );

    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todo-test": {
          sessionId: "session-todo-test",
          revision: 3,
          updatedAt: 100,
          todos: [
            { content: "first", status: "completed", priority: "medium" },
            { content: "second", status: "in_progress", priority: "high" },
            ...Array.from({ length: 10 }, (_, index) => ({
              content: `extra-${index}`,
              status: "pending",
              priority: "low",
            })),
          ],
        },
      },
    });
    const html = render();
    assert.match(html, /aria-expanded="true"/);
    assert.doesNotMatch(html, /aria-haspopup|role="dialog"/);
    assert.match(html, /<ol[^>]*session-todo-checklist-list/);
    assert.equal((html.match(/<li /g) ?? []).length, 12);
    assert.match(html, />Completed</);
    assert.match(html, />In progress</);
    assert.match(html, />Pending</);
    assert.match(html, />Session checklist 1\/12</);
    assert.match(html, /title="1\/12 · Current: second"/);
    assert.match(html, /extra-0/);
    assert.match(html, /extra-9/);
    assert.doesNotMatch(html, /more items/);
    assert.equal(render("session-other"), "");
    assert.equal(render("remote:server:session-todo-test"), "");
    assert.equal(render("native-pi:session-todo-test"), "");

    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todo-test": {
          sessionId: "session-todo-test",
          revision: 4,
          updatedAt: 101,
          todos: [
            { content: "done", status: "completed", priority: "medium" },
            { content: "not needed", status: "cancelled", priority: "low" },
          ],
        },
      },
    });
    assert.match(render(), />Session checklist 1\/1</);
    assert.match(render(), /title="1\/1 completed"/);
    assert.match(render(), /session-todo-checklist-row-completed/);
    assert.match(render(), />Cancelled</);

    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todo-test": {
          sessionId: "session-todo-test",
          revision: 4,
          updatedAt: 101,
          todos: [
            { content: "cancelled work", status: "cancelled", priority: "low" },
          ],
        },
      },
    });
    assert.match(render(), /Cancelled/);
    assert.doesNotMatch(render(), /0\/0/);

    await i18n.changeLanguage("zh-CN");
    i18n.addResourceBundle("zh-CN", "translation", catalogs["zh-CN"]);
    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todo-test": {
          sessionId: "session-todo-test", revision: 5, updatedAt: 102,
          todos: [{ content: "queued", status: "pending", priority: "medium" }],
        },
      },
    });
    assert.match(render(), />会话清单 0\/1</);

    Object.assign(useAppStore.getInitialState(), { sessionTodos: {} });
    assert.equal(render(), "");
    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todo-test": {
          sessionId: "session-todo-test", revision: 6, updatedAt: 103, todos: [],
        },
      },
    });
    assert.equal(render(), "");
  } finally {
    await server.close();
  }
});

test("SessionTodoChecklist uses Overview scrolling and removes the composer footer entry", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/styles/work-panel.css", import.meta.url), "utf8");
  const composer = await readFile(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
  const overview = await readFile(new URL("../src/components/workpanel/OverviewTab.tsx", import.meta.url), "utf8");
  assert.match(css, /\.session-todo-checklist-header:active:not\(:disabled\)\s*\{[\s\S]*?transform:\s*none;/);
  assert.match(css, /\.session-todo-checklist-copy\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(css.match(/\.session-todo-checklist-list\s*\{[^}]*\}/)?.[0] ?? "", /max-height|overflow/);
  assert.doesNotMatch(composer, /TodoDock|SessionTodoChecklist/);
  assert.match(overview, /<div className="work-panel-overview-scroll">\s*<SessionTodoChecklist key=\{session.id\} sessionId=\{session.id\}/);
});
