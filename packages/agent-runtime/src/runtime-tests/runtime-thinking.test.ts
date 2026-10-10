import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type RuntimeProviderConfig } from "../runtime.js";
import { provider, createRuntime, runtimeMatches } from "./runtime-test-harness.js";

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

  it("omits the provider thinking override when the session level is omit", async () => {
    const responseProvider: RuntimeProviderConfig = {
      ...provider,
      id: "responses",
      name: "Responses",
      apiStyle: "responses",
      baseUrl: "https://example.invalid/v1",
      apiKey: "test-key",
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "high"],
      modelConfig: {
        source: "generic",
        name: "Responses model",
        baseUrl: "https://example.invalid/v1",
        reasoning: true,
        thinkingLevelMap: { off: "none", high: "high" },
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 8_192,
      },
    };
    const runtime = createRuntime({ provider: responseProvider, thinkingLevel: "omit" });
    const agent = (runtime as any).agent;
    expect(agent.state.thinkingLevel).toBe("off");
    expect((runtime as any).thinkingLevel).toBe("omit");
    const requests: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
      return new Response("bad request", { status: 400 });
    });
    const stream = agent.streamFunction(agent.state.model, { systemPrompt: "system", messages: [], tools: [] }, { fetch });
    await stream.result();
    expect(requests).toHaveLength(1);
    expect(requests[0].reasoning).toBeUndefined();
    await runtime.dispose();
  });

  it("applies the complete models.dev model record while preserving endpoint identity", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelId: "mimo-v2.5-pro-think",
      supportedThinkingLevels: ["off", "high"],
      modelConfig: {
        source: "models.dev",
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
        source: "models.dev",
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

  it("recreates the runtime when the models.dev model record changes", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        compat: { thinkingFormat: "deepseek" },
      },
    };
    const runtime = createRuntime({ provider: mimo, thinkingLevel: "medium" });

    expect(runtimeMatches(runtime)).toBe(true);
    expect(
      runtimeMatches(runtime, {
        provider: { ...mimo, modelConfig: undefined },
      }),
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

  it("stamps reasoning_content only for DeepSeek-compatible Completions history", async () => {
    const runtime = createRuntime({
      provider: {
        ...provider,
        vendorKey: "deepseek",
        baseUrl: "https://relay.example/v1",
        modelId: "deepseek-v4",
        modelConfig: {
          ...provider.modelConfig!,
          baseUrl: "https://relay.example/v1",
        },
      },
      history: [
        {
          id: "assistant-deepseek-1",
          role: "assistant",
          content: "answer",
          thinking: "private plan",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const assistant = (runtime as any).agent.state.messages.find(
      (message: any) => message.role === "assistant",
    );

    expect(assistant.content).toEqual([
      {
        type: "thinking",
        thinking: "private plan",
        thinkingSignature: "reasoning_content",
      },
      { type: "text", text: "answer" },
    ]);

    await runtime.dispose();
  });

  it("keeps provider-native thinking unsigned for Anthropic history", async () => {
    const runtime = createRuntime({
      provider: {
        ...provider,
        apiStyle: "anthropic_messages",
        modelId: "claude-opus-4-6",
        modelConfig: {
          ...provider.modelConfig!,
          baseUrl: "https://api.anthropic.com",
          compat: { forceAdaptiveThinking: true },
        },
      },
      history: [
        {
          id: "assistant-anthropic-1",
          role: "assistant",
          content: "answer",
          thinking: "private plan",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const assistant = (runtime as any).agent.state.messages.find(
      (message: any) => message.role === "assistant",
    );

    expect(assistant.content).toEqual([
      { type: "thinking", thinking: "private plan" },
      { type: "text", text: "answer" },
    ]);

    await runtime.dispose();
  });
});
