import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const styles = await loadStyles();

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
    /\.work-panel-context\s*\{[\s\S]*?display:\s*flex/,
  );
  assert.match(
    styles,
    /\.work-panel-create-item\.active\s*\{[\s\S]*?background:\s*var\(--ds-bg-active\)/,
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

test("switch on-track outranks the per-theme off-track", () => {
  /*
    A `:root[data-theme="light"] .settings-toggle` background declaration scores
    (0,3,0) and out-specifies `.settings-toggle.on` at (0,2,0), which strands the
    light theme on the pale off fill so only the knob slides. Off-track colours
    therefore live in the theme token blocks, not on this selector.
  */
  assert.doesNotMatch(
    styles,
    /:root\[data-theme="(light|dark)"\]\s+\.settings-toggle\s*\{[^}]*background:/,
  );
  assert.match(
    styles,
    /\.settings-toggle\s*\{[^}]*background:\s*var\(--ds-switch-track-off\)/,
  );
  assert.match(
    styles,
    /\.settings-toggle\.on\s*\{[^}]*background:\s*var\(--ds-accent\)/,
  );
  // Off state keeps a hairline ring so the empty track still reads as a control.
  assert.match(
    styles,
    /\.settings-toggle\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--ds-switch-ring-off\)/,
  );
  // Both themes must define the switch tokens, or one falls back to nothing.
  for (const token of [
    "--ds-switch-track-off",
    "--ds-switch-track-off-hover",
    "--ds-switch-ring-off",
    "--ds-switch-knob-off",
    "--ds-switch-knob-on",
  ]) {
    const defs = styles.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
    assert.equal(defs.length, 2, `${token} should be defined in both themes`);
  }
});
