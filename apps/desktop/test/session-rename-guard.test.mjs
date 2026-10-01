import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import ts from "typescript";
import { ErrorCodes } from "../../../packages/shared/src/errors.ts";
import { IPC } from "../../../packages/shared/src/protocol.ts";

function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

const { registerSessionIpc } = load("../electron/main/ipc/session-ipc.ts", {
  electron: { shell: {} },
  "node:fs": fs,
  "node:path": path,
  "@pi-desktop/shared": { ErrorCodes, IPC },
  "../importers": {},
  "../services/session-collaboration": { readSessionCollaboration: async () => null },
  "../services/session-search": { searchSessionsAcrossSources: async () => ({ hits: [], nextOffset: null }) },
});

function harness() {
  const handlers = new Map();
  const calls = [];
  registerSessionIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => ({
      call: async (method, input) => {
        calls.push({ method, input });
        return { ok: true };
      },
    }),
    getSidecar: () => null,
    dataDir: "/tmp/pi-desktop-test",
    activeTurns: new Map(),
    sessionProjects: new Map(),
    persistenceOutbox: { dropSession: async () => undefined },
    logger: { app: () => undefined },
    plugins: { broadcastEvent: () => undefined },
    sessionCapabilityContext: async () => ({ providers: [], defaults: {} }),
    enrichSession: (session) => session,
    acquireSessionOperation: async () => () => undefined,
    stripWinLongPrefix: (value) => value,
  });
  return { handle: handlers.get(IPC.invoke.sessionRename), calls };
}

test("unguarded session rename preserves its existing Host input", async () => {
  const { handle, calls } = harness();
  await handle("session-1", "New title");
  assert.deepEqual(calls, [{
    method: "session.rename",
    input: { id: "session-1", title: "New title" },
  }]);
});

test("guarded local rename forwards only the title and execution compare fields", async () => {
  const { handle, calls } = harness();
  await handle("session-1", "New title", {
    expectedTitle: "Current title",
    expectedExecutionId: "execution-1",
  });
  assert.deepEqual(calls, [{
    method: "session.rename",
    input: {
      id: "session-1",
      title: "New title",
      expectedTitle: "Current title",
      expectedExecutionId: "execution-1",
    },
  }]);
});

test("guarded remote and native renames are rejected before Host mutation", async () => {
  for (const id of ["remote:host:session", "native-pi:session"]) {
    const { handle, calls } = harness();
    await assert.rejects(
      handle(id, "New title", { expectedTitle: "Current title", expectedExecutionId: null }),
      { errorCode: ErrorCodes.INVALID_ARGUMENT },
    );
    assert.equal(calls.length, 0);
  }
});

test("malformed guarded rename is rejected without forwarding caller fields", async () => {
  const { handle, calls } = harness();
  await assert.rejects(
    handle("session-1", "New title", {
      expectedTitle: "Current title",
      unexpected: "forward me",
    }),
    { errorCode: ErrorCodes.INVALID_ARGUMENT },
  );
  assert.equal(calls.length, 0);
});
