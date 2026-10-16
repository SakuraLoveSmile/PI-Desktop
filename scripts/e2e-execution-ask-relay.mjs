#!/usr/bin/env node
/** Real Electron bootstrap, Rust Host, release sidecar bundle and authenticated HTTP MCP.
 * Only model SSE is simulated. All mutable profiles/workspaces are caller-owned fixtures.
 * --serve-fixture keeps the same isolated process alive for native KaneoPilot acceptance.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureEnvironment } from "./e2e-suite-runtime.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";
import { waitFor } from "./e2e/wait.mjs";
import { verifyBuildReceipt } from "./e2e/build-candidate-receipt.mjs";
import { executionAskDesktop } from "./e2e/execution-ask-desktop.mjs";
import { executionAskProvider } from "./e2e/execution-ask-provider.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : null; };
const evidenceDir = resolve(option("--evidence-dir") ?? join(root, ".review-evidence", `execution-ask-relay-${Date.now()}`));
const kaneoRoot = option("--kaneopilot-root") ? resolve(option("--kaneopilot-root")) : null;
const serve = argv.includes("--serve-fixture");
await mkdir(evidenceDir, { recursive: true });

if (!process.env.PI_E2E_EXECUTION_ASK_SCRATCH) {
  const scratch = await mkdtemp(join(tmpdir(), "pi-execution-ask-"));
  const env = fixtureEnvironment(process.env, scratch, { PI_E2E_EXECUTION_ASK_SCRATCH: scratch });
  for (const path of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.TMPDIR]) await mkdir(path, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--evidence-dir", evidenceDir,
    ...(kaneoRoot ? ["--kaneopilot-root", kaneoRoot] : []), ...(serve ? ["--serve-fixture"] : [])], { cwd: root, env, stdio: "inherit" });
  const interrupt = signal => child.kill(signal);
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { process.exitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", code => done(code ?? 1)); }); }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); await rm(scratch, { recursive: true, force: true }); }
} else await run();

async function fingerprint(directory) {
  const output = {};
  async function visit(path, relative = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name), key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(next, key);
      else { assert.ok(entry.isFile(), "sidecar bundle contains only files"); output[key] = createHash("sha256").update(await readFile(next)).digest("hex"); }
    }
  }
  await visit(directory); assert.ok(output["sidecar.js"] && output["package.json"]); return output;
}

async function run() {
  const scratch = process.env.PI_E2E_EXECUTION_ASK_SCRATCH, dataDir = join(scratch, "data"), workspace = join(scratch, "workspace");
  await mkdir(dataDir); await mkdir(workspace);
  const binary = resolveHostBinary(), receipt = await verifyBuildReceipt(binary);
  const bundle = join(root, "packages/agent-runtime/dist-bundle"), bundleIdentity = await fingerprint(bundle);
  await writeFile(join(evidenceDir, "build-receipt.json"), JSON.stringify(receipt, null, 2));
  await writeFile(join(evidenceDir, "bundle-artifacts.json"), JSON.stringify(bundleIdentity, null, 2));
  const requests = [], results = [], rpc = [];
  let desktop, provider, info, seq = 0, mcpSession, desktopOutput = "", failure;
  const host = new Host(binary, dataDir);
  const localFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    assert.equal(new URL(String(url)).hostname, "127.0.0.1", "fixture calls must stay loopback");
    return localFetch(url, init);
  };
  const json = async (name, value) => writeFile(join(evidenceDir, name), JSON.stringify(value, null, 2));
  async function mcp(method, params) {
    const response = await fetch(info.url, { method: "POST", headers: { Authorization: `Bearer ${info.token}`, "content-type": "application/json",
      ...(mcpSession ? { "mcp-session-id": mcpSession } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }) });
    assert.equal(response.status, 200); mcpSession ??= response.headers.get("mcp-session-id");
    const result = await response.json(); assert.equal(result.error, undefined, JSON.stringify(result)); return result.result;
  }
  async function tool(name, args) {
    const result = await mcp("tools/call", { name, arguments: args });
    rpc.push({ name, at: new Date().toISOString(), result: result.structuredContent });
    assert.equal(result.isError, undefined, JSON.stringify(result)); return result.structuredContent;
  }
  async function inspect(instanceId) {
    if (!info) return [];
    const listed = await tool("pi_session_list", {}), asks = [];
    for (const session of listed.sessions ?? []) {
      for (const ask of (await tool("pi_asks_pending", { sessionId: session.id })).asks) {
        if (!ask.toolCallId.endsWith(instanceId)) continue;
        assert.ok(ask.createdAt, "inspect timing must come from real waiter registration");
        asks.push({ phase: ask.toolCallId.startsWith("goal-") ? "goal" : "execution", toolCallId: ask.toolCallId, registeredAt: ask.createdAt });
      }
    }
    return asks;
  }
  async function until(predicate, label, timeout = 30000) {
    await waitFor(async () => { provider.check(); return predicate(); }, timeout, label);
  }
  async function create(scenario) {
    const { session } = await tool("pi_session_create", { title: scenario, mode: "agent", interactionMode: "interactive", projectPath: workspace,
      providerId: provider.id, modelId: "execution-ask-fixture" });
    await tool("pi_session_configure", { id: session.id, mode: "agent", permissionMode: "auto", confirm: true });
    const run = await tool("pi_agent_prompt", { sessionId: session.id,
      content: `EXECUTION_ASK_RELAY_SCENARIO=${scenario}\nEXECUTION_ASK_RELAY_INSTANCE=${session.id}\nAnswer then write the accepted original labels.`, expectedInteractionMode: "interactive" });
    let ask;
    await until(async () => { ask = (await tool("pi_asks_pending", { sessionId: session.id })).asks[0]; return !!ask; }, `${scenario} actual waiter`);
    assert.equal(ask.turnId, run.turnId); assert.ok(ask.createdAt);
    return { session, run, ask };
  }
  async function selected(sessionId) {
    await until(() => desktop.evaluate(`!!document.querySelector('[data-sidebar-session-row="${sessionId}"]')`), "real sidebar session");
    await desktop.evaluate(`document.querySelector('[data-sidebar-session-row="${sessionId}"] .thread-item-main').click()`);
    await until(() => desktop.evaluate(`!!document.querySelector('[data-sidebar-session-row="${sessionId}"].active') && !!document.querySelector('.asktool-card')`), "selected session real question card");
  }
  async function reload() {
    const previous = await desktop.evaluate("performance.timeOrigin");
    await desktop.send("Page.reload");
    await until(() => desktop.evaluate(`performance.timeOrigin !== ${previous} && document.readyState === 'complete' && !!window.piDesktop && !document.querySelector('.startup-splash')`), "new Renderer document ready");
  }
  async function completed(test, kind) {
    let turn;
    await until(async () => { turn = await tool("pi_turn_get", { sessionId: test.session.id, turnId: test.run.turnId }); return ["completed", "aborted", "error"].includes(turn.status); }, "durable ordinary terminal");
    assert.equal(turn.status, kind === "aborted" ? "aborted" : "completed");
    let session, row;
    await until(async () => { session = (await tool("pi_session_get", { id: test.session.id, messageLimit: 200 })).session;
      row = session.messages.find(message => message.role === "tool" && message.toolCallId === test.ask.toolCallId); return !!row; }, "original durable ask tool result");
    const result = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
    assert.equal(row.turnId, test.run.turnId, "tool result ownership must come from the durable Host index");
    assert.equal(result.details.resolutionKind, kind);
    assert.deepEqual((await tool("pi_asks_pending", { sessionId: test.session.id })).asks, []);
    results.push({ scenario: test.session.title, sessionId: test.session.id, turnId: test.run.turnId, requestId: test.ask.requestId, toolCallId: test.ask.toolCallId, status: turn.status, result });
    return result;
  }
  try {
    provider = await executionAskProvider({ requests, inspect });
    await host.start(); await host.call("workspace.set", { path: workspace });
    const created = await host.call("providers.create", { name: "Execution ask fixture", vendorKey: "custom", type: "openai_compatible", protocol: "openai_compatible",
      baseUrl: `${provider.baseUrl}/v1`, authKind: "none", apiStyle: "chat_completions", defaultModelId: "execution-ask-fixture", models: [{ id: "execution-ask-fixture" }] });
    provider.id = created.provider.id;
    await host.call("settings.set", { language: "en", theme: "dark", defaultProviderId: provider.id, defaultModelId: "execution-ask-fixture", defaultPermissionMode: "auto" });
    await host.stop();
    desktop = await executionAskDesktop({ root, scratch, dataDir, binary, bundle, env: process.env, log: output => { desktopOutput += output; } });
    info = desktop.connection;
    await mcp("initialize", { protocolVersion: "2025-06-18" });
    const tools = (await mcp("tools/list", {})).tools;
    for (const name of ["pi_asks_pending", "pi_asks_resolve", "pi_agent_status", "pi_plans_pending", "pi_plans_resolve"]) assert.ok(tools.some(tool => tool.name === name));
    const manifest = { control_url: provider.controlUrl, connection_file: desktop.connectionFile, provider_id: provider.id, model_id: "execution-ask-fixture" };
    await writeFile(join(scratch, "execution-ask-fixture.json"), JSON.stringify(manifest, null, 2));
    await json("fixture-location.json", { callerRoot: scratch, ...manifest, production_access: false });
    if (!serve) {
    const ui = await create("ordinary_ui");
    await selected(ui.session.id);
    await reload();
    await selected(ui.session.id);
    await until(() => desktop.evaluate("document.querySelector('.asktool-question-content')?.innerText === 'Choose a result'"), "reload restores real pending card");
    await desktop.evaluate("document.querySelector('.asktool-option[role=radio]').click()");
    await until(() => desktop.evaluate("document.querySelector('.asktool-option[role=radio]')?.getAttribute('aria-checked') === 'true'"), "first UI selection committed");
    await desktop.evaluate("document.querySelector('.asktool-card-header-actions .btn-primary').click()");
    await until(() => desktop.evaluate("document.querySelector('.asktool-question-content')?.innerText === 'Choose checks'"), "second question card");
    await desktop.evaluate("[...document.querySelectorAll('.asktool-option')].find(node=>node.innerText.trim()==='Integration').click()");
    await until(() => desktop.evaluate("[...document.querySelectorAll('.asktool-option')].find(node=>node.innerText.includes('Integration'))?.getAttribute('aria-pressed') === 'true'"), "second UI selection committed");
    await desktop.evaluate("document.querySelector('.asktool-card-header-actions .btn-primary').click()");
    const uiResult = await completed(ui, "answered"); assert.deepEqual(uiResult.details.answers, [["Zero"], ["Integration"]]);
    await until(() => desktop.evaluate("!document.querySelector('.asktool-card')"), "UI answer removes card");
    await reload();
    await until(() => desktop.evaluate(`!!document.querySelector('[data-sidebar-session-row="${ui.session.id}"]') && !document.querySelector('.startup-splash')`), "answered session reload");
    await desktop.evaluate(`document.querySelector('[data-sidebar-session-row="${ui.session.id}"] .thread-item-main').click()`);
    await until(() => desktop.evaluate(`!!document.querySelector('[data-sidebar-session-row="${ui.session.id}"].active') && !document.querySelector('.asktool-card')`), "answered card stays removed after reload");
    await writeFile(join(evidenceDir, "plus-answered-card-removed.png"), Buffer.from((await desktop.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    const decline = await create("ordinary_decline"); await selected(decline.session.id);
    await desktop.evaluate("document.querySelector('.asktool-decline').click()");
    assert.deepEqual((await completed(decline, "answered")).details.answers, [null, null]);
    for (const action of ["stop", "abort"]) {
      const test = await create(`ordinary_${action}`);
      await tool(action === "stop" ? "pi_agent_stop" : "pi_agent_abort", { sessionId: test.session.id });
      assert.deepEqual((await completed(test, action === "stop" ? "stopped" : "aborted")).details.answers, [null, null]);
    }
    const external = await create("ordinary_mcp"); await selected(external.session.id);
    const resolution = { sessionId: external.session.id, requestId: external.ask.requestId, expectedToolCallId: external.ask.toolCallId,
      answers: [["  custom  "], ["Unit", "Integration"]], confirm: true };
    assert.deepEqual(await tool("pi_asks_resolve", resolution), { status: "answered", requestId: resolution.requestId });
    assert.deepEqual((await completed(external, "answered")).details.answers, resolution.answers);
    await until(() => desktop.evaluate("!document.querySelector('.asktool-card')"), "MCP answer removes real Renderer card");
    assert.deepEqual(await tool("pi_asks_resolve", resolution), { status: "not_pending", requestId: resolution.requestId });
    const restart = await create("ordinary_restart");
    await desktop.stop();
    desktop = await executionAskDesktop({ root, scratch, dataDir, binary, bundle, env: process.env, log: output => { desktopOutput += output; } });
    info = desktop.connection; mcpSession = undefined;
    await mcp("initialize", { protocolVersion: "2025-06-18" });
    assert.deepEqual(await tool("pi_asks_pending", { sessionId: restart.session.id }), { sessionId: restart.session.id, asks: [] });
    assert.deepEqual((await tool("pi_agent_status", { sessionId: restart.session.id })).status.pendingInputs, { count: 0, requestIds: [] });
    results.push({ scenario: "ordinary_restart", sessionId: restart.session.id, requestId: restart.ask.requestId,
      pending: [], note: "real Desktop/sidecar generation restart does not invent live historical waiters" });
    if (kaneoRoot) {
      const args = [join(kaneoRoot, "scripts/validate_execution_questions.py"), "--core-root", join(kaneoRoot, "core"),
        "--connection-file", desktop.connectionFile, "--provider-id", provider.id, "--model-id", "execution-ask-fixture",
        "--evidence-dir", join(evidenceDir, "kaneopilot"), "--caller-fixture-root", scratch, "--fixture-control-url", provider.controlUrl];
      const child = spawn("python3", args, { cwd: kaneoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
      const exit = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      await writeFile(join(evidenceDir, "kaneopilot.log"), output);
      assert.equal(exit, 0, "KaneoPilot six real worker journeys must pass");
    }
    }
    if (serve) {
      console.log(JSON.stringify({ fixture_ready: true, callerRoot: scratch, ...manifest, evidence_dir: evidenceDir, production_access: false }));
      await new Promise(done => { process.once("SIGINT", done); process.once("SIGTERM", done); });
    }
    provider.check();
    assert.deepEqual(await fingerprint(bundle), bundleIdentity, "release sidecar bundle changed during validation");
    await verifyBuildReceipt(binary, { expected: receipt });
  } catch (error) { failure = error; throw error; }
  finally {
    await desktop?.stop(); await host.stop(); await provider?.stop(); globalThis.fetch = localFetch;
    await json("requests.json", requests); await json("mcp-results.json", rpc);
    await writeFile(join(evidenceDir, "desktop.log"), desktopOutput);
    await json("summary.json", { passed: !failure, failure: failure ? String(failure.stack ?? failure) : undefined,
      results, source: receipt.source, sidecar: "production release bundle", runtime: "real Electron bootstrap + Rust Host + HTTP MCP",
      renderer: serve ? "NOT RUN: serving caller-owned fixture" : "real question cards, UI answering, reload restore/remove, MCP answer removal", kaneopilot: kaneoRoot && !serve ? "see kaneopilot/summary.json" : "NOT RUN" });
    console.log(`Evidence: ${evidenceDir}`);
  }
}
