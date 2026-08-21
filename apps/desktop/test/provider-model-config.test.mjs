import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const cardSource = await readFile(
  new URL("../src/components/settings/ModelConfigCard.tsx", import.meta.url),
  "utf8",
);
const pickerSource = await readFile(
  new URL("../src/components/settings/ModelMultiSelect.tsx", import.meta.url),
  "utf8",
);
const hookSource = await readFile(
  new URL("../src/components/settings/useProviderModels.ts", import.meta.url),
  "utf8",
);
const styles = await loadStyles();

test("model configuration surfaces pi-ai vision and reasoning state per model", () => {
  assert.match(cardSource, /metadata\?: ModelInfo \| null/);
  assert.match(cardSource, /capabilities\.includes\("vision"\)/);
  assert.match(cardSource, /visionLabel/);
  assert.match(cardSource, /reasoningLabel/);
  assert.match(pickerSource, /model\.capabilities\.includes\("vision"\)/);
  assert.match(pickerSource, /visionLabel/);
});

test("model discovery also probes no-auth and local endpoints", () => {
  assert.match(hookSource, /new URL\(baseUrl\.trim\(\)\)/);
  assert.match(hookSource, /Discovery is also useful for local\/no-auth gateways/);
  assert.doesNotMatch(hookSource, /apiKey\.trim\(\)\.length > 0/);
});

test("model settings keep a compact, non-floating card treatment", () => {
  assert.match(styles, /.provider-model-card\s*\{[\s\S]*?border-radius: var\(--radius-md-plus\)/);
  assert.match(styles, /.provider-model-capabilities\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.provider-model-card:hover\s*\{[^}]*transform:\s*translateY/,
  );
});
