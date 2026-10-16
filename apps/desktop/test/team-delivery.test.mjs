import assert from "node:assert/strict";
import test from "node:test";
import { AgentHost } from "@pi-desktop/agent-host";
import { createTeamDeliveryService } from "../electron/main/services/team-delivery.ts";
import { restoreAgentHostThenDrain } from "../electron/main/runtime/team-startup.ts";

function fixture({ paused = false, queueReceipt = false, failFirstAck = false, deferFirstRoster = false, noPendingMessages = false, agentHost: providedAgentHost, stopAtBoundary, abortMemberTurn } = {}) {
  const order = [];
  const queueEntries = queueReceipt
    ? [{ sessionId: "member-1", sessionMessageId: "message-1" }]
    : [];
  const message = {
    id: "message-1",
    teamSessionId: "lead",
    sourceSessionId: "lead",
    sourceMemberName: "Lead",
    targetSessionId: "member-1",
    targetMemberName: "researcher",
    content: "Inspect the change",
    status: "queued",
    deliveryStatus: queueReceipt ? "accepted" : "queued",
    createdAt: "1",
    updatedAt: "1",
  };
  let shouldFailAck = failFirstAck;
  const roster = {
    teamSessionId: "lead",
    revision: 1,
    paused,
    members: [{
      teamSessionId: "lead",
      memberSessionId: "member-1",
      name: "researcher",
      contextKind: "fresh",
      phase: "idle",
      createdAt: "1",
      updatedAt: "1",
    }],
  };
  let shouldDeferFirstRoster = deferFirstRoster;
  let resolveRosterRead;
  let releaseFirstRoster;
  const firstRosterRead = new Promise((resolve) => { resolveRosterRead = resolve; });
  const hostCalls = [];
  const host = {
    isAvailable: () => true,
    async call(method, params = {}) {
      hostCalls.push([method, params]);
      if (method === "team.pendingMessages") return { messages: noPendingMessages ? [] : [message] };
      if (method === "team.getRoster") {
        if (shouldDeferFirstRoster) {
          shouldDeferFirstRoster = false;
          const snapshot = { ...roster, members: roster.members.map((member) => ({ ...member })) };
          resolveRosterRead();
          return new Promise((resolve) => { releaseFirstRoster = () => resolve(snapshot); });
        }
        return { ...roster, members: roster.members.map((member) => ({ ...member })) };
      }
      if (method === "team.pause") {
        order.push("pause");
        roster.paused = true;
        return { paused: true };
      }
      if (method === "team.resume") {
        order.push("team-resume");
        roster.paused = false;
        return { paused: false };
      }
      if (method === "team.getMessage") return { message };
      if (method === "team.ackMessage") {
        order.push("ack");
        if (shouldFailAck) {
          shouldFailAck = false;
          throw Object.assign(new Error("TEAM_DELIVERY_PENDING"), { errorCode: "TEAM_DELIVERY_PENDING" });
        }
        message.deliveryStatus = "acknowledged";
        return { acknowledged: true };
      }
      if (method === "session.list") {
        return { sessions: [
          { id: "lead", executionProfile: "team" },
          { id: "member-1", executionProfile: "team" },
          { id: "ordinary", executionProfile: "standard" },
        ] };
      }
      if (method === "team.getRuntimeContext") {
        return params.sessionId === "lead"
          ? { teamSessionId: "lead", callerSessionId: "lead", isLead: true }
          : { teamSessionId: "lead", callerSessionId: "member-1", isLead: false, memberName: "researcher" };
      }
      throw new Error(`Unexpected Host call: ${method}`);
    },
  };
  const queue = {
    list: (sessionId) => queueEntries.filter((entry) => entry.sessionId === sessionId),
    hold: (sessionId, reason) => order.push(`hold:${sessionId}:${reason}`),
    resume: (sessionId, reason) => order.push(`resume:${sessionId}:${reason}`),
  };
  const agentHost = providedAgentHost ?? {
    queue,
    async enqueueTeamMessage(_principal, request) {
      order.push("enqueue");
      queueEntries.push({ sessionId: request.sessionId, sessionMessageId: request.input.sessionMessageId });
      message.deliveryStatus = "accepted";
      return { accepted: true };
    },
    async resumeTeamMessage(_principal, sessionId, messageId) {
      order.push(`resume-message:${sessionId}:${messageId}`);
      return true;
    },
    kick: (sessionId) => order.push(`kick:${sessionId}`),
  };
  const bridge = {
    agentHost,
    queue,
    async interruptSessionMessage(sessionId, turnId) {
      order.push(`interrupt:${sessionId}:${turnId}`);
      return true;
    },
  };
  let currentHost = host;
  const activeTurns = new Map();
  const service = createTeamDeliveryService({
    principal: { subject: "desktop", roles: ["owner"], pairedDevice: true },
    getHost: () => currentHost,
    getBridge: () => bridge,
    activeTurns,
    abortMemberTurn,
    stopAtBoundary: stopAtBoundary ?? (async () => {}),
    log: (...args) => order.push(args),
  });
  return {
    service, host, bridge, roster, hostCalls, queueEntries, order, message, firstRosterRead, activeTurns,
    releaseFirstRoster: () => releaseFirstRoster(),
    replaceHost: (replacement) => { currentHost = replacement; },
  };
}

function userQueueFixture() {
  const prompts = [];
  const agentHost = new AgentHost({
    runtime: {
      async prompt(request) {
        prompts.push(request);
        return { turnId: `runtime-${request.sessionId}` };
      },
    },
    sessions: {},
    approvals: {},
  });
  return { ...fixture({ agentHost, noPendingMessages: true }), agentHost, prompts };
}

async function queueUserTurn(agentHost, sessionId) {
  await agentHost.queue.push({
    id: `turn-${sessionId}`,
    sessionId,
    principalSubject: "desktop",
    content: `Continue ${sessionId}`,
    sessionMessageId: `user-${sessionId}`,
    idempotencyKey: `session-message:user-${sessionId}`,
    effectivePermissionMode: "ask",
    inputHash: sessionId,
    priority: 1,
    createdAt: 1,
  });
}

test("Resume starts queued user turns for Lead and members even without pending Team mail", async () => {
  const state = userQueueFixture();
  await state.service.pauseTeam("lead");
  for (const sessionId of ["lead", "member-1"]) {
    await queueUserTurn(state.agentHost, sessionId);
    state.agentHost.kick(sessionId);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.prompts, []);
  assert.equal(state.agentHost.queue.peek("lead").priority, 1);

  await state.service.resumeTeam("lead");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(state.prompts.map((prompt) => prompt.sessionMessageId).sort(), ["user-lead", "user-member-1"]);
  assert.equal(state.agentHost.queue.size("lead"), 0);
  assert.equal(state.agentHost.queue.size("member-1"), 0);
  await state.service.resumeTeam("lead");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.prompts.length, 2);
});

test("Resume preserves another queue owner's restore hold", async () => {
  const state = userQueueFixture();
  await state.service.pauseTeam("lead");
  state.agentHost.queue.hold("lead", "restore");
  await queueUserTurn(state.agentHost, "lead");

  await state.service.resumeTeam("lead");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.prompts, []);
  assert.equal(state.agentHost.queue.isHeld("lead"), true);
  assert.equal(state.agentHost.queue.size("lead"), 1);
  assert.equal(state.agentHost.queue.isHeldByOtherThan("lead", "restore"), false);
});

test("Resume finishes mailbox acknowledgment before waking ordinary user queues", async () => {
  const state = fixture({ paused: true });
  await state.service.resumeTeam("lead");

  assert.ok(state.order.indexOf("ack") < state.order.indexOf("kick:lead"));
  assert.ok(state.order.indexOf("ack") < state.order.indexOf("kick:member-1"));
});

test("Pause during Resume's mailbox drain keeps user queues held", async () => {
  const state = userQueueFixture();
  await state.service.pauseTeam("lead");
  await queueUserTurn(state.agentHost, "lead");
  const call = state.host.call.bind(state.host);
  let pendingRead;
  const readingPending = new Promise((resolve) => { pendingRead = resolve; });
  let releasePending;
  state.host.call = async (method, params) => {
    if (method === "team.pendingMessages") {
      pendingRead();
      await new Promise((resolve) => { releasePending = resolve; });
    }
    return call(method, params);
  };
  const resuming = state.service.resumeTeam("lead");
  await readingPending;
  const pausing = state.service.pauseTeam("lead");
  releasePending();
  await Promise.all([resuming, pausing]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(state.prompts, []);
  assert.equal(state.agentHost.queue.isHeld("lead"), true);
  assert.equal(state.agentHost.queue.size("lead"), 1);
});

test("a deleted Team during Resume's drain cannot wake stale member queues", async () => {
  const state = fixture({ paused: true, noPendingMessages: true });
  const call = state.host.call.bind(state.host);
  let rosterReads = 0;
  state.host.call = async (method, params) => {
    if (method === "team.getRoster" && ++rosterReads === 3) {
      throw Object.assign(new Error("Team was deleted"), { errorCode: "NOT_FOUND" });
    }
    return call(method, params);
  };

  await assert.rejects(state.service.resumeTeam("lead"), { errorCode: "NOT_FOUND" });
  assert.equal(state.order.some((entry) => typeof entry === "string" && entry.startsWith("kick:")), false);
});

test("a replaced Host during Resume's final roster read cannot wake stale queues", async () => {
  const state = fixture({ paused: true, noPendingMessages: true });
  const call = state.host.call.bind(state.host);
  let rosterReads = 0;
  state.host.call = async (method, params) => {
    if (method === "team.getRoster" && ++rosterReads === 3) {
      state.replaceHost({ isAvailable: () => true });
    }
    return call(method, params);
  };

  await assert.rejects(state.service.resumeTeam("lead"), { errorCode: "HOST_UNAVAILABLE" });
  assert.equal(state.order.some((entry) => typeof entry === "string" && entry.startsWith("kick:")), false);
});

test("Team mail is acknowledged only after its durable Agent Host queue receipt", async () => {
  const state = fixture();
  const result = await state.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });

  assert.equal(result.accepted, true);
  assert.equal(result.deliveryStatus, "acknowledged");
  assert.ok(state.order.indexOf("enqueue") < state.order.indexOf("ack"));
  assert.ok(state.order.indexOf("ack") < state.order.indexOf("kick:member-1"));
  assert.deepEqual(state.queueEntries, [{ sessionId: "member-1", sessionMessageId: "message-1" }]);
});

test("a failed acknowledgment keeps the durable queue entry and retry does not enqueue twice", async () => {
  const state = fixture({ failFirstAck: true });

  await assert.rejects(
    state.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" }),
    { errorCode: "TEAM_DELIVERY_PENDING" },
  );
  const result = await state.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });

  assert.equal(result.deliveryStatus, "acknowledged");
  assert.equal(state.order.filter((entry) => entry === "enqueue").length, 1);
  assert.equal(state.order.filter((entry) => entry === "ack").length, 2);
});

test("paused teams hold every member queue and do not enqueue pending mail", async () => {
  const state = fixture({ paused: true });

  const result = await state.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });

  assert.deepEqual(result, { messageId: "message-1", accepted: false, deliveryStatus: "queued" });
  assert.ok(state.order.includes("hold:lead:team:lead"));
  assert.ok(state.order.includes("hold:member-1:team:lead"));
  assert.equal(state.order.includes("enqueue"), false);
});

test("an old unpaused recovery read cannot clear holds established by Pause", async () => {
  const state = fixture({ deferFirstRoster: true, noPendingMessages: true });
  const draining = state.service.drainPending("lead");
  await state.firstRosterRead;
  const pausing = state.service.pauseTeam("lead");
  await new Promise((resolve) => setImmediate(resolve));
  state.releaseFirstRoster();
  await Promise.all([draining, pausing]);

  assert.ok(state.order.includes("pause"));
  const pauseIndex = state.order.indexOf("pause");
  assert.equal(state.order.slice(pauseIndex + 1).some((entry) => typeof entry === "string" && entry.startsWith("resume:")), false);
  assert.ok(state.order.includes("hold:lead:team:lead"));
  assert.ok(state.order.includes("hold:member-1:team:lead"));
  assert.equal(state.order.includes("enqueue"), false);
});

test("startup recovery scans lead contexts and resumes an existing queue receipt", async () => {
  const state = fixture({ queueReceipt: true });

  await state.service.drainPending();

  assert.ok(state.hostCalls.some(([method, params]) => method === "team.getRuntimeContext" && params.sessionId === "lead"));
  assert.ok(state.hostCalls.some(([method, params]) => method === "team.getRuntimeContext" && params.sessionId === "member-1"));
  assert.equal(state.order.includes("enqueue"), false);
  assert.ok(state.order.includes("resume-message:member-1:message-1"));
  assert.ok(state.order.includes("kick:member-1"));
});

test("startup recovery drains only after Agent Host restores its persistent queue", async () => {
  const order = [];

  await restoreAgentHostThenDrain(
    { start: async () => order.push("queue-restore") },
    async () => order.push("team-drain"),
  );

  assert.deepEqual(order, ["queue-restore", "team-drain"]);
});

test("a late queue notification acknowledges an already-bound turn without replaying it", async () => {
  const state = fixture();
  state.message.status = "running";
  state.message.turnId = "turn-7";

  const result = await state.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });

  assert.equal(result.deliveryStatus, "acknowledged");
  assert.equal(state.order.includes("enqueue"), false);
  assert.equal(state.order.includes("kick:member-1"), false);
  assert.ok(state.order.includes("ack"));
});


test("approved execution Lead mail stays in the original turn without enqueue or acknowledgment", async () => {
  const f = fixture(); f.message.targetSessionId = "lead"; f.message.sourceSessionId = "member-1";
  f.activeTurns.set("lead", "approved-turn");
  const originalCall = f.host.call.bind(f.host);
  f.host.call = async (method, params) => method === "team.getLeadExecutionState"
    ? { active: true, turnId: "approved-turn", reviewStatus: "confirmed" } : originalCall(method, params);
  const result = await f.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });
  assert.equal(result.inTurn, true); assert.equal(f.queueEntries.length, 0);
  assert.equal(f.order.includes("enqueue"), false); assert.equal(f.order.includes("ack"), false);
  assert.equal(f.order.some(entry => typeof entry === "string" && entry.startsWith("kick:")), false);
});

test("late approved-execution state read cannot deliver into a replacement turn", async () => {
  const f = fixture(); f.message.targetSessionId = "lead"; f.activeTurns.set("lead", "approved-turn");
  const originalCall = f.host.call.bind(f.host);
  f.host.call = async (method, params) => {
    if (method === "team.getLeadExecutionState") { f.activeTurns.set("lead", "new-turn"); return { active: true, turnId: "approved-turn" }; }
    return originalCall(method, params);
  };
  await assert.rejects(f.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" }), /Lead execution changed/);
  assert.equal(f.queueEntries.length, 0);
});

test("Host inbox-consumed event removes only verified Team queue entries and tolerates replay", async () => {
  const f = fixture({ queueReceipt: true });
  f.activeTurns.set("lead", "approved-turn");
  Object.assign(f.message, { targetSessionId: "lead", sourceSessionId: "member-1", status: "completed", deliveryStatus: "completed" });
  Object.assign(f.queueEntries[0], { id: "team-entry", sessionId: "lead" });
  f.queueEntries.push({ id: "ordinary-entry", sessionId: "lead", content: "Unrelated user follow-up" });
  const removed = [];
  f.bridge.agentHost.queue.remove = async (session, id) => {
    const index = f.queueEntries.findIndex(entry => entry.sessionId === session && entry.id === id);
    if (index < 0) return undefined;
    removed.push(id); return f.queueEntries.splice(index, 1)[0];
  };
  const payload = { teamSessionId: "lead", turnId: "approved-turn", messageIds: ["message-1"] };
  await f.service.onNotification("team.executionInboxConsumed", payload);
  await f.service.onNotification("team.executionInboxConsumed", payload);
  assert.deepEqual(removed, ["team-entry"]);
  assert.deepEqual(f.queueEntries.map(entry => entry.id), ["ordinary-entry"]);
  assert.equal(f.order.some(entry => typeof entry === "string" && entry.startsWith("kick:")), false);
});

// Host budget pauses do not invoke the ordinary user-stop peer-abort path.
test("hard run limit holds Lead and experts, requests safe boundaries, and leaves mail queued", async () => {
  const stopped = [];
  const f = fixture({ paused: true, stopAtBoundary: async (session, turn) => { stopped.push([session, turn]); } });
  f.activeTurns.set("lead", "lead-turn"); f.activeTurns.set("member-1", "expert-turn");
  await f.service.onNotification("team.runLimitPauseRequested", { teamSessionId: "lead" });
  await f.service.onNotification("team.messageQueued", { teamSessionId: "lead" });
  assert.deepEqual(stopped, [["lead", "lead-turn"], ["member-1", "expert-turn"]]);
  assert.ok(f.order.includes("hold:lead:team:lead")); assert.ok(f.order.includes("hold:member-1:team:lead"));
  assert.equal(f.order.some((item) => typeof item === "string" && item.startsWith("interrupt:")), false);
  assert.equal(f.hostCalls.some(([method]) => method === "team.ackMessage"), false);
  assert.equal(f.message.status, "queued");
});
test("a stale budget event after explicit resume cannot stop a newer run", async () => {
  let stopped = 0;
  const f = fixture({ stopAtBoundary: async () => { stopped++; } });
  f.activeTurns.set("lead", "new-turn");
  await f.service.onNotification("team.runLimitPauseRequested", { teamSessionId: "lead" });
  assert.equal(stopped, 0);
});


test("blocked Goal holds all queues, awaits member abortion, and leaves the finished Lead alone", async () => {
  let releaseAbort, enteredAbort;
  const entered = new Promise(resolve => { enteredAbort = resolve; });
  const gate = new Promise(resolve => { releaseAbort = resolve; });
  const aborted = [];
  const f = fixture({ paused: true, abortMemberTurn: async (session, turn) => { aborted.push([session, turn]); enteredAbort(); await gate; f.activeTurns.delete(session); } });
  f.activeTurns.set("lead", "finished-lead");
  f.activeTurns.set("member-1", "expert-turn");
  const settlement = f.service.settleBlockedGoal("lead");
  await entered;
  let settled = false;
  settlement.then(() => { settled = true; });
  const dispatch = f.service.dispatchMessage({ teamSessionId: "lead", messageId: "message-1" });
  assert.equal(settled, false);
  releaseAbort();
  await settlement;
  await dispatch;
  assert.deepEqual(aborted, [["member-1", "expert-turn"]]);
  assert.equal(f.activeTurns.get("lead"), "finished-lead");
  assert.equal(f.activeTurns.has("member-1"), false);
  assert.ok(f.order.includes("hold:member-1:team:lead"));
  assert.equal(f.order.includes("enqueue"), false);
});

test("blocked Goal cancels members even when Team pause was already owned by the user", async () => {
  const aborted = [];
  const f = fixture({ paused: true, abortMemberTurn: async (sessionId, turnId) => { aborted.push([sessionId, turnId]); f.activeTurns.delete(sessionId); } });
  f.activeTurns.set("member-1", "old-member-turn");
  await f.service.settleBlockedGoal("lead");
  assert.deepEqual(aborted, [["member-1", "old-member-turn"]]);
  assert.equal(f.hostCalls.some(([method]) => method === "team.resume"), false);
  assert.equal(f.roster.paused, true);
});

async function retiredOrdinaryReceiptFixture() {
  const state = userQueueFixture();
  Object.assign(state.message, { status: "cancelled", dispatchCancellation: "superseded" });
  for (const [id, messageId, idempotencyKey] of [
    ["retired", state.message.id, `team-message:${state.message.id}`],
    ["ordinary", "user-followup", "session-message:user-followup"],
  ]) {
    await state.agentHost.queue.push({ id, sessionId: "member-1", sessionMessageId: messageId, idempotencyKey,
      principalSubject: "desktop", content: "Fixture mail", effectivePermissionMode: "ask", inputHash: id, priority: 1, createdAt: 1 });
  }
  return state;
}

test("Host superseded receipt cancels a mirrored ordinary outbound message without a task-dispatch flag", async () => {
  const state = await retiredOrdinaryReceiptFixture();
  assert.equal(state.message.taskDispatch, undefined);
  await state.service.onNotification("team.changed", { teamSessionId: "lead", reason: "goal.superseded" });
  assert.deepEqual(state.agentHost.queue.list("member-1").map(item => item.id), ["ordinary"]);
  assert.deepEqual(state.prompts, []);
});

test("dispatch retry retires a Host-cancelled ordinary superseded receipt without acknowledgment or launch", async () => {
  const state = await retiredOrdinaryReceiptFixture();
  const result = await state.service.dispatchMessage({ teamSessionId: "lead", messageId: state.message.id });
  assert.equal(result.accepted, false);
  assert.equal(result.deliveryStatus, "cancelled");
  assert.deepEqual(state.agentHost.queue.list("member-1").map(item => item.id), ["ordinary"]);
  assert.equal(state.hostCalls.some(([method]) => method === "team.ackMessage"), false);
  assert.deepEqual(state.prompts, []);
});

test("superseded cancellation does not retire a receipt already bound to a turn", async () => {
  const state = await retiredOrdinaryReceiptFixture();
  state.message.turnId = "consumed-turn";
  await state.service.onNotification("team.changed", { teamSessionId: "lead" });
  assert.deepEqual(state.agentHost.queue.list("member-1").map(item => item.id), ["retired", "ordinary"]);
});
