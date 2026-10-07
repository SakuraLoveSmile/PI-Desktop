import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

function createHookHarness() {
  let current;
  const cell = () => {
    const index = current.cursor++;
    return [current.hooks, index];
  };
  const sameDependencies = (a, b) => a?.length === b?.length &&
    a.every((dependency, index) => Object.is(dependency, b[index]));
  const memo = (factory, dependencies) => {
    const [hooks, index] = cell();
    const existing = hooks[index];
    if (!existing || !sameDependencies(existing.dependencies, dependencies)) {
      hooks[index] = { value: factory(), dependencies };
    }
    return hooks[index].value;
  };
  return {
    react: {
      useMemo: memo,
      useCallback(callback, dependencies) {
        return memo(() => callback, dependencies);
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        const [hooks, index] = cell();
        const existing = hooks[index] ?? { subscribe: null, cleanup: null };
        if (existing.subscribe !== subscribe) {
          existing.cleanup?.();
          existing.subscribe = subscribe;
          existing.cleanup = subscribe(() => { existing.snapshot = getSnapshot(); });
        }
        existing.snapshot = getSnapshot();
        hooks[index] = existing;
        return existing.snapshot;
      },
    },
    render(component, hook, props) {
      current = component;
      component.cursor = 0;
      try {
        component.value = hook(...props);
        return component.value;
      } finally {
        current = null;
      }
    },
    createComponent() { return { hooks: [], cursor: 0, value: undefined }; },
    unmount(component) {
      for (const hook of component.hooks) hook?.cleanup?.();
      component.hooks = [];
    },
  };
}

test("a disabled hook reuses the current shared reader after idle eviction", async () => {
  let eventSubscriptions = 0;
  let hostSubscriptions = 0;
  const api = {
    getTeamSnapshot: async (teamSessionId) => ({
      teamSessionId,
      revision: 1,
      paused: false,
      members: [],
      tasks: [],
      readiness: { ready: true, issues: [] },
      scopeOverlaps: [],
      leadPhase: "idle",
      queuedMessageCount: 0,
      review: null,
      decision: null,
    }),
    onTeamChanged: () => { eventSubscriptions += 1; return () => {}; },
    onHostStatus: () => { hostSubscriptions += 1; return () => {}; },
  };
  const runtime = await load("../src/stores/runtime/team-runtime.ts", {});
  const harness = createHookHarness();
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { useTeamSnapshot } = await load("../src/hooks/useTeamSnapshot.ts", {
    react: harness.react,
    "../lib/api": { api },
    "../stores/app-store": { useAppStore: { getState: () => ({ refreshSessions: async () => undefined }) } },
    "../stores/runtime/team-runtime": runtime,
  });

  const originalConsumer = harness.createComponent();
  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 1);

  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: false }]);
  await new Promise((resolve) => setImmediate(resolve));

  const newConsumer = harness.createComponent();
  harness.render(newConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 2, "the idle reader was evicted and replaced once");
  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 2, "reenabling joins the replacement reader already used by another consumer");
  assert.equal(hostSubscriptions, 2, "only one Host listener exists for each reader lifecycle");

  harness.unmount(originalConsumer);
  harness.unmount(newConsumer);
});

function snapshot(teamSessionId, revision, extra = {}) {
  return {
    teamSessionId, revision, paused: false, members: [], tasks: [], readiness: [],
    scopeOverlaps: [], leadPhase: "idle", queuedMessageCount: 0,
    review: null, decision: null, ...extra,
  };
}

async function liveHookFixture(t, read) {
  const runtime = await load("../src/stores/runtime/team-runtime.ts", {});
  const presentation = await load("../src/lib/team-presentation.ts", {});
  const events = new Set();
  let sessionRefreshes = 0;
  const api = {
    getTeamSnapshot: read,
    onTeamChanged: (listener) => { events.add(listener); return () => events.delete(listener); },
    onHostStatus: () => () => {},
  };
  const originalWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.window = originalWindow; });
  const harness = createHookHarness();
  const { useTeamSnapshot } = await load("../src/hooks/useTeamSnapshot.ts", {
    react: harness.react,
    "../lib/api": { api },
    "../stores/app-store": { useAppStore: { getState: () => ({
      refreshSessions: async () => { sessionRefreshes += 1; },
    }) } },
    "../stores/runtime/team-runtime": runtime,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const component = harness.createComponent();
  t.after(() => harness.unmount(component));
  return {
    render: (id) => harness.render(component, useTeamSnapshot, [id]),
    event: (event) => { for (const listener of events) listener(event); },
    rows: (value) => presentation.buildTeamTaskRows(value.tasks, value.members, value.readiness, value.paused),
    get sessionRefreshes() { return sessionRefreshes; },
    get subscriptions() { return events.size; },
  };
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

test("the visible Team hook updates task owners, member activity and planning review without changing tabs", async (t) => {
  const task = {
    teamSessionId: "team-a", taskId: "research", revision: 1, subject: "Research authentication",
    status: "pending", ownerSessionId: null, ownerMemberName: null,
    blockedBy: [], writeScopes: [], deleted: false,
    createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z",
  };
  let current = snapshot("team-a", 1, { tasks: [task] });
  let reads = 0;
  const f = await liveHookFixture(t, async () => { reads += 1; return current; });
  assert.equal(f.render("team-a").loading, true);
  await flushAsync();
  assert.equal(f.rows(f.render("team-a").snapshot)[0].owner, undefined);

  const researcher = {
    teamSessionId: "team-a", memberSessionId: "researcher-session", name: "researcher",
    phase: "idle", contextKind: "fresh",
    presentation: { role: "researcher", displayName: "Alex" },
  };
  current = snapshot("team-a", 2, { members: [researcher], tasks: [task] });
  f.event({ teamSessionId: "team-a", revision: 2, reason: "member" });
  t.mock.timers.tick(200);
  await flushAsync();
  assert.equal(f.render("team-a").snapshot.members[0].name, "researcher");
  assert.equal(f.sessionRefreshes, 1, "new durable member sessions are refreshed too");

  current = snapshot("team-a", 3, {
    members: [{ ...researcher, phase: "running" }],
    tasks: [{ ...task, ownerSessionId: researcher.memberSessionId, status: "in_progress" }],
    leadPhase: "running",
  });
  f.event({ teamSessionId: "team-a", revision: 3, reason: "task" });
  f.event({ teamSessionId: "team-a", revision: 3, reason: "activity" });
  t.mock.timers.tick(200);
  await flushAsync();
  const running = f.render("team-a").snapshot;
  assert.equal(f.rows(running)[0].owner.displayName, "Alex");
  assert.equal(f.rows(running)[0].owner.phase, "running");
  assert.equal(f.rows(running)[0].state, "in_progress");
  assert.equal(running.leadPhase, "running");

  current = snapshot("team-a", 4, {
    members: [{ ...researcher, phase: "completed" }],
    tasks: [{ ...task, ownerSessionId: researcher.memberSessionId, status: "completed" }],
    leadPhase: "completed",
    review: { reviewId: "plan-audit", launchPolicy: "automatic_plan", status: "confirmed" },
  });
  f.event({ teamSessionId: "team-a", revision: 4, reason: "task" });
  f.event({ teamSessionId: "team-a", revision: 4, reason: "activity" });
  t.mock.timers.tick(200);
  await flushAsync();
  const completed = f.render("team-a").snapshot;
  assert.equal(f.rows(completed)[0].state, "completed");
  assert.equal(f.rows(completed)[0].owner.phase, "completed");
  assert.equal(completed.review.status, "confirmed");
  assert.equal(completed.leadPhase, "completed");
  assert.equal(reads, 4, "all changes arrive through bounded Team events before the recovery poll");
  assert.equal(f.subscriptions, 1, "renders keep the same shared subscription");
});

test("switching Teams rejects an old in-flight snapshot and ignores the old Team's events", async (t) => {
  let resolveOld;
  const oldRead = new Promise((resolve) => { resolveOld = resolve; });
  const reads = [];
  const f = await liveHookFixture(t, (id) => {
    reads.push(id);
    return id === "team-a" ? oldRead : Promise.resolve(snapshot("team-b", 1));
  });
  f.render("team-a");
  f.render("team-b");
  await flushAsync();
  assert.equal(f.render("team-b").snapshot.teamSessionId, "team-b");

  resolveOld(snapshot("team-a", 99));
  f.event({ teamSessionId: "team-a", revision: 100, reason: "task" });
  t.mock.timers.tick(200);
  await flushAsync();
  assert.equal(f.render("team-b").snapshot.teamSessionId, "team-b");
  assert.deepEqual(reads, ["team-a", "team-b"]);
  assert.equal(f.subscriptions, 1, "the old Team subscription is released on session switch");
});
