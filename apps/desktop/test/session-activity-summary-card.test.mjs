import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

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
const { catalogs } = await server.ssrLoadModule("@pi-desktop/i18n");
const { SessionActivityRail } = await server.ssrLoadModule("/src/features/chat/activity/SessionActivityRail.tsx");
const { summaryTimestamp } = await server.ssrLoadModule("/src/features/chat/activity/activity-summary-view.ts");
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });

const baseProps = { sessionId: "a", visible: true, plans: [], goals: [], agents: [], outputs: [], sources: [], processes: [],
  processesLoading: false, onRefreshProcesses() {}, onOpenProcess() {}, supported: true };
const render = (props) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(SessionActivityRail, { ...baseProps, ...props })));
const summary = (patch = {}) => ({ text: "Importer tests pass; the CSV edge case is next.", updatedAt: new Date(2026, 10, 22, 14, 5).toISOString(),
  refreshing: false, onRefresh() {}, ...patch });
const attention = [{ id: "pending-approvals", label: "1 approvals pending", group: "approvals" }];

test("the summary is the first child of the rail, above Needs attention, and no section of it", () => {
  const markup = render({ summary: summary(), attentionItems: attention, goals: [{ id: "g", label: "Ship it", status: "running", statusLabel: "Running" }] });
  const card = markup.indexOf('class="session-activity-summary"');
  assert.ok(card > 0);
  assert.ok(markup.indexOf('class="session-activity-attention"') > card);
  assert.ok(markup.indexOf("data-activity-section=") > card);
  assert.ok(markup.indexOf('data-activity-section="summary"') === -1, "the card is pinned: it is not a reorderable section");
  const cardMarkup = markup.slice(card, markup.indexOf("</section>", card));
  assert.ok(!cardMarkup.includes("session-activity-grip"), "a pinned card has no grip");
  assert.ok(cardMarkup.includes('aria-label="Session summary"'));
});

test("without a summary there is no card", () => {
  assert.ok(!render({}).includes("session-activity-summary"));
  assert.ok(!render({ summary: undefined, attentionItems: attention }).includes("session-activity-summary"));
});

test("the note is dated in local time and shown as plain text, never as markup", () => {
  const text = '<img src=x onerror=alert(1)> & **bold** [link](http://example.test)';
  const markup = render({ summary: summary({ text }) });
  assert.ok(markup.includes("Updated 2026-11-22 14:05"));
  assert.ok(markup.includes("<time"));
  assert.ok(markup.includes("&lt;img src=x onerror=alert(1)&gt; &amp; **bold** [link](http://example.test)"));
  assert.ok(!markup.includes("<img"));
  assert.ok(!markup.includes("<strong"));
  assert.ok(!markup.includes('href="http://example.test"'));
});

test("the timestamp is YYYY-MM-DD HH:mm with zero padding, and empty for an unreadable stamp", () => {
  assert.equal(summaryTimestamp(new Date(2026, 0, 3, 4, 9).toISOString()), "2026-01-03 04:09");
  assert.equal(summaryTimestamp(new Date(2026, 11, 31, 23, 59).toISOString()), "2026-12-31 23:59");
  assert.equal(summaryTimestamp("not a date"), "");
});

test("the refresh control has a name, and stays focusable but inert while a run is under way", () => {
  const idle = render({ summary: summary() });
  assert.ok(idle.includes('aria-label="Regenerate session summary"'));
  assert.ok(idle.includes('aria-disabled="false"'));
  assert.ok(idle.includes('aria-busy="false"'));
  assert.ok(!idle.includes("session-activity-spinner"));
  const busy = render({ summary: summary({ refreshing: true }) });
  assert.ok(busy.includes('aria-disabled="true"'));
  assert.ok(busy.includes('aria-busy="true"'));
  assert.ok(busy.includes("session-activity-spinner"));
  assert.ok(!/<button[^>]*session-activity-summary-refresh[^>]*\sdisabled/.test(busy), "a disabled button would drop keyboard focus");
});

test("a note that has not been measured as clamped offers no Expand control", () => {
  const markup = render({ summary: summary() });
  const start = markup.indexOf('class="session-activity-summary"');
  const card = markup.slice(start, markup.indexOf("</section>", start));
  assert.ok(card.includes("session-activity-summary-body"));
  assert.ok(!card.includes("aria-expanded"));
  assert.ok(!card.includes("session-activity-summary-more"));
});
