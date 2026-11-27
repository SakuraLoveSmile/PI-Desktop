import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const renderer = await import("../src/lib/api.ts");
const { createProviderCatalogRuntime } = await import("../electron/main/runtime/provider-catalog.ts");
const main = createProviderCatalogRuntime({ getHost: () => null, modelsDevCatalog: {} });

test("settings read-modify-write preserves disabled retry and unrelated preferences", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { piDesktop: { platform: "win32" } };
  try {
    for (const stored of [{}, { infiniteProviderRetry: false }, { infiniteProviderRetry: true }]) {
      const original = { defaultMode: "agent", theme: "light", ...stored };
      const received = structuredClone(main.normalizeSettings(original));
      const displayed = renderer.normalizeSettings(received);
      const edited = { ...displayed, imageGeneration: { providerId: "images", modelId: "image" } };
      const outgoing = renderer.validateSettingsWrite(edited);
      const persisted = main.validateSettingsWrite(structuredClone(outgoing));
      assert.equal(persisted.infiniteProviderRetry, stored.infiniteProviderRetry === true);
      assert.equal(persisted.theme, "light");
      assert.deepEqual(persisted.imageGeneration, edited.imageGeneration);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("invalid retry writes stay rejected at both boundaries", () => {
  for (const value of [undefined, null, "yes", 0, {}]) {
    const settings = { infiniteProviderRetry: value };
    assert.throws(() => renderer.validateSettingsWrite(settings), /infiniteProviderRetry is invalid/);
    assert.throws(() => main.validateSettingsWrite(settings), /infiniteProviderRetry is invalid/);
  }
});

test("the session summary setting stays absent until chosen and only booleans are written", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { piDesktop: { platform: "win32" } };
  try {
    // Absent means on: loading and saving unrelated preferences must not write a choice nobody made.
    const received = structuredClone(main.normalizeSettings({ defaultMode: "agent", theme: "light" }));
    const displayed = renderer.normalizeSettings(received);
    assert.equal(Object.hasOwn(displayed, "autoSummarizeSessions"), false);
    assert.equal(Object.hasOwn(renderer.validateSettingsWrite(displayed), "autoSummarizeSessions"), false);
    for (const value of [true, false]) {
      const outgoing = renderer.validateSettingsWrite({ autoSummarizeSessions: value });
      assert.equal(main.validateSettingsWrite(structuredClone(outgoing)).autoSummarizeSessions, value);
    }
    for (const value of [undefined, null, "yes", 0, {}]) {
      assert.throws(() => renderer.validateSettingsWrite({ autoSummarizeSessions: value }), /autoSummarizeSessions is invalid/);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
