import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { createPlanRuntime } = await import("../electron/main/runtime/plans.ts");
const { createSessionCoordination } = await import(
  "../electron/main/runtime/session-coordination.ts"
);
const { createEventPersistence } = await import("../electron/main/runtime/event-persistence.ts");
const { registerAgentIpc } = await import("../electron/main/ipc/agent-ipc.ts");
const { PersistenceOutbox } = await import("../electron/main/persistence-outbox.ts");
const { InflightCheckpointer } = await import("../../../packages/host-runtime/src/inflight-checkpoint.ts");
const { IPC } = await import("@pi-desktop/shared");

function fixture({ flush = async () => undefined, pendingBySession = () => 0 } = {}) {
  const calls = [];
  const executionId = "execution-1";
  const sessionId = "session-1";
  const host = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === "plans.finishExecution") return { ok: true };
      if (method === "goalReports.markFailed") return { report: { status: "failed" } };
      if (method === "goalReports.finalizeReport") return { report: { status: "ready" } };
      throw new Error(`Unexpected Host call: ${method}`);
    },
  };
  const coordination = createSessionCoordination({
    activeTurns: new Map(),
    getMainWindow: () => null,
    getViewingSessionId: () => null,
  });
  const finished = new Set();
  const runtime = createPlanRuntime({
    runtimeState: { host },
    planState: { approvedExecutionDrain: null },
    logger: { app() {} },
    sendToRenderer() {},
    coordination,
    scheduledRunsBySession: new Map(),
    activeToolCalls: new Map(),
    planSubmissionTurnIds: new Set(),
    approvedExecutionIdsBySession: new Map([[sessionId, executionId]]),
    claimedExecutionSessions: new Map([[executionId, sessionId]]),
    approvedExecutionTurns: new Map([[executionId, { sessionId, turnId: "turn-1" }]]),
    startedApprovedExecutions: new Set([executionId]),
    finishedApprovedExecutions: finished,
    dispatchingApprovedExecutions: new Set(),
    inFlightExecutionFinishes: new Set(),
    pendingExecutionFinishes: new Map(),
    announceTurnEnded() {},
    emitAgentEvent() {},
    acquireSessionOperation: coordination.acquireSessionOperation,
    resolveAgentRuntimeLaunch: async () => {
      throw new Error("not used by this fixture");
    },
    isQuitting: () => false,
    persistenceOutbox: {
      flush,
      size: pendingBySession,
    },
  });
  return { calls, executionId, finished, runtime, sessionId };
}

test("a failed transcript flush settles the execution but leaves its report failed", async () => {
  const f = fixture({ flush: async () => { throw new Error("host unavailable"); } });
  await f.runtime.finishApprovedExecution(f.executionId, "completed");

  assert.deepEqual(f.calls.map((call) => call.method), [
    "plans.finishExecution",
    "goalReports.markFailed",
  ]);
  assert.deepEqual(f.calls[1].params, {
    sessionId: f.sessionId,
    executionId: f.executionId,
    errorCode: "REPORT_PERSISTENCE_BARRIER_FAILED",
  });
  assert.equal(f.finished.has(f.executionId), true);

  await f.runtime.finishApprovedExecution(f.executionId, "completed");
  assert.equal(f.calls.filter((call) => call.method === "plans.finishExecution").length, 1);
});

test("only pending transcript rows in the report session block publication", async () => {
  const blocked = fixture({ pendingBySession: (sessionId) => sessionId === "session-1" ? 1 : 0 });
  await blocked.runtime.finishApprovedExecution(blocked.executionId, "completed");
  assert.deepEqual(blocked.calls.map((call) => call.method), [
    "plans.finishExecution",
    "goalReports.markFailed",
  ]);

  const unrelated = fixture({ pendingBySession: (sessionId) => sessionId === "session-1" ? 0 : 1 });
  await unrelated.runtime.finishApprovedExecution(unrelated.executionId, "completed");
  assert.deepEqual(unrelated.calls.map((call) => call.method), [
    "plans.finishExecution",
    "goalReports.finalizeReport",
  ]);
});

test("interrupted executions settle without finalizing or marking a report failed", async () => {
  for (const options of [
    {},
    { flush: async () => { throw new Error("host unavailable"); } },
    { pendingBySession: () => 1 },
  ]) {
    const f = fixture(options);
    await f.runtime.finishApprovedExecution(f.executionId, "interrupted", "PLAN_EXECUTION_INTERRUPTED");
    assert.deepEqual(f.calls.map((call) => call.method), ["plans.finishExecution"]);
    assert.equal(f.calls[0].params.status, "interrupted");
    assert.equal(f.finished.has(f.executionId), true);
    await f.runtime.finishApprovedExecution(f.executionId, "interrupted", "PLAN_EXECUTION_INTERRUPTED");
    assert.equal(f.calls.length, 1, "repeated interruption cannot publish a report");
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise the actual admission, IPC stop/abort, event persistence, turn
// coordination and execution settlement. Only process/RPC boundaries are fake.
async function lifecycleFixture(t, { kind = "goal", stopGate, abortGate, endTurnGate, beforeStop, beforeAbort } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "goal-report-lifecycle-"));
  const calls = [];
  const sidecarCalls = [];
  const handlers = new Map();
  const settlements = [];
  const announcements = [];
  const executionFinishes = [];
  const activeTurns = new Map();
  const coordination = createSessionCoordination({ activeTurns, getMainWindow: () => null, getViewingSessionId: () => null });
  const approvedExecutionIdsBySession = new Map();
  const approvedExecutionTurns = new Map();
  const claimedExecutionSessions = new Map();
  const pendingExecutionFinishes = new Map();
  const activeToolCalls = new Map();
  const planSubmissionTurnIds = new Set();
  const execution = { id: "execution-1", proposalId: "proposal-1", sessionId: "session-1", kind, state: "queued",
    plan: "# Goal", title: "Goal", question: "Proceed?", targetPermissionMode: "ask",
    artifact: { relativePath: "goal.md", sha256: "hash", sizeBytes: 6 } };
  let nextTurnId = "turn-1";
  const endTurnEntered = deferred();
  const host = {
    isAvailable: () => true,
    async call(method, params) {
      calls.push({ method, params });
      if (method === "plans.claimExecution") return { execution: { ...params, ...execution, state: "running" } };
      if (method === "settings.get") return {};
      if (method === "session.get") return { session: { id: execution.sessionId } };
      if (method === "session.beginTurn") return { turnId: nextTurnId };
      if (method === "session.endTurn") { endTurnEntered.resolve(); await endTurnGate?.promise; return { ok: true }; }
      if (method === "session.saveActiveRevision") return { saved: null };
      if (method === "goalReports.finalizeReport") return { report: { status: "ready" } };
      if (["plans.bindExecutionTurn", "goalReports.bindExecutionTurn", "session.appendMessage", "session.saveInflight", "plans.finishExecution"].includes(method)) return { ok: true };
      throw new Error(`Unexpected Host call: ${method}`);
    },
  };
  const abortEntered = deferred();
  const stopEntered = deferred();
  const sidecar = {
    async call(method, params) {
      sidecarCalls.push({ method, params });
      if (method === "agent.executeApprovedPlan") return { accepted: true };
      if (method === "agent.abort") { abortEntered.resolve(); await abortGate?.promise; return { ok: true, aborted: true }; }
      if (method === "agent.stop") { stopEntered.resolve(); await stopGate?.promise; return { requested: true }; }
      throw new Error(`Unexpected sidecar call: ${method}`);
    },
  };
  const outbox = new PersistenceOutbox(dataDir, () => {});
  const checkpointer = new InflightCheckpointer((checkpoint) => host.call("session.saveInflight", checkpoint));
  t.after(async () => { checkpointer.dispose(); await outbox.flush(() => host); await rm(dataDir, { recursive: true, force: true }); });
  const runtime = createPlanRuntime({
    runtimeState: { host, sidecar }, planState: { approvedExecutionDrain: null }, logger: { app() {} }, sendToRenderer() {}, coordination,
    scheduledRunsBySession: new Map(), activeToolCalls, planSubmissionTurnIds, approvedExecutionIdsBySession, claimedExecutionSessions,
    approvedExecutionTurns, startedApprovedExecutions: new Set(), finishedApprovedExecutions: new Set(), dispatchingApprovedExecutions: new Set(),
    inFlightExecutionFinishes: new Set(), pendingExecutionFinishes, announceTurnEnded: (payload) => announcements.push(payload), emitAgentEvent() {},
    acquireSessionOperation: coordination.acquireSessionOperation,
    resolveAgentRuntimeLaunch: async () => ({ providerId: "fixture", modelId: "fixture", sidecarParams: { sessionId: execution.sessionId } }),
    isQuitting: () => false, persistenceOutbox: outbox,
  });
  const finishApprovedExecution = (...args) => {
    const finishing = runtime.finishApprovedExecution(...args);
    executionFinishes.push(finishing);
    return finishing;
  };
  const persistence = createEventPersistence({
    runtimeState: { host }, steeringReplies: new Set(), activeTurns, activeToolCalls, activeToolCallKey: coordination.activeToolCallKey,
    approvedExecutionIdsBySession, approvedExecutionTurns, planSubmissionTurnIds,
    planSubmissionTurnKey: coordination.planSubmissionTurnKey, inflightCheckpointer: checkpointer, persistenceOutbox: outbox,
    addActiveTurnUsage: coordination.addActiveTurnUsage, logger: { app() {} }, finishTurn: runtime.finishTurn,
    isStaleTerminalEvent: coordination.isStaleTerminalEvent, lockExecutionInterruption: runtime.lockExecutionInterruption,
    finishApprovedExecution, emitAgentEvent() {},
  });
  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) }, getHost: () => host, getSidecar: () => sidecar,
    getAgentHostBridge: () => null, logger: { app() {} }, vendorOAuth: {}, agentExtensions: { cancelPrompts() {} }, cancelSessionTools() {},
    persistenceOutbox: outbox, dataDir, activeTurns, isTurnDispatchable: coordination.isTurnDispatchable,
    activeTurnUsages: coordination.activeTurnUsages, approvedExecutionIdsBySession, claimedExecutionSessions,
    acquireSessionOperation: coordination.acquireSessionOperation, finishTurn: runtime.finishTurn, lockAbortReason: coordination.lockAbortReason,
    lockExecutionInterruption: runtime.lockExecutionInterruption, finishApprovedExecution,
    beforeUserStop: beforeStop, beforeUserAbort: beforeAbort,
  });
  const event = (event, turnId = "turn-1", extra = {}) => {
    persistence.persistAgentEvent({ sessionId: execution.sessionId, turnId, event, ts: 1, ...extra });
    const settlement = coordination.turnFinalizations.get(coordination.planSubmissionTurnKey(execution.sessionId, turnId));
    if (settlement) settlements.push(settlement);
  };
  const settle = async () => { await Promise.all(settlements); await Promise.all(executionFinishes); };
  const start = async (id = "execution-1", turnId = "turn-1") => {
    execution.id = id; nextTurnId = turnId;
    await runtime.dispatchApprovedPlan(execution);
  };
  if (kind !== "ordinary") await start();
  else activeTurns.set(execution.sessionId, "turn-1");
  return { calls, sidecarCalls, announcements, coordination, activeTurns, event, settle, start, abortEntered, stopEntered, endTurnEntered, pendingExecutionFinishes,
    abort: (turnId) => handlers.get(IPC.invoke.agentAbort)({ sessionId: execution.sessionId, ...(turnId ? { turnId } : {}) }),
    stop: (turnId) => handlers.get(IPC.invoke.agentStop)({ sessionId: execution.sessionId, ...(turnId ? { turnId } : {}) }),
  };
}

const agentEnd = { type: "agent_end", messageIds: [] };
const abortedMessage = { type: "message_end", message: { id: "reply", role: "assistant", status: "aborted", content: "Partial reply", createdAt: "2026-10-07T00:00:00Z" } };
function assertInterruptedWithoutReport(f, executionId = "execution-1") {
  assert.deepEqual(f.calls.filter((call) => call.method === "plans.finishExecution" && call.params.executionId === executionId).map((call) => call.params.status), ["interrupted"]);
  assert.equal(f.calls.some((call) => call.method.startsWith("goalReports.") && call.method !== "goalReports.bindExecutionTurn"), false);
}

test("cancel RPC still pending when agent_end arrives cannot publish a completed Goal report", async (t) => {
  const abortGate = deferred();
  const f = await lifecycleFixture(t, { abortGate });
  const aborting = f.abort();
  await f.abortEntered.promise;
  f.event(agentEnd);
  await f.settle();
  abortGate.resolve();
  await aborting;
  assert.equal(f.calls.find((call) => call.method === "session.endTurn").params.status, "aborted");
  assertInterruptedWithoutReport(f);
});

test("provider aborted message followed by agent_end interrupts the Goal execution", async (t) => {
  const f = await lifecycleFixture(t);
  f.event(abortedMessage);
  f.event(agentEnd);
  await f.settle();
  assertInterruptedWithoutReport(f);
});

test("provider error message without a separate error event interrupts the Goal execution", async (t) => {
  const f = await lifecycleFixture(t);
  f.event({ ...abortedMessage, message: { ...abortedMessage.message, status: "error" } });
  f.event(agentEnd);
  await f.settle();
  assertInterruptedWithoutReport(f);
});

test("an error event racing agent_end retains the interrupted execution decision", async (t) => {
  const f = await lifecycleFixture(t);
  f.event({ type: "error", error: { code: "PROVIDER_ERROR", message: "Provider failed", retriable: false } });
  f.event(agentEnd);
  await f.settle();
  assert.equal(f.calls.find((call) => call.method === "session.endTurn").params.status, "error");
  assertInterruptedWithoutReport(f);
});

test("a provider error message retains its diagnostic code through later terminal events", async (t) => {
  const f = await lifecycleFixture(t);
  f.event({ ...abortedMessage, message: { ...abortedMessage.message, status: "error",
    error: { code: "PROVIDER_ERROR", message: "Provider failed", retriable: false } } });
  f.event({ type: "error", error: { code: "PROVIDER_ERROR", message: "Provider failed", retriable: false } });
  f.event(agentEnd);
  await f.settle();
  const finished = f.calls.find((call) => call.method === "plans.finishExecution");
  assert.equal(finished.params.status, "interrupted");
  assert.equal(finished.params.errorCode, "PROVIDER_ERROR");
  assert.equal(f.calls.some((call) => call.method === "goalReports.finalizeReport"), false);
});

test("graceful stop interrupts the Goal while retaining the completed ordinary turn boundary", async (t) => {
  const stopGate = deferred();
  const f = await lifecycleFixture(t, { stopGate });
  const stopping = f.stop();
  await f.stopEntered.promise;
  f.event(agentEnd);
  await f.settle();
  stopGate.resolve();
  await stopping;
  assert.equal(f.calls.find((call) => call.method === "session.endTurn").params.status, "completed");
  assertInterruptedWithoutReport(f);
});

test("stale stop, abort and provider-aborted messages cannot interrupt a new Goal execution", async (t) => {
  const f = await lifecycleFixture(t);
  f.event(agentEnd);
  await f.settle();
  await f.start("execution-2", "turn-2");
  assert.deepEqual(await f.stop("turn-1"), { requested: false });
  assert.deepEqual(await f.abort("turn-1"), { ok: false, aborted: false });
  f.event(abortedMessage, "turn-1");
  f.event(abortedMessage, "turn-2", { parentToolCallId: "delegate" });
  f.event(agentEnd, "turn-2");
  await f.settle();
  assert.deepEqual(f.calls.filter((call) => call.method === "plans.finishExecution").map((call) => call.params.status), ["completed", "completed"]);
  assert.equal(f.calls.filter((call) => call.method === "goalReports.finalizeReport").length, 2);
});

for (const operation of ["stop", "abort"]) {
  test(`${operation} freezes the Goal before awaiting delivery cleanup and never dispatches against its replacement turn`, async (t) => {
    const cleanupEntered = deferred();
    const cleanupGate = deferred();
    const before = async () => { cleanupEntered.resolve(); await cleanupGate.promise; };
    const f = await lifecycleFixture(t, operation === "stop" ? { beforeStop: before } : { beforeAbort: before });
    const stopping = f[operation]();
    await cleanupEntered.promise;
    f.event(agentEnd);
    await f.settle();
    assertInterruptedWithoutReport(f);
    // A new execution may claim the session before old delivery cleanup unwinds.
    // start() uses the real session-operation gate, which abort intentionally
    // still owns; install the replacement's live identity for this interleaving.
    f.activeTurns.set("session-1", "turn-2");
    cleanupGate.resolve();
    assert.deepEqual(await stopping, operation === "stop" ? { requested: false } : { ok: false, aborted: false });
    assert.equal(f.sidecarCalls.some((call) => call.method === `agent.${operation}`), false);
    assert.equal(f.activeTurns.get("session-1"), "turn-2");
  });
}

test("normal completion publishes exactly one Goal report", async (t) => {
  const f = await lifecycleFixture(t);
  f.event({ ...abortedMessage, message: { ...abortedMessage.message, status: "complete", content: "Goal achieved" } });
  f.event(agentEnd);
  await f.settle();
  f.event(agentEnd);
  await f.settle();
  assert.deepEqual(f.calls.filter((call) => call.method === "plans.finishExecution").map((call) => call.params.status), ["completed"]);
  assert.equal(f.calls.filter((call) => call.method === "goalReports.finalizeReport").length, 1);
  assert.ok(f.calls.findIndex((call) => call.method === "session.appendMessage") < f.calls.findIndex((call) => call.method === "goalReports.finalizeReport"));
});

test("a stop after natural completion has claimed the turn cannot rewrite its Goal result", async (t) => {
  const endTurnGate = deferred();
  const f = await lifecycleFixture(t, { endTurnGate });
  f.event(agentEnd);
  await f.endTurnEntered.promise;
  await f.stop();
  endTurnGate.resolve();
  await f.settle();
  assert.equal(f.calls.find((call) => call.method === "plans.finishExecution").params.status, "completed");
  assert.equal(f.calls.filter((call) => call.method === "goalReports.finalizeReport").length, 1);
});

test("ordinary conversations and Plan executions retain graceful-stop completion semantics", async (t) => {
  for (const kind of ["ordinary", "plan"]) {
    const f = await lifecycleFixture(t, { kind });
    await f.stop();
    f.event(agentEnd);
    await f.settle();
    assert.equal(f.calls.find((call) => call.method === "session.endTurn").params.status, "completed");
    assert.equal(f.calls.some((call) => call.method === "goalReports.finalizeReport"), false);
    if (kind === "plan") assert.equal(f.calls.find((call) => call.method === "plans.finishExecution").params.status, "completed");
  }
});
