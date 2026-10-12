import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { classifyAgentError } from "../agent-errors.js";
import {
  PROVIDER_TRANSIENT_MAX_RETRIES,
  PROVIDER_RATE_LIMIT_MAX_RETRIES,
} from "../provider-retry.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime assistant thinking events", () => {

  it("retries one transient stream failure without duplicating the assistant bubble", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const failedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "terminated",
      timestamp: 2,
    };
    const toolUseMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "Read", arguments: {} }],
      stopReason: "toolUse",
      timestamp: 1,
    };
    const toolResultMessage = {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: 1,
    };
    const successfulMessage = {
      role: "assistant",
      content: [{ type: "text", text: "recovered response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 3,
    };

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        toolUseMessage,
        toolResultMessage,
        failedMessage,
        failedMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: failedMessage });
      await handleAgentEvent({ type: "message_end", message: failedMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(3);
      expect(agent.state.messages.at(-1)?.role).toBe("toolResult");
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: successfulMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("hello", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "recovered response",
        }),
      }),
    );

    await runtime.dispose();
  });

  it("does not continue steering after a recovery becomes pending", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    const agent = (runtime as any).agent;
    agent.state.messages = [
      { role: "user", content: "hello", timestamp: 1 },
      { role: "assistant", content: [], timestamp: 2 },
    ];
    (runtime as any).acceptingSteering = true;
    (runtime as any).pendingSteering = new Map([
      [{ role: "user", content: "steer", timestamp: 3 }, "steer-1"],
    ]);
    const continueCalls: number[] = [];
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      continueCalls.push(continueCalls.length + 1);
      if (continueCalls.length === 1) {
        (runtime as any).suppressProviderRetryRunEnd = true;
        return;
      }
      throw new Error("Cannot continue from message role: assistant");
    });

    await expect((runtime as any).waitForIdleAndSteering()).resolves.toBeUndefined();

    expect(continueCalls).toEqual([1]);
    await runtime.dispose();
  });

  it("shares one bounded transient budget across setup and stream phases", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    const claim = (runtime as any).claimProviderRetry.bind(runtime);
    const gateway502 = classifyAgentError(
      'OpenAI API error (502): {"type":"api_error","message":"Upstream API request failed."}',
    );
    expect(gateway502).toMatchObject({ code: "PROVIDER_ERROR", retriable: true });

    // A gateway fault that moves between phases draws from one counter.
    expect(claim(gateway502, "request")).toBe(1);
    expect(claim(gateway502, "stream")).toBe(2);
    expect(claim(gateway502, "request")).toBe(3);
    expect(claim(gateway502, "stream")).toBe(4);
    // Ten retries after the initial attempt, then the failure is terminal.
    expect(PROVIDER_TRANSIENT_MAX_RETRIES).toBe(10);
    for (let attempt = 5; attempt <= PROVIDER_TRANSIENT_MAX_RETRIES; attempt += 1) {
      expect(claim(gateway502, attempt % 2 === 1 ? "request" : "stream")).toBe(
        attempt,
      );
    }
    expect(claim(gateway502, "request")).toBeUndefined();

    (runtime as any).resetRunRecoveryState();
    // A mid-stream 502 is now retried; it used to be excluded outright.
    expect(claim(gateway502, "stream")).toBe(1);

    (runtime as any).resetRunRecoveryState();
    // The 429 budget stays separate and is not drained by transient failures.
    const rateLimited = classifyAgentError("429: too many requests");
    expect(claim(gateway502, "request")).toBe(1);
    expect(claim(rateLimited, "request")).toBe(1);
    expect(claim(rateLimited, "stream")).toBe(2);

    (runtime as any).resetRunRecoveryState();
    // Permanent failures never claim a retry, whatever the phase.
    for (const message of [
      "401: invalid api key",
      "404: unknown model",
      "413: context length exceeded",
      "400: invalid request body",
    ]) {
      expect(claim(classifyAgentError(message), "request")).toBeUndefined();
      expect(claim(classifyAgentError(message), "stream")).toBeUndefined();
    }

    await runtime.dispose();
  });

  it("allows the opt-in retry mode to claim beyond both bounded budgets", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    runtime.setInfiniteProviderRetry(true);
    const claim = (runtime as any).claimProviderRetry.bind(runtime);
    const transient = classifyAgentError("fetch failed");
    const rateLimited = classifyAgentError("429: too many requests");

    for (let attempt = 1; attempt <= PROVIDER_TRANSIENT_MAX_RETRIES + 2; attempt += 1) {
      expect(claim(transient, attempt % 2 === 0 ? "stream" : "request")).toBe(attempt);
    }
    for (let attempt = 1; attempt <= PROVIDER_RATE_LIMIT_MAX_RETRIES + 2; attempt += 1) {
      expect(claim(rateLimited, attempt % 2 === 0 ? "stream" : "request")).toBe(attempt);
    }
    await runtime.dispose();
  });

  it("keeps the bounded retry policy when infinite mode is disabled", async () => {
    const runtime = createRuntime({ onEvent: vi.fn() });
    const claim = (runtime as any).claimProviderRetry.bind(runtime);
    const transient = classifyAgentError("fetch failed");
    for (let attempt = 1; attempt <= PROVIDER_TRANSIENT_MAX_RETRIES; attempt += 1) {
      expect(claim(transient, "request")).toBe(attempt);
    }
    expect(claim(transient, "request")).toBeUndefined();
    await runtime.dispose();
  });

  it("retries a mid-stream rate-limit (429) failure in the same turn", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const rateLimitedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "upstream unavailable",
      timestamp: 2,
    };
    (runtime as any).providerResponseStatus = 429;
    const successfulMessage = {
      role: "assistant",
      content: [{ type: "text", text: "recovered response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 3,
    };

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        rateLimitedMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: rateLimitedMessage });
      await handleAgentEvent({ type: "message_end", message: rateLimitedMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      expect(agent.state.messages.filter((message: any) => message.role !== "system")).toHaveLength(1);
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: successfulMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    vi.useFakeTimers();
    try {
      const prompt = runtime.prompt("hello", "user-1");
      await vi.runAllTimersAsync();
      await prompt;
    } finally {
      vi.useRealTimers();
    }

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "recovered response",
        }),
      }),
    );

    await runtime.dispose();
  });

  it("replays repeated mid-stream 502s in place and surfaces only the exhausted failure", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const gatewayMessage = (timestamp: number) => ({
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage:
        'OpenAI API error (502): {"type":"api_error","message":"Upstream API request failed."}',
      timestamp,
    });

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        gatewayMessage(2),
      ];
      await handleAgentEvent({ type: "message_start", message: gatewayMessage(2) });
      await handleAgentEvent({ type: "message_end", message: gatewayMessage(2) });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    let continues = 0;
    agent.continue = vi.fn(async () => {
      continues += 1;
      const failed = gatewayMessage(2 + continues);
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        failed,
      ];
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

    vi.useFakeTimers();
    try {
      const prompt = runtime.prompt("hello", "user-1");
      await vi.runAllTimersAsync();
      await prompt;
    } finally {
      vi.useRealTimers();
    }

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    // Four retries after the initial attempt, then the failure is surfaced.
    expect(continues).toBe(PROVIDER_TRANSIENT_MAX_RETRIES);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    const errors = events.filter((event) => event.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toMatchObject({
      code: "PROVIDER_ERROR",
      details: { retryAttempt: PROVIDER_TRANSIENT_MAX_RETRIES, phase: "stream" },
    });

    await runtime.dispose();
  });

  it("surfaces repeated 429s only after exhausting the ten-retry budget", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const rateLimitedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: '429: {"error":{"type":"rate_limit_error"}}',
      timestamp: 2,
    };

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        rateLimitedMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: rateLimitedMessage });
      await handleAgentEvent({ type: "message_end", message: rateLimitedMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      agent.state.messages = [...agent.state.messages, rateLimitedMessage];
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: rateLimitedMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    vi.useFakeTimers();
    try {
      const prompt = runtime.prompt("hello", "user-1");
      await vi.runAllTimersAsync();
      await prompt;
    } finally {
      vi.useRealTimers();
    }

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledTimes(PROVIDER_RATE_LIMIT_MAX_RETRIES);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "error",
          isError: true,
          error: expect.objectContaining({
            code: "PROVIDER_RATE_LIMITED",
            retriable: true,
            details: expect.objectContaining({
              phase: "stream",
              retryAttempt: PROVIDER_RATE_LIMIT_MAX_RETRIES,
            }),
          }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({
          code: "PROVIDER_RATE_LIMITED",
          retriable: true,
        }),
      }),
    );

    await runtime.dispose();
  });
});
