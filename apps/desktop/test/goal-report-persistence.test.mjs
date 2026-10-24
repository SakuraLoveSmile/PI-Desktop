import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createGoalReportPersistenceBarrier } = await import("../electron/main/runtime/goal-report-persistence.ts");
const { createEventPersistence } = await import("../electron/main/runtime/event-persistence.ts");
const { PersistenceOutbox } = await import("../electron/main/persistence-outbox.ts");

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function withPersistence(run) {
  const dir = await mkdtemp(join(tmpdir(), "pi-goal-report-persistence-"));
  const outbox = new PersistenceOutbox(dir, () => undefined);
  const runtimeState = { host: null };
  const activeTurns = new Map([["session", "turn"]]);
  const claimedExecutionSessions = new Map([["execution", "session"]]);
  const barrier = createGoalReportPersistenceBarrier({
    getHost: () => runtimeState.host,
    persistenceOutbox: outbox,
    activeTurns,
    claimedExecutionSessions,
  });
  const { persistAgentEvent } = createEventPersistence({
    runtimeState, activeTurns, activeToolCalls: new Map(),
    activeToolCallKey: (sessionId, toolCallId) => `${sessionId}:${toolCallId}`,
    approvedExecutionIdsBySession: new Map(), approvedExecutionTurns: new Map(),
    planSubmissionTurnIds: new Set(), persistenceOutbox: outbox,
    logger: { app: () => undefined },
  });
  try {
    await run({ outbox, runtimeState, activeTurns, claimedExecutionSessions, barrier, persistAgentEvent });
  } finally {
    runtimeState.host = null;
    await outbox.flush(() => null);
    await rm(dir, { recursive: true, force: true });
  }
}

const identity = { sessionId: "session", executionId: "execution" };

test("immediate report admission waits for the preceding tool_end through the real outbox", async () => {
  await withPersistence(async ({ runtimeState, outbox, barrier, persistAgentEvent }) => {
    const entered = deferred();
    const release = deferred();
    const writes = [];
    runtimeState.host = { isAvailable: () => true, call: async (method, params) => {
      writes.push({ method, params });
      entered.resolve();
      await release.promise;
      return {};
    } };
    persistAgentEvent({ sessionId: "session", turnId: "turn", ts: 1_000,
      event: { type: "tool_start", toolCallId: "native-call", toolName: "Bash", args: { command: "true" } } });
    persistAgentEvent({ sessionId: "session", turnId: "turn", ts: 1_100,
      event: { type: "tool_end", toolCallId: "native-call", result: { details: { exitCode: 0 } } } });
    // Do not await enqueue: the production event path deliberately fires it
    // without waiting, including while the outbox's initial load is pending.
    let admitted = false;
    const pending = barrier(identity).then(() => { admitted = true; });
    try {
      await entered.promise;
      assert.equal(admitted, false);
      assert.equal(outbox.size("session"), 1);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].method, "session.appendMessage");
      assert.equal(writes[0].params.turnId, "turn");
      assert.equal(writes[0].params.message.toolCallId, "native-call");
      assert.deepEqual(writes[0].params.message.toolResult, { details: { exitCode: 0 } });
    } finally {
      release.resolve();
      await pending;
    }
    assert.equal(admitted, true);
    assert.equal(outbox.size("session"), 0);
  });
});

test("an unacknowledged native append prevents report admission", async () => {
  await withPersistence(async ({ runtimeState, outbox, barrier }) => {
    runtimeState.host = { isAvailable: () => true, call: async () => { throw new Error("disk full"); } };
    // Queue without an automatic host flush, then let the barrier attempt it.
    await outbox.enqueue({ key: "tool", sessionId: "session", turnId: "turn", message: { id: "tool" } }, () => null);
    await outbox.flush(() => null);
    await assert.rejects(barrier(identity), { errorCode: "INVALID_ARGUMENT" });
    assert.equal(outbox.size("session"), 1);
  });
});

test("a report cannot flush another execution's session", async () => {
  await withPersistence(async ({ runtimeState, barrier }) => {
    let writes = 0;
    runtimeState.host = { isAvailable: () => true, call: async () => { writes += 1; return {}; } };
    await assert.rejects(barrier({ sessionId: "session", executionId: "foreign" }), { errorCode: "INVALID_ARGUMENT" });
    await assert.rejects(barrier({ sessionId: "foreign", executionId: "execution" }), { errorCode: "INVALID_ARGUMENT" });
    assert.equal(writes, 0);
  });
});

for (const drift of ["host", "turn", "execution"]) {
  test(`${drift} ownership changing during persistence prevents report admission`, async () => {
    await withPersistence(async ({ runtimeState, outbox, activeTurns, claimedExecutionSessions, barrier }) => {
      const entered = deferred();
      const release = deferred();
      runtimeState.host = { isAvailable: () => true, call: async () => {
        entered.resolve(); await release.promise; return {};
      } };
      await outbox.enqueue({ key: "tool", sessionId: "session", turnId: "turn", message: { id: "tool" } }, () => null);
      await outbox.flush(() => null);
      const rejected = assert.rejects(barrier(identity), { errorCode: "INVALID_ARGUMENT" });
      await entered.promise;
      if (drift === "host") runtimeState.host = { isAvailable: () => true, call: async () => ({}) };
      if (drift === "turn") activeTurns.set("session", "new-turn");
      if (drift === "execution") claimedExecutionSessions.set("execution", "another-session");
      release.resolve();
      await rejected;
    });
  });
}
