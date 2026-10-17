#!/usr/bin/env node
/**
 * E2E-QUEUE-send-now-abort-offer-after-30s: a real Electron window and host,
 * with a scripted model whose Bash call never returns on its own.
 *
 * A queued prompt is promoted with Send now. The abort offer must stay hidden
 * for the first 30 seconds, then appear. Clicking it must stop only that Bash
 * call, start the queued prompt, and leave no process from the command running.
 * The model must get no turn between the kill and the queued prompt, and the
 * queued request must carry the aborted call's own result, so the next provider
 * request is a valid transcript.
 * The process check only observes (ps, by marker); the script kills nothing it
 * did not spawn itself.
 *
 * Prereqs: `node node_modules/electron-vite/bin/electron-vite.js build` in
 * apps/desktop, and a debug host-core binary (target/debug/pi-desktop-host-core,
 * or PI_DESKTOP_HOST_BIN).
 */
import { execFile, spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  assertDesktopBuild,
  findDesktopRendererTarget,
  repositoryRoot,
  resolveElectronBinary,
} from "./e2e/boot.mjs";

const execFileAsync = promisify(execFile);
const root = repositoryRoot();
const { appDir, electronBinary } = resolveElectronBinary(root);
assertDesktopBuild(root);
const hostBinary = process.env.PI_DESKTOP_HOST_BIN || join(root, "target", "debug", "pi-desktop-host-core");
if (!existsSync(hostBinary)) {
  console.error(`host binary missing: ${hostBinary}. Run cargo build -p host-core --locked, or set PI_DESKTOP_HOST_BIN.`);
  process.exit(1);
}

const SLOW_MARK = "E2E-SLOW-BASH";
const QUEUED_MARK = "E2E-QUEUED-PROMPT";
const QUEUED_REPLY = "Queued reply finished.";
const ABORT_OFFER_DELAY_MS = 30_000;
const HIDDEN_CHECKS_MS = [5_000, 25_000];
const VISIBLE_BY_MS = 40_000;
const FRAME_WAIT_FALLBACK_MS = 1_000;
const marker = String(randomInt(100_000, 1_000_000));
const bashCommand = `echo start-${marker}; sleep 297.${marker}; echo end-${marker}`;
// Real abort evidence in the tool result: the partial output or an abort word.
const abortEvidence = new RegExp(`abort|stopp|killed|cancel|TOOL_ABORTED|start-${marker}`, "i");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepUntil = (time) => sleep(Math.max(0, time - Date.now()));

async function waitFor(check, label, timeoutMs = 20_000, intervalMs = 250) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(intervalMs);
  }
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`assertion failed: ${name}`);
}

// Runs one named step. A failure is rethrown with the step name and the window
// state at that moment, so a stuck run says where it stopped. The state read has
// its own short bound, so a stalled renderer cannot hold up the report.
async function step(cdp, name, action) {
  try {
    return await action();
  } catch (error) {
    const state = await Promise.resolve()
      .then(() => cdp.send("Runtime.evaluate", { expression: "({ visibility: document.visibilityState, hasFocus: document.hasFocus() })", returnByValue: true }, 2_000))
      .then((result) => result.result?.value)
      .catch(() => null);
    const where = state ? `visibility=${state.visibility}, hasFocus=${state.hasFocus}` : "window state unavailable";
    throw new Error(`step ${name} failed: ${error.message} (${where})`, { cause: error });
  }
}

function createModelFixture(log) {
  const textOf = (message) =>
    typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
  return async (req, res) => {
    if (req.method === "GET" && req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fixture", object: "model" }] }));
      return;
    }
    try {
      let body = "";
      for await (const part of req) body += part;
      const request = JSON.parse(body);
      const messages = request.messages ?? [];
      const last = messages.at(-1) ?? {};
      const lastUser = [...messages].reverse().find((message) => message.role === "user");
      const bash = (request.tools ?? []).find((tool) => tool.function?.name === "Bash");
      log.requests.push(last.role ?? "none");
      let call = null;
      let text = "Fixture reply.";
      if (bash && log.bashCalls === 0 && last.role === "user" && textOf(lastUser).includes(SLOW_MARK)) {
        const properties = bash.function.parameters?.properties ?? {};
        if (!properties.command || !properties.timeout) {
          throw new Error(`unexpected Bash schema: ${JSON.stringify(bash.function.parameters)}`);
        }
        log.bashCalls += 1;
        call = { name: bash.function.name, args: { command: bashCommand, timeout: 300 } };
      } else if (last.role === "user" && textOf(last).includes(QUEUED_MARK)) {
        log.queuedSeen = true;
        text = QUEUED_REPLY;
        // Record the wire history the runtime sent, not what the model did with
        // it: an unanswered tool call would be rejected by real providers.
        log.queuedHistory = {
          roles: messages.map((message) => message.role),
          calls: messages.flatMap((message) => message.tool_calls ?? []).map((call) => call.id),
          results: messages
            .filter((message) => message.role === "tool")
            .map((message) => ({ toolCallId: message.tool_call_id, head: textOf(message).slice(0, 200) })),
        };
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const base = { id: `send-now-${log.requests.length}`, object: "chat.completion.chunk", created: 1, model: request.model };
      const emit = (delta, finish_reason = null) =>
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      if (call) {
        emit({ role: "assistant", tool_calls: [{
          index: 0,
          id: `bash-call-${log.bashCalls}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        }] });
        emit({}, "tool_calls");
      } else {
        emit({ role: "assistant", content: text });
        emit({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    } catch (error) {
      log.errors.push(String(error?.stack ?? error));
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  };
}

function connectCdp(url, onEvent) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method) {
      onEvent(message);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`CDP socket failed: ${url}`)), { once: true });
  });
  // A reply can be lost while the page reloads; a bounded wait keeps waitFor retrying.
  const send = (method, params = {}, timeoutMs = 20_000) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  };
  return {
    opened,
    send,
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "evaluate failed");
      }
      return result.result?.value;
    },
    close() {
      socket.close();
    },
  };
}

async function invoke(cdp, channel, args = []) {
  const result = await cdp.evaluate(`(async () => {
    const bridge = window.piDesktop;
    if (!bridge?.invoke || !bridge.channels?.invoke?.${channel}) {
      throw new Error("required preload channel is unavailable: ${channel}");
    }
    return bridge.invoke(bridge.channels.invoke.${channel}, ...${JSON.stringify(args)});
  })()`);
  if (result?.ok !== true) throw new Error(`preload ${channel} failed: ${JSON.stringify(result)}`);
  return result.data;
}

// Merges a patch into the current settings. The command-shell field is left out
// of the write, as the Plan UI E2E does, so this is not treated as a shell change.
async function updateSettings(cdp, patch) {
  const result = await cdp.evaluate(`(async () => {
    const bridge = window.piDesktop;
    const getChannel = bridge?.channels?.invoke?.settingsGet;
    const setChannel = bridge?.channels?.invoke?.settingsSet;
    if (!bridge?.invoke || !getChannel || !setChannel) throw new Error("settings preload API is unavailable");
    const current = await bridge.invoke(getChannel);
    if (!current?.ok) return current;
    const next = { ...(current.data || {}), ...${JSON.stringify(patch)} };
    delete next.defaultCommandShell;
    return bridge.invoke(setChannel, next);
  })()`);
  if (result?.ok !== true) throw new Error(`settingsSet failed: ${JSON.stringify(result)}`);
  return result.data;
}

async function reloadRenderer(cdp) {
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitFor(async () => {
    try {
      return await cdp.evaluate(`document.readyState === "complete" && Boolean(window.piDesktop?.channels?.invoke?.sessionCreate && document.querySelector(".composer-input"))`);
    } catch {
      // The execution context is replaced while the page reloads.
      return false;
    }
  }, "renderer reload", 60_000, 500);
}

// The renderer automation surface (installed on every mount by
// useAppShellRuntime) selects the session directly, so a session in a project
// the sidebar has not revealed still opens.
async function selectSession(cdp, sessionId) {
  await waitFor(() => cdp.evaluate(`typeof window.__PI_DESKTOP__?.selectSession === "function"`), "renderer automation API");
  await cdp.evaluate(`window.__PI_DESKTOP__.selectSession(${JSON.stringify(sessionId)})`);
  await waitFor(() => cdp.evaluate(`Boolean(document.querySelector(".composer-input"))`), `composer for session ${sessionId}`, 30_000, 300);
}

async function typeAndSend(cdp, text) {
  // insertText needs a caret inside the contenteditable; focus alone is not enough.
  const focused = await step(cdp, "typeAndSend.focus", () => cdp.evaluate(`(() => {
    const editor = document.querySelector(".composer-input");
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`));
  if (!focused) throw new Error("composer editor missing");
  await step(cdp, "typeAndSend.insertText", () => cdp.send("Input.insertText", { text }));
  // Two frames normally finish within milliseconds. A hidden or minimized window
  // paints no frames, so the timer may end the wait, but only for a hidden window.
  // A visible window that misses its frames is a stall and fails with the step name.
  // The Send-enabled wait below still has to pass before the click.
  await step(cdp, "typeAndSend.frameWait", async () => {
    const frameWait = await cdp.evaluate(`new Promise((resolve) => {
      const started = performance.now();
      const state = () => ({ visibility: document.visibilityState, hasFocus: document.hasFocus(), ms: Math.round(performance.now() - started) });
      const timer = setTimeout(() => resolve({ won: "timer", ...state() }), ${FRAME_WAIT_FALLBACK_MS});
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve({ won: "frames", ...state() });
      }));
    })`);
    if (frameWait.won === "timer" && frameWait.visibility === "visible") {
      throw new Error(`two frames did not paint within ${FRAME_WAIT_FALLBACK_MS} ms in a visible window (${text.split(" ")[0]})`);
    }
    if (frameWait.won === "timer") {
      console.log(`INFO ${text.split(" ")[0]} frame wait fell back to the ${FRAME_WAIT_FALLBACK_MS} ms timer after ${frameWait.ms} ms (visibility ${frameWait.visibility})`);
    }
  });
  try {
    await step(cdp, "typeAndSend.waitSendEnabled", () => waitFor(() => cdp.evaluate(`Boolean(document.querySelector(".composer-shell .send-btn:not(:disabled)"))`), "composer Send enabled", 15_000));
  } catch (error) {
    const composer = await cdp.evaluate(`(() => {
      const editor = document.querySelector(".composer-input");
      const send = document.querySelector(".composer-shell .send-btn");
      const model = document.querySelector(".composer-model-thinking button");
      return {
        editorTag: editor?.tagName ?? null,
        contenteditable: editor?.getAttribute("contenteditable") ?? null,
        ariaReadonly: editor?.getAttribute("aria-readonly") ?? null,
        editorText: (editor?.textContent ?? "").slice(0, 200),
        sendFound: Boolean(send),
        sendDisabled: send ? send.disabled : null,
        sendLabel: send?.getAttribute("aria-label") ?? send?.textContent?.trim() ?? null,
        modelDisabled: model ? model.disabled : null,
        bodyTail: (document.body?.innerText ?? "").slice(-400),
      };
    })()`);
    throw new Error(`${error.message}: ${JSON.stringify(composer)}`);
  }
  await cdp.evaluate(`document.querySelector(".composer-shell .send-btn:not(:disabled)")?.click()`);
}

const runningBash = (cdp) => cdp.evaluate(`document.querySelector(".tool-row.status-running") !== null`);

async function markerProcesses() {
  // -A -ww is accepted by both macOS ps and the procps ps on the Linux nightly runner.
  const { stdout } = await execFileAsync("ps", ["-A", "-ww", "-o", "pid=,ppid=,pgid=,command="]);
  return stdout
    .split("\n")
    .filter((line) => line.includes(`297.${marker}`))
    .map((line) => line.trim());
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startElectron({ cdpPort, dataDir, profileDir }, output) {
  const env = {
    ...process.env,
    PI_DESKTOP_DATA_DIR: dataDir,
    PI_DESKTOP_HOST_BIN: hostBinary,
    PI_DESKTOP_START_MAXIMIZED: "0",
    ELECTRON_RENDERER_URL: "",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "."], {
    cwd: appDir,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      output.push(String(chunk));
      if (output.length > 200) output.splice(0, output.length - 200);
    });
  }
  return child;
}

async function waitForRenderer(cdpPort) {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    return findDesktopRendererTarget(await response.json(), appDir) ?? null;
  }, "renderer target", 60_000, 500);
}

async function run() {
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-send-now-abort-"));
  const dataDir = join(tempRoot, "data");
  const profileDir = join(tempRoot, "electron-profile");
  const workspace = join(tempRoot, "workspace");
  await mkdir(dataDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const modelLog = { requests: [], bashCalls: 0, queuedSeen: false, queuedHistory: undefined, errors: [] };
  const modelServer = createHttpServer(createModelFixture(modelLog));
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const modelUrl = `http://127.0.0.1:${modelServer.address().port}/v1`;
  const cdpPort = await freePort();
  const output = [];
  const child = startElectron({ cdpPort, dataDir, profileDir }, output);
  const rendererErrors = [];
  let cdp = null;
  let failed = false;
  try {
    const target = await waitForRenderer(cdpPort);
    cdp = connectCdp(target.webSocketDebuggerUrl, (message) => {
      if (message.method === "Runtime.exceptionThrown") {
        rendererErrors.push(message.params?.exceptionDetails?.text ?? "exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        rendererErrors.push("console.error");
      }
    });
    await cdp.opened;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");
    await waitFor(() => cdp.evaluate(`Boolean(window.piDesktop?.channels?.invoke?.sessionCreate && document.querySelector(".composer-input"))`), "app ready", 60_000, 500);
    check("renderer booted against the isolated profile", true, `profile=${profileDir}`);

    const { provider } = await invoke(cdp, "providersCreate", [{
      name: "Send-now abort fixture",
      vendorKey: "custom",
      type: "openai_compatible",
      protocol: "openai_compatible",
      baseUrl: modelUrl,
      authKind: "none",
      defaultModelId: "fixture",
      apiStyle: "chat_completions",
      models: [{ id: "fixture" }],
    }]);
    // Without a default provider and model the renderer shows first-run setup and
    // no Send control; the team E2E sets the same defaults through settings.
    await updateSettings(cdp, {
      language: "en",
      defaultProviderId: provider.id,
      defaultModelId: "fixture",
      defaultMode: "agent",
      defaultPermissionMode: "auto",
    });
    const created = await step(cdp, "sessionCreate", () => invoke(cdp, "sessionCreate", [{
      title: "Send now abort E2E",
      mode: "agent",
      projectPath: workspace,
      providerId: provider.id,
      modelId: "fixture",
      // "auto" lets the Bash call run without a permission card; the card path is not under test here.
      permissionMode: "auto",
    }]));
    const sessionId = created?.session?.id;
    if (!sessionId) throw new Error(`sessionCreate returned no session: ${JSON.stringify(created)}`);
    await step(cdp, "sessionConfigure", () => invoke(cdp, "sessionConfigure", [sessionId, {
      mode: "agent",
      providerId: provider.id,
      modelId: "fixture",
      thinkingLevel: "off",
    }]));
    // The renderer reads settings and providers at mount, so reload after seeding (as plan-ui does).
    await step(cdp, "reloadRenderer", () => reloadRenderer(cdp));
    await step(cdp, "selectSession", () => selectSession(cdp, sessionId));

    await typeAndSend(cdp, `${SLOW_MARK} run a command that does not return on its own.`);
    // The row label is the display name, not the tool id, so the class is the signal; the only tool in this run is Bash.
    const gate = await waitFor(() => cdp.evaluate(`(() => {
      if (document.querySelector(".permission-card-actions button")) return "approval";
      if (document.querySelector(".tool-row.status-running")) return "running";
      return null;
    })()`), "Bash approval card or running Bash row", 60_000, 250).catch(async (error) => {
      const rows = await cdp.evaluate(`[...document.querySelectorAll(".tool-row")].map((node) => ({
        className: node.className,
        label: node.getAttribute("aria-label"),
        text: (node.textContent || "").slice(0, 80),
      }))`);
      throw new Error(`${error.message}; tool rows: ${JSON.stringify(rows)}; fixture: ${JSON.stringify(modelLog)}`);
    });
    if (gate === "approval") {
      const label = await cdp.evaluate(`(() => {
        const buttons = [...document.querySelectorAll(".permission-card-actions button")];
        const last = buttons.at(-1);
        last?.click();
        return last?.textContent?.trim() ?? "";
      })()`);
      console.log(`INFO approved the Bash call once through the permission card (button "${label}")`);
    }
    await waitFor(() => runningBash(cdp), "running Bash row", 60_000);
    await waitFor(async () => (await markerProcesses()).length > 0, "command process to start", 30_000);
    check("Bash call is running behind the stuck command", true, gate === "approval" ? "approved through the card" : "auto-approved");

    await typeAndSend(cdp, `${QUEUED_MARK} after the stuck command.`);
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-testid="queued-prompt"]').length === 1`), "one waiting queued row");
    // Send now is disabled while the row is pending (its id has the pending:
    // prefix). Check and click in one evaluate, retrying until it is enabled.
    // sentAt is set when each attempt starts, so the attempt that clicks leaves
    // it at or before the click and the offer timings below start there.
    let sentAt = 0;
    const sent = await waitFor(() => {
      sentAt = Date.now();
      return cdp.evaluate(`(() => {
        const button = document.querySelector(".composer-queued-prompt-send-now:not(:disabled)");
        if (!button) return false;
        button.click();
        return true;
      })()`);
    }, "queued prompt accepted by the host (Send now enabled)");
    check("Send now promoted the queued row", sent === true);
    await waitFor(() => cdp.evaluate(`Boolean(document.querySelector(".composer-queued-prompt-send-now:disabled"))`), "promoted queued row");

    const offerPresent = () => cdp.evaluate(`Boolean(document.querySelector(".composer-queued-prompt-abort-tool"))`);
    for (const at of HIDDEN_CHECKS_MS) {
      await sleepUntil(sentAt + at);
      const present = await offerPresent();
      check(`abort offer hidden ${Math.round(at / 1000)} s after Send now`, present === false, `checked at ${Date.now() - sentAt} ms`);
    }
    await waitFor(offerPresent, "abort offer", sentAt + VISIBLE_BY_MS - Date.now());
    const shownAt = Date.now();
    const offerCount = await cdp.evaluate(`document.querySelectorAll(".composer-queued-prompt-abort-tool").length`);
    check(
      "abort offer appears once the 30 s delay has passed",
      offerCount === 1 && shownAt - sentAt >= ABORT_OFFER_DELAY_MS,
      `shown ${shownAt - sentAt} ms after Send now, ${offerCount} offer(s)`,
    );

    const clickedAt = Date.now();
    const clicked = await cdp.evaluate(`(() => {
      const button = document.querySelector(".composer-queued-prompt-abort-tool");
      if (!button) return false;
      button.click();
      return true;
    })()`);
    check("abort offer clicked", clicked === true);
    await waitFor(async () => !(await runningBash(cdp)), "Bash row to leave running", 20_000);
    const rowStoppedMs = Date.now() - clickedAt;
    // A failing ps probe must fail the run here, not leave an empty list that passes.
    const exitDeadline = Date.now() + 20_000;
    let remaining = await markerProcesses();
    while (remaining.length && Date.now() < exitDeadline) {
      await sleep(250);
      remaining = await markerProcesses();
    }
    check(
      "no process from the stuck command remains",
      remaining.length === 0,
      remaining.length ? remaining.join(" | ") : `row stopped ${rowStoppedMs} ms after click`,
    );

    await waitFor(() => cdp.evaluate(`(() => {
      const texts = [...document.querySelectorAll(".message-row")].map((node) => node.textContent || "");
      return texts.some((text) => text.includes(${JSON.stringify(QUEUED_MARK)})) &&
        texts.some((text) => text.includes(${JSON.stringify(QUEUED_REPLY)}));
    })()`), "queued prompt to start and be answered", 60_000);
    const answeredMs = Date.now() - clickedAt;
    const leftover = await cdp.evaluate(`({
      queued: document.querySelectorAll('[data-testid="queued-prompt"]').length,
      offer: document.querySelectorAll(".composer-queued-prompt-abort-tool").length,
    })`);
    check(
      "queued prompt started after the abort and the queue is empty",
      leftover.queued === 0 && leftover.offer === 0 && modelLog.queuedSeen,
      `answered ${answeredMs} ms after click`,
    );
    check("the model fixture received no request errors", modelLog.errors.length === 0, modelLog.errors[0]?.split("\n")[0] ?? "");
    // Only the slow prompt and the queued prompt may reach the model: a request
    // ending in a tool result would mean a model turn ran after the kill.
    check(
      "the model got no turn after the kill",
      JSON.stringify(modelLog.requests) === JSON.stringify(["user", "user"]),
      `requests end ${modelLog.requests.join(" > ")}`,
    );
    const history = modelLog.queuedHistory;
    check(
      "the queued request carries the aborted Bash call",
      JSON.stringify(history?.calls) === JSON.stringify(["bash-call-1"]),
      `roles ${history?.roles.join(" > ") ?? "none"}`,
    );
    const abortResult = history?.results.length === 1 ? history.results[0] : undefined;
    check(
      "the aborted Bash call has a real abort result",
      abortResult?.toolCallId === "bash-call-1" && abortEvidence.test(abortResult.head),
      `result ${JSON.stringify(abortResult?.head ?? "none")}`,
    );
    console.log(`INFO renderer errors observed: ${rendererErrors.length}`);
    console.log("PASS E2E-QUEUE-send-now-abort-offer-after-30s");
    return 0;
  } catch (error) {
    failed = true;
    console.error(`FAIL ${error?.message ?? error}`);
    console.error(`model fixture: ${JSON.stringify(modelLog)}`);
    console.error(output.join("").slice(-2000));
    return 1;
  } finally {
    cdp?.close();
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve));
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    await Promise.race([exited, sleep(5_000)]);
    if (failed) {
      for (const line of await markerProcesses().catch(() => [])) {
        const pid = Number(line.split(/\s+/)[0]);
        if (pid > 1) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
    }
    await new Promise((resolve) => modelServer.close(resolve));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

process.exit(await run());
