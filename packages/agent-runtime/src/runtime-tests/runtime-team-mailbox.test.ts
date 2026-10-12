import "./runtime-test-harness.js";
import { describe, vi, it, expect } from "vitest";
import { type AgentEventEnvelope } from "@pi-desktop/shared";
import { type AgentMessage, type Agent } from "@earendil-works/pi-agent-core";
import {
  type Models,
  type AssistantMessage,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime Team Plan mailbox yield", () => {

  const deferred = { status: "deferred", reason: "team_messages_pending", pendingMessagesCount: 1 };

  const args = { title: "Researched plan", markdown: "# Plan\n\nPreserve revisions.", question: "Approve?" };

  function fixture(options: {
    result?: unknown;
    mode?: "plan" | "goal";
    executionProfile?: "team" | "standard";
    submitError?: Error;
    onSubmit?: () => void;
    waitBatch?: boolean;
    onListMessages?: () => Promise<void> | void;
  } = {}) {
    let submissions = 0;
    const events: AgentEventEnvelope["event"][] = [];
    const requests: AgentMessage[][] = [];
    const host = { call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "team.authorizeLeadTool") return { authorized: true };
      if (method === "team.getBoard") return { revision: 1, tasks: [] };
      if (method === "team.getRoster") return { teamSessionId: "session-1", members: [], paused: false };
      if (method === "team.getPlanning") return null;
      if (method === "team.listMessages") {
        await options.onListMessages?.();
        return { messages: [
          { id: "expert-mail", sourceSessionId: "researcher", targetSessionId: "session-1",
            status: "queued", deliveryStatus: "acknowledged", turnId: null },
        ] };
      }
      if (method === "plans.submit") {
        options.onSubmit?.();
        if (options.submitError) throw options.submitError;
        if (++submissions === 1) return options.result ?? deferred;
        return { status: "pending", proposal: {
          id: "final-plan", title: params?.title, markdown: params?.markdown,
          artifact: { relativePath: ".pi/plan/final-plan.md", sha256: "a".repeat(64), sizeBytes: 100 },
        } };
      }
      return undefined;
    }) };
    const runtime = createRuntime({
      host, mode: options.mode ?? "plan", executionProfile: options.executionProfile ?? "team",
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
      onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
    });
    const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple"> };
    view.models = { streamSimple: (_model, context) => {
      requests.push([...context.messages]);
      const content = context.messages.map(message => JSON.stringify(message)).join("\n");
      const submissionCall = {
        type: "toolCall", id: `submit-mail-${requests.length}`,
        name: options.mode === "goal" ? "SubmitGoal" : "SubmitPlan",
        arguments: { ...args, markdown: content.includes("SOURCE_DETAIL_UNTRUNCATED")
          ? `${args.markdown}\n\nSOURCE_DETAIL_UNTRUNCATED: preserve stale-revision checks.` : args.markdown },
      };
      const message = assistantMessage({ content: options.waitBatch && requests.length === 1 ? [
        { type: "toolCall", id: "wait-mail", name: "wait_for_updates", arguments: { timeoutSeconds: 1 } },
        { type: "toolCall", id: "status-mail", name: "team_status", arguments: {} },
      ] : [submissionCall], stopReason: "toolUse" }) as unknown as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: "toolUse", message });
        stream.end(message);
      });
      return stream;
    } };
    return { runtime, host, events, requests, view };
  }

  it("releases a mixed wait/status batch for queued ACKed mail and reads full content in the authenticated continuation", async () => {
    const { runtime, host, events, requests, view } = fixture({ waitBatch: true, result: {
      status: "pending", proposal: { id: "final-plan", title: args.title, markdown: args.markdown,
        artifact: { relativePath: ".pi/plan/final-plan.md", sha256: "a".repeat(64), sizeBytes: 100 } },
    } });
    // Trusted extensions can transform results, but cannot hold the Lead open.
    const internals = runtime as unknown as { extensionRunner: unknown; turnHadError: boolean;
      pendingSteering: Map<AgentMessage, string>; acceptingSteering: boolean };
    internals.extensionRunner = {
      hasHandlers: (type: string) => type === "tool_result",
      emit: async (_type: string, payload: { toolName?: string }) => {
        if (payload.toolName === "team_status") runtime.steer({ text: "Keep the audit requirements" },
          "aggregation-turn", { id: "steering-input", role: "user", content: "Keep the audit requirements",
            createdAt: new Date().toISOString() });
        return { terminate: false };
      }, dispose: async () => {}, getAgentTools: () => [],
    };
    try {
      await runtime.prompt("Await the experts", "user-1", "aggregation-turn");
      expect(requests).toHaveLength(1);
      expect(runtime.getStatus().isRunning).toBe(false);
      expect(runtime.getStatus().planningState).toBe("planning");
      expect(internals.turnHadError).toBe(false);
      expect(internals.pendingSteering.size).toBe(0);
      expect(internals.acceptingSteering).toBe(false);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(events.some(event => event.type === "error")).toBe(false);
      expect(host.call.mock.calls.some(([method]) => method === "plans.submit" || method === "team.readExecutionInbox")).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", isError: false,
        result: expect.objectContaining({ details: expect.objectContaining({ reason: "pending_mailbox_messages", count: 1 }), terminate: true }) }));
      expect(view.agent.state.tools.some(tool => tool.name === "wait_for_updates")).toBe(true);
      const fullReport = `${"Detailed evidence. ".repeat(1000)}SOURCE_DETAIL_UNTRUNCATED: preserve revisions.`;
      await runtime.prompt({ text: fullReport, sessionMessage: {
        messageId: "expert-mail", sourceSessionId: "researcher", sourceTitle: "Researcher",
        targetSessionId: "session-1", kind: "message",
      } }, "mail-user", "expert-continuation-turn");
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1])).toContain("SOURCE_DETAIL_UNTRUNCATED");
      expect(JSON.stringify(requests[1])).toContain("Keep the audit requirements");
      expect(runtime.getStatus().planningState).toBe("awaiting_approval");
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(2);
    } finally { await runtime.dispose(); }
  });

  it.each(["cancel", "mode", "turn", "epoch", "team", "dispose"] as const)(
    "does not terminate a replacement turn when a queued wait response follows %s", async change => {
      vi.useFakeTimers();
      let invalidate: () => Promise<void> | void = () => {};
      const { runtime, view } = fixture({ onListMessages: () => invalidate() });
      const state = runtime as unknown as { turnId?: string; turnEpoch: number; teamContext: object;
        pendingTeamInboxYield?: unknown; terminatingToolCalls: Set<string> };
      state.turnId = "wait-turn";
      const controller = new AbortController();
      invalidate = async () => {
        if (change === "cancel") controller.abort();
        if (change === "mode") runtime.setMode("goal");
        if (change === "turn") state.turnId = "replacement-turn";
        if (change === "epoch") state.turnEpoch++;
        if (change === "team") state.teamContext = { ...state.teamContext };
        if (change === "dispose") await runtime.dispose();
      };
      try {
        const tool = view.agent.state.tools.find(entry => entry.name === "wait_for_updates");
        if (!tool) throw new Error("Missing wait_for_updates");
        const pending = tool.execute("stale-wait", { timeoutSeconds: 1 }, controller.signal);
        await vi.advanceTimersByTimeAsync(1000);
        expect((await pending).terminate).toBeUndefined();
        expect(state.terminatingToolCalls.has("stale-wait")).toBe(false);
        expect(state.pendingTeamInboxYield).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      } finally { await runtime.dispose(); vi.useRealTimers(); }
    },
  );

  it("ends deferred aggregation normally and consumes the full expert continuation before publishing the only proposal", async () => {
    const { runtime, host, events, requests } = fixture();
    try {
      await runtime.prompt("Synthesize the experts' results", "user-1", "aggregation-turn");
      expect(requests).toHaveLength(1);
      expect(runtime.getStatus().planningState).toBe("planning");
      expect(runtime.getStatus().isRunning).toBe(false);
      const state = runtime as unknown as { pendingSubmissionOutcome?: unknown; turnHadError: boolean };
      expect(state.pendingSubmissionOutcome).toBeUndefined();
      expect(state.turnHadError).toBe(false);
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(1);
      expect(events.filter(event => event.type === "turn_end")).toHaveLength(1);
      expect(events.some(event => event.type === "error")).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", isError: false,
        result: expect.objectContaining({ details: deferred, terminate: true }) }));
      const fullReport = `Full research report\n${"Detailed evidence. ".repeat(1000)}SOURCE_DETAIL_UNTRUNCATED: preserve stale-revision checks.`;
      await runtime.prompt({ text: fullReport, sessionMessage: {
        messageId: "expert-mail", sourceSessionId: "researcher", sourceTitle: "Researcher",
        targetSessionId: "session-1", kind: "message",
      } }, "mail-user", "expert-continuation-turn");
      expect(requests).toHaveLength(2);
      const mailboxMessage = requests[1].find(message => message.role === "user" &&
        JSON.stringify(message).includes("SOURCE_DETAIL_UNTRUNCATED"));
      if (!mailboxMessage || mailboxMessage.role !== "user" || typeof mailboxMessage.content === "string") {
        throw new Error("Missing expert mailbox message");
      }
      const framedText = mailboxMessage.content.find(block => block.type === "text");
      if (!framedText || framedText.type !== "text") throw new Error("Missing mailbox text");
      expect(JSON.parse(framedText.text.split("\n")[2]).content).toBe(fullReport);
      expect(runtime.getStatus().planningState).toBe("awaiting_approval");
      expect(host.call).toHaveBeenLastCalledWith("plans.submit", expect.objectContaining({
        turnId: "expert-continuation-turn", markdown: expect.stringContaining("SOURCE_DETAIL_UNTRUNCATED"),
      }));
      expect(events.filter(event => event.type === "agent_end")).toHaveLength(2);
      expect(events.some(event => event.type === "error")).toBe(false);
    } finally { await runtime.dispose(); }
  });

  it.each([
    { status: "deferred", reason: "other", pendingMessagesCount: 1 },
    { ...deferred, pendingMessagesCount: 0 },
    { ...deferred, pendingMessagesCount: 1.5 },
    { ...deferred, pendingMessagesCount: "1" },
    { ...deferred, proposal: {} },
  ])("rejects malformed deferral %j through the ordinary submission error path", async result => {
    const { runtime, events } = fixture({ result });
    try {
      await runtime.prompt("Submit", "user-1", "aggregation-turn");
      expect(runtime.getStatus().planningState).toBe("planning");
      expect(events.some(event => event.type === "error" && event.error.code === "PLAN_SUBMIT_FAILED")).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", isError: true }));
    } finally { await runtime.dispose(); }
  });

  it.each([{ executionProfile: "standard" as const }, { mode: "goal" as const }])(
    "does not accept Team deferral outside Team Plan (%j)", async options => {
      const { runtime, events } = fixture(options);
      try {
        await runtime.prompt("Submit", "user-1", "aggregation-turn");
        expect(events.some(event => event.type === "error" && event.error.code === "PLAN_SUBMIT_FAILED")).toBe(true);
      } finally { await runtime.dispose(); }
    },
  );

  it("keeps Host submission failures observable instead of yielding successfully", async () => {
    const { runtime, events } = fixture({ submitError: new Error("Host disconnected") });
    try {
      await runtime.prompt("Submit", "user-1", "aggregation-turn");
      expect(events.some(event => event.type === "error" && event.error.code === "PLAN_SUBMIT_FAILED")).toBe(true);
    } finally { await runtime.dispose(); }
  });

  it.each(["cancel", "mode", "turn", "epoch"] as const)("does not accept a deferred reply after %s changes", async change => {
    let invalidate = () => {};
    const { runtime, view } = fixture({ onSubmit: () => invalidate() });
    const signal = new AbortController();
    const state = runtime as unknown as { turnId?: string; turnEpoch: number; pendingSubmissionOutcome?: unknown; terminatingToolCalls: Set<string> };
    invalidate = () => {
      if (change === "cancel") signal.abort();
      if (change === "mode") runtime.setMode("goal");
      if (change === "turn") state.turnId = "next-turn";
      if (change === "epoch") state.turnEpoch++;
    };
    try {
      const tool = view.agent.state.tools.find(entry => entry.name === "SubmitPlan");
      if (!tool) throw new Error("Missing SubmitPlan");
      await expect(tool.execute("stale-submit", args, signal.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(state.pendingSubmissionOutcome).toBeUndefined();
      expect(state.terminatingToolCalls.has("stale-submit")).toBe(false);
      expect(runtime.getStatus().planningState).not.toBe("awaiting_approval");
    } finally { await runtime.dispose(); }
  });
});
