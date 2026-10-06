#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveElectronBinary } from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

if (process.platform === "win32") {
  throw new Error("Team UI E2E requires macOS/Linux HOME isolation and controlled Host signals; no Windows profile was accessed.");
}

const tempRoot = await mkdtemp(join(tmpdir(), "pi-desktop-team-e2e-"));
const dataDir = join(tempRoot, "data");
const projectPath = join(tempRoot, "workspace");
await mkdir(projectPath, { recursive: true });
const fixtureHome = join(tempRoot, "home");
await mkdir(fixtureHome, { recursive: true });
const originalHome = process.env.HOME;
process.env.HOME = fixtureHome;

const calls = [];
const titleRequests = [];
const titleDiagnostics = [];
const modelGates = {
  member: { entered: false, release: null },
  queue: { entered: false, release: null },
  taskUpdate: { entered: false, release: null },
};
let boardTaskId;
let member;
let fixtureError;
let lastSendCdp;
let memberGateUsed = false;

async function holdModelRequest(name) {
  const gate = modelGates[name];
  gate.entered = true;
  await new Promise((resolveGate) => { gate.release = resolveGate; });
  gate.entered = false;
  gate.release = null;
}

function releaseModelRequest(name) {
  modelGates[name].release?.();
}
const providerServer = createServer(async (req, res) => {
  try {
    let bodyText = "";
    for await (const part of req) bodyText += part;
    if (req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "team-fixture", object: "model" }] }));
      return;
    }

    const request = JSON.parse(bodyText);
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const lastUserIndex = lastUser ? messages.lastIndexOf(lastUser) : -1;
    const activeTurnMessages = messages.slice(lastUserIndex + 1);
    const userText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((part) => part.text ?? "").join("\n")
        : "";
    const priorToolNames = activeTurnMessages
      .filter((message) => message.role === "assistant" && Array.isArray(message.tool_calls))
      .flatMap((message) => message.tool_calls.map((call) => call.function?.name));
    const activeToolText = activeTurnMessages
      .filter((message) => message.role === "tool")
      .map((message) => String(message.content ?? ""))
      .join("\n");
    const toolNames = (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
    const titleSystemPrompt = messages.find((message) => message.role === "system")?.content;
    const isTitleRequest = typeof titleSystemPrompt === "string" &&
      titleSystemPrompt.includes("descriptive session title summarizing the conversation");
    let toolCall;
    let finalText;
    let kind = "agent";

    if (isTitleRequest) {
      kind = "title";
      finalText = userText.includes("Approved task title: Approved Team Assignment")
        ? "Team Plan Execution"
        : userText.includes("Create an approved Team execution plan")
          ? "Approved Team Assignment"
          : "Expert Team Delegation";
    } else if (userText.includes("Standard coexistence probe")) {
      assert.ok(toolNames.includes("Task"), "standard session lost its Task tool");
      assert.equal(toolNames.includes("declare_team_strategy"), false, "standard session exposed Team dispatch");
      if (!priorToolNames.includes("Task")) {
        toolCall = { name: "Task", args: { agent: "explorer", task: "Return STANDARD_CHILD_RESULT as your final response." } };
      } else { finalText = "STANDARD_PARENT_RESULT"; }
    } else if (userText.includes("STANDARD_CHILD_RESULT")) {
      assert.equal(toolNames.includes("declare_team_strategy"), false, "ordinary delegate became a Team member");
      finalText = "STANDARD_CHILD_RESULT";
    } else if (userText.includes("Create an approved Team execution plan")) {
      assert.ok(toolNames.includes("SubmitPlan"), "Plan runtime lacks SubmitPlan");
      toolCall = { name: "SubmitPlan", args: {
        title: "Approved Team Assignment",
        question: "Run this approved Team plan?",
        markdown: "# Approved Team Assignment\n\n1. Coordinate the approved Team execution.\n2. Record the result for the Lead.\n",
      }};
    } else if (userText.includes("Approved plan title: Approved Team Assignment")) {
      if (!priorToolNames.includes("declare_team_strategy")) {
        assert.ok(toolNames.includes("declare_team_strategy"), "approved Team execution lacks strategy declaration");
        toolCall = { name: "declare_team_strategy", args: {
          strategy: "lead_only", reason: "The approved Plan can be executed by the Lead."
        }};
      } else {
        finalText = "Approved Team plan execution finished.";
      }
    } else if (userText.includes("Please spawn one teammate")) {
      if (!priorToolNames.includes("declare_team_strategy")) {
        assert.ok(toolNames.includes("declare_team_strategy"), "Lead runtime lacks strategy declaration");
        toolCall = {
          name: "declare_team_strategy",
          args: {
            strategy: "delegate", reason: "A researcher can verify the result.",
            members: [
              {name: "researcher", description: "Reports a fixed result to the Lead.", contextKind: "fresh", presentation: {role: "researcher", displayName: "Alex"}},
              ...["executor", "reviewer", "planner", "collaborator"].map((role, index) => ({
                name: role, description: `Idle ${role} for the Team UI fixture.`, contextKind: "fresh",
                presentation: { role, displayName: ["Sam", "Tina", "Noah", "Maya"][index] },
              })),
            ],
          },
        };
      } else {
        finalText = "The proposed teammate is waiting for launch approval.";
      }
    } else if (userText.includes("Team review") && userText.includes("confirmed")) {
      const createdTasks = priorToolNames.filter((name) => name === "task_create").length;
      if (createdTasks < 6) {
        assert.ok(toolNames.includes("task_create"), "Lead runtime lacks task_create");
        toolCall = { name: "task_create", args: {
          subject: `E2E board fixture task ${createdTasks + 1} ${"long-task-".repeat(16)}`,
          description: `Detail for E2E board fixture task ${createdTasks + 1}. https://example.invalid/${"longsegment".repeat(80)}`,
          ownerMemberName: "researcher",
          writeScopes: [`${"long-directory-".repeat(50)}/output-${createdTasks + 1}.ts`],
        }};
      } else if (!priorToolNames.includes("send_message")) {
        toolCall = { name: "send_message", args: {
          targetMemberName: "researcher", content: "Send the exact message TEAM_RESULT to Lead using send_message."
        }};
      } else { finalText = "Approved work dispatched."; }
    } else if (userText.includes("Handle this without specialists")) {
      if (!priorToolNames.includes("declare_team_strategy") || !activeToolText.includes("lead_only")) {
        toolCall = { name: "declare_team_strategy", args: { strategy: "lead_only", reason: "This short task needs no specialist." }};
      } else { finalText = "Handled by Lead only."; }
    } else if (userText.includes("Send the exact message TEAM_RESULT")) {
      if (!priorToolNames.includes("send_message")) {
        assert.ok(toolNames.includes("send_message"), "member runtime lacks send_message");
        if (!memberGateUsed) {
          memberGateUsed = true;
          await holdModelRequest("member");
        }
        toolCall = {
          name: "send_message",
          args: { targetMemberName: "Lead", content: "TEAM_RESULT" },
        };
      } else {
        finalText = "TEAM_RESULT was sent to Lead.";
      }
    } else if (userText.includes("Mark the board fixture task completed")) {
      if (!priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          strategy: "lead_only", reason: "Updating one board item is a Lead-only operation."
        }};
      } else if (!priorToolNames.includes("task_update")) {
        assert.ok(toolNames.includes("task_update"), "Lead runtime lacks task_update");
        assert.ok(boardTaskId, "E2E board task id was not initialized");
        toolCall = { name: "task_update", args: {
          taskId: boardTaskId, expectedRevision: 1, status: "completed",
        }};
      } else {
        await holdModelRequest("taskUpdate");
        finalText = "The E2E board fixture task is complete.";
      }
    } else if (userText.includes("Hold the Lead while the queue is inspected")) {
      if (!priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          strategy: "lead_only", reason: "The Lead can hold this short queue inspection."
        }};
      } else {
        await holdModelRequest("queue");
        finalText = "The Lead queue inspection turn is complete.";
      }
    } else if (userText.includes("Queue fixture prompt")) {
      if (!priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          strategy: "lead_only", reason: "This queued fixture prompt needs no specialist."
        }};
      } else {
        finalText = "Queued fixture prompt processed.";
      }
    } else if (userText.includes("Queue a message while the Team is paused")) {
      if (!priorToolNames.includes("send_message")) {
        assert.ok(toolNames.includes("send_message"), "Lead runtime lacks send_message while paused");
        toolCall = {
          name: "send_message",
          args: { targetMemberName: "researcher", content: "DELIVER_AFTER_RESUME" },
        };
      } else {
        finalText = "The message is queued while the Team is paused.";
      }
    } else if (userText.includes("DELIVER_AFTER_RESUME")) {
      finalText = "The queued instruction was delivered after Resume.";
    } else if (userText.includes("TEAM_RESULT")) {
      finalText = "Lead received TEAM_RESULT.";
    } else {
      throw new Error(`Unexpected fake-model prompt: ${userText.slice(0, 240)}`);
    }
    const call = { kind, userText, tool: toolCall?.name ?? null, model: request.model };
    calls.push(call);
    if (kind === "title") titleRequests.push(call);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const base = { id: `team-fixture-${calls.length}`, object: "chat.completion.chunk", created: 1, model: request.model };
    const emit = (delta, finishReason = null) => {
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    };
    if (toolCall) {
      emit({
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: `team-tool-${calls.length}`,
          type: "function",
          function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) },
        }],
      });
      emit({}, "tool_calls");
    } else {
      emit({ role: "assistant", content: finalText });
      emit({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  } catch (error) {
    fixtureError = error;
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(error) } }));
  }
});
await new Promise((resolveListen) => providerServer.listen(0, "127.0.0.1", resolveListen));

const host = new Host(resolveHostBinary(), dataDir);
let appProcess;
let socket;
let screenshotPath;
let appOutput = "";

async function waitFor(check, label, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    if (fixtureError) throw fixtureError;
    if (appProcess?.exitCode !== null && appProcess?.exitCode !== undefined) {
      throw new Error(`Electron exited (${appProcess.exitCode}) while waiting for ${label}`);
    }
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function waitForAppExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer);
      resolveExit(exited);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", () => finish(true));
  });
}

async function stopApp() {
  const child = appProcess;
  if (!child || child.exitCode !== null) {
    appProcess = null;
    return;
  }
  const signalTree = async (signal) => {
    if (process.platform === "win32") {
      await new Promise((resolveKill) => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("exit", resolveKill);
        killer.once("error", resolveKill);
        setTimeout(resolveKill, 5_000);
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch {}
    }
  };
  await signalTree("SIGTERM");
  const exited = await waitForAppExit(child, 5_000);
  if (!exited || process.platform !== "win32") await signalTree("SIGKILL");
  await waitForAppExit(child, 5_000);
  appProcess = null;
}

async function startApp() {
  const debugProbe = createTcpServer();
  await new Promise((resolveListen) => debugProbe.listen(0, "127.0.0.1", resolveListen));
  const debugPort = debugProbe.address().port;
  await new Promise((resolveClose) => debugProbe.close(resolveClose));
  const { appDir, electronBinary } = resolveElectronBinary();
  const env = {
    ...process.env,
    PI_DESKTOP_DATA_DIR: dataDir,
    PI_DESKTOP_HOST_BIN: resolveHostBinary(),
    ELECTRON_RENDERER_URL: "",
    PI_DESKTOP_START_MAXIMIZED: "0",
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of ["PI_DESKTOP_TEST_API_KEY", "PI_DESKTOP_TEST_BASE_URL", "PI_DESKTOP_TEST_MODEL"]) delete env[key];
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key];
  appProcess = spawn(electronBinary, [
    `--remote-debugging-port=${debugPort}`,
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--user-data-dir=${join(tempRoot, "profile")}`,
    ".",
  ], {
    cwd: appDir,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  appProcess.stdout.on("data", (data) => { appOutput += String(data); });
  appProcess.stderr.on("data", (data) => { appOutput += String(data); });
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await response.json();
    return targets.find((target) => target.type === "page" && target.url.includes("index.html") && !target.url.includes("plugin-launcher"));
  }, "desktop renderer");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.consoleAPICalled" &&
      message.params.args?.[0]?.value === "UI crash") {
      fixtureError = new Error(`Renderer crash: ${message.params.args[1]?.description ?? 'unknown error'}`);
    }
    if (message.method === "Runtime.consoleAPICalled" &&
      message.params.args?.[0]?.value === "[session-title]") {
      titleDiagnostics.push(message.params.args.map((arg) => arg.value ?? arg.preview));
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const sendCdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await sendCdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const invoke = (name, ...args) => evaluate(`(async () => {
    const result = await window.piDesktop.invoke(window.piDesktop.channels.invoke[${JSON.stringify(name)}], ...${JSON.stringify(args)});
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.data;
  })()`);
  await sendCdp("Runtime.enable");
  lastSendCdp = sendCdp;
  return { sendCdp, evaluate, invoke };
}

async function openTeamPanel(sendCdp, evaluate) {
  if (await evaluate(`!!document.querySelector('[data-testid="team-panel"]')`)) return;
  const existingTeamTab = await evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll('[data-work-panel-tab-id]'))
      .find((node) => node.getAttribute('data-work-panel-tab-id')?.startsWith('team:'));
    if (!tab) return false;
    tab.querySelector('.work-panel-tab-button')?.click();
    return true;
  })()`);
  if (existingTeamTab) {
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"],.team-back-btn,[data-panorama-canvas]')`), "existing Team surface");
    if (!await evaluate(`!!document.querySelector('[data-testid="team-panel"]')`)) {
      await evaluate(`(document.querySelector('.team-back-btn') ?? document.querySelector('.agent-panorama-toolbar button'))?.click()`);
    }
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"]')`), "existing Team panel tab");
    return;
  }
  if (!await evaluate(`!!document.querySelector('[data-testid="work-panel"]:not([data-exiting="true"]) .work-panel-new-tab')`)) {
    await evaluate(`document.querySelector('.app-work-panel-toggle')?.click()`);
  }
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="work-panel"] .work-panel-new-tab')`), "Work Panel open");
  await evaluate(`document.querySelector('.work-panel-new-tab').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-work-panel-launcher-item="team"]')`), "Team launcher item");
  await evaluate(`document.querySelector('[data-work-panel-launcher-item="team"]').click()`);
}

async function activateOverviewTab(sendCdp, evaluate) {
  await waitFor(() => evaluate(`!!document.querySelector('[data-work-panel-tab-id="overview"] .work-panel-tab-button')`), "Overview tab");
  await evaluate(`document.querySelector('[data-work-panel-tab-id="overview"] .work-panel-tab-button').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="overview-tab"]')`), "Overview surface");
}

async function submitComposerPrompt(sendCdp, evaluate, prompt) {
  const promptLiteral = JSON.stringify(prompt);
  await waitFor(() => evaluate(`!!document.querySelector('.composer-input[contenteditable="true"]')`), "editable composer");
  await evaluate(`(() => {
    const editor = document.querySelector('.composer-input[contenteditable="true"]');
    editor.focus();
    editor.textContent = ${promptLiteral};
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: ${promptLiteral}
    }));
    return true;
  })()`);
  await waitFor(() => evaluate(`!!document.querySelector('.send-btn:not(:disabled)')`), "composer Send enabled");
  await evaluate(`document.querySelector('.send-btn')?.click()`);
}

async function panoramaViewport(sendCdp, evaluate) {
  return waitFor(() => evaluate(`(() => {
    const canvas = document.querySelector('[data-panorama-canvas]');
    if (!canvas) return null;
    return {
      zoom: Number(canvas.getAttribute('data-panorama-zoom')),
      x: Number(canvas.getAttribute('data-panorama-pan-x')),
      y: Number(canvas.getAttribute('data-panorama-pan-y')),
    };
  })()`), "panorama viewport");
}

async function dragPanorama(sendCdp, evaluate) {
  const point = await evaluate(`(() => {
    const canvas = document.querySelector('[data-panorama-canvas]');
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const candidates = [
      [bounds.left + 12, bounds.bottom - 12],
      [bounds.left + 12, bounds.top + 90],
      [bounds.right - 12, bounds.bottom - 12],
      [bounds.right - 12, bounds.top + 100],
    ];
    return candidates.find(([x, y]) => {
      const target = document.elementFromPoint(x, y);
      return target && !target.closest('[data-panorama-node], [data-panorama-tool]');
    })?.map(Math.round) ?? null;
  })()`);
  assert.ok(point, "panorama has no draggable background point");
  const [x, y] = point;
  await sendCdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 36, y: y + 24, button: "left", buttons: 1 });
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 36, y: y + 24, button: "left", clickCount: 1 });
}

async function assertNoPageHorizontalOverflow(sendCdp, evaluate) {
  const sidebarWasOpen = await evaluate(`!!document.querySelector('.sidebar')`);
  const before = await evaluate(`({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})`);
  assert.equal(before.scrollWidth, before.width, `page overflows horizontally at ${before.width}px: ${before.scrollWidth}px`);
  await sendCdp("Emulation.setDeviceMetricsOverride", {
    width: 1024, height: 860, deviceScaleFactor: 1, mobile: false,
  });
  try {
    await waitFor(() => evaluate(`window.innerWidth === 1024`), "1024px renderer viewport");
    await evaluate(`document.documentElement.style.setProperty('--font-scale', '1.5')`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const narrow = await evaluate(`({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth})`);
    assert.equal(narrow.scrollWidth, narrow.width, `page overflows horizontally at ${narrow.width}px: ${narrow.scrollWidth}px`);
    const controlsFit = await evaluate(`Array.from(document.querySelectorAll('.team-board-filters button,.team-board-filters input,.composer-queue-heading,.send-btn')).every(control => {
      const r=control.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.width > 0;
    })`);
    assert.equal(controlsFit, true, "board/queue/Send controls overflow at 1024px and 150% font scale");
    await saveScreenshot(sendCdp, "team-narrow-150-percent.png");
  } finally {
    await evaluate(`document.documentElement.style.removeProperty('--font-scale')`);
    await sendCdp("Emulation.clearDeviceMetricsOverride");
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    if (sidebarWasOpen && await evaluate(`document.querySelector('.ct-lead')?.getAttribute('aria-hidden') === 'false'`)) {
      await evaluate(`document.querySelector('.ct-lead button')?.click()`);
      await waitFor(() => evaluate(`document.querySelector('.ct-lead')?.getAttribute('aria-hidden') === 'true'`), "sidebar restored after temporary width check");
    }
  }
}

function findAppHostPids() {
  if (process.platform === "win32") throw new Error("controlled Host pause is supported only on macOS/Linux");
  const processes = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8" })
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
    })
    .filter((entry) => entry !== null);
  const descendants = new Set([appProcess.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (descendants.has(entry.ppid) && !descendants.has(entry.pid)) {
        descendants.add(entry.pid);
        changed = true;
      }
    }
  }
  const hostName = basename(resolveHostBinary());
  return processes.filter((entry) => descendants.has(entry.ppid) && basename(entry.command) === hostName).map((entry) => entry.pid);
}

async function refreshWhileDragging(sendCdp, evaluate) {
  const point = await evaluate([
    "(() => {",
    "const canvas = document.querySelector('[data-panorama-canvas]');",
    "if (!canvas) return null;",
    "const bounds = canvas.getBoundingClientRect();",
    "const candidates = [[bounds.left + 12, bounds.bottom - 12], [bounds.left + 12, bounds.top + 90], [bounds.right - 12, bounds.bottom - 12]];",
    "return candidates.find(([x, y]) => { const target = document.elementFromPoint(x, y); return target && !target.closest('[data-panorama-node], [data-panorama-tool]'); })?.map(Math.round) ?? null;",
    "})()",
  ].join("\n"));
  assert.ok(point, "panorama has no draggable background point");
  const [x, y] = point;
  const before = await panoramaViewport(sendCdp, evaluate);
  await evaluate("window.__teamCanvasBeforeRefresh = document.querySelector('[data-panorama-canvas]'); true");
  await sendCdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 22, y: y + 14, button: "left", buttons: 1 });
  const hostPids = findAppHostPids();
  assert.ok(hostPids.length > 0, "isolated Electron Host process was not found");
  const stoppedHostPids = [];
  try {
    for (const hostPid of hostPids) {
      process.kill(hostPid, "SIGSTOP");
      stoppedHostPids.push(hostPid);
    }
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await evaluate([
      "window.__teamSnapshotProbeSettled = false;",
      "window.__teamSnapshotProbe = window.piDesktop.invoke(window.piDesktop.channels.invoke.teamGetSnapshot, { teamSessionId: " + JSON.stringify(await evaluate("document.querySelector('[data-sidebar-session-row].active')?.getAttribute('data-sidebar-session-row')")) + " })",
      ".then(() => { window.__teamSnapshotProbeSettled = true; }, () => { window.__teamSnapshotProbeSettled = true; });",
      "true;",
    ].join("\n"));
    await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const during = await evaluate([
      "(() => {",
      "const canvas = document.querySelector('[data-panorama-canvas]');",
      "return { connected: !!canvas && canvas.isConnected, sameCanvas: canvas === window.__teamCanvasBeforeRefresh, settled: window.__teamSnapshotProbeSettled };",
      "})()",
    ].join("\n"));
    assert.equal(during.settled, false, "Host snapshot request did not remain in flight while Host was paused");
    assert.equal(during.connected, true, "in-flight refresh unmounted the panorama canvas");
    assert.equal(during.sameCanvas, true, "in-flight refresh replaced the panorama canvas");
    await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 42, y: y + 28, button: "left", buttons: 1 });
    await saveScreenshot(sendCdp, "team-panorama-refresh-in-flight.png");
  } finally {
    for (const hostPid of stoppedHostPids) {
      try { process.kill(hostPid, "SIGCONT"); } catch {}
    }
  }
  await waitFor(() => evaluate("window.__teamSnapshotProbeSettled === true"), "resumed Host snapshot read");
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 54, y: y + 34, button: "left", buttons: 1 });
  const after = await panoramaViewport(sendCdp, evaluate);
  const sameCanvas = await evaluate("document.querySelector('[data-panorama-canvas]') === window.__teamCanvasBeforeRefresh");
  assert.equal(sameCanvas, true, "snapshot completion replaced the panorama canvas during drag");
  assert.equal(after.zoom, before.zoom, "snapshot refresh reset manual panorama zoom");
  assert.ok(Math.abs(after.x - before.x) > 0.01 || Math.abs(after.y - before.y) > 0.01, "drag did not continue after the snapshot refresh");
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 54, y: y + 34, button: "left", clickCount: 1 });
  return after;
}

async function saveScreenshot(sendCdp, name) {
  const screenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  const path = join(tempRoot, name);
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
  return path;
}

async function verifyStalePanoramaRetry(sendCdp, evaluate) {
  // Only this harness's temporary database is changed, and always restored.
  const fixtureDatabase = join(dataDir, "pi.sqlite");
  execFileSync("sqlite3", [fixtureDatabase, "PRAGMA busy_timeout=5000; ALTER TABLE team_tasks RENAME TO team_tasks_fixture_failure;"]);
  try {
    await evaluate(`window.dispatchEvent(new Event('focus'))`);
    await waitFor(() => evaluate(`!!document.querySelector('.agent-panorama-refresh-error button')`), "last-good panorama remains visible with a failed-read banner");
    assert.ok(await evaluate(`!!document.querySelector('[data-panorama-canvas]')`));
    await saveScreenshot(sendCdp, "team-panorama-stale.png");
  } finally {
    execFileSync("sqlite3", [fixtureDatabase, "PRAGMA busy_timeout=5000; ALTER TABLE team_tasks_fixture_failure RENAME TO team_tasks;"]);
  }
  const point = await evaluate(`(() => { const r=document.querySelector('.agent-panorama-refresh-error button').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await sendCdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  assert.equal(await evaluate(`document.querySelector('[data-panorama-canvas]').classList.contains('is-panning')`), false, "Retry must not begin or capture a canvas drag");
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await waitFor(() => evaluate(`!document.querySelector('.agent-panorama-refresh-error')`), "Retry restores the current snapshot");
  console.log("PASS Panorama stale recovery: failed read retains canvas, Retry remains clickable and restores the snapshot");
}

async function resizePanel(sendCdp, evaluate, width) {
  const bounds = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="work-panel"]');
    const handle = panel.querySelector('.work-panel-resize').getBoundingClientRect();
    return { width: panel.getBoundingClientRect().width, x: handle.left + handle.width / 2, y: handle.top + 120 };
  })()`);
  await sendCdp("Input.dispatchMouseEvent", { type: "mousePressed", x: bounds.x, y: bounds.y, button: "left", clickCount: 1 });
  await waitFor(() => evaluate(`document.querySelector('[data-testid="work-panel"]')?.dataset.resizing === 'true'`), "panel resize gesture admitted");
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: bounds.x + bounds.width - width, y: bounds.y, button: "left", buttons: 1 });
  await waitFor(() => evaluate(`Math.abs(document.querySelector('[data-testid="work-panel"]').getBoundingClientRect().width - ${width}) < 2`), `panel drag reached ${width}px`);
  await sendCdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: bounds.x + bounds.width - width, y: bounds.y, button: "left", clickCount: 1 });
  await waitFor(() => evaluate(`Math.abs(document.querySelector('[data-testid="work-panel"]').getBoundingClientRect().width - ${width}) < 2`), `panel resized to ${width}px`);
}

async function verifyTeamLayoutMatrix(sendCdp, evaluate, locale) {
  await sendCdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  try {
    for (const surface of ["overview", "aggregate", "board", "detail"]) {
      await openTeamPanel(sendCdp, evaluate);
      if (surface !== "aggregate") {
        await activateOverviewTab(sendCdp, evaluate);
        await waitFor(() => evaluate(`document.querySelectorAll('.team-progress-row').length > 0`), "live task rows for layout matrix");
        if (surface !== "overview") {
          await evaluate(`Array.from(document.querySelectorAll('.team-progress button')).find(button => /view all|查看全部/i.test(button.innerText))?.click()`);
          await waitFor(() => evaluate(`!!document.querySelector('.team-board-row')`), "board for layout matrix");
          if (surface === "detail") {
            await evaluate(`document.querySelector('.team-board-row')?.click()`);
            await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-detail"]')`), "long task detail for layout matrix");
          }
        }
      }
      for (const width of [320, 450, 620]) {
        await resizePanel(sendCdp, evaluate, width);
        for (const scale of [1, 1.5]) for (const theme of ["dark", "light"]) {
          await evaluate(`document.documentElement.style.setProperty('--font-scale', '${scale}'); document.documentElement.setAttribute('data-theme', '${theme}'); true`);
          await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          const metrics = await evaluate(`(() => {
            const root=document.documentElement;
            const surface=document.querySelector('.team-panel, .work-panel-overview');
            return { page: [root.clientWidth, root.scrollWidth], surface: [surface.clientWidth, surface.scrollWidth] };
          })()`);
          assert.ok(metrics.page[1] <= metrics.page[0] && metrics.surface[1] <= metrics.surface[0], `${locale}/${surface}/${width}/${scale}/${theme} overflows: ${JSON.stringify(metrics)}`);
          if (scale === 1.5 && width === 320) await saveScreenshot(sendCdp, `team-${surface}-${locale}-${theme}-320-150.png`);
        }
      }
    }
  } finally {
    await evaluate(`document.documentElement.style.removeProperty('--font-scale'); document.documentElement.setAttribute('data-theme', 'dark'); true`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await resizePanel(sendCdp, evaluate, 360);
    await sendCdp("Emulation.clearDeviceMetricsOverride");
  }
  console.log(`PASS Team layout matrix ${locale}: Overview/aggregate/board/long detail, 320/450/620px, 100%/150%, dark/light`);
}

try {
  await host.start();
  await host.call("workspace.set", { path: projectPath });
  const { provider } = await host.call("providers.create", {
    name: "Team E2E Fixture",
    vendorKey: "custom",
    type: "openai_compatible",
    protocol: "openai_compatible",
    baseUrl: `http://127.0.0.1:${providerServer.address().port}/v1`,
    authKind: "none",
    defaultModelId: "team-fixture",
    apiStyle: "chat_completions",
    models: [{ id: "team-fixture" }, { id: "team-approved" }],
  });
  await host.call("settings.set", {
    language: "en",
    defaultProviderId: provider.id,
    defaultModelId: "team-fixture",
    defaultMode: "agent",
    defaultPermissionMode: "auto",
  });
  const { session: lead } = await host.call("session.create", {
    title: "New Task",
    mode: "agent",
    executionProfile: "team",
    projectPath,
    providerId: provider.id,
    modelId: "team-fixture",
    permissionMode: "auto",
  });
  const { session: planLead } = await host.call("session.create", {
    title: "New Task",
    mode: "plan",
    executionProfile: "team",
    projectPath,
    providerId: provider.id,
    modelId: "team-fixture",
    permissionMode: "auto",
  });
  const { session: standardSession } = await host.call("session.create", {
    title: "Standard coexistence", mode: "agent", executionProfile: "standard", projectPath,
    providerId: provider.id, modelId: "team-fixture", permissionMode: "auto",
  });
  assert.equal(lead.executionProfile, "team");
  await host.stop();

  let { sendCdp, evaluate, invoke } = await startApp();

  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"]') && !document.querySelector('.startup-splash')`), "Lead in sidebar");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"].active')`), "Lead selected");
  await waitFor(() => evaluate(`!document.querySelector('.composer-contract-chip')`), "Lead Agent mode hydrated");
  await submitComposerPrompt(sendCdp, evaluate, "Please spawn one teammate, let the teammate report back, and then summarize the result.");
  await waitFor(() => titleRequests.length > 0, "fake provider title summary request");
  await waitFor(async () => (await invoke("sessionGet", { id: lead.id })).session?.title === "Expert Team Delegation", "first-turn title applied");
  const titledLead = await invoke("sessionGet", { id: lead.id });
  assert.equal(titledLead.session?.title, "Expert Team Delegation", "automatic first-turn title was not applied");
  console.log("PASS Session title: fake provider recognizes and answers the title-only summary request");

  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${planLead.id}"]')`), "Plan Lead in sidebar");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${planLead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${planLead.id}"].active')`), "Plan Lead selected");
  await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="plan"]')`), "Plan Composer mode hydrated");
  await submitComposerPrompt(sendCdp, evaluate, "Create an approved Team execution plan.");
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"]')`), "Plan approval card before execution");
  await waitFor(() => titleRequests.some((call) => call.userText.includes("Create an approved Team execution plan")), "Plan proposal title summary");
  await waitFor(async () => (await invoke("sessionGet", { id: planLead.id })).session?.title === "Approved Team Assignment", "proposal title applied");
  const proposalTitleSession = await invoke("sessionGet", { id: planLead.id });
  assert.equal(proposalTitleSession.session?.title, "Approved Team Assignment", "proposal title should remain eligible for the approved execution title");
  assert.equal(titleRequests.filter((call) => call.userText.includes("Approved task title: Approved Team Assignment")).length, 0, "approved execution title ran before user approval");
  await evaluate(`document.querySelector('[data-testid="plan-approval-bar"] .plan-approval-approve-main')?.click()`);
  await waitFor(() => titleRequests.filter((call) => call.userText.includes("Approved task title: Approved Team Assignment")).length === 1, "approved Plan execution title summary");
  await waitFor(async () => (await invoke("sessionGet", { id: planLead.id })).session?.title === "Team Plan Execution", "approved execution title applied");
  assert.equal(titleRequests.filter((call) => call.userText.includes("Approved task title: Approved Team Assignment")).length, 1, "approved Plan execution should request one title summary");
  assert.equal(titleRequests.filter((call) => call.userText.includes("Send the exact message TEAM_RESULT")).length, 0, "Team member must not receive its own title request");
  await waitFor(async () => (await invoke("agentGetStatus", planLead.id)).status?.isRunning === false, "approved Plan execution completed");
  console.log("PASS Approved Plan title: approval starts one execution-specific fake title request and updates the Lead");

  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"].active')`), "Team Lead reselected after Plan execution");
  await waitFor(() => evaluate(`!!document.querySelector('[data-session-pane="${lead.id}"][data-visible="true"]')`), "Team Lead transcript restored");

  await waitFor(async () => (await invoke("teamGetLaunchReview", {teamSessionId: lead.id})).review?.status === "pending", "pending launch review");
  const pendingReview = (await invoke("teamGetLaunchReview", {teamSessionId: lead.id})).review;
  assert.equal((await invoke("teamGetRoster", {teamSessionId: lead.id})).members.length, 0);
  assert.equal(calls.filter(call => call.userText.includes("Send the exact message TEAM_RESULT")).length, 0);
  assert.ok(pendingReview.leadTurnId && !pendingReview.leadTurnId.startsWith("turn-"), "review did not bind a real Host turn id");
  await waitFor(async () => { const result = await invoke("agentGetStatus", lead.id); assert.equal(typeof result.status?.isRunning, "boolean"); return result.status.isRunning === false; }, "Lead settled before confirmation");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), "launch review UI");
  assert.equal(await evaluate(`(() => {
    const card = document.querySelector('[data-testid="launch-review-member-researcher"]');
    const bounds = card.getBoundingClientRect();
    return Array.from(card.querySelectorAll('select')).every(select => {
      const rect = select.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    }) && card.scrollWidth <= card.clientWidth;
  })()`), true, "review controls must fit the narrow Team panel");
  const pendingImage = await sendCdp("Page.captureScreenshot", {format: "png"});
  await writeFile(join(tempRoot, "team-launch-review-pending.png"), Buffer.from(pendingImage.data, "base64"));
  await evaluate(`(() => {const selects=document.querySelectorAll('[data-testid="launch-review-member-researcher"] select'); const model=selects[1]; model.value='team-approved'; model.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(async () => {
    const response = await invoke("teamGetLaunchReview", {teamSessionId: lead.id});
    return response.review?.members[0]?.selection.modelId === "team-approved" && response.review.revision > pendingReview.revision;
  }, "edited approval binding");
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('[data-testid="team-launch-review"] button')).some(button => /confirm/i.test(button.innerText) && !button.disabled)`), "review confirmation enabled");
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-launch-review"] button')).find(button => /confirm/i.test(button.innerText))?.click()`);
  await waitFor(async () => (await invoke("teamGetLaunchReview", {teamSessionId: lead.id})).review?.status === "confirmed", "confirmed launch review");
  console.log("PASS Team approval: durable declaration, zero expert calls before approval, edited selection and UI confirmation");

  await waitFor(() => modelGates.member.entered, "member model call while assigned task is active");
  const activeSnapshot = await invoke("teamGetSnapshot", { teamSessionId: lead.id });
  member = activeSnapshot.members.find((item) => item.name === "researcher");
  assert.equal(member?.phase, "running", "Host snapshot did not mark the admitted teammate as running");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"] .team-phase-running')`), "live member running status in Team panel");
  console.log("PASS Team live snapshot: admitted member phase and Team panel status update to running");

    const teamGroupSelector = `[data-sidebar-team-group="${lead.id}"]`;
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(teamGroupSelector)})`), "Team sidebar group");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)})?.getAttribute('data-expanded')`), "false", "Team sidebar group should start collapsed");
  await evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)} + ' [data-action="toggle-team-session"]')?.click()`);
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)})?.getAttribute('data-expanded') === 'true'`), "expanded Team sidebar group");
  assert.equal(await evaluate(`document.querySelectorAll('[data-sidebar-session-row="${member.memberSessionId}"]').length`), 1, "Team member should appear exactly once under its Lead");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)})?.querySelectorAll('.sidebar-team-session-members [data-sidebar-session-row]').length`), 5, "all five member sessions should appear under one Lead");
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)})?.querySelector('.sidebar-team-session-members')?.innerText ?? ''`), /Researcher Alex/);
  assert.equal(await evaluate(`document.querySelector('[data-sidebar-session-row="${member.memberSessionId}"] .thread-item-title')?.innerText`), 'Researcher Alex', "generated member label should show the full role/name instead of repeating its routing title");
  console.log("PASS Sidebar grouping: member expands under Lead with its presentation identity");

  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button'))[0]?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-panorama-canvas]')`), "Team panorama");
  await waitFor(() => evaluate(`document.querySelector('.agent-panorama-root-node .agent-panorama-node-status')?.innerText.includes('Waiting for team members')`), "settled Lead waiting status");
  await evaluate(`Array.from(document.querySelectorAll('[data-panorama-tool] button')).find((button) => /reset/i.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  for (let index = 0; index < 2; index += 1) {
    await evaluate(`Array.from(document.querySelectorAll('[data-panorama-tool] button')).find((button) => /zoom out/i.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  }
  let manualViewport = await panoramaViewport(sendCdp, evaluate);
  assert.equal(manualViewport.zoom, 0.8, "panorama manual zoom should be 80%");
  manualViewport = await refreshWhileDragging(sendCdp, evaluate);
  await evaluate(`document.querySelector('.agent-panorama-node.is-clickable')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-member-detail"]')`), "member detail from panorama");
  await evaluate(`document.querySelector('.team-back-btn')?.click()`);
  assert.deepEqual(await panoramaViewport(sendCdp, evaluate), manualViewport, "manual viewport changed after member detail/back");
  await assertNoPageHorizontalOverflow(sendCdp, evaluate);
  assert.deepEqual(await panoramaViewport(sendCdp, evaluate), manualViewport, "manual viewport changed after resizing");
  console.log("PASS Panorama: 80% zoom, in-flight refresh retains canvas, continuous drag, detail/back and resize preserve viewport");
  await verifyStalePanoramaRetry(sendCdp, evaluate);
  const waitingImage = await saveScreenshot(sendCdp, "team-panorama-waiting-members.png");

  releaseModelRequest("member");

  let roster;
  await waitFor(async () => {
    roster = await invoke("teamGetRoster", { teamSessionId: lead.id });
    member = roster.members.find((item) => item.name === "researcher");
    if (!member) return false;
    const leadResult = await invoke("sessionGet", { id: lead.id });
    const memberResult = await invoke("sessionGet", { id: member.memberSessionId });
    const leadMessages = leadResult.session?.messages ?? [];
    const memberMessages = memberResult.session?.messages ?? [];
    return leadMessages.some((message) => message.role === "assistant" && message.content.includes("Lead received TEAM_RESULT"))
      && leadMessages.some((message) => message.role === "user" && message.content.includes("TEAM_RESULT"))
      && memberMessages.some((message) => message.role === "user" && message.content.includes("exact message TEAM_RESULT"))
      && memberMessages.some((message) => message.role === "assistant" && message.content.includes("TEAM_RESULT was sent"));
  }, "teammate reply round trip", 60_000);

  const teamRoster = await invoke("teamGetRoster", { teamSessionId: lead.id });
  assert.equal(teamRoster.members.length, 5);
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "Lead idle before board fixture");
  await waitFor(async () => (await invoke("teamGetBoard", { teamSessionId: lead.id })).tasks.length >= 6, "six Team board tasks", 60_000);
  const board = await invoke("teamGetBoard", { teamSessionId: lead.id });
  assert.equal(board.teamSessionId, lead.id);
  boardTaskId = board.tasks[0]?.taskId;
  assert.ok(boardTaskId, "board fixture task id was not initialized");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "Lead idle before task completion fixture");
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.completed === '0' && document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.total === '6'`), "Overview baseline before live task mutation");
  await invoke("agentPrompt", { sessionId: lead.id, viewingSessionId: lead.id, content: "Mark the board fixture task completed." });
  await waitFor(() => modelGates.taskUpdate.entered, "task update held after Host mutation");
  const updatedBoard = await invoke("teamGetBoard", { teamSessionId: lead.id });
  assert.equal(updatedBoard.tasks.find((task) => task.taskId === boardTaskId)?.status, "completed", "completed board fixture did not persist");
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.completed === '1' && document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.total === '6'`), "mounted Overview refreshes before the running turn settles");
  releaseModelRequest("taskUpdate");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "Lead settled after task completion fixture");
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="overview-team-progress"] .team-progress-row').length === 5`), "five compact Overview task rows");
  assert.match(await evaluate(`document.querySelector('[data-testid="overview-tab"]')?.innerText ?? ''`), /researcher|Alex/i, "Overview should expose the Team task/member summary");
  const overviewMetrics = await evaluate(`(() => {
    const overview = document.querySelector('[data-testid="overview-tab"]');
    const section = overview.querySelector('section.team-progress');
    return {
      header: section.querySelector('.team-progress-header').getBoundingClientRect().height,
      row: section.querySelector('.team-progress-row').getBoundingClientRect().height,
      summaries: Array.from(overview.querySelectorAll('details > summary')).map(summary => ({
        height: summary.getBoundingClientRect().height,
        chevrons: summary.querySelectorAll('.work-panel-overview-chevron').length,
        border: getComputedStyle(summary.parentElement).borderBottomStyle,
      })),
      extraInside: !!section.querySelector('.work-panel-overview-status'),
      separateProgress: Array.from(overview.querySelectorAll('details > summary')).some(summary => summary.innerText.trim() === 'Progress'),
    };
  })()`);
  assert.ok(Math.abs(overviewMetrics.header - 48) <= 2, `Team progress header geometry: ${JSON.stringify(overviewMetrics)}`);
  assert.ok(Math.abs(overviewMetrics.row - 50) <= 2, `Team progress row geometry: ${JSON.stringify(overviewMetrics)}`);
  assert.ok(overviewMetrics.summaries.every(summary => Math.abs(summary.height - 48) <= 2 && summary.chevrons === 1 && summary.border === 'dashed'), `Overview chrome geometry: ${JSON.stringify(overviewMetrics)}`);
  assert.equal(overviewMetrics.extraInside, true, "Team status must stay inside progress");
  assert.equal(overviewMetrics.separateProgress, false, "Team Overview must not repeat the ordinary progress disclosure");
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-group-toggle')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-rows')?.getClientRects().length === 0`), "Ad-hocs collapse actually hides rows");
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-group-toggle')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-row')?.getClientRects().length > 0`), "Ad-hocs reopen restores rows");
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-toggle')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-body')?.getClientRects().length === 0`), "progress collapse hides task and extra content");
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-toggle')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-body')?.getClientRects().length > 0`), "progress reopen restores task and extra content");
  console.log(`PASS Overview geometry/disclosures: ${JSON.stringify(overviewMetrics)}`);
  await saveScreenshot(sendCdp, "team-overview-progress.png");
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="overview-team-progress"] button')).find(button => /view all/i.test(button.innerText))?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.team-board-row').length === 6`), "all six compact board rows");
  await evaluate(`Array.from(document.querySelectorAll('.team-board-filter-control button')).find(button => /completed/i.test(button.innerText))?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.team-board-row').length === 1`), "completed board filter");
  assert.doesNotMatch(await evaluate(`document.querySelector('.team-board-row').innerText`), /blocked/i, "completed task is incorrectly blocked");
  await evaluate(`Array.from(document.querySelectorAll('.team-board-filter-control button')).find(button => button.innerText.trim() === 'All')?.click()`);
  await evaluate(`(() => {
    const input=document.querySelector('.team-board-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'task 1');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.team-board-row').length === 1`), "board keyword search");
  await saveScreenshot(sendCdp, "team-board-filtered.png");
  await assertNoPageHorizontalOverflow(sendCdp, evaluate);
  await evaluate(`document.querySelector('.team-board-row')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-detail"]')`), "full board task detail");
  assert.match(await evaluate(`document.querySelector('[data-testid="team-task-detail"]').innerText`), /Detail for E2E board fixture task 1/);
  await evaluate(`document.querySelector('.team-back-btn')?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.team-board-row').length === 1`), "board filter and query preserved after detail");
  await evaluate(`document.querySelector('.team-back-btn')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"]')`), "Team aggregate after board");
  console.log("PASS Team Overview/board: live task progress, compact list, filter/search and detail/back");
  await submitComposerPrompt(sendCdp, evaluate, "Hold the Lead while the queue is inspected.");
  await waitFor(() => modelGates.queue.entered, "controlled Lead turn for queue actions");
  for (let index = 1; index <= 8; index += 1) {
    await submitComposerPrompt(sendCdp, evaluate, `Queue fixture prompt ${index}`);
    await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="queued-prompt"]').length === ${index}`), `queue row ${index}`);
  }
  await evaluate(`document.querySelector('.composer-queue-heading')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('.composer-queue-heading')?.getAttribute('aria-expanded') === 'false'`), "queue folded with eight waiting prompts");
  await saveScreenshot(sendCdp, "team-queue-collapsed.png");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${planLead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${planLead.id}"].active') && !document.querySelector('.composer-queue-heading')`), "another session has an independent empty queue");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('.composer-queue-heading')?.getAttribute('aria-expanded') === 'false'`), "Lead queue keeps folded choice after session return");
  await evaluate(`document.querySelector('.composer-queue-heading')?.click()`);
  assert.ok(await evaluate(`document.querySelector('.composer-queue-body').clientHeight <= 168`), "eight-row queue body exceeds its height limit");
  await evaluate(`document.querySelectorAll('.composer-queued-prompt-move-up')[7]?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.composer-queued-prompt-text')[6]?.innerText === 'Queue fixture prompt 8'`), "queue Move Up");
  await evaluate(`document.querySelectorAll('.composer-queued-prompt-move-down')[6]?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('.composer-queued-prompt-text')[7]?.innerText === 'Queue fixture prompt 8'`), "queue Move Down");
  await evaluate(`document.querySelectorAll('.composer-queued-prompt-remove')[7]?.click()`);
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="queued-prompt"]').length === 7`), "queue Remove");
  await evaluate(`document.querySelectorAll('.composer-queued-prompt-edit')[1]?.click()`);
  await waitFor(() => evaluate(`document.querySelector('.composer-input')?.textContent === 'Queue fixture prompt 2' && document.querySelectorAll('[data-testid="queued-prompt"]').length === 6`), "queue Edit returns the draft");
  await submitComposerPrompt(sendCdp, evaluate, "Queue fixture prompt 2 edited");
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="queued-prompt"]').length === 7`), "edited queue prompt reinserted");
  await saveScreenshot(sendCdp, "team-queue-expanded.png");
  for (let count = 7; count > 1; count -= 1) {
    await evaluate(`document.querySelectorAll('.composer-queued-prompt-remove')[${count - 1}]?.click()`);
    await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="queued-prompt"]').length === ${count - 1}`), "remove surplus queue fixture");
  }
  await evaluate(`document.querySelector('.composer-queued-prompt-send-now')?.click()`);
  releaseModelRequest("queue");
  await waitFor(() => calls.some(call => call.userText.includes('Queue fixture prompt 1') && call.tool === null), "queue Send Now executes the retained prompt");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "queue execution settled");
  await waitFor(() => evaluate(`!document.querySelector('.composer-queue-heading')`), "empty queue disclosure removed");
  console.log("PASS Queue user path: eight rows, scoped folding, bounded scroll, move up/down, remove, edit and Send Now");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${standardSession.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${standardSession.id}"].active') && !document.querySelector('.composer-contract-chip')`), "standard session selected");
  await submitComposerPrompt(sendCdp, evaluate, "Standard coexistence probe: delegate one read-only task and report the result.");
  await waitFor(() => calls.some(call => call.userText.includes('STANDARD_CHILD_RESULT') && call.tool === null), "ordinary Task delegate executed");
  await waitFor(async () => (await invoke("agentGetStatus", standardSession.id)).status?.isRunning === false, "ordinary Task parent settled");
  await activateOverviewTab(sendCdp, evaluate);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-testid="overview-tab"] details > summary')).some(summary => summary.innerText.trim() === 'Progress')`), true, "ordinary session keeps its progress disclosure");
  const standardDetail = await invoke("sessionGet", { id: standardSession.id });
  assert.ok(standardDetail.session.messages.some(message => message.content?.includes('STANDARD_PARENT_RESULT')));
  assert.equal((await invoke("teamGetRoster", {teamSessionId: lead.id})).members.length, 5, "ordinary delegate changed the Team roster");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-session-pane="${lead.id}"][data-visible="true"]')`), "Lead restored after ordinary delegate");
  console.log("PASS Coexistence: ordinary Task parent/delegate executes while the five-member Team remains intact");
  await openTeamPanel(sendCdp, evaluate);

  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"] .team-member-card')`), "Team panel roster");
  const teamPanelText = await evaluate(`document.querySelector('[data-testid="team-panel"]')?.innerText ?? ''`);
  assert.match(teamPanelText, /researcher/);
  const screenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  screenshotPath = join(tempRoot, "team-panel.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)} + ' [data-action="toggle-team-session"]')?.click()`);
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-member-card')).find(card => card.innerText.includes('Researcher Alex'))?.querySelector('.team-card-footer button')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${member.memberSessionId}"].active')`), "member transcript navigation");
  await waitFor(() => evaluate(`!!document.querySelector('[data-session-pane="${member.memberSessionId}"][data-visible="true"]')`), "member transcript hydrated");
  await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(teamGroupSelector)})?.getAttribute('data-expanded') === 'true'`), "selected member reveals its folded parent");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="team-panel"] .team-member-card').length === 5`), "member Team launcher resolves the parent Team snapshot");
  const memberRequests = calls.filter(call => call.userText.includes("Send the exact message TEAM_RESULT"));
  assert.ok(memberRequests.length > 0);
  assert.ok(memberRequests.every(call => call.model === "team-approved"), "approved model was not used by member runtime");
  console.log("PASS Team runtime: approved route -> fresh teammate -> peer message -> Lead reply");
  console.log("PASS Team UI: roster and member session navigation");
  console.log(`Evidence image: ${screenshotPath}`);

  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(async () => { const result = await invoke("agentGetStatus", lead.id); assert.equal(typeof result.status?.isRunning, "boolean"); return result.status.isRunning === false; }, "Lead idle for lead-only turn");
  await invoke("agentPrompt", {sessionId: lead.id, viewingSessionId: lead.id, content: "Handle this without specialists."});
  await waitFor(async () => (await invoke("teamGetExecutionDecision", {teamSessionId: lead.id})).decision?.strategy === "lead_only", "latest lead-only decision");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-panel"]')?.innerText.includes('This short task needs no specialist.')`), "lead-only reason visible");
  assert.equal((await invoke("teamGetRoster", {teamSessionId: lead.id})).members.length, 5);
  console.log("PASS Team strategy: Lead-only decision and reason visible without an extra expert");

  socket.close();
  socket = null;
  await stopApp();
  await host.start();
  const pauseResult = await host.call("team.pause", {
    teamSessionId: lead.id,
    callerSessionId: lead.id,
  });
  assert.equal(pauseResult.team.paused, true);
  const queued = await host.call("team.sendMessage", {
    teamSessionId: lead.id,
    callerSessionId: lead.id,
    target: "researcher",
    content: "DELIVER_AFTER_RESUME",
    idempotencyKey: "team-e2e-paused-message",
  });
  assert.equal(queued.message.deliveryStatus, "queued");
  await host.stop();

  ({ sendCdp, evaluate, invoke } = await startApp());
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"]') && !document.querySelector('.startup-splash')`), "Lead after paused restart");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"].active')`), "Lead reselected after paused restart");
  await waitFor(() => evaluate(`!!document.querySelector('[data-session-pane="${lead.id}"][data-visible="true"]')`), "Lead transcript restored after paused restart");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(async () => (await invoke("teamGetRoster", { teamSessionId: lead.id })).paused, "paused Team panel after restart");
  const memberBeforeResume = await invoke("sessionGet", { id: member.memberSessionId });
  assert.equal((memberBeforeResume.session?.messages ?? []).some((message) => message.content.includes("DELIVER_AFTER_RESUME")), false);
  assert.equal(calls.filter((call) => call.userText.includes("DELIVER_AFTER_RESUME")).length, 0);
  const pausedScreenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  await writeFile(join(tempRoot, "team-panel-paused.png"), Buffer.from(pausedScreenshot.data, "base64"));

  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button')).some(button => /resume/i.test(button.innerText))`), "Team Resume control");
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button')).find(button => /resume/i.test(button.innerText))?.click()`);
  await waitFor(async () => {
    const currentRoster = await invoke("teamGetRoster", { teamSessionId: lead.id });
    const memberResult = await invoke("sessionGet", { id: member.memberSessionId });
    const memberMessages = memberResult.session?.messages ?? [];
    return !currentRoster.paused
      && memberMessages.some((message) => message.role === "user" && message.content.includes("DELIVER_AFTER_RESUME"))
      && memberMessages.some((message) => message.role === "assistant" && message.content.includes("delivered after Resume"));
  }, "queued Team message delivered after Resume", 60_000);
  assert.equal(calls.filter((call) => call.userText.includes("DELIVER_AFTER_RESUME")).length, 1);
  await waitFor(async () => {
    const snapshot = await invoke("teamGetSnapshot", { teamSessionId: lead.id });
    return !snapshot.paused && snapshot.leadPhase !== "running" &&
      snapshot.members.every((item) => item.phase !== "running") &&
      snapshot.members.find((item) => item.memberSessionId === member.memberSessionId)?.phase === "completed";
  }, "Team settled after Resume");
  assert.equal(titleRequests.length, 3, "member runs, repeated turns and restart must not create extra title requests");
  assert.equal(titleRequests.filter(call => call.userText.includes('Approved task title: Approved Team Assignment')).length, 1);
  const resumedScreenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  await writeFile(join(tempRoot, "team-panel-resumed.png"), Buffer.from(resumedScreenshot.data, "base64"));
  console.log("PASS Team lifecycle: queued mail stayed idle through restart while paused, then delivered once after Resume");
  await verifyTeamLayoutMatrix(sendCdp, evaluate, "en");
  await invoke("settingsSet", { language: "zh-CN" });
  await sendCdp("Page.reload");
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"]') && document.body.innerText.includes('新建任务')`), "Chinese shell after renderer reload");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-session-pane="${lead.id}"][data-visible="true"]')`), "Lead reopened after Chinese reload");
  await openTeamPanel(sendCdp, evaluate);
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"]')?.innerText.includes('进展')`), "Chinese compact Team progress");
  await saveScreenshot(sendCdp, "team-overview-zh-CN.png");
  await verifyTeamLayoutMatrix(sendCdp, evaluate, "zh-CN");
  assert.equal(titleRequests.length, 3, "renderer reload must not duplicate title requests");
  console.log("PASS Chinese Team presentation: compact progress and identities survive renderer reload without another title request");
} catch (error) {
  if (socket?.readyState === 1 && lastSendCdp) {
    try { console.error(`Failure image: ${await saveScreenshot(lastSendCdp, "team-failure.png")}`); } catch {}
  }
  console.error("Fixture calls", JSON.stringify(calls));
  console.error("Title diagnostics", JSON.stringify(titleDiagnostics));
  console.error(appOutput?.slice(-4000));
  throw error;
} finally {
  socket?.close();
  await stopApp();
  await host.stop();
  providerServer.closeAllConnections();
  await new Promise((resolveClose) => providerServer.close(resolveClose));
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (process.env.PI_DESKTOP_KEEP_E2E_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept isolated E2E profile: ${tempRoot}`);
  }
}
