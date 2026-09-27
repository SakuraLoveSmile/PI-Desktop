import assert from "node:assert/strict";
import test from "node:test";
import { createTeamDeliveryService } from "../electron/main/services/team-delivery.ts";
import { restoreAgentHostThenDrain } from "../electron/main/runtime/team-startup.ts";

function fixture({ paused = false, queueReceipt = false, failFirstAck = false, deferFirstRoster = false, noPendingMessages = false } = {}) {
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
  const agentHost = {
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
  const service = createTeamDeliveryService({
    principal: { subject: "desktop", roles: ["owner"], pairedDevice: true },
    getHost: () => host,
    getBridge: () => bridge,
    activeTurns: new Map(),
    log: (...args) => order.push(args),
  });
  return { service, hostCalls, queueEntries, order, message, firstRosterRead, releaseFirstRoster: () => releaseFirstRoster() };
}

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
