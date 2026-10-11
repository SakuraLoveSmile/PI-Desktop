import "./runtime-test-harness.js";
import { afterEach, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, AskToolRequest } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

const WAIT_MS = 30 * 60 * 1000;

afterEach(() => vi.useRealTimers());

it.each(["hard-first", "pending-first"] as const)(
  "settles once and preserves the recoverable Lead question when both deadlines meet (%s)",
  async order => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
    const events: AgentEventEnvelope["event"][] = [];
    const durable = new Map<string, { request: AskToolRequest; status: string }>();
    let askVisible!: () => void;
    const ready = new Promise<void>(resolve => { askVisible = resolve; });
    // This fixture is the external Host RPC boundary. Runtime, ask waiting,
    // tool execution, graceful stop and event settlement remain real.
    const host = { call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "team.registerLeadAsk") {
        const request = structuredClone(params?.request as AskToolRequest);
        durable.set(request.requestId, { request, status: "waiting" });
        return { ask: durable.get(request.requestId), deadlineMs: Date.now() + WAIT_MS };
      }
      if (method === "team.deferLeadAsk") {
        const stored = durable.get(String(params?.requestId));
        if (!stored) throw new Error("Missing durable question");
        if (order === "hard-first") expect(runtime.requestGracefulStop(true)).toEqual({ requested: true });
        stored.status = "pending";
        stored.request.teamPending = { deferredAt: new Date().toISOString(), requiresNewApproval: true };
        if (order === "pending-first") expect(runtime.requestGracefulStop(true)).toEqual({ requested: true });
        return { ask: structuredClone(stored) };
      }
      if (method === "team.listLeadAsks") return { asks: structuredClone([...durable.values()]) };
      if (method === "team.authorizeLeadTool") return { authorized: true };
      if (method === "team.getLaunchReview") return { review: null };
      if (method === "team.getLeadExecutionState") return { active: false };
      if (method === "session.appendMessage") return { ok: true };
      throw new Error(`Unexpected Host operation: ${method}`);
    }) };
    const runtime = createRuntime({
      executionProfile: "team", host,
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
      onEvent: envelope => {
        const event = (envelope as AgentEventEnvelope).event;
        events.push(event);
        if (event.type === "asktool_request" && !event.request.teamPending) askVisible();
      },
    });
    const view = runtime as unknown as { models: Pick<Models, "streamSimple"> };
    let requests = 0;
    view.models = { streamSimple: () => {
      requests++;
      const message = assistantMessage({ stopReason: "toolUse", content: [{
        type: "toolCall", id: "pending-at-hard-limit", name: "asktool",
        arguments: { questions: [{ question: "Resume after reviewing the hard limit?", options: ["Review", "Wait"] }] },
      }] }) as unknown as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      Promise.resolve().then(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end(message);
      });
      return stream;
    } };
    const running = runtime.prompt("Coordinate the approved team", "fixture-user", "limits-pending-turn");
    try {
      await Promise.race([ready, running.then(() => { throw new Error(`Lead settled before emitting its question: ${JSON.stringify({ errors: events.filter(event => event.type === "error"), hostMethods: host.call.mock.calls.map(([method]) => method) })}`); })]);
      expect(runtime.getStatus().isRunning).toBe(true);
      await vi.advanceTimersByTimeAsync(WAIT_MS);
      await running;
      expect(runtime.getStatus().isRunning).toBe(false);
      expect(requests).toBe(1);
      expect(events.some(event => event.type === "asktool_request" && event.request.teamPending)).toBe(true);
      await runtime.dispose();
      const restored = await host.call("team.listLeadAsks", { sessionId: "session-1" });
      expect(restored).toEqual({ asks: [expect.objectContaining({ status: "pending", request: expect.objectContaining({ teamPending: expect.objectContaining({ requiresNewApproval: true }) }) })] });
      expect(host.call.mock.calls.some(([method]) => method === "team.cancelLeadAsks")).toBe(false);
      await vi.advanceTimersByTimeAsync(WAIT_MS);
      expect(requests).toBe(1);
      expect(events.filter(event => event.type === "error" && event.error.code === "TURN_ABORTED")).toHaveLength(1);
      expect(events.filter(event => event.type === "turn_end"), JSON.stringify(events.map(event => event.type))).toHaveLength(1);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
    } finally {
      await runtime.dispose();
      await running.catch(() => undefined);
    }
  },
);
