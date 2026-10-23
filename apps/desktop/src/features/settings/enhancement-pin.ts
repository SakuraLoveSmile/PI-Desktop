import type { AppSettings } from "@pi-desktop/shared";

type EnhancementPinSettings = Pick<
  AppSettings,
  "promptEnhancementProviderId" | "promptEnhancementModelId"
>;

/**
 * The pin patch for the enhancement model row (ADR 0121).
 *
 * Following the Composer writes null for both ids. settings.set merges into the
 * stored object, so an omitted key would keep the old pin, and an empty string
 * names a provider that does not exist, which config sync refuses to apply on
 * another device. The runtime reads null and an empty id alike as "follow".
 */
export function enhancementPinPatch(providerId: string, modelId: string): EnhancementPinSettings {
  if (!providerId) return { promptEnhancementProviderId: null, promptEnhancementModelId: null };
  return { promptEnhancementProviderId: providerId, promptEnhancementModelId: modelId };
}
