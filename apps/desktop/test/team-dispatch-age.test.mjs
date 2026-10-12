import assert from "node:assert/strict";
import test from "node:test";
import { AgentHost } from "@pi-desktop/agent-host";
import { resolveSessionMessageInput } from "@pi-desktop/host-runtime";
import { formatSessionMessage } from "@pi-desktop/shared";
import { createTeamDeliveryService } from "../electron/main/services/team-delivery.ts";

const principal = { subject: "desktop", roles: ["owner"], pairedDevice: true };
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let now = Date.parse("2026-10-11T01:00:00.000Z");
  const ledger = new Map();
  const prompts = [];
  const member = { memberSessionId: "member", name: "builder" };
  const roster = { teamSessionId: "lead", paused: false, members: [member] };
  const host = {
    isAvailable: () => true,
    async call(method, params) {
      if (method === "team.getRoster") return roster;
      if (method === "team.pendingMessages") return { messages: [...ledger.values()].filter(mail => mail.status === "queued") };
      if (method === "team.getMessage" || method === "session.collaboration.message") return { message: ledger.get(params.messageId) ?? null };
      if (method === "team.ackMessage") { ledger.get(params.messageId).deliveryStatus = "acknowledged"; return { acknowledged: true }; }
      throw new Error(`Unexpected Host call: ${method}`);
    },
  };
  let sequence = 0;
  const agentHost = new AgentHost({
    clock: { now: () => now },
    sessions: { async get(id) { return { id, title: id, mode: "agent", permissionMode: "ask", executionProfile: "team", updatedAt: "2026-10-11T01:00:00.000Z" }; } },
    approvals: {},
    runtime: {
      async prompt(request) {
        const input = await resolveSessionMessageInput(host, { sessionId: request.sessionId, ...(request.sessionMessageId ? { sessionMessageId: request.sessionMessageId } : {}) });
        if (input) { ledger.get(request.sessionMessageId).status = "running"; }
        prompts.push({ ...request, modelInput: input ? formatSessionMessage(input.content, input.origin) : request.content });
        sequence += 1;
        return { turnId: `runtime-${sequence}` };
      },
    },
  });
  const service = createTeamDeliveryService({ principal, getHost: () => host, getBridge: () => ({ agentHost }), activeTurns: new Map(), log: () => {} });
  function mail(id, content, task = true) {
    const message = { id, teamSessionId: "lead", sourceSessionId: "lead", sourceMemberName: "Lead", sourceTitle: "Lead", targetSessionId: "member", targetMemberName: "builder", kind: "message", content, status: "queued", deliveryStatus: "queued", createdAt: String(now), updatedAt: String(now), sentAt: new Date(now).toISOString(), targetBusyAtSend: true, ...(task ? { taskDispatch: { taskId: "task-1", expectedRevision: 1 } } : {}) };
    ledger.set(id, message);
    return message;
  }
  return { agentHost, service, prompts, mail, advance: ms => { now += ms; }, ledger };
}

function end(agentHost, turnId) {
  agentHost.ingest({ sessionId: "member", turnId, ts: Date.parse("2026-10-11T01:40:00.000Z"), event: { type: "agent_end", messageIds: [] } });
}

test("40-minute occupied turn receives only latest dispatch and keeps unrelated FIFO mail", async () => {
  const f = fixture();
  const started = await f.agentHost.startTurn(principal, { sessionId: "member", context: {}, input: { text: "Long independent task" } });
  const old = f.mail("old", "Use approach A");
  await f.service.dispatchMessage({ teamSessionId: "lead", messageId: old.id });
  f.advance(60_000);
  const report = f.mail("ordinary", "Failure report mentioning task-1; never a dispatch", false);
  await f.service.dispatchMessage({ teamSessionId: "lead", messageId: report.id });
  const latest = f.mail("latest", "Use approach B instead");
  // Rust has committed supersession, including its durable queue removal.
  old.status = "cancelled"; old.dispatchCancellation = "superseded";
  await Promise.all([
    f.service.onNotification("team.changed", { teamSessionId: "lead", reason: "mailbox" }),
    f.service.dispatchMessage({ teamSessionId: "lead", messageId: latest.id }),
  ]);
  await f.service.onNotification("team.changed", { teamSessionId: "lead", reason: "mailbox" });
  const replay = await f.service.dispatchMessage({ teamSessionId: "lead", messageId: old.id });
  assert.equal(replay.accepted, false);
  assert.deepEqual(f.agentHost.queue.list("member").map(entry => entry.sessionMessageId), ["ordinary", "latest"]);
  f.advance(39 * 60_000);
  assert.equal(f.prompts.length, 1);
  end(f.agentHost, started.turn.id);
  await flush();
  assert.equal(f.prompts[1].sessionMessageId, "ordinary");
  end(f.agentHost, "runtime-2");
  await flush();
  assert.equal(f.prompts[2].sessionMessageId, "latest");
  assert.equal(f.prompts.some(prompt => prompt.sessionMessageId === "old"), false);
  assert.ok(f.prompts[2].modelInput.includes("may be stale"));
  assert.ok(f.prompts[2].modelInput.includes('"sentAt":"2026-10-11T01:01:00.000Z"'));
});

test("task completion and replay remove only unstarted explicit dispatches", async () => {
  const f = fixture();
  await f.agentHost.startTurn(principal, { sessionId: "member", context: {}, input: { text: "Current task" } });
  const obsolete = f.mail("obsolete", "Repeat task");
  const ordinary = f.mail("ordinary", "task-1 completed", false);
  for (const mail of [obsolete, ordinary]) await f.service.dispatchMessage({ teamSessionId: "lead", messageId: mail.id });
  obsolete.status = "cancelled"; obsolete.dispatchCancellation = "task_completed";
  for (let n = 0; n < 2; n++) await f.service.onNotification("team.changed", { teamSessionId: "lead", reason: "activity" });
  assert.deepEqual(f.agentHost.queue.list("member").map(entry => entry.sessionMessageId), ["ordinary"]);
  assert.equal(f.prompts.length, 1);
});

test("supersession across enqueue await rechecks ledger before ACK and cannot run old input", async () => {
  const f = fixture();
  await f.agentHost.startTurn(principal, { sessionId: "member", context: {}, input: { text: "Occupied turn" } });
  const old = f.mail("old", "Obsolete dispatch");
  const original = f.agentHost.enqueueTeamMessage.bind(f.agentHost);
  let reached;
  let release;
  const queued = new Promise(resolve => { reached = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  f.agentHost.enqueueTeamMessage = async (...args) => {
    const result = await original(...args);
    reached();
    await blocked;
    return result;
  };
  const delivery = f.service.dispatchMessage({ teamSessionId: "lead", messageId: "old" });
  await queued;
  old.status = "cancelled"; old.dispatchCancellation = "superseded";
  release();
  const receipt = await delivery;
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.deliveryStatus, "cancelled");
  assert.equal(old.deliveryStatus, "queued");
  assert.equal(f.agentHost.queue.size("member"), 0);
  assert.equal(f.prompts.length, 1);
});
