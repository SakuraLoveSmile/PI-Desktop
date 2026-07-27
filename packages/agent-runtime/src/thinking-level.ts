import type { ThinkingLevel } from "@pi-desktop/shared";

export type ThinkingCapabilitySet = {
  supportsReasoning: boolean;
  supportedThinkingLevels: readonly ThinkingLevel[];
};

/**
 * Wire-dialect hints for a custom/compatible endpoint, resolved from the
 * pi-ai catalog in the main process. The sidecar runtime path applies them
 * verbatim; it never loads the catalog itself (see clampThinkingLevel).
 *
 * Without these, "off" on an OpenAI-compatible endpoint emits no request
 * parameter at all, so server-side default-on reasoners (e.g. MiMo *-think)
 * keep thinking despite the selected level.
 */
export type ModelWireCompat = {
  compat?: {
    /** pi-ai thinking dialect, e.g. "deepseek" -> thinking: {type: "disabled"}. */
    thinkingFormat?: string;
    requiresReasoningContentOnAssistantMessages?: boolean;
    supportsReasoningEffort?: boolean;
    /** Adaptive-only Anthropic models reject thinking.type = "disabled". */
    forceAdaptiveThinking?: boolean;
    chatTemplateKwargs?: Record<string, unknown>;
  };
  /** Catalog level mapping, e.g. off -> "none" for gpt-5.1-style endpoints. */
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
};

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Apply pi-ai's nearest-supported-level rule without loading the full model
 * catalog into the sidecar runtime path.
 */
export function clampThinkingLevel(
  capabilities: ThinkingCapabilitySet,
  requested: ThinkingLevel,
): ThinkingLevel {
  if (!capabilities.supportsReasoning) return "off";
  const supported = new Set(capabilities.supportedThinkingLevels ?? ["off"]);
  if (supported.has(requested)) return requested;

  const requestedIndex = THINKING_LEVELS.indexOf(requested);
  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index];
    if (supported.has(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index];
    if (supported.has(candidate)) return candidate;
  }
  return "off";
}
