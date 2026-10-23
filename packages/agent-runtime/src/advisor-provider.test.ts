import { describe, expect, it, vi } from "vitest";
import { OAUTH_AUTH_KIND } from "@pi-desktop/shared";
import { resolveAdvisorProvider, type AdvisorProviderSource } from "./advisor-provider.js";
import { capabilitiesFromModelConfig, genericModelConfig } from "./model-capabilities.js";

type AdvisorInput = Parameters<typeof resolveAdvisorProvider>[0];

const apiKeyRow: AdvisorProviderSource = {
  id: "openai",
  name: "OpenAI",
  authKind: "api_key",
  apiStyle: "openai-chat",
  baseUrl: "https://api.example.test/v1",
  enabled: true,
  models: [{ id: "gpt-a" }],
};

const vendorRow: AdvisorProviderSource = {
  id: "vendor",
  name: "Vendor",
  authKind: OAUTH_AUTH_KIND,
  enabled: true,
  models: [{ id: "vendor-model" }],
};

function advisorInput(settings: Record<string, unknown>, overrides: Partial<AdvisorInput> = {}): AdvisorInput {
  return {
    settings,
    providers: [apiKeyRow, vendorRow],
    getSecret: async (providerId) => (providerId === "openai" ? "sk-test" : undefined),
    ...overrides,
  };
}

describe("resolveAdvisorProvider", () => {
  it("stays off until both the provider and the model are pinned", async () => {
    expect(await resolveAdvisorProvider(advisorInput({}))).toEqual({ status: "off" });
    expect(await resolveAdvisorProvider(advisorInput({ advisorProviderId: "openai", advisorModelId: "  " })))
      .toEqual({ status: "off" });
  });

  it("binds a pinned API-key model under the id the provider lists", async () => {
    const result = await resolveAdvisorProvider(advisorInput({ advisorProviderId: "openai", advisorModelId: " GPT-A " }));

    expect(result).toMatchObject({
      status: "ready",
      provider: { id: "openai", modelId: "gpt-a", apiKey: "sk-test", authKind: "api_key", baseUrl: "https://api.example.test/v1" },
    });
  });

  it.each([
    ["an unknown provider", { advisorProviderId: "missing", advisorModelId: "gpt-a" }, {}, 'no provider matches "missing"'],
    [
      "a disabled provider",
      { advisorProviderId: "openai", advisorModelId: "gpt-a" },
      { providers: [{ ...apiKeyRow, enabled: false }] },
      'provider "OpenAI" is disabled',
    ],
    [
      "a model the provider no longer offers",
      { advisorProviderId: "openai", advisorModelId: "gpt-z" },
      {},
      'provider "OpenAI" does not offer "gpt-z"',
    ],
    [
      "a missing API key",
      { advisorProviderId: "openai", advisorModelId: "gpt-a" },
      { getSecret: async () => undefined },
      'provider "OpenAI" has no API key',
    ],
    [
      "an API key that cannot be read",
      { advisorProviderId: "openai", advisorModelId: "gpt-a" },
      { getSecret: async () => { throw new Error("keychain locked"); } },
      'reading the API key for "OpenAI" failed: keychain locked',
    ],
    [
      "a vendor account with no binding for the model",
      { advisorProviderId: "vendor", advisorModelId: "vendor-model" },
      {},
      'vendor account "Vendor" does not offer "vendor-model"',
    ],
  ])("reports %s as unavailable with the reason", async (_name, settings, overrides, reason) => {
    expect(await resolveAdvisorProvider(advisorInput(settings, overrides))).toEqual({ status: "unavailable", reason });
  });

  it("binds a vendor account through its signed-in binding without reading an API key", async () => {
    const getSecret = vi.fn(async () => "unused");
    const result = await resolveAdvisorProvider(advisorInput(
      { advisorProviderId: "vendor", advisorModelId: "vendor-model" },
      {
        getSecret,
        resolveVendorBinding: async (_provider, modelId) => {
          const modelConfig = genericModelConfig(modelId, "https://vendor.example.test/v1");
          return {
            apiStyle: "openai-chat",
            baseUrl: "https://vendor.example.test/v1",
            modelConfig,
            ...capabilitiesFromModelConfig(modelConfig),
          };
        },
      },
    ));

    expect(result).toMatchObject({
      status: "ready",
      provider: { id: "vendor", authKind: OAUTH_AUTH_KIND, apiKey: "", modelId: "vendor-model" },
    });
    expect(getSecret).not.toHaveBeenCalled();
  });
});
