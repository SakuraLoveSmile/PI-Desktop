import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidecarSource = await readFile(
  new URL("../electron/main/agent-sidecar.ts", import.meta.url),
  "utf8",
);
const hostSource = await readFile(
  new URL("../electron/main/host-process.ts", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const apiSource = await readFile(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);

test("sidecar detaches host listeners and gates every child write", () => {
  assert.match(sidecarSource, /private closeTransport\(error: Error\)/);
  assert.match(sidecarSource, /unsubscribeHostExit/);
  assert.match(sidecarSource, /private writeToChild\(payload: string\)/);
  assert.match(sidecarSource, /private localToolTimers = new Set/);
  assert.match(sidecarSource, /this\.localToolTimers\.clear\(\)/);
  assert.match(sidecarSource, /this\.child\.stdin\.destroyed/);
  assert.doesNotMatch(
    sidecarSource.replace(/private writeToChild\([\s\S]*?\n  \}/, ""),
    /this\.child\.stdin\.write\(/,
  );
});

test("host transport closes pending calls and listeners on process death", () => {
  assert.match(hostSource, /private closed = false/);
  assert.match(hostSource, /this\.handlers\.clear\(\)/);
  assert.match(hostSource, /if \(this\.closed\) throw new Error\("host-core is unavailable"\)/);
  assert.match(hostSource, /private notifyExit\(/);
});

test("settings writes validate without applying read defaults", () => {
  assert.match(mainSource, /validatePlanApprovalSettingsWrite\(settings\)/);
  assert.match(mainSource, /host\.call\("settings\.set", validatedSettings\)/);
  assert.doesNotMatch(mainSource, /host\.call\("settings\.set", normalizedSettings\)/);
  assert.match(apiSource, /export function validateSettingsWrite/);
  assert.match(apiSource, /invoke\(IPC\.invoke\.settingsSet, validateSettingsWrite\(settings\)\)/);
  assert.match(mainSource, /hasOwnProperty\.call\(value, "defaultCommandShell"\)/);
  assert.match(mainSource, /COMMAND_SHELL_INVALID/);
  assert.match(mainSource, /hasOwnProperty\.call\(value, "planApprovalPermissionMode"\)/);
  assert.match(mainSource, /PLAN_PERMISSION_MODE_INVALID/);
  assert.match(apiSource, /hasOwnProperty\.call\(value, "defaultCommandShell"\)/);
  assert.match(apiSource, /hasOwnProperty\.call\(value, "planApprovalPermissionMode"\)/);
});
