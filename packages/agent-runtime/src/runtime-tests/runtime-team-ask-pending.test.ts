import "./runtime-test-harness.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Models,
} from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, AskToolRequest } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

async function flushMicrotasks() {
  for (let index = 0; index < 100; index++) await Promise.resolve();
}

describe("Team Lead unanswered questions", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["standard", "member"] as const)("keeps %s questions unlimited after six hours", async kind => {
    vi.useFakeTimers();
    const events: AgentEventEnvelope["event"][] = [];
    const runtime = createRuntime({
      ...(kind === "member" ? { executionProfile: "team" as const, teamContext: { teamSessionId: "lead", callerSessionId: "session-1", isLead: false } } : {}),
      onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
    });
    const agent = (runtime as unknown as { agent: Agent }).agent;
    const tool = agent.state.tools.find(candidate => candidate.name === "asktool")!;
    let settled = false;
    const answer = tool.execute("normal-ask", { questions: [{ question: "Next?", options: ["Wait"] }] }).then(result => { settled = true; return result; });
    try {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
      expect(settled).toBe(false);
      const request = events.find(event => event.type === "asktool_request");
      if (request?.type !== "asktool_request") throw new Error("Question request missing");
      expect(request.request.teamPending).toBeUndefined();
      runtime.resolveAskTool({ sessionId: "session-1", requestId: request.request.requestId, answers: [["Wait"]] });
      await expect(answer).resolves.toMatchObject({ details: { answers: [["Wait"]] } });
    } finally { await runtime.dispose(); }
  });

  it("replays 05:05–10:51 without keeping the Lead turn blocked after 30 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T05:05:00+08:00"));
    const events: AgentEventEnvelope["event"][] = [];
    let request: AskToolRequest | undefined;
    const host = { call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "team.registerLeadAsk") { request = params?.request as AskToolRequest; return { ask: { request, status: "waiting" }, deadlineMs: Date.now() + 30 * 60 * 1000 }; }
      if (method === "team.deferLeadAsk") return { ask: { request: { ...request, teamPending: { deferredAt: new Date().toISOString(), requiresNewApproval: true } }, status: "pending" } };
      if (method === "team.authorizeLeadTool") return { authorized: true };
      if (method === "team.getLaunchReview") return { review: null };
      return null;
    }) };
    const runtime = createRuntime({
      executionProfile: "team", host,
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
      onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
    });
    const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple"> };
    view.models = { streamSimple: () => {
      const message = assistantMessage({ stopReason: "toolUse", content: [{
        type: "toolCall", id: "replace-question", name: "asktool",
        arguments: { questions: [{ question: "Review failed expert replacement?", options: ["Review", "Keep pending"] }] },
      }] }) as unknown as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      Promise.resolve().then(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end(message);
      });
      return stream;
    } };
    const running = runtime.prompt("Coordinate the approved experts", "fixture-user", "fixture-lead-turn");
    try {
      await flushMicrotasks();
      expect(events.some(event => event.type === "asktool_request")).toBe(true);
      expect(runtime.getStatus().isRunning).toBe(true);
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await flushMicrotasks();
      expect(runtime.getStatus().isRunning).toBe(false);
      await running;
      expect(events.filter(event => event.type === "error")).toEqual([expect.objectContaining({ error: expect.objectContaining({ code: "TURN_ABORTED" }) })]);
      expect(events.some(event => event.type === "asktool_request" && event.request.teamPending)).toBe(true);
      expect(host.call.mock.calls.some(([method]) => method === "team.confirmLaunchReview")).toBe(false);
    } finally {
      await runtime.abort();
      await running;
      await runtime.dispose();
    }
  });
});
