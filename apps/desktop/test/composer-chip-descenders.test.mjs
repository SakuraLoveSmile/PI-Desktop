import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composerSource = await readFile(
  new URL("../src/components/Composer.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

function ruleBlock(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector} rule`);
  // Prefer the layout rule (height: 28px) when color-only overrides exist first.
  let idx = start;
  while (idx !== -1) {
    const open = source.indexOf("{", idx);
    const close = source.indexOf("}", open);
    const block = source.slice(idx, close + 1);
    if (block.includes("height: 28px")) return block;
    idx = source.indexOf(`${selector} {`, close + 1);
  }
  throw new Error(`no 28px layout rule for ${selector}`);
}

test("model chip label avoids leading-none under truncation", () => {
  assert.match(composerSource, /className="model-chip-label text-sm"/);
  assert.doesNotMatch(
    composerSource,
    /model-chip-label[^"]*leading-none|truncate text-sm leading-none/,
  );
});

test("composer runtime chips keep compact line-height for descenders", () => {
  for (const selector of [".mode-chip", ".model-chip"]) {
    const block = ruleBlock(styles, selector);
    assert.match(block, /line-height:\s*var\(--leading-compact\);/);
    assert.match(block, /overflow:\s*visible;/);
  }

  assert.match(
    styles,
    /\.model-chip-label\s*\{[\s\S]*?max-width:\s*190px;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/,
  );
  assert.match(
    styles,
    /\.mode-chip > span,\s*\.model-chip > span,\s*\.model-chip-label\s*\{[\s\S]*?line-height:\s*var\(--leading-compact\);/,
  );
});
