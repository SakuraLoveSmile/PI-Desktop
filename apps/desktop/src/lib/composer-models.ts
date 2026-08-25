import type { ModelInfo, ProviderPublic } from "@pi-desktop/shared";

type ConfiguredProvider = Pick<ProviderPublic, "id" | "models" | "defaultModelId">;

function configuredModelIds(provider: ConfiguredProvider): string[] {
  const ids = (provider.models ?? [])
    .map((binding) => binding.id.trim())
    .filter(Boolean);
  if (ids.length > 0) return [...new Set(ids)];

  const legacyId = provider.defaultModelId?.trim();
  return legacyId ? [legacyId] : [];
}

/**
 * Build the Composer model list from the models explicitly enabled in
 * provider settings. Discovery only enriches those configured rows; it does
 * not grant every discovered model access to the conversation picker.
 */
export function composerModelsForProvider(
  provider: ConfiguredProvider,
  discovered: readonly ModelInfo[] | undefined,
): ModelInfo[] {
  const discoveredById = new Map(
    (discovered ?? []).map((model) => [model.modelId, model]),
  );

  return configuredModelIds(provider).map(
    (modelId) =>
      discoveredById.get(modelId) ?? {
        modelId,
        displayName: modelId,
        providerId: provider.id,
        capabilities: ["text"],
        source: "user",
      },
  );
}
