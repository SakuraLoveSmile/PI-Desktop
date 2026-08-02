import type {
  MessageUsage,
  ModelInfo,
  ProviderPublic,
  UiMessage,
} from "@pi-desktop/shared";

export const DEFAULT_CONTEXT_WINDOW = 128_000;

function positiveTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function usageTokenTotal(usage: MessageUsage): number {
  const reportedTotal = positiveTokenCount(usage.totalTokens);
  if (reportedTotal > 0) return reportedTotal;
  return positiveTokenCount(usage.inputTokens) + positiveTokenCount(usage.outputTokens);
}

export function latestMessageUsage(messages: UiMessage[]): MessageUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].usage) return messages[index].usage;
  }
  return undefined;
}

function modelContextWindow(model: ModelInfo | undefined): number | undefined {
  const value = positiveTokenCount(model?.contextWindow);
  return value > 0 ? value : undefined;
}

function providerContextWindow(provider: ProviderPublic | undefined): number | undefined {
  const value = positiveTokenCount(provider?.contextWindow);
  return value > 0 ? value : undefined;
}

export function resolveContextWindow(
  providerId: string | undefined,
  modelId: string | undefined,
  providerModels: Record<string, ModelInfo[]>,
  providers: ProviderPublic[],
): number {
  const catalogModel = modelId
    ? providerId
      ? providerModels[providerId]?.find((model) => model.modelId === modelId)
      : Object.values(providerModels)
          .flat()
          .find((model) => model.modelId === modelId)
    : undefined;
  const catalogWindow = modelContextWindow(catalogModel);
  if (catalogWindow) return catalogWindow;

  const providerWindow = providerContextWindow(
    providers.find((provider) => provider.id === providerId),
  );
  return providerWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export type ContextUsage = {
  usedTokens: number;
  remainingTokens: number;
  usedRatio: number;
  remainingRatio: number;
  usedPercent: number;
  remainingPercent: number;
};

export function calculateContextUsage(
  usage: MessageUsage,
  contextWindow: number,
): ContextUsage {
  const safeWindow = positiveTokenCount(contextWindow) || DEFAULT_CONTEXT_WINDOW;
  const usedTokens = usageTokenTotal(usage);
  const usedRatio = Math.min(1, usedTokens / safeWindow);
  const remainingRatio = 1 - usedRatio;
  const usedPercent = Math.round(usedRatio * 100);

  return {
    usedTokens,
    remainingTokens: Math.max(0, safeWindow - usedTokens),
    usedRatio,
    remainingRatio,
    usedPercent,
    remainingPercent: 100 - usedPercent,
  };
}
