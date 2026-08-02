import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
const providerModelsSource = await readFile(
  new URL("../src/components/settings/useProviderModels.ts", import.meta.url),
  "utf8",
);

test("saved provider discovery persists models in the host catalog", () => {
  assert.match(mainSource, /req\.source === "cache"/);
  assert.match(mainSource, /"providers\.listModels"/);
  assert.match(mainSource, /"providers\.cacheModels"/);
  assert.match(mainSource, /const piModel = resolvePiModelConfig\(modelRef\)/);
  assert.match(
    mainSource,
    /contextWindow: piModel\?\.contextWindow \?\? model\.contextWindow/,
  );
  assert.match(mainSource, /usesSavedEndpoint/);
  assert.match(mainSource, /endpointStillCurrent/);
});

test("renderer hydrates cached models before refreshing the provider", () => {
  assert.match(storeSource, /source: "cache"/);
  assert.match(storeSource, /source: "refresh"/);
  assert.match(storeSource, /cachedProviderModels/);
  assert.match(storeSource, /refreshedProviderModels/);
  assert.match(storeSource, /providerModelsGeneration/);
  assert.match(storeSource, /Keep the cached catalog/);
});

test("saved provider dialog keeps cached options while revalidating", () => {
  assert.match(providerModelsSource, /source: "cache"/);
  assert.match(providerModelsSource, /status: "loading", models: cachedModels/);
  assert.match(providerModelsSource, /status: "error", models: cachedModels/);
});
