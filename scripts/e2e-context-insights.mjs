#!/usr/bin/env node
/** Isolated native Context Insights journey. Requires built Desktop/runtime/Host. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectControl, connectRenderer } from "../apps/desktop/test/e2e/plugin-ui-slots/clients.mjs";
import { startStubModel } from "../apps/desktop/test/e2e/plugin-ui-slots/stub-model.mjs";
import { assertDesktopBuild, repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const root = repositoryRoot();
const runRoot = process.env.E2E_ROOT ? resolve(process.env.E2E_ROOT) : mkdtempSync(join(tmpdir(), "pi-context-insights-e2e-"));
const dataDir = join(runRoot, "data");
const homeDir = join(runRoot, "home");
const project = join(runRoot, "project");
const results = [];
let electron;
let renderer;
let cdp;
let stub;
let fixture;
let sessionId;
let durable;

function check(name, condition, detail) {
  assert(condition, `${name}${detail ? `: ${detail}` : ""}`);
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}

async function until(probe, label, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    if (electron?.child.exitCode !== null && electron?.child.exitCode !== undefined) {
      throw new Error(`Electron exited during ${label}: ${electron.output.slice(-3500)}`);
    }
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function readFixtureServer(stubPort) {
  const requests = [];
  let release;
  const gate = new Promise((done) => { release = done; });
  const server = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
        res.writeHead(404); res.end("{}"); return;
      }
      const payload = JSON.parse(raw);
      requests.push(payload);
      const lastUser = payload.messages.findLastIndex((message) => message.role === "user");
      const readDone = payload.messages.slice(lastUser + 1).some((message) => message.role === "tool");
      if (readDone) {
        const response = await fetch(`http://127.0.0.1:${stubPort}/v1/chat/completions`, {
          method: "POST", headers: { "content-type": "application/json" }, body: raw,
        });
        res.writeHead(response.status, { "content-type": "text/event-stream" });
        res.end(await response.text()); return;
      }
      await gate;
      const base = { id: "chatcmpl-context-read", object: "chat.completion.chunk", created: 1, model: payload.model };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunks = [
        { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_context_read", type: "function", function: { name: "Read", arguments: JSON.stringify({ path: join(project, "fixture.txt") }) } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 120, completion_tokens: 10, total_tokens: 130, prompt_tokens_details: { cached_tokens: 20 } } },
      ];
      for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.end("data: [DONE]\n\n");
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { port: server.address().port, requests, release, close: () => new Promise((done) => { release(); server.close(done); }) };
}

async function seed(hostBin) {
  for (const path of [homeDir, project, dataDir]) mkdirSync(path, { recursive: true });
  writeFileSync(join(project, "fixture.txt"), "CONTEXT_INSIGHTS_READ_FIXTURE\nA deterministic local file.\n");
  const host = new Host(hostBin, dataDir);
  await host.start();
  try {
    const provider = await host.call("providers.create", {
      name: "Context fixture", type: "openai_compatible", baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
      apiStyle: "chat_completions", authKind: "api_key", secretValue: "sk-context-fixture-only",
      models: [{ id: "context-stub", contextWindow: 128000, maxTokens: 4096, thinkingLevels: ["off"] }], defaultModelId: "context-stub",
    });
    await host.call("settings.set", { language: "en", defaultProviderId: provider.provider?.id ?? provider.id, defaultModelId: "context-stub", defaultMode: "agent", autoGenerateTitle: false });
  } finally { await host.stop(); }
}

function launch(electronBinary, hostBin, mcpPort, cdpPort) {
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"), XDG_CACHE_HOME: join(homeDir, ".cache"),
    PI_DESKTOP_DATA_DIR: dataDir, PI_CODING_AGENT_DIR: join(homeDir, ".pi", "agent"),
    PI_DESKTOP_HOST_BIN: hostBin, PI_DESKTOP_MCP_CONTROL: "1", PI_DESKTOP_MCP_PORT: String(mcpPort),
    ELECTRON_RENDERER_URL: "", PI_DESKTOP_START_MAXIMIZED: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [`--user-data-dir=${join(runRoot, "profile")}`, `--remote-debugging-port=${cdpPort}`, "."], {
    cwd: join(root, "apps", "desktop"), env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  const instance = { child, output: "" };
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { instance.output = `${instance.output}${chunk}`.slice(-18000); });
  return instance;
}

async function stop() {
  renderer?.close(); renderer = undefined;
  cdp?.close(); cdp = undefined;
  if (!electron) return;
  const child = electron.child;
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise((done) => child.once("close", done));
    const kill = (signal) => {
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-child.pid, signal);
      } catch { child.kill(signal); }
    };
    kill("SIGTERM");
    if (await Promise.race([closed.then(() => false), delay(3000).then(() => true)])) { kill("SIGKILL"); await closed; }
  }
  writeFileSync(join(runRoot, "electron.log"), electron.output.replaceAll("sk-context-fixture-only", "[fixture credential]"));
  electron = undefined;
}

async function connectCdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((entry) => entry.type === "page" && entry.url.includes("index.html") && entry.webSocketDebuggerUrl);
  assert(target, "desktop renderer target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const reply = JSON.parse(String(data)); const entry = pending.get(reply.id); if (!entry) return;
    pending.delete(reply.id); clearTimeout(entry.timer);
    if (reply.error) entry.reject(new Error(reply.error.message)); else entry.done(reply.result);
  });
  return { call(method, params = {}) { return new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 15000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  }); }, close: () => socket.close() };
}

async function boot(electronBinary, hostBin) {
  const mcpPort = await freePort(); const cdpPort = await freePort();
  electron = launch(electronBinary, hostBin, mcpPort, cdpPort);
  await until(() => {
    if (!existsSync(join(dataDir, "mcp-control.json"))) return false;
    const info = JSON.parse(readFileSync(join(dataDir, "mcp-control.json"), "utf8"));
    return info.active === true && new URL(info.url).port === String(mcpPort);
  }, "isolated control plane", 90000);
  await until(async () => { const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); return targets.some((target) => target.type === "page" && target.url.includes("index.html")); }, "renderer target");
  renderer = await connectRenderer(cdpPort); cdp = await connectCdp(cdpPort);
  // Retain awaited values while Chromium performs navigation/GC (the same
  // ownership pattern as e2e-provider-recovery.mjs). Synchronous DOM polling
  // and pointer input continue to use the existing renderer client.
  renderer.run = async (fn, arg) => {
    const reply = await cdp.call("Runtime.evaluate", {
      expression: `globalThis.__contextInsightsCdpPromise = Promise.resolve((${fn})(${JSON.stringify(arg ?? null)}))`,
      awaitPromise: true, returnByValue: true,
    });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result?.value;
  };
  await renderer.until(() => Boolean(window.__PI_DESKTOP__ && window.piDesktop && !document.querySelector(".app-shell.is-booting")), null, "native app ready", 45000);
  return connectControl(dataDir);
}

async function ipc(name, input) {
  const result = await renderer.run(async ({ name, input }) => window.piDesktop.invoke(window.piDesktop.channels.invoke[name], ...(input === undefined ? [] : [input])), { name, input });
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`); return result.data;
}

async function snapshot(includeContent = true) { return ipc("contextInsightsGet", { sessionId, includeContent }); }

async function shot(name, width = 1280, height = 900, browserSection = false) {
  await cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.until(({ width, height }) => window.innerWidth === width && window.innerHeight === height, { width, height }, "viewport applied");
  if (name.startsWith("work-panel") || browserSection) {
    let previous;
    let stable = 0;
    await until(async () => {
      const geometry = await renderer.run(() => {
        const panel = document.querySelector(".work-panel");
        const box = panel?.getBoundingClientRect();
        const transitioning = Boolean(document.querySelector(".sidebar.is-exiting, .sidebar.is-entering, .work-panel.is-exiting"));
        const animated = document.getAnimations().some((animation) => animation.playState === "running" && animation.effect?.target instanceof Element && animation.effect.target.matches(".sidebar, .work-panel"));
        return { width: box?.width, left: box?.left, right: box?.right, viewport: window.innerWidth, transitioning: transitioning || animated };
      });
      const key = JSON.stringify(geometry);
      stable = key === previous ? stable + 1 : 0; previous = key;
      return geometry.width >= 180 && geometry.left >= 0 && geometry.right <= geometry.viewport + 1 && !geometry.transitioning && stable >= 2;
    }, "visible stable Work Panel geometry", 15000);
  }
  await renderer.run(() => {
    document.scrollingElement?.scrollTo(0, 0);
    for (const element of document.querySelectorAll(".route-scroll, .ci-overview, .work-panel-body, .ci-dashboard, .context-insights-dialog")) element.scrollTo(0, 0);
  });
  if (browserSection) await renderer.run(() => document.querySelector(".ci-browser").scrollIntoView({ block: "start" }));
  await renderer.run(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const layout = await renderer.run((browserSection) => {
    const root = document.querySelector(".context-insights-dialog") ?? document.querySelector(".ci-overview") ?? document.querySelector(".ci-dashboard");
    const heading = browserSection ? root?.querySelector(".ci-browser h3") : root?.querySelector("h1, h2");
    const box = heading?.getBoundingClientRect();
    const panel = document.querySelector(".work-panel")?.getBoundingClientRect();
    return { viewport: { width: window.innerWidth, height: window.innerHeight }, heading: box ? { top: box.top, left: box.left, right: box.right, bottom: box.bottom } : null, overflow: root ? { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth } : null, panel: panel ? { width: panel.width, left: panel.left, right: panel.right } : null };
  }, browserSection);
  if (name.startsWith("work-panel") || browserSection) {
    check(`${name} exposes its heading without horizontal clipping`, layout.heading?.top >= 0 && layout.heading.bottom <= height && layout.heading.left >= 0 && layout.heading.right <= width && layout.overflow.scrollWidth <= layout.overflow.clientWidth + 1, JSON.stringify(layout));
  }
  writeFileSync(join(runRoot, `${name}.layout.json`), JSON.stringify(layout, null, 2));
  const path = join(runRoot, `${name}.png`); writeFileSync(path, Buffer.from(await renderer.screenshot(), "base64"));
  console.log(`SCREENSHOT ${path}`);
}

async function select(selector, value) {
  await renderer.run(({ selector, value }) => {
    const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`);
    element.value = value; element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { selector, value });
}

async function clearInput(selector) {
  await renderer.run((selector) => {
    const element = document.querySelector(selector); element.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, ""); element.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
}

function executableHashes(hostBin) {
  return Object.fromEntries([hostBin, "scripts/e2e-context-insights.mjs", "apps/desktop/out/main/index.js", "apps/desktop/out/renderer/index.html", "packages/shared/dist/context-insights.js", "packages/agent-runtime/dist/sidecar.js", "packages/agent-runtime/dist/runtime.js", "packages/agent-runtime/dist/context-insights.js"].map((file) => {
    const path = file === hostBin ? file : join(root, file);
    return [path, createHash("sha256").update(readFileSync(path)).digest("hex")];
  }));
}

async function run() {
  const hostBin = resolveHostBinary(); const { electronBinary } = resolveElectronBinary(root); assertDesktopBuild(root);
  const testedExecutables = executableHashes(hostBin);
  console.log(`ARTIFACTS ${runRoot}`);
  stub = await startStubModel(); fixture = await readFixtureServer(stub.port); await seed(hostBin);
  let control = await boot(electronBinary, hostBin);
  await renderer.click('[data-nav="context-insights"]');
  await renderer.until(() => Boolean(document.querySelector(".ci-overview .ci-heatmap")), null, "overview calendar");
  check("sidebar opens native overview without provider calls", fixture.requests.length === 0);
  await control.tool("pi_project_open", { path: realpathSync(project) });
  const created = await control.tool("pi_session_create", { title: "Context fixture journey", projectPath: realpathSync(project), mode: "agent" });
  sessionId = created.session?.id ?? created.id; assert(sessionId);
  await control.tool("pi_session_configure", { id: sessionId, mode: "agent", permissionMode: "auto", confirm: true });
  await renderer.run((id) => window.__PI_DESKTOP__.selectSession(id), sessionId);
  await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "fixture chat");
  await renderer.run(() => {
    window.__contextEvents = [];
    window.__offContextEvents = window.piDesktop.on(window.piDesktop.channels.event.agentMessage, (event) => window.__contextEvents.push(event));
  });
  await control.tool("pi_agent_prompt", { sessionId, content: "Read fixture.txt, then acknowledge the CONTEXT_INSIGHTS_READ_FIXTURE marker." });
  await until(() => fixture.requests.length === 1, "provider request waiting at gate");
  const running = await until(async () => { const value = await snapshot(); return value.requests.some((request) => request.status === "running") && value; }, "running request persisted");
  check("runtime request-start reaches real Host through persistence outbox", running.requests[0].entries.some((entry) => entry.category === "system") && running.requests[0].entries.some((entry) => entry.category === "tools" && entry.label === "Read"));
  fixture.release(); await control.waitForTurn(sessionId);
  durable = await until(async () => { const value = await snapshot(); return value.requests.length === 2 && value.requests.every((request) => request.status === "completed" && request.usage) && value; }, "settled requests persisted");
  const last = durable.requests.at(-1);
  check("Read user path records two completed provider requests", fixture.requests.length === 2 && durable.requests.map((request) => request.step).join(",") === "1,2");
  check("captured provider payload matches the actual dispatched messages and schemas", durable.requests.every((request, index) => {
    if (request.captureSource !== "provider-payload" || !request.providerPayload || request.providerPayload.truncated) return false;
    const captured = JSON.parse(request.providerPayload.content);
    const received = fixture.requests[index];
    return ["model", "messages", "tools"].every((key) => JSON.stringify(captured[key]) === JSON.stringify(received[key]));
  }));
  check("assembled captures include prompt, schemas, user, call and Read result", last.entries.some((entry) => entry.category === "user" && entry.content.includes("CONTEXT_INSIGHTS_READ_FIXTURE")) && last.entries.some((entry) => entry.category === "assistant" && entry.kind === "toolCall" && entry.label === "Read") && last.entries.some((entry) => entry.category === "toolResult" && entry.content.includes("CONTEXT_INSIGHTS_READ_FIXTURE")));
  check("reported usage and transport facts settle on captured identities", durable.requests[0].usage.inputTokens === 100 && durable.requests[0].usage.cacheReadTokens === 20 && last.usage.outputTokens === 5 && last.providerStatus === 200 && last.requestBytes > 0);
  check("diagnostics exclude provider fixture credential", !JSON.stringify(durable).includes("sk-context-fixture-only"));
  const metadata = await snapshot(false);
  check("overview metadata omits full content explicitly", metadata.requests.every((request) => request.entries.every((entry) => entry.content === "" && entry.contentOmitted === true) && request.providerPayload?.content === "" && request.providerPayload?.contentOmitted === true));
  const selected = await ipc("contextInsightsGet", { sessionId, requestId: last.id, includeContent: true });
  check("selected-content IPC returns only the requested identity", selected.requests.length === 1 && selected.requests[0].id === last.id);
  const events = await renderer.run(() => window.__contextEvents.filter((envelope) => envelope.event?.type === "context_insights"));
  check("renderer receives capture lifecycle events", events.length >= 4 && events.some((envelope) => envelope.event.request?.status === "running") && events.some((envelope) => envelope.event.request?.status === "completed"));

  await renderer.click('[data-nav="context-insights"]');
  await renderer.until(() => document.querySelector(".ci-session-grid")?.textContent.includes("2 retained requests"), null, "overview captured session");
  await renderer.click('input[aria-label="Search sessions"]'); await renderer.type("missing fixture title");
  await renderer.until(() => !document.querySelector(".ci-session-card"), null, "overview search empty");
  await clearInput('input[aria-label="Search sessions"]');
  await renderer.type("Context fixture");
  await renderer.until(() => document.querySelectorAll(".ci-session-card").length === 1, null, "overview search match");
  await select('select[aria-label="Date range"]', "day");
  await renderer.until(() => Boolean(document.querySelector('input[type="date"]')), null, "specific-day control");
  await select('select[aria-label="Project"]', realpathSync(project));
  await renderer.until(() => document.querySelectorAll(".ci-session-card").length === 1, null, "project/day filtered session");
  check("overview search, day and project filters preserve session card", true);
  check("overview local-day activity and usage chart show fixture usage", await renderer.run(() => [...document.querySelectorAll(".ci-daily-bars span:first-child")].some((bar) => Number.parseFloat(bar.style.height) > 2) && [...document.querySelectorAll(".ci-heatmap [data-level]")].some((cell) => Number(cell.getAttribute("data-level")) > 0)));
  await shot("overview-wide");
  check("overview heading clears the native titlebar at wide width", await renderer.run(() => document.querySelector(".ci-overview h1").getBoundingClientRect().top >= 28));
  await shot("overview-narrow", 760, 900);
  check("overview heading clears the native titlebar at narrow width", await renderer.run(() => document.querySelector(".ci-overview h1").getBoundingClientRect().top >= 28));
  await shot("overview-reset");
  await renderer.click('.ci-session-card button[aria-label="Open session Context fixture journey"]');
  await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "card opens chat");
  await renderer.until(() => Boolean(document.querySelector(".ci-dashboard .ci-browser")) && !document.querySelector(".ci-dashboard .ci-browser [role=status]"), null, "card session selection and Context opening settled");
  check("overview session card selects its session and opens Context", true);
  await renderer.click(".work-panel-new-tab");
  await renderer.until(() => Boolean(document.querySelector('[data-work-panel-launcher-item="context"]')), null, "Work Panel launcher");
  await renderer.click('[data-work-panel-launcher-item="context"]');
  await renderer.until(() => document.querySelector(".ci-dashboard .ci-browser") && !document.querySelector(".ci-dashboard .ci-browser [role=status]"), null, "Work Panel captured context");
  check("native Work Panel Context tab opens the selected session dashboard", await renderer.run(() => Boolean(document.querySelector('#work-panel-tab-context[aria-selected="true"]'))));
  await renderer.click('.ci-dashboard input[aria-label="Search context content"]'); await renderer.type("CONTEXT_INSIGHTS_READ_FIXTURE");
  await renderer.until(() => document.querySelector(".ci-browser .ci-content")?.textContent.includes("CONTEXT_INSIGHTS_READ_FIXTURE"), null, "context search content");
  check("context search expands matching assembled entries", await renderer.run(() => [...document.querySelectorAll(".ci-browser .ci-entry")].every((entry) => entry.open)));
  await shot("context-browser-wide", 1280, 900, true);
  await shot("context-browser-narrow", 760, 900, true);
  await shot("context-browser-reset", 1280, 900, true);
  await clearInput('.ci-dashboard input[aria-label="Search context content"]');
  await select('.ci-dashboard select[aria-label="Assistant content"]', "calls");
  await renderer.until(() => [...document.querySelectorAll(".ci-browser .ci-category")].some((node) => node.textContent.includes("Assistant messages")), null, "assistant call filter");
  await renderer.click('.ci-dashboard [aria-label="Trend measure"] button:nth-child(2)');
  await renderer.until(() => Boolean(document.querySelector(".ci-dashboard .ci-trend-bars.ci-delta")), null, "signed delta trend");
  await renderer.click('.ci-dashboard [aria-label="Trend granularity"] button:nth-child(2)');
  await renderer.until(() => document.querySelectorAll(".ci-dashboard .ci-trend-bar").length === 1, null, "per-turn trend aggregation");
  check("trend switches delta and turn aggregation through native controls", await renderer.run(() => {
    const value = JSON.parse(localStorage.getItem("pi-desktop.context-insights.preferences.v1"));
    return value.measure === "delta" && value.granularity === "turn";
  }));
  await renderer.click('.ci-dashboard [aria-label="Trend measure"] button:nth-child(1)');
  await renderer.click('.ci-dashboard [aria-label="Trend granularity"] button:nth-child(1)');
  await renderer.until(() => document.querySelectorAll(".ci-dashboard .ci-trend-bar").length === 2, null, "per-step trend restored");
  await renderer.click('.ci-dashboard .ci-trend-bar[aria-label="Pin request 1"]');
  await renderer.until(() => document.querySelector('.ci-dashboard select[aria-label="Selected request"]')?.value === document.querySelectorAll('.ci-dashboard select[aria-label="Selected request"] option')[0]?.value, null, "pinned request selection");
  check("trend pins an earlier durable request", await renderer.run(() => document.querySelector('.ci-trend-bar[aria-label="Pin request 1"]')?.getAttribute("aria-pressed") === "true"));
  await shot("work-panel-wide"); await shot("work-panel-narrow", 760, 900); await shot("work-panel-reset");
  await renderer.run(() => [...document.querySelectorAll(".ci-dashboard button")].find((button) => button.textContent === "Refresh").click());
  await renderer.until(() => !document.querySelector(".ci-browser [role=status]"), null, "refresh settled");

  // Composer dispatch is the real first-party slash-command path.
  await renderer.click(".composer-input"); await renderer.type("/context");
  await renderer.click(".composer-shell .send-btn");
  await renderer.until(() => Boolean(document.querySelector('.context-insights-dialog[role="dialog"] .ci-browser')), null, "/context opens dialog");
  check("/context opens a native dialog through Composer without a turn", fixture.requests.length === 2);
  await shot("dialog-wide"); await shot("dialog-narrow", 760, 900); await shot("dialog-reset");
  try {
    await renderer.click('.context-insights-dialog button[aria-label="Close"]');
    check("dialog Close button is visible and receives native pointer input", true);
  } catch (error) {
    results.push({ name: "dialog Close button is visible and receives native pointer input", passed: false, error: error.message });
    console.error(`FAIL dialog pointer interaction: ${error.message}`);
    // Continue independent persistence/deletion gates using the real Escape path.
    await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  await renderer.until(() => !document.querySelector(".context-insights-dialog"), null, "dialog closes");
  check("browsing, filtering, pinning and refresh make no additional provider call", fixture.requests.length === 2);

  await ipc("settingsSet", { language: "zh-CN" });
  await stop(); control = await boot(electronBinary, hostBin);
  const restored = await snapshot();
  check("full Electron/Host restart retains exact request identities and contents", JSON.stringify(restored.requests) === JSON.stringify(durable.requests) && fixture.requests.length === 2);
  await renderer.run((id) => window.__PI_DESKTOP__.selectSession(id), sessionId);
  await renderer.until(() => Boolean(document.querySelector(".composer-input")), null, "restored Chinese chat");
  await renderer.click(".composer-input"); await renderer.type("/context"); await renderer.click(".composer-shell .send-btn");
  await renderer.until(() => Boolean(document.querySelector('.context-insights-dialog[role="dialog"] .ci-browser')), null, "Chinese Context dialog");
  check("normal settings and restart load Chinese Context labels", await renderer.run(() => document.querySelector("#context-insights-dialog-title")?.textContent === "上下文洞察"));
  await shot("dialog-zh-CN-wide"); await shot("dialog-zh-CN-narrow", 760, 900);
  check("Chinese Context inspection still makes no provider call", fixture.requests.length === 2);
  await control.tool("pi_session_delete", { id: sessionId, confirm: true });
  const deleted = await renderer.run(async (sessionId) => window.piDesktop.invoke(window.piDesktop.channels.invoke.contextInsightsGet, { sessionId, includeContent: true }), sessionId);
  check("deleted session diagnostics fail rather than reappear", deleted.ok === false && JSON.stringify(deleted).includes("NOT_FOUND"));
  await stop();
  const host = new Host(hostBin, dataDir); await host.start();
  try {
    const late = await host.call("contextInsights.record", { sessionId, request: durable.requests[0] });
    check("late capture after session deletion cannot recreate diagnostics", late?.recorded === false);
    await assert.rejects(host.call("contextInsights.get", { sessionId, includeContent: true }), /NOT_FOUND/);
  } finally { await host.stop(); }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const base = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
  check("tested executables remain unchanged throughout the run", JSON.stringify(testedExecutables) === JSON.stringify(executableHashes(hostBin)));
  writeFileSync(join(runRoot, "evidence.json"), JSON.stringify({ candidate: head, base, dirtyCandidate: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0, hostBin, electronBinary, executableHashes: testedExecutables, results, captured: durable, providerRequests: fixture.requests.length, screenshots: ["overview-wide", "overview-narrow", "work-panel-wide", "work-panel-narrow", "context-browser-wide", "context-browser-narrow", "dialog-wide", "dialog-narrow", "dialog-zh-CN-wide", "dialog-zh-CN-narrow"].map((name) => `${name}.png`) }, null, 2));
}

try {
  await run();
  const passed = results.filter((result) => result.passed).length;
  console.log(`SUMMARY ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
}
catch (error) {
  console.error(`FAIL context-insights E2E: ${error.stack}`);
  if (renderer) {
    await shot("failure").catch(() => {});
    const state = await renderer.run(() => ({ text: document.body.innerText, events: window.__contextEvents })).catch(() => null);
    writeFileSync(join(runRoot, "failure.json"), JSON.stringify({ results, state }, null, 2));
  }
  process.exitCode = 1;
} finally {
  fixture?.release(); await stop(); await fixture?.close(); await stub?.close();
  console.log(`E2E artifacts retained at ${runRoot}`);
}
