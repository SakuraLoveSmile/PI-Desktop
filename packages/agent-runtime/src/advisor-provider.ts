import { OAUTH_AUTH_KIND } from "@pi-desktop/shared";
import type { RuntimeProviderConfig } from "./provider-binding.js";
import {
  bindProviderModel,
  type ProviderModelLookups,
  type SubagentProviderSource,
} from "./subagent-definitions.js";

/**
 * The Advisor pin from settings. Both fields stay absent until the user picks a
 * model, and an absent pin leaves the Advisor tool off.
 */
export type AdvisorModelSettings = {
  advisorProviderId?: unknown;
  advisorModelId?: unknown;
};

/** A provider row as the launch path reads it, with the models it has bound. */
export type AdvisorProviderSource = SubagentProviderSource & {
  models?: readonly { id: string }[];
};

export type AdvisorProviderResolution =
  | { status: "off" }
  | { status: "ready"; provider: RuntimeProviderConfig }
  | { status: "unavailable"; reason: string };

/**
 * Turn the Advisor pin into the provider binding its sidecar runs on.
 *
 * The pin is a preference, not a launch requirement. A provider that is
 * disabled, lost its key, or no longer offers the model resolves to
 * "unavailable" with a reason, and the session runs without the Advisor tool.
 */
export async function resolveAdvisorProvider(
  input: ProviderModelLookups & {
    settings: AdvisorModelSettings;
    providers: readonly AdvisorProviderSource[];
    getSecret: (providerId: string) => Promise<string | undefined>;
  },
): Promise<AdvisorProviderResolution> {
  const providerId = settingText(input.settings.advisorProviderId);
  const modelId = settingText(input.settings.advisorModelId);
  if (!providerId || !modelId) return { status: "off" };

  const row = input.providers.find((candidate) => candidate.id === providerId);
  if (!row) return unavailable(`no provider matches "${providerId}"`);
  if (row.enabled === false) return unavailable(`provider "${row.name}" is disabled`);
  // Match the bound id the way the host does: trimmed and case-insensitive.
  const binding = row.models?.find(
    (candidate) => candidate.id.trim().toLowerCase() === modelId.toLowerCase(),
  );
  if (!binding) return unavailable(`provider "${row.name}" does not offer "${modelId}"`);

  let apiKey = "";
  if (row.authKind !== OAUTH_AUTH_KIND) {
    try {
      apiKey = (await input.getSecret(row.id)) ?? "";
    } catch (error) {
      return unavailable(`reading the API key for "${row.name}" failed: ${errorText(error)}`);
    }
  }
  const bound = await bindProviderModel({
    provider: row,
    modelId: binding.id.trim(),
    apiKey,
    resolveVendorBinding: input.resolveVendorBinding,
    resolveModel: input.resolveModel,
  });
  return typeof bound === "string" ? unavailable(bound) : { status: "ready", provider: bound };
}

function unavailable(reason: string): AdvisorProviderResolution {
  return { status: "unavailable", reason };
}

function settingText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
