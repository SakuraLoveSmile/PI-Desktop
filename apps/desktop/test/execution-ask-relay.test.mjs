import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { IPC } from "@pi-desktop/shared";

test("external questions use the full live projection, trusted principal, strict identities and first-answer settlement", async t => {
  const vite = await createServer({ root: dirname(dirname(fileURLToPath(import.meta.url))), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { createAgentHostBridge, DESKTOP_PRINCIPAL } = await vite.ssrLoadModule("/electron/main/agent-host-bridge.ts");
  const { createMcpControlController, McpControlServer, boundMcpResult } = await vite.ssrLoadModule("/electron/main/mcp-control.ts");
  const { AskToolInputs } = await vite.ssrLoadModule("/../../packages/agent-runtime/src/ask-tool-inputs.ts");
  const calls = [], events = [], waits = [];
  let bridge;
  const inputs = new AskToolInputs(request => bridge.ingest({ sessionId: request.sessionId, turnId: "turn", ts: Date.now(), event: { type: "asktool_request", request } }));
  const invoke = async (channel, args) => {
    calls.push({ channel, args });
    if (channel === IPC.invoke.agentGetStatus) return { status: { sessionId: args[0], isRunning: true } };
    if (channel === IPC.invoke.askToolResolve) {
      const nested = await bridge.resolveAskByRequestId(args[0]);
      return nested ?? inputs.resolve(args[0], "s");
    }
    throw new Error(`unexpected channel ${channel}`);
  };
  bridge = createAgentHostBridge({ channels: IPC.invoke, getHost: () => null, log() {}, invoke, resolveAskWaiter: resolution => Promise.resolve(inputs.resolve(resolution, "s")) });
  bridge.agentHost.subscribe(DESKTOP_PRINCIPAL, { scope: "session", sessionId: "s" }, { deliver: event => events.push(event), close() {} });
  const request = index => ({ sessionId: "s", requestId: `r${index}`, toolCallId: `t${index}`, turnId: "turn", createdAt: new Date().toISOString(),
    questions: [{ question: "Which?", options: ["One", "Two"] }] });
  for (let index = 0; index < 10; index++) waits.push(inputs.wait(request(index)));
  waits.push(inputs.wait({ ...request(10), teamManaged: true }));
  const controller = createMcpControlController({ channels: IPC.invoke, invoke,
    askTools: { pending: id => bridge.pendingOrdinaryAsks(id), resolve: resolution => bridge.resolveOrdinaryAsk(resolution) } });
  const pending = await controller.invoke({ operation: "agent/askTool/pending", args: [{ sessionId: "s" }] });
  assert.equal(pending.asks.length, 10);
  assert.equal((await bridge.pendingInteractiveRequests("s")).asks.length, 8);
  assert.deepEqual(await controller.invoke({ operation: "agent/askTool/pending", args: [{ sessionId: "native-pi:s" }] }), { sessionId: "native-pi:s", asks: [] });
  assert.deepEqual((await controller.invoke({ operation: "agent/getStatus", args: ["s"] })).status.pendingInputs, { count: 10, requestIds: Array.from({ length: 10 }, (_, i) => `r${i}`) });
  const resolution = { sessionId: "s", requestId: "r0", expectedToolCallId: "t0", answers: [["One"]] };
  const answer = input => controller.invoke({ operation: "agent/askTool/resolve", args: [input], confirm: true });
  for (const invalid of [{ ...resolution, expectedToolCallId: "wrong" }, { ...resolution, sessionId: "other" }]) {
    await assert.rejects(() => answer(invalid), error => error.errorCode === "ASKTOOL_IDENTITY_MISMATCH");
  }
  for (const invalid of [{ ...resolution, answers: [] }, { ...resolution, answers: [[]] }, { ...resolution, answers: [["One", "Two"]] }, { ...resolution, answers: [[""]] }, { ...resolution, principal: DESKTOP_PRINCIPAL }, { ...resolution, source: "desktop" }]) {
    await assert.rejects(() => answer(invalid), error => error.errorCode === "ASKTOOL_INVALID_ARGUMENT");
  }
  await assert.rejects(() => answer({ ...resolution, requestId: "r10", expectedToolCallId: "t10" }), error => error.errorCode === "ASKTOOL_TEAM_MANAGED");
  assert.deepEqual(await answer(resolution), { status: "answered", requestId: "r0" });
  assert.deepEqual(await waits[0], [["One"]]);
  assert.equal(calls.filter(call => call.channel === IPC.invoke.askToolResolve).length, 1);
  assert.equal(calls.at(-1).args[0].expectedToolCallId, "t0");
  assert.equal(events.find(event => event.kind === "input.resolved").payload.by, "mcp-control");
  assert.deepEqual(await answer(resolution), { status: "not_pending", requestId: "r0" });
  const race = await Promise.all([answer({ ...resolution, requestId: "r1", expectedToolCallId: "t1" }), bridge.resolveAskByRequestId({ ...resolution, requestId: "r1", expectedToolCallId: "t1", answers: [["Two"]] })]);
  assert.ok(race[0].status === "answered" || race[0].status === "not_pending");
  assert.ok(["One", "Two"].includes((await waits[1])[0][0]));
  const bounded = boundMcpResult({ asks: [{ questions: ["x".repeat(700000)] }] });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.reason, "MCP_RESULT_LIMIT");
  const control = new McpControlServer({ dataDir: mkdtempSync(join(tmpdir(), "pi-execution-ask-test-")), port: 0, channels: IPC.invoke, invoke, controller });
  t.after(() => control.stop());
  const info = await control.start();
  let seq = 0, sessionId;
  const rpc = async (method, params) => {
    const response = await fetch(info.url, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }) });
    sessionId ??= response.headers.get("mcp-session-id");
    const responseBody = await response.json();
    assert.equal(responseBody.error, undefined, JSON.stringify(responseBody));
    return responseBody.result;
  };
  await rpc("initialize", { protocolVersion: "2025-06-18" });
  const tool = async (name, args) => {
    return rpc("tools/call", { name, arguments: args });
  };
  assert.equal((await tool("pi_asks_resolve", resolution)).structuredContent.error.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual((await tool("pi_asks_resolve", { ...resolution, confirm: true })).structuredContent, { status: "not_pending", requestId: "r0" });
  const exact = [["  custom  "]];
  assert.equal((await tool("pi_desktop_invoke", { operation: "agent/askTool/resolve", args: [{ ...resolution, requestId: "r2", expectedToolCallId: "t2", answers: exact }], confirm: true, source: "desktop" })).isError, undefined);
  assert.deepEqual(await waits[2], exact);
  assert.equal(events.filter(event => event.kind === "input.resolved").at(-1).payload.by, "mcp-control");
  inputs.cancelAll();
  await Promise.all(waits);
});

test("superseded durable reads cannot send MCP answers through the Desktop Team path", async t => {
  const vite = await createServer({ root: dirname(dirname(fileURLToPath(import.meta.url))), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { createAgentHostBridge } = await vite.ssrLoadModule("/electron/main/agent-host-bridge.ts");
  const reads = [], methods = [];
  const bridge = createAgentHostBridge({ channels: IPC.invoke, log() {}, invoke: async () => { throw new Error("MCP must not reach Desktop IPC"); },
    getHost: () => ({ call: async method => { methods.push(method); assert.equal(method, "team.listLeadAsks"); return new Promise(resolve => reads.push(resolve)); } }) });
  const resolution = { sessionId: "s", requestId: "durable-team", expectedToolCallId: "call", answers: [["One"]] };
  const answer = bridge.resolveOrdinaryAsk(resolution);
  const newestRead = bridge.agentHost.refreshPendingInputs("s");
  reads[0]({ asks: [{ turnId: "turn", request: { ...resolution, toolCallId: "call", teamManaged: true, questions: [{ question: "Team?", options: ["One"] }] } }] });
  assert.deepEqual(await answer, { status: "not_pending", requestId: resolution.requestId });
  reads[1]({ asks: [] }); await newestRead;
  assert.deepEqual(methods, ["team.listLeadAsks", "team.listLeadAsks"]);
});

test("MCP winning while Desktop's Team lookup is in flight immediately clears live state and attributes the answer", async t => {
  const vite = await createServer({ root: dirname(dirname(fileURLToPath(import.meta.url))), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { createAgentHostBridge, DESKTOP_PRINCIPAL } = await vite.ssrLoadModule("/electron/main/agent-host-bridge.ts");
  const { AskToolInputs } = await vite.ssrLoadModule("/../../packages/agent-runtime/src/ask-tool-inputs.ts");
  const events = [], methods = [];
  let bridge, releaseTeam;
  const inputs = new AskToolInputs(request => bridge.ingest({ sessionId: "s", turnId: "turn", ts: Date.now(), event: { type: "asktool_request", request } }));
  bridge = createAgentHostBridge({ channels: IPC.invoke, log() {},
    invoke: async (_channel, args) => inputs.resolve(args[0], "s"), resolveAskWaiter: async resolution => inputs.resolve(resolution, "s"),
    getHost: () => ({ call: async method => {
      methods.push(method);
      if (method === "team.listLeadAsks") return { asks: [] };
      assert.equal(method, "team.resolveLeadAsk");
      return new Promise((_resolve, reject) => { releaseTeam = () => reject(Object.assign(new Error("not a Team ask"), { errorCode: "ASKTOOL_NOT_FOUND" })); });
    } }) });
  bridge.agentHost.subscribe(DESKTOP_PRINCIPAL, { scope: "session", sessionId: "s" }, { deliver: event => events.push(event), close() {} });
  bridge.ingest({ sessionId: "s", turnId: "turn", ts: Date.now(), event: { type: "agent_start" } });
  const request = { sessionId: "s", requestId: "r", toolCallId: "call", questions: [{ question: "Which?", options: ["One", "Two"] }] };
  const wait = inputs.wait(request);
  const desktop = bridge.resolveAskByRequestId({ ...request, answers: [["Two"]] });
  assert.ok(releaseTeam, "Desktop lookup must hold the reentrant guard");
  const result = await bridge.resolveOrdinaryAsk({ ...request, expectedToolCallId: "call", answers: [["One"]] });
  assert.deepEqual(result, { status: "answered", requestId: "r" });
  assert.deepEqual(await wait, [["One"]]);
  assert.deepEqual(await bridge.pendingOrdinaryAsks("s"), []);
  assert.equal(bridge.agentHost.getTurn("turn").status, "running");
  assert.deepEqual(events.filter(event => event.kind === "input.resolved").map(event => event.payload.by), ["mcp-control"]);
  releaseTeam();
  await assert.rejects(() => desktop, error => ["ASKTOOL_NOT_FOUND", "NOT_FOUND"].includes(error.errorCode));
  assert.equal(methods.filter(method => method === "team.resolveLeadAsk").length, 1, "only the authorized Desktop path queried Team");
});
