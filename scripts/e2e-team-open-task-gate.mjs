#!/usr/bin/env node
// Real Host and DesktopAgentRuntime; only the loopback model is scripted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAgentRuntime } from "../packages/agent-runtime/dist/runtime.js";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { resolvePlan } from "./e2e/plan.mjs";
import { candidateIdentity } from "./e2e-suite-runtime.mjs";

const scenario = "E2E-TEAM-open-tasks-block-final-answer";
const root = await mkdtemp(join(tmpdir(), "pi-team-open-task-gate-"));
const workspace = join(root, "workspace"), dataDir = join(root, "data"), fixtureHome = join(root, "home");
await Promise.all([workspace, dataDir, fixtureHome].map(path => mkdir(path, { recursive: true })));
const originalHome = process.env.HOME;
process.env.HOME = fixtureHome;
const binary = resolveHostBinary();
const identity = await candidateIdentity();
const evidence = { scenario, candidate: { ...identity, remoteMain: identity.baseMain,
  baseMain: execFileSync("git", ["rev-parse", "main"], { encoding: "utf8" }).trim() },
  hostBinarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
  environment: "temporary profile; real Host/Runtime; loopback scripted provider; no Electron/UI", timeline: [] };
const record = (stage, details = {}) => {
  evidence.timeline.push({ stage, ...details });
  if (process.env.DEBUG_TEAM_OPEN_TASK_GATE) console.error(stage, details);
};
let host, lead, provider, execution, leadTurn, serverError, leadStep = 0, memberStep = 0;
const runtimes = [], notices = [], events = [], authorizations = [], updates = [];
const tasks = new Map();
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const member = JSON.stringify(request.messages).includes("FIXTURE_CORE_SILENT");
    const step = member ? ++memberStep : ++leadStep;
    record("provider-request", { member, step });
    let text, tool;
    if (member) {
      assert.equal(step, 1, "Silent member must not retry, send mail, or edit");
      text = "Searching";
    } else {
      assert.ok(step <= 7, "Lead recovery must remain bounded");
      if (step === 1) text = "Searching";
      else if (step === 2) {
        const recovery = JSON.stringify(request.messages);
        for (const [name, task] of tasks) {
          assert.ok(recovery.includes(name) && recovery.includes(task.taskId), "Nudge must identify every open owned task");
        }
        assert.ok(recovery.includes("TEAM_APPROVAL_REQUIRED") && recovery.includes("task_update"));
        tool = closeTask("core_dev", "cancelled", "No implementation was produced; stop this attempt honestly.");
      } else if (step === 3) tool = closeTask("ui_dev", "failed", "This UI work was never dispatched or completed.");
      else if (step === 4) tool = closeTask("qa_engineer", "cancelled", "Validation was never dispatched; no validation evidence exists.");
      else if (step === 5) {
        const board = await host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id });
        assert.ok(board.tasks.every(task => ["completed", "failed", "cancelled"].includes(task.status)));
        assert.equal(authorizations.filter(item => item.toolName === "TeamFinalAnswer" && item.error).length, 1);
        text = "Open work is now explicitly closed; the expert notice is still unread.";
      } else if (step === 6) {
        assert.equal(authorizations.filter(item => item.toolName === "TeamFinalAnswer" && item.error).length, 2,
          "An unread silent-completion notice must block the second text final");
        assert.ok(JSON.stringify(request.messages).includes("wait_for_updates"));
        tool = { name: "wait_for_updates", args: { timeoutSeconds: 1 } };
      } else {
        const results = request.messages.filter(message => message.role === "tool");
        const bodies = JSON.stringify(results);
        assert.ok(bodies.includes("member_ended_without_report") && bodies.includes("core_dev"),
          "Lead must receive the full Host notice through the actual wait tool");
        text = "The silent expert notice was consumed. No implementation or validation succeeded; all assigned tasks are explicitly cancelled or failed.";
      }
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (delta, finishReason) => res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "completion-fixture",
      choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    emit(tool ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
      function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: text }, null);
    emit({}, tool ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  } catch (error) {
    serverError = error;
    record("provider-fixture-error", { error: error.message });
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error));
  }
});
function closeTask(name, status, description) {
  const task = tasks.get(name);
  return { name: "task_update", args: { taskId: task.taskId, expectedRevision: task.revision, status, description } };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(serverError ?? new Error(`${label} exceeded 30 seconds`)), 30000);
    })]);
  } finally { clearTimeout(timer); }
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  host = new HostProcess({ binaryPath: binary, dataDir, env: { HOME: fixtureHome }, onStderr: text => {
    if (process.env.DEBUG_TEAM_OPEN_TASK_GATE) process.stderr.write(text);
  } });
  host.onNotification((method, params) => notices.push({ method, params }));
  await host.call("app.handshake", { protocolVersion: 11 });
  await host.call("workspace.set", { path: workspace });
  ({ provider } = await host.call("providers.create", { name: "Completion fixture", vendorKey: "custom", authKind: "none",
    apiStyle: "chat_completions", baseUrl, defaultModelId: "completion-fixture", models: [{ id: "completion-fixture", thinkingLevels: ["off"] }] }));
  ({ session: lead } = await host.call("session.create", { mode: "agent", executionProfile: "standard", projectPath: workspace,
    providerId: provider.id, modelId: "completion-fixture", permissionMode: "auto", thinkingLevel: "off" }));
  ({ turnId: leadTurn } = await host.call("session.beginTurn", { sessionId: lead.id }));
  await host.call("plans.enter", { sessionId: lead.id, turnId: leadTurn, toolCallId: "enter", requestedMode: "agent" });
  const { proposal } = await host.call("plans.submit", { sessionId: lead.id, turnId: leadTurn, toolCallId: "submit",
    title: "FIXTURE_TEAM_OPEN_TASK_GATE", markdown: "# Completion gate\n\nReport honestly when implementation and validation remain undone.\n", question: "Approve fixture?" });
  await host.call("session.endTurn", { turnId: leadTurn, status: "completed", createNotification: false });
  ({ execution } = await resolvePlan(host, proposal, "approve", "auto"));
  await host.call("session.configure", { id: lead.id, mode: "agent", executionProfile: "team", permissionMode: "auto" });
  ({ turnId: leadTurn } = await host.call("session.beginTurn", { sessionId: lead.id }));
  await host.call("plans.claimExecution", { executionId: execution.id });
  await host.call("plans.bindExecutionTurn", { executionId: execution.id, sessionId: lead.id, turnId: leadTurn });
  const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: leadTurn,
    strategy: "delegate", reason: "Reproduce silent member with undispatched owned tasks", members: ["core_dev", "ui_dev", "qa_engineer"].map(name => ({ name, contextKind: "fresh" })) });
  const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
  await host.call("team.readExecutionInbox", { teamSessionId: lead.id, callerSessionId: lead.id, expectedTurnId: leadTurn });
  for (const name of ["core_dev", "ui_dev", "qa_engineer"]) {
    const { task } = await host.call("team.createTask", { teamSessionId: lead.id, callerSessionId: lead.id,
      taskId: `incident-${name}`, subject: `Incident ${name} work`, ownerMemberName: name });
    tasks.set(name, task);
  }
  const { message } = await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: lead.id,
    target: "core_dev", content: "FIXTURE_CORE_SILENT", taskDispatch: { taskId: tasks.get("core_dev").taskId, expectedRevision: tasks.get("core_dev").revision } });
  const coreId = decision.memberSessionIds[0];
  const { turnId: coreTurn } = await host.call("session.beginTurn", { sessionId: coreId, sessionMessageId: message.id });
  const { task: coreTask } = await host.call("team.updateTask", { teamSessionId: lead.id, callerSessionId: coreId,
    taskId: tasks.get("core_dev").taskId, expectedRevision: tasks.get("core_dev").revision, status: "in_progress", expectedCallerTurnId: coreTurn });
  tasks.set("core_dev", coreTask);
  const runtimeHost = {
    onNotification: listener => host.onNotification(listener),
    async call(method, params) {
      const authorization = method === "team.authorizeLeadTool" ? { toolName: params.toolName } : undefined;
      if (authorization) authorizations.push(authorization);
      try {
        const result = await host.call(method, params);
        if (authorization) authorization.authorized = result.authorized;
        if (method === "team.updateTask") updates.push({ params, task: result.task });
        record("rpc", { method, toolName: params?.toolName, taskId: params?.taskId });
        return result;
      } catch (error) {
        if (authorization) authorization.error = error.message;
        record("rpc-error", { method, toolName: params?.toolName, error: error.message });
        throw error;
      }
    },
  };
  async function runtimeFor(sessionId) {
    const teamContext = await host.call("team.getRuntimeContext", { sessionId });
    const runtime = new DesktopAgentRuntime({ host: runtimeHost, sessionId, mode: "agent", executionProfile: "team", teamContext,
      projectPath: workspace, thinkingLevel: "off", commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      provider: { id: provider.id, name: "Fixture", modelId: "completion-fixture", baseUrl, apiKey: "", authKind: "none",
        apiStyle: "chat_completions", supportsReasoning: false, supportedThinkingLevels: ["off"],
        modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
      onEvent(envelope) { events.push(envelope); record("runtime-event", { sessionId, type: envelope.event.type }); } });
    runtimes.push(runtime);
    return runtime;
  }
  const coreRuntime = await runtimeFor(coreId);
  await bounded(coreRuntime.prompt("FIXTURE_CORE_SILENT", `user-${coreTurn}`, coreTurn), "silent member runtime");
  assert.equal(memberStep, 1);
  assert.ok(events.some(item => item.sessionId === coreId && item.event.type === "message_end" && item.event.message.content === "Searching"));
  await host.call("session.endTurn", { turnId: coreTurn, status: "completed", createNotification: false });
  await host.call("session.collaboration.settle", { turnId: coreTurn });
  const queued = notices.filter(note => note.method === "team.messageQueued" && note.params.teamSessionId === lead.id);
  const silentNotices = [];
  for (const note of queued) {
    const { message: notice } = await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: lead.id, messageId: note.params.messageId });
    if (notice.targetSessionId === lead.id && notice.content.startsWith("{") && JSON.parse(notice.content).kind === "member_ended_without_report") silentNotices.push(notice);
  }
  assert.equal(silentNotices.length, 1, "Silent completed member must produce exactly one Host notice");
  for (const toolName of ["TeamFinalAnswer", "SubmitGoalReport"]) {
    await assert.rejects(host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id, toolName }), error => {
      assert.ok(error.message.includes("TEAM_APPROVAL_REQUIRED"));
      for (const [name, task] of tasks) assert.ok(error.message.includes(name) && error.message.includes(task.taskId));
      assert.ok(error.message.includes("send_message") && error.message.includes("task_update") && error.message.includes("wait_for_updates"));
      return true;
    });
  }
  const leadRuntime = await runtimeFor(lead.id);
  await bounded(leadRuntime.executeApprovedPlan(execution, leadTurn), "Lead completion recovery");
  assert.ifError(serverError);
  assert.equal(leadStep, 7);
  assert.equal(updates.length, 3, "Each task must close through its actual runtime task_update tool");
  assert.ok(updates.every(update => update.params.callerSessionId === lead.id && update.params.expectedCallerTurnId === leadTurn && update.params.description));
  const finals = authorizations.filter(item => item.toolName === "TeamFinalAnswer");
  assert.equal(finals.length, 3);
  assert.equal(finals.filter(item => item.error).length, 2);
  assert.equal(finals.at(-1).authorized, true);
  assert.equal(events.filter(item => item.sessionId === lead.id && item.event.type === "error").length, 0);
  assert.equal(events.filter(item => item.sessionId === lead.id && item.event.type === "agent_end").length, 1,
    "Recovered text finals must not end the durable Lead turn early");
  assert.equal((await host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id, toolName: "SubmitGoalReport" })).authorized, true);
  const board = await host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id });
  assert.deepEqual(board.tasks.map(task => task.status).sort(), ["cancelled", "cancelled", "failed"]);
  // This existing fixture is an approved Plan. Goal incident exhaustion is
  // covered by E2E-GOAL-BLOCKED-003; the Plan completion contract stays intact.
  await host.call("session.endTurn", { turnId: leadTurn, status: "completed", createNotification: false });
  await host.call("plans.finishExecution", { executionId: execution.id, status: "completed" });
  const history = await host.call("plans.pending", { sessionId: lead.id });
  assert.equal(history.history.find(proposal => proposal.executionId === execution.id).executionState, "completed");
  assert.equal((await host.call("goalReports.list", { sessionId: lead.id })).reports.length, 0);
  console.log(`PASS ${scenario}: text final rejected, Lead task_update closes undispatched tasks, unread silent notice rejected, wait_for_updates consumes, final/report authorized`);
  console.log(JSON.stringify(evidence));
} finally {
  await Promise.allSettled(runtimes.map(runtime => runtime.dispose()));
  await host?.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(root, { recursive: true, force: true });
}
