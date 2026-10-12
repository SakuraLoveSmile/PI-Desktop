import assert from "node:assert/strict";
import test from "node:test";
import { AgentHost } from "@pi-desktop/agent-host";
import { createTeamDeliveryService } from "../electron/main/services/team-delivery.ts";

function fixture() {
  const params = { teamSessionId: "lead", callerSessionId: "lead", leadTurnId: "turn", boundaryId: "boundary" };
  const body = { id: "body", role: "user", content: "Full expert report", createdAt: "2026-10-11T00:00:00Z",
    sessionMessage: { messageId: "mail", sourceSessionId: "expert", sourceTitle: "Expert", targetSessionId: "lead", kind: "message" } };
  const delivery = { messageId: "mail", userMessageId: body.id, teamSessionId: "lead", leadTurnId: "turn",
    scopeTurnId: "scope", boundaryId: "original-boundary", phase: "persisted", message: body };
  const persistedProof = { ...delivery, message: undefined };
  let readResponse = { capability: "ordinary-team-inbox-v1", messages: [delivery] };
  let promptStarts = 0;
  const calls = [];
  const agentHost = new AgentHost({
    runtime: { prompt: async () => { promptStarts += 1; throw new Error("No second turn allowed"); } }, sessions: {}, approvals: {},
  });
  agentHost.ingest({ sessionId: "lead", turnId: "turn", ts: 1, event: { type: "agent_start" } });
  const bridge = { agentHost };
  const activeTurns = new Map([["lead", "turn"]]);
  let runtime = {};
  let dispatchable = true;
  let duringRead = async () => {};
  let duringProof = async () => {};
  let proofPhase = "persisted";
  let available = true;
  let proofAvailable = true;
  const host = { isAvailable: () => available, async call(method, input) {
    calls.push({ method, input });
    if (method === "team.readOrdinaryInbox") { await duringRead(); return readResponse; }
    if (method === "team.ackOrdinaryInbox") return { ok: true, acknowledgedIds: input.messageIds };
    if (method === "team.getMessage") return { message: { id: "mail", targetSessionId: "lead", status: "completed" } };
    if (method === "team.getOrdinaryInboxProof") {
      if (!proofAvailable) throw new Error("Host transport unavailable");
      await duringProof();
      return { proof: { ...persistedProof, phase: proofPhase } };
    }
    if (method === "team.getRoster") return { teamSessionId: "lead", paused: false, members: [] };
    if (method === "team.pendingMessages") return { messages: [] };
    throw new Error(`Unexpected call ${method}`);
  } };
  const service = createTeamDeliveryService({ principal: { subject: "desktop", roles: ["owner"] },
    getHost: () => host, getBridge: () => bridge, activeTurns, getRuntimeIdentity: () => runtime,
    isTurnDispatchable: () => dispatchable, stopAtBoundary: async () => {}, log: () => {} });
  return { service, params, calls, delivery, agentHost, activeTurns,
    replaceRuntime: () => { runtime = {}; },
    cancel: () => { dispatchable = false; },
    setDuringRead: callback => { duringRead = callback; },
    setReadResponse: response => { readResponse = response; },
    getPromptStarts: () => promptStarts,
    setDuringProof: callback => { duringProof = callback; },
    setProofPhase: phase => { proofPhase = phase; },
    setAvailable: value => { available = value; proofAvailable = value; },
    queue: () => agentHost.queue.push({ id: "queue-mail", sessionId: "lead", sessionMessageId: "mail",
      principalSubject: "desktop", content: body.content, inputHash: "hash", createdAt: 1,
      effectivePermissionMode: "ask", idempotencyKey: "team-message:mail" }) };
}

test("wait boundary reads persisted authenticated bodies once and ACK retains original proof boundary", async () => {
  const state = fixture();
  await state.queue();
  const result = await state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params);
  assert.equal(result.messages[0].message.sessionMessage.sourceSessionId, "expert");
  assert.equal(state.agentHost.queue.size("lead"), 0);
  const repeated = await state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params);
  assert.equal(repeated.messages[0].userMessageId, result.messages[0].userMessageId);
  await state.service.ordinaryInboxRequest("team.ackOrdinaryInbox", { ...state.params,
    boundaryId: result.messages[0].boundaryId, messageIds: [result.messages[0].messageId] });
  assert.equal(state.calls.at(-1).input.boundaryId, "original-boundary");
  assert.equal(state.activeTurns.get("lead"), "turn");
});

test("stale, cancelling or cross-session callers cannot start Host persistence", async () => {
  for (const mutate of [state => state.activeTurns.set("lead", "new"), state => state.cancel()]) {
    const state = fixture();
    mutate(state);
    await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), { errorCode: "TEAM_TURN_INVALID" });
    assert.equal(state.calls.length, 0);
  }
  const state = fixture();
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", { ...state.params, callerSessionId: "expert" }), { errorCode: "TEAM_TURN_INVALID" });
  assert.equal(state.calls.length, 0);
});

test("runtime replacement after Host commit refuses body but still clears committed queue mirror", async () => {
  const state = fixture();
  await state.queue();
  state.setDuringRead(async () => state.replaceRuntime());
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), { errorCode: "TEAM_TURN_INVALID" });
  assert.equal(state.agentHost.queue.size("lead"), 0);
});

test("wrong Host proof cannot enter the live runtime", async () => {
  const state = fixture();
  state.delivery.leadTurnId = "old";
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), { errorCode: "TEAM_TURN_INVALID" });
});

test("invalid response after Host persistence is refused and reconciles its mirror without a notification", async () => {
  for (const alter of [
    delivery => ({ ...delivery, teamSessionId: "other-recipient" }),
    delivery => ({ ...delivery, message: { ...delivery.message,
      sessionMessage: { ...delivery.message.sessionMessage, messageId: "wrong-origin" } } }),
    delivery => ({ ...delivery, message: undefined }),
  ]) {
    const state = fixture();
    await state.queue();
    state.setReadResponse({ capability: "ordinary-team-inbox-v1", messages: [alter(state.delivery)] });
    let admitted = false;
    let error;
    try { await state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params); admitted = true; }
    catch (caught) { error = caught; }
    assert.equal(admitted, false);
    assert.ok(error instanceof TypeError || error.errorCode === "TEAM_TURN_INVALID");
    if (!(error instanceof TypeError)) assert.equal(error.message, "Host ordinary inbox response does not match the admission proof");
    assert.equal(state.agentHost.queue.size("lead"), 0);
    assert.equal(state.agentHost.queue.isHeld("lead"), false);
    assert.deepEqual(state.calls.map(call => call.method), ["team.readOrdinaryInbox", "team.getOrdinaryInboxProof"]);
    state.agentHost.ingest({ sessionId: "lead", turnId: "turn", ts: 2, event: { type: "agent_end" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.getPromptStarts(), 0);
  }
});

test("committed notification retires live mirror despite ended Lead turn and duplicate events", async () => {
  const state = fixture();
  await state.queue();
  state.activeTurns.clear();
  const event = { teamSessionId: "lead", leadTurnId: "turn", messageIds: ["mail"] };
  await state.service.onNotification("team.ordinaryInboxPersisted", event);
  await state.service.onNotification("team.ordinaryInboxPersisted", event);
  assert.equal(state.agentHost.queue.size("lead"), 0);
});

test("prepared proof notifications leave original report queued", async () => {
  const state = fixture();
  await state.queue();
  state.setProofPhase("prepared");
  await state.service.onNotification("team.ordinaryInboxPersisted", { teamSessionId: "lead", leadTurnId: "turn", messageIds: ["mail"] });
  assert.equal(state.agentHost.queue.size("lead"), 1);
});

test("lost Host read response reconciles committed proof before releasing admission", async () => {
  const state = fixture();
  await state.queue();
  state.setDuringRead(async () => { throw new Error("Host response lost after commit"); });
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), /response lost/);
  assert.equal(state.agentHost.queue.size("lead"), 0);
  assert.equal(state.agentHost.queue.isHeld("lead"), false);
});

test("Host outage fences live mirrors until backend-ready proof reconciliation, without restarting a turn", async () => {
  const state = fixture();
  await state.queue();
  state.setDuringRead(async () => { state.setAvailable(false); throw new Error("Host died after commit"); });
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), /Host died/);
  assert.equal(state.agentHost.queue.isHeld("lead"), true);
  assert.equal(state.agentHost.queue.size("lead"), 1);
  state.setAvailable(true);
  await state.service.drainPending("lead");
  assert.equal(state.agentHost.queue.isHeld("lead"), false);
  assert.equal(state.agentHost.queue.size("lead"), 0);
  assert.equal(state.activeTurns.get("lead"), "turn");
});

test("shutdown disposal closes admission and keeps uncertain mail fenced during turn settlement", async () => {
  const state = fixture();
  await state.queue();
  state.setDuringRead(async () => { state.setAvailable(false); throw new Error("Host unavailable"); });
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), /Host unavailable/);
  state.service.dispose();
  state.setAvailable(true);
  const calls = state.calls.length;
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), /disposed/);
  assert.equal(state.calls.length, calls);
  assert.equal(state.agentHost.queue.isHeld("lead"), true);
  assert.equal(state.agentHost.queue.size("lead"), 1);
});

test("shutdown during an awaited recovery proof cannot clear its queue fence", async () => {
  const state = fixture();
  await state.queue();
  state.setDuringRead(async () => { state.setAvailable(false); throw new Error("Host unavailable"); });
  await assert.rejects(state.service.ordinaryInboxRequest("team.readOrdinaryInbox", state.params), /Host unavailable/);
  state.setAvailable(true);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  state.setDuringProof(async () => { entered(); await gate; });
  const recovery = state.service.drainPending("lead");
  await started;
  state.service.dispose();
  release();
  await assert.rejects(recovery, /disposed/);
  assert.equal(state.agentHost.queue.isHeld("lead"), true);
  assert.equal(state.agentHost.queue.size("lead"), 1);
});
