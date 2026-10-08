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
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";

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
      const home = join(ctx.scenarioRoot, "native-home");
      const agentDir = join(home, ".pi", "agent");
      const nativeRoot = join(agentDir, "sessions", "fixture");
      await mkdir(nativeRoot, { recursive: true });
      const nativeFile = join(nativeRoot, "native.jsonl");
      const nativeContent = "原生审查证据🦜".repeat(80_000);
      const nativeEntries = [
        { type: "session", version: 3, id: "native-chunk-fixture", timestamp: "2026-10-08T06:00:00Z", cwd: ctx.workspace },
        { type: "message", id: "native-older", parentId: null, timestamp: "2026-10-08T06:00:01Z",
          message: { role: "user", content: "Earlier native evidence", timestamp: 1 } },
        { type: "custom", id: "native-context", parentId: "native-older", timestamp: "2026-10-08T06:00:02Z",
          customType: "fixture", data: { preserved: true } },
        { type: "message", id: "native-large", parentId: "native-context", timestamp: "2026-10-08T06:00:03Z",
          message: { role: "assistant", content: [{ type: "text", text: nativeContent }], timestamp: 3,
            provider: "fixture", model: "fixture", stopReason: "stop" } },
      ];
      const nativeBytes = Buffer.from(nativeEntries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
      fs.writeFileSync(nativeFile, nativeBytes);
      const launchNative = () => new AgentSidecar({
        launch: { command: process.execPath, args: [join(root, "packages/agent-runtime/dist/sidecar.js")],
          cwd: ctx.scenarioRoot, env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agentDir,
            PI_DESKTOP_DATA_DIR: ctx.dataDir } },
        onStderr: text => { if (process.env.DEBUG_SESSION_CHUNK) process.stderr.write(text); },
      });
      let sidecar;
      const handlers = new Map();
      const { registerSessionIpc } = loadSessionIpc();
      registerSessionIpc({
        registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
        getHost: () => ctx.host, getSidecar: () => sidecar, dataDir: ctx.dataDir,
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
        sidecar = launchNative();
        const [native] = (await sidecar.call("native.session.list", {})).sessions;
        assert.ok(native?.id.startsWith("native-pi:"));
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
        const nativeBaseline = await call("pi_session_get", { id: native.id, messageLimit: 1 });
        assert.equal(nativeBaseline.isError, undefined, JSON.stringify(nativeBaseline.structuredContent));
        assert.equal(nativeBaseline.structuredContent.truncated, true);
        let nativeOffset = 0; let nativeHash; let nativeTotal; const nativeParts = [];
        do {
          const result = await call("pi_session_get_chunk", { id: native.id, offset: nativeOffset,
            ...(nativeHash ? { expectedSha256: nativeHash } : {}) });
          assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
          const chunk = result.structuredContent;
          nativeHash ??= chunk.sha256; nativeTotal ??= chunk.totalBytes;
          assert.equal(chunk.sha256, nativeHash); assert.equal(chunk.totalBytes, nativeTotal);
          assert.equal(chunk.sessionId, native.id); assert.equal(chunk.offset, nativeOffset);
          const part = Buffer.from(chunk.chunk, "base64");
          assert.ok(part.length > 0 && part.length <= 64 * 1024);
          assert.equal(nativeOffset + part.length, chunk.nextOffset ?? nativeTotal);
          nativeParts.push(part); nativeOffset = chunk.nextOffset;
        } while (nativeOffset !== null);
        const nativePageBytes = Buffer.concat(nativeParts);
        assert.equal(nativePageBytes.length, nativeTotal);
        assert.equal(createHash("sha256").update(nativePageBytes).digest("hex"), nativeHash);
        const nativePage = JSON.parse(nativePageBytes.toString("utf8")).session;
        assert.equal(nativePage.messageCount, 2);
        assert.equal(nativePage.messageStart, 1); assert.equal(nativePage.messageEnd, 2);
        assert.equal(nativePage.hasMoreBefore, true); assert.equal(nativePage.hasMoreAfter, false);
        assert.equal(nativePage.messages[0].content, nativeContent);
        const nativeOlder = await call("pi_session_get_chunk", { id: native.id, messageBefore: nativePage.messageStart });
        assert.equal(nativeOlder.isError, undefined);
        const nativeOlderPage = JSON.parse(Buffer.from(nativeOlder.structuredContent.chunk, "base64").toString("utf8")).session;
        assert.equal(nativeOlderPage.messages[0].content, "Earlier native evidence");
        assert.equal(nativeOlderPage.messageStart, 0); assert.equal(nativeOlderPage.messageEnd, 1);
        assert.equal(nativeOlderPage.hasMoreBefore, false); assert.equal(nativeOlderPage.hasMoreAfter, true);
        const nativeEmpty = await call("pi_session_get_chunk", { id: native.id, messageBefore: nativeOlderPage.messageStart });
        assert.equal(nativeEmpty.isError, undefined);
        const nativeEmptyPage = JSON.parse(Buffer.from(nativeEmpty.structuredContent.chunk, "base64").toString("utf8")).session;
        assert.deepEqual(nativeEmptyPage.messages, []);
        assert.equal(nativeEmptyPage.messageStart, 0); assert.equal(nativeEmptyPage.messageEnd, 0);
        assert.equal(nativeEmptyPage.hasMoreBefore, false); assert.equal(nativeEmptyPage.hasMoreAfter, true);
        const nativeClamped = await call("pi_session_get_chunk", { id: native.id, messageBefore: 20, expectedSha256: nativeHash });
        assert.equal(nativeClamped.isError, undefined);
        assert.equal(nativeClamped.structuredContent.sha256, nativeHash);
        await sidecar.dispose();
        sidecar = launchNative();
        const [reopenedNative] = (await sidecar.call("native.session.list", {})).sessions;
        assert.equal(reopenedNative.id, native.id);
        const nativeRestarted = await call("pi_session_get_chunk", { id: native.id, messageBefore: 2, expectedSha256: nativeHash });
        assert.equal(nativeRestarted.isError, undefined);
        assert.equal(nativeRestarted.structuredContent.sha256, nativeHash);
        assert.deepEqual(fs.readFileSync(nativeFile), nativeBytes);
        console.log(`PASS E2E-MCP-SESSION-CHUNK-NATIVE: real isolated sidecar + production session IPC + authenticated MCP; ${nativeTotal} UTF-8 bytes, ${nativeParts.length} chunks; older/empty/clamped pages + sidecar restart; JSONL unchanged`);
      } finally {
        try { await server.stop(); }
        finally { await sidecar?.dispose(); }
      }
    }, binary, tempRoot);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}
await main();
