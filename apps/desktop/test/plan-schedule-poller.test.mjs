import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { setImmediate } from "node:timers/promises";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createPlanSchedulePoller } = await import("../electron/main/runtime/plan-schedule-poller.ts");
const { createPlanRuntime } = await import("../electron/main/runtime/plans.ts");

function hostFixture() {
  const handlers = new Set();
  return {
    handlers,
    onNotification(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    notify(method = "plans.changed") { for (const handler of handlers) handler(method, {}); },
  };
}
function setup(t, poll = async () => ({ nextDueAt: null, retrySoon: false })) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let host = hostFixture();
  let calls = 0;
  const errors = [];
  const runner = createPlanSchedulePoller({
    getHost: () => host,
    poll: () => { calls++; return poll(); },
    report: (error) => errors.push(error),
  });
  t.after(runner.stop);
  return { runner, errors, calls: () => calls, host: () => host, replace: (value) => { host = value; } };
}
async function advance(t, ms) { t.mock.timers.tick(ms); await setImmediate(); }

test("idle polling reads twice in the first minute instead of sixty times", async (t) => {
  const s = setup(t);
  s.runner.start(); await setImmediate();
  await advance(t, 29_999); assert.equal(s.calls(), 1);
  await advance(t, 1); assert.equal(s.calls(), 2);
  await advance(t, 29_999); assert.equal(s.calls(), 2);
});

for (const nextDueAt of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "13000"]) {
  test(`invalid deadline ${String(nextDueAt)} uses the thirty second idle interval`, async (t) => {
    const s = setup(t, async () => ({ nextDueAt, retrySoon: false }));
    s.runner.start(); await setImmediate();
    await advance(t, 29_999); assert.equal(s.calls(), 1);
    await advance(t, 1); assert.equal(s.calls(), 2);
  });
}

test("future deadlines trigger on time with one second floor and thirty second ceiling", async (t) => {
  let nextDueAt = 13_000;
  const s = setup(t, async () => ({ nextDueAt, retrySoon: false }));
  s.runner.start(); await setImmediate();
  await advance(t, 11_999); assert.equal(s.calls(), 1);
  nextDueAt = 13_001;
  await advance(t, 1); assert.equal(s.calls(), 2);
  await advance(t, 999); assert.equal(s.calls(), 2);
  nextDueAt = 100_000;
  await advance(t, 1); assert.equal(s.calls(), 3);
  await advance(t, 29_999); assert.equal(s.calls(), 3);
  await advance(t, 1); assert.equal(s.calls(), 4);
});

test("plan notifications debounce and resume nudge promptly rescans after a clock jump", async (t) => {
  const s = setup(t);
  s.runner.start(); await setImmediate();
  s.host().notify("other.changed"); await advance(t, 200); assert.equal(s.calls(), 1);
  s.host().notify(); await advance(t, 100);
  s.host().notify(); await advance(t, 99); assert.equal(s.calls(), 1);
  await advance(t, 1); assert.equal(s.calls(), 2);
  t.mock.timers.setTime(90_000);
  s.runner.nudge(); await advance(t, 199); assert.equal(s.calls(), 2);
  await advance(t, 1); assert.equal(s.calls(), 3);
});

test("continuous notifications cannot postpone a wakeup and a notification cannot delay a nearer deadline", async (t) => {
  const s = setup(t, async () => ({ nextDueAt: 2_000, retrySoon: false }));
  s.runner.start(); await setImmediate();
  await advance(t, 900);
  s.host().notify(); await advance(t, 50);
  s.host().notify(); await advance(t, 49); assert.equal(s.calls(), 1);
  await advance(t, 1); assert.equal(s.calls(), 2, "the one second deadline still fires on time");
  s.host().notify();
  for (let i = 0; i < 3; i++) { await advance(t, 50); s.host().notify(); }
  await advance(t, 50); assert.equal(s.calls(), 3, "the first notification opens a bounded 200 ms window");
});

test("nudges during a slow poll never overlap and coalesce into one followup", async (t) => {
  let release;
  const s = setup(t, () => new Promise((resolve) => { release = resolve; }));
  s.runner.start();
  s.runner.nudge(); s.host().notify(); s.runner.nudge();
  await advance(t, 60_000); assert.equal(s.calls(), 1);
  release({ nextDueAt: null, retrySoon: false }); await setImmediate();
  await advance(t, 199); assert.equal(s.calls(), 1);
  await advance(t, 1); assert.equal(s.calls(), 2);
  release({ nextDueAt: null, retrySoon: false }); await setImmediate();
  await advance(t, 200); assert.equal(s.calls(), 2);
});

test("changing host detaches the old subscriber and ignores its late callback", async (t) => {
  const s = setup(t);
  s.runner.start(); await setImmediate();
  const old = s.host();
  const staleCallback = [...old.handlers][0];
  const replacement = hostFixture();
  s.replace(replacement); s.runner.nudge();
  assert.equal(old.handlers.size, 0); assert.equal(replacement.handlers.size, 1);
  await advance(t, 200); assert.equal(s.calls(), 2);
  staleCallback("plans.changed", {}); await advance(t, 200); assert.equal(s.calls(), 2);
  replacement.notify(); await advance(t, 200); assert.equal(s.calls(), 3);
});

test("host replacement during a poll refreshes the subscription and discards its deadline", async (t) => {
  let release;
  const s = setup(t, () => new Promise((resolve) => { release = resolve; }));
  s.runner.start();
  const old = s.host(); const replacement = hostFixture(); s.replace(replacement);
  release({ nextDueAt: 100_000, retrySoon: false }); await setImmediate();
  assert.equal(old.handlers.size, 0); assert.equal(replacement.handlers.size, 1);
  await advance(t, 200); assert.equal(s.calls(), 2);
  s.runner.stop(); release({ nextDueAt: null, retrySoon: false }); await setImmediate();
});

for (const failure of ["throw", "retrySoon"]) {
  test(`${failure} retries after five seconds`, async (t) => {
    const s = setup(t, async () => {
      if (failure === "throw") throw new Error("host unavailable");
      return { nextDueAt: 1_001, retrySoon: true };
    });
    s.runner.start(); await setImmediate();
    await advance(t, 4_999); assert.equal(s.calls(), 1);
    await advance(t, 1); assert.equal(s.calls(), 2);
    assert.equal(s.errors.length, failure === "throw" ? 2 : 0);
  });
}

test("stop clears wakeups and subscriptions even when an old poll finishes later; restart works", async (t) => {
  let release;
  const s = setup(t, () => new Promise((resolve) => { release = resolve; }));
  s.runner.start(); s.runner.nudge(); s.runner.stop();
  assert.equal(s.host().handlers.size, 0);
  release({ nextDueAt: null, retrySoon: false }); await setImmediate();
  s.runner.nudge(); await advance(t, 60_000); assert.equal(s.calls(), 1);
  s.runner.start(); assert.equal(s.calls(), 2); assert.equal(s.host().handlers.size, 1);
  s.runner.stop(); release({ nextDueAt: null, retrySoon: false }); await setImmediate();
  await advance(t, 60_000); assert.equal(s.calls(), 2);
});

test("stop then restart during a slow poll preserves single flight and reruns after completion", async (t) => {
  let release;
  const s = setup(t, () => new Promise((resolve) => { release = resolve; }));
  s.runner.start(); s.runner.stop(); s.runner.start(); assert.equal(s.calls(), 1);
  release({ nextDueAt: null, retrySoon: false }); await setImmediate();
  await advance(t, 200); assert.equal(s.calls(), 2);
  s.runner.stop(); release({ nextDueAt: null, retrySoon: false }); await setImmediate();
});

function runtimeFixture(call) {
  const runtimeState = { host: { call }, sidecar: {} };
  const runtime = createPlanRuntime({ runtimeState, coordination: {}, logger: { app() {} }, isQuitting: () => false });
  return { runtimeState, runtime };
}

test("schedule user path scans, claims due snapshots and keeps busy snapshots missed", async () => {
  const calls = [];
  const { runtime } = runtimeFixture(async (method, params) => {
    calls.push([method, params]);
    if (method === "plans.dueSchedules") return { nextDueAt: 42_000, schedules: [{ proposalId: "busy", sessionId: "session" }] };
    if (method === "plans.claimSchedule") throw { data: { errorCode: "PLAN_SCHEDULE_SESSION_BUSY" } };
    return {};
  });
  assert.deepEqual(await runtime.pollPlanSchedules(), { nextDueAt: 42_000, retrySoon: false });
  assert.deepEqual(calls.map(([method]) => method), ["plans.dueSchedules", "plans.claimSchedule", "plans.markScheduleMissed"]);
  assert.deepEqual(calls[2][1], { proposalId: "busy", sessionId: "session" });
});

test("claim failure and missed recording failure request retry without changing busy semantics", async () => {
  for (const errorCode of ["PLAN_SCHEDULE_STALE", "PLAN_SCHEDULE_SESSION_BUSY"]) {
    const { runtime } = runtimeFixture(async (method) => {
      if (method === "plans.dueSchedules") return { nextDueAt: null, schedules: [{ proposalId: "p", sessionId: "s" }] };
      throw { errorCode };
    });
    assert.deepEqual(await runtime.pollPlanSchedules(), { nextDueAt: null, retrySoon: true });
  }
});

test("unready runtime retries and stale due results cannot claim through a new host", async () => {
  let release;
  const { runtime, runtimeState } = runtimeFixture(() => new Promise((resolve) => { release = resolve; }));
  runtimeState.sidecar = null;
  assert.deepEqual(await runtime.pollPlanSchedules(), { nextDueAt: null, retrySoon: true });
  runtimeState.sidecar = {};
  const pending = runtime.pollPlanSchedules();
  runtimeState.host = { call() { throw new Error("stale result must not reach new host"); } };
  release({ nextDueAt: 42_000, schedules: [{ proposalId: "p", sessionId: "s" }] });
  assert.deepEqual(await pending, { nextDueAt: null, retrySoon: true });
});

test("deadline wakeup reaches the approved execution boundary once through real runtime wiring", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const execution = { id: "execution", proposalId: "proposal", sessionId: "session", kind: "plan", state: "queued",
    plan: "# Plan", title: "Plan", question: "Proceed?", targetPermissionMode: "ask",
    artifact: { relativePath: "plan.md", sha256: "hash", sizeBytes: 6 } };
  const calls = []; const launches = []; const host = hostFixture();
  let claimed = false;
  host.call = async (method) => {
    calls.push(method);
    if (method === "plans.dueSchedules") return { nextDueAt: claimed ? null : (Date.now() < 2_000 ? 2_000 : null),
      schedules: !claimed && Date.now() >= 2_000 ? [{ proposalId: "proposal", sessionId: "session" }] : [] };
    if (method === "plans.claimSchedule") { claimed = true; return { execution }; }
    if (method === "plans.claimExecution") return { execution: { ...execution, state: "running" } };
    if (method === "settings.get") return {};
    if (method === "session.get") return { session: { id: "session" } };
    if (method === "session.beginTurn") return { turnId: "execution-turn" };
    throw new Error(`Unexpected method ${method}`);
  };
  const activeTurns = new Map();
  const startedApprovedExecutions = new Set();
  const runtime = createPlanRuntime({
    runtimeState: { host, sidecar: { async call(method, params) { launches.push([method, params]); return { accepted: true }; } } },
    coordination: { activeTurns, activeTurnUsages: new Map() }, logger: { app() {} }, isQuitting: () => false,
    acquireSessionOperation: async () => () => {}, planSubmissionTurnIds: new Set(), startedApprovedExecutions,
    finishedApprovedExecutions: new Set(), dispatchingApprovedExecutions: new Set(), claimedExecutionSessions: new Map(),
    approvedExecutionIdsBySession: new Map(), approvedExecutionTurns: new Map(),
    resolveAgentRuntimeLaunch: async () => ({ providerId: "fake", modelId: "fake", sidecarParams: { sessionId: "session" } }),
  });
  const runner = createPlanSchedulePoller({ getHost: () => host, poll: runtime.pollPlanSchedules, report: (error) => { throw error; } });
  t.after(runner.stop);
  runner.start(); await setImmediate(); assert.equal(launches.length, 0);
  await advance(t, 999); assert.equal(launches.length, 0);
  await advance(t, 1);
  assert.equal(launches.length, 1); assert.equal(launches[0][0], "agent.executeApprovedPlan");
  assert.equal(launches[0][1].turnId, "execution-turn");
  assert.equal(launches[0][1].execution.id, "execution");
  assert.equal(activeTurns.get("session"), "execution-turn");
  assert.equal(startedApprovedExecutions.has("execution"), true);
  host.notify(); await advance(t, 200); assert.equal(launches.length, 1);
  assert.equal(calls.filter((method) => method === "plans.claimSchedule").length, 1);
});

const { createRuntimeLifecycle } = await import("../electron/main/runtime/lifecycle.ts");
const { mkdtemp, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

async function lifecycleFixture(t, failRecovery = false) {
  const dataDir = await mkdtemp(join(tmpdir(), "plan-poller-lifecycle-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const events = []; const hosts = [];
  const runtimeState = { host: null, sidecar: null };
  const lifecycle = createRuntimeLifecycle({
    runtimeState, dataDir, logger: { app() {} }, sendToRenderer() {},
    startHost: async () => {
      const host = hostFixture(); host.call = async () => ({});
      hosts.push(host); runtimeState.host = host;
    },
    startSidecar: async () => { runtimeState.sidecar = { setHost() {} }; },
    plugins: { setServices() {} }, applyNetworkProxyFromAppSettings: async () => {},
    setCurrentWorkspacePath() {}, rememberPluginScopes() {}, refreshUserMcp: async () => {},
    getDisplayLocale: () => "en", isQuitting: () => false,
    onBackendsReady: async () => {
      assert.equal(hosts[0].handlers.size, 0, "restart stops the old poller before recovery");
    },
    markMissedPlanSchedules: async () => {
      events.push("markMissed");
      if (failRecovery) throw new Error("recovery failed");
    },
    drainApprovedPlanExecutions: async () => { events.push("drain"); },
    pollPlanSchedules: async () => { events.push("poll"); return { nextDueAt: null, retrySoon: false }; },
  });
  t.after(lifecycle.stopPlanSchedulePoller);
  return { lifecycle, events, hosts };
}

test("boot recovery gate starts the poller only after missed maintenance and queued drain", async (t) => {
  const good = await lifecycleFixture(t);
  await good.lifecycle.bootBackends(); await setImmediate();
  assert.deepEqual(good.events, ["markMissed", "drain", "poll"]);
  assert.equal(good.hosts[0].handlers.size, 1);
  const failed = await lifecycleFixture(t, true);
  await failed.lifecycle.bootBackends(); failed.lifecycle.nudgePlanSchedulePoller();
  assert.deepEqual(failed.events, ["markMissed", "drain"]);
  assert.equal(failed.hosts[0].handlers.size, 0);
});

test("supervised restart unsubscribes before missed maintenance and subscribes to the replacement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const s = await lifecycleFixture(t);
  await s.lifecycle.bootBackends(); await setImmediate();
  const restarting = s.lifecycle.superviseRestart("host");
  await advance(t, 500); await restarting; await setImmediate();
  assert.deepEqual(s.events, ["markMissed", "drain", "poll", "markMissed", "drain", "poll"]);
  assert.equal(s.hosts[0].handlers.size, 0); assert.equal(s.hosts[1].handlers.size, 1);
  s.hosts[1].notify(); await advance(t, 200); assert.equal(s.events.at(-1), "poll");
  s.lifecycle.stopPlanSchedulePoller(); assert.equal(s.hosts[1].handlers.size, 0);
  const before = s.events.length;
  await advance(t, 60_000); assert.equal(s.events.length, before);
});
