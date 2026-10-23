import assert from "node:assert/strict";
import test from "node:test";
import { enhancementPinPatch } from "../src/features/settings/enhancement-pin.ts";

test("following the Composer clears both pin ids to null", () => {
  // settings.set merges, so a cleared pin must overwrite the stored ids. An
  // empty provider id would instead name a provider that config sync cannot find.
  assert.deepEqual(enhancementPinPatch("", ""), {
    promptEnhancementProviderId: null,
    promptEnhancementModelId: null,
  });
});

test("picking a model writes both ids", () => {
  assert.deepEqual(enhancementPinPatch("openai", "gpt-5"), {
    promptEnhancementProviderId: "openai",
    promptEnhancementModelId: "gpt-5",
  });
});
