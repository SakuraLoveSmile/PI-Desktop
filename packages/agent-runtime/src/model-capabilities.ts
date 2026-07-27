import type { ThinkingLevel } from "@pi-desktop/shared";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
export {
  clampThinkingLevel,
  type PiModelConfig,
  type ThinkingCapabilitySet,
} from "./thinking-level.js";
import type { PiModelConfig } from "./thinking-level.js";

export type ModelCapabilityInput = {
  vendorKey: string;
  modelId: string;
  apiStyle?: string;
};

export type ModelCapabilities = {
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
};

/** Public name used by the desktop main-process provider enrichment. */
export type ThinkingCapabilities = ModelCapabilities;

let cachedBuiltinModels: ReturnType<typeof builtinModels> | undefined;

function getBuiltinCatalog() {
  cachedBuiltinModels ??= builtinModels();
  return cachedBuiltinModels;
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

/** Separators after which a catalog id counts as a prefix of a gateway id. */
const MODEL_ID_BOUNDARY = new Set(["-", "_", ".", ":", "@", "/"]);

type CatalogModel = ReturnType<
  ReturnType<typeof builtinModels>["getModels"]
>[number];

/** Prefer the catalog entry carrying the richest model-specific semantics. */
function catalogInfoScore(model: CatalogModel): number {
  const compat = (model.compat ?? {}) as Record<string, unknown>;
  let score = 0;
  if (compat.forceAdaptiveThinking === true) score += 16;
  if (typeof compat.thinkingFormat === "string") score += 8;
  if (typeof model.thinkingLevelMap?.off === "string") score += 4;
  if (model.thinkingLevelMap) score += 2;
  if (model.input.includes("image")) score += 1;
  return score;
}

function findCatalogModel(input: ModelCapabilityInput): CatalogModel | undefined {
  const api = wireApiForStyle(input.apiStyle);
  const requestedId = input.modelId.trim().toLowerCase();
  if (!requestedId) return undefined;

  const catalog = getBuiltinCatalog();
  const vendorModel = catalog.getModel(input.vendorKey, input.modelId);
  if (vendorModel?.api === api) return vendorModel;

  const candidates = catalog.getModels().filter((model) => model.api === api);
  const exact = candidates
    .filter((model) => model.id.toLowerCase() === requestedId)
    .sort((a, b) => catalogInfoScore(b) - catalogInfoScore(a));
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
          b.id.length - a.id.length || catalogInfoScore(b) - catalogInfoScore(a),
      )[0]
  );
}

/** Resolve the complete serializable model metadata owned by pi-ai. */
export function resolvePiModelConfig(
  input: ModelCapabilityInput,
): PiModelConfig | undefined {
  const model = findCatalogModel(input);
  if (!model) return undefined;

  return {
    source: "pi",
    name: model.name,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: { ...model.thinkingLevelMap } }
      : {}),
    input: [...model.input],
    cost: {
      ...model.cost,
      ...(model.cost.tiers
        ? { tiers: model.cost.tiers.map((tier) => ({ ...tier })) }
        : {}),
    },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers ? { headers: { ...model.headers } } : {}),
    ...(model.compat
      ? { compat: structuredClone(model.compat) as Record<string, unknown> }
      : {}),
  };
}

/** Resolve UI/session reasoning capability from the same pi model record. */
export function resolveThinkingCapabilities(
  input: ModelCapabilityInput,
): ModelCapabilities {
  const model = findCatalogModel(input);
  if (!model?.reasoning) {
    return {
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
    };
  }
  return {
    supportsReasoning: true,
    supportedThinkingLevels: [
      ...(getSupportedThinkingLevels(model) as ThinkingLevel[]),
    ],
  };
}
