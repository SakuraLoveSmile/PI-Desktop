import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { IPC } from "@pi-desktop/shared";

const request = {
  requestId: "deferred", sessionId: "lead", toolCallId: "ask-call",
  questions: [{ question: "Review replacement?", options: ["Review", "Wait"] }],
  teamManaged: true,
  teamPending: { deferredAt: "2026-10-11T05:35:00+08:00", requiresNewApproval: true },
};

test("E2E-TEAM-lead-pending-ask-late-answer: restore card and deliver a new authenticated user turn", async t => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  const { createAgentHostBridge } = await server.ssrLoadModule("/electron/main/agent-host-bridge.ts");
  const calls = [];
  let pending = true;
  const entry = { id: "asktool-answer:deferred", sessionId: "lead", principal: "desktop", userMessageId: "asktool-answer:deferred",
    idempotencyKey: "asktool-answer:deferred", inputHash: "fixture", content: "User answer to deferred Team question: Review", permissionMode: "ask", position: 1, createdAt: new Date().toISOString() };
  const bridge = createAgentHostBridge({ channels: IPC.invoke, log() {}, isSessionBusy: () => true,
    getHost: () => ({ async call(method, input) {
      calls.push({ method, input });
      if (method === "team.listLeadAsks") return { asks: pending ? [{ request, turnId: "old-turn" }] : [] };
      if (method === "team.resolveLeadAsk") { pending = false; return { ask: { status: "answered" }, entry }; }
      if (method === "session.get") return { session: { id: "lead", mode: "agent", permissionMode: "ask" } };
      if (method === "permissions.pending") return { requests: [] };
      throw new Error(`Unexpected Host operation: ${method}`);
    } }),
    async invoke() { throw new Error("A late answer must not resolve an obsolete runtime Promise"); },
  });
  assert.deepEqual((await bridge.pendingInteractiveRequests("lead")).asks, [request]);
  assert.deepEqual(await bridge.resolveAskByRequestId({ sessionId: "lead", requestId: "deferred", answers: [["Review"]] }), { ok: true });
  const queue = bridge.agentHost.queue.list("lead");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].userMessageId, entry.userMessageId);
  assert.equal(queue[0].principalSubject, "desktop");
  assert.equal(queue[0].sessionMessageId, undefined);
  assert.equal(queue[0].content, entry.content);
  assert.deepEqual((await bridge.pendingInteractiveRequests("lead")).asks, []);
  assert.equal(calls.some(call => /confirm|bindExecution|executeApproved/.test(call.method)), false);
});

test("deferred questions survive tool and turn end while ordinary questions clear", async t => {
  const server = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  const { enqueueAsk, removeAskForToolCall, clearSessionAsks } = await server.ssrLoadModule("/src/lib/pending-asks.ts");
  const ordinary = { ...request, requestId: "ordinary", toolCallId: "ordinary-tool", teamPending: undefined };
  let queues = enqueueAsk({}, ordinary);
  queues = enqueueAsk(queues, { ...request, teamPending: undefined });
  queues = enqueueAsk(queues, request);
  queues = removeAskForToolCall(queues, "lead", request.toolCallId);
  assert.equal(queues.lead.length, 2);
  queues = clearSessionAsks(queues, "lead", true);
  assert.deepEqual(queues.lead, [request]);
  assert.deepEqual(clearSessionAsks(queues, "lead"), {});
});
