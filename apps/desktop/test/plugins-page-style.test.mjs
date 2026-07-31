import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const stylesSource = await loadStyles();

function pluginsSection(source) {
  const start = source.indexOf("/* ---- Plugins marketplace");
  assert.ok(start >= 0, "plugins marketplace section missing");
  return source.slice(start);
}

test("plugins page styles use design tokens in both themes", () => {
  const section = pluginsSection(stylesSource);

  // No blue-slate hardcodes / non-ds fallbacks from the old market CSS.
  for (const bad of [
    "#4f7cff",
    "#2a3144",
    "#9aa6bf",
    "#e8eefc",
    "#121826",
    "#0b1020",
    "#8df0c2",
    "var(--accent",
    "var(--text-primary",
    "var(--border-subtle",
    "var(--bg-elevated",
    "color-mix(in srgb",
  ]) {
    assert.equal(section.includes(bad), false, `leftover ${bad}`);
  }

  assert.match(section, /\.plugins-segment-btn\.active\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(section, /\.plugins-icon-btn\.is-bordered\s*\{[\s\S]*?--ds-border-default/);
  assert.match(section, /\.plugins-search\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(section, /\.plugins-modal\s*\{[\s\S]*?--ds-bg-elevated-opaque/);
  assert.match(section, /\.plugins-installed-mark\s*\{[\s\S]*?--ds-success/);
  assert.match(section, /:root\[data-theme="light"\] \.plugins-modal-backdrop/);
});

test("plugins page styles tier permission risk with semantic tokens", () => {
  const section = pluginsSection(stylesSource);

  assert.match(section, /\.plugins-perm-chip\.risk-high\s*\{[\s\S]*?--ds-warning/);
  assert.match(section, /\.plugins-risk-group\.risk-high\s*\{[\s\S]*?--ds-error/);
  assert.match(section, /\.plugins-hero\s*\{/);
  assert.match(section, /\.plugins-sheet\s*\{/);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\)/);
});

// The installed list lives in .settings-panel, which clips overflow for its
// rounded corners; the row overflow menu must not be clipped with it.
test("plugins installed list lets row menus escape the panel", () => {
  const section = pluginsSection(stylesSource);

  assert.match(section, /\.plugins-list\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(section, /\.plugins-row:first-child\s*\{[\s\S]*?border-top-left-radius/);
  assert.match(section, /\.plugins-row:last-child\s*\{[\s\S]*?border-bottom-left-radius/);
  assert.match(section, /\.plugins-menu\.is-up\s*\{[\s\S]*?bottom:\s*calc\(100% \+ 5px\)/);
});
