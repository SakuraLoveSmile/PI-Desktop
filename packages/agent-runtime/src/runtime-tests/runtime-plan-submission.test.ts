import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type AgentMessage, type Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime plan transitions", () => {

  it.each(["plan", "goal"] as const)(
    "continues the %s user turn after a missing-workspace submission",
    async (kind) => {
      const host = {
        call: vi.fn(async (method: string) => {
          if (method === "plans.submit") {
            throw Object.assign(new Error("PLAN_WORKSPACE_REQUIRED"), {
              data: { errorCode: "PLAN_WORKSPACE_REQUIRED" },
            });
          }
          return undefined;
        }),
      };
      const runtime = createRuntime({ host, mode: kind });
      const requests: AgentMessage[][] = [];
      const internals = runtime as unknown as {
        agent: Agent;
        models: {
          streamSimple: (
            model: unknown,
            context: { messages: AgentMessage[] },
          ) => ReturnType<typeof createAssistantMessageEventStream>;
        };
      };
      internals.models = {
        streamSimple: (_model, context) => {
          requests.push([...context.messages]);
          const submit = requests.length % 2 === 1;
          const message = assistantMessage({
            content: submit
              ? [
                  {
                    type: "toolCall",
                    id: `submit-${requests.length}`,
                    name: kind === "plan" ? "SubmitPlan" : "SubmitGoal",
                    arguments: {
                      title: "Proposal",
                      markdown: "# Proposal",
                      question: "Proceed?",
                    },
                  },
                ]
              : [
                  {
                    type: "text",
                    text: "Bind a project workspace before submitting. Here is the proposal.",
                  },
                ],
            stopReason: submit ? "toolUse" : "stop",
          }) as unknown as AssistantMessage;
          const stream = createAssistantMessageEventStream();
          queueMicrotask(() => {
            stream.push({ type: "start", partial: message });
            stream.push({
              type: "done",
              reason: submit ? "toolUse" : "stop",
              message,
            });
            stream.end(message);
          });
          return stream;
        },
      };
      try {
        await runtime.prompt(
          "Propose the work before changing anything.",
          "user-1",
          "turn-1",
        );
        expect(requests).toHaveLength(2);
        const result = requests[1].find(
          (message) => message.role === "toolResult",
        );
        expect(result).toMatchObject({ isError: true, toolCallId: "submit-1" });
        expect(JSON.stringify(result)).toContain(
          "Bind this session to a project workspace",
        );
        expect(internals.agent.state.messages.at(-1)).toMatchObject({
          role: "assistant",
          content: [
            {
              type: "text",
              text: expect.stringContaining("Here is the proposal"),
            },
          ],
        });
        expect(runtime.getStatus().planningState).toBe("planning");
        await runtime.prompt("Continue.", "user-2", "turn-2");
        expect(requests).toHaveLength(4);
        expect(internals.agent.state.messages.at(-1)).toMatchObject({
          role: "assistant",
        });
      } finally {
        await runtime.dispose();
      }
    },
  );

  it.each(["PLAN_ARTIFACT_WRITE_FAILED", "PLAN_SESSION_NOT_FOUND"])(
    "still terminates submission for %s",
    async (errorCode) => {
      const host = { call: vi.fn().mockRejectedValue({ data: { errorCode } }) };
      const runtime = createRuntime({ host, mode: "plan", turnId: "turn-1" });
      const { agent } = runtime as unknown as { agent: Agent };
      try {
        const tool = agent.state.tools.find(
          (entry) => entry.name === "SubmitPlan",
        );
        if (!tool) throw new Error("Missing submit tool");
        const result = await tool.execute("submit", {
          title: "Plan",
          markdown: "# Plan",
          question: "Proceed?",
        });
        expect(result).toMatchObject({
          isError: true,
          terminate: true,
          details: { errorCode },
        });
        expect(runtime.getStatus().planningState).toBe("planning");
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("guards transition batches and terminates after durable plan submission", async () => {
    const host = { call: vi.fn() };
    const runtime = createRuntime({ host, turnId: "turn-1" });
    const agent = (runtime as any).agent;
    const beforeToolCall = agent.beforeToolCall as Function;

    const mixedBatch = {
      assistantMessage: {
        content: [
          { type: "toolCall", id: "enter-call", name: "EnterPlanMode", arguments: {} },
          { type: "toolCall", id: "read-call", name: "Read", arguments: { path: "a.txt" } },
        ],
      },
      toolCall: { id: "enter-call", name: "EnterPlanMode", arguments: {} },
      args: {},
      context: {},
    };
    await expect(beforeToolCall(mixedBatch)).resolves.toMatchObject({ block: true });

    host.call.mockResolvedValueOnce({ ok: true, state: "planning" });
    const enterTool = agent.state.tools.find((tool: any) => tool.name === "EnterPlanMode");
    const enterResult = await enterTool.execute("enter-call", {});
    expect(enterResult.terminate).toBeUndefined();
    expect(runtime.getMode()).toBe("plan");
    expect(agent.state.tools.map((tool: any) => tool.name)).toContain("SubmitPlan");
    expect(host.call).toHaveBeenNthCalledWith(1, "plans.enter", {
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "enter-call",
      kind: "plan",
    });

    const exactMarkdown = "  # Implement it\n\n1. Make the change.  \n";
    const proposal = {
      id: "proposal-1",
      sessionId: "session-1",
      turnId: "durable-turn-1",
      toolCallId: "submit-call-1",
      kind: "plan",
      title: "Implement it",
      markdown: exactMarkdown,
      plan: exactMarkdown,
      question: "Approve implementation?",
      artifact: {
        relativePath: ".pi/plan/proposal-1.md",
        sha256: "abc123",
        sizeBytes: 31,
      },
      version: 1,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    host.call.mockResolvedValueOnce({ status: "pending", proposal });
    const submitTool = agent.state.tools.find((tool: any) => tool.name === "SubmitPlan");
    expect(submitTool.description).toContain("immutable historical checkpoints");
    expect(submitTool.description).toContain("new full snapshot in this turn");
    expect(submitTool.parameters.properties.question.description).toContain("Summarize the complete contract yourself");
    expect(submitTool.parameters.properties.title.description).toContain("user's language");
    const submitResult = await submitTool.execute("submit-call-1", {
      title: proposal.title,
      markdown: proposal.markdown,
      question: proposal.question,
    });
    expect(submitResult.terminate).toBe(true);
    await expect(agent.afterToolCall({
      toolCall: { id: "submit-call-1", name: "SubmitPlan", arguments: {} },
      args: {},
      result: submitResult,
      isError: false,
    })).resolves.toEqual({ terminate: true });
    expect(runtime.getMode()).toBe("plan");
    expect(runtime.getStatus().planningState).toBe("awaiting_approval");
    expect(agent.state.tools.map((tool: any) => tool.name)).toContain("SubmitPlan");
    expect(host.call).toHaveBeenLastCalledWith(
      "plans.submit",
      expect.objectContaining({
        sessionId: "session-1",
        toolCallId: "submit-call-1",
        kind: "plan",
        title: proposal.title,
        markdown: proposal.markdown,
        question: proposal.question,
      }),
    );
    expect(host.call).toHaveBeenCalledTimes(2);

    await runtime.dispose();
  });

  it("routes the Goal contract through the same host approval with kind goal", async () => {
    const host = { call: vi.fn() };
    const runtime = createRuntime({ host, turnId: "turn-1" });
    const agent = (runtime as any).agent;

    host.call.mockResolvedValueOnce({ ok: true, state: "planning" });
    const enterTool = agent.state.tools.find(
      (tool: any) => tool.name === "EnterGoalMode",
    );
    await enterTool.execute("enter-goal-call", {});
    expect(runtime.getMode()).toBe("goal");
    expect(host.call).toHaveBeenNthCalledWith(1, "plans.enter", {
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "enter-goal-call",
      kind: "goal",
    });

    const markdown = "# Goal\n\nCheckout works.\n\n## Acceptance criteria\n- tests pass\n";
    const proposal = {
      id: "proposal-goal-1",
      sessionId: "session-1",
      turnId: "durable-turn-1",
      toolCallId: "submit-goal-call",
      kind: "goal",
      title: "Checkout works",
      markdown,
      plan: markdown,
      question: "Approve this goal?",
      artifact: {
        relativePath: ".pi/goal/proposal-goal-1.md",
        sha256: "def456",
        sizeBytes: 42,
      },
      version: 1,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    host.call.mockResolvedValueOnce({ status: "pending", proposal });
    const submitTool = agent.state.tools.find(
      (tool: any) => tool.name === "SubmitGoal",
    );
    expect(submitTool.description).toContain("acceptance criteria");
    const submitResult = await submitTool.execute("submit-goal-call", {
      title: proposal.title,
      markdown: proposal.markdown,
      question: proposal.question,
    });

    expect(submitResult.terminate).toBe(true);
    await expect(agent.afterToolCall({
      toolCall: { id: "submit-goal-call", name: "SubmitGoal", arguments: {} },
      args: {},
      result: submitResult,
      isError: false,
    })).resolves.toEqual({ terminate: true });
    expect(runtime.getMode()).toBe("goal");
    expect(runtime.getStatus().planningState).toBe("awaiting_approval");
    expect(host.call).toHaveBeenLastCalledWith(
      "plans.submit",
      expect.objectContaining({
        sessionId: "session-1",
        toolCallId: "submit-goal-call",
        kind: "goal",
        markdown: proposal.markdown,
      }),
    );

    await runtime.dispose();
  });

  it.each([
    ["plan", "SubmitPlan"],
    ["goal", "SubmitGoal"],
  ] as const)("marks a rejected %s submission as a tool error in pi", async (kind, toolName) => {
    const host = { call: vi.fn() };
    const runtime = createRuntime({ host, mode: kind });
    const agent = (runtime as any).agent;
    const submitTool = agent.state.tools.find((tool: any) => tool.name === toolName);
    host.call.mockResolvedValueOnce({ isError: true, terminate: true, errorCode: "PLAN_WORKSPACE_REQUIRED" });

    const result = await submitTool.execute(`submit-${kind}`, {
      title: "Temporary goal",
      markdown: "# Goal\n\n## Acceptance criteria\n- works",
      question: "Approve?",
    });
    expect(result).toMatchObject({ isError: true, terminate: true });

    await expect(agent.afterToolCall({
      toolCall: { id: `submit-${kind}`, name: toolName, arguments: {} },
      args: {},
      result,
      isError: false,
    })).resolves.toMatchObject({ isError: true, terminate: true });

    await runtime.dispose();
  });

  it.each([
    ["plan", "SubmitPlan"],
    ["goal", "SubmitGoal"],
  ] as const)(
    "emits structured error before agent_end and ends turn when %s submission fails",
    async (kind, toolName) => {
      const onEvent = vi.fn();
      const host = { call: vi.fn() };
      const runtime = createRuntime({ host, mode: kind, onEvent });
      const agent = (runtime as any).agent;
      const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
      const submitTool = agent.state.tools.find((tool: any) => tool.name === toolName);

      // A missing workspace is a recoverable tool error, so a fatal rejection
      // needs another host code.
      host.call.mockRejectedValueOnce({
        data: { errorCode: "PLAN_SUBMIT_FAILED" },
      });

      const submitResult = await submitTool.execute(`submit-${kind}`, {
        title: "Test contract",
        markdown: "# Test contract\n\n## Acceptance criteria\n- ok",
        question: "Approve?",
      });
      expect(submitResult.isError).toBe(true);
      expect(submitResult.terminate).toBe(true);

      const turnDecision = await agent.finishTurn({
        message: { role: "assistant", content: [], stopReason: "toolUse" },
      });
      expect(turnDecision).toEqual({ action: "end" });

      // In agent_end, fatal submission emits error event before agent_end event
      await handleAgentEvent({ type: "agent_end", messages: [] });

      const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
      const errorIdx = events.findIndex((e) => e.type === "error");
      const agentEndIdx = events.findIndex((e) => e.type === "agent_end");

      expect(errorIdx).toBeGreaterThanOrEqual(0);
      expect(agentEndIdx).toBeGreaterThan(errorIdx);
      expect(events[errorIdx].error.code).toBe("PLAN_SUBMIT_FAILED");

      await runtime.dispose();
    },
  );

  it("terminates turn on submission and retains steering without consuming it", async () => {
    const onEvent = vi.fn();
    const host = { call: vi.fn() };
    const runtime = createRuntime({ host, mode: "goal", onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const submitTool = agent.state.tools.find((tool: any) => tool.name === "SubmitGoal");

    const proposal = {
      id: "proposal-goal-steer",
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "submit-goal-steer",
      kind: "goal",
      title: "Goal with steering",
      markdown: "# Goal",
      question: "Approve?",
      artifact: {
        relativePath: ".pi/goal/proposal.md",
        sha256: "hash1",
        sizeBytes: 10,
        workspaceKind: "scratch",
      },
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (runtime as any).turnId = "turn-1";
    (runtime as any).acceptingSteering = true;
    (runtime as any).turnEpoch = 1;
    (runtime as any).agent.state.isStreaming = true;
    host.call.mockImplementationOnce(async () => {
      runtime.steer(
        { text: "user steering while submitting" },
        "turn-1",
        { id: "ui-steering-1", role: "user", content: "user steering while submitting", createdAt: new Date().toISOString() } as any,
      );
      return { status: "pending", proposal };
    });

    await submitTool.execute("submit-goal-steer", {
      title: proposal.title,
      markdown: proposal.markdown,
      question: proposal.question,
    });
    // finishTurn must end the turn regardless of pending steering
    const turnDecision = await agent.finishTurn({
      message: { role: "assistant", content: [], stopReason: "toolUse" },
    });
    expect(turnDecision).toEqual({ action: "end" });

    // agent_end should retain steering and terminate cleanly
    await handleAgentEvent({ type: "agent_end", messages: [] });

    expect(runtime.getStatus().planningState).toBe("awaiting_approval");
    expect((runtime as any).acceptingSteering).toBe(false);
    expect((runtime as any).pendingSteering.size).toBe(0);

    await runtime.dispose();
  });

  it("prevents extensions from clearing isError or terminate on SubmitPlan and SubmitGoal", async () => {
    const host = { call: vi.fn() };
    const extensionRunner = {
      hasHandlers: vi.fn((type: string) => type === "tool_result"),
      emit: vi.fn(async (_type: string, _payload: any) => ({
        isError: false,
        terminate: false,
      })),
      dispose: vi.fn(),
    };
    const runtime = createRuntime({ host, mode: "plan" });
    (runtime as any).extensionRunner = extensionRunner;
    const agent = (runtime as any).agent;
    const submitTool = agent.state.tools.find((tool: any) => tool.name === "SubmitPlan");

    host.call.mockRejectedValueOnce({
      data: { errorCode: "PLAN_SUBMIT_FAILED" },
    });

    const submitResult = await submitTool.execute("submit-plan-override", {
      title: "Plan title",
      markdown: "# Plan",
      question: "Approve?",
    });

    const afterResult = await agent.afterToolCall({
      toolCall: { id: "submit-plan-override", name: "SubmitPlan", arguments: {} },
      args: {},
      result: submitResult,
      isError: true,
    });

    // Even though extension tried to clear isError and terminate, they remain true
    expect(afterResult.isError).toBe(true);
    expect(afterResult.terminate).toBe(true);

    await runtime.dispose();
  });

  it("clears turn-scoped submission outcome on new turn recovery reset", async () => {
    const host = { call: vi.fn() };
    const runtime = createRuntime({ host, mode: "goal" });
    const agent = (runtime as any).agent;
    const submitTool = agent.state.tools.find((tool: any) => tool.name === "SubmitGoal");

    host.call.mockRejectedValueOnce({
      data: { errorCode: "PLAN_SUBMIT_FAILED" },
    });

    await submitTool.execute("submit-fail", {
      title: "Fail goal",
      markdown: "# Fail",
      question: "Approve?",
    });

    expect((runtime as any).pendingSubmissionOutcome).toBeDefined();

    // Reset recovery state for the next turn
    (runtime as any).resetRunRecoveryState();

    expect((runtime as any).pendingSubmissionOutcome).toBeUndefined();

    // finishTurn on the new turn does not end automatically
    const decision = await agent.finishTurn({
      message: { role: "assistant", content: [], stopReason: "stop" },
    });
    expect(decision).toBeUndefined();

    await runtime.dispose();
  });

  it("blocks a submit tool that does not belong to the active contract mode", async () => {
    const runtime = createRuntime({ mode: "goal" });
    const beforeToolCall = (runtime as any).agent.beforeToolCall as Function;

    await expect(
      beforeToolCall({
        assistantMessage: {
          content: [
            { type: "toolCall", id: "s1", name: "SubmitPlan", arguments: {} },
          ],
        },
        toolCall: { id: "s1", name: "SubmitPlan", arguments: {} },
        args: {},
        context: {},
      }),
    ).resolves.toMatchObject({
      block: true,
      reason: "SubmitPlan is available only in Plan mode.",
    });

    await expect(
      beforeToolCall({
        assistantMessage: {
          content: [
            { type: "toolCall", id: "e1", name: "EnterGoalMode", arguments: {} },
          ],
        },
        toolCall: { id: "e1", name: "EnterGoalMode", arguments: {} },
        args: {},
        context: {},
      }),
    ).resolves.toMatchObject({ block: true });

    await runtime.dispose();
  });
});
