import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

const overlaySources = [
  "../src/components/settings/ProviderSetupDialog.tsx",
  "../src/components/settings/VendorAccountDialog.tsx",
  "../src/components/settings/VendorPickerDialog.tsx",
  "../src/components/settings/OAuthLoginDialog.tsx",
  "../src/components/settings/SkillEditorSheet.tsx",
  "../src/components/settings/SubagentEditorSheet.tsx",
  "../src/components/extensions/McpEditorSheet.tsx",
];

test("route entrance does not leave a transform containing block", async () => {
  const styles = await loadStyles();
  const start = styles.indexOf("@keyframes route-surface-in");
  assert.notEqual(start, -1, "missing @keyframes route-surface-in");
  const next = styles.indexOf("@keyframes", start + 1);
  const block = styles.slice(start, next === -1 ? undefined : next);
  assert.doesNotMatch(block, /transform:/);
  assert.match(block, /opacity:\s*0/);
});

test("settings overlays are fixed to the viewport and portaled to document.body", async () => {
  const styles = await loadStyles();
  const overlay = styles.match(/\.overlay \{[\s\S]*?\n\}/);
  assert.ok(overlay, "missing .overlay rule");
  assert.match(overlay[0], /position:\s*fixed/);
  assert.match(overlay[0], /inset:\s*0/);

  const ui = await read("../src/components/ui.tsx");
  assert.match(ui, /export function portalOverlay/);
  assert.match(ui, /createPortal\(node, document\.body\)/);

  for (const rel of overlaySources) {
    const source = await read(rel);
    assert.match(source, /portalOverlay\(/, `${rel} must portal its overlay`);
  }
});
