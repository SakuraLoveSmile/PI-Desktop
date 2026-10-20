import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { IPC } = await import("@pi-desktop/shared");
const { registerAgentIpc } = await import("../electron/main/ipc/agent-ipc.ts");

function setup({ activeTurns, sidecarResult = { found: true, requested: true } }) {
  const handlers = new Map();
  const sidecarCalls = [];
  const hostCalls = [];
  const host = {
    async call(method) {
      hostCalls.push(method);
      throw new Error(`Unexpected Host method: ${method}`);
    },
  };
  const sidecar = {
    setProjectInstructionRoot() {},
    setVendorAuthBindings() {},
    async call(method, params) {
      sidecarCalls.push({ method, params });
      return sidecarResult;
    },
  };

  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => host,
    getSidecar: () => sidecar,
    getAgentHostBridge: () => null,
    logger: { app() {} },
    vendorOAuth: {},
    agentExtensions: {},
    cancelSessionTools() {},
    persistenceOutbox: { async flush() {} },
    dataDir: "/data",
    activeTurns,
    isTurnDispatchable: () => true,
    activeTurnUsages: new Map(),
    approvedExecutionIdsBySession: new Map(),
    claimedExecutionSessions: new Map(),
    resolveAgentRuntimeLaunch: async () => ({ providerId: "provider-1", modelId: "model-1", projectPath: "/workspace" }),
    acquireSessionOperation: async () => () => {},
    finishTurn: async () => {},
    lockAbortReason() {},
    finishApprovedExecution: async () => {},
    dispatchApprovedPlan: async () => {},
    dispatchExecutionForProposal: async () => {},
    emitAgentEvent() {},
    setNotificationViewingSessionId() {},
    optionalWorkspaceRoot: async () => null,
    composerCommandService: { async buildComposerCommands() { return []; } },
    loadComposerTemplatesCached: async () => [],
  });

  return { handler: handlers.get(IPC.invoke.agentAbortTool), sidecarCalls, hostCalls };
}

test("tool abort forwards the active turn and tool call to the runtime", async () => {
  const { handler, sidecarCalls, hostCalls } = setup({
    activeTurns: new Map([["session-1", "turn-1"]]),
  });

  const result = await handler({ sessionId: "session-1", turnId: "turn-1", toolCallId: "bash-1" });

  assert.deepEqual(result, { found: true, requested: true });
  assert.deepEqual(sidecarCalls, [
    {
      method: "agent.abortTool",
      params: { sessionId: "session-1", turnId: "turn-1", toolCallId: "bash-1" },
    },
  ]);
  assert.deepEqual(hostCalls, [], "main must not kill the tool itself; the runtime owns the stop order");
});

test("tool abort is refused for a missing or stale turn without reaching the runtime", async () => {
  const idle = setup({ activeTurns: new Map() });
  assert.deepEqual(
    await idle.handler({ sessionId: "session-1", toolCallId: "bash-1" }),
    { found: false, requested: false },
  );

  const stale = setup({ activeTurns: new Map([["session-1", "turn-2"]]) });
  assert.deepEqual(
    await stale.handler({ sessionId: "session-1", turnId: "turn-1", toolCallId: "bash-1" }),
    { found: false, requested: false },
  );

  assert.deepEqual(idle.sidecarCalls, []);
  assert.deepEqual(stale.sidecarCalls, []);
});

test("tool abort rejects a request without a tool call id", async () => {
  const { handler, sidecarCalls } = setup({
    activeTurns: new Map([["session-1", "turn-1"]]),
  });

  await assert.rejects(
    handler({ sessionId: "session-1", toolCallId: "" }),
    /toolCallId required/,
  );
  assert.deepEqual(sidecarCalls, []);
});
