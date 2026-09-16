/**
 * Icon-only control geometry.
 *
 * `.icon-btn` is shared with label-driven pills, so its width comes from its
 * content — glyph plus padding — and an icon-only use must state the square
 * explicitly (`.icon-btn-square`). These are source contracts; the layout E2E
 * measures the rendered rectangles.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const styles = await loadStyles();

/**
 * Files that host icon-only `.icon-btn` controls. Every `.icon-btn` line in
 * them is either icon-only (and therefore square) or a label-driven chip. Add a
 * file here when it starts using `.icon-btn` for an icon-only control.
 */
const ICON_BUTTON_FILES = [
  "../src/components/Sidebar.tsx",
  "../src/features/chat/composer/ComposerToolbar.tsx",
  "../src/components/workpanel/FilesTab.tsx",
  "../src/pages/PullRequestsPage.tsx",
  "../src/components/settings/ModelConfigPage.tsx",
];

/** Label-driven controls: their width is their text, not a square target. */
const CHIP_CLASSES = /mode-chip|composer-model-thinking-chip/;

async function readSources() {
  return Promise.all(
    ICON_BUTTON_FILES.map(async (path) => [
      path,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  );
}

const squareRule = () =>
  styles.match(/\.icon-btn\.icon-btn-square\s*\{[^}]*\}/)?.[0] ?? "";

test("the square variant pins both axes and drops the label padding", () => {
  assert.match(styles, /--ds-control-size:\s*28px/);
  const rule = squareRule();
  assert.ok(rule, ".icon-btn.icon-btn-square rule is missing");
  assert.match(rule, /width:\s*var\(--ds-control-size\);/);
  assert.match(rule, /height:\s*var\(--ds-control-size\);/);
  // A crowded toolbar row must not shrink the control back out of square.
  assert.match(rule, /flex:\s*0 0 var\(--ds-control-size\);/);
  // Under the global `border-box`, keeping the 8px side padding would leave a
  // 12px content box for a 15px glyph.
  assert.match(rule, /padding:\s*0;/);
});

test("composer-right no longer widens its icon-only controls", () => {
  const rule =
    styles.match(/\.composer-right \.icon-btn\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(rule, ".composer-right .icon-btn rule is missing");
  assert.doesNotMatch(rule, /padding/);
});

test("the enhancing state leaves the square geometry for its label", () => {
  // It carries the label while enhancing, so it must outrank
  // `.icon-btn.icon-btn-square` — by classes in the selector, not `!important`.
  const rule =
    styles.match(
      /\.icon-btn\.composer-enhance-btn\.is-loading\s*\{[^}]*\}/,
    )?.[0] ?? "";
  assert.ok(rule, "the labelled enhancing state rule is missing");
  assert.match(rule, /flex:\s*0 0 auto;/);
  assert.match(rule, /padding-inline:\s*8px;/);
});

test("every icon-only .icon-btn states the square", async () => {
  for (const [path, source] of await readSources()) {
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.includes("icon-btn")) continue;
      if (CHIP_CLASSES.test(line)) continue;
      assert.match(
        line,
        /icon-btn-square/,
        `${path}:${index + 1} is an icon-only control without .icon-btn-square`,
      );
    }
  }
});
