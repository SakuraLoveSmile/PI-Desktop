#!/usr/bin/env node
/** Real Rust Host + production RuntimeService/persistence + sidecar + local SSE.
 * No live models, user profile, production DB, or renderer is used. The MCP
 * create/configure/get/getTurn routes use production session IPC. Both the
 * headless RuntimeService and Desktop registerAgentIpc prompt paths are tested.
 * Headless search receives one synthetic read-only plugin declaration to make
 * the production deferred ToolSearch available; it must never be executed.
 * Usage: node scripts/e2e-unattended-interaction.mjs [--evidence-dir <directory>]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureEnvironment } from "./e2e-suite-runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidenceIndex = process.argv.indexOf("--evidence-dir");
const evidenceDir = resolve(evidenceIndex >= 0 ? process.argv[evidenceIndex + 1]
  : join(root, ".review-evidence", `unattended-interaction-${Date.now()}`));
const kaneoIndex = process.argv.indexOf("--kaneopilot-root");
const kaneoRoot = kaneoIndex >= 0 ? resolve(process.argv[kaneoIndex + 1]) : null;
await mkdir(evidenceDir, { recursive: true });

// Enter the isolated HOME before importing launch resolution/instruction code.
// Use the existing fixture allowlist so provider keys and proxy credentials are
// never inherited. Mutable test data is disposable; evidence is retained.
if (!process.env.PI_E2E_UNATTENDED_SCRATCH) {
  const scratch = await mkdtemp(join(tmpdir(), "pi-unattended-e2e-"));
  const env = fixtureEnvironment(process.env, scratch, { PI_E2E_UNATTENDED_SCRATCH: scratch });
  for (const directory of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.TMPDIR]) {
    await mkdir(directory, { recursive: true });
  }
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--evidence-dir", evidenceDir,
      ...(kaneoRoot ? ["--kaneopilot-root", kaneoRoot] : [])], {
      cwd: root, env, stdio: "inherit",
    });
    process.exitCode = await new Promise((done, reject) => {
      child.once("error", reject); child.once("exit", code => done(code ?? 1));
    });
  } finally { await rm(scratch, { recursive: true, force: true }); }
} else {
  await run();
}

async function run() {
  const { AgentSidecar, HostProcess, RuntimeService, createHeadlessLaunchResolver } =
    await import("../packages/host-runtime/dist/index.js");
  const { IPC, PROTOCOL_VERSION } = await import("../packages/shared/dist/protocol.js");
  const { resolveHostBinary } = await import("./e2e/host.mjs");
  const { verifyBuildReceipt } = await import("./e2e/build-candidate-receipt.mjs");
  const { unattendedSessionHandlers } = await import("./e2e/unattended-session-ipc.mjs");
  register(pathToFileURL(join(root, "apps/desktop/test/helpers/ts-import-hooks.mjs")));
  const { McpControlServer } = await import("../apps/desktop/electron/main/mcp-control.ts");
  const binary = resolveHostBinary();
  const receipt = await verifyBuildReceipt(binary);
  await writeFile(join(evidenceDir, "build-receipt.json"), JSON.stringify(receipt, null, 2));
  const scratch = process.env.PI_E2E_UNATTENDED_SCRATCH;
  const dataDir = join(scratch, "data");
  const workspace = join(scratch, "workspace");
  await mkdir(workspace); await mkdir(dataDir);
  const events = [], requests = [], rpcCalls = [], logs = [], results = [];
  const fixtures = new Map();
  let host, sidecar, runtime, control, provider, fixtureError, admissionRace, kaneoRunning = false;
  let kaneoRequests = 0;
  let hostStderr = "", sidecarStderr = "";
  const questions = [{ question: "Choose a result", options: ["Zero", { label: "One", description: "Return one" }] }];
  const kaneoQuestions = [...questions, { question: "Choose checks", options: ["Unit", "Integration"], multiSelect: true }];
  const ask = id => ({ name: "asktool", id: `ask-${id}`, args: { questions } });
  const markerPath = id => join(workspace, `${id}.marker`);
  const bash = id => ({ name: "Bash", id: `bash-${id}`, args: { command: `printf violated > '${markerPath(id)}'` } });
  const write = id => ({ name: "Write", id: `write-${id}`, args: { path: markerPath(id), content: "violated" } });
  const toolsOf = request => (request.tools ?? []).map(tool => tool.function?.name);
  const localFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, "127.0.0.1", "Only loopback fixture/MCP requests are permitted");
    return localFetch(url, init);
  };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      let body = "";
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      const user = request.messages.findLast(message => message.role === "user");
      const text = typeof user?.content === "string" ? user.content : user?.content?.find(part => part.type === "text")?.text;
      let id = /^\[fixture:([\w-]+)\]/.exec(text ?? "")?.[1];
      if (!id && kaneoRoot && kaneoRunning) {
        assert.ok(kaneoRequests < 2, "KaneoPilot may submit only one planning and one Review model request");
        id = kaneoRequests++ === 0 ? "kaneopilot-plan" : "kaneopilot-review";
        fixtures.set(id, { calls: [bash(id), { ...ask(id), args: { questions: kaneoQuestions } }] });
      }
      const fixture = fixtures.get(id);
      assert.ok(fixture, `Unknown fixture request: ${text}`);
      const round = requests.filter(row => row.id === id).length;
      requests.push({ id, round, request });
      const calls = round === 0 ? fixture.calls : [];
      const delta = calls.length ? { role: "assistant", tool_calls: calls.map((call, index) => ({
        index, id: call.id, type: "function", function: {
          name: call.name, arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
        },
      })) } : { role: "assistant", content: `RESULT_${id}` };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [value, finish] of [[delta, null], [{}, calls.length ? "tool_calls" : "stop"]]) {
        res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "interaction-fixture", choices: [
          { index: 0, delta: value, finish_reason: finish }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    } catch (error) {
      fixtureError ??= error;
      if (!res.headersSent) res.writeHead(500);
      res.end("Isolated fixture failed");
    }
  });
  async function until(predicate, label) {
    const deadline = Date.now() + 25_000;
    while (!await predicate()) {
      if (fixtureError) throw fixtureError;
      assert.ok(Date.now() < deadline, `${label} timed out\n${sidecarStderr}`);
      await delay(10);
    }
  }
  const record = (id, details) => { results.push({ id, ...details }); console.log(`PASS ${id}`); };
  async function startHost() {
    host = new HostProcess({ binaryPath: binary, dataDir, onStderr: chunk => { hostStderr += chunk; } });
    host.onNotification((method, params) => rpcCalls.push({ direction: "host-notification", method, params }));
    const call = host.call.bind(host);
    host.call = async (method, params) => {
      rpcCalls.push({ direction: "host-call", method, params });
      if (method === "session.beginTurn" && admissionRace?.sessionId === params.sessionId) {
        const race = admissionRace; admissionRace = null;
        assert.equal(params.expectedInteractionMode, "unattended", "Prompt precondition must reach actual Host admission");
        const changed = await call("session.configure", { id: race.sessionId, mode: "agent", interactionMode: "interactive" });
        assert.equal(changed.session.interactionMode, "interactive");
        rpcCalls.push({ direction: "race-configure", method: "session.configure", session: changed.session });
      }
      return call(method, params);
    };
    assert.equal((await host.call("app.handshake", { protocolVersion: PROTOCOL_VERSION })).protocolVersion, PROTOCOL_VERSION);
    runtime?.attachHost(host);
  }
  let info, mcpSessionId, mcpRequestId = 1;
  async function mcp(method, params) {
    const response = await fetch(info.url, { method: "POST", headers: {
      Authorization: `Bearer ${info.token}`, "Content-Type": "application/json",
      ...(mcpSessionId ? { "Mcp-Session-Id": mcpSessionId } : {}),
    }, body: JSON.stringify({ jsonrpc: "2.0", id: mcpRequestId++, method, params }) });
    assert.equal(response.status, 200);
    mcpSessionId ??= response.headers.get("mcp-session-id");
    const result = await response.json();
    assert.equal(result.error, undefined, JSON.stringify(result));
    return result.result;
  }
  async function tool(name, args) {
    const result = await mcp("tools/call", { name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return result.structuredContent;
  }
  async function create(mode, interactionMode) {
    const result = await tool("pi_session_create", { title: "Isolated interaction policy", mode, projectPath: workspace,
      providerId: provider.id, modelId: "interaction-fixture", ...(interactionMode ? { interactionMode } : {}) });
    assert.equal(result.session.interactionMode, interactionMode ?? "interactive");
    assert.equal(result.session.interactionPolicyVersion, 1);
    await tool("pi_session_configure", { id: result.session.id, mode, permissionMode: "auto", confirm: true });
    return result.session;
  }
  async function begin(session, id, calls, extra = {}) {
    fixtures.set(id, { calls });
    const rpcStart = rpcCalls.length;
    const accepted = await tool("pi_agent_prompt", { sessionId: session.id, content: `[fixture:${id}] Complete fixture.`, ...extra });
    assert.ok(accepted.turnId);
    return { sessionId: session.id, turnId: accepted.turnId, id, rpcStart };
  }
  async function settled(run) {
    await until(() => results.some(row => row.ended?.turnId === run.turnId), `${run.id} durable terminal`);
    const ended = results.find(row => row.ended?.turnId === run.turnId).ended;
    if ("settled" in ended) assert.equal(ended.settled, true);
    assert.deepEqual(await runtime.flushPersistence(run.sessionId), { pending: 0, failed: [] });
    return tool("pi_turn_get", { sessionId: run.sessionId, turnId: run.turnId });
  }
  const requestsFor = run => requests.filter(row => row.id === run.id);
  const eventsFor = run => events.filter(row => row.sessionId === run.sessionId && row.turnId === run.turnId);
  async function blocked(session, id, calls, invalidArguments = false, expectedQuestions = questions) {
    const run = await begin(session, id, calls, { expectedInteractionMode: "unattended" });
    const turn = await settled(run);
    assert.equal(turn.status, "error"); assert.equal(turn.errorCode, "INTERACTION_REQUIRED");
    assert.deepEqual(turn.errorDetails, { kind: "interaction_required", toolName: "asktool", toolCallId: `ask-${id}`,
      questions: invalidArguments ? [] : expectedQuestions, ...(invalidArguments ? { invalidArguments: true } : {}) });
    const turnEvents = eventsFor(run);
    assert.equal(turnEvents.filter(row => row.event.type === "error").length, 1);
    assert.equal(turnEvents.filter(row => row.event.type === "asktool_request" || row.event.type === "tool_start" ||
      row.event.type === "tool_end" || row.event.type.startsWith("tool_execution_")).length, 0);
    assert.equal(rpcCalls.slice(run.rpcStart).filter(row => row.direction === "host-call" && row.method === "tools.execute").length, 0);
    assert.deepEqual(turnEvents.filter(row => ["error", "turn_end", "agent_end"].includes(row.event.type))
      .map(row => row.event.type), ["error", "turn_end", "agent_end"]);
    assert.equal(requestsFor(run).length, 1, "No retry or continuation request after asktool rejection");
    assert.ok(!toolsOf(requestsFor(run)[0].request).includes("asktool"));
    await assert.rejects(readFile(markerPath(id)), { code: "ENOENT" });
    const status = (await sidecar.call("agent.getStatus", { sessionId: session.id })).status;
    assert.equal(status.isRunning, false); assert.equal(status.pendingToolConfirmations, 0);
    if (runtime.pendingInteractive) assert.deepEqual(await runtime.pendingInteractive(session.id), { asks: [], permissions: [] });
    record(id, { turn, modelRequests: 1, toolExecutions: 0, askRequests: 0 });
    return { run, turn };
  }
  async function interactive(session, id) {
    const run = await begin(session, id, [ask(id)], { expectedInteractionMode: "interactive" });
    await until(() => eventsFor(run).some(row => row.event.type === "asktool_request"), `${id} asks`);
    const request = eventsFor(run).find(row => row.event.type === "asktool_request").event.request;
    assert.deepEqual(request.questions, questions);
    assert.equal((await tool("pi_turn_get", { sessionId: session.id, turnId: run.turnId })).status, "running");
    assert.equal(requestsFor(run).length, 1, "Interactive ask must wait for its answer");
    await runtime.respondInput({ sessionId: session.id, requestId: request.requestId, answers: [["Zero"]] });
    const turn = await settled(run);
    assert.equal(turn.status, "completed"); assert.equal(turn.errorCode, undefined);
    assert.equal(requestsFor(run).length, 2);
    assert.ok(toolsOf(requestsFor(run)[0].request).includes("asktool"));
    assert.ok(requestsFor(run)[1].request.messages.some(row => row.role === "tool" && String(row.content).includes("Choose a result：Zero")));
    record(id, { turn, modelRequests: 2, askRequests: 1 });
  }
  async function racedAdmission(session, id) {
    await tool("pi_session_configure", { id: session.id, mode: "agent", interactionMode: "unattended", confirm: true });
    fixtures.set(id, { calls: [ask(id)] });
    const rpcStart = rpcCalls.length;
    admissionRace = { sessionId: session.id };
    const result = await mcp("tools/call", { name: "pi_agent_prompt", arguments: {
      sessionId: session.id, content: `[fixture:${id}] Complete fixture.`, expectedInteractionMode: "unattended",
    } });
    assert.equal(admissionRace, null, "The actual admission seam must be reached after reading the session");
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "INTERACTION_POLICY_MISMATCH");
    assert.match(result.structuredContent.error.message, /interaction policy changed/i);
    const calls = rpcCalls.slice(rpcStart);
    assert.equal(calls.filter(row => row.direction === "host-call" && row.method === "session.beginTurn").length, 1);
    assert.equal(calls.filter(row => row.direction === "sidecar-call" && row.method === "agent.prompt").length, 0);
    assert.equal(calls.filter(row => row.direction === "host-call" && row.method === "session.appendMessage").length, 0);
    assert.equal(requests.filter(row => row.id === id).length, 0);
    record(id, { modelRequests: 0, error: result.structuredContent.error, precondition: "unattended", admissionState: "interactive" });
    await tool("pi_session_configure", { id: session.id, mode: "agent", interactionMode: "unattended", confirm: true });
  }
  let failure;
  try {
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    await startHost();
    await host.call("workspace.set", { path: workspace });
    ({ provider } = await host.call("providers.create", { name: "Interaction fixture", vendorKey: "custom", type: "openai_compatible",
      protocol: "openai_compatible", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authKind: "none",
      apiStyle: "chat_completions", defaultModelId: "interaction-fixture", models: [{ id: "interaction-fixture" }] }));
    await host.call("settings.set", { defaultProviderId: provider.id, defaultModelId: "interaction-fixture", defaultPermissionMode: "auto" });
    const networkHook = join(scratch, "loopback-only.mjs");
    await writeFile(networkHook, `const original = globalThis.fetch; globalThis.fetch = (url, init) => {
      if (new URL(String(url)).hostname !== "127.0.0.1") throw new Error("Non-loopback model request refused");
      return original(url, init);
    };`);
    sidecar = new AgentSidecar({ launch: { command: process.execPath,
      args: [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], cwd: workspace,
      env: { ...process.env, PI_DESKTOP_DATA_DIR: dataDir, NODE_OPTIONS: `--import=${networkHook}` } },
      onStderr: chunk => { sidecarStderr += chunk; } });
    const sidecarCall = sidecar.call.bind(sidecar);
    sidecar.call = (method, params) => {
      rpcCalls.push({ direction: "sidecar-call", method, params });
      return sidecarCall(method, params);
    };
    sidecar.setHost(host);
    sidecar.setLocalTool("plugin_policy_probe", async () => {
      throw new Error("Synthetic search declaration must never execute");
    });
    const headlessLaunch = createHeadlessLaunchResolver({ getHost: () => host, dataDir, log: (...args) => logs.push(args) });
    runtime = new RuntimeService({ getHost: () => host, getSidecar: () => sidecar,
      launch: { resolve: async (...args) => {
        const resolved = await headlessLaunch.resolve(...args);
        return { ...resolved, sidecarParams: { ...resolved.sidecarParams, pluginTools: [{ name: "plugin_policy_probe",
          description: "Synthetic read-only search declaration", risk: "low",
          parameters: { type: "object", properties: {}, required: [] } }] } };
      } },
      log: (...args) => logs.push(args) });
    runtime.attachHost(host); runtime.attachSidecar(sidecar);
    runtime.onEvent(envelope => events.push(envelope));
    runtime.onTurnEnded(ended => results.push({ ended }));
    const handlers = unattendedSessionHandlers(root, { getHost: () => host, getSidecar: () => sidecar, dataDir, runtime });
    handlers.set(IPC.invoke.agentPrompt, input => runtime.prompt(input));
    control = new McpControlServer({ dataDir: join(scratch, "control"), port: 0, version: "fixture", channels: {
      appGetVersion: IPC.invoke.appGetVersion, projectSet: IPC.invoke.projectSet,
      sessionGet: IPC.invoke.sessionGet, sessionCreate: IPC.invoke.sessionCreate, sessionDelete: IPC.invoke.sessionDelete,
      sessionConfigure: IPC.invoke.sessionConfigure, turnGet: IPC.invoke.turnGet, plansResolve: IPC.invoke.plansResolve,
      agentPrompt: IPC.invoke.agentPrompt, agentGetStatus: IPC.invoke.agentGetStatus, plansPending: IPC.invoke.plansPending,
      agentStop: IPC.invoke.agentStop, agentAbort: IPC.invoke.agentAbort,
      sessionList: IPC.invoke.sessionList,
    }, invoke: (channel, args) => {
      assert.ok(handlers.has(channel), `Unexpected MCP channel: ${channel}`);
      return handlers.get(channel)(...args);
    } });
    info = await control.start(); assert.ok(info);
    await mcp("initialize", { protocolVersion: "2025-06-18" });
    const planTools = ["pi_turn_get", "pi_session_create", "pi_session_configure", "pi_agent_prompt", "pi_agent_status",
      "pi_session_get", "pi_agent_stop", "pi_agent_abort", "pi_desktop_invoke", "pi_plans_pending", "pi_plans_resolve"];
    const publishedTools = (await mcp("tools/list", {})).tools;
    for (const name of planTools) assert.ok(publishedTools.some(entry => entry.name === name), `Missing KaneoPilot plan tool: ${name}`);
    const searchSession = await create("agent", "unattended");
    const searchRun = await begin(searchSession, "tool-search", [{ name: "ToolSearch", id: "search", args: { query: "asktool" } }],
      { expectedInteractionMode: "unattended" });
    assert.equal((await settled(searchRun)).status, "completed");
    assert.equal(requestsFor(searchRun).length, 2);
    assert.ok(requestsFor(searchRun).every(row => toolsOf(row.request).includes("ToolSearch") && !toolsOf(row.request).includes("asktool")));
    const searchEnd = eventsFor(searchRun).find(row => row.event.type === "tool_end").event;
    assert.equal(searchEnd.isError, false, "The real ToolSearch must execute successfully");
    const search = searchEnd.result;
    assert.deepEqual(search.details?.matches, []); assert.deepEqual(search.details?.activated, []);
    record("tool-search", { modelRequests: 2, result: search });
    const plan = await create("plan", "unattended");
    await blocked(plan, "ask-first", [ask("ask-first"), bash("ask-first"), write("ask-first")]);
    const persisted = await blocked(plan, "ask-middle", [bash("ask-middle"), ask("ask-middle"), write("ask-middle")]);
    const review = await create("agent", "unattended");
    await blocked(review, "ask-last", [bash("ask-last"), write("ask-last"), ask("ask-last")]);
    await blocked(review, "invalid-args", [bash("invalid-args"), { ...ask("invalid-args"), args: { questions: "invalid" } }], true);
    await blocked(review, "unknown-before-ask", [{ name: "UnknownTool", id: "unknown", args: {} }, ask("unknown-before-ask")]);
    const secondQuestions = [{ question: "Choose another result", options: ["Keep", "Replace"], multiSelect: true }];
    await blocked(review, "multiple-asks", [ask("multiple-asks"), { name: "asktool", id: "ask-second", args: { questions: secondQuestions } }],
      false, [...questions, ...secondQuestions]);
    await interactive(await create("agent"), "default-interactive");
    await tool("pi_session_configure", { id: review.id, mode: "agent", interactionMode: "interactive", confirm: true });
    await interactive(review, "reconfigured-interactive");
    await tool("pi_session_configure", { id: review.id, mode: "agent", interactionMode: "unattended", confirm: true });
    await blocked(review, "reconfigured-unattended", [bash("reconfigured-unattended"), ask("reconfigured-unattended")]);
    await racedAdmission(review, "headless-admission-race");
    const readback = (await tool("pi_session_get", { id: review.id, messageLimit: 1 })).session;
    assert.equal(readback.interactionMode, "unattended"); assert.equal(readback.interactionPolicyVersion, 1);
    await runtime.dispose();
    const { unattendedDesktopRuntime } = await import("./e2e/unattended-desktop-runtime.mjs");
    runtime = await unattendedDesktopRuntime({ host, sidecar, dataDir, workspace, handlers, events, results, logs });
    for (const channel of [IPC.invoke.turnGet, IPC.invoke.sessionCreate, IPC.invoke.sessionConfigure, IPC.invoke.agentPrompt,
      IPC.invoke.agentGetStatus, IPC.invoke.sessionGet, IPC.invoke.agentStop, IPC.invoke.agentAbort,
      IPC.invoke.plansPending, IPC.invoke.plansResolve]) {
      assert.ok(handlers.has(channel), `Missing production Desktop handler: ${channel}`);
    }
    const desktop = await blocked(review, "desktop-public-entry", [bash("desktop-public-entry"), write("desktop-public-entry"), ask("desktop-public-entry")]);
    await tool("pi_session_configure", { id: review.id, mode: "agent", interactionMode: "interactive", confirm: true });
    await interactive(review, "desktop-interactive");
    assert.deepEqual(await runtime.pendingInteractive(review.id), { asks: [], permissions: [] });
    await tool("pi_session_configure", { id: review.id, mode: "agent", interactionMode: "unattended", confirm: true });
    await racedAdmission(review, "desktop-admission-race");
    if (kaneoRoot) {
      const connectionFile = join(scratch, "kaneopilot-connection.json");
      await writeFile(connectionFile, JSON.stringify({ ...info, active: true }), { mode: 0o600 });
      const args = [join(kaneoRoot, "scripts/validate_plus_hard_policy.py"), "--connection-file", connectionFile,
        "--provider-id", provider.id, "--evidence-dir", join(evidenceDir, "kaneopilot")];
      kaneoRunning = true;
      const python = spawn("python3", args, { cwd: kaneoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const capture = chunk => { output += String(chunk); process.stdout.write(chunk); };
      python.stdout.on("data", capture); python.stderr.on("data", capture);
      const exitCode = await new Promise((done, reject) => { python.once("error", reject); python.once("exit", done); });
      kaneoRunning = false;
      await writeFile(join(evidenceDir, "kaneopilot.log"), output);
      assert.equal(exitCode, 0, "Real KaneoPilot planner/Review fixture must pass");
      assert.equal(kaneoRequests, 2);
      for (const id of ["kaneopilot-plan", "kaneopilot-review"]) {
        assert.equal(requests.filter(row => row.id === id).length, 1);
        const userAppend = rpcCalls.findLast(row => row.direction === "host-call" && row.method === "session.appendMessage" &&
          row.params.message?.role === "user" && events.some(envelope => envelope.sessionId === row.params.sessionId &&
            envelope.turnId === row.params.turnId && envelope.event.type === "error" && envelope.event.error.details?.toolCallId === `ask-${id}`));
        assert.ok(userAppend, `${id} must traverse real Desktop persistence`);
        const run = { sessionId: userAppend.params.sessionId, turnId: userAppend.params.turnId, id };
        const turnEvents = eventsFor(run);
        assert.equal(turnEvents.filter(row => row.event.type === "asktool_request" || row.event.type === "tool_start" || row.event.type === "tool_end").length, 0);
        assert.deepEqual(turnEvents.find(row => row.event.type === "error").event.error.details.questions, kaneoQuestions);
        await assert.rejects(readFile(markerPath(id)), { code: "ENOENT" });
        record(id, { modelRequests: 1, toolExecutions: 0, askRequests: 0, turnId: run.turnId });
      }
    }
    await runtime.dispose(); await sidecar.dispose(); await host.dispose();
    runtime = null; sidecar = null;
    await startHost();
    assert.deepEqual(await tool("pi_turn_get", { sessionId: persisted.run.sessionId, turnId: persisted.run.turnId }), persisted.turn);
    assert.deepEqual(await tool("pi_turn_get", { sessionId: desktop.run.sessionId, turnId: desktop.run.turnId }), desktop.turn);
    const restarted = (await tool("pi_session_get", { id: review.id, messageLimit: 1 })).session;
    assert.equal(restarted.interactionMode, "unattended"); assert.equal(restarted.interactionPolicyVersion, 1);
    record("host-restart", { turn: persisted.turn, interactionMode: restarted.interactionMode });
    assert.equal(fixtureError, undefined);
    await verifyBuildReceipt(binary, { expected: receipt });
  } catch (error) { failure = error; throw error; }
  finally {
    await runtime?.dispose(); await sidecar?.dispose(); await host?.dispose(); await control?.stop();
    server.closeAllConnections(); await new Promise(done => server.close(done));
    globalThis.fetch = localFetch;
    for (const [name, value] of Object.entries({ events, requests, rpcCalls, logs })) {
      await writeFile(join(evidenceDir, `${name}.json`), JSON.stringify(value, null, 2));
    }
    await writeFile(join(evidenceDir, "host.stderr.log"), hostStderr);
    await writeFile(join(evidenceDir, "sidecar.stderr.log"), sidecarStderr);
    await writeFile(join(evidenceDir, "summary.json"), JSON.stringify({ passed: !failure,
      failure: failure ? String(failure.stack ?? failure) : undefined,
      results: results.filter(row => !row.ended), modelRequests: requests.length,
      provider: "loopback HTTP/SSE fixture", terminalPersistence: "production headless RuntimeService/TurnEventPipeline and Desktop createPlanRuntime/createEventPersistence + Rust Host",
      readback: "production session IPC + McpControlServer pi_turn_get", renderer: "NOT RUN",
      candidate: receipt.source, artifactReceipt: "build-receipt.json" }, null, 2));
    console.log(`Evidence: ${evidenceDir}`);
  }
}
