import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime assistant thinking events", () => {

  it("normalizes thinking blocks and emits independent thinking deltas", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "plan " }],
      },
    });
    await handleAgentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan done" },
          { type: "text", text: "answer" },
        ],
      },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan done" },
          { type: "text", text: "answer" },
        ],
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events[0].event.message.thinking).toBe("plan ");
    expect(events[1].event.deltaText).toBe("answer");
    expect(events[1].event.deltaThinking).toBe("done");
    expect(events[1].event.stream).toBe("delta");
    expect(events[1].event.message.content).toBe("");
    expect(events[1].event.message.thinking).toBeUndefined();
    expect(events[2].event.message).toMatchObject({
      content: "answer",
      thinking: "plan done",
      status: "complete",
    });

    await runtime.dispose();
  });

  it("keeps recoverable overflow streaming while compaction is pending", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage:
          "400: prompt is too long: 1077172 tokens > 1000000 maximum (Service: BedrockRuntime)",
      },
    });
    await handleAgentEvent({ type: "turn_end" });
    await handleAgentEvent({ type: "agent_end", messages: [] });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    const messageUpdates = events.filter((event) => event.type === "message_update");
    expect(messageUpdates).toHaveLength(1);
    expect(messageUpdates[0].message).toMatchObject({ status: "streaming" });
    expect(messageUpdates[0].message.error).toBeUndefined();
    expect(events.some((event) => event.type === "message_end")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "agent_end")).toBe(false);
    expect((runtime as any).pendingOverflow).toBe(true);

    await runtime.dispose();
  });

  it.each([false, true])("reuses one assistant bubble across overflow recovery (trailing system update: %s)", async (trailingSystem) => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const user = { role: "user", content: "hello", timestamp: 1 };
    const failed = {
      ...assistantMessage({
        content: [{ type: "text", text: "partial response" }],
        stopReason: "error",
      }),
      errorMessage: "400: prompt is too long: 1077172 tokens > 1000000 maximum",
      timestamp: 2,
    };
    const recovered = assistantMessage({
      content: [{ type: "text", text: "recovered response" }],
      stopReason: "stop",
    });

    const systemUpdate = { role: "system", content: "", timestamp: 3, sections: { context_budget: null } };
    agent.prompt = vi.fn(async () => {
      agent.state.messages = [user, failed, ...(trailingSystem ? [systemUpdate] : [])];
      await handleAgentEvent({ type: "message_start", message: failed });
      await handleAgentEvent({ type: "message_end", message: failed });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    (runtime as any).runCompaction = vi.fn(async () => true);
    agent.continue = vi.fn(async () => {
      expect((runtime as any).overflowRecoveryInProgress).toBe(true);
      expect(agent.state.messages.filter((message: any) => message.role !== "system")).toEqual([user]);
      if (trailingSystem) expect(agent.state.messages).toContain(systemUpdate);
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: recovered });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("hello", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    const messageEvents = events.filter((event) =>
      ["message_start", "message_update", "message_end"].includes(event.type),
    );
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(new Set(messageEvents.map((event) => event.message.id)).size).toBe(1);
    expect(events.filter((event) => event.type === "message_end")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "recovered response",
        }),
      }),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);

    await runtime.dispose();
  });

  it("surfaces a terminal error when the overflow retry also exceeds the context", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const user = { role: "user", content: "hello", timestamp: 1 };
    const overflowMessage = (timestamp: number) => ({
      ...assistantMessage({ content: [], stopReason: "error" }),
      errorMessage: "400: prompt is too long: 1077172 tokens > 1000000 maximum",
      timestamp,
    });

    agent.prompt = vi.fn(async () => {
      const failed = overflowMessage(2);
      agent.state.messages = [user, failed];
      await handleAgentEvent({ type: "message_start", message: failed });
      await handleAgentEvent({ type: "message_end", message: failed });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    (runtime as any).runCompaction = vi.fn(async () => true);
    agent.continue = vi.fn(async () => {
      const failed = overflowMessage(3);
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: failed });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("hello", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message_end")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "error",
          error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
      }),
    );

    await runtime.dispose();
  });

  it("does not recover provider overflow when automatic compaction is disabled", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({
      onEvent,
      compactionSettings: {
        enabled: false,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage:
          "400: prompt is too long: 1077172 tokens > 1000000 maximum",
      },
    });

    expect((runtime as any).pendingOverflow).toBe(false);
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
      }),
    );
    await runtime.dispose();
  });

  it("removes the failed overflow assistant before compacting and retries once", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const user = { role: "user", content: "hello", timestamp: 1 };
    const failed = {
      role: "assistant",
      content: [],
      stopReason: "error",
      timestamp: 2,
    };
    agent.prompt = vi.fn(async () => {
      agent.state.messages = [user, failed];
      (runtime as any).pendingOverflow = true;
      (runtime as any).suppressOverflowRunEnd = true;
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => undefined);
    (runtime as any).automaticCompactionNeeded = vi.fn(() => false);
    (runtime as any).runCompaction = vi.fn(async () => {
      expect(agent.state.messages.filter((message: any) => message.role !== "system")).toEqual([user]);
      return true;
    });

    await runtime.prompt("hello", "user-1");

    expect((runtime as any).runCompaction).toHaveBeenCalledOnce();
    expect((runtime as any).runCompaction).toHaveBeenCalledWith(
      "overflow",
      true,
      "active_turn",
    );
    expect(agent.continue).toHaveBeenCalledOnce();
    expect((runtime as any).overflowRecoveryAttempted).toBe(true);
    await runtime.dispose();
  });
});
