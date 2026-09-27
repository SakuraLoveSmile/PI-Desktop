#!/usr/bin/env node
import assert from "node:assert/strict";
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
import { beginTurn, createSession, endTurn } from "./e2e/session.mjs";
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
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-e2e-turn-get-"));
  const results = [];
  const record = (id, detail) => {
    results.push(id);
    console.log(`PASS ${id} - ${detail}`);
  };

  try {
    await withScenario("E2E-TURN-GET", async (ctx) => {
      const handlers = new Map();
      const { registerSessionIpc } = loadSessionIpc();
      registerSessionIpc({
        registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
        getHost: () => ctx.host,
        getSidecar: () => null,
        dataDir: ctx.dataDir,
        activeTurns: new Map(),
        sessionProjects: new Map(),
        persistenceOutbox: { dropSession() {} },
        logger: { app() {} },
        plugins: { broadcastEvent() {} },
        sessionCapabilityContext: async () => ({ providers: [], defaults: {} }),
        enrichSession: (session) => session,
        acquireSessionOperation: async () => () => {},
        stripWinLongPrefix: (path) => path,
      });

      const turnGetHandler = handlers.get(IPC.invoke.turnGet);
      assert.equal(typeof turnGetHandler, "function");
      const controlDir = join(ctx.scenarioRoot, "mcp-control");
      await mkdir(controlDir, { recursive: true });
      const server = new McpControlServer({
        dataDir: controlDir,
        port: 0,
        version: "test",
        channels,
        invoke: async (channel, args) => {
          assert.equal(channel, IPC.invoke.turnGet);
          return turnGetHandler(args[0]);
        },
      });

      try {
        const info = await server.start();
        assert.ok(info);
        const initialized = await post(info.url, info.token, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        });
        assert.equal(initialized.response.status, 200);
        const mcpSessionId = initialized.response.headers.get("mcp-session-id");
        assert.ok(mcpSessionId);
        const sessionHeaders = { "Mcp-Session-Id": mcpSessionId };

        const listed = await post(
          info.url,
          info.token,
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          sessionHeaders,
        );
        const tool = listed.body.result.tools.find((candidate) => candidate.name === "pi_turn_get");
        assert.ok(tool);
        assert.deepEqual(tool.inputSchema.required, ["sessionId", "turnId"]);
        assert.equal(tool.inputSchema.additionalProperties, false);

        const described = await post(
          info.url,
          info.token,
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "pi_control_describe", arguments: {} },
          },
          sessionHeaders,
        );
        const operation = described.body.result.structuredContent.find(
          (entry) => entry.id === "turn/get",
        );
        assert.equal(operation.risk, "read");

        const call = async (id, input) => {
          const result = await post(
            info.url,
            info.token,
            {
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: "pi_turn_get", arguments: input },
            },
            sessionHeaders,
          );
          assert.equal(result.response.status, 200);
          return result.body.result;
        };
        const session = await createSession(ctx.host, ctx.workspace, "Turn state owner");
        const otherSession = await createSession(ctx.host, ctx.workspace, "Other turn owner");
        const completedTurn = await beginTurn(ctx.host, session.id);
        const running = await call(4, { sessionId: session.id, turnId: completedTurn });
        assert.equal(running.structuredContent.status, "running");
        assert.equal(running.structuredContent.endedAt, undefined);

        const missingSession = await call(5, { turnId: completedTurn });
        assert.equal(missingSession.isError, true);
        assert.equal(missingSession.structuredContent.error.code, ErrorCodes.INVALID_PARAMS);
        const missing = await call(16, { sessionId: session.id });
        assert.equal(missing.isError, true);
        assert.equal(missing.structuredContent.error.code, ErrorCodes.INVALID_PARAMS);
        const blank = await call(6, { sessionId: session.id, turnId: "  " });
        assert.equal(blank.isError, true);
        assert.equal(blank.structuredContent.error.code, ErrorCodes.INVALID_PARAMS);
        const blankSession = await call(15, { sessionId: "  ", turnId: completedTurn });
        assert.equal(blankSession.isError, true);
        assert.equal(blankSession.structuredContent.error.code, ErrorCodes.INVALID_PARAMS);

        const hidden = await call(7, { sessionId: otherSession.id, turnId: completedTurn });
        assert.equal(hidden.isError, true);
        assert.equal(hidden.structuredContent.error.code, ErrorCodes.NOT_FOUND);
        assert.equal(hidden.structuredContent.error.message.includes(session.id), false);
        assert.equal(hidden.structuredContent.error.message.includes(otherSession.id), false);
        const unknown = await call(8, { sessionId: session.id, turnId: "missing-turn" });
        assert.equal(unknown.isError, true);
        assert.equal(unknown.structuredContent.error.code, ErrorCodes.NOT_FOUND);
        assert.equal(unknown.structuredContent.error.message.includes(session.id), false);
        record("E2E-TURN-GET-001", "read risk, schema, IPC validation, session isolation");

        await endTurn(ctx.host, completedTurn, "completed");
        const errorTurn = await beginTurn(ctx.host, session.id);
        await ctx.host.call("session.endTurn", {
          turnId: errorTurn,
          status: "error",
          errorCode: "PROVIDER_ERROR",
          createNotification: false,
        });
        const abortedTurn = await beginTurn(ctx.host, session.id);
        await ctx.host.call("session.endTurn", {
          turnId: abortedTurn,
          status: "aborted",
          errorCode: "TURN_ABORTED",
          createNotification: false,
        });

        const completed = await call(9, { sessionId: session.id, turnId: completedTurn });
        const errored = await call(10, { sessionId: session.id, turnId: errorTurn });
        const aborted = await call(11, { sessionId: session.id, turnId: abortedTurn });
        assert.equal(completed.structuredContent.status, "completed");
        assert.equal(errored.structuredContent.status, "error");
        assert.equal(errored.structuredContent.errorCode, "PROVIDER_ERROR");
        assert.equal(aborted.structuredContent.status, "aborted");
        assert.equal(aborted.structuredContent.errorCode, "TURN_ABORTED");
        for (const turn of [completed, errored, aborted]) {
          assert.match(turn.structuredContent.endedAt, /^\d{4}-\d\d-\d\dT.*Z$/);
          assert.ok(Number.isFinite(Date.parse(turn.structuredContent.endedAt)));
        }
        record("E2E-TURN-GET-002", "running, completed, error, and aborted states");

        await ctx.host.restart();
        const afterRestart = await Promise.all([
          call(12, { sessionId: session.id, turnId: completedTurn }),
          call(13, { sessionId: session.id, turnId: errorTurn }),
          call(14, { sessionId: session.id, turnId: abortedTurn }),
        ]);
        assert.deepEqual(
          afterRestart.map((turn) => turn.structuredContent.status),
          ["completed", "error", "aborted"],
        );
        assert.equal(afterRestart[1].structuredContent.errorCode, "PROVIDER_ERROR");
        assert.equal(afterRestart[2].structuredContent.errorCode, "TURN_ABORTED");
        record("E2E-TURN-GET-003", "terminal turn state and errors survive Host restart");
      } finally {
        await server.stop();
      }
    }, binary, tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`Summary: ${results.length}/${results.length} passed (isolated Host, no provider calls)`);
}

await main();
