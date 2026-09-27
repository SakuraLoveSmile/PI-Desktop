import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  askToolOptionDescription,
  askToolOptionLabel,
  normalizeAskToolOption,
} from "../../../packages/shared/src/types/agent.ts";

const cardSource = await readFile(
  new URL("../src/components/AskToolCard.tsx", import.meta.url),
  "utf8",
);
const styleSource = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("asktool keeps legacy strings and normalizes rich labels and descriptions", () => {
  const legacy = normalizeAskToolOption("  Web  ");
  const rich = normalizeAskToolOption({
    label: "  Desktop  ",
    description: "  Installed on your computer.  ",
  });
  assert.equal(legacy, "Web");
  assert.deepEqual(rich, {
    label: "Desktop",
    description: "Installed on your computer.",
  });
  assert.equal(normalizeAskToolOption({ label: "  " }), undefined);
  assert.equal(askToolOptionLabel(rich), "Desktop");
  assert.equal(askToolOptionDescription(rich), "Installed on your computer.");
  assert.equal(askToolOptionDescription(legacy), undefined);
});

test("asktool card presents descriptions without changing the selected answer", () => {
  assert.match(cardSource, /askToolOptionLabel\(option\)/);
  assert.match(cardSource, /askToolOptionDescription\(option\)/);
  assert.match(cardSource, /onClick=\{\(\) => selectOption\(label\)\}/);
  assert.match(cardSource, /className="asktool-option-description"/);
  assert.match(styleSource, /\.asktool-option-description\s*\{/);
});
