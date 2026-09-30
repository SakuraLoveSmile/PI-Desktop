import { readComposerModule, readComposerSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composerSource = await readComposerSource();
const composerToolbarSource = await readComposerModule("ComposerToolbar.tsx");
const composerPermissionPickerSource = await readComposerModule("ComposerPermissionPicker.tsx");
const settingsSource = await readFile(
  new URL("../src/features/settings/SettingsPage.tsx", import.meta.url),
  "utf8",
);

test("Composer toolbar removes the direct permission trigger", () => {
  assert.doesNotMatch(composerToolbarSource, /<ComposerPermissionPicker/);
  assert.doesNotMatch(composerToolbarSource, /composer-permission/);
});

test("ComposerPermissionPicker presents only effective selectable modes", () => {
  assert.match(
    composerPermissionPickerSource,
    /\["ask", "accept-edits", "auto"\] as const/,
  );
  assert.match(
    composerPermissionPickerSource,
    /aria-checked=\{composerPermissionMode === candidate\}/,
  );
  assert.match(
    composerPermissionPickerSource,
    /\{t\(PERMISSION_MODE_I18N_KEYS\[candidate\]\)\}/,
  );
  assert.doesNotMatch(composerPermissionPickerSource, /permissionInherit/);
  assert.doesNotMatch(composerPermissionPickerSource, /\["inherit",/);
});

test("Settings Page provides session permission override status and reset to default", () => {
  assert.match(settingsSource, /settings\.defaultPermissionMode \?\? "ask"/);
  assert.match(settingsSource, /activeSession\.permissionMode && activeSession\.permissionMode !== "inherit"/);
  assert.match(settingsSource, /permissionMode: "inherit"/);
});

test("Composer preserves session permission mode across profile and mode changes", () => {
  assert.match(
    composerToolbarSource,
    /permissionMode: sessionPermissionMode,/,
  );
});
