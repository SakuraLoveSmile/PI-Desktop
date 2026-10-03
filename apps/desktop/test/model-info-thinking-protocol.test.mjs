import assert from "node:assert/strict";
import test from "node:test";
import { bindingFromModelInfo } from "@pi-desktop/shared";
import { ModelsDevCatalog, modelInfoFromModelsDev } from "../electron/main/models-dev-catalog.ts";

const catalog = new ModelsDevCatalog();
await catalog.ensureLoaded();

function infoFor(modelId) {
  const model = catalog.findModel({ vendorKey: "anthropic", modelId });
  assert.ok(model, `Pi publishes ${modelId}`);
  return modelInfoFromModelsDev(model, "row");
}

test("a Claude model Pi publishes as adaptive-only carries the adaptive protocol", () => {
  for (const modelId of ["claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-5"]) {
    assert.equal(infoFor(modelId).thinkingProtocol, "adaptive", modelId);
  }
});

test("a Claude model that still takes thinking budgets has no published protocol", () => {
  for (const modelId of ["claude-haiku-4-5", "claude-opus-4-5", "claude-sonnet-4-5"]) {
    assert.equal(infoFor(modelId).thinkingProtocol, undefined, modelId);
  }
});

test("a binding seeded from the catalog keeps the published protocol", () => {
  assert.equal(bindingFromModelInfo(infoFor("claude-opus-4-7")).thinkingProtocol, "adaptive");
  assert.equal("thinkingProtocol" in bindingFromModelInfo(infoFor("claude-haiku-4-5")), false);
});

test("a model of another wire API never reports a protocol", () => {
  const model = catalog.findModel({ vendorKey: "openai", modelId: "gpt-6.1-sol" });
  assert.ok(model, "Pi publishes gpt-6.1-sol");
  assert.equal(modelInfoFromModelsDev(model, "row").thinkingProtocol, undefined);
});
