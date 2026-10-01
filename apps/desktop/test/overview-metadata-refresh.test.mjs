import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());
const { createOverviewMetadataController } = await server.ssrLoadModule(
  "/src/hooks/useOverviewMetadata.ts",
);

function session(overrides = {}) {
  return {
    id: "session-a",
    source: "desktop",
    title: "Old title",
    messageCount: 5,
    projectPath: "/old/path",
    providerId: "provider-old",
    modelId: "model-old",
    mode: "agent",
    thinkingLevel: "off",
    permissionMode: "inherit",
    updatedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeHarness(initial, { getSession, manualTitle = false } = {}) {
  let current = initial;
  let active = true;
  let manual = manualTitle;
  let error = null;
  let intervalListener = null;
  let focusListener = null;
  const calls = [];
  const removals = { agent: 0, sessions: 0, plans: 0, host: 0, focus: 0, interval: 0 };
  const listeners = { agent: null, sessions: null, plans: null, host: null };
  const dependencies = {
    getSession: (id, options) => {
      calls.push({ id, options });
      return getSession ? getSession(id, options, calls.length - 1) : Promise.resolve({ session: session() });
    },
    getCurrentSession: () => current,
    isCurrentSession: () => active,
    updateSession: (update) => { current = update(current); },
    subscribeAgentEvent: (listener) => { listeners.agent = listener; return () => { removals.agent += 1; }; },
    subscribeSessionsChanged: (listener) => { listeners.sessions = listener; return () => { removals.sessions += 1; }; },
    subscribePlansChanged: (listener) => { listeners.plans = listener; return () => { removals.plans += 1; }; },
    subscribeHostRestart: (listener) => { listeners.host = listener; return () => { removals.host += 1; }; },
    addFocusListener: (listener) => { focusListener = listener; return () => { removals.focus += 1; }; },
    startInterval: (listener) => { intervalListener = listener; return 17; },
    stopInterval: (timer) => { assert.equal(timer, 17); removals.interval += 1; },
    isManualTitle: () => manual,
    onError: (next) => { error = next; },
  };
  return {
    dependencies,
    calls,
    listeners,
    removals,
    get current() { return current; },
    set current(value) { current = value; },
    set active(value) { active = value; },
    set manualTitle(value) { manual = value; },
    get error() { return error; },
    focus() { focusListener?.(); },
    interval() { intervalListener?.(); },
  };
}

function detail(overrides = {}) {
  return { session: session({ title: "Fresh title", messageCount: 6, updatedAt: "2026-09-02T00:00:00.000Z", ...overrides }) };
}

test("bounded refresh drops an old response after selection changes", async () => {
  const request = deferred();
  const harness = makeHarness(session(), { getSession: () => request.promise });
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  const pending = controller.refresh();
  assert.deepEqual(harness.calls[0], {
    id: "session-a",
    options: { messageLimit: 1 },
  });

  harness.active = false;
  request.resolve(detail());
  await pending;
  assert.equal(harness.current.title, "Old title");
  assert.equal(harness.current.messageCount, 5);
  controller.dispose();
});

test("a newer sessions-list projection is not rolled back by an older detail response", async () => {
  const request = deferred();
  const harness = makeHarness(session(), { getSession: () => request.promise });
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  const pending = controller.refresh();
  const latestTeam = { teamSessionId: "session-a", role: "lead" };
  harness.current = session({
    title: "Latest title",
    messageCount: 9,
    updatedAt: "2026-09-04T00:00:00.000Z",
    team: latestTeam,
  });

  request.resolve(detail({ title: "Stale title", messageCount: 7, updatedAt: "2026-09-03T00:00:00.000Z" }));
  await pending;
  assert.equal(harness.current.title, "Latest title");
  assert.equal(harness.current.messageCount, 9);
  assert.equal(harness.current.updatedAt, "2026-09-04T00:00:00.000Z");
  assert.equal(harness.current.team, latestTeam);
  controller.dispose();
});

test("manual title and configuration changes made during a read retain priority", async () => {
  const request = deferred();
  const harness = makeHarness(session(), { getSession: () => request.promise, manualTitle: true });
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  const pending = controller.refresh();
  harness.current = session({
    title: "User renamed task",
    providerId: "provider-new",
    modelId: "model-new",
    mode: "plan",
    thinkingLevel: "high",
  });
  request.resolve(detail({
    title: "Generated title",
    providerId: "provider-stale",
    modelId: "model-stale",
    mode: "agent",
    thinkingLevel: "off",
  }));
  await pending;
  assert.equal(harness.current.title, "User renamed task");
  assert.equal(harness.current.providerId, "provider-new");
  assert.equal(harness.current.modelId, "model-new");
  assert.equal(harness.current.mode, "plan");
  assert.equal(harness.current.thinkingLevel, "high");
  controller.dispose();
});

test("events coalesce while a bounded request is in flight", async () => {
  const requests = [deferred(), deferred()];
  const harness = makeHarness(session(), { getSession: (_id, _options, index) => requests[index].promise });
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  const first = controller.refresh();
  harness.listeners.agent({ sessionId: "session-a", event: { type: "agent_end" } });
  harness.listeners.sessions();
  harness.listeners.plans("session-a");
  assert.equal(harness.calls.length, 1);

  requests[0].resolve(detail());
  await first;
  assert.equal(harness.calls.length, 2, "multiple invalidations cause one follow-up read");
  const second = controller.refresh();
  requests[1].resolve(detail({ messageCount: 7 }));
  await second;
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.current.messageCount, 7);
  controller.dispose();
});

test("focus and host restart refresh the selected local session, and dispose removes every listener", async () => {
  const harness = makeHarness(session());
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  await controller.refresh();
  harness.focus();
  await controller.refresh();
  harness.listeners.host();
  await controller.refresh();
  harness.interval();
  await controller.refresh();
  assert.equal(harness.calls.length, 4);

  controller.dispose();
  controller.dispose();
  assert.deepEqual(harness.removals, {
    agent: 1, sessions: 1, plans: 1, host: 1, focus: 1, interval: 1,
  });
});

test("native and remote summaries never trigger a local session.get refresh", () => {
  for (const source of ["pi-native", "remote"]) {
    const harness = makeHarness(session({ source }));
    const controller = createOverviewMetadataController("session-a", harness.dependencies);
    controller.start();
    assert.equal(harness.calls.length, 0, `${source} skips the desktop Host route`);
    assert.equal(harness.listeners.agent, null, `${source} does not start refresh subscriptions`);
    assert.equal(harness.removals.interval, 0, `${source} does not start polling`);
    controller.dispose();
  }
});

test("a refresh-ineligible desktop session does not start the polling lifecycle", () => {
  const harness = makeHarness(session({ capabilities: { canPrompt: true, canStop: true, canRefresh: false } }));
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.listeners.agent, null);
  assert.equal(harness.removals.interval, 0);
  controller.dispose();
});

test("dispose cleans up listeners and ignores a response that resolves after unmount", async () => {
  const request = deferred();
  const harness = makeHarness(session(), { getSession: () => request.promise });
  const controller = createOverviewMetadataController("session-a", harness.dependencies);
  controller.start();
  const pending = controller.refresh();
  controller.dispose();
  request.resolve(detail({ messageCount: 99 }));
  await pending;
  assert.equal(harness.current.messageCount, 5);
  assert.equal(harness.error, null);
  assert.deepEqual(harness.removals, {
    agent: 1, sessions: 1, plans: 1, host: 1, focus: 1, interval: 1,
  });
});
