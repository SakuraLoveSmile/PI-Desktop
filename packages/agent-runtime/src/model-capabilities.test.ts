import { describe, expect, it } from "vitest";
import {
  clampThinkingLevel,
  resolvePiModelConfig,
  resolveThinkingCapabilities,
  type ModelCapabilities,
} from "./model-capabilities.js";
import type { ThinkingLevel } from "@pi-desktop/shared";

describe("pi-ai model resolution", () => {
  it("uses the exact pi-ai catalog model and its supported levels", () => {
    const capabilities = resolveThinkingCapabilities({
      vendorKey: "openai",
      modelId: "gpt-5.1",
      apiStyle: "responses",
    });
    const model = resolvePiModelConfig({
      vendorKey: "openai",
      modelId: "gpt-5.1",
      apiStyle: "responses",
    });

    expect(capabilities).toEqual({
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "low", "medium", "high"],
    });
    expect(model).toMatchObject({
      source: "pi",
      name: "GPT-5.1",
      reasoning: true,
      contextWindow: 400_000,
      maxTokens: 128_000,
      input: ["text", "image"],
    });
  });

  it("copies MiMo model limits, input modes, and wire compatibility", () => {
    const model = resolvePiModelConfig({
      vendorKey: "xiaomi",
      modelId: "mimo-v2.5",
    });

    expect(model).toMatchObject({
      source: "pi",
      reasoning: true,
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      input: ["text", "image"],
      compat: {
        thinkingFormat: "deepseek",
        requiresReasoningContentOnAssistantMessages: true,
      },
    });
  });

  it("matches gateway alias ids by a separator boundary", () => {
    const model = resolvePiModelConfig({
      vendorKey: "custom",
      modelId: "mimo-v2.5-pro-think",
      apiStyle: "chat_completions",
    });

    expect(model?.name).toBe("MiMo-V2.5-Pro");
    expect(model?.compat?.thinkingFormat).toBe("deepseek");
    expect(
      resolvePiModelConfig({ vendorKey: "custom", modelId: "mimo-v2.50" }),
    ).toBeUndefined();
  });

  it("preserves adaptive Claude metadata exactly as pi publishes it", () => {
    const model = resolvePiModelConfig({
      vendorKey: "custom",
      modelId: "claude-opus-4-6",
      apiStyle: "anthropic_messages",
    });

    expect(model).toMatchObject({
      reasoning: true,
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
  });

  it("resolves Claude Opus 5 limits and adaptive thinking from the pinned catalog", () => {
    const model = resolvePiModelConfig({
      vendorKey: "custom",
      modelId: "claude-opus-5",
      apiStyle: "anthropic_messages",
    });
    const capabilities = resolveThinkingCapabilities({
      vendorKey: "custom",
      modelId: "claude-opus-5",
      apiStyle: "anthropic_messages",
    });

    expect(model).toMatchObject({
      source: "pi",
      name: "Claude Opus 5",
      reasoning: true,
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: { xhigh: "xhigh", max: "max" },
      compat: { forceAdaptiveThinking: true },
    });
    expect(capabilities.supportsReasoning).toBe(true);
    expect(capabilities.supportedThinkingLevels).toEqual(
      expect.arrayContaining(["off", "xhigh", "max"]),
    );
  });

  it("keeps an unknown free-form model on the generic non-reasoning path", () => {
    const input = {
      vendorKey: "custom",
      modelId: "unknown-model",
      apiStyle: "chat_completions",
    };
    expect(resolvePiModelConfig(input)).toBeUndefined();
    expect(resolveThinkingCapabilities(input)).toEqual({
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    });
  });

  it("clamps sparse pi capability lists using the nearest supported level", () => {
    const capabilities: ModelCapabilities = {
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "low", "high"] as ThinkingLevel[],
    };
    expect(clampThinkingLevel(capabilities, "minimal")).toBe("low");
    expect(clampThinkingLevel(capabilities, "max")).toBe("high");
  });
});
