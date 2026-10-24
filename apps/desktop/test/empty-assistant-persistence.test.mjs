import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

// The real persistence pass, driven directly with a stubbed outbox.
const { createSessionCoordination } = await import(
  "../electron/main/runtime/session-coordination.ts"
);
const { createEventPersistence } = await import(
  "../electron/main/runtime/event-persistence.ts"
);

const { PersistenceOutbox } = await import("../electron/main/persistence-outbox.ts");

const SESSION = "s1";
const TURN = "turn-1";

function fixture(overrides = {}) {
  const activeTurns = new Map([[SESSION, TURN]]);
  const coordination = createSessionCoordination({
    activeTurns,
    getMainWindow: () => null,
    getViewingSessionId: () => null,
  });
  const enqueued = [];
  const steeringReplies = new Set();
  const persistence = createEventPersistence({
    runtimeState: { host: null },
    steeringReplies,
    activeTurns,
    activeToolCalls: new Map(),
    activeToolCallKey: coordination.activeToolCallKey,
    approvedExecutionIdsBySession: new Map(),
    approvedExecutionTurns: new Map(),
    planSubmissionTurnIds: new Set(),
    planSubmissionTurnKey: coordination.planSubmissionTurnKey,
    inflightCheckpointer: {
      observe() {},
      flush: async () => {},
      settle() {},
      settleIf() {},
    },
    persistenceOutbox: {
      setContextInsightsAcknowledgedHandler() {},
      size: () => 0,
      enqueue: async (entry) => {
        enqueued.push(entry);
      },
      flush: async () => undefined,
    },
    addActiveTurnUsage() {},
    logger: { app() {} },
    finishTurn: () => Promise.resolve(),
    isStaleTerminalEvent: coordination.isStaleTerminalEvent,
    lockExecutionInterruption() {},
    finishApprovedExecution: async () => undefined,
    emitAgentEvent() {},
    ...overrides,
  });
  const persistAssistant = (message) =>
    persistence.persistAgentEvent({
      sessionId: SESSION,
      turnId: TURN,
      ts: 1,
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          createdAt: "2026-10-20T00:00:00.000Z",
          ...message,
        },
      },
    });
  return { enqueued, steeringReplies, persistAssistant, persistAgentEvent: persistence.persistAgentEvent };
}

for (const status of ["complete", "error", "aborted", "streaming", undefined]) {
  test(`an empty ${status ?? "unset-status"} assistant message is not persisted`, () => {
    const f = fixture();
    f.persistAssistant({ id: "m1", content: " \n", thinking: " \t", status });
    assert.equal(f.enqueued.length, 0);
  });
}

test("an empty aborted assistant message without an error is not persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "m2", content: "", thinking: "", status: "aborted" });
  assert.equal(f.enqueued.length, 0);
});

test("an empty assistant message that still carries a tool row is persisted", () => {
  const f = fixture();
  f.persistAssistant({
    id: "m3",
    content: "",
    thinking: "",
    status: "complete",
    toolName: "Grep",
    toolCallId: "call-1",
    toolStatus: "success",
  });
  assert.equal(f.enqueued.length, 1);
});

test("an empty assistant message with an error payload stays durable", () => {
  const f = fixture();
  f.persistAssistant({
    id: "m4",
    content: "",
    thinking: "",
    status: "error",
    error: { code: "PROVIDER_ERROR", message: "boom" },
  });
  assert.equal(f.enqueued.length, 1);
});

test("an empty assistant message reserved for steering is persisted", () => {
  const f = fixture();
  f.steeringReplies.add("m5");
  f.persistAssistant({ id: "m5", content: "", thinking: "", status: "complete" });
  assert.equal(f.enqueued.length, 1);
});

test("a non-empty complete assistant message is persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "m6", content: "done", status: "complete" });
  assert.equal(f.enqueued.length, 1);
});

test("a thinking-only assistant message is persisted", () => {
  const f = fixture();
  f.persistAssistant({ id: "thinking", content: "", thinking: "reasoning", status: "complete" });
  assert.equal(f.enqueued[0].message.thinking, "reasoning");
});

for (const link of [{ toolCallId: "call" }, { toolName: "Read" }]) {
  test(`an empty aborted assistant with ${Object.keys(link)[0]} keeps its tool link`, () => {
    const f = fixture();
    f.persistAssistant({ id: "linked", content: "", status: "aborted", ...link });
    assert.equal(f.enqueued.length, 1);
    assert.deepEqual(f.enqueued[0].message, {
      role: "assistant", createdAt: "2026-10-20T00:00:00.000Z",
      id: "linked", content: "", status: "aborted", ...link,
    });
  });
}

test("steering, Goal tools, delegate metadata and structured errors survive outbox restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-empty-assistant-"));
  const queued = [];
  const outbox = new PersistenceOutbox(dir, () => undefined);
  const enqueue = outbox.enqueue.bind(outbox);
  outbox.enqueue = (...args) => {
    const pending = enqueue(...args);
    queued.push(pending);
    return pending;
  };
  const f = fixture({ persistenceOutbox: outbox });
  const send = (event, lineage = {}) => f.persistAgentEvent({
    sessionId: SESSION, turnId: TURN, ts: 1_000, ...lineage, event,
  });
  const preceding = { id: "steered-reply", role: "assistant", content: "", status: "streaming", createdAt: "2026-10-20T00:00:00.000Z" };
  const user = { id: "steering-user", role: "user", content: "Continue with this input", steering: true, createdAt: preceding.createdAt };
  const error = { id: "provider-error", role: "assistant", content: "", status: "error", createdAt: preceding.createdAt,
    error: { code: "NETWORK_ERROR", message: "certificate rejected", retriable: false, details: { networkCode: "CERT_HAS_EXPIRED" } } };
  const delegate = { id: "delegate", role: "assistant", content: "", thinking: "Plan remains valid", status: "complete", createdAt: preceding.createdAt,
    modelId: "fixture", providerId: "local", usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
  try {
    send({ type: "message_start", message: preceding });
    send({ type: "message_end", message: user, precedingAssistant: preceding });
    send({ type: "message_end", message: { ...preceding, status: "complete" } });
    f.persistAssistant({ id: "discard-empty", content: "", status: "complete" });
    send({ type: "message_end", message: error });
    send({ type: "message_end", message: delegate }, { parentToolCallId: "team-task", nestedParentToolCallId: "code-call", agentName: "reviewer" });
    send({ type: "tool_start", toolCallId: "submit-goal", toolName: "SubmitGoal", args: { title: "Goal contract" } });
    send({ type: "tool_end", toolCallId: "submit-goal", result: { executionId: "goal-execution", status: "awaiting_approval" } });
    await Promise.all(queued);
    const recovered = new PersistenceOutbox(dir, () => undefined);
    const writes = [];
    await recovered.flush(() => ({ isAvailable: () => true, call: async (method, params) => { if (method === "session.appendMessage") writes.push({ method, ...params }); return {}; } }));
    assert.deepEqual(writes.map(row => row.message.id), ["steered-reply", "steering-user", "provider-error", "delegate", "submit-goal"]);
    assert.ok(writes.every(row => row.method === "session.appendMessage" && row.sessionId === SESSION && row.turnId === TURN));
    assert.equal(writes[0].message.status, "complete");
    assert.deepEqual(writes[1].message, user);
    assert.deepEqual(writes[2].message, error);
    assert.deepEqual(writes[3].message, { ...delegate, parentToolCallId: "team-task", nestedParentToolCallId: "code-call", agentName: "reviewer" });
    assert.equal(writes[4].message.toolName, "SubmitGoal");
    assert.deepEqual(writes[4].message.toolArgs, { title: "Goal contract" });
    assert.deepEqual(writes[4].message.toolResult, { executionId: "goal-execution", status: "awaiting_approval" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const status of ["aborted", "error"]) {
  test(`an empty ${status} reply still locks its matching approved execution before being dropped`, () => {
    const locks = [];
    const f = fixture({
      approvedExecutionIdsBySession: new Map([[SESSION, "execution"]]),
      approvedExecutionTurns: new Map([["execution", { sessionId: SESSION, turnId: TURN }]]),
      lockExecutionInterruption: (...args) => locks.push(args),
    });
    f.persistAssistant({ id: "empty-failed", content: "", status });
    assert.deepEqual(locks, [[SESSION, TURN, { errorCode: status === "error" ? "TURN_ERROR" : undefined, errored: status === "error" }]]);
    assert.equal(f.enqueued.length, 0);
    f.persistAgentEvent({ sessionId: SESSION, turnId: TURN, parentToolCallId: "task", ts: 1,
      event: { type: "message_end", message: { id: "delegate-failed", role: "assistant", content: "", status } } });
    assert.equal(locks.length, 1, "a delegate failure must not lock the root execution");
  });
}
