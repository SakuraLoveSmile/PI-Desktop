import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createBlockedGoalReader } = await import("../src/features/chat/goal/blocked-goal-runtime.ts");
const { blockedGoalMessage } = await import("../src/features/chat/goal/blocked-composer-submission.ts");

const blocked = (version = 1) => ({ execution: { id: "goal", sessionId: "session", title: "Ship", state: "interrupted" },
  hold: { executionId: "goal", sessionId: "session", state: "blocked", version, reasons: [{ code: "report_missing" }] } });
function fixture(readOnly = false) {
  let value = blocked();
  const calls = [], events = {};
  const edge = (name) => (listener) => { events[name] = listener; return () => { delete events[name]; }; };
  const reader = createBlockedGoalReader("session", {
    read: async () => value,
    resume: async (input) => { calls.push(["resume", input]); value = { ...value, hold: { ...value.hold, state: "resumed", version: 2 } }; return value; },
    close: async (input) => { calls.push(["close", input]); value = { ...value, hold: { ...value.hold, state: input.action === "accept" ? "accepted" : "abandoned", version: 2 } }; return value; },
    onChanged: edge("changed"), onRestart: edge("restart"),
  }, readOnly);
  return { reader, calls, events, set: (next) => { value = next; } };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test("blocked goal user path loads after restart, opts out, resumes same execution with current model", async () => {
  const f = fixture(); const off = f.reader.subscribe(() => {}); await tick();
  assert.equal(f.reader.getState().hold.state, "blocked");
  assert.equal(f.reader.shouldResume(), true);
  f.reader.dismiss(); assert.equal(f.reader.shouldResume(), false);
  f.events.restart(); await tick(); assert.equal(f.reader.shouldResume(), false);
  await f.reader.resume("Stop searching and parallelize", { providerId: "new-provider", modelId: "new-model" });
  assert.deepEqual(f.calls[0], ["resume", { sessionId: "session", executionId: "goal", expectedVersion: 1,
    message: "Stop searching and parallelize", modelOverride: { providerId: "new-provider", modelId: "new-model" } }]);
  assert.equal(f.reader.shouldResume(), false); off(); assert.deepEqual(f.events, {});
});
test("accept and abandon are explicit CAS actions; remote holds stay read only", async () => {
  for (const action of ["accept", "abandon"]) {
    const f = fixture(); const off = f.reader.subscribe(() => {}); await tick();
    await f.reader.close(action);
    assert.deepEqual(f.calls[0], ["close", { sessionId: "session", executionId: "goal", expectedVersion: 1, action }]); off();
  }
  const f = fixture(true); const off = f.reader.subscribe(() => {}); await tick();
  assert.equal(f.reader.shouldResume(), false);
  await assert.rejects(f.reader.resume("hello"), /GOAL_READ_ONLY/);
  await assert.rejects(f.reader.close("accept"), /GOAL_READ_ONLY/);
  assert.equal(f.calls.length, 0); off();
});
test("stale session response and lower hold version cannot overwrite a fresh blocked snapshot", async () => {
  const f = fixture(); const off = f.reader.subscribe(() => {}); await tick();
  f.set(blocked(3)); await f.reader.refresh(); assert.equal(f.reader.getState().hold.version, 3);
  f.set(blocked(1)); await f.reader.refresh(); assert.equal(f.reader.getState().hold.version, 3);
  f.set({ ...blocked(4), hold: { ...blocked(4).hold, sessionId: "other" } }); await f.reader.refresh();
  assert.equal(f.reader.getState().hold.version, 3); assert.equal(f.reader.getState().error, "GOAL_EXECUTION_SCOPE_MISMATCH"); off();
});
test("Composer keeps file references in resume text and refuses to drop image/plugin attachments", () => {
  assert.ok(blockedGoalMessage("inspect", { text: "inspect", fileReferences: [{ path: "/tmp/notes.txt", name: "notes.txt" }] }).includes("/tmp/notes.txt"));
  for (const reference of [{ path: "/tmp/image.png", name: "image.png", kind: "image" },
    { path: "plugin/attachment", name: "file", plugin: { kind: "attachment", pluginId: "plugin", id: "1", size: 1 } }]) {
    assert.throws(() => blockedGoalMessage("inspect", { text: "inspect", fileReferences: [reference] }), /GOAL_RESUME_ATTACHMENTS_UNSUPPORTED/);
  }
});
