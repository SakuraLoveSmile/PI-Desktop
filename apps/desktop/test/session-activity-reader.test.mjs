import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createSessionActivityReader, mergeActivitySubagents } = await import("../src/stores/runtime/session-activity-runtime.ts");
const { isSessionActivityPage } = await import("@pi-desktop/shared");
const revision = (n) => n.toString().repeat(64);
const page = (items = [], options = {}) => ({
  sessionId: "session", version: 1, revision: revision(1), limited: false, subagents: [], changedFiles: items,
  attachments: [], websites: [], references: { skills: [], memory: [], mcp: [] }, hasMore: false, nextOffset: null,
  totals: { subagents: 0, changedFiles: items.length, attachments: 0, websites: 0, skills: 0, memory: 0, mcp: 0 }, ...options,
});
const file = (id) => ({ id, label: id, path: `/files/${id}`, changeCount: 1, messageId: id });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function fixture() {
  const reads = [], events = {}, removed = [];
  const edge = (name) => (listener) => { events[name] = listener; return () => { removed.push(name); delete events[name]; }; };
  const reader = createSessionActivityReader("session", {
    read: (sessionId, offset) => { const request = deferred(); reads.push({ ...request, sessionId, offset }); return request.promise; },
    onChanged: edge("changed"), onRestart: edge("restart"), onFocus: edge("focus"),
  });
  return { reader, reads, events, removed };
}

test("all persisted pages publish atomically and history outside loaded window stays present", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  const first = page([file("oldest")], { hasMore: true, nextOffset: 1 }); first.totals.changedFiles = 2;
  f.reads[0].resolve({ activity: first }); await settle();
  assert.equal(f.reader.getState().snapshot, null);
  assert.equal(f.reads[1].offset, 1);
  const last = page([file("latest")]); last.totals.changedFiles = 2;
  f.reads[1].resolve({ activity: last }); await settle();
  assert.deepEqual(f.reader.getState().snapshot.changedFiles.map((item) => item.id), ["oldest", "latest"]);
  stop(); assert.deepEqual(f.removed.sort(), ["changed", "focus", "restart"]);
});

test("changes and differing page revisions discard mixed snapshots", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.reads[0].resolve({ activity: page([file("old")], { hasMore: true, nextOffset: 1, totals: { ...page().totals, changedFiles: 2 } }) }); await settle();
  f.reads[1].resolve({ activity: page([file("new")], { revision: revision(2), totals: { ...page().totals, changedFiles: 2 } }) }); await settle();
  assert.equal(f.reader.getState().snapshot, null);
  assert.equal(f.reads[2].offset, 0);
  f.events.changed({ sessionId: "session" });
  f.reads[2].resolve({ activity: page([file("obsolete")]) }); await settle();
  assert.equal(f.reads[3].offset, 0);
  f.reads[3].resolve({ activity: page([file("fresh")], { revision: revision(3) }) }); await settle();
  assert.equal(f.reader.getState().snapshot.changedFiles[0].id, "fresh");
  const count = f.reads.length; f.events.changed({ sessionId: "other" }); assert.equal(f.reads.length, count);
  stop();
});

test("restart invalidates pending completions; hidden readers do not read or publish", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.events.restart();
  f.reads[1].resolve({ activity: page([file("reopened")]) }); await settle();
  f.reads[0].resolve({ activity: page([file("late")]) }); await settle();
  assert.equal(f.reader.getState().snapshot.changedFiles[0].id, "reopened");
  const captured = f.events.focus;
  stop(); const count = f.reads.length; captured(); await f.reader.refresh();
  assert.equal(f.reads.length, count);
});

test("old Hosts degrade explicitly; transient failures preserve known full snapshot and retry", async () => {
  const f = fixture(); const stop = f.reader.subscribe(() => {});
  f.reads[0].reject(new Error("METHOD_NOT_FOUND")); await settle();
  assert.equal(f.reader.getState().unsupported, true);
  void f.reader.refresh(); f.reads[1].resolve({ activity: page([file("saved")]) }); await settle();
  void f.reader.refresh(); f.reads[2].reject(new Error("host unavailable")); await settle();
  assert.equal(f.reader.getState().unsupported, false);
  assert.equal(f.reader.getState().snapshot.changedFiles[0].id, "saved");
  assert.equal(f.reader.getState().error, "host unavailable");
  stop();
});

test("foreign identity, malformed page/cursor and incomplete totals never become full evidence", async () => {
  for (const bad of [page([], { sessionId: "other" }), page([], { nextOffset: 0, hasMore: true }), page([], { totals: { ...page().totals, changedFiles: 1 } }), page([], { changedFiles: [{}] })]) {
    const f = fixture(); const stop = f.reader.subscribe(() => {});
    f.reads[0].resolve({ activity: bad }); await settle();
    assert.equal(f.reader.getState().snapshot, null);
    assert.ok(f.reader.getState().error);
    stop();
  }
  assert.equal(isSessionActivityPage(page()), true);
  assert.equal(isSessionActivityPage(page([], { websites: [{ id: "bad", label: "bad", url: "https://user:password@example.com", domain: "example.com", sourceCount: 1 }] })), false);
});

test("fresh delegate receipt and terminal state survive lagging Host persistence without duplicate handles", () => {
  const base = { agentName: "worker", task: "Work", messageId: "task-message" };
  const host = [{ ...base, delegationId: "call", toolCallId: "call", status: "running" }];
  const live = [{ ...base, delegationId: "delegate", toolCallId: "call", status: "running", timing: { startedAt: 10 } }];
  const merged = mergeActivitySubagents(host, live);
  assert.equal(merged.length, 1); assert.equal(merged[0].delegationId, "delegate");
  assert.equal(mergeActivitySubagents(merged, [{ ...live[0], status: "completed", timing: { startedAt: 10, completedAt: 20 } }])[0].status, "completed");
  assert.equal(mergeActivitySubagents([{ ...live[0], status: "failed", timing: { startedAt: 10, completedAt: 20 } }], live)[0].status, "failed");
  assert.equal(mergeActivitySubagents(merged, [{ ...base, delegationId: "new", status: "running" }]).length, 2);
});

test("reused provider call IDs do not merge distinct canonical historical delegations", () => {
  const host = [{ delegationId: "old-delegate", messageId: "old-message", toolCallId: "call-0", agentName: "worker", task: "Old task", status: "completed", timing: { startedAt: 10, completedAt: 20 } }];
  const live = [{ delegationId: "new-delegate", messageId: "new-message", toolCallId: "call-0", agentName: "worker", task: "New task", status: "running", timing: { startedAt: 30 } }];
  const merged = mergeActivitySubagents(host, live);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.delegationId === "old-delegate").status, "completed");
  assert.equal(merged.find((item) => item.delegationId === "new-delegate").status, "running");
});
