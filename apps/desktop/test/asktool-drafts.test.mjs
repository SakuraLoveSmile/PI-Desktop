import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const request = (sessionId, requestId, extra = {}) => ({
  sessionId, requestId, toolCallId: `tool-${requestId}`,
  questions: [{ question: "Which branch?", options: ["One", "Two"] }],
  ...extra,
});
const draft = () => ({ index: 0, answers: [{ values: ["Two"], customSelected: false, customText: "", skipped: false }] });
const sessions = [{ id: "a", source: "desktop", mode: "agent" }, { id: "b", source: "desktop", mode: "agent" }];

test("AskTool renderer drafts follow the real queue lifecycle", async t => {
  const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { useAppStore: store } = await vite.ssrLoadModule("/src/stores/app-store.ts");
  const { createInitialState } = await vite.ssrLoadModule("/src/stores/slices/initial-state.ts");
  const { api } = await vite.ssrLoadModule("/src/lib/api.ts");
  const initial = store.getState();
  t.after(() => store.setState(initial, true));
  t.mock.method(api, "resolveAskTool", async () => ({ ok: true }));
  t.mock.method(api, "pendingInteractive", async () => ({ asks: [], permissions: [] }));
  t.mock.method(api, "listQueuedPrompts", async () => ({ entries: [] }));
  t.mock.method(api, "deleteSession", async () => ({ ok: true }));
  t.mock.method(api, "pluginViewClose", async () => ({ ok: true }));
  t.mock.method(api, "listSessions", async () => ({ sessions: [] }));

  const seed = (asks) => {
    store.setState({ ...createInitialState(), sessions });
    for (const ask of asks) {
      store.getState().handleAgentEvent({ sessionId: ask.sessionId, ts: 1, event: { type: "asktool_request", request: ask } });
      store.getState().setAskDraft(ask.requestId, draft());
    }
  };
  const first = request("a", "first");
  const other = request("b", "other");
  const deferred = request("a", "deferred", { teamManaged: true,
    teamPending: { deferredAt: "2026-10-22T00:00:00Z", requiresNewApproval: true } });

  await t.test("answer and decline clear only the settled request; failed submission retains its draft", async t => {
    for (const answers of [[["Two"]], [null]]) {
      seed([first, other]);
      await store.getState().resolveAsk("a", { sessionId: "a", requestId: "first", answers });
      assert.equal(store.getState().pendingAsks.a, undefined);
      assert.equal(store.getState().askDrafts.first, undefined);
      assert.deepEqual(store.getState().askDrafts.other, draft());
    }
    seed([first]);
    t.mock.method(api, "resolveAskTool", async () => { throw new Error("offline"); });
    await assert.rejects(store.getState().resolveAsk("a", { sessionId: "a", requestId: "first", answers: [null] }), /offline/);
    assert.deepEqual(store.getState().askDrafts.first, draft());
    assert.deepEqual(store.getState().pendingAsks.a, [first]);
  });

  await t.test("tool completion clears ordinary drafts but retains deferred Team drafts", () => {
    seed([first, deferred, other]);
    for (const ask of [first, deferred]) store.getState().handleAgentEvent({ sessionId: "a", ts: 2,
      event: { type: "tool_end", toolCallId: ask.toolCallId, toolName: "asktool", result: "done", isError: false } });
    assert.deepEqual(store.getState().pendingAsks.a, [deferred]);
    assert.equal(store.getState().askDrafts.first, undefined);
    assert.deepEqual(store.getState().askDrafts.deferred, draft());
    assert.deepEqual(store.getState().askDrafts.other, draft());
  });

  await t.test("turn end and errors retain Team drafts until the authoritative read removes the request", async t => {
    t.mock.method(api, "pendingInteractive", async () => { throw new Error("unavailable"); });
    for (const event of [{ type: "agent_end" }, { type: "error", error: { code: "TURN_ABORTED", message: "aborted" } }]) {
      seed([first, deferred, other]);
      store.getState().handleAgentEvent({ sessionId: "a", ts: 3, event });
      assert.deepEqual(store.getState().pendingAsks.a, [deferred]);
      assert.equal(store.getState().askDrafts.first, undefined);
      assert.deepEqual(store.getState().askDrafts.deferred, draft());
      assert.deepEqual(store.getState().askDrafts.other, draft());
    }
    await store.getState().restorePendingInteractive("a");
    assert.deepEqual(store.getState().askDrafts.deferred, draft(), "failed read is non-destructive");
  });

  await t.test("reconcile clears answered requests and retains live requests arriving during the read", async t => {
    seed([first, deferred, other]);
    let finish;
    t.mock.method(api, "pendingInteractive", () => new Promise(resolve => { finish = resolve; }));
    const read = store.getState().restorePendingInteractive("a");
    const live = request("a", "arrived-during-read");
    store.getState().handleAgentEvent({ sessionId: "a", ts: 4, event: { type: "asktool_request", request: live } });
    store.getState().setAskDraft(live.requestId, draft());
    finish({ asks: [], permissions: [] });
    await read;
    assert.deepEqual(store.getState().pendingAsks.a, [live]);
    assert.equal(store.getState().askDrafts.first, undefined);
    assert.equal(store.getState().askDrafts.deferred, undefined);
    assert.deepEqual(store.getState().askDrafts[live.requestId], draft());
    assert.deepEqual(store.getState().askDrafts.other, draft());
  });

  await t.test("session deletion drops ordinary and Team drafts while preserving other sessions", async () => {
    seed([first, deferred, other]);
    await store.getState().deleteSession("a");
    assert.equal(store.getState().pendingAsks.a, undefined);
    assert.equal(store.getState().askDrafts.first, undefined);
    assert.equal(store.getState().askDrafts.deferred, undefined);
    assert.deepEqual(store.getState().askDrafts.other, draft());
  });
});
