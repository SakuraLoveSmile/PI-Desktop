import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
  logLevel: "silent", server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
  esbuild: { jsx: "automatic" }, optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: [
    { find: /^@pi-desktop\/shared$/, replacement: fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) },
    { find: /^@pi-desktop\/i18n$/, replacement: fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)) },
  ] } });
after(() => server.close());
const { activityVisibleItems, activityOutputGroups, activityFailures, activityAttention, activityGroupSummary } = await server.ssrLoadModule("/src/features/chat/activity/activity-rail-presentation.ts");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: { panel: { activity: {
  writeCount: "{{count}} writes", sourceCount: "{{count}} references", lastChanged: "Last changed {{time}}",
  open: "Open", locate: "Locate in conversation", copyPath: "Copy path", details: "Details", showAll: "Show all ({{count}})", showLess: "Show less",
} } } } } });
const render = (element) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, element));

test("long lists start with five rows and expansion retains every item in original order", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ id: String(index) }));
  assert.deepEqual(activityVisibleItems(items, false).map((item) => item.id), ["0", "1", "2", "3", "4"]);
  assert.equal(activityVisibleItems(items, true), items);
});

test("output grouping uses recorded directories and never duplicates a file", () => {
  const items = [{ id: "a", groupLabel: "src" }, { id: "b", groupLabel: "docs" }, { id: "c", groupLabel: "src" }, { id: "d" }];
  assert.deepEqual(activityOutputGroups(items), [ { label: "src", items: [items[0], items[2]] },
    { label: "docs", items: [items[1]] }, { label: "", items: [items[3]] } ]);
});

test("degraded reports draw attention without being counted as failed or timed out", () => {
  const items = [{ id: "goal", status: "completed", attentionStatus: "degraded" }, { id: "failed", status: "failed" }, { id: "timeout", status: "timed_out" }];
  assert.deepEqual(activityFailures(items).map((item) => item.id), ["failed", "timeout"]);
  assert.ok(activityAttention(items).includes("goal:degraded"));
  assert.deepEqual(activityGroupSummary(items), { total: 3, running: 0, failed: 1, timedOut: 1 });
});

test("output row actions are separate buttons and unknown metadata does not create zero totals", async () => {
  const { ActivityRailRow } = await server.ssrLoadModule("/src/features/chat/activity/ActivityRailRows.tsx");
  const item = { id: "file", label: "example.ts", path: "src/example.ts", onOpen() {}, onLocate() {}, onCopyPath() {}, changeCount: 3, addedLines: 12 };
  const html = render(createElement(ActivityRailRow, { item, kind: "output", now: 0 }));
  assert.ok(html.includes("3 writes"));
  assert.ok(html.includes("+12"));
  assert.ok(!html.includes("−0"));
  assert.ok(!html.includes("Last changed"));
  assert.ok(html.includes('aria-label="Open · example.ts"'));
  assert.ok(html.includes('aria-label="Locate in conversation · example.ts"'));
  assert.ok(html.includes('aria-label="Copy path · src/example.ts"'));
  let buttons = 0;
  for (const tag of html.matchAll(/<\/?button\b[^>]*>/g)) {
    if (tag[0].startsWith("</")) buttons--;
    else { assert.equal(buttons, 0, "no action button may be nested inside the primary row button"); buttons++; }
  }
  assert.equal(buttons, 0);
});

test("overview agents replace decorative avatars with state glyphs while inline transcript keeps its avatar", async () => {
  const { SubagentActivityRow } = await server.ssrLoadModule("/src/features/chat/activity/SubagentActivityRow.tsx");
  const props = { id: "worker", name: "Worker", status: "running", statusLabel: "Running", now: 0 };
  const overview = render(createElement(SubagentActivityRow, { ...props, presentation: "overview", roleLabel: "Reviewer" }));
  const inline = render(createElement(SubagentActivityRow, props));
  assert.ok(overview.includes("Reviewer"));
  assert.ok(!overview.includes("subagent-activity-avatar"));
  assert.ok(inline.includes("subagent-activity-avatar"));
});

test("Goal observers remain mounted beyond the collapsed five-row preview", async () => {
  const { ActivityLimitedList } = await server.ssrLoadModule("/src/features/chat/activity/ActivityRailRows.tsx");
  const items = Array.from({ length: 7 }, (_, index) => ({ id: String(index) }));
  const renderItem = (item) => createElement("output", null, `observer-${item.id}`);
  const html = render(createElement(ActivityLimitedList, { sessionId: "goal-mount-test", group: "plans", items, keepMounted: true, renderItem }));
  assert.ok(html.includes("observer-6"));
  assert.equal([...html.matchAll(/<div[^>]*hidden=""/g)].length, 2);
  assert.ok(html.includes("Show all (7)"));
});
