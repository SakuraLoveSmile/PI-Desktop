/** Real isolated Rust RPC -> production Electron IPC adapter -> production renderer reader. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { IPC } from "@pi-desktop/shared";
register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const { registerSessionActivityIpc } = await import("../apps/desktop/electron/main/ipc/session-activity-ipc.ts");
const { createSessionActivityReader } = await import("../apps/desktop/src/stores/runtime/session-activity-runtime.ts");
const dir = await mkdtemp(join(tmpdir(), "pi-session-aggregate-"));
const host = new Host(resolveHostBinary(), dir);
let stopReader;
const events = new Set();
let restartListener = () => {};
const flush = () => {
  const notes = host.notifications.splice(0);
  for (const note of notes) if (note.method === "sessionActivity.changed") for (const listener of events) listener(note.params);
};
const call = async (method, params) => { const result = await host.call(method, params); flush(); return result; };
const handlers = new Map();
registerSessionActivityIpc({ handle: (channel, listener) => handlers.set(channel, listener), getHost: () => ({ call }) });
const row = (id, path) => ({ id, role: "tool", content: "PRIVATE OUTPUT", createdAt: "2026-10-10T00:00:00Z", toolName: "Write", toolStatus: "success", toolArgs: { path, content: "PRIVATE CONTENT" } });
const task = (status) => ({ id: "delegate-call", role: "tool", content: `Task ${status}`, createdAt: "2026-10-10T00:00:00Z", toolName: "Task", toolCallId: "delegate-call", toolStatus: "success", toolArgs: { agent: "worker", task: "Historical delegated work" }, toolResult: { details: { delegationId: "delegate", status, startedAt: 10, ...(status === "completed" ? { completedAt: 20 } : {}) } } });
function until(reader, predicate) {
  if (predicate(reader.getState())) return Promise.resolve(reader.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`Activity integration timeout: ${JSON.stringify(reader.getState())}`)); }, 20_000);
    const stop = reader.subscribe(() => { const state = reader.getState(); if (state.error) { clearTimeout(timer); stop(); reject(new Error(state.error)); } else if (predicate(state)) { clearTimeout(timer); stop(); resolve(state); } });
  });
}
try {
  await host.start();
  const { session } = await call("session.create", {});
  const id = session.id;
  await call("session.appendMessage", { sessionId: id, message: row("oldest", "/old/file.txt") });
  await call("session.appendMessage", { sessionId: id, message: { id: "old-source", role: "assistant", content: "PRIVATE SEARCH", createdAt: "2026-10-10T00:00:00Z", hostedSearch: { rounds: [{ sources: [{ url: "https://example.com/first", title: "Old reference" }, { url: "https://example.com/second" }, { url: "javascript:alert(1)" }] }] } } });
  for (let n = 0; n < 65; n++) await call("session.appendMessage", { sessionId: id, message: row(`new-${n}`, `/new/file-${n}.txt`) });
  const tail = await call("session.get", { id, messageLimit: 5 });
  assert.ok(!tail.session.messages.some((message) => message.id === "oldest"));
  const reader = createSessionActivityReader(id, {
    read: (sessionId, offset) => handlers.get(IPC.invoke.sessionActivityGet)({ sessionId, offset }),
    onChanged: (listener) => { events.add(listener); return () => events.delete(listener); },
    onRestart: (listener) => { restartListener = listener; return () => { restartListener = () => {}; }; },
    onFocus: () => () => {},
  });
  stopReader = reader.subscribe(() => {});
  let state = await until(reader, (value) => !value.loading && Boolean(value.snapshot));
  assert.equal(state.snapshot.changedFiles.length, 66);
  assert.equal(state.snapshot.totals.changedFiles, 66);
  assert.ok(state.snapshot.changedFiles.some((item) => item.messageId === "oldest"));
  assert.equal(state.snapshot.websites[0].sourceCount, 2);
  assert.ok(!JSON.stringify(state.snapshot).includes("PRIVATE"));
  const { turnId } = await call("session.beginTurn", { sessionId: id });
  await call("session.appendMessage", { sessionId: id, turnId, message: task("running") });
  await until(reader, (value) => value.snapshot?.subagents[0]?.status === "running");
  await call("session.appendMessage", { sessionId: id, turnId, message: task("completed") });
  await until(reader, (value) => value.snapshot?.subagents[0]?.status === "completed");
  await call("session.appendMessage", { sessionId: id, turnId, message: task("running") });
  await reader.refresh();
  assert.equal(reader.getState().snapshot.subagents[0].status, "completed");
  const { session: persisted } = await call("session.get", { id });
  assert.equal(persisted.messages.filter((item) => item.id === "delegate-call").length, 1);
  assert.equal(persisted.messages.find((item) => item.id === "delegate-call").toolResult.details.status, "completed");
  await call("session.endTurn", { turnId, status: "completed" });
  await host.restart();
  restartListener();
  state = await until(reader, (value) => !value.loading && value.snapshot?.subagents[0]?.status === "completed");
  assert.equal(state.snapshot.changedFiles.length, 66);
  assert.equal(state.snapshot.websites[0].sourceCount, 2);
  stopReader(); stopReader = undefined;
  assert.equal(events.size, 0);
  console.log("session activity aggregate real Host/IPC/renderer integration passed");
} finally {
  stopReader?.();
  await host.stop();
  await rm(dir, { recursive: true, force: true });
}
