import type { ModelConfig } from "./thinking-level.js";

const capabilities = [
  "supportsMidConvoSystemMessages", "supportsMidConvoToolAdditions",
  "supportsMidConvoToolChanges", "supportsAdditionalTools", "supportsToolSearch",
] as const;

function endpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

/** Catalog capabilities describe one model/API/endpoint, never a vendor label. */
export function transcriptCompat(
  catalog: ModelConfig | undefined, modelId: string, api: string, baseUrl: string,
): Record<(typeof capabilities)[number], boolean> {
  const binding = catalog?.transcriptBinding;
  const address = endpoint(baseUrl);
  const verified = catalog?.source === "pi" && binding?.modelId === modelId &&
    binding.api === api && address !== undefined && endpoint(binding.baseUrl) === address;
  return Object.fromEntries(capabilities.map((key) => [key, verified && catalog?.compat?.[key] === true])) as
    Record<(typeof capabilities)[number], boolean>;
}
