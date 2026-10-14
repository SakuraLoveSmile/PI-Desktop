import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { provider, createRuntime } from "./runtime-test-harness.js";
import { toolResult, assistant, nextTurn } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime per-turn context protection", () => {

  it("derives the hard limit from provider-request headroom", async () => {
    const runtime = createRuntime();

    expect((runtime as any).contextBudget([])).toMatchObject({
      tokens: expect.any(Number),
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 44_800,
    });

    await runtime.dispose();
  });

  it("clamps the retained tail for a small model context window", async () => {
    const runtime = createRuntime({
      provider: {
        ...provider,
        modelConfig: {
          ...provider.modelConfig!,
          contextWindow: 32_000,
          maxTokens: 8_000,
        },
      },
    });

    expect((runtime as any).contextBudget([])).toMatchObject({
      hardLimit: 16_000,
      requestHeadroom: 16_000,
      keepRecentTokens: 8_000,
    });

    await runtime.dispose();
  });

  it("compacts a long tool loop at the soft threshold after a reminder", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const prepareNextTurn = (runtime as any).prepareNextTurn.bind(runtime);
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    vi.spyOn(runtime as any, "contextBudget")
      .mockReturnValueOnce({
        tokens: 195_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      })
      .mockReturnValueOnce({
        tokens: 198_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      })
      .mockReturnValue({
        tokens: 100_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      });
    const runCompaction = vi
      .spyOn(runtime as any, "runCompaction")
      .mockResolvedValue(true);

    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });
    const below = await prepareNextTurn(nextTurn);
    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });
    const stillBelow = await prepareNextTurn(nextTurn);
    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });

    // 29k left is inside the first reminder tier but still below the 90%
    // compaction trigger, so the model can close out before host compaction.
    expect(below.context.systemPrompt).toContain("<context_budget>");
    expect(below.context.systemPrompt).toContain("new_context");
    expect(below.context.messages.at(-1)).toMatchObject({
      role: "system",
      content: "",
      sections: { context_budget: expect.stringContaining("<context_budget>") },
    });
    expect(getCurrentSystemMessage(below.context.messages)?.sections?.context_budget).toContain("new_context");
    expect(stillBelow.context.systemPrompt).not.toContain("<context_budget>");
    // The legacy prompt baseline stays unchanged; the returned transcript
    // carries the reminder section through the normal persistence path.
    expect((runtime as any).agent.state.systemPrompt).not.toContain(
      "<context_budget>",
    );
    expect(runCompaction).not.toHaveBeenCalled();

    vi.spyOn(runtime as any, "contextBudget")
      .mockReturnValueOnce({
        tokens: 225_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      })
      .mockReturnValue({
        tokens: 40_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      });
    const hard = await prepareNextTurn(nextTurn);

    expect(hard.context.systemPrompt).not.toContain("<context_budget>");
    expect(runCompaction).toHaveBeenCalledOnce();
    expect(runCompaction).toHaveBeenCalledWith(
      "threshold",
      false,
      "active_turn",
    );
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(3);
    expect(events.some((event) => event.type === "agent_end")).toBe(false);

    await runtime.dispose();
  });

  it("keeps parent message usage provider-only and reports subagent usage on turn_end", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const settleDelegation = (runtime as any).settleDelegation.bind(runtime);

    settleDelegation(
      {
        delegationId: "del-1",
        toolCallId: "tool-1",
        agentName: "explorer",
        prompt: "sub-prompt",
        startedAt: Date.now(),
        startedEpoch: (runtime as unknown as { turnEpoch: number }).turnEpoch,
        status: "running",
        resolveCompletion: () => {},
        abort: () => {},
      },
      {
        agentName: "explorer",
        status: "completed",
        report: "subagent done",
        turns: 1,
        toolCalls: 0,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      },
    );

    (runtime as any).currentAssistant = {
      id: "asst-1",
      role: "assistant",
      content: "Hello",
      status: "streaming",
    };

    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input: 200,
          output: 80,
          totalTokens: 280,
        },
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    const endEvent = events.find((e) => e.type === "message_end");
    expect(endEvent).toBeDefined();
    expect(endEvent.message.usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
    });

    onEvent.mockClear();
    await handleAgentEvent({ type: "turn_end" });
    const turnEnd = onEvent.mock.calls
      .map(([envelope]) => (envelope as any).event)
      .find((e) => e.type === "turn_end");
    expect(turnEnd.subagentUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });

    onEvent.mockClear();
    await handleAgentEvent({ type: "turn_end" });
    const secondTurnEnd = onEvent.mock.calls
      .map(([envelope]) => (envelope as any).event)
      .find((e) => e.type === "turn_end");
    expect(secondTurnEnd.subagentUsage).toBeUndefined();

    await runtime.dispose();
  });

  it("lets the model ask for a new window, and compacts at the next boundary", async () => {
    const runtime = createRuntime();
    const tool = (runtime as any).agent.state.tools.find(
      (candidate: any) => candidate.name === "new_context",
    );

    // Codex's tool takes no arguments: the model cannot steer the checkpoint,
    // it can only ask for one.
    expect(tool).toBeDefined();
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual([]);
    const result = await tool.execute("call-1", {});
    expect(result.content[0].text).toContain("A new context window will start");
    expect((runtime as any).pendingModelCompaction).toBe(true);

    // Well under the hard limit, so only the model's request drives this.
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 10_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 44_800,
    });
    const runCompaction = vi
      .spyOn(runtime as any, "runCompaction")
      .mockResolvedValue(true);

    await (runtime as any).prepareNextTurn(nextTurn);
    expect(runCompaction).toHaveBeenCalledWith(
      "threshold",
      false,
      "active_turn",
    );
    expect((runtime as any).pendingModelCompaction).toBe(false);

    // The request is consumed, so the next boundary compacts nothing.
    await (runtime as any).prepareNextTurn(nextTurn);
    expect(runCompaction).toHaveBeenCalledOnce();

    await runtime.dispose();
  });

  it("does not fail the turn when a model-requested compaction fails", async () => {
    const runtime = createRuntime();
    (runtime as any).pendingModelCompaction = true;
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 10_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 44_800,
    });
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);

    // Nothing is over the boundary, so a failed courtesy compaction is not a
    // reason to refuse the request the way the hard-limit guard is.
    await expect(
      (runtime as any).prepareNextTurn(nextTurn),
    ).resolves.toBeDefined();
    await runtime.dispose();
  });

  it("automatically compacts at the early threshold before the final reminder", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime as any, "contextBudget")
      .mockReturnValueOnce({
        tokens: 223_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
        keepRecentTokens: 44_800,
      })
      .mockReturnValueOnce({
        tokens: 40_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
        keepRecentTokens: 44_800,
      })
      .mockReturnValue({
        tokens: 40_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
        keepRecentTokens: 44_800,
      });
    const compact = vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(true);

    const first = await (runtime as any).prepareNextTurn(nextTurn);
    await (runtime as any).prepareNextTurn(nextTurn);

    expect(compact).toHaveBeenCalledOnce();
    expect(first.context.systemPrompt).not.toContain("<context_budget>");
    await runtime.dispose();
  });
});
