import "./runtime-test-harness.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

afterEach(() => vi.useRealTimers());

describe("ordinary Agent Lead queued expert reports", () => {
  it.each(["cancel", "mode", "turn", "epoch", "team", "dispose"] as const)("discards an awaited ordinary summary after %s", async change => {
    vi.useFakeTimers();
    let invalidate: () => Promise<void> | void = () => {};
    const host = { call: vi.fn(async (method: string) => {
      if (method === "team.authorizeLeadTool") return { authorized: true };
      if (method === "team.getBoard") return { revision: 1 };
      if (method === "team.listMessages") {
        await invalidate();
        return { messages: [{ id: "report", sourceSessionId: "expert", sourceMemberName: "expert", targetSessionId: "session-1",
          status: "queued", deliveryStatus: "acknowledged", turnId: null, createdAt: String(Date.now()), content: "PRIVATE_REPORT" }] };
      }
      throw new Error(`Unexpected ${method}`);
    }) };
    const runtime = createRuntime({ host, mode: "agent", executionProfile: "team",
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true } });
    const state = runtime as unknown as { agent: Agent; turnId?: string; turnEpoch: number; teamContext: object };
    state.turnId = "active-turn";
    const controller = new AbortController();
    invalidate = async () => {
      if (change === "cancel") controller.abort();
      if (change === "mode") runtime.setMode("plan");
      if (change === "turn") state.turnId = "next-turn";
      if (change === "epoch") state.turnEpoch++;
      if (change === "team") state.teamContext = { ...state.teamContext };
      if (change === "dispose") await runtime.dispose();
    };
    try {
      const tool = state.agent.state.tools.find(entry => entry.name === "wait_for_updates")!;
      const outcome = await tool.execute("stale-agent-wait", { timeoutSeconds: 1 }, controller.signal);
      expect(outcome.terminate).toBeUndefined();
      expect(outcome.details).not.toMatchObject({ reason: "pending_mailbox_messages" });
      expect(JSON.stringify(outcome)).not.toContain("PRIVATE_REPORT");
      expect(vi.getTimerCount()).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("shows metadata in a mixed wait/status turn, then receives the full report only in an authenticated continuation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const events: AgentEventEnvelope["event"][] = [];
    const requests: AgentMessage[][] = [];
    const body = "PRIVATE_EXPERT_FULL_BODY: verified delegated commands";
    const host = { call: vi.fn(async (method: string) => {
      if (method === "team.getLaunchReview") return { review: null };
      if (method === "session.appendMessage") return { ok: true };
      if (method === "team.getLeadExecutionState") return { active: false };
      if (method === "team.authorizeLeadTool") return { authorized: true };
      if (method === "team.getBoard") return { revision: 1, tasks: [] };
      if (method === "team.getRoster") return { teamSessionId: "session-1", members: [], paused: false };
      if (method === "team.getPlanning") return null;
      if (method === "team.listMessages") return { messages: [{ id: "report", sourceSessionId: "expert-session", sourceMemberName: "expert",
        targetSessionId: "session-1", status: "queued", deliveryStatus: "acknowledged", turnId: null, createdAt: String(Date.now() - 229000), content: body }] };
      throw new Error(`Unexpected boundary: ${method}`);
    }) };
    const runtime = createRuntime({ host, mode: "agent", executionProfile: "team",
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
      onEvent: envelope => events.push((envelope as AgentEventEnvelope).event) });
    const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple"> };
    view.models = { streamSimple: (_model, context) => {
      requests.push([...context.messages]);
      const content = requests.length === 1 ? [
        { type: "toolCall", id: "wait-agent", name: "wait_for_updates", arguments: { timeoutSeconds: 1 } },
        { type: "toolCall", id: "status-agent", name: "team_status", arguments: {} },
      ] : [{ type: "text", text: "Pending reports are visible; finish this turn without repeating delegated commands." }];
      const message = assistantMessage({ content, stopReason: requests.length === 1 ? "toolUse" : "stop" }) as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); stream.end(message); });
      return stream;
    } };
    try {
      const prompt = runtime.prompt("Wait for the delegated expert, never repeat its commands", "user", "lead-turn");
      await vi.advanceTimersByTimeAsync(1000);
      await prompt;
      expect(events.filter(event => event.type === "error")).toEqual([]);
      expect(requests).toHaveLength(2);
      expect(events.filter(event => event.type === "tool_end")).toContainEqual(expect.objectContaining({ type: "tool_end", result: expect.objectContaining({
        details: expect.objectContaining({ reason: "pending_mailbox_messages", pendingMessagesCount: 1,
          pendingMessageSenders: ["expert"], oldestPendingMessageAgeSeconds: 229 }),
      }) }));
      expect(JSON.stringify(requests)).not.toContain(body);
      expect(host.call.mock.calls.some(([method]) => method === "team.readExecutionInbox" || method === "team.ackMessage" || method === "tools.execute")).toBe(false);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
      await runtime.prompt({ text: body, sessionMessage: { messageId: "report", sourceSessionId: "expert-session", sourceTitle: "expert",
        targetSessionId: "session-1", kind: "message" } }, "mail-user", "continuation-turn");
      expect(JSON.stringify(requests[2]?.filter(message => message.role === "user"))).toContain(body);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(2);
    } finally { await runtime.dispose(); }
  });
});
