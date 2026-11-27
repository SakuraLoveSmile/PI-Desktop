import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const translation = {
  panel: { activity: {
    todos: "Todos {{completed}}/{{total}}",
    teamTasks: "Team tasks {{completed}}/{{total}}",
    teamTasksBoard: "Board",
  } },
  chat: { todo: { status: { pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" } } },
  team: {
    numberedTask: "Task {{number}}: {{subject}}",
    openTaskWithStatus: "Open task {{subject}} ({{status}})",
    waitingForDependencies: "Waiting for dependencies",
    taskStatus: { pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", failed: "Failed" },
    roles: { researcher: "Researcher", executor: "Executor" },
    viewAllTasks: "View all {{count}} tasks",
  },
};

async function withServer(run) {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation } } });
  try {
    await run(server, i18n);
  } finally {
    await server.close();
  }
}

const wrap = (i18n, element) => createElement(I18nextProvider, { i18n }, element);

test("the activity rail lists every todo and names each state", async () => {
  await withServer(async (server, i18n) => {
    const { ActivityTodosSection } = await server.ssrLoadModule("/src/features/chat/activity/ActivityTodosSection.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const render = (sessionId) => renderToStaticMarkup(wrap(i18n, createElement(ActivityTodosSection, { sessionId, visible: true })));
    Object.assign(useAppStore.getInitialState(), {
      sessionTodos: {
        "session-todos": {
          sessionId: "session-todos", revision: 2, updatedAt: 10,
          todos: [
            { content: "first", status: "completed", priority: "medium" },
            { content: "second", status: "in_progress", priority: "high" },
            ...Array.from({ length: 10 }, (_, index) => ({ content: `extra-${index}`, status: "pending", priority: "low" })),
          ],
        },
      },
    });
    // Nothing is truncated: the rail is the session summary, so all twelve rows are drawn.
    const html = render("session-todos");
    assert.equal((html.match(/<li /g) ?? []).length, 12);
    assert.match(html, /Todos 1\/12/);
    assert.match(html, /data-todo-status="in_progress"/);
    assert.match(html, /session-activity-spinner/);
    assert.match(html, /extra-0/);
    assert.match(html, /extra-9/);
    assert.doesNotMatch(html, /Show all|session-activity-show-all/);
    assert.equal(render("session-other"), "");
  });
});

test("a task row carries the state, the numbered task and the role word, never an avatar", async () => {
  await withServer(async (server, i18n) => {
    const { ActivityTeamTasksList } = await server.ssrLoadModule("/src/features/chat/activity/ActivityTeamTasksSection.tsx");
    const owner = { sessionId: "alex", handle: "alex", displayName: "Alex", role: "researcher", phase: "running", paused: false };
    const rows = Array.from({ length: 6 }, (_, index) => ({
      task: { taskId: `task-${index}`, subject: `Subject ${index}`, status: index === 0 ? "in_progress" : "pending" },
      ordinal: index + 1,
      state: index === 0 ? "in_progress" : "pending",
      owner,
    }));
    let opened = [];
    let board = 0;
    const html = renderToStaticMarkup(wrap(i18n, createElement(ActivityTeamTasksList, {
      rows, completed: 2, total: 9, label: "Team tasks 2/9",
      onOpenBoard: () => { board += 1; }, onOpenTask: (taskId, subject) => { opened = [taskId, subject]; },
    })));
    assert.equal((html.match(/session-activity-team-task"/g) ?? []).length, 6);
    assert.match(html, /Task 1: Subject 0/);
    assert.match(html, /In progress/);
    assert.match(html, /Researcher/);
    assert.match(html, /aria-valuemin="0" aria-valuemax="9" aria-valuenow="2"/);
    assert.match(html, /session-activity-spinner/);
    assert.doesNotMatch(html, /pixel-avatar|team-person/);
    // The list draws what it is given and offers the board for the rest.
    assert.match(html, /View all 9 tasks/);
    assert.deepEqual([opened, board], [[], 0]);
  });
});

test("the board action and a task row lead to the Team board and that task", async () => {
  await withServer(async (server) => {
    const { teamWorkPanelTab } = await server.ssrLoadModule("/src/lib/work-panel-tabs.ts");
    const board = teamWorkPanelTab("team-session", { kind: "board" });
    assert.deepEqual([board.id, board.kind, board.teamTarget], ["team:team-session", "team", { kind: "board" }]);
    const task = teamWorkPanelTab("team-session", { kind: "task", taskId: "task-2" }, "Subject 2");
    assert.deepEqual([task.id, task.teamTarget, task.label], ["team:team-session:task:task-2", { kind: "task", taskId: "task-2" }, "Subject 2"]);
  });
});
test("a recorded change row shows exact totals and omits a zero side", async () => {
  await withServer(async (server, i18n) => {
    const { ActivityRailRow } = await server.ssrLoadModule("/src/features/chat/activity/ActivityRailRows.tsx");
    const row = (extra) => renderToStaticMarkup(wrap(i18n, createElement(ActivityRailRow, {
      kind: "output", now: 0,
      item: { id: "change:f", label: "src/a.ts", path: "src/a.ts", addedLines: 5, removedLines: 1, ...extra },
    })));
    const exact = row({});
    assert.match(exact, /session-activity-lines-added">\+5</);
    assert.match(exact, /session-activity-lines-removed">−1</);
    const addedOnly = row({ removedLines: 0 });
    assert.match(addedOnly, /session-activity-lines-added">\+5</);
    assert.doesNotMatch(addedOnly, /session-activity-lines-removed/);
  });
});
