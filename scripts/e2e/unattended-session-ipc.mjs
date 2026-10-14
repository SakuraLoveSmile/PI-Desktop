/** Register the production session IPC handlers without launching Electron.
 * Only unrelated import/search/UI dependencies are replaced; exercised
 * create/configure/get/getTurn handlers and MCP routing are production code.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import * as shared from "../../packages/shared/dist/index.js";

export function unattendedSessionHandlers(root, { getHost, getSidecar, dataDir }) {
  const file = path.join(root, "apps/desktop/electron/main/ipc/session-ipc.ts");
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
  });
  const dependencies = {
    electron: { shell: {} }, "node:fs": fs, "node:path": path, "@pi-desktop/shared": shared,
    "../importers": {},
    "../services/session-collaboration": {}, "../services/session-search": {},
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected session IPC dependency: ${id}`);
    return dependencies[id];
  }, module.exports, module);
  const handlers = new Map();
  module.exports.registerSessionIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost, getSidecar, dataDir, activeTurns: new Map(), sessionProjects: new Map(),
    persistenceOutbox: { dropSession() {} }, logger: { app() {} }, plugins: { broadcastEvent() {} },
    sessionCapabilityContext: async () => ({ providers: [], defaults: {} }),
    enrichSession: session => session,
    acquireSessionOperation: async () => { throw new Error("Session-operation IPC is outside this fixture"); },
    stripWinLongPrefix: value => value,
  });
  return handlers;
}
