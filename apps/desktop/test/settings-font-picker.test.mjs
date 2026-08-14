import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const rowSource = await readFile(
  new URL("../src/components/settings/FontFamilyRow.tsx", import.meta.url),
  "utf8",
);
const styles = await loadStyles();

test("font picker menu portals to the body so the settings card cannot clip it", () => {
  assert.match(rowSource, /createPortal\(/);
  assert.match(rowSource, /document\.body/);
  assert.match(styles, /\.settings-font-menu\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.settings-font-menu\.is-open\s*\{/);
  assert.doesNotMatch(
    styles,
    /\.settings-font-menu\s*\{[^}]*position:\s*absolute;/s,
  );
});

test("selecting System default persists an empty stack so the override clears", () => {
  assert.match(rowSource, /saveSettings\(value \? \{ fontFamily: value \} : \{ fontFamily: "" \}\)/);
  assert.doesNotMatch(rowSource, /fontFamily: undefined/);
});
