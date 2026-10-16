import { expect, it } from "vitest";
import type { PlanExecution } from "@pi-desktop/shared";
import { ask, bash, fixture, runtimeAccess } from "./runtime-interaction-fixture.js";

it("graceful stop closes an approved Goal question without recovering or starting more work", async () => {
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  const effects: string[] = [];
  const test = fixture([[ask], [bash]], "interactive", "agent", {
    autoAnswer: false, observe: envelope => { if (envelope.event.type === "asktool_request") requested(); },
  }, { host: { call: async <T>(method: string): Promise<T> => {
    if (method === "goalProgress.issueToken") return { writeToken: "relay-goal-token" } as T;
    if (method === "tools.execute") { effects.push(method); return { ok: true, content: "Unexpected work" } as T; }
    return undefined as T;
  } } });
  const execution: PlanExecution = {
    id: "relay-goal", proposalId: "relay-approval", sessionId: "policy-fixture", kind: "goal",
    plan: "# Approved Goal\nWait for a decision before work.", title: "Stopped Goal", question: "Proceed?",
    artifact: { relativePath: ".pi/goal/relay.md", sha256: "hash", sizeBytes: 48 },
    targetPermissionMode: "auto", state: "running",
  };
  const turn = test.runtime.executeApprovedPlan(execution, "relay-goal-turn");
  try {
    await pending;
    expect(test.runtime.requestGracefulStop()).toEqual({ requested: true });
    await turn;
    expect(test.requests).toHaveLength(1);
    expect(effects).toEqual([]);
    expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
    expect(runtimeAccess(test.runtime).agent.state.messages.find(message => message.role === "toolResult"))
      .toMatchObject({ details: { answers: [null], resolutionKind: "stopped" } });
    expect(test.events.filter(e => e.event.type === "error")).toEqual([]);
    expect(test.events.filter(e => e.event.type === "turn_end")).toHaveLength(1);
    expect(test.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
    expect(test.runtime.getStatus().isRunning).toBe(false);
  } finally { await test.runtime.abort(); await turn; await test.runtime.dispose(); }
});

it("graceful stop closes an ordinary live question and completes the turn", async () => {
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  const test = fixture([[ask]], "interactive", "agent", {
    autoAnswer: false, observe: envelope => { if (envelope.event.type === "asktool_request") requested(); },
  });
  let done = false;
  const turn = test.runtime.prompt("Wait for a decision", "user", "relay-turn").then(() => { done = true; });
  try {
    await pending;
    expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(1);
    expect(test.runtime.requestGracefulStop()).toEqual({ requested: true });
    await Promise.race([turn, new Promise<void>(resolve => setTimeout(resolve, 150))]);
    expect(done).toBe(true);
    expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
    expect(test.events.filter(e => e.event.type === "error")).toEqual([]);
    expect(test.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
    expect(runtimeAccess(test.runtime).agent.state.messages.find(message => message.role === "toolResult")).toMatchObject({ details: { answers: [null], resolutionKind: "stopped" } });
  } finally {
    await test.runtime.abort();
    await turn;
    await test.runtime.dispose();
  }
});

it.each(["answered", "aborted"] as const)("persists ordinary %s without confusing Decline all with stop", async kind => {
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  const test = fixture([[ask]], "interactive", "agent", { autoAnswer: false,
    observe: envelope => { if (envelope.event.type === "asktool_request") requested(); },
  });
  const turn = test.runtime.prompt("Wait for a decision", "user", "relay-turn");
  try {
    await pending;
    const request = test.events.find(envelope => envelope.event.type === "asktool_request")!.event;
    if (request.type !== "asktool_request") throw new Error("question missing");
    expect(request.request).toMatchObject({ turnId: "relay-turn", toolCallId: "ask", createdAt: expect.any(String) });
    if (kind === "aborted") await test.runtime.abort();
    else test.runtime.resolveAskTool({ sessionId: request.request.sessionId, requestId: request.request.requestId, expectedToolCallId: "ask", answers: [null] });
    await turn;
    expect(runtimeAccess(test.runtime).agent.state.messages.find(message => message.role === "toolResult")).toMatchObject({ details: { answers: [null], resolutionKind: kind } });
    expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
  } finally { await test.runtime.abort(); await turn; await test.runtime.dispose(); }
});
