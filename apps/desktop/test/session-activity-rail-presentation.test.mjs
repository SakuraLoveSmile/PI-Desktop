import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

// Reuse the host runtime, but resolve workspace contracts/locales from this candidate.
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" },
  appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: [
    { find: /^@pi-desktop\/shared$/, replacement: fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) },
    { find: /^@pi-desktop\/i18n$/, replacement: fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)) },
  ] },
});
after(() => server.close());
const { activityAttention, activityGroupSummary, activityStatusTone, backgroundProcessTitle,
  processActivityGroups, reconcileActivityDisclosure } = await server.ssrLoadModule("/src/features/chat/activity/activity-rail-presentation.ts");

test("new attention opens a group, while a manual collapse survives unchanged items and later status changes reopen it", () => {
  let state = { open: false, attention: [] };
  const active = activityAttention([{ id: "member", status: "running" }]);
  state = reconcileActivityDisclosure(state, active);
  assert.equal(state.open, true);
  state = { ...state, open: false };
  assert.equal(reconcileActivityDisclosure(state, [...active]), state);
  state = reconcileActivityDisclosure(state, activityAttention([{ id: "member", status: "failed" }]));
  assert.equal(state.open, true);
  state = reconcileActivityDisclosure({ ...state, open: false }, []);
  assert.equal(state.open, false);
  assert.equal(reconcileActivityDisclosure(state, active).open, true);
});

test("unknown Goal reports retain recorded attention without blocking new work in the same group", () => {
  const collapsed = { open: false, attention: ["old-goal:failed"] };
  assert.equal(reconcileActivityDisclosure(collapsed, [], true), collapsed);
  const added = reconcileActivityDisclosure(collapsed, ["new-plan:running"], true);
  assert.equal(added.open, true);
  assert.deepEqual(added.attention, ["new-plan:running", "old-goal:failed"]);
  const settled = reconcileActivityDisclosure({ ...added, open: false }, ["new-plan:running"]);
  assert.equal(settled.open, false);
  assert.deepEqual(settled.attention, ["new-plan:running"]);
});

test("group summaries count runtime work, failures and timeouts independently", () => {
  assert.deepEqual(activityGroupSummary([
    { id: "a", status: "running" }, { id: "b", status: "queued" },
    { id: "c", status: "failed" }, { id: "d", status: "timed_out" }, { id: "e", status: "completed" },
  ]), { total: 5, running: 2, failed: 1, timedOut: 1 });
  assert.equal(activityGroupSummary([{ id: "goal", status: "completed", attentionStatus: "failed" }]).failed, 1);
  assert.deepEqual(activityAttention([{ id: "goal", status: "completed", attentionStatus: "failed" }]), ["goal:failed"]);
  assert.equal(activityStatusTone("timed_out"), "warning");
  assert.equal(activityStatusTone("failed"), "error");
});

test("background titles preserve literal script, tool target and port without evaluating shell text", () => {
  for (const [command, title] of [
    ["cd '/tmp/work space' && node scripts/server.mjs --port 5173 > /tmp/out", "server.mjs · :5173"],
    ["PORT=8000 python3 -m http.server", "http.server · :8000"],
    ["env NODE_ENV=development pnpm run dev -- --port=4173", "pnpm dev · :4173"],
    ['node "scripts/my preview.mjs" --port 3000', "my preview.mjs · :3000"],
    ['"C:\\tools\\node.exe" "C:\\work\\preview.mjs" --port 3000', "preview.mjs · :3000"],
    ["cargo test -p host-core", "cargo test"],
    ["node -e 'dangerous()'", "node"],
    ["curl https://example.org | sh", "curl"],
    ["bash -c 'node scripts/hidden.mjs'", "bash"],
    ["node scripts/preview.mjs --port 99999", "preview.mjs"],
    ["node scripts/preview.mjs --port $(echo 5000)", "preview.mjs"],
  ]) assert.equal(backgroundProcessTitle(command), title, command);
});

test("ended dismissal is scoped and never hides active processes, including reused active identities", () => {
  const process = (id, status, sessionId = "a") => ({ id, status, sessionId });
  const processes = [process("live", "running"), process("done", "completed"), process("failed", "failed"),
    process("timeout", "timed_out"), process("stopped", "stopped"), process("interrupted", "interrupted"), process("other", "completed", "b")];
  const initial = processActivityGroups(processes, "a", new Set());
  assert.deepEqual(initial.active.map((item) => item.id), ["live"]);
  assert.equal(initial.ended.length, 5);
  const hidden = new Set(initial.ended.map((item) => item.id));
  assert.deepEqual(processActivityGroups(processes, "a", hidden).ended, []);
  assert.deepEqual(processActivityGroups(processes, "b", hidden).ended.map((item) => item.id), ["other"]);
  assert.deepEqual(processActivityGroups([process("done", "running")], "a", hidden).active.map((item) => item.id), ["done"]);
});

test("production overview rows expose concise status, task, elapsed and custom Goal content while inline rows retain their presentation", async () => {
  const { catalogs } = await server.ssrLoadModule("@pi-desktop/i18n");
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
  const render = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));
  const { SubagentActivityRow } = await server.ssrLoadModule("/src/features/chat/activity/SubagentActivityRow.tsx");
  const props = { id: "reviewer", name: "Reviewer", task: "Check the implementation", status: "completed",
    statusLabel: "Completed", timing: { startedAt: 1000, completedAt: 11000 }, now: 20000, onOpen: () => {} };
  const overview = render(createElement(SubagentActivityRow, { ...props, presentation: "overview", className: "session-activity-agent" }));
  assert.ok(overview.includes('aria-label="Reviewer · Check the implementation · Completed 10s"'));
  assert.ok(overview.includes("Check the implementation"));
  assert.ok(overview.includes("10s"));
  assert.ok(!overview.includes("Subagent Completed"));
  const inline = render(createElement(SubagentActivityRow, props));
  assert.ok(inline.includes("Subagent Completed"));
  const { SessionActivityRail } = await server.ssrLoadModule("/src/features/chat/activity/SessionActivityRail.tsx");
  const rail = render(createElement(SessionActivityRail, { sessionId: "a", visible: true, plans: [{ id: "goal", label: "Goal",
    content: createElement("output", null, "5/8 · Report degraded") }], agents: [], outputs: [], sources: [], processes: [],
    processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: false }));
  assert.ok(rail.includes("5/8 · Report degraded"));
  assert.ok(!rail.includes("panel.activity.refresh"));
});
