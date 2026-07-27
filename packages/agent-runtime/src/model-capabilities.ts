import type { ThinkingLevel } from "@pi-desktop/shared";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
export {
  clampThinkingLevel,
  type ThinkingCapabilitySet,
  type ModelWireCompat,
} from "./thinking-level.js";
import type { ModelWireCompat } from "./thinking-level.js";

export type ModelCapabilityInput = {
  vendorKey: string;
  modelId: string;
  apiStyle?: string;
  supportsReasoning?: boolean;
  /**
   * Optional sparse override for custom/compatible providers.
   * Example: ["off", "high"] for boolean-like thinking support.
   */
  supportedThinkingLevels?: readonly ThinkingLevel[];
};

export type ModelCapabilities = {
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
};

const CANONICAL_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function normalizeExplicitThinkingLevels(
  levels: readonly ThinkingLevel[] | undefined,
): ThinkingLevel[] | undefined {
  if (!levels) return undefined;
  const allowed = new Set<ThinkingLevel>(CANONICAL_THINKING_LEVELS);
  const out: ThinkingLevel[] = [];
  for (const level of levels) {
    if (!allowed.has(level) || out.includes(level)) continue;
    out.push(level);
  }
  return out.length > 0 ? out : undefined;
}

/** Public name used by the desktop main-process provider enrichment. */
export type ThinkingCapabilities = ModelCapabilities;

const DEFAULT_REASONING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
];

let cachedBuiltinModels: ReturnType<typeof builtinModels> | undefined;

function getBuiltinCatalog() {
  cachedBuiltinModels ??= builtinModels();
  return cachedBuiltinModels;
}

/**
 * Resolve capabilities from pi-ai's generated catalog.
 *
 * An explicit provider override is authoritative. This matters for custom
 * OpenAI-compatible endpoints whose model id happens to match a catalogued
 * model but exposes different reasoning semantics.
 */
export function resolveThinkingCapabilities(
  input: ModelCapabilityInput,
): ModelCapabilities {
  const model = getBuiltinCatalog().getModel(input.vendorKey, input.modelId);
  const explicitLevels = normalizeExplicitThinkingLevels(
    input.supportedThinkingLevels,
  );

  if (input.supportsReasoning === false) {
    return {
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    };
  }

  // Explicit sparse sets win for custom/compatible endpoints, including when
  // the model id collides with a catalog entry but only exposes boolean-like
  // thinking support such as ["off", "high"].
  if (explicitLevels) {
    const levels = explicitLevels.includes("off")
      ? explicitLevels
      : (["off", ...explicitLevels] as ThinkingLevel[]);
    return {
      supportsReasoning: true,
      supportedThinkingLevels: levels,
    };
  }

  if (model?.reasoning) {
    const levels = getSupportedThinkingLevels(model) as ThinkingLevel[];
    return {
      supportsReasoning: model.reasoning,
      supportedThinkingLevels:
        ((model.compat ?? {}) as Record<string, unknown>)
          .forceAdaptiveThinking === true
          ? levels.filter((level) => level !== "off")
          : [...levels],
    };
  }

  if (input.supportsReasoning === true) {
    const compatibleModel = findReasoningCatalogModel(input);
    if (
      compatibleModel &&
      ((compatibleModel?.compat ?? {}) as Record<string, unknown>)
        .forceAdaptiveThinking === true
    ) {
      return {
        supportsReasoning: true,
        supportedThinkingLevels: (
          getSupportedThinkingLevels(compatibleModel) as ThinkingLevel[]
        ).filter((level) => level !== "off"),
      };
    }
    return {
      supportsReasoning: true,
      supportedThinkingLevels: [...DEFAULT_REASONING_LEVELS],
    };
  }

  return {
    supportsReasoning: false,
    supportedThinkingLevels: ["off"],
  };
}

/** Map a stored provider apiStyle onto the pi-ai wire api (runtime binding). */
function wireApiForStyle(apiStyle?: string): string {
  switch (apiStyle) {
    case "responses":
      return "openai-responses";
    case "anthropic_messages":
      return "anthropic-messages";
    case "google_generative_ai":
      return "google-generative-ai";
    default:
      return "openai-completions";
  }
}

/** Separators after which a catalog id counts as a prefix of a gateway id
 * (mimo-v2.5-pro-think -> mimo-v2.5-pro), so "-think"/"-nothink"/date-suffix
 * aliases inherit the upstream dialect while mimo-v2.50 does not. */
const MODEL_ID_BOUNDARY = new Set(["-", "_", ".", ":", "@", "/"]);

type CatalogModel = ReturnType<
  ReturnType<typeof builtinModels>["getModels"]
>[number];

/** Rank same-id catalog entries: prefer the canonical vendor entry, which
 * states an adaptive mode, thinking dialect, and/or expressible off value,
 * over aggregator mirrors that only carry host quirks and would resolve to
 * incomplete thinking information. */
function wireInfoScore(model: CatalogModel): number {
  const compat = (model.compat ?? {}) as Record<string, unknown>;
  let score = 0;
  if (compat.forceAdaptiveThinking === true) score += 8;
  if (typeof compat.thinkingFormat === "string") score += 4;
  if (typeof model.thinkingLevelMap?.off === "string") score += 2;
  if (model.thinkingLevelMap) score += 1;
  return score;
}

function findReasoningCatalogModel(input: {
  vendorKey: string;
  modelId: string;
  apiStyle?: string;
}): CatalogModel | undefined {
  const api = wireApiForStyle(input.apiStyle);
  const requestedId = input.modelId.trim().toLowerCase();
  if (!requestedId) return undefined;

  const catalog = getBuiltinCatalog();
  const vendorModel = catalog.getModel(input.vendorKey, input.modelId);
  if (vendorModel && vendorModel.api === api && vendorModel.reasoning) {
    return vendorModel;
  }

  const candidates = catalog
    .getModels()
    .filter((model) => model.api === api && model.reasoning);
  const exact = candidates
    .filter((model) => model.id.toLowerCase() === requestedId)
    .sort((a, b) => wireInfoScore(b) - wireInfoScore(a));
  return (
    exact[0] ??
    candidates
      .filter((model) => {
        const id = model.id.toLowerCase();
        return (
          requestedId.length > id.length &&
          requestedId.startsWith(id) &&
          MODEL_ID_BOUNDARY.has(requestedId.charAt(id.length))
        );
      })
      .sort(
        (a, b) =>
          b.id.length - a.id.length || wireInfoScore(b) - wireInfoScore(a),
      )[0]
  );
}

/**
 * Resolve wire-dialect hints (thinking format + level value mapping) for an
 * endpoint from the pi-ai catalog. Custom gateways usually proxy catalogued
 * models under the upstream id (sometimes with an alias suffix), and speak
 * the upstream's thinking dialect, so the catalog entry — matched exactly or
 * by boundary-prefix — is the best available source. Returns undefined when
 * nothing thinking-relevant is known; the runtime then keeps today's plain
 * OpenAI behavior.
 */
export function resolveModelWireCompat(input: {
  vendorKey: string;
  modelId: string;
  apiStyle?: string;
}): ModelWireCompat | undefined {
  const match = findReasoningCatalogModel(input);
  if (!match) return undefined;

  const source = (match.compat ?? {}) as Record<string, unknown>;
  const compat: NonNullable<ModelWireCompat["compat"]> = {};
  if (typeof source.thinkingFormat === "string") {
    compat.thinkingFormat = source.thinkingFormat;
  }
  if (typeof source.requiresReasoningContentOnAssistantMessages === "boolean") {
    compat.requiresReasoningContentOnAssistantMessages =
      source.requiresReasoningContentOnAssistantMessages;
  }
  if (typeof source.supportsReasoningEffort === "boolean") {
    compat.supportsReasoningEffort = source.supportsReasoningEffort;
  }
  if (typeof source.forceAdaptiveThinking === "boolean") {
    compat.forceAdaptiveThinking = source.forceAdaptiveThinking;
  }
  if (
    source.chatTemplateKwargs &&
    typeof source.chatTemplateKwargs === "object"
  ) {
    compat.chatTemplateKwargs = {
      ...(source.chatTemplateKwargs as Record<string, unknown>),
    };
  }

  let thinkingLevelMap = match.thinkingLevelMap
    ? ({ ...match.thinkingLevelMap } as NonNullable<
        ModelWireCompat["thinkingLevelMap"]
      >)
    : undefined;
  if (compat.forceAdaptiveThinking === true) {
    (thinkingLevelMap ??= {}).off = null;
  }

  const hasCompat = Object.keys(compat).length > 0;
  if (!hasCompat && !thinkingLevelMap) return undefined;
  return {
    ...(hasCompat ? { compat } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
  };
}
