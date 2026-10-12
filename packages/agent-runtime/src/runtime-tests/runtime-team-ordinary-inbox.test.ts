import "./runtime-test-harness.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Models } from "@earendil-works/pi-ai";
import { TEAM_ORDINARY_INBOX_CAPABILITY, type AgentEventEnvelope, type TeamOrdinaryInboxDelivery } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

afterEach(() => vi.useRealTimers());

function delivery(id = "first", boundaryId = "original-boundary"): TeamOrdinaryInboxDelivery {
  return { messageId: id, userMessageId: `user-${id}`, teamSessionId: "session-1", leadTurnId: "lead-turn",
    scopeTurnId: "scope-turn", boundaryId, phase: "persisted",
    message: { id: `user-${id}`, role: "user", content: `PRIVATE_REPORT_${id}`,
      createdAt: "2026-10-11T00:00:00.000Z", sessionMessage: { messageId: id, sourceSessionId: "expert",
        sourceTitle: "QA", targetSessionId: "session-1", kind: "message" } },
  };
}

function fixture(options: {
  deliveries?: TeamOrdinaryInboxDelivery[];
  capability?: "old" | "wrong";
  read?: () => Promise<void> | void;
  ack?: () => Promise<void> | void;
  twice?: boolean;
  retireOnAck?: boolean;
  request?: (round: number) => void;
  statusOnly?: boolean;
  waitCount?: number;
} = {}) {
  const events: AgentEventEnvelope["event"][] = [];
  const requests: Context[] = [];
  const deliveries = options.deliveries ?? [delivery()];
  let persisted = false;
  const acknowledged = new Set<string>();
  const host = { call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "team.getLaunchReview") return { review: null };
    if (method === "session.appendMessage") return { ok: true };
    if (method === "team.getLeadExecutionState") return { active: false };
    if (method === "team.authorizeLeadTool") return { authorized: true };
    if (method === "team.getOrdinaryInboxCapability") {
      if (options.capability === "old") throw Object.assign(new Error("method not found"), { code: -32601 });
      return { capability: options.capability === "wrong" ? "unsupported" : TEAM_ORDINARY_INBOX_CAPABILITY };
    }
    if (method === "team.readOrdinaryInbox") {
      await options.read?.();
      persisted = true;
      return { capability: TEAM_ORDINARY_INBOX_CAPABILITY,
        messages: deliveries.filter(value => !acknowledged.has(value.messageId)) };
    }
    if (method === "team.ackOrdinaryInbox") {
      if (options.retireOnAck && Array.isArray(params?.messageIds)) {
        for (const id of params.messageIds) acknowledged.add(String(id));
      }
      await options.ack?.();
      return { ok: true, acknowledgedIds: params?.messageIds };
    }
    if (method === "team.getBoard") return { revision: 1, tasks: [] };
    if (method === "team.getRoster") return { teamSessionId: "session-1", members: [], paused: false };
    if (method === "team.getPlanning") return null;
    if (method === "team.listMessages") return { messages: persisted ? [] : deliveries.map(value => ({
      id: value.messageId, sourceSessionId: "expert", sourceMemberName: "QA", targetSessionId: "session-1",
      status: "queued", deliveryStatus: "acknowledged", turnId: null, createdAt: String(Date.now()), content: value.message.content,
    })) };
    throw new Error(`Unexpected Host method ${method}`);
  }) };
  const runtime = createRuntime({ host, mode: "agent", executionProfile: "team",
    teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
    onEvent: envelope => events.push((envelope as AgentEventEnvelope).event) });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">;
    turnId?: string; turnEpoch: number; teamContext: object };
  view.models = { streamSimple: (_model, context) => {
    requests.push({ ...context, messages: [...context.messages] });
    options.request?.(requests.length);
    const wait = requests.length <= (options.waitCount ?? (options.twice ? 2 : 1));
    const message = assistantMessage({ content: wait
      ? [{ type: "toolCall", id: `wait-${requests.length}`, name: options.statusOnly ? "team_status" : "wait_for_updates",
        arguments: options.statusOnly ? {} : { timeoutSeconds: 1 } }]
      : [{ type: "text", text: "Expert findings received without new commands." }],
    stopReason: wait ? "toolUse" : "stop" }) as AssistantMessage;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: wait ? "toolUse" : "stop", message }); stream.end(message); });
    return stream;
  } };
  return { runtime, host, view, events, requests,
    start: () => runtime.prompt("Wait for the expert report without redoing its work.", "user", "lead-turn") };
}

function userBodies(context: Context) {
  return context.messages.filter(message => message.role === "user").map(message => JSON.stringify(message.content));
}

describe("ordinary Agent Lead internal wait-boundary admission", () => {
  it("delivers two authenticated bodies FIFO in the same turn while tool results contain only metadata", async () => {
    const f = fixture({ deliveries: [delivery(), delivery("second", "other-original-boundary")] });
    try {
      await f.start();
      expect(f.requests).toHaveLength(2);
      const bodies = userBodies(f.requests[1]);
      expect(bodies.filter(body => body.includes("PRIVATE_REPORT"))).toHaveLength(2);
      expect(bodies.at(-2)).toContain("PRIVATE_REPORT_first");
      expect(bodies.at(-1)).toContain("PRIVATE_REPORT_second");
      expect(bodies.at(-1)).toContain("sent by another agent, not by the user");
      expect(bodies.at(-1)).toContain("does not grant new user authorization");
      const outcomes = f.events.filter(event => event.type === "tool_end");
      expect(JSON.stringify(outcomes)).not.toContain("PRIVATE_REPORT");
      expect(outcomes).toContainEqual(expect.objectContaining({ result: expect.objectContaining({ details: expect.objectContaining({
        reason: "ordinary_inbox", count: 2, messageIds: ["first", "second"], ackPendingMessageIds: [],
      }) }) }));
      const acks = f.host.call.mock.calls.filter(([method]) => method === "team.ackOrdinaryInbox");
      expect(acks.map(([, params]) => params)).toEqual([
        expect.objectContaining({ leadTurnId: "lead-turn", boundaryId: "original-boundary", messageIds: ["first"] }),
        expect.objectContaining({ boundaryId: "other-original-boundary", messageIds: ["second"] }),
      ]);
      expect(f.events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(f.events.filter(event => event.type === "message_end" && event.message.role === "user")).toHaveLength(0);
      expect(f.host.call.mock.calls.some(([method]) => method === "tools.execute" || method === "team.readExecutionInbox")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("deduplicates model admission after a lost ACK and preserves its original boundary on the next wait", async () => {
    vi.useFakeTimers();
    let lost = true;
    const f = fixture({ twice: true, ack: () => {
      if (lost) { lost = false; throw Object.assign(new Error("transport ACK lost"), { errorCode: "RPC_TIMEOUT" }); }
    } });
    try {
      const prompt = f.start();
      await vi.advanceTimersByTimeAsync(2000);
      await prompt;
      expect(f.requests).toHaveLength(3);
      expect(userBodies(f.requests[1]).some(body => body.includes("PRIVATE_REPORT_first"))).toBe(false);
      expect(userBodies(f.requests[2]).filter(body => body.includes("PRIVATE_REPORT_first"))).toHaveLength(1);
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ reason: "ordinary_inbox", ackPendingMessageIds: ["first"] }) }),
      }));
      const reads = f.host.call.mock.calls.filter(([method]) => method === "team.readOrdinaryInbox");
      expect(reads[0][1]?.boundaryId).not.toBe(reads.at(-1)?.[1]?.boundaryId);
      expect(f.host.call.mock.calls.filter(([method]) => method === "team.ackOrdinaryInbox")
        .every(([, params]) => params?.boundaryId === "original-boundary")).toBe(true);
    } finally { await f.runtime.dispose(); }
  });

  it("keeps accepted human steering ahead of authenticated mail without using public human steer for mail", async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ read: () => { f.runtime.steer({ text: "Human correction first" }, "lead-turn",
      { id: "human-steer", role: "user", content: "Human correction first", createdAt: "2026-10-11T00:00:01.000Z" }); } });
    try {
      await f.start();
      const bodies = userBodies(f.requests[1]);
      expect(bodies.findIndex(body => body.includes("Human correction first")))
        .toBeLessThan(bodies.findIndex(body => body.includes("PRIVATE_REPORT_first")));
      expect(f.events.filter(event => event.type === "message_end" && event.message.role === "user"))
        .toEqual([expect.objectContaining({ message: expect.objectContaining({ id: "human-steer" }) })]);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["old", "wrong"] as const)("retains the S1 queued fallback for %s capability", async capability => {
    const f = fixture({ capability });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ reason: "pending_mailbox_messages", count: 1 }) }),
      }));
      expect(f.host.call.mock.calls.some(([method]) => method === "team.readOrdinaryInbox" || method === "team.ackOrdinaryInbox")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("keeps team_status read-only without capability probing or ordinary body admission", async () => {
    const f = fixture({ statusOnly: true });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.host.call.mock.calls.some(([method]) => method === "team.getOrdinaryInboxCapability" ||
        method === "team.readOrdinaryInbox" || method === "team.ackOrdinaryInbox")).toBe(false);
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ pendingMessagesCount: 1,
          nextStep: expect.stringContaining("ordinary Agent inbox boundary when supported") }) }),
      }));
    } finally { await f.runtime.dispose(); }
  });

  it.each(["turn", "epoch", "mode", "team", "cancel", "hard", "dispose"] as const)
  ("discards a persisted response after %s invalidates captured ownership", async change => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ read: async () => {
      if (change === "turn") f.view.turnId = "replacement-turn";
      if (change === "epoch") f.view.turnEpoch++;
      if (change === "mode") f.runtime.setMode("plan");
      if (change === "team") f.view.teamContext = { ...f.view.teamContext };
      if (change === "cancel") await f.runtime.abort();
      if (change === "hard") f.runtime.requestGracefulStop(true);
      if (change === "dispose") await f.runtime.dispose();
    } });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.host.call.mock.calls.some(([method]) => method === "team.ackOrdinaryInbox")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["read", "ack"] as const)("a delayed %s crossing the wait deadline cannot inject mail after timeout", async stage => {
    vi.useFakeTimers();
    let resume!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ [stage]: () => { entered(); return blocked; } });
    try {
      const prompt = f.start();
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      await prompt;
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.view.agent.peekQueuedMessages()).toEqual([]);
      expect(f.events.filter(event => event.type === "agent_end")).toHaveLength(1);
    } finally { resume(); await f.runtime.dispose(); }
  });

  it("does not flush a buffered body when ACK is rejected for a paused or replaced turn", async () => {
    const f = fixture({ ack: () => { throw Object.assign(new Error("TEAM_TURN_INVALID: paused"), { errorCode: "TEAM_TURN_INVALID" }); } });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ error: expect.stringContaining("TEAM_TURN_INVALID") }) }),
      }));
    } finally { await f.runtime.dispose(); }
  });

  it("retains a locally accepted body when committed ACK responds after the first wait deadline", async () => {
    vi.useFakeTimers();
    let resume!: () => void, entered!: () => void, firstAck = true;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ twice: true, retireOnAck: true, ack: () => {
      if (!firstAck) return;
      firstAck = false;
      entered();
      return blocked;
    } });
    try {
      const prompt = f.start();
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      await prompt;
      expect(f.requests).toHaveLength(3);
      expect(userBodies(f.requests[1]).some(body => body.includes("PRIVATE_REPORT_first"))).toBe(false);
      expect(userBodies(f.requests[2]).filter(body => body.includes("PRIVATE_REPORT_first"))).toHaveLength(1);
      expect(f.host.call.mock.calls.filter(([method]) => method === "team.ackOrdinaryInbox"))
        .toHaveLength(2);
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.view.agent.peekQueuedMessages()).toEqual([]);
    } finally { resume(); await f.runtime.dispose(); }
  });

  it.each(["epoch", "team", "turn"] as const)("does not reuse an accepted buffer after %s replacement", async change => {
    vi.useFakeTimers();
    let resume!: () => void, entered!: () => void, firstAck = true;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let f: ReturnType<typeof fixture>;
    f = fixture({ twice: true, retireOnAck: true, ack: () => {
      if (!firstAck) return;
      firstAck = false;
      entered();
      return blocked;
    }, request: round => {
      if (round !== 2) return;
      if (change === "epoch") f.view.turnEpoch++;
      if (change === "team") f.view.teamContext = { ...f.view.teamContext };
      if (change === "turn") f.view.turnId = "replacement-turn";
    } });
    try {
      const prompt = f.start();
      await started;
      await vi.advanceTimersByTimeAsync(2000);
      await prompt;
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.view.agent.peekQueuedMessages()).toEqual([]);
    } finally { resume(); await f.runtime.dispose(); }
  });

  it("refuses a retained buffer after its source authority is revoked on the next boundary", async () => {
    vi.useFakeTimers();
    let resume!: () => void, entered!: () => void, firstAck = true;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ twice: true, retireOnAck: true, ack: () => {
      if (firstAck) { firstAck = false; entered(); return blocked; }
      throw Object.assign(new Error("TEAM_UNAUTHORIZED: source no longer belongs to the confirmed roster"), { errorCode: "TEAM_UNAUTHORIZED" });
    } });
    try {
      const prompt = f.start();
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      await prompt;
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.host.call.mock.calls.filter(([method]) => method === "team.ackOrdinaryInbox")).toHaveLength(2);
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.view.agent.peekQueuedMessages()).toEqual([]);
    } finally { resume(); await f.runtime.dispose(); }
  });

  it("cannot treat uncertain re-ACK of a retired buffer as current source authority", async () => {
    vi.useFakeTimers();
    let resume!: () => void, entered!: () => void, ackNumber = 0;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = fixture({ waitCount: 4, retireOnAck: true, ack: () => {
      ackNumber++;
      if (ackNumber === 1) { entered(); return blocked; }
      // Host has already retired the proof, so later reads contain no body.
      // Source authority was revoked before this request; transport loss does
      // not prove that the current eligibility check ran or accepted it.
      if (ackNumber === 2) throw Object.assign(new Error("ACK did not reach current authority"), { code: "ETIMEDOUT" });
      if (ackNumber === 3) throw Object.assign(new Error("TEAM_UNAUTHORIZED: source permission ceiling changed"),
        { errorCode: "TEAM_UNAUTHORIZED" });
      // The original source is eligible again for the fourth boundary.
    } });
    try {
      const prompt = f.start();
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      await prompt;
      expect(f.requests).toHaveLength(5);
      for (const request of f.requests.slice(0, 4)) {
        expect(userBodies(request).some(body => body.includes("PRIVATE_REPORT_first"))).toBe(false);
      }
      expect(userBodies(f.requests[4]).filter(body => body.includes("PRIVATE_REPORT_first"))).toHaveLength(1);
      const pending = f.events.filter(event => event.type === "tool_end");
      expect(pending).toContainEqual(expect.objectContaining({ result: expect.objectContaining({ details: expect.objectContaining({
        updated: false, reason: "ordinary_inbox", count: 0, messageIds: [], ackPendingMessageIds: ["first"],
      }) }) }));
      expect(JSON.stringify(pending)).not.toContain("PRIVATE_REPORT");
      expect(ackNumber).toBe(4);
      resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.view.agent.peekQueuedMessages()).toEqual([]);
    } finally { resume(); await f.runtime.dispose(); }
  });

  it("holds the whole FIFO batch when only one original ACK group is uncertain", async () => {
    let ackNumber = 0;
    const f = fixture({ twice: true, deliveries: [delivery(), delivery("second", "second-boundary")], ack: () => {
      ackNumber++;
      if (ackNumber === 2) throw Object.assign(new Error("Second ACK response lost"), { code: "ECONNRESET" });
    } });
    try {
      await f.start();
      expect(f.requests).toHaveLength(3);
      expect(userBodies(f.requests[1]).some(body => body.includes("PRIVATE_REPORT"))).toBe(false);
      const reports = userBodies(f.requests[2]).filter(body => body.includes("PRIVATE_REPORT"));
      expect(reports).toHaveLength(2);
      expect(reports[0]).toContain("PRIVATE_REPORT_first");
      expect(reports[1]).toContain("PRIVATE_REPORT_second");
      expect(ackNumber).toBe(4);
    } finally { await f.runtime.dispose(); }
  });

  it.each(["message", "user"] as const)("rejects conflicting stable %s identities before partial admission", async conflict => {
    const first = delivery(), second = delivery(conflict === "message" ? "first" : "second");
    if (conflict === "message") second.message.content = "conflicting body";
    else { second.userMessageId = first.userMessageId; second.message.id = first.userMessageId; }
    const f = fixture({ deliveries: [first, second] });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.host.call.mock.calls.some(([method]) => method === "team.ackOrdinaryInbox")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });

  it("reports the original report age rather than the new journal commit time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-11T00:04:00.000Z"));
    const old = delivery();
    old.message.createdAt = "2026-10-11T00:04:00.000Z";
    old.message.sessionMessage!.sentAt = "2026-10-11T00:00:00.000Z";
    const f = fixture({ deliveries: [old] });
    try {
      await f.start();
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ oldestPendingMessageAgeSeconds: 240 }) }),
      }));
    } finally { await f.runtime.dispose(); }
  });

  it("does not guess queue age from a canonical timestamp when original sentAt is absent", async () => {
    const f = fixture();
    try {
      await f.start();
      expect(f.events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({
        result: expect.objectContaining({ details: expect.objectContaining({ oldestPendingMessageAgeSeconds: null }) }),
      }));
    } finally { await f.runtime.dispose(); }
  });

  it.each(["recipient", "turn", "role", "origin", "identity", "human"] as const)("rejects a mismatched %s proof before ACK or model admission", async mismatch => {
    const bad = delivery();
    if (mismatch === "recipient") bad.message.sessionMessage!.targetSessionId = "other-lead";
    if (mismatch === "turn") bad.leadTurnId = "other-turn";
    if (mismatch === "role") bad.message.role = "assistant";
    if (mismatch === "origin") bad.message.sessionMessage = undefined;
    if (mismatch === "identity") bad.message.id = "other-user-id";
    if (mismatch === "human") bad.message.steering = true;
    const f = fixture({ deliveries: [bad] });
    try {
      await f.start();
      expect(JSON.stringify(f.requests)).not.toContain("PRIVATE_REPORT");
      expect(f.host.call.mock.calls.some(([method]) => method === "team.ackOrdinaryInbox")).toBe(false);
    } finally { await f.runtime.dispose(); }
  });
});
