import assert from "node:assert/strict";
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
