import assert from "node:assert/strict";
import test from "node:test";

import { composerModelsForProvider } from "../src/lib/composer-models.ts";

const binding = (id) => ({
  id,
  contextWindow: 128_000,
  maxTokens: 8_192,
  thinkingLevels: [],
  defaultThinkingLevel: null,
});

const model = (modelId, displayName = modelId) => ({
  modelId,
  displayName,
  providerId: "mimo",
  capabilities: ["text"],
  source: "discovered",
});

test("Composer only lists models configured for the provider", () => {
  const models = composerModelsForProvider(
    {
      id: "mimo",
      models: [binding("claude-opus-4-6"), binding("x-ai/grok-4.6")],
    },
    [
      model("aws/claude-fable-5-006"),
      model("claude-opus-4-6", "Claude Opus 4.6"),
      model("x-ai/grok-4.6", "Grok 4.6"),
    ],
  );

  assert.deepEqual(
    models.map(({ modelId, displayName }) => ({ modelId, displayName })),
    [
      { modelId: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      { modelId: "x-ai/grok-4.6", displayName: "Grok 4.6" },
    ],
  );
});

test("configured models remain selectable when discovery is unavailable", () => {
  const models = composerModelsForProvider(
    {
      id: "custom",
      models: [binding("my-model-v2")],
    },
    undefined,
  );

  assert.equal(models.length, 1);
  assert.equal(models[0].modelId, "my-model-v2");
  assert.equal(models[0].displayName, "my-model-v2");
});

test("legacy providers fall back to their default model binding", () => {
  const models = composerModelsForProvider(
    { id: "legacy", models: [], defaultModelId: "legacy-model" },
    [model("legacy-model", "Legacy model")],
  );

  assert.deepEqual(models.map((item) => item.modelId), ["legacy-model"]);
  assert.equal(models[0].displayName, "Legacy model");
});
