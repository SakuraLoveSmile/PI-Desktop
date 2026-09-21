/**
 * Keeping the app's default image model across a provider save.
 *
 * `settings.imageGeneration` is the app default the Composer reads, while
 * `settings.imageGenerationModels` only lists the candidates the picker offers.
 * Saving a provider may extend that list, but adding one must not take over the
 * default: the chat default's rule applies here too — the stored choice
 * survives while it still resolves to a model a configured provider serves, and
 * only an unresolvable one is replaced.
 */
import {
  imageGenerationBindings,
  type ImageGenerationBinding,
  type ProviderPublic,
} from "@pi-desktop/shared";
import { providerOffersModel } from "./default-model";

/** True when the binding still names a model a configured provider serves. */
export function resolvesImageGenerationDefault(
  binding: ImageGenerationBinding | null | undefined,
  providers: readonly ProviderPublic[],
): boolean {
  if (!binding) return false;
  const provider = providers.find((candidate) => candidate.id === binding.providerId);
  return !!provider && providerOffersModel(provider, binding.modelId);
}

export type ImageGenerationDefaultDraft = {
  imageGenerationModels?: readonly ImageGenerationBinding[] | null;
  imageGeneration?: ImageGenerationBinding | null;
};

export type ImageGenerationDefaultPlan = {
  imageGenerationModels: ImageGenerationBinding[];
  imageGeneration: ImageGenerationBinding | null;
};

/**
 * The candidate list and active default a saved provider should leave behind.
 *
 * The saved provider's selection replaces its own earlier candidates, while the
 * candidates of other providers stay listed — the picker disables the ones that
 * no longer resolve. The active default moves only when the stored choice stops
 * resolving, and then to the first candidate that does, so a newly added
 * provider claims the default exactly when nothing else can hold it.
 */
export function planImageGenerationDefaults(
  current: ImageGenerationDefaultDraft,
  savedProviderId: string,
  selectedModelIds: readonly string[],
  providers: readonly ProviderPublic[],
): ImageGenerationDefaultPlan {
  const existing = imageGenerationBindings(
    current.imageGenerationModels,
    current.imageGeneration,
  );
  const selected = [...new Set(selectedModelIds)].map((modelId) => ({
    providerId: savedProviderId,
    modelId,
  }));
  const imageGenerationModels = [
    ...existing.filter((binding) => binding.providerId !== savedProviderId),
    ...selected,
  ];
  const active = current.imageGeneration ?? null;
  const fallback = imageGenerationModels.find((binding) =>
    resolvesImageGenerationDefault(binding, providers)
  ) ?? imageGenerationModels[0] ?? null;
  return {
    imageGenerationModels,
    imageGeneration: resolvesImageGenerationDefault(active, providers) ? active : fallback,
  };
}
