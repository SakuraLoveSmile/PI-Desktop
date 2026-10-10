import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type PlanExecution } from "@pi-desktop/shared";
import { estimateOutputCapInputTokens } from "../output-cap.js";
import { type AgentMessage } from "@earendil-works/pi-agent-core";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime plan transitions", () => {

  it("executes an approved plan in the same runtime without a visible user event", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const originalAgent = agent;
    agent.continue = vi.fn(async () => undefined);
    agent.waitForIdle = vi.fn(async () => undefined);
    runtime.setMode("plan");
    (runtime as any).appendLiveEntry("planning-only", {
      role: "user",
      content: "Planning-only detail must not enter execution context",
      timestamp: 1,
    });

    const execution: PlanExecution = {
      id: "execution-1",
      proposalId: "proposal-1",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nUse the exact snapshot.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-1.md",
        sha256: "abc123",
        sizeBytes: 31,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    const result = await runtime.executeApprovedPlan(execution, "execution-turn-1");

    expect(result).toEqual({ turnId: "execution-turn-1" });
    expect((runtime as any).agent).toBe(originalAgent);
    expect(runtime.getMode()).toBe("agent");
    expect(runtime.getStatus().planningState).toBe("inactive");
    expect(agent.continue).toHaveBeenCalledOnce();
    const internal = (runtime as any).fullEntries.at(-1).message;
    expect(internal.role).toBe("user");
    expect(internal.content).toContain(execution.artifact.relativePath);
    expect(internal.content).toContain(execution.plan);
    expect(JSON.stringify(agent.state.messages)).not.toContain("Planning-only detail");
    expect(
      onEvent.mock.calls.some(
        ([envelope]) => (envelope as any).event?.message?.role === "user",
      ),
    ).toBe(false);

    await runtime.dispose();
  });

  it("counts request system prompt and tools once despite system transcript rows", async () => {
    const runtime = createRuntime();
    const internal = runtime as any;
    const agent = internal.agent;
    const messages: any[] = agent.state.messages;
    const requestMessages = messages.filter(
      (message) => message.role !== "system" && "content" in message,
    );
    const budget = internal.contextBudget(messages);
    const requestEstimate = estimateOutputCapInputTokens(
      {
        messages: requestMessages,
        systemPrompt: agent.state.systemPrompt,
        tools: internal.activeTools(),
      },
      internal.model,
    );
    const duplicatedEstimate = estimateOutputCapInputTokens(
      {
        messages: messages.filter((message) => "content" in message),
        systemPrompt: agent.state.systemPrompt,
        tools: internal.activeTools(),
      },
      internal.model,
    );

    expect(messages.some((message) => message.role === "system")).toBe(true);
    expect(agent.state.systemPrompt.length).toBeGreaterThan(0);
    expect(internal.activeTools().length).toBeGreaterThan(0);
    expect(duplicatedEstimate).toBeGreaterThan(requestEstimate);
    expect(budget.tokens).toBeGreaterThanOrEqual(requestEstimate);
    expect(budget.tokens).toBeLessThan(duplicatedEstimate);

    await runtime.dispose();
  });

  it("does not continue an approved plan when preflight cannot clear hardLimit", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const internal = runtime as any;
    const agent = internal.agent;
    agent.continue = vi.fn(async () => undefined);
    vi.spyOn(internal, "automaticCompactionNeeded").mockReturnValue(true);
    vi.spyOn(internal, "automaticCompactionWouldExceedHardLimit").mockReturnValue(true);
    const runCompaction = vi.spyOn(internal, "runCompaction").mockResolvedValue(false);
    const execution: PlanExecution = {
      id: "oversized-plan",
      proposalId: "proposal-oversized",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Very large approved snapshot",
      title: "Oversized plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-oversized.md",
        sha256: "abc123",
        sizeBytes: 31,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-oversized");

    expect(runCompaction).toHaveBeenCalledWith(
      "threshold",
      false,
      "active_turn",
    );
    expect((runtime as any).fullEntries.at(-1).message.content).toContain(
      execution.plan,
    );
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
      }),
    );
    await runtime.dispose();
  });

  it("re-runs a silent turn during approved plan execution", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    // The shape that ended a real plan execution: a conclusion written into
    // reasoning, empty visible text, no tool call. Recovery is armed inside
    // `message_end`, so an entry point that never acts on it leaves the run
    // with no `turn_end`, no `agent_end`, and nothing for the user to retry.
    const silentMessage = assistantMessage({
      content: [{ type: "thinking", thinking: "the plan is already done" }],
    });
    const recoveredMessage = assistantMessage({
      content: [{ type: "text", text: "Implemented the approved plan." }],
    });

    let attempts = 0;
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        agent.state.messages = [
          { role: "user", content: "execute the approved plan", timestamp: 1 },
          silentMessage,
        ];
      } else {
        // The silent assistant is popped before the re-run, and the nudge is
        // on the prompt that re-run actually sends.
        expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(1);
        expect(agent.state.systemPrompt).toContain("<no_output_recovery>");
      }
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({
        type: "message_end",
        message: attempts === 1 ? silentMessage : recoveredMessage,
      });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    const execution: PlanExecution = {
      id: "execution-silent",
      proposalId: "proposal-silent",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nDo the work.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-silent.md",
        sha256: "abc123",
        sizeBytes: 24,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-silent");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledTimes(2);
    // The run closes exactly once, carrying the recovered text; the empty turn
    // leaves neither a bubble nor an error row behind.
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("agent_end");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(
      events.filter(
        (event) =>
          event.type === "message_end" && event.message?.status === "complete",
      ),
    ).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "Implemented the approved plan.",
        }),
      }),
    );
    // One-shot: the nudge does not ride along on later turns.
    expect(agent.state.systemPrompt).not.toContain("<no_output_recovery>");

    await runtime.dispose();
  });

  it("re-runs a progress-only turn once during approved plan execution", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const progressMessage = assistantMessage({
      content: [
        { type: "text", text: "Staged YAML complete. Writing Owner Note now." },
      ],
    });
    const recoveredMessage = assistantMessage({
      content: [{ type: "text", text: "Implemented the approved plan." }],
    });

    let attempts = 0;
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        agent.state.messages = [
          { role: "user", content: "execute the approved plan", timestamp: 1 },
          progressMessage,
        ];
      } else {
        // The progress assistant is visible in the reused bubble but must be
        // removed before continue() rebuilds the model context.
        expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(1);
        expect(agent.state.messages.filter((message: AgentMessage) => message.role !== "system").at(-1)?.role).toBe("user");
        expect(agent.state.systemPrompt).toContain("<progress_only_recovery>");
      }
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({
        type: "message_end",
        message: attempts === 1 ? progressMessage : recoveredMessage,
      });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    const execution: PlanExecution = {
      id: "execution-progress",
      proposalId: "proposal-progress",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nDo the work.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-progress.md",
        sha256: "abc123",
        sizeBytes: 24,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-progress");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "agent_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(
      events.filter((event) => event.type === "message_update")[1]?.message
        ?.content,
    ).toBe("Staged YAML complete. Writing Owner Note now.");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "Implemented the approved plan.",
        }),
      }),
    );
    expect(agent.state.systemPrompt).not.toContain("<progress_only_recovery>");
    expect((runtime as any).progressTurnRerunInProgress).toBe(false);
    expect((runtime as any).pendingProgressTurnRerun).toBe(false);

    await runtime.dispose();
  });

  it("chains silent recovery after a progress-only turn", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const progressMessage = assistantMessage({
      content: [{ type: "text", text: "Writing the remaining note." }],
    });
    const silentMessage = assistantMessage({
      content: [{ type: "thinking", thinking: "the work is complete" }],
    });
    const finalMessage = assistantMessage({
      content: [{ type: "text", text: "Implemented the approved plan." }],
    });

    let attempts = 0;
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        agent.state.messages = [
          { role: "user", content: "execute the approved plan", timestamp: 1 },
        ];
      } else {
        expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(1);
        expect(agent.state.messages.filter((message: AgentMessage) => message.role !== "system").at(-1)?.role).toBe("user");
        expect(agent.state.systemPrompt).toContain(
          attempts === 2 ? "<progress_only_recovery>" : "<no_output_recovery>",
        );
      }
      const message =
        attempts === 1 ? progressMessage : attempts === 2 ? silentMessage : finalMessage;
      agent.state.messages = [...agent.state.messages, message];
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    const execution: PlanExecution = {
      id: "execution-progress-silent",
      proposalId: "proposal-progress-silent",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nDo the work.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-progress-silent.md",
        sha256: "abc123",
        sizeBytes: 24,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-progress-silent");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event.type === "agent_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "Implemented the approved plan.",
        }),
      }),
    );
    expect(agent.state.systemPrompt).not.toContain("<progress_only_recovery>");
    expect(agent.state.systemPrompt).not.toContain("<no_output_recovery>");

    await runtime.dispose();
  });

  it("does not re-run a normal approved plan final report", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const finalMessage = assistantMessage({
      content: [{ type: "text", text: "Implemented the approved plan." }],
    });

    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "execute the approved plan", timestamp: 1 },
        finalMessage,
      ];
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: finalMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    const execution: PlanExecution = {
      id: "execution-final",
      proposalId: "proposal-final",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nDo the work.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-final.md",
        sha256: "abc123",
        sizeBytes: 24,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-final");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
    expect(agent.state.systemPrompt).not.toContain("<progress_only_recovery>");

    await runtime.dispose();
  });

  it("starts each approved plan execution from clean recovery state", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    // A run-end suppression left over from a previous turn would swallow this
    // execution's own `turn_end` and `agent_end`, ending it invisibly.
    (runtime as any).suppressSilentTurnRunEnd = true;
    (runtime as any).silentTurnRerunAttempted = true;
    (runtime as any).pendingSilentTurnRerun = true;
    (runtime as any).suppressProgressTurnRunEnd = true;
    (runtime as any).progressTurnRerunAttempted = true;
    (runtime as any).pendingProgressTurnRerun = true;
    (runtime as any).progressTurnRerunInProgress = true;
    agent.continue = vi.fn(async () => undefined);
    agent.waitForIdle = vi.fn(async () => undefined);

    const execution: PlanExecution = {
      id: "execution-clean",
      proposalId: "proposal-clean",
      sessionId: "session-1",
      kind: "plan",
      plan: "# Approved\n\nDo the work.",
      title: "Approved plan",
      question: "Proceed?",
      artifact: {
        relativePath: ".pi/plan/proposal-clean.md",
        sha256: "abc123",
        sizeBytes: 24,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-clean");

    expect((runtime as any).suppressSilentTurnRunEnd).toBe(false);
    expect((runtime as any).silentTurnRerunAttempted).toBe(false);
    expect((runtime as any).pendingSilentTurnRerun).toBe(false);
    expect((runtime as any).suppressProgressTurnRunEnd).toBe(false);
    expect((runtime as any).progressTurnRerunAttempted).toBe(false);
    expect((runtime as any).pendingProgressTurnRerun).toBe(false);
    expect((runtime as any).progressTurnRerunInProgress).toBe(false);

    await runtime.dispose();
  });

  it("tells an approved goal execution to verify every acceptance criterion", async () => {
    const runtime = createRuntime({ mode: "goal" });
    const agent = (runtime as any).agent;
    agent.continue = vi.fn(async () => undefined);
    agent.waitForIdle = vi.fn(async () => undefined);

    const execution: PlanExecution = {
      id: "execution-goal-1",
      proposalId: "proposal-goal-1",
      sessionId: "session-1",
      kind: "goal",
      plan: "# Goal\n\nCheckout works.\n\n## Acceptance criteria\n- tests pass\n",
      title: "Checkout works",
      question: "Approve this goal?",
      artifact: {
        relativePath: ".pi/goal/proposal-goal-1.md",
        sha256: "def456",
        sizeBytes: 42,
      },
      targetPermissionMode: "auto",
      state: "running",
    };

    await runtime.executeApprovedPlan(execution, "execution-turn-2");

    expect(runtime.getMode()).toBe("agent");
    const internal = (runtime as any).fullEntries.at(-1).message;
    expect(internal.content).toContain("<approved-goal-markdown>");
    expect(internal.content).toContain(execution.artifact.relativePath);
    expect(internal.content).toContain("verify every acceptance criterion");
    expect(internal.content).not.toContain("Execute the approved implementation plan");

    await runtime.dispose();
  });
});
