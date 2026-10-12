#!/usr/bin/env node
// Real Host, runtime and Pi transport; only the loopback provider is scripted.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopAgentRuntime } from "../packages/agent-runtime/dist/runtime.js";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { resolvePlan } from "./e2e/plan.mjs";
import { candidateIdentity } from "./e2e-suite-runtime.mjs";

const scenario = "E2E-TEAM-lead-pseudo-tool-call-retried-once";
const root = await mkdtemp(join(tmpdir(), "pi-team-pseudo-tool-call-"));
const workspace = join(root, "workspace"), dataDir = join(root, "data"), fixtureHome = join(root, "home");
await Promise.all([workspace, dataDir, fixtureHome].map(path => mkdir(path, { recursive: true })));
const originalHome = process.env.HOME;
process.env.HOME = fixtureHome;
const binary = resolveHostBinary();
const candidate = await candidateIdentity();
candidate.remoteMain = candidate.baseMain;
candidate.baseMain = execFileSync("git", ["rev-parse", "main"], { encoding: "utf8" }).trim();
const evidence = { scenario, candidate,
  hostBinarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
  runtimeSha256: createHash("sha256").update(await readFile(new URL("../packages/agent-runtime/dist/runtime.js", import.meta.url))).digest("hex"),
  environment: "temporary profile; real Host/Runtime/Pi transport; loopback scripted provider; no Electron/UI", cases: [] };
const pseudo = "...!call:default_api:ProjectHistory{action:search,query:只要有 remote_file_id}";
let host, fixture, serverError, hostPid;
const runtimes = [];
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.ok(JSON.stringify(request.messages).includes(`FIXTURE_PSEUDO_${fixture.kind}`));
    fixture.requests.push(request);
    const step = fixture.requests.length;
    assert.ok(step <= (fixture.kind === "invoke" ? 3 : fixture.kind === "repeat" ? 2 : 1), "Recovery must stay bounded");
    let text = "The approved expert completed the fixture work.", tool;
    if (fixture.kind !== "normal" && step === 1) text = pseudo;
    if (fixture.kind !== "normal" && step === 2) {
      assert.ok(JSON.stringify(request.messages).includes("<pseudo_tool_call_recovery>"));
      assert.ok(JSON.stringify(request.messages).includes("tool-calling interface"));
      assert.equal(fixture.authorizations.length, 0, "First pseudo call must recover before Host final authorization");
      if (fixture.kind === "repeat") text = pseudo;
      else tool = { name: "task_get", args: { taskId: fixture.task.taskId } };
    }
    if (fixture.kind === "invoke" && step === 3) {
      assert.ok(JSON.stringify(request.messages.filter(message => message.role === "tool")).includes(fixture.task.taskId),
        "The actual task_get result must reach the model");
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (delta, finishReason) => res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "pseudo-fixture",
      choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    emit(tool ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
      function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: text }, null);
    emit({}, tool ? "tool_calls" : "stop");
    res.end("data: [DONE]\n\n");
  } catch (error) {
    serverError = error;
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error));
  }
});

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Pseudo tool call scenario exceeded 30 seconds")), 30000);
    })]);
  } finally { clearTimeout(timer); }
}

try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  host = new HostProcess({ binaryPath: binary, dataDir, env: { HOME: fixtureHome }, onStderr: text => {
    if (process.env.DEBUG_TEAM_PSEUDO_CALL) process.stderr.write(text);
  } });
  hostPid = host.child.pid;
  await host.call("app.handshake", { protocolVersion: 11 });
  await host.call("workspace.set", { path: workspace });
  const { provider } = await host.call("providers.create", { name: "Pseudo call fixture", vendorKey: "custom", authKind: "none",
    apiStyle: "chat_completions", baseUrl, defaultModelId: "pseudo-fixture", models: [{ id: "pseudo-fixture", thinkingLevels: ["off"] }] });
  for (const kind of ["repeat", "invoke", "normal"]) {
    fixture = { kind, requests: [], authorizations: [], events: [], task: undefined };
    // Negotiate a normal Plan first, then select Team for its execution. This
    // fixture exercises execution recovery without inventing Plan research proof.
    const { session: lead } = await host.call("session.create", { mode: "agent", executionProfile: "standard", projectPath: workspace,
      providerId: provider.id, modelId: "pseudo-fixture", permissionMode: "auto", thinkingLevel: "off" });
    const { turnId: planningTurn } = await host.call("session.beginTurn", { sessionId: lead.id });
    await host.call("plans.enter", { sessionId: lead.id, turnId: planningTurn, toolCallId: `enter-${kind}`, requestedMode: "agent" });
    const { proposal } = await host.call("plans.submit", { sessionId: lead.id, turnId: planningTurn, toolCallId: `submit-${kind}`,
      title: `FIXTURE_PSEUDO_${kind}`, markdown: `# FIXTURE_PSEUDO_${kind}\n\nInspect the expert's completed fixture task.`, question: "Approve fixture?" });
    const { execution } = await resolvePlan(host, proposal, "approve", "auto");
    await host.call("session.endTurn", { turnId: planningTurn, status: "completed", createNotification: false });
    await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto", executionProfile: "team" });
    const { turnId } = await host.call("session.beginTurn", { sessionId: lead.id });
    await host.call("plans.claimExecution", { executionId: execution.id });
    await host.call("plans.bindExecutionTurn", { executionId: execution.id, sessionId: lead.id, turnId });
    const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: turnId,
      strategy: "delegate", reason: "Verify pseudo call completion handling", members: [{ name: "expert", contextKind: "fresh" }] });
    const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
    const member = decision.memberSessionIds[0];
    const { task } = await host.call("team.createTask", { teamSessionId: lead.id, callerSessionId: lead.id,
      subject: "Inspect fixture", ownerMemberName: "expert" });
    fixture.task = task;
    const { message } = await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: lead.id,
      target: "expert", content: "Inspect fixture work", taskDispatch: { taskId: task.taskId, expectedRevision: task.revision } });
    const { turnId: memberTurn } = await host.call("session.beginTurn", { sessionId: member, sessionMessageId: message.id });
    await host.call("team.updateTask", { teamSessionId: lead.id, callerSessionId: member, expectedCallerTurnId: memberTurn,
      taskId: task.taskId, expectedRevision: task.revision, status: "completed" });
    await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: member, target: "Lead", content: "Fixture inspection completed." });
    await host.call("session.endTurn", { turnId: memberTurn, status: "completed", createNotification: false });
    await host.call("session.collaboration.settle", { turnId: memberTurn });
    await host.call("team.readExecutionInbox", { teamSessionId: lead.id, callerSessionId: lead.id, expectedTurnId: turnId });
    const runtimeHost = { onNotification: listener => host.onNotification(listener), async call(method, params) {
      const result = await host.call(method, params);
      if (method === "team.authorizeLeadTool" && params.toolName === "TeamFinalAnswer") fixture.authorizations.push(result);
      return result;
    } };
    const teamContext = await host.call("team.getRuntimeContext", { sessionId: lead.id });
    const runtime = new DesktopAgentRuntime({ host: runtimeHost, sessionId: lead.id, mode: "agent", executionProfile: "team", teamContext,
      projectPath: workspace, thinkingLevel: "off", commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      provider: { id: provider.id, name: "Fixture", modelId: "pseudo-fixture", baseUrl, apiKey: "", authKind: "none",
        apiStyle: "chat_completions", supportsReasoning: false, supportedThinkingLevels: ["off"],
        modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
      onEvent: envelope => fixture.events.push(envelope.event) });
    runtimes.push(runtime);
    await bounded(runtime.executeApprovedPlan(execution, turnId));
    assert.ifError(serverError);
    assert.equal(fixture.requests.length, kind === "invoke" ? 3 : kind === "repeat" ? 2 : 1);
    assert.equal(fixture.authorizations.length, 1);
    assert.equal(fixture.authorizations[0].authorized, true);
    assert.equal(fixture.events.filter(event => event.type === "agent_end").length, 1);
    assert.equal(fixture.events.filter(event => event.type === "error").length, 0);
    const toolEnds = fixture.events.filter(event => event.type === "tool_end");
    assert.equal(toolEnds.length, kind === "invoke" ? 1 : 0);
    if (kind === "invoke") assert.equal(fixture.events.find(event => event.type === "tool_start").toolName, "task_get");
    assert.equal(fixture.events.filter(event => event.type === "message_end" && event.message.status === "complete").length,
      kind === "invoke" ? 2 : 1);
    evidence.cases.push({ kind, providerRequests: fixture.requests.length, pseudoCallRetries: kind === "normal" ? 0 : 1,
      hostFinalAuthorizations: 1, realToolCalls: toolEnds.length, turnId, result: "PASS" });
    await runtime.dispose();
    await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
  }
} finally {
  await Promise.allSettled(runtimes.map(runtime => runtime.dispose()));
  await host?.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(root, { recursive: true, force: true });
}
assert.equal(existsSync(root), false);
assert.equal(server.listening, false);
assert.throws(() => process.kill(hostPid, 0), error => error.code === "ESRCH");
evidence.cleanup = { temporaryRootRemoved: true, providerServerClosed: true, hostProcessExited: true };
console.log(`PASS ${scenario}: one retry before authorization, repeat passes through Host gate, actual tool interface works, terminal normal run unchanged`);
console.log(JSON.stringify(evidence));
