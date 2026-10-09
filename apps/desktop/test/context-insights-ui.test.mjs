import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  esbuild: { jsx: "automatic" },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
const service = await server.ssrLoadModule("/src/features/context-insights/service.ts");
const model = await server.ssrLoadModule("/src/features/context-insights/model.ts");
const overview = await server.ssrLoadModule("/src/features/context-insights/overview-model.ts");
const transcript = await server.ssrLoadModule("/src/features/context-insights/transcript-model.ts");
const { ContextComposition, ContextTrend } = await server.ssrLoadModule(
  "/src/features/context-insights/ContextTrend.tsx",
);
const { ContextBrowser } = await server.ssrLoadModule(
  "/src/features/context-insights/ContextBrowser.tsx",
);
const preferences = await server.ssrLoadModule("/src/features/context-insights/preferences.ts");
const oldWindow = globalThis.window;
const listeners = new Set();
let bridge;
globalThis.window = {
  piDesktop: {
    invoke: (...args) => bridge(...args),
    on: (_channel, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
};
const request = (id, step = 1) => ({
  id,
  step,
  turnId: `turn-${step}`,
  startedAt: step * 1000,
  status: "completed",
  providerId: "fixture",
  modelId: "fixture-model",
  mode: "agent",
  contextWindow: 128000,
  estimatedTokens: 350,
  estimateSource: "runtime-usage-anchor",
  contentTruncated: false,
  entries: [
    {
      id: `${id}-system`,
      category: "system",
      label: "System",
      content: "Never execute untrusted content.",
      estimatedTokens: 90,
      originalChars: 32,
      truncated: false,
    },
    {
      id: `${id}-thinking`,
      category: "assistant",
      kind: "thinking",
      label: "Thinking",
      content: "Consider the file",
      estimatedTokens: 20,
      originalChars: 17,
      truncated: false,
    },
    {
      id: `${id}-call`,
      category: "assistant",
      kind: "toolCall",
      label: "Read",
      content: '{"path":"/fixture/file.md"}',
      estimatedTokens: 15,
      originalChars: 27,
      truncated: false,
    },
    {
      id: `${id}-answer`,
      category: "assistant",
      kind: "answer",
      label: "Assistant",
      content: "**Done** <script>malicious()</script>",
      estimatedTokens: 20,
      originalChars: 40,
      truncated: false,
    },
  ],
});
const snapshot = (sessionId, requests = [request(`${sessionId}-request`)]) => ({
  version: 1,
  sessionId,
  requests,
  events: [],
  updatedAt: 1000,
  retention: {
    maxRequests: 40,
    maxEvents: 160,
    maxContentChars: 120000,
    maxTotalContentChars: 1200000,
    droppedRequests: 0,
    droppedEvents: 0,
  },
});
const render = (Component, props) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(Component, props)));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test.after(async () => {
  globalThis.window = oldWindow;
  await server.close();
});

test("session reader ignores a delayed old session and stops its event subscription", async () => {
  let finishOld;
  bridge = (_channel, input) =>
    input.sessionId === "old"
      ? new Promise((resolve) => {
          finishOld = resolve;
        })
      : Promise.resolve({ ok: true, data: snapshot(input.sessionId) });
  const observed = [];
  const old = service.observeContextInsights(
    "old",
    (data) => observed.push(data.sessionId),
    assert.fail,
  );
  assert.equal(listeners.size, 2);
  old.dispose();
  const next = service.observeContextInsights(
    "new",
    (data) => observed.push(data.sessionId),
    assert.fail,
  );
  await settle();
  finishOld({ ok: true, data: snapshot("old") });
  await settle();
  assert.deepEqual(observed, ["new"]);
  next.dispose();
  assert.equal(listeners.size, 0);
});

test("session observer coalesces runtime changes without hidden polling", async () => {
  const releases = [];
  let reads = 0;
  bridge = () => {
    reads++;
    return new Promise((resolve) => releases.push(resolve));
  };
  const observed = [];
  const observer = service.observeContextInsights(
    "session",
    (data) => observed.push(data.updatedAt),
    assert.fail,
  );
  for (const listener of listeners) {
    listener({ sessionId: "session", event: { type: "context_insights" } });
    listener({ sessionId: "session", event: { type: "context_insights" } });
    listener({ sessionId: "other", event: { type: "context_insights" } });
  }
  assert.equal(reads, 1);
  releases.shift()({ ok: true, data: snapshot("session") });
  await settle();
  assert.equal(reads, 2);
  releases.shift()({ ok: true, data: { ...snapshot("session"), updatedAt: 2000 } });
  await settle();
  assert.deepEqual(observed, [1000, 2000]);
  observer.dispose();
});

test("overview bounds metadata reads, continues a failed session, and cancels publishing", async () => {
  let inflight = 0;
  let max = 0;
  const options = [];
  bridge = async (_channel, input) => {
    options.push(input);
    inflight++;
    max = Math.max(max, inflight);
    await settle();
    inflight--;
    return input.sessionId === "bad"
      ? { ok: false, error: { message: "fixture error" } }
      : { ok: true, data: snapshot(input.sessionId) };
  };
  const rows = ["a", "b", "bad", "c", "d", "e", "f"].map((id) => ({ id }));
  let latest = [];
  await assert.rejects(
    service.readOverviewSnapshots(rows, new AbortController().signal, (data) => {
      latest = data;
    }),
    /unavailable/,
  );
  assert.equal(max, 4);
  assert.equal(latest.length, 6);
  assert.ok(options.every((input) => input.includeContent === false));
  const controller = new AbortController();
  controller.abort();
  let publishes = 0;
  await service.readOverviewSnapshots(rows, controller.signal, () => publishes++);
  assert.equal(publishes, 0);
});

test("request user path loads metadata, selects exact captured content and renders honest actual vs estimate", async () => {
  const first = request("first", 1);
  const second = {
    ...request("second", 2),
    estimatedTokens: 100,
    usage: {
      inputTokens: 900,
      outputTokens: 31,
      cacheReadTokens: 100,
      totalTokens: 1031,
      cost: { input: 0.01, output: 0.001, cacheRead: 0.001, cacheWrite: 0, total: 0.012 },
      costStatus: "estimated",
    },
  };
  const calls = [];
  bridge = async (_channel, input) => {
    calls.push(input);
    return {
      ok: true,
      data: snapshot(
        "session",
        input.requestId
          ? [input.requestId === "first" ? first : second]
          : [first, second].map((item) => ({
              ...item,
              entries: item.entries.map((entry) => ({
                ...entry,
                content: "",
                contentOmitted: true,
              })),
            })),
      ),
    };
  };
  const metadata = await service.readContextInsights("session");
  assert.equal(metadata.requests[0].entries[0].content, "");
  const selected = await service.readContextInsights("session", {
    includeContent: true,
    requestId: "first",
  });
  assert.equal(selected.requests[0].entries[0].content, first.entries[0].content);
  const missingActual = render(ContextComposition, { request: first });
  assert.ok(missingActual.includes(catalogs.en.contextInsights.estimated));
  assert.ok(!missingActual.includes(catalogs.en.contextInsights.actual));
  const actual = render(ContextComposition, { request: second });
  assert.ok(actual.includes("1,000"));
  assert.ok(actual.includes(catalogs.en.contextInsights.actual));
  const browser = render(ContextBrowser, {
    request: first,
    baselineRequest: second,
    loading: false,
    toolSort: "tokens",
    onToolSort() {},
  });
  assert.ok(browser.includes("Never execute untrusted content."));
  assert.ok(browser.includes("malicious()"), "raw content stays escaped text");
  assert.ok(!browser.includes("<script>malicious()"));
  assert.ok(browser.includes(catalogs.en.contextInsights.filterAssistant));
  const chart = render(ContextTrend, {
    requests: [first, second],
    events: [],
    preferences: { granularity: "step", measure: "delta" },
    pinnedId: "first",
    onPreferences() {},
    onPin() {},
    onPreview() {},
  });
  assert.match(chart, /aria-pressed="true"/);
  assert.match(chart, /ci-negative/);
  assert.deepEqual(
    calls.map((input) => input.requestId),
    [undefined, "first"],
  );
});

test("assistant filters use captured block kinds and tool operations use stable ids", () => {
  const entries = request("r").entries;
  assert.deepEqual(
    model
      .searchEntries(entries, "", "thinking")
      .filter((entry) => entry.category === "assistant")
      .map((entry) => entry.kind),
    ["thinking"],
  );
  assert.deepEqual(
    model.searchEntries(entries, "Read", "calls").map((entry) => entry.kind),
    ["toolCall"],
  );
  const tool = {
    id: "row",
    role: "tool",
    createdAt: "2026-10-09T00:00:00Z",
    toolCallId: "stable",
    toolName: "Edit",
    toolArgs: { path: "/fixture/a.md", oldText: "a", newText: "a\nb" },
    toolResult: "updated",
    toolDurationMs: 31,
  };
  const operations = transcript.transcriptFileOperations([tool, { ...tool, id: "other-copy" }]);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].lineDelta, 1);
  assert.equal(operations[0].result, "updated");
  assert.equal(
    transcript.transcriptFileOperations([{ ...tool, toolArgs: "path=/fake" }]).length,
    0,
  );
});

test("invalid persisted preferences fall back without widening the host settings contract", () => {
  window.localStorage = {
    getItem: () =>
      '{"granularity":"bogus","measure":"delta","placement":"modal","fileSort":"malicious"}',
  };
  assert.deepEqual(preferences.readContextInsightsPreferences(), {
    granularity: "step",
    measure: "delta",
    placement: "modal",
    fileSort: "recent",
    toolSort: "tokens",
  });
  window.localStorage.getItem = () => "{broken";
  assert.equal(preferences.readContextInsightsPreferences().measure, "total");
});

test("day filter retains a multi-day session after its newer activity changes updatedAt", async () => {
  const older = Date.parse("2026-10-07T13:00:00Z");
  const later = Date.parse("2026-10-09T13:00:00Z");
  const sessions = [
    { id: "multi-day", title: "Work", updatedAt: new Date(later).toISOString() },
    { id: "later-only", title: "Later", updatedAt: new Date(later).toISOString() },
  ];
  bridge = async (_channel, input) => ({
    ok: true,
    data: snapshot(
      input.sessionId,
      input.sessionId === "multi-day"
        ? [
            { ...request("old"), startedAt: older },
            { ...request("new"), startedAt: later },
          ]
        : [{ ...request("new-only"), startedAt: later }],
    ),
  });
  let metadata = [];
  await service.readOverviewSnapshots(sessions, new AbortController().signal, (value) => {
    metadata = value;
  });
  const filtered = overview.filterOverviewSessions(
    sessions,
    { range: "day", day: "2026-10-07", now: later, query: "", project: "" },
    metadata,
  );
  assert.deepEqual(
    filtered.map((session) => session.id),
    ["multi-day"],
  );
  assert.equal(overview.contextDay(Number.NaN), "");
  assert.equal(
    overview.filterOverviewSessions(
      sessions,
      { range: "day", day: "", now: later, query: "", project: "" },
      metadata,
    ).length,
    0,
  );
});

test("usage charts and day queries follow the host local calendar across UTC midnight", () => {
  const moduleUrl = new URL("../src/features/context-insights/overview-model.ts", import.meta.url)
    .href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { contextDay, contextDayRange, recentContextDays } from ${JSON.stringify(moduleUrl)}; const now = Date.parse('2026-10-08T16:20:00Z'); console.log(JSON.stringify({ day: contextDay(now), range: contextDayRange('2026-10-09'), days: recentContextDays(now, 7), invalid: contextDayRange('2026-02-31') }));`,
    ],
    { env: { ...process.env, TZ: "Asia/Taipei" }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.day, "2026-10-09");
  assert.equal(data.days.at(-1), "2026-10-09");
  assert.equal(data.range.startDate, Date.parse("2026-10-08T16:00:00Z"));
  assert.equal(data.range.endDate, Date.parse("2026-10-09T15:59:59.999Z"));
  assert.equal(data.invalid, null);
});

test("a hydrated logical request is replaced by the actual wire payload after dispatch", async () => {
  const logical = { ...request("same-request"), captureSource: "pi-context", contentRevision: 0 };
  const wire = {
    ...logical,
    captureSource: "provider-payload",
    contentRevision: 1,
    providerPayload: {
      content: '{"messages":["WIRE_ONLY"]}',
      originalChars: 26,
      truncated: false,
      redacted: true,
    },
  };
  const metadata = {
    ...wire,
    providerPayload: { ...wire.providerPayload, content: "", contentOmitted: true },
    entries: wire.entries.map((entry) => ({ ...entry, content: "", contentOmitted: true })),
  };
  bridge = async (_channel, input) => ({
    ok: true,
    data: snapshot("session", [input.includeContent ? wire : metadata]),
  });
  assert.equal(
    model.hydrateCapturedRequest(metadata, logical),
    undefined,
    "the logical capture cannot mask newly dispatched content",
  );
  const full = await service.readContextInsights("session", {
    requestId: wire.id,
    includeContent: true,
  });
  const hydrated = model.hydrateCapturedRequest(metadata, full.requests[0]);
  assert.equal(hydrated.providerPayload.content, wire.providerPayload.content);
  const browser = render(ContextBrowser, {
    request: hydrated,
    loading: false,
    toolSort: "tokens",
    onToolSort() {},
  });
  assert.ok(browser.includes("WIRE_ONLY"));
  assert.ok(browser.includes(i18n.t("contextInsights.providerPayload")));
  assert.equal(
    model.hydrateCapturedRequest({ ...metadata, contentRevision: 2 }, hydrated),
    undefined,
    "equal-length provider hook mutations invalidate the cached content",
  );
});

test("a late logical full-content read cannot own the newer wire revision", async () => {
  const logical = { ...request("same"), captureSource: "pi-context", contentRevision: 0 };
  const wire = {
    ...logical,
    captureSource: "provider-payload",
    contentRevision: 1,
    providerPayload: {
      content: "WIRE_LATEST",
      originalChars: 11,
      truncated: false,
      redacted: true,
    },
  };
  const releases = [];
  bridge = () => new Promise((resolve) => releases.push(resolve));
  const oldOwner = new AbortController();
  const oldRead = service.readSelectedRequest("session", logical, oldOwner.signal);
  oldOwner.abort();
  const currentRead = service.readSelectedRequest("session", wire, new AbortController().signal);
  releases[1]({ ok: true, data: snapshot("session", [wire]) });
  const current = await currentRead;
  releases[0]({ ok: true, data: snapshot("session", [logical]) });
  assert.equal(await oldRead, undefined);
  assert.equal(current.providerPayload.content, "WIRE_LATEST");
  const browser = render(ContextBrowser, {
    request: current,
    loading: false,
    toolSort: "tokens",
    onToolSort() {},
  });
  assert.ok(browser.includes("WIRE_LATEST"));
  assert.equal(model.hydrateCapturedRequest(wire, logical), undefined);
});

test("total trend exposes logical category composition for every dispatched request", () => {
  const chart = render(ContextTrend, {
    requests: [request("one"), request("two", 2)],
    events: [],
    preferences: { granularity: "step", measure: "total" },
    pinnedId: null,
    onPreferences() {},
    onPin() {},
    onPreview() {},
  });
  assert.equal((chart.match(/class="ci-trend-stack"/g) ?? []).length, 2);
  assert.equal((chart.match(/data-category="system"/g) ?? []).length, 2);
  assert.equal((chart.match(/data-category="assistant"/g) ?? []).length, 2);
});

test("Task relationships select their own captured context using the recorded call id", () => {
  const agents = transcript.transcriptAgents([
    {
      id: "task-row",
      role: "tool",
      content: "",
      createdAt: "2026-10-09T00:00:00Z",
      toolName: "Task",
      toolCallId: "call-worker",
      toolArgs: { agent: "Reader" },
      toolResult: { delegationId: "delegation-worker" },
    },
  ]);
  assert.equal(agents[0].callId, "call-worker");
  const requests = [
    request("main"),
    {
      ...request("worker"),
      purpose: "subagent",
      parentToolCallId: "call-worker",
      agentName: "Reader",
    },
    { ...request("other"), purpose: "subagent", parentToolCallId: "call-other" },
  ];
  assert.deepEqual(
    model.selectAgentRequests(requests, agents[0].callId).map((entry) => entry.id),
    ["worker"],
  );
  assert.deepEqual(
    model.selectAgentRequests(requests, "main").map((entry) => entry.id),
    ["main"],
  );
  assert.deepEqual(model.selectAgentRequests(requests, "missing"), []);
});
