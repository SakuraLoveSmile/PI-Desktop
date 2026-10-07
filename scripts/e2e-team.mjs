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

const planningFixture = process.env.PI_E2E_TEAM_PLANNING === "1"
  ? (await import("./e2e-team-planning.mjs")).createPlanningFixture(projectPath)
  : null;
const forcedFixture = process.env.PI_E2E_TEAM_APPROVED_GOAL === "1"
  ? (await import("./e2e-team-approved-goal.mjs")).createApprovedGoalFixture(projectPath)
  : process.env.PI_E2E_TEAM_FORCED === "1"
  ? (await import("./e2e-team-forced.mjs")).createForcedFixture(projectPath)
  : null;
const calls = [];
let pendingExpertPrompt;
let researcherSessionId;
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
let signalInitialExpertStart;
const initialExpertStarted = new Promise(resolve => { signalInitialExpertStart = resolve; });
let signalLightExpertStart;
let lightExpertStarted = Promise.resolve();

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
function existingExpertProposal(reason) {
  lightExpertStarted = new Promise(resolve => { signalLightExpertStart = resolve; });
  assert.ok(researcherSessionId, "lightweight dispatch needs the real approved researcher");
  return { strategy: "delegate", reason, members: [{ name: "researcher", memberSessionId: researcherSessionId,
    description: "Inspect the assigned board task.", contextKind: "fresh",
    presentation: { role: "researcher", displayName: "Alex" },
  }] };
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
    let userText = typeof lastUser?.content === "string"
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
    const triggerText = userText;
    const lightweightConfirmed = userText.includes("Team review") && userText.includes("confirmed") && Boolean(pendingExpertPrompt);
    const lightweightResult = userText.includes("E2E_LIGHT_RESULT: assigned task inspected.");
    if (lightweightResult && !planningFixture && !forcedFixture) {
      assert.ok(pendingExpertPrompt, "expert result lost its fixture action");
      userText = pendingExpertPrompt;
    }
    const titleSystemPrompt = messages.find((message) => message.role === "system")?.content;
    const isTitleRequest = typeof titleSystemPrompt === "string" &&
      titleSystemPrompt.includes("descriptive session title summarizing the conversation");
    if (!isTitleRequest && toolNames.includes("declare_team_strategy")) {
      for (const name of ["Task", "TaskWait", "TaskList", "TaskStop", "SessionTask"]) {
        assert.equal(toolNames.includes(name), false, `Team exposed ${name}`);
      }
      if (titleSystemPrompt?.includes("You are the Lead of an Expert Team.")) {
        assert.match(titleSystemPrompt, /always delegates/,
          "execution Lead receives mandatory delegation steering");
        assert.match(titleSystemPrompt, /Never choose lead_only or offer solo approval/,
          "Lead cannot offer solo handling");
      }
    }
    let toolCall;
    let finalText;
    let thinkingText;
    let kind = "agent";

    if (isTitleRequest) {
      kind = "title";
      finalText = userText.includes("Approved task title: Approved Team Assignment")
        ? "Team Plan Execution"
        : userText.includes("Create an approved Team execution plan")
          ? "Approved Team Assignment"
          : "Expert Team Delegation";
    } else if (forcedFixture) {
      ({ toolCall, finalText } = await forcedFixture.respond({ userText, priorToolNames, activeTurnMessages, activeToolText, toolNames, allMessages: messages }));
    } else if (planningFixture) {
      ({ toolCall, finalText } = await planningFixture.respond({ userText, priorToolNames, activeTurnMessages, activeToolText, toolNames, allMessages: messages }));
    } else if (lightweightConfirmed) {
      if (!priorToolNames.includes("send_message")) {
        toolCall = { name: "send_message", args: {
          targetMemberName: "researcher", content: "E2E_LIGHT_WORK: inspect the assigned board task, then send E2E_LIGHT_RESULT to Lead.",
        }};
      } else {
        await lightExpertStarted;
        finalText = "Approved expert check is running.";
      }
    } else if (userText.includes("E2E_LIGHT_WORK")) {
      signalLightExpertStart?.();
      if (!priorToolNames.includes("task_get")) {
        toolCall = { name: "task_get", args: { taskId: boardTaskId } };
      } else if (!priorToolNames.includes("send_message")) {
        toolCall = { name: "send_message", args: { targetMemberName: "Lead", content: "E2E_LIGHT_RESULT: assigned task inspected." }};
      } else { finalText = "Assigned expert check complete."; }
    } else if (!lightweightResult && priorToolNames.includes("declare_team_strategy") && activeToolText.includes("pending")) {
      finalText = "Waiting for your expert launch approval.";
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
      assert.equal(toolNames.includes("declare_team_strategy"), false, "title-only Plan fixture should use standard profile");
      toolCall = { name: "SubmitPlan", args: {
        title: "Approved Team Assignment", question: "Run this approved Team plan?",
        markdown: "# Approved Team Assignment\n\n1. Coordinate the approved Team execution.\n2. Record the result for the Lead.\n",
      }};
    } else if (userText.includes("Approved plan title: Approved Team Assignment")) {
      assert.equal(toolNames.includes("declare_team_strategy"), false, "standard title fixture became Team execution");
      finalText = "Approved Team plan execution finished.";
    } else if (userText.includes("Please spawn one teammate")) {
      if (!lightweightResult && !priorToolNames.includes("declare_team_strategy")) {
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
      } else {
        await initialExpertStarted;
        finalText = "Approved expert work is running.";
      }
    } else if (userText.includes("Handle the bounded check with the existing expert")) {
      if (!lightweightResult && !priorToolNames.includes("declare_team_strategy")) {
        pendingExpertPrompt = userText;
        toolCall = { name: "declare_team_strategy", args: existingExpertProposal("An approved researcher must inspect this bounded check.") };
      } else { finalText = "Handled with the approved expert contribution."; }
    } else if (userText.includes("Send the exact message TEAM_RESULT")) {
      signalInitialExpertStart();
      thinkingText = "TEAM_MEMBER_THINKING: verify the fixed result before reporting.";
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
      if (!lightweightResult && !priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          ...existingExpertProposal("The researcher must inspect the board item before completion.")
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
      if (!lightweightResult && !priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          ...existingExpertProposal("The researcher must inspect the queue context.")
        }};
      } else {
        await holdModelRequest("queue");
        finalText = "The Lead queue inspection turn is complete.";
      }
    } else if (userText.includes("Queue fixture prompt")) {
      if (!lightweightResult && !priorToolNames.includes("declare_team_strategy")) {
        toolCall = { name: "declare_team_strategy", args: {
          ...existingExpertProposal("The researcher must inspect this queued task.")
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
    if (toolCall?.name === "declare_team_strategy" && researcherSessionId) pendingExpertPrompt = userText;
    const call = { kind, userText, triggerText, tool: toolCall?.name ?? null, model: request.model };
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
    if (thinkingText) emit({ role: "assistant", reasoning_content: thinkingText });
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

async function openTeamPanel(sendCdp, evaluate, requestedTeamSessionId) {
  if (await evaluate(`!!document.querySelector('[data-testid="team-panel"]')`) && !requestedTeamSessionId) return;
  const existingTeamTab = await evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll('[data-work-panel-tab-id]'))
      .find((node) => ${requestedTeamSessionId ? `node.getAttribute('data-work-panel-tab-id') === ${JSON.stringify(`team:${requestedTeamSessionId}`)}` : `/^team:[^:]+$/.test(node.getAttribute('data-work-panel-tab-id') ?? '')`});
    if (!tab) return false;
    tab.querySelector('.work-panel-tab-button')?.click();
    return tab.getAttribute('data-work-panel-tab-id');
  })()`);
  if (existingTeamTab) {
    await waitFor(() => evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === ${JSON.stringify(existingTeamTab)}`), "aggregate Team tab activated");
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-panel"],.team-back-btn')`), "existing Team surface");
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    // The fixture can leave task/member -> board -> aggregate on the local stack.
    for (let depth = 0; depth < 3; depth += 1) {
      if (await evaluate(`!!document.querySelector('[data-testid="team-panel"]')`)) break;
      const previousView = await evaluate(`document.querySelector('.team-panel[data-testid]')?.getAttribute('data-testid')`);
      assert.ok(["team-task-detail", "team-member-detail", "team-task-board"].includes(previousView), `unexpected Team view while returning to aggregate: ${previousView}`);
      await evaluate(`document.querySelector('.team-back-btn')?.click()`);
      await waitFor(() => evaluate(`(() => { const view=document.querySelector('.team-panel[data-testid]'); return !!view && view.getAttribute('data-testid') !== ${JSON.stringify(previousView)}; })()`), `Team Back left ${previousView}`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
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

async function approveExpertReview(invoke, evaluate, sessionId, previousReviewId) {
  const review = await waitFor(async () => {
    const current = (await invoke("teamGetLaunchReview", { teamSessionId: sessionId })).review;
    return current?.status === "pending" && (current.strategy ?? "delegate") === "delegate" && current.members.length > 0 &&
      current.reviewId !== previousReviewId ? current : null;
  }, "pending nonempty expert review");
  await waitFor(async () => (await invoke("agentGetStatus", sessionId)).status?.isRunning === false, "expert proposer settled");
  const previousTab = await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`);
  await openTeamPanel(lastSendCdp, evaluate);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')`), "team-panel expert confirmation");
  await evaluate(`document.querySelector('[data-testid="team-launch-review-confirm-btn"]').click()`);
  await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: sessionId })).review?.status === "confirmed", "trusted expert confirmation committed");
  if (previousTab) {
    await evaluate(`document.querySelector(${JSON.stringify(`[data-work-panel-tab-id="${previousTab}"] .work-panel-tab-button`)})?.click()`);
  }
  return review.reviewId;
}

async function activateOverviewTab(sendCdp, evaluate) {
  // Overview navigation is explicit user navigation. Each session owns its
  // panel state, so a newly selected Standard session may start with it closed.
  const panelState = await waitFor(() => evaluate(`(() => {
    const panel=document.querySelector('[data-testid="work-panel"]');
    const pressed=document.querySelector('.app-work-panel-toggle')?.getAttribute('aria-pressed');
    if (!panel && pressed === 'false') return 'closed';
    if (panel && panel.getAttribute('data-exiting') !== 'true' && pressed === 'true') return 'open';
    return null;
  })()`), "stable panel before explicit Overview navigation");
  if (panelState === "closed") {
    await evaluate(`document.querySelector('.app-work-panel-toggle').click()`);
  }
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

async function assertTeamSuccessGlyph(evaluate, selector, label) {
  const colors = await evaluate(`(() => {
    const probe=document.createElement('span'); probe.style.color='var(--ds-success)'; document.body.append(probe);
    try { return { expected:getComputedStyle(probe).color, actual:document.querySelector(${JSON.stringify(selector)}) ? getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color : null }; }
    finally { probe.remove(); }
  })()`);
  assert.equal(colors.actual, colors.expected, `${label} completed glyph uses the success token`);
}

async function verifyTeamHeaderHitAreas(evaluate, testId) {
  const result = await evaluate(`(() => {
    const buttons=Array.from(document.querySelectorAll('[data-testid="${testId}"] .team-work-tab-header button:not(:disabled)'));
    const rects=buttons.map(button => button.getBoundingClientRect());
    return { targets: buttons.map((button,index) => {
      const rect=rects[index], x=rect.left+rect.width/2;
      return { height:rect.height, width:rect.width,
        top:document.elementFromPoint(x,rect.top+1)?.closest('button')===button,
        bottom:document.elementFromPoint(x,rect.bottom-1)?.closest('button')===button };
    }), overlap:rects.some((a,index) => rects.slice(index+1).some(b =>
      Math.min(a.right,b.right)>Math.max(a.left,b.left) && Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top))) };
  })()`);
  assert.ok(result.targets.length > 0);
  assert.ok(result.targets.every(target => target.height >= 24 && target.width >= 24 && target.top && target.bottom), `${testId} actual pointer targets: ${JSON.stringify(result)}`);
  assert.equal(result.overlap, false, `${testId} header pointer targets overlap`);
}

async function verifyStaleTeamTabRetry(evaluate, testId) {
  const fixtureDatabase = join(dataDir, "pi.sqlite");
  const transcriptBefore = await evaluate(`document.querySelector('[data-testid="${testId}"] [role="log"]')?.innerText ?? ''`);
  execFileSync("sqlite3", [fixtureDatabase, "PRAGMA busy_timeout=5000; ALTER TABLE team_tasks RENAME TO team_tasks_fixture_failure;"]);
  try {
    await evaluate(`window.dispatchEvent(new Event('focus'))`);
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="${testId}"] .team-error-banner button')`), `${testId} failed-read banner`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="${testId}"] [role="log"]')?.innerText ?? ''`), transcriptBefore, "snapshot read failure retains the visible member transcript");
  } finally {
    execFileSync("sqlite3", [fixtureDatabase, "PRAGMA busy_timeout=5000; ALTER TABLE team_tasks_fixture_failure RENAME TO team_tasks;"]);
  }
  await evaluate(`document.querySelector('[data-testid="${testId}"] .team-error-banner button')?.click()`);
  await waitFor(() => evaluate(`!document.querySelector('[data-testid="${testId}"] .team-error-banner')`), `${testId} Retry restores snapshot`);
}

async function resizePanel(sendCdp, evaluate, width) {
  await waitFor(() => evaluate(`(() => {
    const panel=document.querySelector('[data-testid="work-panel"]');
    return panel && !panel.hasAttribute('data-resizing') &&
      panel.getAnimations({subtree:true}).every(animation => animation.playState !== 'running');
  })()`), "previous resize and panel animations settled");
  const bounds = await evaluate(`(() => {
    const panel=document.querySelector('[data-testid="work-panel"]');
    const handle=panel.querySelector('.work-panel-resize');
    const rect=handle.getBoundingClientRect();
    const x=rect.left+rect.width/2, y=rect.top+120;
    if (document.elementFromPoint(x,y) !== handle) throw new Error('Resize handle is obscured');
    const trace={events:[],pointerId:null};
    const record=event => {
      if (event.type === 'pointerdown') trace.pointerId=event.pointerId;
      trace.events.push({type:event.type,pointerId:event.pointerId,captured:handle.hasPointerCapture(event.pointerId)});
    };
    const types=['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture'];
    for (const type of types) handle.addEventListener(type,record);
    const blur=() => trace.events.push({type:'blur'});
    window.addEventListener('blur',blur);
    window.__teamResizeTrace={trace,handle,dispose:() => {
      for (const type of types) handle.removeEventListener(type,record);
      window.removeEventListener('blur',blur);
    }};
    return {width:panel.getBoundingClientRect().width,x,y};
  })()`);
  let failure;
  try {
    await sendCdp("Input.dispatchMouseEvent", {type:"mousePressed",x:bounds.x,y:bounds.y,button:"left",buttons:1,clickCount:1});
    await waitFor(() => evaluate(`(() => {
      const {trace,handle}=window.__teamResizeTrace;
      return trace.pointerId !== null && handle.hasPointerCapture(trace.pointerId) &&
        document.querySelector('[data-testid="work-panel"]').dataset.resizing === 'true';
    })()`), "current pointer captured for panel resize");
    await sendCdp("Input.dispatchMouseEvent", {type:"mouseMoved",x:bounds.x+bounds.width-width,y:bounds.y,button:"left",buttons:1});
    await waitFor(() => evaluate(`Math.abs(document.querySelector('[data-testid="work-panel"]').getBoundingClientRect().width-${width}) < 2`), `panel drag reached ${width}px`);
  } catch (error) {
    failure=error;
  } finally {
    try {
      await sendCdp("Input.dispatchMouseEvent", {type:"mouseReleased",x:bounds.x+bounds.width-width,y:bounds.y,button:"left",buttons:0,clickCount:1});
      await waitFor(() => evaluate(`(() => {
        const {trace,handle}=window.__teamResizeTrace;
        return trace.events.some(event => event.type === 'pointerup' && event.pointerId === trace.pointerId) &&
          !handle.hasPointerCapture(trace.pointerId) &&
          !document.querySelector('[data-testid="work-panel"]').hasAttribute('data-resizing');
      })()`), "current pointer released and resize state cleared");
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    } catch (error) {
      failure ??= error;
    }
    if (failure) {
      try {
        const state=await evaluate(`(() => {
        const {trace,handle}=window.__teamResizeTrace;
        const panel=document.querySelector('[data-testid="work-panel"]');
        return {events:trace.events,pointerId:trace.pointerId,captured:trace.pointerId !== null && handle.hasPointerCapture(trace.pointerId),
          actualWidth:panel.getBoundingClientRect().width,resizing:panel.getAttribute('data-resizing'),handleBounds:handle.getBoundingClientRect().toJSON()};
      })()`);
        console.error("TEAM_RESIZE_FAILURE",JSON.stringify({fromBounds:bounds,targetWidth:width,error:String(failure),state}));
      } catch (error) {
        console.error("TEAM_RESIZE_DIAGNOSTIC_FAILURE",JSON.stringify({primaryError:String(failure),error:String(error)}));
      }
    }
    try {
      await evaluate(`window.__teamResizeTrace?.dispose(); delete window.__teamResizeTrace; true`);
    } catch (error) {
      console.error("TEAM_RESIZE_DISPOSAL_FAILURE",String(error));
      failure ??= error;
    }
  }
  if (failure) throw failure;
  await waitFor(() => evaluate(`Math.abs(document.querySelector('[data-testid="work-panel"]').getBoundingClientRect().width-${width}) < 2`), `panel resized to ${width}px`);
}

async function verifyTeamLayoutMatrix(sendCdp, evaluate, locale) {
  await sendCdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  let primaryError;
  let matrixPosition = { locale, surface: "setup" };
  const diagnostics = () => evaluate(`(() => {
    const panel=document.querySelector('[data-testid="work-panel"]');
    const view=document.querySelector('.team-panel[data-testid],.work-panel-overview,.team-work-tab');
    return { tab: document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id'),
      view: view?.getAttribute('data-testid'), width: panel?.getBoundingClientRect().width,
      resizing: panel?.getAttribute('data-resizing'), fontScale: getComputedStyle(document.documentElement).getPropertyValue('--font-scale'),
      back: !!document.querySelector('.team-back-btn') };
  })()`);
  try {
    for (const surface of ["overview", "aggregate", "board", "detail", "taskTab"]) {
      matrixPosition = { locale, surface, stage: "navigation" };
      await openTeamPanel(sendCdp, evaluate);
      if (surface !== "aggregate") {
        await activateOverviewTab(sendCdp, evaluate);
        await waitFor(() => evaluate(`document.querySelectorAll('.team-progress-row').length > 0`), "live task rows for layout matrix");
        if (surface === "taskTab") {
          await evaluate(`document.querySelector('.team-progress-row')?.click()`);
          await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-tab"]')`), "task tab for layout matrix");
        } else if (surface !== "overview") {
          await evaluate(`Array.from(document.querySelectorAll('.team-progress button')).find(button => /view all|查看全部/i.test(button.innerText))?.click()`);
          await waitFor(() => evaluate(`!!document.querySelector('.team-board-row')`), "board for layout matrix");
          if (surface === "detail") {
            await evaluate(`document.querySelector('.team-board-row')?.click()`);
            await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-detail"]')`), "long task detail for layout matrix");
          }
        }
      }
      for (const width of [320, 450, 620]) {
        matrixPosition = { locale, surface, width, stage: "resize" };
        await resizePanel(sendCdp, evaluate, width);
        for (const scale of [1, 1.5]) for (const theme of ["dark", "light"]) {
          matrixPosition = { locale, surface, width, scale, theme, stage: "measure" };
          await evaluate(`document.documentElement.style.setProperty('--font-scale', '${scale}'); document.documentElement.setAttribute('data-theme', '${theme}'); true`);
          await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          const metrics = await evaluate(`(() => {
            const root=document.documentElement;
            const surface=document.querySelector('.team-panel, .work-panel-overview, .team-work-tab');
            return { page: [root.clientWidth, root.scrollWidth], surface: [surface.clientWidth, surface.scrollWidth] };
          })()`);
          assert.ok(metrics.page[1] <= metrics.page[0] && metrics.surface[1] <= metrics.surface[0], `${locale}/${surface}/${width}/${scale}/${theme} overflows: ${JSON.stringify(metrics)}`);
          if (scale === 1.5 && width === 320) await saveScreenshot(sendCdp, `team-${surface}-${locale}-${theme}-320-150.png`);
        }
      }
    }
  } catch (error) {
    primaryError = error;
    console.error("TEAM_LAYOUT_PRIMARY_FAILURE", JSON.stringify({ ...matrixPosition, error: String(error), state: await diagnostics() }));
    await saveScreenshot(sendCdp, `team-layout-primary-${locale}.png`);
    throw error;
  } finally {
    try {
      await evaluate(`document.documentElement.style.removeProperty('--font-scale'); document.documentElement.setAttribute('data-theme', 'dark'); true`);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await resizePanel(sendCdp, evaluate, 360);
    } catch (error) {
      console.error("TEAM_LAYOUT_CLEANUP_FAILURE", JSON.stringify({ ...matrixPosition, error: String(error), state: await diagnostics() }));
      if (!primaryError) throw error;
    } finally {
      await sendCdp("Emulation.clearDeviceMetricsOverride");
    }
  }
  console.log(`PASS Team layout matrix ${locale}: Overview/aggregate/board/long detail/task tab, 320/450/620px, 100%/150%, dark/light`);
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
    mode: process.env.PI_E2E_TEAM_APPROVED_GOAL === "1" ? "goal" : "plan",
    executionProfile: planningFixture || forcedFixture ? "team" : "standard",
    projectPath,
    providerId: provider.id,
    modelId: "team-fixture",
    permissionMode: "auto",
  });
  const { session: standardSession } = await host.call("session.create", {
    title: "Standard coexistence", mode: "agent", executionProfile: "standard", projectPath,
    providerId: provider.id, modelId: "team-fixture", permissionMode: "auto",
  });
  const completionSessions = {};
  if (forcedFixture) {
    for (const kind of ["recover", "persistent", "planRecover"]) {
      completionSessions[kind] = (await host.call("session.create", {
        title: `Forced text ${kind}`, mode: kind === "planRecover" ? "plan" : "agent", executionProfile: "team", projectPath,
        providerId: provider.id, modelId: "team-fixture", permissionMode: "auto",
      })).session;
    }
  }
  assert.equal(lead.executionProfile, "team");
  await host.stop();

  let { sendCdp, evaluate, invoke } = await startApp();

  if (forcedFixture) {
    await forcedFixture.runJourney({ lead, planLead, completionSessions, invoke, evaluate, sendCdp, waitFor, calls,
      submitComposerPrompt, openTeamPanel, saveScreenshot, startApp, stopApp });
  } else if (planningFixture) {
    await planningFixture.runJourney({
      planLead, invoke, evaluate, sendCdp, waitFor, calls, projectPath,
      submitComposerPrompt, openTeamPanel, saveScreenshot, startApp, stopApp,
    });
  } else {
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
  // Presence precedes the Work Panel's width transition. Measure its final layout,
  // otherwise the native selects can be wider than an intermediate entrance frame.
  await waitFor(() => evaluate(`(() => {
    const panel = document.querySelector('[data-testid="work-panel"]');
    return !!panel && panel.getAnimations().every(animation =>
      animation.playState !== 'running' && !animation.pending);
  })()`), "Team panel entrance animation completed before bounds check");
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const reviewBounds = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="launch-review-member-researcher"]');
    const bounds = card.getBoundingClientRect();
    const rectOf = node => node?.getBoundingClientRect().toJSON() ?? null;
    const selects = Array.from(card.querySelectorAll('select')).map(select => {
      const rect = select.getBoundingClientRect();
      const style = getComputedStyle(select);
      return { rect: rect.toJSON(), width: style.width, minWidth: style.minWidth,
        maxWidth: style.maxWidth, boxSizing: style.boxSizing, transform: style.transform,
        fits: rect.left >= bounds.left && rect.right <= bounds.right };
    });
    return { fits: selects.every(select => select.fits) && card.scrollWidth <= card.clientWidth,
      card: { rect: bounds.toJSON(), clientWidth: card.clientWidth, scrollWidth: card.scrollWidth },
      selects, panel: rectOf(document.querySelector('[data-testid="work-panel"]')),
      review: rectOf(document.querySelector('[data-testid="team-launch-review"]')),
      page: { innerWidth, innerHeight, scrollX, scrollY,
        selectedSession: document.querySelector('[data-sidebar-session-row] .thread-item-main[aria-current="page"]')?.closest('[data-sidebar-session-row]')?.getAttribute('data-sidebar-session-row'),
        activeTab: document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id'),
        exiting: document.querySelector('[data-testid="work-panel"]')?.getAttribute('data-exiting') },
      animations: document.getAnimations().map(animation => ({
        state: animation.playState, currentTime: animation.currentTime,
        target: animation.effect?.target?.className ?? null,
        timing: animation.effect?.getComputedTiming(),
      })) };
  })()`);
  console.log("TEAM_REVIEW_BOUNDS", JSON.stringify(reviewBounds));
  assert.equal(reviewBounds.fits, true, "review controls must fit the narrow Team panel");
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

  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button')).find(button => /view panorama/i.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-panorama-canvas]')`), "Team panorama");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`), `team:${lead.id}:panorama`, "panorama opens its own tab");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active .work-panel-tab-button')?.innerText.trim()`), "Team panorama");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active .work-panel-tab-button')?.getAttribute('title')`), "Team panorama", "team tooltip follows its label");
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-panel-tab-id="team:${lead.id}"]').length`), 1, "aggregate tab is retained");

  await waitFor(() => evaluate(`document.querySelector('.agent-panorama-root-node .agent-panorama-node-status')?.innerText.includes('Waiting for team members')`), "settled Lead waiting status");
  await evaluate(`Array.from(document.querySelectorAll('[data-panorama-tool] button')).find((button) => /reset/i.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  await waitFor(() => evaluate(`Number(document.querySelector('[data-panorama-canvas]')?.dataset.panoramaZoom) === 1`), "Reset establishes 100% panorama geometry");
  const panoramaMetrics = await evaluate(`Array.from(document.querySelectorAll('[data-panorama-node]')).map(node => {
    const rect = node.getBoundingClientRect();
    const avatar = node.querySelector('.agent-panorama-node-avatar img').getBoundingClientRect();
    return { width: rect.width, height: rect.height, avatarWidth: avatar.width, avatarHeight: avatar.height };
  })`);
  assert.ok(panoramaMetrics.length >= 2, "panorama geometry needs root and child nodes");
  assert.ok(panoramaMetrics.every(node => Math.abs(node.width - 276) < 1 && Math.abs(node.height - 86) < 1 && Math.abs(node.avatarWidth - 32) < 1 && Math.abs(node.avatarHeight - 32) < 1), `Panorama compact geometry: ${JSON.stringify(panoramaMetrics)}`);
  const toolbarMetrics = await evaluate(`Array.from(document.querySelectorAll('[data-panorama-toolbar] button')).map(button => ({ label: button.getAttribute('aria-label'), text: button.innerText.trim() }))`);
  assert.ok(toolbarMetrics.every(button => button.label && button.text === ''), `panorama toolbar must be icon-only with accessible labels: ${JSON.stringify(toolbarMetrics)}`);
  console.log(`PASS Panorama compact geometry/icons: ${JSON.stringify(panoramaMetrics)}`);
  // Exercise legacy/model-provided text without changing persisted task data.
  const longTextFixture = await evaluate(`(() => {
    const selectors = ['.agent-panorama-node-title', '.agent-panorama-node-task'];
    const results = [];
    const originals = [];
    for (const node of document.querySelectorAll('[data-panorama-node]')) {
      const bounds = node.getBoundingClientRect();
      for (const selector of selectors) {
        const element = node.querySelector(selector);
        if (!element) continue;
        const original = element.textContent;
        originals.push({ node: node.dataset.nodeId, selector, text: original });
        for (const text of ['Recon: workspace state, toolchains, and constraints '.repeat(10), '简洁可维护性方案设计'.repeat(20), 'x'.repeat(500)]) {
          element.textContent = text;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          results.push({ node: node.dataset.nodeId, selector,
            contained: rect.left >= bounds.left && rect.right <= bounds.right,
            truncated: element.scrollWidth > element.clientWidth,
            ellipsis: style.textOverflow === 'ellipsis' && style.overflow === 'hidden',
          });
        }
        element.textContent = selector.endsWith('task')
          ? 'Recon: workspace state, toolchains, and constraints for a new user management system'
          : '调研员 Environment Scout with a very long expert identity';
      }
    }
    return { metrics: results, originals };
  })()`);
  const longTextMetrics = longTextFixture.metrics;
  assert.ok(longTextMetrics.length >= 12, "exercise root and child identity/task text");
  assert.ok(longTextMetrics.every(item => item.contained && item.truncated && item.ellipsis),
    `Long panorama titles must stay within each card: ${JSON.stringify(longTextMetrics)}`);
  console.log(`Long-title evidence: ${await saveScreenshot(sendCdp, "team-panorama-long-titles.png")}`);
  await evaluate(`(${JSON.stringify(longTextFixture.originals)}).forEach(({ node, selector, text }) => {
    document.querySelector('[data-node-id="' + node + '"] ' + selector).textContent = text;
  })`);
  console.log("PASS Panorama long English, Chinese and unbroken titles remain inside root/child cards");
  for (let index = 0; index < 2; index += 1) {
    await evaluate(`Array.from(document.querySelectorAll('[data-panorama-tool] button')).find((button) => /zoom out/i.test(button.getAttribute('aria-label') ?? ''))?.click()`);
  }
  let manualViewport = await panoramaViewport(sendCdp, evaluate);
  assert.equal(manualViewport.zoom, 0.8, "panorama manual zoom should be 80%");
  manualViewport = await refreshWhileDragging(sendCdp, evaluate);
  await evaluate(`document.querySelector('.agent-panorama-node.is-clickable')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-tab"],[data-testid="team-member-tab"]')`), "task/member tab from panorama");
  assert.match(await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`), new RegExp(`^team:${lead.id}:(task|member):`));
  await evaluate(`document.querySelector('[data-work-panel-tab-id="team:${lead.id}:panorama"] .work-panel-tab-button')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-panorama-canvas]')`), "return to panorama tab");
  assert.deepEqual(await panoramaViewport(sendCdp, evaluate), manualViewport, "manual viewport changed after member detail/back");
  const idleMember = activeSnapshot.members.find((item) => item.name === "executor");
  assert.ok(idleMember, "fixture requires a member without assigned tasks");
  await evaluate(`document.querySelector('[data-node-id="${idleMember.memberSessionId}"].is-clickable')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-member-tab"]')`), "member without focus task opens member tab");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`), `team:${lead.id}:member:${idleMember.memberSessionId}`);
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active .work-panel-tab-button')?.innerText.trim()`), "Sam");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active .work-panel-tab-button')?.getAttribute('title')`), "Sam");
  await evaluate(`document.querySelector('[data-work-panel-tab-id="team:${lead.id}:panorama"] .work-panel-tab-button')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-panorama-canvas]')`), "panorama retained after member navigation");
  assert.deepEqual(await panoramaViewport(sendCdp, evaluate), manualViewport, "member navigation must preserve panorama viewport");
  await assertNoPageHorizontalOverflow(sendCdp, evaluate);
  assert.deepEqual(await panoramaViewport(sendCdp, evaluate), manualViewport, "manual viewport changed after resizing");
  console.log("PASS Panorama: 80% zoom, in-flight refresh retains canvas, continuous drag, independent detail/panorama tabs and resize preserve viewport");
  await verifyStalePanoramaRetry(sendCdp, evaluate);
  const waitingImage = await saveScreenshot(sendCdp, "team-panorama-waiting-members.png");

  // Open both live tab surfaces while the local model gate is still held.
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelectorAll('.team-progress-row').length > 0`), "live task entry before member release");
  await evaluate(`document.querySelector('.team-progress-row')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-tab"]')`), "live task tab before member release");
  const liveTaskTabId = await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`);
  const taskHeaderHeight = await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-header').getBoundingClientRect().height`);
  assert.ok(Math.abs(taskHeaderHeight - 60) <= 2, `compact task header: ${taskHeaderHeight}`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="team-task-tab"] textarea,[data-testid="team-task-tab"] .composer').length`), 0);
  await verifyTeamHeaderHitAreas(evaluate, "team-task-tab");
  assert.equal(await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-action[aria-expanded]')?.getAttribute('aria-expanded')`), "false");
  await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-action[aria-expanded]')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-action[aria-expanded]')?.getAttribute('aria-expanded') === 'true' && !!document.querySelector('[data-testid="team-task-tab"] .team-work-tab-brief')`), "task Info opens its brief");
  const brief = await evaluate(`(() => {
    const surface=document.querySelector('[data-testid="team-task-tab"]'), brief=surface.querySelector('.team-work-tab-brief');
    return { description:brief.querySelector('.team-card-desc')?.innerText,
      owner:brief.querySelector('.team-owner-btn')?.innerText,
      scopes:Array.from(brief.querySelectorAll('.team-detail-field-value')).some(field => field.innerText.includes('long-directory-')),
      bounded:brief.scrollWidth<=brief.clientWidth && surface.scrollWidth<=surface.clientWidth && document.documentElement.scrollWidth<=document.documentElement.clientWidth };
  })()`);
  assert.match(brief.description, /Detail for E2E board fixture task/); assert.match(brief.owner, /Researcher Alex/);
  assert.equal(brief.scopes, true); assert.equal(brief.bounded, true, `expanded task brief must wrap long description/scopes: ${JSON.stringify(brief)}`);
  await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-action[aria-expanded]')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-action[aria-expanded]')?.getAttribute('aria-expanded') === 'false' && !document.querySelector('[data-testid="team-task-tab"] .team-work-tab-brief')`), "task Info closes its brief");
  await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-identity')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-member-tab"]')`), "owner opens live member tab");
  assert.equal(await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`), `team:${lead.id}:member:${member.memberSessionId}`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-member-tab"] .team-work-tab-status')?.innerText.includes('Running')`), "member tab reflects running snapshot phase");
  const memberHeaderHeight = await evaluate(`document.querySelector('[data-testid="team-member-tab"] .team-work-tab-header').getBoundingClientRect().height`);
  assert.ok(Math.abs(memberHeaderHeight - 60) <= 2, `compact member header: ${memberHeaderHeight}`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="team-member-tab"] textarea,[data-testid="team-member-tab"] .composer,[data-testid="team-member-tab"] .inline-review-card').length`), 0);
  await verifyTeamHeaderHitAreas(evaluate, "team-member-tab");
  const liveTabCount = await evaluate(`document.querySelectorAll('[data-work-panel-tab-id]').length`);
  await evaluate(`document.querySelector('[data-testid="team-member-tab"] .team-work-tab-task-link')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === ${JSON.stringify(liveTaskTabId)} && !!document.querySelector('[data-testid="team-task-tab"]')`), "member focus title reactivates its stored task tab");
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-panel-tab-id]').length`), liveTabCount, "member focus navigation reuses the task tab");
  await evaluate(`document.querySelector('[data-testid="team-task-tab"] .team-work-tab-identity')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === 'team:${lead.id}:member:${member.memberSessionId}' && !!document.querySelector('[data-testid="team-member-tab"]')`), "owner navigation returns to its stored member tab");
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-panel-tab-id]').length`), liveTabCount, "owner navigation reuses the member tab");
  releaseModelRequest("member");
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-member-tab"]')?.innerText.includes('TEAM_RESULT was sent to Lead.')`), "live final answer appears without reopening", 60_000);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-member-tab"] .team-transcript-tool-item .tool-row') && !!document.querySelector('[data-testid="team-member-tab"] .thinking')`), "live tool and thinking rows without reopening");
  await evaluate(`document.querySelector('[data-testid="team-member-tab"] .thinking:not(.open) button')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-member-tab"]')?.innerText.includes('TEAM_MEMBER_THINKING')`), "thinking disclosure shows real reasoning text");
  // message_end is visible before agent_end; keep fault injection away from
  // the member's shutdown and the Lead's queued mailbox/context work.
  await waitFor(async () => {
    const snapshot = await invoke("teamGetSnapshot", { teamSessionId: lead.id });
    if (snapshot.leadPhase === "running" || snapshot.queuedMessageCount !== 0 ||
      snapshot.members.some((item) => item.phase === "running" || item.phase === "provisioning")) return false;
    const statuses = await Promise.all([lead.id, ...snapshot.members.map((item) => item.memberSessionId)]
      .map((sessionId) => invoke("agentGetStatus", sessionId)));
    return statuses.every((result) => result.status?.isRunning === false);
  }, "all Team actors and mailbox settled before snapshot fault injection", 60_000);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-member-tab"] .team-work-tab-status[data-phase="completed"] > svg')`), "member tab reflects completed snapshot phase");
  await assertTeamSuccessGlyph(evaluate, '[data-testid="team-member-tab"] .team-work-tab-status > svg', "member");
  await verifyStaleTeamTabRetry(evaluate, "team-member-tab");
  await evaluate(`document.querySelector('[data-work-panel-tab-id="${liveTaskTabId}"] .work-panel-tab-button')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-task-tab"]')?.innerText.includes('TEAM_RESULT was sent to Lead.')`), "retained task tab receives final transcript");
  await verifyStaleTeamTabRetry(evaluate, "team-task-tab");
  console.log(`PASS Live Team task/member tabs: running→thinking/tool/final without reopening; headers ${taskHeaderHeight}/${memberHeaderHeight}px; no composer/rollback`);

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
  researcherSessionId = teamRoster.members.find(item => item.name === "researcher")?.memberSessionId;
  assert.ok(researcherSessionId);
  const board = await invoke("teamGetBoard", { teamSessionId: lead.id });
  assert.equal(board.teamSessionId, lead.id);
  boardTaskId = board.tasks[0]?.taskId;
  assert.ok(boardTaskId, "board fixture task id was not initialized");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "Lead idle before task completion fixture");
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.completed === '0' && document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.total === '6'`), "Overview baseline before live task mutation");
  await invoke("agentPrompt", { sessionId: lead.id, viewingSessionId: lead.id, content: "Mark the board fixture task completed." });
  await approveExpertReview(invoke, evaluate, lead.id);
  await waitFor(() => modelGates.taskUpdate.entered, "task update held after Host mutation");
  const updatedBoard = await invoke("teamGetBoard", { teamSessionId: lead.id });
  assert.equal(updatedBoard.tasks.find((task) => task.taskId === boardTaskId)?.status, "completed", "completed board fixture did not persist");
  await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.completed === '1' && document.querySelector('[data-testid="overview-team-progress"] section.team-progress')?.dataset.total === '6'`), "mounted Overview refreshes before the running turn settles");
  releaseModelRequest("taskUpdate");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "Lead settled after task completion fixture");
  await evaluate(`document.querySelector('[data-work-panel-tab-id="${liveTaskTabId}"] .work-panel-tab-button')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-tab"] .team-task-glyph[data-state="completed"] svg')`), "stored task tab reflects completed snapshot state");
  await assertTeamSuccessGlyph(evaluate, '[data-testid="team-task-tab"] .team-task-glyph[data-state="completed"] svg', "task");
  await activateOverviewTab(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelectorAll('[data-testid="overview-team-progress"] .team-progress-row').length === 5`), "five compact Overview task rows");
  assert.match(await evaluate(`document.querySelector('[data-testid="overview-tab"]')?.innerText ?? ''`), /researcher|Alex/i, "Overview should expose the Team task/member summary");
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-row')?.click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-task-tab"]')`), "Overview opens independent task tab");
  const taskTabId = await evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id')`);
  assert.match(taskTabId, new RegExp(`^team:${lead.id}:task:`));
  assert.equal(await evaluate(`(() => { const button=document.querySelector('[data-work-panel-tab-id].active .work-panel-tab-button'); return button.getAttribute('title') === button.innerText.trim(); })()`), true, "task tooltip equals its captured label");

  const tabCount = await evaluate(`document.querySelectorAll('[data-work-panel-tab-id]').length`);
  await activateOverviewTab(sendCdp, evaluate);
  await evaluate(`document.querySelector('[data-testid="overview-team-progress"] .team-progress-row')?.click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === ${JSON.stringify(taskTabId)}`), "re-clicking task reactivates its existing tab");
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-panel-tab-id]').length`), tabCount, "reopening task must not duplicate tabs");
  assert.equal(await evaluate(`document.querySelectorAll('[data-work-panel-tab-id="team:${lead.id}"]').length`), 1, "task navigation retains aggregate tab");
  await activateOverviewTab(sendCdp, evaluate);
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
  const queueReviewId = await approveExpertReview(invoke, evaluate, lead.id);
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
  await waitFor(async () => {
    const entries = (await invoke("agentQueueList", { sessionId: lead.id })).entries;
    return entries.some(entry => entry.content === "Queue fixture prompt 1" && entry.priority === 1);
  }, "Send Now promotes the durable queued task");
  await waitFor(async () => (await invoke("teamGetRoster", { teamSessionId: lead.id })).paused, "Send Now graceful Stop pauses the Team");
  releaseModelRequest("queue");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "held Team turn settles before Resume");
  const pausedQueue = (await invoke("agentQueueList", { sessionId: lead.id })).entries;
  assert.ok(pausedQueue.some(entry => entry.content === "Queue fixture prompt 1" && entry.priority === 1), "paused Team consumed the promoted task");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button')).some(button => /resume/i.test(button.innerText))`), "Team Resume after Send Now Stop");
  await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-panel"] .team-panel-actions button')).find(button => /resume/i.test(button.innerText)).click()`);
  await waitFor(async () => !(await invoke("teamGetRoster", { teamSessionId: lead.id })).paused, "Team resumed before queued task approval");
  await approveExpertReview(invoke, evaluate, lead.id, queueReviewId);
  await waitFor(() => calls.some(call => call.userText.includes('Queue fixture prompt 1') && call.triggerText?.includes('E2E_LIGHT_RESULT') && call.tool === null), "queue Send Now integrates the assigned expert result");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "queue execution settled");
  await waitFor(() => evaluate(`!document.querySelector('.composer-queue-heading')`), "empty queue disclosure removed");
  console.log("PASS Team queue user path: eight rows, scoped folding, move/remove/edit, promoted Send Now pauses, Resume starts fresh expert approval");
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
  assert.match(teamPanelText, /Researcher Alex/);
  assert.equal((await invoke("teamGetRoster", { teamSessionId: lead.id })).members
    .find((item) => item.memberSessionId === member.memberSessionId)?.name, "researcher",
  "localized display identity must not rename the routing handle");
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
  await waitFor(async () => { const result = await invoke("agentGetStatus", lead.id); assert.equal(typeof result.status?.isRunning, "boolean"); return result.status.isRunning === false; }, "Lead idle for bounded expert turn");
  await invoke("agentPrompt", {sessionId: lead.id, viewingSessionId: lead.id, content: "Handle the bounded check with the existing expert."});
  await approveExpertReview(invoke, evaluate, lead.id);
  await waitFor(async () => (await invoke("teamGetExecutionDecision", {teamSessionId: lead.id})).decision?.strategy === "delegate", "latest forced expert decision");
  await openTeamPanel(sendCdp, evaluate);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="team-panel"]')?.innerText.includes('An approved researcher must inspect this bounded check.')`), "expert delegation reason visible");
  await waitFor(() => calls.some(call => call.userText.includes('Handle the bounded check with the existing expert') && call.triggerText?.includes('E2E_LIGHT_RESULT') && call.tool === null), "bounded task integrates the actual expert contribution");
  await waitFor(async () => (await invoke("agentGetStatus", lead.id)).status?.isRunning === false, "bounded expert-backed Lead turn settled");
  await waitFor(async () => (await invoke("agentGetStatus", researcherSessionId)).status?.isRunning === false, "bounded assigned expert settled");
  assert.equal((await invoke("teamGetRoster", {teamSessionId: lead.id})).members.length, 5);
  console.log("PASS Team strategy: delegation remains mandatory and reuses the approved expert without duplicating members");

  socket.close();
  socket = null;
  await stopApp();
  await host.start();
  const pauseResult = await host.call("team.pause", {
    teamSessionId: lead.id,
    callerSessionId: lead.id,
  });
  assert.equal(pauseResult.team.paused, true);
  // Seed paused mail from an already approved expert. An idle Lead has no
  // running user-approved turn and must not bypass the strategy gate via RPC.
  const pausedSender = teamRoster.members.find(item => item.name === "reviewer");
  assert.ok(pausedSender?.memberSessionId, "paused mailbox fixture needs an approved peer");
  const queued = await host.call("team.sendMessage", {
    teamSessionId: lead.id,
    callerSessionId: pausedSender.memberSessionId,
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
  }
} catch (error) {
  if (socket?.readyState === 1 && lastSendCdp) {
    try { console.error(`Failure image: ${await saveScreenshot(lastSendCdp, "team-failure.png")}`); } catch {}
  }
  console.error("Fixture calls", JSON.stringify(calls));
  console.error("Title diagnostics", JSON.stringify(titleDiagnostics));
  console.error(appOutput?.slice(-4000));
  throw error;
} finally {
  planningFixture?.releaseResearch();
  forcedFixture?.release();
  signalInitialExpertStart?.();
  signalLightExpertStart?.();
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
