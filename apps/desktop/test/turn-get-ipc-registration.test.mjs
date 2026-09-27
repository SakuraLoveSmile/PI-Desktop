import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sessionIpc = readFileSync(
  fileURLToPath(new URL("../electron/main/ipc/session-ipc.ts", import.meta.url)),
  "utf8",
);
const turnGetHandler =
  sessionIpc.match(/handle\(\s*IPC\.invoke\.turnGet,[\s\S]*?\n  \);/)?.[0] ?? "";

test("turn/get registers once and validates both ownership keys", () => {
  assert.equal([...sessionIpc.matchAll(/handle\(\s*IPC\.invoke\.turnGet/g)].length, 1);
  assert.match(turnGetHandler, /sessionId required[\s\S]*?errorCode: "INVALID_PARAMS"/);
  assert.match(turnGetHandler, /turnId required[\s\S]*?errorCode: "INVALID_PARAMS"/);
  assert.match(turnGetHandler, /host\.call\("session\.getTurn", \{ sessionId, turnId \}\)/);
});
