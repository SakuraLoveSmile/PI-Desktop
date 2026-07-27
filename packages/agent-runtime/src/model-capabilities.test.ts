import { describe, expect, it } from "vitest";
import {
  clampThinkingLevel,
  resolveModelWireCompat,
  resolveThinkingCapabilities,
  type ModelCapabilities,
} from "./model-capabilities.js";
import type { ThinkingLevel } from "@pi-desktop/shared";

describe("resolveThinkingCapabilities", () => {
  it("uses the exact pi-ai catalog model when available", () => {
    const capabilities = resolveThinkingCapabilities({
      vendorKey: "openai",
      modelId: "gpt-5.1",
    });

    expect(capabilities.supportsReasoning).toBe(true);
    expect(capabilities.supportedThinkingLevels).toEqual([
      "off",
      "low",
      "medium",
      "high",
    ]);
  });

  it("uses the explicit reasoning capability for an unknown model", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "custom",
        modelId: "unknown-reasoning-model",
        supportsReasoning: true,
      }),
    ).toEqual({
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "minimal", "low", "medium", "high"],
    });
  });

  it("removes off for adaptive-only Anthropic-compatible models", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "custom",
        modelId: "claude-opus-4-6",
        apiStyle: "anthropic_messages",
        supportsReasoning: true,
      }),
    ).toEqual({
      supportsReasoning: true,
      supportedThinkingLevels: ["minimal", "low", "medium", "high", "max"],
    });
  });

  it("defaults unknown models to no reasoning", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "custom",
        modelId: "unknown-model",
      }),
    ).toEqual({
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    });
  });

  it("honors an explicit false override even for a catalogued model", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "openai",
        modelId: "gpt-5.1",
        supportsReasoning: false,
      }),
    ).toEqual({
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    });
  });


  it("honors an explicit sparse supportedThinkingLevels override", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "custom",
        modelId: "mimo-v2.5",
        supportsReasoning: true,
        supportedThinkingLevels: ["high", "off", "bogus" as ThinkingLevel, "high"],
      }),
    ).toEqual({
      supportsReasoning: true,
      // Keep declared order after filtering invalid entries, ensuring off is present.
      supportedThinkingLevels: ["high", "off"],
    });
  });

  it("lets sparse levels win over a catalogued model id collision", () => {
    expect(
      resolveThinkingCapabilities({
        vendorKey: "openai",
        modelId: "gpt-5.1",
        supportsReasoning: true,
        supportedThinkingLevels: ["off", "high"],
      }),
    ).toEqual({
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "high"],
    });
  });
  it("clamps sparse capability lists using the nearest supported level", () => {
    const capabilities: ModelCapabilities = {
      supportsReasoning: true,
      supportedThinkingLevels: ["off", "low", "high"] as ThinkingLevel[],
    };
    expect(clampThinkingLevel(capabilities, "minimal")).toBe("low");
    expect(clampThinkingLevel(capabilities, "max")).toBe("high");
  });
});

describe("resolveModelWireCompat", () => {
  it("adopts the thinking dialect for an exact vendor model", () => {
    const wire = resolveModelWireCompat({
      vendorKey: "xiaomi",
      modelId: "mimo-v2.5",
    });

    expect(wire?.compat?.thinkingFormat).toBe("deepseek");
    expect(wire?.compat?.requiresReasoningContentOnAssistantMessages).toBe(
      true,
    );
  });

  it("matches gateway alias ids by boundary prefix across vendors", () => {
    // Custom gateways expose catalogued models under alias suffixes such as
    // mimo-v2.5-pro-think; the upstream dialect still applies.
    const wire = resolveModelWireCompat({
      vendorKey: "custom",
      modelId: "mimo-v2.5-pro-think",
      apiStyle: "chat_completions",
    });

    expect(wire?.compat?.thinkingFormat).toBe("deepseek");
  });

  it("keeps explicit catalog off values for effort-style endpoints", () => {
    const wire = resolveModelWireCompat({
      vendorKey: "custom",
      modelId: "gpt-5.1",
      apiStyle: "responses",
    });

    expect(wire?.thinkingLevelMap?.off).toBe("none");
  });

  it("preserves adaptive thinking and marks off unsupported", () => {
    const wire = resolveModelWireCompat({
      vendorKey: "custom",
      modelId: "claude-opus-4-6",
      apiStyle: "anthropic_messages",
    });

    expect(wire?.compat?.forceAdaptiveThinking).toBe(true);
    expect(wire?.thinkingLevelMap?.off).toBeNull();
  });

  it("requires a separator boundary for prefix matches", () => {
    expect(
      resolveModelWireCompat({ vendorKey: "custom", modelId: "mimo-v2.50" }),
    ).toBeUndefined();
  });

  it("returns undefined for unknown models", () => {
    expect(
      resolveModelWireCompat({
        vendorKey: "custom",
        modelId: "totally-unknown-model",
      }),
    ).toBeUndefined();
  });
});
