import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let server, runtime, overlay, presentation, display;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  runtime = await server.ssrLoadModule("/src/stores/runtime/team-member-transcript-runtime.ts");
  overlay = await server.ssrLoadModule("/src/lib/team-member-transcript-overlay.ts");
  presentation = await server.ssrLoadModule("/src/lib/tool-presentation.ts");
  display = await server.ssrLoadModule("/src/lib/tool-display.ts");
});
after(() => server.close());
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const message = (id, content = id, extra = {}) => ({ id, role: "assistant", content, status: "complete", createdAt: "2026-10-06T00:00:00Z", ...extra });
const detail = (messages = [], extra = {}) => ({ session: { messages, ...extra } });
function harness(read = async () => detail(), readOptions = { messageLimit: 200, contentLimit: 65536 }) {
  const order = [], calls = [], listeners = {};
  const deps = { readOptions, now: () => 42,
    getSession(id, options) { order.push("read"); calls.push({ id, options }); return read(calls.length); },
    subscribeAgentEvent(fn) { order.push("event"); listeners.event = fn; return () => { listeners.event = null; }; },
    subscribeHostRestart(fn) { order.push("host"); listeners.host = fn; return () => { listeners.host = null; }; },
    addFocusListener(fn) { order.push("focus"); listeners.focus = fn; return () => { listeners.focus = null; }; },
  };
  const controller = runtime.createTeamMemberTranscriptController("member", deps);
  return { controller, order, calls, listeners, readOptions,
    emit(event, sessionId = "member") { listeners.event({ sessionId, ts: 1, event }); } };
}

test("subscriptions precede bounded read; relevant events, focus, and restart refresh", async () => {
  const h = harness(); const dispose = h.controller.start(); await flush();
  assert.deepEqual(h.order, ["event", "host", "focus", "read"]);
  assert.strictEqual(h.calls[0].options, h.readOptions); assert.equal(h.calls[0].id, "member");
  h.emit({ type: "agent_end", messageIds: [] }, "other"); h.emit({ type: "message_delta" }); await flush();
  assert.equal(h.calls.length, 1);
  h.listeners.focus(); await flush(); h.listeners.host(); await flush();
  assert.equal(h.calls.length, 3); assert.equal(h.controller.getState().lastSuccessAt, 42);
  for (const event of [{ type: "tool_start", toolCallId: "t", toolName: "Bash", args: {} },
    { type: "tool_end", toolCallId: "t", result: { exitCode: 0 } },
    { type: "message_end", message: message("a") },
    { type: "user_message_persisted", optimisticMessageId: "u0", message: message("u", "question", { role: "user" }) },
    { type: "agent_end", messageIds: ["a"] }]) { h.emit(event); await flush(); }
  assert.equal(h.calls.length, 8); dispose();
});

test("invalidation coalesces to one follow-up; errors preserve visible rows and history notice", async () => {
  const pending = [deferred(), deferred(), deferred()]; const h = harness((n) => pending[n - 1].promise);
  const dispose = h.controller.start(); await flush(); h.controller.invalidate(); h.controller.invalidate();
  assert.equal(h.calls.length, 1);
  pending[0].resolve(detail([message("a")], { hasMoreBefore: true })); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.controller.getState().truncated, true);
  pending[1].reject(new Error("read failed")); await flush();
  assert.equal(h.controller.getState().messages[0].content, "a"); assert.equal(h.controller.getState().error, "read failed");
  h.controller.invalidate(); await flush(); pending[2].resolve(detail([message("b")])); await flush();
  assert.equal(h.controller.getState().error, null); assert.equal(h.controller.getState().truncated, false); dispose();
});

test("dispose rejects late results, queued reads, and old StrictMode generations", async () => {
  const pending = [deferred(), deferred()]; const h = harness((n) => pending[n - 1].promise); let notifications = 0;
  h.controller.subscribe(() => notifications++);
  const dispose = h.controller.start(); await flush(); h.controller.invalidate(); dispose();
  const disposeAgain = h.controller.start(); await flush();
  const beforeLate = notifications; pending[0].resolve(detail([message("old")])); await flush();
  assert.equal(notifications, beforeLate); assert.equal(h.calls.length, 2); assert.deepEqual(h.controller.getState().messages, []);
  pending[1].resolve(detail([message("new")])); await flush();
  assert.equal(h.controller.getState().messages[0].id, "new"); disposeAgain();
  const h2 = harness(); h2.controller.start()(); await flush(); assert.equal(h2.calls.length, 0, "unmount before read microtask makes no API call");
});

test("host restart ignores an old process read and follows with the new process read", async () => {
  const pending = [deferred(), deferred()]; const h = harness((n) => pending[n - 1].promise); const dispose = h.controller.start(); await flush();
  h.listeners.host(); pending[0].resolve(detail([message("old-process")])); await flush();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.controller.getState().messages, []);
  pending[1].resolve(detail([message("new-process")])); await flush(); assert.equal(h.controller.getState().messages[0].id, "new-process"); dispose();
});

test("live final rows override stale same-ID persistence until semantically acknowledged", async () => {
  let durable = [message("a", "old", { status: "streaming" })]; const h = harness(async () => detail(durable)); const dispose = h.controller.start(); await flush();
  h.emit({ type: "message_end", message: message("a", "final", { thinking: "reason", toolArgs: { b: 2, a: 1 } }) });
  assert.equal(h.controller.getState().messages[0].content, "final"); await flush();
  assert.equal(h.controller.getState().messages[0].content, "final", "stale read cannot roll back event");
  durable = [message("a", "final", { createdAt: "2026-10-06T00:00:03Z", thinking: "reason", toolArgs: { a: 1, b: 2 } })];
  await h.controller.refresh();
  durable = [message("a", "later durable")]; await h.controller.refresh();
  assert.equal(h.controller.getState().messages[0].content, "later durable", "semantic ack releases overlay despite timestamp/property order"); dispose();
});

test("replacement, optimistic reconciliation, and empty terminal tombstones prevent resurrection", async () => {
  const old = message("provisional", "working", { status: "streaming" });
  const empty = message("empty", "", { status: "aborted" });
  const optimistic = message("optimistic", "question", { role: "user" });
  const h = harness(async () => detail([old, empty, optimistic])); const dispose = h.controller.start(); await flush();
  h.emit({ type: "message_end", message: message("final", "answer"), replacesMessageId: "provisional", precedingAssistant: message("thought", "", { thinking: "reason" }) });
  h.emit({ type: "message_end", message: empty });
  h.emit({ type: "user_message_persisted", optimisticMessageId: "optimistic", message: message("durable-user", "question", { role: "user" }) }); await flush();
  const ids = h.controller.getState().messages.map((m) => m.id);
  assert.ok(ids.includes("final") && ids.includes("thought") && ids.includes("durable-user"));
  assert.ok(!ids.includes("provisional") && !ids.includes("empty") && !ids.includes("optimistic")); dispose();
});

test("missed tool start adopts durable details and acknowledges unordered result JSON", async () => {
  let durable = [];
  const h = harness(async () => detail(durable));
  const dispose = h.controller.start(); await flush();
  const result = { stdout: "done", stderr: "", exitCode: 0 };
  h.emit({ type: "tool_end", toolCallId: "late-tool", result }); await flush();
  durable = [message("late-tool", "", { role: "tool", toolCallId: "late-tool",
    toolName: "Bash", toolArgs: { command: "echo done" }, toolStatus: "running", status: "streaming" })];
  await h.controller.refresh();
  assert.equal(h.controller.getState().messages[0].toolName, "Bash");
  assert.deepEqual(h.controller.getState().messages[0].toolArgs, { command: "echo done" });
  assert.equal(h.controller.getState().messages[0].toolStatus, "success", "stale persistence cannot erase final event");
  durable = [{ ...durable[0], content: JSON.stringify(result, null, 2), toolResult: result,
    toolStatus: "success", status: "complete", toolDurationMs: 42 }];
  await h.controller.refresh();
  assert.equal(h.controller.getState().messages[0].toolDurationMs, 42);
  durable = [{ ...durable[0], toolDurationMs: 43, toolArgs: { command: "durable enrichment" } }];
  await h.controller.refresh();
  assert.deepEqual(h.controller.getState().messages[0].toolArgs, { command: "durable enrichment" }, "acknowledgment releases the overlay");
  dispose();
});

test("complete tool overlays acknowledge semantically equal result content", async () => {
  const result = { stdout: "done", stderr: "", exitCode: 0 };
  let durable = [];
  const h = harness(async () => detail(durable)); const dispose = h.controller.start(); await flush();
  h.emit({ type: "tool_start", toolCallId: "tool", toolName: "Bash", args: { command: "echo done" } });
  h.emit({ type: "tool_end", toolCallId: "tool", result }); await flush();
  durable = [{ ...h.controller.getState().messages[0], content: JSON.stringify(result, null, 2), toolResult: result }];
  await h.controller.refresh();
  durable = [{ ...durable[0], toolArgs: { command: "updated metadata" } }]; await h.controller.refresh();
  assert.deepEqual(h.controller.getState().messages[0].toolArgs, { command: "updated metadata" });
  dispose();
});

test("terminal tool overlay survives stale persistence and bounded values keep real ToolRow semantics", async () => {
  let durable = [message("t", "", { role: "tool", toolCallId: "t", toolName: "Bash", toolStatus: "running", status: "streaming", toolArgs: { command: "exit 7" } })];
  const h = harness(async () => detail(durable)); const dispose = h.controller.start(); await flush();
  const huge = "x".repeat(80000);
  h.emit({ type: "tool_end", toolCallId: "t", result: { stdout: huge, exitCode: 7, stderr: "", details: { exitCode: 7, stdout: huge } } }); await flush();
  const tool = h.controller.getState().messages[0];
  assert.equal(tool.toolStatus, "success"); assert.equal(presentation.runOutcome(tool), "failed");
  assert.ok(presentation.toolResultChips(tool).some((chip) => chip.role === "exit" && chip.count === 7));
  assert.equal(display.getToolSummary(tool.toolName, tool.toolArgs), "exit 7");
  assert.ok(tool.content.length <= 65536); assert.ok(tool.toolResult.details.stdout.includes("truncated for display"));
  assert.equal(h.controller.getState().truncated, false, "content preview clipping does not mean earlier messages are hidden");
  const emptyStdout = overlay.boundTeamMemberMessages([message("empty-output", "", { role: "tool", toolName: "Bash", toolArgs: { command: "true" }, toolResult: { stdout: "", output: huge, exitCode: 0 } })], 200, 65536).messages[0];
  assert.equal(emptyStdout.toolResult.stdout, "");
  assert.ok(!presentation.buildToolPresentation(emptyStdout).some((block) => block.role === "stdout"));
  const read = overlay.boundTeamMemberMessages([message("read", "", { role: "tool", toolName: "Read", toolArgs: { path: "/tmp/result.ts" }, toolResult: { content: huge, path: "/tmp/result.ts" } })], 200, 65536).messages[0];
  assert.equal(display.getToolSummary("Read", read.toolArgs), "/tmp/result.ts"); assert.equal(read.toolResult.path, "/tmp/result.ts");
  assert.ok(presentation.buildToolPresentation(read).some((block) => block.role === "content" && block.text.includes("truncated for display")));
  const small = message("small", "hello", { toolArgs: [1, true, null, { path: "/x" }], toolResult: { content: "short", exitCode: 7 }, error: { code: "PROCESS_ERROR", message: "failure", details: { output: huge } } });
  const bounded = overlay.boundTeamMemberMessages([small], 200, 65536).messages[0];
  assert.deepEqual(bounded.toolArgs, small.toolArgs); assert.deepEqual(bounded.toolResult, small.toolResult); assert.equal(bounded.error.code, "PROCESS_ERROR");
  durable = [tool]; await h.controller.refresh(); dispose();
});

test("latest 200 rows and all displayed fields are bounded, preserving late metadata", async () => {
  const huge = "字".repeat(80000), result = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`field${i}`, i]));
  result.exitCode = 7; result.path = "/important";
  const messages = Array.from({ length: 205 }, (_, i) => message(String(i), huge, { thinking: huge, toolArgs: { command: huge }, toolResult: result }));
  const h = harness(async () => detail(messages)); const dispose = h.controller.start(); await flush();
  const state = h.controller.getState(); assert.equal(state.messages.length, 200); assert.equal(state.messages[0].id, "5"); assert.equal(state.truncated, true);
  for (const m of state.messages) { assert.ok(m.content.length <= 65536); assert.ok(m.thinking.length <= 65536); assert.ok(m.toolArgs.command.length <= 65536); assert.equal(m.toolResult.exitCode, 7); assert.equal(m.toolResult.path, "/important"); }
  dispose();
  const live = harness(); const disposeLive = live.controller.start(); await flush();
  for (let i = 0; i < 205; i++) live.emit({ type: "message_end", message: message(`live-${i}`) });
  assert.equal(live.controller.getState().messages.length, 200); assert.equal(live.controller.getState().messages.at(-1).id, "live-204"); disposeLive();
});


test("out-of-order parallel tool completion keeps start order through stale reads", async () => {
  const h = harness(); const dispose = h.controller.start(); await flush();
  h.emit({ type: "tool_start", toolCallId: "A", toolName: "Bash", args: {} });
  h.emit({ type: "tool_start", toolCallId: "B", toolName: "Read", args: {} });
  h.emit({ type: "tool_end", toolCallId: "A", result: { exitCode: 0 } }); await flush();
  assert.deepEqual(h.controller.getState().messages.map((m) => m.id), ["A", "B"]); dispose();
});

test("nested scalar containers respect a global visited-entry budget", () => {
  const wide = Array.from({ length: 256 }, () => Array.from({ length: 256 }, (_, i) => i));
  const bounded = overlay.boundTeamMemberMessages([message("wide", "", { toolResult: { details: { exitCode: 7 }, rows: wide } })], 200, 65536).messages[0].toolResult;
  const count = (value) => 1 + (value && typeof value === "object" ? Object.values(value).reduce((n, child) => n + count(child), 0) : 0);
  assert.ok(count(bounded) <= 2048); assert.equal(bounded.details.exitCode, 7);
});


test("visible event metadata waits for persistence, while durable enrichment acknowledges", async () => {
  const live = message("a", "final", { toolDurationMs: 12, providerId: "local", modelId: "fake", toolUsage: { input: 1 }, usage: { input: 2 } });
  let durable = [message("a", "final")]; const h = harness(async () => detail(durable)); const dispose = h.controller.start(); await flush();
  h.emit({ type: "message_end", message: live }); await flush();
  assert.equal(h.controller.getState().messages[0].toolDurationMs, 12); assert.equal(h.controller.getState().messages[0].providerId, "local");
  durable = [{ ...live, agentName: "enriched" }]; await h.controller.refresh();
  durable = [message("a", "next", { toolDurationMs: 15 })]; await h.controller.refresh();
  assert.equal(h.controller.getState().messages[0].content, "next"); dispose();
  assert.equal(overlay.teamMemberVisibleMessageMatches(message("b", "same", { providerId: "enriched" }), message("b", "same")), true);
});


test("JSON __proto__ remains own data and cannot supply inherited tool metadata", () => {
  const result = JSON.parse('{"__proto__":{"exitCode":0,"details":{"exitCode":0}},"stdout":"done"}');
  const bounded = overlay.boundTeamMemberMessages([message("proto", "", { role: "tool", toolName: "Bash", toolStatus: "error", toolResult: result })], 200, 65536).messages[0];
  assert.ok(Object.hasOwn(bounded.toolResult, "__proto__")); assert.equal(bounded.toolResult.exitCode, undefined);
  assert.equal(bounded.toolResult.details, undefined); assert.equal(presentation.runOutcome(bounded), "failed");
});


test("host restart drops unfinished ephemeral tools but retains completed outbox rows", async () => {
  const h = harness(); const dispose = h.controller.start(); await flush();
  h.emit({ type: "tool_start", toolCallId: "unfinished", toolName: "Bash", args: {} });
  h.emit({ type: "message_end", message: message("final", "completed answer") }); await flush();
  h.listeners.host(); await flush();
  assert.deepEqual(h.controller.getState().messages.map((m) => m.id), ["final"]); dispose();
});


test("an unacknowledged overlay older than the latest durable window stays out of the latest 200", async () => {
  let durable = []; const h = harness(async () => detail(durable)); const dispose = h.controller.start(); await flush();
  h.emit({ type: "message_end", message: message("old-final") }); await flush();
  durable = Array.from({ length: 200 }, (_, i) => message(`new-${i}`, "newer", { createdAt: `2026-10-06T01:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` }));
  await h.controller.refresh(); assert.equal(h.controller.getState().messages.length, 200);
  assert.deepEqual(h.controller.getState().messages.map((m) => m.id), durable.map((m) => m.id)); dispose();
});
