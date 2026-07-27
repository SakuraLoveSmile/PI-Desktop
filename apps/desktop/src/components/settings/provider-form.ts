import type { ProviderPublic } from "@pi-desktop/shared";

export function hostFromBaseUrl(baseUrl?: string | null): string {
  if (!baseUrl) return "—";
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").split("/")[0] || baseUrl;
  }
}

export const API_STYLE_OPTIONS = [
  ["chat_completions", "settings.apiStyleChatCompletions"],
  ["responses", "settings.apiStyleResponses"],
  ["anthropic_messages", "settings.apiStyleAnthropic"],
  ["google_generative_ai", "settings.apiStyleGoogle"],
] as const;

export type ApiStyle = (typeof API_STYLE_OPTIONS)[number][0];

export function normalizeApiStyle(value?: string | null): ApiStyle {
  return API_STYLE_OPTIONS.some(([style]) => style === value)
    ? (value as ApiStyle)
    : "chat_completions";
}

export type ProviderForm = {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  apiStyle: ApiStyle;
};

export const EMPTY_PROVIDER_FORM: ProviderForm = {
  name: "",
  baseUrl: "",
  modelId: "",
  apiKey: "",
  apiStyle: "chat_completions",
};

export function formFromProvider(provider: ProviderPublic): ProviderForm {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl ?? "",
    modelId: provider.defaultModelId ?? "",
    apiKey: "",
    apiStyle: normalizeApiStyle(provider.apiStyle),
  };
}
