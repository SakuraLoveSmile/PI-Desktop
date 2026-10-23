/**
 * Pin state for the Advisor model row (docs/spec/03-runtime/04-advisor-tool.md).
 *
 * A pin is "off" when either key is empty, "listed" when the picker offers the
 * pinned model, and "unlisted" when it does not. An unlisted pin is kept: launch
 * decides whether it can run, and a main session without a runnable pin runs
 * without the tool.
 *
 * Clearing writes null. settings.set merges into the stored object, so an
 * omitted key would keep the old pin, and an empty string names a provider that
 * does not exist, which config sync refuses to apply on another device.
 */
import { modelWireIdsEqual, type AppSettings } from "@pi-desktop/shared";

export type AdvisorPinStatus = "off" | "listed" | "unlisted";

type AdvisorPinSettings = Pick<AppSettings, "advisorProviderId" | "advisorModelId">;

export function advisorPinStatus(
  settings: AdvisorPinSettings,
  offered: readonly { provider: { id: string }; modelId: string }[],
): AdvisorPinStatus {
  const providerId = settings.advisorProviderId ?? "";
  const modelId = settings.advisorModelId ?? "";
  if (!providerId || !modelId) return "off";
  const listed = offered.some(
    (option) =>
      option.provider.id === providerId && modelWireIdsEqual(modelId, option.modelId),
  );
  return listed ? "listed" : "unlisted";
}

export function advisorPinPatch(providerId: string, modelId: string): AdvisorPinSettings {
  if (!providerId) return { advisorProviderId: null, advisorModelId: null };
  return { advisorProviderId: providerId, advisorModelId: modelId };
}
