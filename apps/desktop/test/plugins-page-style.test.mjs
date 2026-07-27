import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

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

  assert.match(section, /\.plugins-tab\.active\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(section, /\.plugins-action\s*\{[\s\S]*?--ds-border-default/);
  assert.match(section, /\.plugins-search\s*\{[\s\S]*?--ds-text-primary/);
  assert.match(section, /\.plugins-modal\s*\{[\s\S]*?--ds-bg-elevated-opaque/);
  assert.match(section, /\.plugins-badge\s*\{[\s\S]*?--ds-success/);
  assert.match(section, /:root\[data-theme="light"\] \.plugins-modal-backdrop/);
});
