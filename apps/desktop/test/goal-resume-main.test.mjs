import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
register(pathToFileURL(fileURLToPath(new URL("helpers/ts-import-hooks.mjs", import.meta.url))));
const { createGoalResumeRuntime } = await import("../electron/main/runtime/goal-resume.ts");
const { createPlanRuntime } = await import("../electron/main/runtime/plans.ts");
const { createSessionCoordination } = await import("../electron/main/runtime/session-coordination.ts");
const { registerGoalReportIpc } = await import("../electron/main/ipc/goal-report-ipc.ts");
const { IPC } = await import("@pi-desktop/shared");

function fixture({ failAt, accepted = true, blockGate } = {}) {
  const calls = [], events = [], handlers = new Map();
  const execution = { id: "goal", sessionId: "lead", kind: "goal", state: "running", targetPermissionMode: "ask", executionProviderId: "chosen", executionModelId: "model" };
  const activeTurns = new Map();
  const coordination = createSessionCoordination({ activeTurns, getMainWindow: () => null, getViewingSessionId: () => null });
  let blocked = 0, resumed = 0;
  const host = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === failAt) throw new Error(`failed ${method}`);
      if (method === "goalExecutions.resume") return { execution, hold: { state: "resumed" }, resume: { reasons: [{ code: "report_missing" }], segment: 2 } };
      if (method === "settings.get") return {};
      if (method === "session.get") return { session: { id: "lead" } };
      if (method === "session.beginTurn") return { turnId: "turn-2" };
      if (method === "goalExecutions.settle") return { execution, hold: { state: "blocked", pausedTeam: false } };
      return { ok: true };
    },
  };
  const sidecar = { async call(method, params) {
    calls.push({ method, params });
    if (method === failAt) throw new Error(`failed ${method}`);
    return { accepted };
  } };
  const runtimeState = { host, sidecar };
  const plan = createPlanRuntime({
    runtimeState, planState: { approvedExecutionDrain: null }, logger: { app() {} }, sendToRenderer() {}, coordination,
    scheduledRunsBySession: new Map(), activeToolCalls: new Map(), planSubmissionTurnIds: new Set(),
    approvedExecutionIdsBySession: new Map(), claimedExecutionSessions: new Map(), approvedExecutionTurns: new Map(),
    startedApprovedExecutions: new Set(), finishedApprovedExecutions: new Set(["goal"]), dispatchingApprovedExecutions: new Set(),
    inFlightExecutionFinishes: new Set(), pendingExecutionFinishes: new Map(), announceTurnEnded() {}, emitAgentEvent() {},
    acquireSessionOperation: coordination.acquireSessionOperation, resolveAgentRuntimeLaunch: async () => {}, isQuitting: () => false,
    onGoalBlocked: async () => { blocked++; await blockGate; },
  });
  const resume = createGoalResumeRuntime({
    runtimeState, activeTurns, acquireSessionOperation: coordination.acquireSessionOperation,
    resolveAgentRuntimeLaunch: async (_id, _detail, _settings, overrides) => {
      assert.equal(overrides.providerId, "chosen");
      return { providerId: "chosen", modelId: "model", sidecarParams: { sessionId: "lead" } };
    },
    waitForExecutionSettlement: plan.waitForExecutionSettlement,
    registerResumedExecution: plan.registerResumedExecution, finishTurn: plan.finishTurn,
    lockExecutionInterruption: plan.lockExecutionInterruption, finishApprovedExecution: plan.finishApprovedExecution,
    emitAgentEvent: event => events.push(event), onGoalResumed: async () => { resumed++; },
  });
  registerGoalReportIpc({ handle: (channel, fn) => handlers.set(channel, fn), getHost: () => host, resumeBlockedGoal: resume });
  return { calls, events, activeTurns, execution, plan, handlers, blocked: () => blocked, resumed: () => resumed };
}
const request = { sessionId: "lead", executionId: "goal", expectedVersion: 3, message: "Continue with the supplied evidence", modelOverride: { providerId: "chosen", modelId: "model" } };

test("resume IPC claims the same goal, binds its new turn, and persists and echoes supplement once", async () => {
  const f = fixture();
  await f.handlers.get(IPC.invoke.goalResume)(request);
  assert.deepEqual(f.calls.map(c => c.method), ["goalExecutions.resume", "settings.get", "session.get", "session.beginTurn", "goalReports.bindExecutionTurn", "session.appendMessage", "agent.executeApprovedPlan"]);
  assert.equal(f.calls[0].params.expectedVersion, 3);
  assert.equal(f.calls.find(call => call.method === "session.beginTurn").params.createNotification, false);
  assert.deepEqual(f.calls[0].params.modelOverride, request.modelOverride);
  const dispatched = f.calls.at(-1).params;
  assert.equal(dispatched.execution.id, "goal");
  assert.equal(dispatched.execution.targetPermissionMode, "ask");
  assert.deepEqual(dispatched.resume, { reasons: [{ code: "report_missing" }], segment: 2, userMessage: request.message });
  assert.equal(dispatched.userMessageId, f.calls.find(call => call.method === "session.appendMessage").params.message.id);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].event.message.content, request.message);
  assert.equal(f.resumed(), 1);
  await f.plan.finishTurn("lead", "completed", undefined, { turnId: "turn-2" });
  await f.plan.finishApprovedExecution("goal", "completed");
  assert.equal(f.calls.filter(c => c.method === "goalExecutions.settle").length, 1, "prior finished segment does not suppress resumed settlement");
});

for (const failAt of ["settings.get", "session.beginTurn", "goalReports.bindExecutionTurn", "session.appendMessage", "agent.executeApprovedPlan"]) {
  test(`resume failure at ${failAt} returns the same execution to blocked`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(f.handlers.get(IPC.invoke.goalResume)(request), /failed/);
    const settlement = f.calls.find(c => c.method === "goalExecutions.settle");
    assert.deepEqual(settlement.params, { sessionId: "lead", executionId: "goal", ended: "errored", errorCode: "resume_failed", stopHint: "resume_failed" });
    assert.equal(f.activeTurns.size, 0);
    assert.equal(f.resumed(), 0);
    assert.equal(f.blocked(), 1);
    assert.equal(f.calls.some(c => c.method === "plans.finishExecution"), false);
  });
}
test("failed CAS cannot create a turn or overwrite a hold", async () => {
  const f = fixture({ failAt: "goalExecutions.resume" });
  await assert.rejects(f.handlers.get(IPC.invoke.goalResume)(request));
  assert.deepEqual(f.calls.map(c => c.method), ["goalExecutions.resume"]);
});
test("close validates its scoped CAS and delegates only accept or abandon", async () => {
  const f = fixture();
  await f.handlers.get(IPC.invoke.goalClose)({ ...request, action: "accept" });
  assert.equal(f.calls[0].method, "goalExecutions.close");
  await assert.rejects(f.handlers.get(IPC.invoke.goalClose)({ ...request, action: "force" }));
  assert.equal(f.calls.length, 1);
});


test("resume waits for the prior segment's member settlement before reusing its execution maps", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ blockGate: gate });
  f.plan.registerResumedExecution(f.execution);
  const settling = f.plan.finishApprovedExecution("goal", "completed");
  while (f.blocked() === 0) await new Promise(resolve => setImmediate(resolve));
  const resuming = f.handlers.get(IPC.invoke.goalResume)(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(call => call.method === "goalExecutions.resume"), false);
  release();
  await settling;
  await resuming;
  assert.equal(f.activeTurns.get("lead"), "turn-2");
  assert.equal(f.resumed(), 1);
});
