#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveElectronBinary } from "./e2e/boot.mjs";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const tempRoot = await mkdtemp(join(tmpdir(), "pi-desktop-team-e2e-"));
const dataDir = join(tempRoot, "data");
const projectPath = join(tempRoot, "workspace");
await mkdir(projectPath, { recursive: true });

const calls = [];
let fixtureError;
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
    const userText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((part) => part.text ?? "").join("\n")
        : "";
    const priorToolNames = messages
      .filter((message) => message.role === "assistant" && Array.isArray(message.tool_calls))
      .flatMap((message) => message.tool_calls.map((call) => call.function?.name));
    const toolNames = (request.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
    let toolCall;
    let finalText;

    if (userText.includes("Please spawn one teammate")) {
      if (!priorToolNames.includes("spawn_teammate")) {
        assert.ok(toolNames.includes("spawn_teammate"), "Lead runtime lacks spawn_teammate");
        toolCall = {
          name: "spawn_teammate",
          args: {
            name: "researcher",
            description: "Reports a fixed result to the Lead.",
            contextKind: "fresh",
            prompt: "Send the exact message TEAM_RESULT to Lead using send_message.",
          },
        };
      } else {
        finalText = "The teammate is running.";
      }
    } else if (userText.includes("Send the exact message TEAM_RESULT")) {
      if (!priorToolNames.includes("send_message")) {
        assert.ok(toolNames.includes("send_message"), "member runtime lacks send_message");
        toolCall = {
          name: "send_message",
          args: { targetMemberName: "Lead", content: "TEAM_RESULT" },
        };
      } else {
        finalText = "TEAM_RESULT was sent to Lead.";
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
    calls.push({ userText, tool: toolCall?.name ?? null });

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
  return { sendCdp, evaluate, invoke };
}

async function openTeamPanel(sendCdp, evaluate) {
  if (await evaluate(`!!document.querySelector('[data-testid="team-panel"]')`)) return;
  await sendCdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74, modifiers: 4 });
  await sendCdp("Input.dispatchKeyEvent", { type: "keyUp", key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74, modifiers: 4 });
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="work-panel"] .work-panel-new-tab')`), "Work Panel open");
  await evaluate(`document.querySelector('.work-panel-new-tab').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-work-panel-launcher-item="team"]')`), "Team launcher item");
  await evaluate(`document.querySelector('[data-work-panel-launcher-item="team"]').click()`);
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
  });
  await host.call("settings.set", {
    language: "en",
    defaultProviderId: provider.id,
    defaultModelId: "team-fixture",
    defaultMode: "agent",
    defaultPermissionMode: "auto",
  });
  const { session: lead } = await host.call("session.create", {
    title: "Team E2E Lead",
    mode: "agent",
    executionProfile: "team",
    projectPath,
    providerId: provider.id,
    modelId: "team-fixture",
    permissionMode: "auto",
  });
  assert.equal(lead.executionProfile, "team");
  await host.stop();

  let { sendCdp, evaluate, invoke } = await startApp();

  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"]') && !document.querySelector('.startup-splash')`), "Lead in sidebar");
  await evaluate(`document.querySelector('[data-sidebar-session-row="${lead.id}"] button.thread-item-main')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${lead.id}"].active')`), "Lead selected");
  await invoke("agentPrompt", {
    sessionId: lead.id,
    viewingSessionId: lead.id,
    content: "Please spawn one teammate, let the teammate report back, and then summarize the result.",
  });

  let roster;
  let member;
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
  const board = await invoke("teamGetBoard", { teamSessionId: lead.id });
  assert.equal(teamRoster.members.length, 1);
  assert.equal(board.teamSessionId, lead.id);

  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"] .team-member-card')`), "Team panel roster");
  const teamPanelText = await evaluate(`document.querySelector('[data-testid="team-panel"]')?.innerText ?? ''`);
  assert.match(teamPanelText, /researcher/);
  const screenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  screenshotPath = join(tempRoot, "team-panel.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate(`document.querySelector('[data-testid="team-panel"] .team-member-card button')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${member.memberSessionId}"].active')`), "member transcript navigation");
  console.log("PASS Team runtime: Lead -> fresh teammate -> peer message -> Lead reply");
  console.log("PASS Team UI: roster and member session navigation");
  console.log(`Evidence image: ${screenshotPath}`);

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
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"] .team-status-active')`), "Team active after Resume");
  const resumedScreenshot = await sendCdp("Page.captureScreenshot", { format: "png" });
  await writeFile(join(tempRoot, "team-panel-resumed.png"), Buffer.from(resumedScreenshot.data, "base64"));
  console.log("PASS Team lifecycle: queued mail stayed idle through restart while paused, then delivered once after Resume");
} catch (error) {
  console.error(appOutput?.slice(-4000));
  throw error;
} finally {
  socket?.close();
  await stopApp();
  await host.stop();
  providerServer.closeAllConnections();
  await new Promise((resolveClose) => providerServer.close(resolveClose));
  if (process.env.PI_DESKTOP_KEEP_E2E_ARTIFACTS !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept isolated E2E profile: ${tempRoot}`);
  }
}
