#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import { ErrorCodes } from "../packages/shared/src/errors.ts";
import { IPC } from "../packages/shared/src/protocol.ts";
import { createSession } from "./e2e/session.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
register(pathToFileURL(join(root, "apps/desktop/test/helpers/ts-import-hooks.mjs")));
const { McpControlServer } = await import("../apps/desktop/electron/main/mcp-control.ts");

const channels = {
  appGetVersion: "pi-desktop/app/getVersion",
  projectSet: "pi-desktop/project/set",
  sessionGet: "pi-desktop/session/get",
  turnGet: IPC.invoke.turnGet,
  sessionCreate: "pi-desktop/session/create",
  sessionDelete: "pi-desktop/session/delete",
  sessionConfigure: "pi-desktop/session/configure",
  plansResolve: "pi-desktop/plans/resolve",
  agentPrompt: "pi-desktop/agent/prompt",
};

function loadSessionIpc() {
  const file = join(root, "apps/desktop/electron/main/ipc/session-ipc.ts");
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: file,
  });
  const shared = { ErrorCodes, IPC };
  const dependencies = {
    electron: { shell: {} },
    "node:fs": fs,
    "node:path": path,
    "@pi-desktop/shared": shared,
    "../importers": {},
    "../services/session-collaboration": { readSessionCollaboration: async () => ({}) },
    "../services/session-search": { searchSessionsAcrossSources: async () => ({ hits: [], nextOffset: null }) },
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(dependencies, id), `unexpected session IPC dependency: ${id}`);
      return dependencies[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

async function post(url, token, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return { response, body: raw ? JSON.parse(raw) : null };
}


async function main() {
  const binary = resolveHostBinary();
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-e2e-session-chunk-"));
  try {
    await withScenario("E2E-MCP-SESSION-CHUNK", async (ctx) => {
      const handlers = new Map();
      const { registerSessionIpc } = loadSessionIpc();
      registerSessionIpc({
        registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
        getHost: () => ctx.host, getSidecar: () => null, dataDir: ctx.dataDir,
        activeTurns: new Map(), sessionProjects: new Map(),
        persistenceOutbox: { dropSession() {} }, logger: { app() {} },
        plugins: { broadcastEvent() {} },
        sessionCapabilityContext: async () => ({ providers: [], defaults: {} }),
        enrichSession: (session) => session, acquireSessionOperation: async () => () => {},
        stripWinLongPrefix: (path) => path,
      });
      const handler = handlers.get(IPC.invoke.sessionGet);
      assert.equal(typeof handler, "function");
      const server = new McpControlServer({
        dataDir: join(ctx.scenarioRoot, "mcp-control"), port: 0, version: "test", channels,
        invoke: (channel, args) => {
          assert.equal(channel, IPC.invoke.sessionGet);
          return handler(args[0]);
        },
      });
      try {
        const info = await server.start();
        const initialized = await post(info.url, info.token, { jsonrpc: "2.0", id: 1, method: "initialize" });
        const headers = { "Mcp-Session-Id": initialized.response.headers.get("mcp-session-id") };
        let rpcId = 2;
        const call = async (name, input) => {
          const result = await post(info.url, info.token, { jsonrpc: "2.0", id: rpcId++,
            method: "tools/call", params: { name, arguments: input } }, headers);
          assert.equal(result.response.status, 200);
          return result.body.result;
        };
        const session = await createSession(ctx.host, ctx.workspace, "Lossless review transcript");
        for (const [id, content] of [["older", "Earlier evidence"], ["large", "审查证据🦜".repeat(180_000)]]) {
          await ctx.host.call("session.appendMessage", { sessionId: session.id,
            message: { id, role: "assistant", content, createdAt: "2026-10-08T06:00:00Z", status: "complete" } });
        }
        const baseline = await call("pi_session_get", { id: session.id, messageBefore: 2, messageLimit: 1 });
        assert.equal(baseline.structuredContent.truncated, true);
        let offset = 0; let sha256; let totalBytes; const parts = [];
        do {
          const result = await call("pi_session_get_chunk", { id: session.id, messageBefore: 2, offset,
            ...(sha256 ? { expectedSha256: sha256 } : {}) });
          assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
          const chunk = result.structuredContent;
          assert.equal(chunk.sessionId, session.id);
          assert.equal(chunk.offset, offset);
          sha256 ??= chunk.sha256; totalBytes ??= chunk.totalBytes;
          assert.equal(chunk.sha256, sha256); assert.equal(chunk.totalBytes, totalBytes);
          const bytes = Buffer.from(chunk.chunk, "base64");
          assert.ok(bytes.length <= 64 * 1024 && bytes.length > 0);
          parts.push(bytes);
          if (chunk.nextOffset !== null) assert.equal(chunk.nextOffset, offset + bytes.length);
          else assert.equal(offset + bytes.length, totalBytes);
          offset = chunk.nextOffset;
        } while (offset !== null);
        const bytes = Buffer.concat(parts);
        assert.equal(bytes.length, totalBytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
        const actual = JSON.parse(bytes.toString("utf8"));
        assert.equal(actual.session.id, session.id);
        assert.equal(actual.session.messageStart, 1);
        assert.equal(actual.session.messageEnd, 2);
        assert.equal(actual.session.hasMoreBefore, true);
        assert.equal(actual.session.messages[0].content, "审查证据🦜".repeat(180_000));
        const older = await call("pi_session_get_chunk", { id: session.id, messageBefore: actual.session.messageStart });
        const olderPage = JSON.parse(Buffer.from(older.structuredContent.chunk, "base64").toString("utf8"));
        assert.equal(olderPage.session.messages[0].content, "Earlier evidence");
        assert.equal(olderPage.session.hasMoreBefore, false);
        await ctx.host.restart();
        const afterRestart = await call("pi_session_get_chunk", { id: session.id, messageBefore: 2, expectedSha256: sha256 });
        assert.equal(afterRestart.isError, undefined);
        assert.equal(afterRestart.structuredContent.sha256, sha256);
        console.log(`PASS E2E-MCP-SESSION-CHUNK: real isolated Host + production session IPC + authenticated MCP; ${totalBytes} UTF-8 bytes, ${parts.length} chunks; older page + restart`);
      } finally { await server.stop(); }
    }, binary, tempRoot);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}
await main();
