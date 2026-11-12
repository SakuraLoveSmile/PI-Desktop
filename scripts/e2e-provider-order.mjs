#!/usr/bin/env node
/** Provider drag/drop through the settings UI, production IPC and an isolated Rust host. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";

function assertHostRunsCleanup(runs) {
  assert(Array.isArray(runs));
  assert.equal(runs.length, 2, "both real Host runs must complete cleanup");
  for (const run of runs) {
    assert(Number.isInteger(run.pid) && run.pid > 0, "Host PID must be observed");
    assert(run.exit, "real Host child-exit must be observed");
    assert(
      (run.exit.code === 0 && run.exit.signal === null)
      || (run.exit.code === null && run.exit.signal === "SIGTERM"),
      "real Host must exit normally or from the fixture's SIGTERM",
    );
    assert.equal(run.stopComplete, true, "Host run must complete cleanup");
  }
  assert.notEqual(runs[0].pid, runs[1].pid, "restart must create a new Host process");
}

function assertForcedPeerCleanup(events) {
  assert(Array.isArray(events));
  const pid = events.find(event => event.name === "child-spawned")?.pid;
  assert(Number.isInteger(pid) && pid > 0);
  let cursor = -1;
  const next = (name, expected = {}) => {
    const index = events.findIndex((event, index) => index > cursor && event.pid === pid && event.name === name
      && Object.entries(expected).every(([key, value]) => event[key] === value));
    assert(index > cursor, `missing ordered peer lifecycle event: ${name} ${JSON.stringify(expected)}`);
    cursor = index;
  };
  next("signal-start", { signal: "SIGTERM" });
  next("signal-end", { signal: "SIGTERM", sent: true });
  next("exit-wait-start", { signal: "SIGTERM", budgetMs: 3000 });
  next("delay-timer-fired", { signal: "SIGTERM", budgetMs: 3000 });
  next("exit-wait-end", { signal: "SIGTERM", exited: false });
  next("signal-start", { signal: "SIGKILL" });
  next("signal-end", { signal: "SIGKILL", sent: true });
  next("exit-wait-start", { signal: "SIGKILL", budgetMs: 3000 });
  next("child-exit", { code: null, signal: "SIGKILL" });
  next("exit-wait-end", { signal: "SIGKILL", exited: true });
  next("stop-complete", { exited: true });
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const binary = resolveHostBinary();
const temp = await mkdtemp(join(tmpdir(), "pi-provider-order-"));
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/provider-order.tsx")],
    outfile: join(temp, "renderer.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
  });
  await build({
    entryPoints: [join(root, "apps/desktop/electron/main/ipc/provider-ipc.ts")],
    outfile: join(temp, "provider-ipc.cjs"), bundle: true, platform: "node", format: "cjs",
    external: ["electron"],
  });
  if (process.platform === "linux") await writeFile(join(temp, "term-resistant-peer.cjs"), String.raw`#!/usr/bin/env node
const { createInterface } = require("node:readline");
process.on("SIGTERM", () => {});
const input = createInterface({ input: process.stdin });
input.on("line", line => {
  const request = JSON.parse(line);
  const response = request.method === "app.handshake"
    ? { jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion } }
    : { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } };
  process.stdout.write(JSON.stringify(response) + "\n");
});
`, { mode: 0o700 });
  await writeFile(join(temp, "tokens.css"), (await readFile(join(root, "apps/desktop/src/styles/tokens.css"), "utf8")).replace(/@theme(?: inline)?/g, ":root"));
  await writeFile(join(temp, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="renderer.css"><body><script src="renderer.js"></script>`);
  await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const assertHostRunsCleanup = ${assertHostRunsCleanup.toString()};
const assertForcedPeerCleanup = ${assertForcedPeerCleanup.toString()};
const path = require("node:path");
const { registerProviderIpc } = require("./provider-ipc.cjs");
const diagnosticReferences = {
  globalThis, Promise, setTimeout: globalThis.setTimeout,
  nodeSetTimeout: require("node:timers").setTimeout,
};
app.setPath("userData", path.join(__dirname, "profile"));
// Cleanup owns the final exit, even after the fixture window is destroyed.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const { Host } = await import(${JSON.stringify(pathToFileURL(join(root, "scripts/e2e/host.mjs")).href)});
  const { IPC } = await import(${JSON.stringify(pathToFileURL(join(root, "packages/shared/dist/protocol.js")).href)});
  let window;
  let failure;
  const startedAt = Date.now();
  const stage = (name, detail = {}) => console.error("PROVIDER_ORDER_STAGE " + JSON.stringify({
    name, elapsedMs: Date.now() - startedAt, ...detail,
  }));
  const hostRuns = [];
  const peerEvents = [];
  let controlled;
  let controlledStopAttempted = false;
  let controlledReclaimed = false;
  let peerVerified = false;
  const host = new Host(${JSON.stringify(binary)}, path.join(__dirname, "data"), (name, detail) => {
    if (name === "child-spawned") hostRuns.push({ pid: detail.pid, stopComplete: false });
    const run = hostRuns.findLast(run => run.pid === detail.pid);
    if (run && name === "child-exit") run.exit = { code: detail.code, signal: detail.signal };
    if (run && name === "stop-complete" && detail.exited === true) run.stopComplete = true;
    stage("host-" + name, detail);
  }, diagnosticReferences);
  try {
    await host.start();
    stage("host-ready", { electron: process.versions.electron, node: process.versions.node });
    const fixtures = [];
    for (const name of ["A", "B", "C"]) {
      const { provider } = await host.call("providers.create", {
        name, authKind: "none", baseUrl: "http://127.0.0.1:9/v1",
        apiStyle: "chat_completions", defaultModelId: "model-" + name,
        models: name === "A" ? ["deepseek-chat", "deepseek-reasoner"].map(id => ({
          id, contextWindow: 128000, maxTokens: 8192,
          thinkingLevels: ["off"], defaultThinkingLevel: "off",
        })) : undefined,
      });
      fixtures.push(provider);
    }
    await host.call("settings.set", { defaultProviderId: fixtures[0].id, defaultModelId: fixtures[0].defaultModelId });
    for (const input of [
      { id: fixtures[0].id, targetId: fixtures[1].id, placement: "invalid" },
      { id: "missing", targetId: fixtures[1].id, placement: "before" },
      { id: fixtures[0].id, targetId: "missing", placement: "after" },
    ]) {
      let code;
      try { await host.call("providers.reorder", input); }
      catch (error) { code = error.errorCode; }
      if (code !== "INVALID_PARAMS") throw new Error("invalid reorder must be rejected without writing");
    }

    const registrar = { handle(channel, handler) {
      ipcMain.handle(channel, async (_event, input) => {
        try { return { ok: true, data: await handler(input) }; }
        catch (error) { return { ok: false, error: { code: error.errorCode || "INTERNAL", message: error.message } }; }
      });
    } };
    const enrich = (provider) => ({ ...provider, supportsReasoning: false, supportedThinkingLevels: ["off"] });
    registerProviderIpc({
      registrar, getHost: () => host,
      modelsDevCatalog: {
        ensureLoaded: async () => {}, loadLocal: async () => {}, findModel: () => undefined,
        modelsForProvider: () => [], getStatus: () => ({ loaded: true, source: "empty", modelCount: 0, providerCount: 0 }),
      },
      vendorOAuth: { listVendors: async () => [] }, logger: { app() {} },
      enrichProvider: enrich,
      enrichProviderList: async (result) => ({ providers: result.providers.map(enrich) }),
      listRuntimeProviders: async () => (await host.call("providers.list")).providers,
      bindingForModel: (provider, modelId) => provider.models?.find((model) => model.id === modelId),
    });
    registrar.handle(IPC.invoke.settingsGet, () => host.call("settings.get"));
    registrar.handle(IPC.invoke.settingsSet, (settings) => host.call("settings.set", settings));
    registrar.handle(IPC.invoke.sessionList, () => host.call("session.list"));
    registrar.handle(IPC.invoke.appGetOnboarding, async () => ({ dismissed: true }));
    // Fit the fixed content viewport inside macOS and default Xvfb work areas.
    window = new BrowserWindow({ show: false, width: 1000, height: 760, useContentSize: true, webPreferences: {
      preload: ${JSON.stringify(join(root, "apps/desktop/out/preload/index.cjs"))},
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    window.webContents.on("console-message", (event) => console.error(event.message));
    for (const name of ["did-start-loading", "dom-ready", "did-finish-load", "did-stop-loading"]) {
      window.webContents.on(name, () => stage(name));
    }
    window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) stage("did-fail-load", { code, description });
    });
    window.webContents.on("render-process-gone", (_event, detail) => stage("render-process-gone", detail));
    window.on("unresponsive", () => stage("unresponsive"));
    await window.loadFile(path.join(__dirname, "index.html"));
    stage("loaded");
    // Drag previews and the probe's waits require real display frames. Show
    // the fixture without taking keyboard focus, including under Linux/Xvfb.
    window.showInactive();
    const surface = await window.webContents.executeJavaScript("({ visibility: document.visibilityState, width: innerWidth, height: innerHeight })");
    stage("surface", { visible: window.isVisible(), minimized: window.isMinimized(), ...surface });
    if (!window.isVisible() || window.isMinimized() || surface.visibility !== "visible" || surface.width !== 1000 || surface.height !== 760) {
      throw new Error("Provider order fixture requires a visible 1000x760 content viewport");
    }
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => resolve()))");
    stage("first-frame");
    const interactions = await window.webContents.executeJavaScript("globalThis.providerOrderProbe()");
    stage("interactions-complete");
    const performance = await window.webContents.executeJavaScript("globalThis.cardReorderPerformance()");
    stage("performance-complete", { performance });
    stage("host-stop-start", { pid: host.child?.pid, pendingMethods: [...host.pending.values()].map(entry => entry.method) });
    await host.stop();
    stage("host-stopped");
    await host.start();
    stage("host-restarted", { pid: host.child?.pid });
    if (process.platform === "linux") {
      controlled = new Host(path.join(__dirname, "term-resistant-peer.cjs"), path.join(__dirname, "peer-data"), (name, detail) => {
        peerEvents.push({ name, ...detail });
        stage("peer-" + name, detail);
      }, diagnosticReferences);
      await controlled.start();
      stage("peer-ready", { pid: controlled.child?.pid });
    }
    stage("renderer-reload-start");
    await window.loadFile(path.join(__dirname, "index.html"));
    stage("restarted");
    const restart = await window.webContents.executeJavaScript("globalThis.providerOrderProbe(true)");
    if (controlled) {
      controlledStopAttempted = true;
      await controlled.stop();
      controlledReclaimed = true;
    }
    console.log("PROVIDER_ORDER_PROBE " + JSON.stringify({ ...interactions, restart: restart.ok, performance, surface }));
  } catch (error) {
    failure = error;
    console.error("PROVIDER_ORDER_PROBE " + JSON.stringify({ ok: false, error: String(error) }));
  } finally {
    const cleanupErrors = [];
    const cleanupFailed = error => {
      failure ||= error;
      cleanupErrors.push(String(error));
      stage("cleanup-failed", { error: String(error) });
    };
    try { window?.destroy(); }
    catch (error) { cleanupFailed(error); }
    try { await host.stop(); }
    catch (error) { cleanupFailed(error); }
    if (controlled && !controlledStopAttempted) {
      controlledStopAttempted = true;
      try { await controlled.stop(); controlledReclaimed = true; }
      catch (error) { cleanupFailed(error); }
    }
    try {
      assertHostRunsCleanup(hostRuns);
    } catch (error) { cleanupFailed(error); }
    if (process.platform === "linux") {
      try {
        assert.equal(controlledReclaimed, true, "controlled peer must complete cleanup");
        assertForcedPeerCleanup(peerEvents);
        peerVerified = true;
      } catch (error) { cleanupFailed(error); }
    }
    console.log("PROVIDER_ORDER_CLEANUP " + JSON.stringify({
      ok: !failure, error: failure ? String(failure) : undefined, cleanupErrors, hostRuns,
      peer: process.platform === "linux"
        ? { status: peerVerified ? "PASSED" : "FAILED", reclaimed: controlledReclaimed, events: peerEvents }
        : { status: "NOT RUN", reason: "Linux-only POSIX SIGTERM/SIGKILL regression" },
    }));
    app.exit(failure ? 1 : 0);
  }
});
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const spawnedAt = Date.now();
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output += data; });
  const recordedStages = () => output.split(/\r?\n/).filter(line => line.startsWith("PROVIDER_ORDER_STAGE ")).map(line => {
    try { return JSON.parse(line.slice("PROVIDER_ORDER_STAGE ".length)); }
    catch { return { name: "unparsed-stage" }; }
  });
  let observationChild;
  let observerClosed = false;
  const observationTimer = process.platform === "linux" ? setTimeout(() => {
    if (observerClosed || child.exitCode !== null || child.signalCode !== null) return;
    const stages = recordedStages();
    observationChild = execFile("ps", ["-L", "-o", "pid=,tid=,ppid=,stat=,wchan=,comm=", "-p", String(child.pid), "--ppid", String(child.pid)],
      { timeout: 2_000, maxBuffer: 16_384 }, (error, stdout, stderr) => {
        observationChild = undefined;
        if (observerClosed || child.exitCode !== null || child.signalCode !== null) return;
        console.log("PROVIDER_ORDER_PARENT " + JSON.stringify({
          name: "process-observation", elapsedMs: Date.now() - spawnedAt,
          electronPid: child.pid,
          scope: "Electron and its direct OS children", lastStage: stages.at(-1)?.name, code: error?.code ?? 0,
          signal: error?.signal, stdout: stdout.trim(), stderr: stderr.trim(),
        }));
      });
  }, 55_000) : undefined;
  const timer = setTimeout(() => {
    console.log("PROVIDER_ORDER_PARENT " + JSON.stringify({
      name: "watchdog", elapsedMs: Date.now() - spawnedAt, pid: child.pid,
      lastStage: recordedStages().at(-1)?.name,
    }));
    child.kill("SIGKILL");
  }, 60_000);
  let code, signal;
  try {
    ({ code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }));
  } finally {
    observerClosed = true;
    clearTimeout(timer);
    clearTimeout(observationTimer);
    try { observationChild?.kill("SIGKILL"); }
    catch (error) {
      console.log("PROVIDER_ORDER_PARENT " + JSON.stringify({
        name: "process-observation-cleanup-error", errorName: error.name, code: error.code,
      }));
    }
    observationChild = undefined;
  }
  const stages = output.split(/\r?\n/).filter(line => line.startsWith("PROVIDER_ORDER_STAGE "));
  for (const stage of stages) console.log(stage);
  const line = output.split(/\r?\n/).find((line) => line.startsWith("PROVIDER_ORDER_PROBE "));
  assert(line, `no result (exit=${code}, signal=${signal}): ${output.slice(-4000)}`);
  console.log(line);
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(JSON.parse(line.slice("PROVIDER_ORDER_PROBE ".length)).ok, true);
  const cleanupLines = output.split(/\r?\n/).filter(line => line.startsWith("PROVIDER_ORDER_CLEANUP "));
  assert.equal(cleanupLines.length, 1, `expected one completed cleanup: ${output.slice(-6000)}`);
  console.log(cleanupLines[0]);
  const cleanup = JSON.parse(cleanupLines[0].slice("PROVIDER_ORDER_CLEANUP ".length));
  assert.equal(cleanup.ok, true, cleanup.error);
  assert.deepEqual(cleanup.cleanupErrors, []);
  assertHostRunsCleanup(cleanup.hostRuns);
  if (process.platform === "linux") {
    assert.equal(cleanup.peer.status, "PASSED");
    assert.equal(cleanup.peer.reclaimed, true);
    assertForcedPeerCleanup(cleanup.peer.events);
  } else {
    assert.equal(cleanup.peer.status, "NOT RUN");
    console.log("Provider TERM timeout regression: NOT RUN (Linux only)");
  }
} finally { await rm(temp, { recursive: true, force: true }); }
