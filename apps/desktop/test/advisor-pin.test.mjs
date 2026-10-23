import assert from "node:assert/strict";
import test from "node:test";
import { advisorPinPatch, advisorPinStatus } from "../src/features/settings/advisor-pin.ts";

const offered = [
  { provider: { id: "openai" }, modelId: "gpt-5" },
  { provider: { id: "anthropic" }, modelId: "claude-sonnet" },
];

test("an empty pin is off, a pin the picker offers is listed, any other pin is unlisted", () => {
  assert.equal(advisorPinStatus({}, offered), "off");
  assert.equal(advisorPinStatus({ advisorProviderId: null, advisorModelId: null }, offered), "off");
  assert.equal(
    advisorPinStatus({ advisorProviderId: "openai", advisorModelId: "gpt-5" }, offered),
    "listed",
  );
  assert.equal(
    advisorPinStatus({ advisorProviderId: "openai", advisorModelId: "gpt-retired" }, offered),
    "unlisted",
  );
  assert.equal(
    advisorPinStatus({ advisorProviderId: "removed", advisorModelId: "gpt-5" }, offered),
    "unlisted",
  );
});

test("clearing writes null, and a cleared pin reads back as off", () => {
  // settings.set merges, so a cleared pin must overwrite the stored ids. An
  // empty provider id would instead name a provider that config sync cannot find.
  const cleared = advisorPinPatch("", "");
  assert.deepEqual(cleared, { advisorProviderId: null, advisorModelId: null });
  assert.equal(advisorPinStatus(cleared, offered), "off");
});

test("picking a model writes both ids", () => {
  assert.deepEqual(advisorPinPatch("openai", "gpt-5"), {
    advisorProviderId: "openai",
    advisorModelId: "gpt-5",
  });
});
