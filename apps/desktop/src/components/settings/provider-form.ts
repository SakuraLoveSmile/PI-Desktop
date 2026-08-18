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
  ["openai_codex_responses", "settings.apiStyleCodexResponses"],
  ["pi_messages", "settings.apiStylePiMessages"],
] as const;

/**
 * The styles a hand-configured provider may pick. The two vendor-account wire
 * APIs are excluded: they only ever come from a signed-in subscription (the
 * Codex conversation envelope, the radius gateway), and neither works with a
 * pasted key against a base URL the user typed.
 */
export const CUSTOM_API_STYLE_OPTIONS = API_STYLE_OPTIONS.filter(
  ([style]) => style !== "openai_codex_responses" && style !== "pi_messages",
);

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
