import { describe, expect, it, vi } from "vitest";
import { DesktopAgentRuntime, type RuntimeProviderConfig } from "./runtime.js";
import type { ThinkingLevel, UiMessage } from "@pi-desktop/shared";

const provider: RuntimeProviderConfig = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  modelId: "local-model",
  apiKey: "",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "low", "medium", "high"],
  modelConfig: {
    source: "pi",
    name: "Local Catalog Model",
    baseUrl: "https://catalog.invalid/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: null, max: null },
    input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    contextWindow: 256_000,
    maxTokens: 32_000,
  },
};

function createRuntime(
  overrides: Partial<{
    provider: RuntimeProviderConfig;
    thinkingLevel: ThinkingLevel;
    history: UiMessage[];
    onEvent: (envelope: unknown) => void;
  }> = {},
) {
  return new DesktopAgentRuntime({
    host: { call: vi.fn() } as never,
    sessionId: "session-1",
    mode: "agent",
    provider: overrides.provider ?? provider,
    thinkingLevel: overrides.thinkingLevel ?? "medium",
    history: overrides.history,
    onEvent: overrides.onEvent ?? vi.fn(),
  });
}

describe("DesktopAgentRuntime configuration matching", () => {
  it("accepts no-auth providers and reuses only an exact pi configuration", async () => {
    const runtime = createRuntime();

    expect(runtime.matches("agent", provider, "medium")).toBe(true);
    expect(runtime.matches("chat", provider, "medium")).toBe(false);
    expect(
      runtime.matches("agent", { ...provider, authKind: "api_key" }, "medium"),
    ).toBe(false);
    expect(
      runtime.matches(
        "agent",
        { ...provider, modelId: "another-model" },
        "medium",
      ),
    ).toBe(false);
    expect(runtime.matches("agent", provider, "high")).toBe(false);

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime thinking configuration", () => {
  it("clamps the requested level and exposes model reasoning capability", async () => {
    const runtime = createRuntime({ thinkingLevel: "minimal" });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("low");
    expect(agent.state.model.reasoning).toBe(true);
    expect(agent.state.model.thinkingLevelMap.minimal).toBeNull();
    expect(agent.state.model.thinkingLevelMap.xhigh).toBeNull();

    await runtime.dispose();
  });

  it("forces off for providers without reasoning support", async () => {
    const noReasoning: RuntimeProviderConfig = {
      ...provider,
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
      modelConfig: undefined,
    };
    const runtime = createRuntime({
      provider: noReasoning,
      thinkingLevel: "high",
    });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.model.reasoning).toBe(false);

    await runtime.dispose();
  });

  it("applies the complete pi model record while preserving endpoint identity", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelId: "mimo-v2.5-pro-think",
      supportedThinkingLevels: ["off", "high"],
      modelConfig: {
        source: "pi",
        name: "MiMo-V2.5-Pro",
        baseUrl: "https://api.xiaomimimo.com/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        headers: { "X-Catalog-Model": "mimo-v2.5-pro" },
        compat: {
          thinkingFormat: "deepseek",
          requiresReasoningContentOnAssistantMessages: true,
        },
      },
    };
    const runtime = createRuntime({ provider: mimo, thinkingLevel: "off" });
    const model = (runtime as any).agent.state.model;

    expect(model.compat).toMatchObject({
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    });
    expect(model.name).toBe("MiMo-V2.5-Pro");
    expect(model.baseUrl).toBe(provider.baseUrl);
    expect(model.contextWindow).toBe(1_048_576);
    expect(model.maxTokens).toBe(131_072);
    expect(model.input).toEqual(["text"]);
    expect(model.cost).toEqual({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
      cacheWrite: 0,
    });
    expect(model.headers).toEqual({ "X-Catalog-Model": "mimo-v2.5-pro" });
    expect((runtime as any).thinkingLevel).toBe("off");

    await runtime.dispose();
  });

  it("preserves adaptive model metadata without desktop-side rewrites", async () => {
    const adaptive: RuntimeProviderConfig = {
      ...provider,
      apiStyle: "anthropic_messages",
      modelId: "claude-opus-4-6",
      supportedThinkingLevels: ["off", "minimal", "low", "medium", "high", "max"],
      modelConfig: {
        source: "pi",
        name: "Claude Opus 4.6",
        baseUrl: "https://api.anthropic.com",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap: { max: "max" },
      },
    };
    const runtime = createRuntime({ provider: adaptive, thinkingLevel: "off" });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.model.compat.forceAdaptiveThinking).toBe(true);
    expect(agent.state.model.thinkingLevelMap).toEqual({ max: "max" });

    await runtime.dispose();
  });

  it("recreates the runtime when the pi model record changes", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        compat: { thinkingFormat: "deepseek" },
      },
    };
    const runtime = createRuntime({ provider: mimo, thinkingLevel: "medium" });

    expect(runtime.matches("agent", mimo, "medium")).toBe(true);
    expect(
      runtime.matches("agent", { ...mimo, modelConfig: undefined }, "medium"),
    ).toBe(false);

    await runtime.dispose();
  });

  it("restores assistant thinking blocks into the pi transcript", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "answer",
          thinking: "private plan",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const agent = (runtime as any).agent;
    const assistant = agent.state.messages.find(
      (message: any) => message.role === "assistant",
    );

    expect(assistant.content).toEqual([
      { type: "thinking", thinking: "private plan" },
      { type: "text", text: "answer" },
    ]);

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime tool history restore (D120)", () => {
  const toolRow = (overrides: Partial<UiMessage> = {}): UiMessage => ({
    id: "tool-1",
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    status: "complete",
    toolName: "Grep",
    toolCallId: "call-1",
    toolStatus: "success",
    toolArgs: { pattern: "renderFormContent" },
    toolResult: {
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
    },
    ...overrides,
  });

  it("restores tool call/result pairs adjacent to their assistant turn", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "optimize the form",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Let me find the render code.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
        {
          id: "assistant-2",
          role: "assistant",
          content: "Found it.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(messages[1].stopReason).toBe("toolUse");
    expect(messages[1].content).toEqual([
      { type: "text", text: "Let me find the render code." },
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "Grep",
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
      isError: false,
    });
    expect(messages[3].stopReason).toBe("stop");

    await runtime.dispose();
  });

  it("keeps call-only assistant turns as carriers and drops truly empty ones", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-empty-with-tools",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ id: "tool-a", toolCallId: "call-a" }),
        toolRow({ id: "tool-b", toolCallId: "call-b" }),
        {
          id: "assistant-empty",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
    ]);
    expect(messages[0].content.map((b: any) => b.id)).toEqual([
      "call-a",
      "call-b",
    ]);

    await runtime.dispose();
  });

  it("synthesizes a carrier for tool rows whose assistant row was lost", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(messages[1].content).toEqual([
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[1].stopReason).toBe("toolUse");

    await runtime.dispose();
  });

  it("restores interrupted tool rows as errored results", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Running it now.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({
          toolStatus: "running",
          toolResult: undefined,
        }),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [
        {
          type: "text",
          text: "[tool call was interrupted before a result was recorded]",
        },
      ],
    });

    await runtime.dispose();
  });

  it("skips tool rows without a call id and keeps plain restores unchanged", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "answer",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ toolCallId: undefined }),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual(["assistant"]);
    expect(messages[0].content).toEqual([{ type: "text", text: "answer" }]);
    expect(messages[0].stopReason).toBe("stop");

    await runtime.dispose();
  });
});

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
    expect(events[1].event.message).toMatchObject({
      content: "answer",
      thinking: "plan done",
    });
    expect(events[2].event.message).toMatchObject({
      content: "answer",
      thinking: "plan done",
      status: "complete",
    });

    await runtime.dispose();
  });

  it("turns a provider model failure into an error message and event", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
      },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: '404: {"error":{"message":"model not found"}}',
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-2)?.event).toMatchObject({
      type: "message_end",
      message: {
        status: "error",
        isError: true,
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: '404: {"error":{"message":"model not found"}}',
          retriable: false,
        },
      },
    });
    expect(events.at(-1)?.event).toMatchObject({
      type: "error",
      error: {
        code: "MODEL_NOT_CONFIGURED",
        retriable: false,
      },
    });

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

    expect((runtime as any).agent.state.messages).toEqual([]);
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
});
