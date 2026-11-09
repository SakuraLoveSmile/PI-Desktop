import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const {
  resolveDefaultUpdatePreference,
  resolveUpdateDelivery,
  resolveUpdateMode,
  supportsAutomaticUpdates,
} = await import("../electron/main/update-policy.ts");

test("an ad-hoc macOS build supports in-app updates only when the assisted lane can serve it", () => {
  assert.equal(supportsAutomaticUpdates("darwin", true, {}, "adhoc", true), true);
  assert.equal(supportsAutomaticUpdates("darwin", true, {}, "adhoc", false), false);
  assert.equal(supportsAutomaticUpdates("darwin", true, {}, "adhoc"), false);
  // Only a build that carries the ad-hoc stamp can use the lane.
  assert.equal(supportsAutomaticUpdates("darwin", true, {}, "unknown", true), false);
  assert.equal(supportsAutomaticUpdates("darwin", false, {}, "adhoc", true), false);
  // Other platforms ignore the flag.
  assert.equal(supportsAutomaticUpdates("linux", true, {}, "adhoc", true), false);
  assert.equal(supportsAutomaticUpdates("win32", true, {}, "unknown", false), true);
});

test("the assisted lane is opt-in: the default stays manual and Automatic enables it", () => {
  assert.equal(resolveDefaultUpdatePreference("darwin", true, {}, undefined, "adhoc", true), "manual");
  assert.equal(resolveUpdateMode("darwin", true, {}, undefined, undefined, "adhoc", true), "manual");
  assert.equal(
    resolveUpdateMode("darwin", true, {}, undefined, "manual", "adhoc", true),
    "manual",
  );
  assert.equal(
    resolveUpdateMode("darwin", true, {}, undefined, "automatic", "adhoc", true),
    "in-app",
  );
  // A location the lane cannot serve keeps the old behaviour whatever is stored.
  assert.equal(
    resolveUpdateMode("darwin", true, {}, undefined, "automatic", "adhoc", false),
    "manual",
  );
  // Developer ID installs are untouched.
  assert.equal(
    resolveDefaultUpdatePreference("darwin", true, {}, undefined, "developer-id", false),
    "automatic",
  );
});

test("delivery names the assisted lane for eligible ad-hoc installs only", () => {
  assert.equal(resolveUpdateDelivery("darwin", true, "adhoc", true), "assisted");
  assert.equal(resolveUpdateDelivery("darwin", true, "adhoc", false), undefined);
  assert.equal(resolveUpdateDelivery("darwin", true, "developer-id", true), undefined);
  assert.equal(resolveUpdateDelivery("darwin", true, "unknown", true), undefined);
  assert.equal(resolveUpdateDelivery("darwin", false, "adhoc", true), undefined);
  assert.equal(resolveUpdateDelivery("win32", true, "adhoc", true), undefined);
  assert.equal(resolveUpdateDelivery("linux", true), undefined);
});
