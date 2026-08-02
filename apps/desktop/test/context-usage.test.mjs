import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateContextUsage,
  resolveContextWindow,
  usageTokenTotal,
} from "../src/lib/context-usage.ts";

test("context usage exposes the remaining ring percentage", () => {
  const context = calculateContextUsage(
    {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    },
    128,
  );

  assert.equal(context.usedTokens, 100);
  assert.equal(context.remainingTokens, 28);
  assert.equal(context.usedPercent, 78);
  assert.equal(context.remainingPercent, 22);
  assert.equal(context.remainingRatio, 28 / 128);
});

test("context window prefers the selected model catalog over provider fallback", () => {
  const providerModels = {
    provider: [
      {
        modelId: "catalog-model",
        displayName: "Catalog model",
        providerId: "provider",
        contextWindow: 256_000,
        capabilities: ["text"],
        source: "discovered",
      },
    ],
  };
  const providers = [{ id: "provider", contextWindow: 64_000 }];

  assert.equal(
    resolveContextWindow("provider", "catalog-model", providerModels, providers),
    256_000,
  );
  assert.equal(
    resolveContextWindow("provider", "unknown-model", providerModels, providers),
    64_000,
  );
});

test("context usage falls back to input and output when total is absent", () => {
  assert.equal(
    usageTokenTotal({ inputTokens: 12, outputTokens: 8, totalTokens: 0 }),
    20,
  );
});
