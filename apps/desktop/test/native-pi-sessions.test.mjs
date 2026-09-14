import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const agent = await read("../electron/main/ipc/agent-ipc.ts");

const composer = await read("../src/components/Composer.tsx");
const transcript = await read("../src/stores/slices/transcript-slice.ts");
const events = await read("../src/stores/slices/events-slice.ts");
const sidecarDispatch = await read("../../../packages/agent-runtime/src/sidecar.ts");

test("native model readiness uses capability instead of Desktop secrets", () => {
  assert.match(composer, /const modelReady\s*=\s*nativeSession\s*\?\s*activeSessionSummary\??\.capabilities\?\.canPrompt === true\s*:/);
});

test("native abort bypasses smart-stop rewrite and refreshes source detail", () => {
  const abort = transcript.slice(transcript.indexOf("abort: async"));
  const native = abort.slice(abort.indexOf('source === "pi-native"'), abort.indexOf("const submittedDraft"));
  assert.match(native, /api\.abort\(sessionId\)/);
  assert.match(native, /api\.getSession/);
  assert.match(native, /return;/);
  assert.doesNotMatch(native, /replaceSessionMessages|resolveComposerSmartStop/);
});

test("native dispatch and events carry durable user acknowledgement", () => {
  const dispatch = sidecarDispatch.slice(sidecarDispatch.indexOf('case "agent.prompt"'), sidecarDispatch.indexOf('const turnId =', sidecarDispatch.indexOf('case "agent.prompt"')));
  assert.match(dispatch, /params\.userMessageId/);
  assert.match(events, /event\.type === "user_message_persisted"/);
  assert.match(events, /reconcilePersistedUserMessage/);
});

test("native compact and session-addressed queue endpoints reject before host or queue access", () => {
  for (const operation of ["agentCompact", "agentQueuePush", "agentQueueList"]) {
    const start = agent.indexOf(`handle(IPC.invoke.${operation},`);
    const body = agent.slice(start, agent.indexOf("\n  handle(", start + 1));
    assert.match(body, /rejectNativeAgentOperation\(req\.sessionId\)/, operation);
    const guard = body.indexOf("rejectNativeAgentOperation");
    for (const access of ["host.call", "agentHostBridge.", "resolveAgentRuntimeLaunch("]) {
      const at = body.indexOf(access);
      assert.ok(at < 0 || guard < at, `${operation} guards ${access}`);
    }
  }
  assert.match(agent, /errorCode: "NATIVE_PI_UNSUPPORTED"/);
});

// Real slices/IPC with synthetic state; no Electron process or native home.
const { register } = await import("node:module");
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { IPC } = await import("@pi-desktop/shared");
const { registerAgentIpc } = await import("../electron/main/ipc/agent-ipc.ts");
const { createEventsSlice } = await import("../src/stores/slices/events-slice.ts");
const { createTranscriptSlice } = await import("../src/stores/slices/transcript-slice.ts");
const { api } = await import("../src/lib/api.ts");
const { mergeLiveSessionMessages, reconcilePersistedUserMessage } = await import("../src/lib/session-transcript.ts");

test("unsupported native agent IPC never reaches host or queue", async () => {
  const handlers = new Map();
  const forbidden = () => assert.fail("native operation reached Desktop backend");
  const backend = new Proxy({}, { get: () => forbidden });
  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => backend, getSidecar: () => backend, getAgentHostBridge: () => backend,
  });
  for (const operation of ["agentCompact", "agentQueuePush", "agentQueueList"]) {
    await assert.rejects(handlers.get(IPC.invoke[operation])({ sessionId: "native-pi:fixture", content: "unused", itemId: "unused" }), { errorCode: "NATIVE_PI_UNSUPPORTED" });
  }
});

const user = (id) => ({ id, role: "user", content: "identical prompt", createdAt: "2026-09-14T00:00:00Z", status: "complete" });
function stateHarness(state) {
  return { get: () => state, set: (update) => { Object.assign(state, typeof update === "function" ? update(state) : update); } };
}

test("durable user acknowledgement reconciles active, cached and background rows across reselects", () => {
  for (const activeSessionId of ["native-pi:fixture", "desktop-session"]) {
    const id = "native-pi:fixture";
    const state = { activeSessionId, messages: [user("optimistic-1"), user("optimistic-2")], retainedTranscripts: { [id]: [user("optimistic-1"), user("optimistic-2")] } };
    const runtime = {
      liveSessionTranscripts: new Set(), sessionTranscriptCache: new Map([[id, [...state.messages]]]),
      cacheSessionTranscript: (key, rows) => runtime.sessionTranscriptCache.set(key, rows),
    };
    const slice = createEventsSlice({ ...stateHarness(state), runtime });
    for (const index of [1, 2]) {
      const event = { type: "user_message_persisted", optimisticMessageId: `optimistic-${index}`, message: user(`durable-${index}`) };
      slice.handleAgentEvent({ sessionId: id, ts: 1, event });
      slice.handleAgentEvent({ sessionId: id, ts: 2, event });
    }
    const durable = [user("durable-1"), user("durable-2")];
    assert.deepEqual(runtime.sessionTranscriptCache.get(id), durable);
    assert.deepEqual(state.retainedTranscripts[id], durable);
    if (activeSessionId === id) assert.deepEqual(state.messages, durable);
    let rows = state.retainedTranscripts[id];
    for (let refresh = 0; refresh < 3; refresh++) rows = mergeLiveSessionMessages(durable, rows);
    assert.deepEqual(rows, durable);
    assert.deepEqual(reconcilePersistedUserMessage([user("optimistic-1"), user("durable-1")], "optimistic-1", user("durable-1")), [user("durable-1")]);
  }
});

test("native smart-stop abort keeps one durable user row and never rewrites the source", async () => {
  const id = "native-pi:fixture";
  const state = { activeSessionId: id, sessions: [{ id, source: "pi-native" }], messages: [user("optimistic-1")], retainedTranscripts: {}, runningSessions: { [id]: true }, isRunning: true };
  const calls = [];
  const originalAbort = api.abort;
  const originalReplace = api.replaceSessionMessages;
  const originalGet = api.getSession;
  api.getSession = async () => { calls.push("detail"); return { session: { messages: [user("durable-1")] } }; };
  api.abort = async (sessionId) => { calls.push("abort"); assert.equal(sessionId, id); };
  api.replaceSessionMessages = async () => assert.fail("native abort must not rewrite transcript");
  const runtime = {
    submittedComposerDrafts: new Map([[id, { messageCountBeforeSend: 0, draft: { text: "identical prompt", fileReferences: [] } }]]),
    cacheSessionTranscript: (_id, rows) => { runtime.cached = rows; },
  };
  try {
    await createTranscriptSlice({ ...stateHarness(state), runtime }).abort();
    assert.equal(calls[0], "abort");
    assert.deepEqual(state.messages, [user("durable-1")]);
    assert.deepEqual(runtime.cached, state.messages);
    assert.equal(state.isRunning, false);
    assert.equal(runtime.submittedComposerDrafts.size, 0);
  } finally { api.abort = originalAbort; api.replaceSessionMessages = originalReplace; api.getSession = originalGet; }
});


test("queue remove/prioritize preserve the Desktop opaque host turnId contract", async () => {
  const handlers = new Map();
  const calls = [];
  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => null, getSidecar: () => null,
    getAgentHostBridge: () => ({ queue: {
      remove: async (turnId) => calls.push(["remove", turnId]),
      prioritize: async (turnId) => calls.push(["prioritize", turnId]),
    } }),
  });
  await handlers.get(IPC.invoke.agentQueueRemove)({ turnId: "host-turn" });
  await handlers.get(IPC.invoke.agentQueuePrioritize)({ turnId: "host-turn" });
  assert.deepEqual(calls, [["remove", "host-turn"], ["prioritize", "host-turn"]]);
});

test("native prompt only dispatches sidecar and cannot create a host queue entry", async () => {
  const handlers = new Map();
  const forbidden = () => assert.fail("native prompt reached Desktop host/queue");
  const backend = new Proxy({}, { get: () => forbidden });
  const calls = [];
  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => backend, getAgentHostBridge: () => backend, setNotificationViewingSessionId() {},
    getSidecar: () => ({ call: async (...args) => { calls.push(args); return { accepted: true, turnId: "native-turn" }; } }),
  });
  await handlers.get(IPC.invoke.agentPrompt)({ sessionId: "native-pi:fixture", content: "prompt", messageId: "optimistic" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "agent.prompt");
  assert.equal(calls[0][1].userMessageId, "optimistic");
});


test("native model readiness never depends on a Desktop provider but read-only fails closed", () => {
  const expression = composer.match(/const modelReady = ([\s\S]*?);/)[1];
  const ready = new Function("nativeSession", "activeSessionSummary", "provider", "modelId", `return ${expression}`);
  assert.equal(ready(true, { capabilities: { canPrompt: true } }, undefined, undefined), true);
  assert.equal(ready(true, { capabilities: { canPrompt: false } }, { enabled: true, hasSecret: true }, "model"), false);
  assert.equal(ready(true, {}, undefined, undefined), false);
  assert.equal(ready(false, {}, undefined, undefined), false);
  assert.equal(ready(false, {}, { enabled: true, hasSecret: false }, "model"), false);
  assert.equal(ready(false, {}, { enabled: true, hasSecret: true }, "model"), true);
});


test("unknown or delayed durable acknowledgements never insert a duplicate renderer row", () => {
  const rows = [user("durable")];
  assert.strictEqual(reconcilePersistedUserMessage(rows, "already-reconciled", user("durable")), rows);
  assert.strictEqual(reconcilePersistedUserMessage(rows, "unknown", user("new-id")), rows);
});
