import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

test("work panel uses a quiet light-theme inset surface", () => {
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.work-panel\s*\{[\s\S]*?background:\s*#fafafa/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.work-panel-header\s*\{[\s\S]*?background:\s*#ffffff/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.work-panel-rail\s*\{[\s\S]*?background:\s*#f5f5f5/,
  );
  assert.match(
    styles,
    /\.work-panel-rail-button\.active\s*\{[\s\S]*?background:\s*var\(--ds-bg-active\)/,
  );
});

test("work panel interactive rows ease hover fills with motion tokens", () => {
  for (const selector of [
    ".file-tree-row",
    ".diff-file-header",
    ".work-panel-resize",
    ".work-browser-url input",
  ]) {
    const re = new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*?transition:[\\s\\S]*?var\\(--motion-duration-fast\\)`,
    );
    assert.match(styles, re, `${selector} should transition with motion tokens`);
  }
});

test("settings and form controls gain light-theme surfaces", () => {
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.field-input[\s\S]*?background:\s*#f5f5f5/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.settings-toggle\.on\s+\.settings-toggle-thumb\s*\{[\s\S]*?background:\s*#ffffff/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.settings-segment\s*\{[\s\S]*?background:\s*color-mix/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.shortcut-keybinding\s+kbd\s*\{[\s\S]*?background:\s*#f5f5f5/,
  );
  assert.match(
    styles,
    /:root\[data-theme="light"\]\s+\.overlay\s*\{[\s\S]*?background:\s*color-mix\(in oklab,\s*#1a1c1f 28%/,
  );
});
