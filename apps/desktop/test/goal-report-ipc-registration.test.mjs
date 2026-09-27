import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const registration = read("../electron/main/ipc/register.ts");
const handler = read("../electron/main/ipc/goal-report-ipc.ts");

test("Goal report get, list, and retry handlers are registered with Electron IPC", () => {
  assert.equal(
    [...registration.matchAll(/registerGoalReportIpc\(/g)].length,
    1,
  );
  assert.match(registration, /registerGoalReportIpc\(\{\s*handle,\s*getHost\s*\}\)/);
  assert.match(handler, /handle\(IPC\.invoke\.goalReportGet/);
  assert.match(handler, /handle\(IPC\.invoke\.goalReportList/);
  assert.match(handler, /handle\(IPC\.invoke\.goalReportRetry/);
  assert.match(handler, /host\.call\("goalReports\.retry"/);
});
