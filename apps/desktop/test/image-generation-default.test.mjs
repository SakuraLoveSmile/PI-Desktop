/**
 * Behavioural tests for the app's default image model across a provider save.
 *
 * `settings.imageGeneration` is the app default the Composer reads, while
 * `settings.imageGenerationModels` is only the candidate list the picker
 * offers. Adding a provider extends that list, so these tests pin that the
 * user's default survives an added provider and moves only when the stored
 * choice stops resolving.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

// The renderer module resolves its sibling through the bundler, not Node.
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { planImageGenerationDefaults, resolvesImageGenerationDefault } = await import(
  "../src/components/settings/image-generation-default.ts"
);

const provider = (id, modelIds) => ({
  id,
  name: id,
  enabled: true,
  hasSecret: true,
  hasOauth: false,
  authKind: "api_key_and_base_url",
  models: modelIds.map((modelId) => ({ id: modelId })),
});

const binding = (providerId, modelId) => ({ providerId, modelId });

test("a saved image selection extends the candidates without taking the default", () => {
  const plan = planImageGenerationDefaults(
    {
      imageGenerationModels: [binding("x", "img-x")],
      imageGeneration: binding("x", "img-x"),
    },
    "y",
    ["img-y"],
    [provider("x", ["img-x"]), provider("y", ["img-y"])],
  );
  assert.deepEqual(plan.imageGenerationModels, [
    binding("x", "img-x"),
    binding("y", "img-y"),
  ]);
  assert.deepEqual(plan.imageGeneration, binding("x", "img-x"));
});

test("a legacy default stored without a candidate list is kept too", () => {
  const plan = planImageGenerationDefaults(
    { imageGeneration: binding("x", "img-x") },
    "y",
    ["img-y"],
    [provider("x", ["img-x"]), provider("y", ["img-y"])],
  );
  assert.deepEqual(plan.imageGeneration, binding("x", "img-x"));
});

test("a default that no longer resolves gives way to a provider that does", () => {
  // The image provider was deleted while its binding stayed in settings: a
  // newly added provider with image models is what should fill that default.
  const plan = planImageGenerationDefaults(
    {
      imageGenerationModels: [binding("gone", "img-gone")],
      imageGeneration: binding("gone", "img-gone"),
    },
    "y",
    ["img-y"],
    [provider("y", ["img-y"])],
  );
  assert.deepEqual(plan.imageGenerationModels, [
    binding("gone", "img-gone"),
    binding("y", "img-y"),
  ]);
  assert.deepEqual(plan.imageGeneration, binding("y", "img-y"));
});

test("an unconfigured default is filled by the saved selection", () => {
  const plan = planImageGenerationDefaults(
    { imageGenerationModels: [], imageGeneration: null },
    "y",
    ["img-y", "img-y", "img-y-alt"],
    [provider("y", ["img-y", "img-y-alt"])],
  );
  // A repeated pick collapses, so the picker shows one row per model.
  assert.deepEqual(plan.imageGenerationModels, [
    binding("y", "img-y"),
    binding("y", "img-y-alt"),
  ]);
  assert.deepEqual(plan.imageGeneration, binding("y", "img-y"));
});

test("editing a provider replaces its own candidates only", () => {
  const plan = planImageGenerationDefaults(
    {
      imageGenerationModels: [binding("x", "img-x"), binding("y", "img-y-old")],
      imageGeneration: binding("x", "img-x"),
    },
    "y",
    ["img-y-new"],
    [provider("x", ["img-x"]), provider("y", ["img-y-new"])],
  );
  assert.deepEqual(plan.imageGenerationModels, [
    binding("x", "img-x"),
    binding("y", "img-y-new"),
  ]);
  assert.deepEqual(plan.imageGeneration, binding("x", "img-x"));
});

test("resolving follows the provider row, not the candidate list", () => {
  assert.equal(resolvesImageGenerationDefault(null, [provider("x", ["img-x"])]), false);
  assert.equal(
    resolvesImageGenerationDefault(binding("x", "img-x"), [provider("x", ["img-x"])]),
    true,
  );
  // Another provider serving the same id is not the configured one.
  assert.equal(
    resolvesImageGenerationDefault(binding("x", "img-x"), [provider("z", ["img-x"])]),
    false,
  );
  // A model the provider no longer lists cannot hold the default.
  assert.equal(
    resolvesImageGenerationDefault(binding("x", "img-x"), [provider("x", ["other"])]),
    false,
  );
  // An OAuth-style row that stores only the legacy id still resolves.
  const legacy = { ...provider("x", []), defaultModelId: "img-x" };
  assert.equal(resolvesImageGenerationDefault(binding("x", "img-x"), [legacy]), true);
});
