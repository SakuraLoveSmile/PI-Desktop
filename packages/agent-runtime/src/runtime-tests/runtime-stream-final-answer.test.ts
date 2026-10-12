import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime assistant thinking events", () => {

  it("recovers a silent turn with one automatic re-run", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    // The observed shape: a full conclusion in reasoning, empty visible text,
    // no tool call — the turn ends and the user sees nothing.
    const silentMessage = assistantMessage({
      content: [{ type: "thinking", thinking: "the answer is provider B" }],
    });
    const recoveredMessage = assistantMessage({
      content: [{ type: "text", text: "provider B, because …" }],
    });

    let promptDuringRerun: string | undefined;
    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "which provider?", timestamp: 1 },
        silentMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: silentMessage });
      await handleAgentEvent({ type: "message_end", message: silentMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      promptDuringRerun = agent.state.systemPrompt;
      // The silent assistant must be gone: agentLoopContinue rejects a
      // transcript that ends with one.
      expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(1);
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({
        type: "message_end",
        message: recoveredMessage,
      });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("which provider?", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(promptDuringRerun).toContain("<no_output_recovery>");
    // One-shot: the nudge does not ride along on later prompts.
    expect(agent.state.systemPrompt).not.toContain("<no_output_recovery>");
    expect(events.some((event) => event.type === "error")).toBe(false);
    // One bubble, and the user never sees the empty turn it replaced.
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "message_end" && event.message?.status === "complete",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("agent_end");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "provider B, because …",
        }),
      }),
    );

    await runtime.dispose();
  });

  it("reports an empty response when the re-run stays silent", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const silentMessage = assistantMessage({ content: [] });

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "continue", timestamp: 1 },
        silentMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: silentMessage });
      await handleAgentEvent({ type: "message_end", message: silentMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: silentMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("continue", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    // Exactly one re-run, then the failure becomes visible instead of looping.
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "error",
          isError: true,
          error: expect.objectContaining({
            code: "EMPTY_MODEL_RESPONSE",
            retriable: true,
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "EMPTY_MODEL_RESPONSE" }),
      }),
    );
    // An assistant message with nothing in it is not worth resending.
    expect((runtime as any).fullEntries).toHaveLength(0);

    await runtime.dispose();
  });

  it("treats a tool-calling turn with no text as normal work", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const toolTurn = assistantMessage({
      content: [
        { type: "toolCall", id: "call-1", name: "Read", arguments: {} },
      ],
      stopReason: "toolUse",
    });

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "read it", timestamp: 1 },
        toolTurn,
      ];
      await handleAgentEvent({ type: "message_start", message: toolTurn });
      await handleAgentEvent({ type: "message_end", message: toolTurn });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => undefined);

    await runtime.prompt("read it", "user-1");

    expect(agent.continue).not.toHaveBeenCalled();
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({ status: "complete" }),
      }),
    );

    await runtime.dispose();
  });

  it("does not restore failed assistant details into model context", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "failed-1",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "error",
          isError: true,
          error: {
            code: "PROVIDER_ERROR",
            message: "upstream detail",
            retriable: true,
          },
        },
      ],
    });

    expect((runtime as any).agent.state.messages.filter((message: any) => message.role !== "system")).toEqual([]);
    await runtime.dispose();
  });

  it("creates an assistant error message when a prompt rejects before streaming", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const error = {
      code: "NETWORK_ERROR",
      message: "fetch failed",
      retriable: true,
    };

    (runtime as any).finalizeCurrentAssistant("error", error);

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-2)?.event).toMatchObject({
      type: "message_start",
      message: { role: "assistant", status: "error", error },
    });
    expect(events.at(-1)?.event).toMatchObject({
      type: "message_end",
      message: { role: "assistant", status: "error", error },
    });
    await runtime.dispose();
  });

  it("keeps timing and an output estimate when a streamed answer is aborted", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    (runtime as any).streamStartedAt = Date.now() - 2_000;
    (runtime as any).currentAssistant = {
      id: "assistant-aborted",
      role: "assistant",
      content: "A partial answer that remains visible",
      thinking: "Brief reasoning",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    (runtime as any).finalizeCurrentAssistant("aborted");

    const terminal = onEvent.mock.calls.at(-1)?.[0] as any;
    expect(terminal.event).toMatchObject({
      type: "message_end",
      message: {
        status: "aborted",
        responseDurationMs: expect.any(Number),
        responseOutputTokens: expect.any(Number),
      },
    });
    expect(terminal.event.message.responseDurationMs).toBeGreaterThanOrEqual(2_000);
    expect(terminal.event.message.responseOutputTokens).toBeGreaterThan(0);
    await runtime.dispose();
  });
});
