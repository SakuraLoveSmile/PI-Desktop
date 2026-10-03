import assert from "node:assert/strict";
import test from "node:test";
import { bindingFromModelInfo } from "@pi-desktop/shared";
import { modelInfoFromModelsDev, parseModelsDevCatalog } from "../electron/main/models-dev-catalog.ts";

const effort = (...values) => ({ type: "effort", values });
const budget = { type: "budget_tokens", min: 1024 };
const reasoningModel = (id, reasoningOptions) => [
  id,
  { id, name: id, reasoning: true, reasoning_options: reasoningOptions, limit: { context: 200_000, output: 64_000 } },
];

// Offline fixture shaped like the public models.dev document: the published
// reasoning options are the only input the catalog may use to pick a protocol.
const providers = parseModelsDevCatalog({
  anthropic: {
    name: "Anthropic",
    api: "https://api.anthropic.com",
    models: Object.fromEntries([
      reasoningModel("claude-opus-4-7", [effort("low", "medium", "high", "xhigh", "max")]),
      reasoningModel("claude-opus-5", [effort("low", "medium", "high", "xhigh", "max")]),
      reasoningModel("claude-sonnet-4-6", [effort("low", "medium", "high", "max"), budget]),
      reasoningModel("claude-opus-4-5", [effort("low", "medium", "high"), budget]),
      reasoningModel("claude-haiku-4-5", [budget]),
      reasoningModel("claude-sonnet-4-5", [budget]),
    ]),
  },
  openai: {
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: Object.fromEntries([reasoningModel("gpt-6.1-sol", [effort("low", "medium", "high")])]),
  },
});

function infoFor(providerKey, modelId) {
  const model = providers.find((provider) => provider.providerKey === providerKey)?.models.find(
    (candidate) => candidate.modelId === modelId,
  );
  assert.ok(model, `the fixture publishes ${providerKey}/${modelId}`);
  return modelInfoFromModelsDev(model, "row");
}

test("a Claude model models.dev publishes with effort and no budget carries the adaptive protocol", () => {
  for (const modelId of ["claude-opus-4-7", "claude-opus-5"]) {
    assert.equal(infoFor("anthropic", modelId).thinkingProtocol, "adaptive", modelId);
  }
});

test("a Claude model that still publishes thinking budgets has no published protocol", () => {
  for (const modelId of ["claude-sonnet-4-6", "claude-opus-4-5", "claude-haiku-4-5", "claude-sonnet-4-5"]) {
    assert.equal(infoFor("anthropic", modelId).thinkingProtocol, undefined, modelId);
  }
});

test("a binding seeded from the catalog keeps the published protocol", () => {
  assert.equal(bindingFromModelInfo(infoFor("anthropic", "claude-opus-4-7")).thinkingProtocol, "adaptive");
  assert.equal("thinkingProtocol" in bindingFromModelInfo(infoFor("anthropic", "claude-haiku-4-5")), false);
});

test("a model of another wire API never reports a protocol", () => {
  assert.equal(infoFor("openai", "gpt-6.1-sol").thinkingProtocol, undefined);
});
