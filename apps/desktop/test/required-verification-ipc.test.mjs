import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { IPC } = await import("@pi-desktop/shared");
const { registerAgentIpc } = await import("../electron/main/ipc/agent-ipc.ts");
const { McpControlServer } = await import("../electron/main/mcp-control.ts");

test("MCP Goal approval forwards frozen verification commands through the real IPC handler to Host", async t => {
  const handlers = new Map();
  const calls = [];
  const dispatches = [];
  const host = { async call(method, params) {
    calls.push({ method, params });
    assert.equal(method, "plans.resolve");
    return { ok: true, proposal: { id: params.proposalId } };
  } };
  const dataDir = mkdtempSync(join(tmpdir(), "pi-required-verification-ipc-"));
  registerAgentIpc({
    registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
    getHost: () => host, getSidecar: () => null, getAgentHostBridge: () => null,
    logger: { app() {} }, vendorOAuth: {}, agentExtensions: {}, cancelSessionTools() {},
    persistenceOutbox: { async flush() {} }, dataDir,
    activeTurns: new Map(), activeTurnUsages: new Map(), approvedExecutionIdsBySession: new Map(),
    claimedExecutionSessions: new Map(), isTurnDispatchable: () => true,
    resolveAgentRuntimeLaunch: async () => { throw new Error("No model may run in this fixture"); },
    acquireSessionOperation: async () => () => {}, finishTurn: async () => {}, lockAbortReason() {},
    finishApprovedExecution: async () => {}, dispatchApprovedPlan: async () => {},
    dispatchExecutionForProposal: async id => { dispatches.push(id); }, emitAgentEvent() {},
    setNotificationViewingSessionId() {}, optionalWorkspaceRoot: async () => null,
    composerCommandService: { async buildComposerCommands() { return []; } }, loadComposerTemplatesCached: async () => [],
  });
  const server = new McpControlServer({
    dataDir, port: 0, channels: { plansResolve: IPC.invoke.plansResolve },
    invoke: async (channel, args) => handlers.get(channel)(...args),
  });
  t.after(async () => { await server.stop(); rmSync(dataDir, { recursive: true, force: true }); });
  const info = await server.start();
  let sessionId;
  const post = async (method, params) => {
    const response = await fetch(info.url, { method: "POST", headers: {
      Authorization: `Bearer ${info.token}`, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    assert.equal(response.status, 200);
    sessionId ||= response.headers.get("mcp-session-id");
    return response.json();
  };
  await post("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "required-verification", version: "1" } });
  const tools = await post("tools/list", {});
  const schema = tools.result.tools.find(tool => tool.name === "pi_plans_resolve").inputSchema;
  assert.equal(schema.properties.requiredVerificationCommands.maxItems, 200);
  const requiredVerificationCommands = ["cargo test --locked", " pnpm test -- --run "];
  const identity = { proposalId: "proposal", sessionId: "session", turnId: "turn", toolCallId: "call", version: 1 };
  const result = await post("tools/call", { name: "pi_plans_resolve", arguments: {
    ...identity, action: "approve", targetPermissionMode: "auto", requiredVerificationCommands, confirm: true,
  } });
  assert.notEqual(result.result.isError, true);
  assert.deepEqual(calls, [{ method: "plans.resolve", params: {
    ...identity, action: "approve", targetPermissionMode: "auto", requiredVerificationCommands,
  } }]);
  assert.deepEqual(dispatches, ["proposal"]);
  // Unexpected presence must reach Host for an explicit rejection, not disappear
  // from Main's allowlist and accidentally resolve a different contract.
  await handlers.get(IPC.invoke.plansResolve)({ ...identity, action: "reject", requiredVerificationCommands });
  assert.deepEqual(calls.at(-1).params.requiredVerificationCommands, requiredVerificationCommands);
});
