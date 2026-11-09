#!/usr/bin/env node
/**
 * Builds the macOS update helper that ships inside the app bundle
 * (`Contents/Resources/bin/pi-desktop-update-helper`, ADR
 * plus-assisted-macos-adhoc-update). Other platforms do not package it, so the
 * script does nothing there and the shared `dist`/`pack` scripts stay portable.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.log(`[update-helper] ${process.platform} does not package the update helper; skipped`);
  process.exit(0);
}

const result = spawnSync(
  "cargo",
  ["build", "--release", "--manifest-path", join(root, "Cargo.toml"), "-p", "update-helper"],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(`[update-helper] cannot run cargo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
