import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { createHostRuntime } = await import("../electron/main/runtime/host.ts");

// `plugins.execute` crosses a language boundary: host-core writes the payload in
// Rust, the main process reads it back by field name, and nothing type-checks the
// two against each other. A field dropped from the Rust side is invisible to
// every other check — the receiver throws on the first missing name, the tool
// never runs, and host-core waits out its RPC timeout. So read the field list
// from the Rust source and drive the real receiver with it.
const rustSource = readFileSync(
  join(here, "..", "..", "..", "crates", "host-core", "src", "rpc", "mod.rs"),
  "utf8",
);

/**
 * Field names of the `plugins.execute` notification payload, taken from the
 * `json!({ ... })` literal in host-core. Brace matching ignores nesting; the
 * payload holds no braces inside strings or comments, so a simple depth count is
 * enough and any future nesting still keeps the top-level names correct.
 */
function pluginExecutePayloadFields(source) {
  const notification = source.indexOf('"plugins.execute"');
  assert.ok(notification >= 0, "the plugins.execute notification is gone");
  const literal = source.indexOf("json!({", notification);
  assert.ok(literal >= 0, "the plugins.execute payload literal is gone");
  const open = source.indexOf("{", literal);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  assert.ok(end > open, "the plugins.execute payload literal is unbalanced");
  return [...source.slice(open + 1, end).matchAll(/^\s*"([A-Za-z][A-Za-z0-9]*)":/gm)].map(
    (match) => match[1],
  );
}

const FIELDS = pluginExecutePayloadFields(rustSource);

const VALUE_BY_FIELD = {
  executionId: "exec-1",
  sessionId: "session-1",
  turnId: "turn-1",
  toolCallId: "call-1",
  toolName: "demo_echo",
  args: { message: "hello" },
  mode: "agent",
  planSafeActions: [],
};

const TOOL_NAME = VALUE_BY_FIELD.toolName;

function fixture() {
  const calls = [];
  const invocations = [];
  let notification = null;

  const host = {
    onNotification: (handler) => {
      notification = handler;
    },
    onExit() {},
    async call(method, params) {
      calls.push({ method, params });
      return {};
    },
  };

  const runtime = createHostRuntime({
    // The notification handler ignores anything from a host generation that is
    // no longer current, so the fake must be the live one.
    runtimeState: { host, sidecar: null, agentHostBridge: null },
    dataDir: "/tmp/pi-desktop-test",
    logger: { app() {}, child: () => ({ app() {} }), flushChild() {} },
    persistenceOutbox: { size: () => 0, flush: async () => undefined },
    activeToolCalls: new Map(),
    activeToolCallKey: (sessionId, toolCallId) => `${sessionId}:${toolCallId}`,
    sessionProjects: new Map(),
    plugins: {
      getTools: () => [
        {
          fullName: TOOL_NAME,
          pluginId: "demo",
          execute: async (args, ctx) => {
            invocations.push({ args, ctx });
            return { echoed: true };
          },
        },
      ],
      drainToasts: () => [],
    },
    userMcp: { callTool: async () => null },
    pluginActiveInProject: () => true,
    sendToRenderer() {},
    emitAgentEvent() {},
    togglePluginLauncher: async () => undefined,
    finishTurn: async () => undefined,
    isTurnDispatchable: () => true,
    finishApprovedExecution: async () => undefined,
    activeTurns: new Map(),
    approvedExecutionIdsBySession: new Map(),
    claimedExecutionSessions: new Map(),
    importLegacyScheduled: async () => undefined,
    superviseRestart: async () => undefined,
    isQuitting: () => false,
  });
  runtime.wireHost(host);

  return {
    calls,
    invocations,
    notify: (method, params) => notification(method, params),
  };
}

test("the host-core notification carries every field the receiver reads", () => {
  for (const field of ["executionId", "sessionId", "toolCallId", "toolName", "args", "turnId"]) {
    assert.ok(FIELDS.includes(field), `plugins.execute no longer sends ${field}`);
  }
  assert.equal(
    FIELDS.filter((field) => field === "turnId").length,
    1,
    "the turn identity must be sent exactly once",
  );
});

test("a host-core plugins.execute payload runs the plugin tool and is answered", async () => {
  const f = fixture();
  const payload = Object.fromEntries(FIELDS.map((field) => [field, VALUE_BY_FIELD[field]]));

  f.notify("plugins.execute", payload);
  await setImmediate();
  await setImmediate();

  const resolved = f.calls.filter((call) => call.method === "plugins.resolveExecution");
  assert.equal(resolved.length, 1, "host-core must be answered exactly once");
  assert.equal(
    resolved[0].params.ok,
    true,
    `the tool must run: ${JSON.stringify(resolved[0].params)}`,
  );
  assert.equal(resolved[0].params.executionId, payload.executionId);

  assert.equal(f.invocations.length, 1, "the plugin tool must be executed once");
  assert.deepEqual(f.invocations[0].args, payload.args);
  // The turn identity travels with the call, so a plugin can scope the work it
  // started to the turn `session:turnEnded` will name.
  assert.equal(f.invocations[0].ctx.turnId, payload.turnId);
  assert.equal(f.invocations[0].ctx.sessionId, payload.sessionId);
});

test("an mcprefixed tool keeps its own path", async () => {
  const f = fixture();
  const payload = {
    ...Object.fromEntries(FIELDS.map((field) => [field, VALUE_BY_FIELD[field]])),
    toolName: "mcp_demo",
  };
  f.notify("plugins.execute", payload);
  await setImmediate();
  await setImmediate();
  const resolved = f.calls.filter((call) => call.method === "plugins.resolveExecution");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].params.ok, true);
  assert.equal(f.invocations.length, 0, "an mcp tool never reaches the plugin runtime");
});
