import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateToolTokenUsage,
  calculateTokenRate,
  calculateContextUsage,
  estimateToolTokenUsage,
  resolveContextWindow,
  toolTokenUsage,
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

test("generation throughput uses provider output and stream duration", () => {
  assert.equal(calculateTokenRate(1_200, 4_000), 300);
  assert.equal(calculateTokenRate(0, 4_000), undefined);
  assert.equal(calculateTokenRate(1_200, undefined), undefined);
});

test("tool usage exposes argument and result estimates", () => {
  const message = {
    id: "tool-1",
    role: "tool",
    content: "result text",
    createdAt: new Date().toISOString(),
    toolName: "read",
    toolArgs: { path: "src/index.ts" },
    toolResult: { content: [{ type: "text", text: "result text" }] },
  };
  const usage = estimateToolTokenUsage(message);

  assert.ok(usage.argumentTokens > 0);
  assert.ok(usage.resultTokens > 0);
  assert.equal(usage.totalTokens, usage.argumentTokens + usage.resultTokens);
  assert.equal(usage.estimated, true);
  assert.deepEqual(toolTokenUsage({ ...message, toolUsage: usage }), usage);
});

test("tool usage aggregates repeated calls in first-seen order", () => {
  const messages = [
    {
      id: "tool-1",
      role: "tool",
      content: "first result",
      createdAt: new Date().toISOString(),
      toolName: "read",
      toolUsage: {
        argumentTokens: 10,
        resultTokens: 20,
        totalTokens: 30,
        estimated: true,
      },
      toolDurationMs: 100,
    },
    {
      id: "tool-2",
      role: "tool",
      content: "second result",
      createdAt: new Date().toISOString(),
      toolName: "bash",
      toolUsage: {
        argumentTokens: 4,
        resultTokens: 6,
        totalTokens: 10,
        estimated: true,
      },
      toolDurationMs: 250,
    },
    {
      id: "tool-3",
      role: "tool",
      content: "third result",
      createdAt: new Date().toISOString(),
      toolName: "read",
      toolUsage: {
        argumentTokens: 7,
        resultTokens: 13,
        totalTokens: 20,
        estimated: true,
      },
      toolDurationMs: 300,
    },
  ];

  assert.deepEqual(aggregateToolTokenUsage(messages), [
    {
      toolName: "read",
      callCount: 2,
      argumentTokens: 17,
      resultTokens: 33,
      totalTokens: 50,
      durationMs: 400,
      estimated: true,
    },
    {
      toolName: "bash",
      callCount: 1,
      argumentTokens: 4,
      resultTokens: 6,
      totalTokens: 10,
      durationMs: 250,
      estimated: true,
    },
  ]);
});
