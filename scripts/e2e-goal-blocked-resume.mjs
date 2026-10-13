#!/usr/bin/env node
/** Isolated real Host + DesktopAgentRuntime + Pi transport. Only the model is scripted.
 * A/B/C/D/E/F/G native lifecycle coverage. Renderer/Main wiring has separate gates.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopAgentRuntime } from "../packages/agent-runtime/dist/runtime.js";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { resolvePlan } from "./e2e/plan.mjs";
import { candidateIdentity } from "./e2e-suite-runtime.mjs";
import { validateGoalReport } from "../packages/shared/dist/goal-report.js";

const root = await mkdtemp(join(tmpdir(), "pi-goal-blocked-resume-"));
const workspace = join(root, "workspace"), dataDir = join(root, "data"), fixtureHome = join(root, "home");
await Promise.all([workspace, dataDir, fixtureHome].map(path => mkdir(path, { recursive: true })));
const originalHome = process.env.HOME;
process.env.HOME = fixtureHome;
const binary = resolveHostBinary();
const evidence = { candidate: await candidateIdentity(), hostBinarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
  runtimeSha256: createHash("sha256").update(await readFile(new URL("../packages/agent-runtime/dist/runtime.js", import.meta.url))).digest("hex"),
  environment: "temporary HOME/data/workspace; real Host/Runtime/AgentSidecar/Pi transport; loopback provider; no user profile, real provider or Desktop", cases: [] };
const pseudo = "...!call:default_api:ProjectHistory{action:search,query:只要有 remote_file_id}";
const supplement = "48 拼写表不存在，停止搜索，ui_dev 与 qa 并行";
const items = Array.from({ length: 5 }, (_, index) => ({ id: `M${index}`, label: `Milestone ${index}`, status: index === 0 ? "completed" : "pending" }));
const tool = (name, args) => ({ name, args });
const metReport = { verdict: "met", summary: "Verified every approved criterion after the clarification.",
  criteria: [{ id: "checks", text: "Verify all milestones", verdict: "met", explanation: "All five persisted milestones and the local fixture check passed." }],
  steps: items.map(item => ({ id: item.id, title: item.label, status: "completed" })),
  checks: [{ id: "fixture", command: "fixture acceptance check", result: "passed", detail: "Deterministic local fixture passed." }], limitations: [], nextSteps: [] };
let host, sidecar, provider, baseUrl, fixture, fixtureError;
const runtimes = new Set(), notices = [], persistence = [];
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/chat/completions");
    let body = ""; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    fixture.requests.push(request);
    const step = fixture.requests.length;
    assert.ok(step <= 20, "Fixture/runtime must remain bounded");
    const response = await fixture.respond(request, step);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (delta, finishReason) => res.write(`data: ${JSON.stringify({ id: randomUUID(), model: request.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    emit(typeof response === "string" ? { role: "assistant", content: response } : { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
      function: { name: response.name, arguments: JSON.stringify(response.args) } }] }, null);
    emit({}, typeof response === "string" ? "stop" : "tool_calls"); res.end("data: [DONE]\n\n");
  } catch (error) { fixtureError = error; if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
});
async function boot(selectedBinary = binary) {
  host = new HostProcess({ binaryPath: selectedBinary, dataDir, env: { HOME: fixtureHome }, onStderr: text => {
    if (process.env.DEBUG_GOAL_BLOCKED) process.stderr.write(text);
  } });
  host.onNotification((method, params) => notices.push({ method, params }));
  await host.call("app.handshake", { protocolVersion: 11 });
  await host.call("workspace.set", { path: workspace });
}
async function approve(session, title, kind = "goal", claim = true, team = false) {
  const { turnId: planningTurn } = await host.call("session.beginTurn", { sessionId: session.id });
  await host.call("plans.enter", { sessionId: session.id, turnId: planningTurn, toolCallId: randomUUID(), requestedMode: kind === "goal" ? "goal" : "agent", kind });
  const { proposal } = await host.call("plans.submit", { sessionId: session.id, turnId: planningTurn, toolCallId: randomUUID(), kind,
    title, markdown: `# ${title}\n\nVerify all milestones. Preserve this immutable contract.`, question: "Approve local fixture?" });
  await host.call("session.endTurn", { turnId: planningTurn, status: "completed", createNotification: false });
  const { execution } = await resolvePlan(host, proposal, "approve", "auto");
  if (!claim) return execution;
  if (team) await host.call("session.configure", { id: session.id, executionProfile: "team", mode: "agent", permissionMode: "auto" });
  const claimed = await host.call("plans.claimExecution", { executionId: execution.id });
  const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
  await host.call(kind === "goal" ? "goalReports.bindExecutionTurn" : "plans.bindExecutionTurn", { executionId: execution.id, sessionId: session.id, turnId });
  return { execution: claimed.execution, turnId };
}
async function goal(title, team = false) {
  const { session } = await host.call("session.create", { title, mode: "agent", projectPath: workspace, executionProfile: "standard",
    providerId: provider.id, modelId: "fixture", permissionMode: "auto", thinkingLevel: "off" });
  return { session, ...await approve(session, title, "goal", true, team) };
}
function configureFixture(respond) { fixture = { requests: [], events: [], calls: [], respond }; fixtureError = undefined; }
async function runtimeFor(session, team = false, modelId = "fixture") {
  const runtimeHost = { onNotification: listener => host.onNotification(listener), async call(method, params) {
    const call = { method, params }; fixture.calls.push(call);
    try { const result = await host.call(method, params); call.result = result; return result; }
    catch (error) { call.error = error.message; throw error; }
  } };
  const runtime = new DesktopAgentRuntime({ host: runtimeHost, sessionId: session.id, mode: "agent", executionProfile: team ? "team" : "standard",
    ...(team ? { teamContext: await host.call("team.getRuntimeContext", { sessionId: session.id }) } : {}), projectPath: workspace, thinkingLevel: "off",
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    provider: { id: provider.id, name: "Fixture", modelId, baseUrl, apiKey: "", authKind: "none", apiStyle: "chat_completions",
      supportsReasoning: false, supportedThinkingLevels: ["off"], modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
    onEvent(envelope) {
      fixture.events.push(envelope.event);
      if (envelope.event.type === "message_end") persistence.push(host.call("session.appendMessage", {
        sessionId: session.id, turnId: envelope.turnId, message: envelope.event.message,
      }));
    } });
  runtimes.add(runtime); return runtime;
}
async function run(runtime, execution, turnId, resume) {
  let timeout;
  try { await Promise.race([runtime.executeApprovedPlan(execution, turnId, resume), new Promise((_, reject) => {
    timeout = setTimeout(() => reject(fixtureError ?? new Error("Goal fixture exceeded 30 seconds")), 30000);
  })]); } finally { clearTimeout(timeout); }
  await Promise.all(persistence.splice(0));
  assert.ifError(fixtureError);
  assert.equal(fixture.events.filter(event => event.type === "agent_end").length, 1);
  assert.equal(fixture.events.filter(event => event.type === "error").length, 0);
}
async function settle(f, extra = {}) {
  await host.call("session.endTurn", { turnId: f.turnId, status: "completed", createNotification: false });
  return host.call("goalExecutions.settle", { sessionId: f.session.id, executionId: f.execution.id, ended: "agent_stopped", ...extra });
}
async function executionError(f) {
  const { history } = await host.call("plans.pending", { sessionId: f.session.id });
  return history.find(proposal => proposal.executionId === f.execution.id)?.errorCode;
}
async function assertBlocked(f, code) {
  const state = await host.call("goalExecutions.get", { sessionId: f.session.id, executionId: f.execution.id });
  assert.equal(state.execution.state, "interrupted"); assert.equal(await executionError(f), "GOAL_BLOCKED");
  assert.equal(state.hold.state, "blocked"); assert.ok(state.hold.reasons.some(reason => reason.code === code));
  const read = await host.call("goalReports.get", { sessionId: f.session.id, executionId: f.execution.id });
  assert.notEqual(read.state, "ready"); assert.equal(read.report?.schemaVersion, undefined);
  assert.equal(existsSync(join(dataDir, "goal_reports", f.session.id, `${f.execution.id}.json`)), false);
  assert.equal(notices.some(note => note.method === "goalReports.changed" && note.params.executionId === f.execution.id && note.params.status === "ready"), false);
  const { notifications } = await host.call("notification.list");
  assert.equal(notifications.some(note => note.sessionId === f.session.id && note.kind === "task.completed"), false);
  assert.ok(notifications.some(note => note.sessionId === f.session.id && note.kind === "task.failed" && note.errorCode === "GOAL_BLOCKED"));
  return state;
}
async function runSidecar(f) {
  let timeout, detach;
  const ended = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(fixtureError ?? new Error("Sidecar Goal exceeded 30 seconds")), 30000);
    detach = sidecar.onNotification((method, envelope) => {
      if (method !== "agent.event" || envelope.sessionId !== f.session.id || envelope.turnId !== f.turnId) return;
      const { event } = envelope; fixture.events.push(event);
      if (event.type === "message_end") persistence.push(host.call("session.appendMessage", {
        sessionId: f.session.id, turnId: f.turnId, message: event.message,
      }));
      if (event.type === "error") reject(new Error(JSON.stringify(event.error)));
      if (event.type === "agent_end") resolve();
    });
  });
  try {
    const accepted = await sidecar.call("agent.executeApprovedPlan", { sessionId: f.session.id, turnId: f.turnId, execution: f.execution,
      mode: "agent", executionProfile: "standard", projectPath: workspace, thinkingLevel: "off",
      commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
      provider: { id: provider.id, name: "Fixture", modelId: "fixture", baseUrl, apiKey: "", authKind: "none", apiStyle: "chat_completions",
        supportsReasoning: false, supportedThinkingLevels: ["off"], modelConfig: { source: "generic", name: "Fixture", baseUrl, reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
      ...(f.resume ? { resume: f.resume, userMessageId: f.userMessageId } : {}) });
    assert.equal(accepted.accepted, true); await ended; await Promise.all(persistence.splice(0)); assert.ifError(fixtureError);
    assert.equal(fixture.events.filter(event => event.type === "agent_end").length, 1);
    assert.equal((await sidecar.call("agent.getStatus", { sessionId: f.session.id })).status.isRunning, false);
  } finally { clearTimeout(timeout); detach?.(); }
}
function pass(id, detail) { evidence.cases.push({ id, detail, result: "PASS" }); console.log(`PASS ${id}: ${detail}`); }
async function resume(f, hold, message, modelOverride) {
  const state = await host.call("goalExecutions.resume", { sessionId: f.session.id, executionId: f.execution.id, expectedVersion: hold.version,
    ...(modelOverride ? { modelOverride } : {}) });
  assert.equal(state.execution.id, f.execution.id); assert.equal(state.execution.state, "running"); assert.equal(state.execution.targetPermissionMode, "auto");
  const { turnId } = await host.call("session.beginTurn", { sessionId: f.session.id,
    ...(state.execution.executionProviderId ? { providerId: state.execution.executionProviderId } : {}),
    ...(state.execution.executionModelId ? { modelId: state.execution.executionModelId } : {}) });
  assert.notEqual(turnId, f.turnId);
  await host.call("goalReports.bindExecutionTurn", { executionId: f.execution.id, turnId });
  const userMessageId = message ? randomUUID() : undefined;
  if (message) await host.call("session.appendMessage", { sessionId: f.session.id, turnId,
    message: { id: userMessageId, role: "user", content: message, status: "complete", createdAt: new Date().toISOString() } });
  return { ...f, execution: state.execution, turnId, userMessageId, resume: { ...state.resume, ...(message ? { userMessage: message } : {}) } };
}
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  let legacy;
  if (process.env.PI_DESKTOP_LEGACY_HOST_BIN) {
    const legacyBinary = process.env.PI_DESKTOP_LEGACY_HOST_BIN;
    evidence.legacyHostBinarySha256 = createHash("sha256").update(await readFile(legacyBinary)).digest("hex");
    await boot(legacyBinary);
    const { session } = await host.call("session.create", { title: "Historical fallback", mode: "agent", projectPath: workspace });
    legacy = { session, ...await approve(session, "Historical fallback") };
    await host.call("session.endTurn", { turnId: legacy.turnId, status: "completed", createNotification: false });
    await host.call("plans.finishExecution", { executionId: legacy.execution.id, status: "completed" });
    await host.call("goalReports.finalizeReport", { executionId: legacy.execution.id, status: "completed" });
    legacy.path = join(dataDir, "goal_reports", session.id, `${legacy.execution.id}.json`);
    legacy.bytes = await readFile(legacy.path);
    const legacyReport = JSON.parse(legacy.bytes);
    assert.equal(legacyReport.integrity.kind, "fallback");
    evidence.legacyBaseline = { schemaVersion: legacyReport.schemaVersion, executionStatus: legacyReport.execution.status,
      verdict: legacyReport.verdict, integrity: legacyReport.integrity.kind, reportSha256: createHash("sha256").update(legacy.bytes).digest("hex") };
    await host.dispose();
  }
  await boot();
  ({ provider } = await host.call("providers.create", { name: "Blocked fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions", baseUrl,
    defaultModelId: "fixture", models: ["fixture", "resume-fixture"].map(id => ({ id, thinkingLevels: ["off"] })) }));

  const ordinary = await goal("FIXTURE_MISSING_REPORT");
  configureFixture((request, step) => step === 1 ? tool("UpdateGoalProgress", { items }) : "Prior work: the 48 spelling table could not be found.");
  const ordinaryRuntime = await runtimeFor(ordinary.session);
  await run(ordinaryRuntime, ordinary.execution, ordinary.turnId);
  assert.equal(fixture.requests.length, 3, "One progress update and exactly one report recovery");
  assert.ok(JSON.stringify(fixture.requests[2].messages).includes("<goal_report_recovery>"));
  await assert.rejects(host.call("plans.finishExecution", { executionId: ordinary.execution.id, status: "completed" }), error => error.message.includes("GOAL_REPORT_NOT_VERIFIED"));
  await settle(ordinary); const blocked = await assertBlocked(ordinary, "report_missing");
  assert.deepEqual(blocked.hold.progress.items.map(item => item.status), items.map(item => item.status));
  pass("E2E-GOAL-BLOCKED-001", "A: one report recovery, interrupted/GOAL_BLOCKED, five milestones retained, no report/ready/completed notification");

  configureFixture((request, step) => {
    const messages = JSON.stringify(request.messages);
    assert.ok(messages.includes(ordinary.execution.plan.replaceAll("\n", "\\n")) && messages.includes(supplement));
    assert.ok(messages.includes("Prior work: the 48 spelling table could not be found."));
    if (step === 1) { assert.ok(messages.includes('"status":"pending"') || messages.includes('\\"status\\":\\"pending\\"')); return tool("SubmitGoalReport", metReport); }
    if (step === 2) { assert.ok(messages.includes("progress still contains")); return tool("UpdateGoalProgress", { items: items.map(item => ({ ...item, status: "completed" })) }); }
    if (step === 3) return tool("SubmitGoalReport", metReport);
    return "Verified the exact contract after the clarification.";
  });
  const continued = await resume(ordinary, blocked.hold, supplement);
  await assert.rejects(host.call("goalExecutions.close", { sessionId: ordinary.session.id, executionId: ordinary.execution.id, expectedVersion: blocked.hold.version, action: "abandon" }));
  await run(ordinaryRuntime, continued.execution, continued.turnId, continued.resume); await settle(continued);
  const report = (await host.call("goalReports.get", { sessionId: ordinary.session.id, executionId: ordinary.execution.id })).report;
  assert.equal(report.verdict, "met"); assert.equal(report.closure, "agent_verified"); assert.equal(report.execution.status, "completed");
  assert.equal(report.integrity.kind, "structured"); assert.equal(report.segments.length, 2); assert.equal(report.blocks.length, 1);
  assert.equal(report.segments[0].turnId, ordinary.turnId); assert.equal(report.segments[1].turnId, continued.turnId);
  assert.equal(report.execution.startedAt, report.segments[0].startedAt);
  const { session: transcript } = await host.call("session.get", { id: ordinary.session.id, messageLimit: 100 });
  const messages = transcript.messages;
  assert.equal(messages.filter(row => row.content === supplement && row.role === "user").length, 1);
  pass("E2E-GOAL-BLOCKED-002", "C: same ID, immutable contract/prior context/supplement preserved, met rejected before progress reconciliation, segments=2/blocks=1, first start retained");

  const team = await goal("FIXTURE_INCIDENT_67b8868e", true);
  const params = { teamSessionId: team.session.id, callerSessionId: team.session.id };
  const { review } = await host.call("team.declareStrategy", { ...params, leadTurnId: team.turnId, strategy: "delegate", reason: "Replay missing team completion", members: ["core_dev", "ui_dev", "qa"].map(name => ({ name, contextKind: "fresh" })) });
  const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: team.session.id, reviewId: review.reviewId, expectedRevision: review.revision });
  await host.call("team.readExecutionInbox", { ...params, expectedTurnId: team.turnId });
  const tasks = [];
  for (const name of ["core_dev", "ui_dev", "qa"]) tasks.push((await host.call("team.createTask", { ...params, taskId: `incident-${name}`, subject: `${name} incident task`, ownerMemberName: name })).task);
  const { message } = await host.call("team.sendMessage", { ...params, target: "core_dev", content: "FIXTURE_SILENT_MEMBER", taskDispatch: { taskId: tasks[0].taskId, expectedRevision: tasks[0].revision } });
  const { turnId: memberTurn } = await host.call("session.beginTurn", { sessionId: decision.memberSessionIds[0], sessionMessageId: message.id });
  await host.call("team.updateTask", { teamSessionId: team.session.id, callerSessionId: decision.memberSessionIds[0], expectedCallerTurnId: memberTurn,
    taskId: tasks[0].taskId, expectedRevision: tasks[0].revision, status: "in_progress" });
  configureFixture(() => "Searching");
  const memberRuntime = await runtimeFor({ id: decision.memberSessionIds[0] }, true);
  await memberRuntime.prompt("FIXTURE_SILENT_MEMBER", randomUUID(), memberTurn);
  await Promise.all(persistence.splice(0));
  assert.equal(fixture.requests.length, 1);
  await host.call("session.endTurn", { turnId: memberTurn, status: "completed", createNotification: false });
  await host.call("session.collaboration.settle", { turnId: memberTurn });
  configureFixture((request, step) => {
    if (step === 2) assert.ok(JSON.stringify(request.messages).includes("<pseudo_tool_call_recovery>"));
    if (step >= 3) for (const task of tasks) assert.ok(JSON.stringify(request.messages).includes(task.taskId));
    return pseudo;
  });
  const teamRuntime = await runtimeFor(team.session, true);
  await run(teamRuntime, team.execution, team.turnId);
  assert.equal(fixture.requests.length, 5, "One pseudo retry + three settlement recovery attempts");
  assert.equal(fixture.events.find(event => event.type === "agent_end").stopHint, "team_unsettled");
  await settle(team, { stopHint: "team_unsettled" }); const teamBlocked = await assertBlocked(team, "team_unsettled");
  assert.equal(teamBlocked.hold.pausedTeam, true);
  assert.equal((await host.call("team.getRoster", params)).paused, true);
  assert.equal(teamBlocked.hold.reasons.find(reason => reason.code === "team_unsettled").tasks.length, 3);
  await assert.rejects(host.call("team.sendMessage", { ...params, target: "ui_dev", content: "Must not dispatch while blocked" }), error => error.message.includes("TEAM_PAUSED") || error.message.includes("TEAM_APPROVAL_REQUIRED"));
  pass("E2E-GOAL-BLOCKED-003", "B: real silent expert/lead/Pi, core in_progress + two pending tasks, pseudo retry=1/recovery=3, blocked and team paused without error/completion");
  const teamContinued = await resume(team, teamBlocked.hold, supplement);
  assert.equal((await host.call("team.getRoster", params)).paused, false);
  const memberSteps = new Map(); let resumedLeadStep = 0;
  configureFixture(async request => {
    const messages = JSON.stringify(request.messages);
    const name = ["core_dev", "ui_dev", "qa"].find(name => messages.includes(`FIXTURE_MEMBER_RESUME_${name}`));
    if (name) {
      const step = (memberSteps.get(name) ?? 0) + 1; memberSteps.set(name, step);
      const { tasks: board } = await host.call("team.getBoard", params);
      const task = board.find(task => task.taskId === `incident-${name}`);
      if (step === 1) return tool("task_update", { taskId: task.taskId, expectedRevision: task.revision, status: "completed", description: "Verified the assigned fixture after user clarification." });
      if (step === 2) return tool("send_message", { targetMemberName: "Lead", content: `${name}: FIXTURE_RESUMED_VERIFIED. Assigned fixture and criterion checked after the clarification.` });
      return "Assigned verification complete.";
    }
    const step = ++resumedLeadStep;
    assert.ok(messages.includes(supplement) && messages.includes(pseudo));
    if (step === 1) return tool("wait_for_updates", { timeoutSeconds: 1 });
    if (step === 2) { assert.ok(messages.includes("FIXTURE_RESUMED_VERIFIED")); return tool("UpdateGoalProgress", { items: items.map(item => ({ ...item, status: "completed" })) }); }
    if (step === 3) return tool("SubmitGoalReport", metReport);
    return "Team contract verified, all owned tasks and results settled.";
  });
  const memberRuns = [];
  for (let index = 0; index < 3; index++) {
    const name = ["core_dev", "ui_dev", "qa"][index];
    const { tasks: board } = await host.call("team.getBoard", params); const task = board.find(task => task.taskId === `incident-${name}`);
    const { message } = await host.call("team.sendMessage", { ...params, target: name, content: `FIXTURE_MEMBER_RESUME_${name}`, taskDispatch: { taskId: task.taskId, expectedRevision: task.revision } });
    const { turnId } = await host.call("session.beginTurn", { sessionId: decision.memberSessionIds[index], sessionMessageId: message.id });
    memberRuns.push({ name, turnId, runtime: await runtimeFor({ id: decision.memberSessionIds[index] }, true) });
  }
  await Promise.all(memberRuns.map(async ({ name, turnId, runtime }) => {
    await runtime.prompt(`FIXTURE_MEMBER_RESUME_${name}`, randomUUID(), turnId);
    await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
    await host.call("session.collaboration.settle", { turnId });
  }));
  await Promise.all(persistence.splice(0)); assert.ifError(fixtureError);
  assert.equal((await host.call("team.getBoard", params)).tasks.every(task => task.status === "completed"), true);
  assert.deepEqual([...memberSteps.values()], [3, 3, 3]);
  fixture.events = [];
  await run(teamRuntime, teamContinued.execution, teamContinued.turnId, teamContinued.resume);
  const teamSettlement = await settle(teamContinued);
  assert.equal(teamSettlement.execution.state, "completed", JSON.stringify(teamSettlement));
  const teamReport = (await host.call("goalReports.get", { sessionId: team.session.id, executionId: team.execution.id })).report;
  assert.equal(teamReport.verdict, "met"); assert.equal(teamReport.segments.length, 2); assert.equal(teamReport.blocks.length, 1);
  pass("E2E-GOAL-BLOCKED-004", "C team: same execution, three real resumed expert runtimes in parallel close tasks and send authenticated results; lead consumes them before met report");

  const partial = await goal("FIXTURE_PARTIAL");
  configureFixture((request, step) => step === 1 ? tool("SubmitGoalReport", { verdict: "partial", summary: "Needs access.", limitations: ["User access is required."], nextSteps: ["Provide access."] }) : "Please provide access.");
  await run(await runtimeFor(partial.session), partial.execution, partial.turnId);
  await assert.rejects(host.call("plans.finishExecution", { executionId: partial.execution.id, status: "completed" }), error => error.message.includes("GOAL_REPORT_NOT_VERIFIED"));
  await settle(partial);
  const partialBlocked = await assertBlocked(partial, "verdict_partial"); assert.equal(partialBlocked.hold.draft.limitations[0], "User access is required.");
  await host.call("goalExecutions.close", { sessionId: partial.session.id, executionId: partial.execution.id, expectedVersion: partialBlocked.hold.version, action: "accept" });
  const accepted = (await host.call("goalReports.get", { sessionId: partial.session.id, executionId: partial.execution.id })).report;
  assert.equal(accepted.verdict, "partial"); assert.equal(accepted.closure, "user_accepted"); assert.equal(accepted.integrity.kind, "structured");
  pass("E2E-GOAL-BLOCKED-005", "D: partial remains blocked with limitations until explicit accept; partial/structured/user_accepted completion");

  const abandoned = await goal("FIXTURE_ABANDON"); await settle(abandoned); const abandonHold = (await assertBlocked(abandoned, "report_missing")).hold;
  const races = await Promise.allSettled(["abandon", "abandon"].map(action => host.call("goalExecutions.close", { sessionId: abandoned.session.id, executionId: abandoned.execution.id, expectedVersion: abandonHold.version, action })));
  assert.equal(races.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(races.filter(result => result.status === "rejected").length, 1);
  const abandonState = await host.call("goalExecutions.get", { sessionId: abandoned.session.id, executionId: abandoned.execution.id });
  assert.equal(await executionError(abandoned), "GOAL_ABANDONED"); assert.equal(abandonState.hold.state, "abandoned");
  assert.equal(existsSync(join(dataDir, "goal_reports", abandoned.session.id, `${abandoned.execution.id}.json`)), false);
  const superseded = await goal("FIXTURE_SUPERSEDE"); await settle(superseded); await assertBlocked(superseded, "report_missing");
  const replacementNoticeStart = notices.length;
  await approve(superseded.session, "Replacement Goal", "goal", false);
  const replaced = await host.call("goalExecutions.get", { sessionId: superseded.session.id, executionId: superseded.execution.id });
  assert.equal(await executionError(superseded), "GOAL_SUPERSEDED"); assert.equal(replaced.hold.state, "superseded");
  assert.ok(notices.slice(replacementNoticeStart).some(notice => notice.method === "goalExecutions.changed" &&
    notice.params.executionId === superseded.execution.id && notice.params.hold?.state === "superseded"),
    "Replacement approval must immediately publish the old hold change to its readers");
  pass("E2E-GOAL-BLOCKED-006", "E/CAS: abandon publishes nothing, only one competing close wins, new approved Goal supersedes blocked execution");

  const errored = await goal("FIXTURE_ERROR");
  await host.call("session.endTurn", { turnId: errored.turnId, status: "error", errorCode: "FIXTURE_AGENT_ERROR", createNotification: false });
  await host.call("goalExecutions.settle", { sessionId: errored.session.id, executionId: errored.execution.id, ended: "errored", errorCode: "FIXTURE_AGENT_ERROR" });
  const erroredHold = (await assertBlocked(errored, "agent_error:FIXTURE_AGENT_ERROR")).hold;
  await host.call("goalExecutions.resume", { sessionId: errored.session.id, executionId: errored.execution.id, expectedVersion: erroredHold.version });
  await host.call("goalExecutions.settle", { sessionId: errored.session.id, executionId: errored.execution.id, ended: "errored", errorCode: "resume_failed", stopHint: "resume_failed" });
  await assertBlocked(errored, "resume_failed");
  pass("E2E-GOAL-BLOCKED-008", "WP6: errored execution and failed resume dispatch return to durable blocked with diagnostic reasons");

  const restart = await goal("FIXTURE_RESTART"); await settle(restart); const beforeRestart = await assertBlocked(restart, "report_missing");
  const historicalPath = join(dataDir, "goal_reports", ordinary.session.id, `${ordinary.execution.id}.json`);
  const historicalBytes = await readFile(historicalPath);
  await Promise.all([...runtimes].map(runtime => runtime.dispose())); runtimes.clear(); await host.dispose(); await boot();
  const afterRestart = await assertBlocked(restart, "report_missing"); assert.equal(afterRestart.hold.version, beforeRestart.hold.version);
  assert.equal((await host.call("plans.queuedExecutions")).executions.some(execution => execution.id === restart.execution.id), false);
  const restarted = await resume(restart, afterRestart.hold, supplement, { providerId: provider.id, modelId: "resume-fixture" });
  configureFixture((request, step) => {
    const messages = JSON.stringify(request.messages); assert.ok(messages.includes(restart.execution.plan.replaceAll("\n", "\\n")) && messages.includes(supplement));
    assert.equal(request.model, "resume-fixture");
    return step === 1 ? tool("SubmitGoalReport", metReport) : "Restarted exact contract verified.";
  });
  await run(await runtimeFor(restart.session, false, "resume-fixture"), restarted.execution, restarted.turnId, restarted.resume); await settle(restarted);
  assert.deepEqual(await readFile(historicalPath), historicalBytes);
  const stopped = await goal("FIXTURE_USER_STOP");
  await host.call("session.endTurn", { turnId: stopped.turnId, status: "aborted", errorCode: "TURN_ABORTED", createNotification: false });
  await host.call("plans.finishExecution", { executionId: stopped.execution.id, status: "interrupted", errorCode: "TURN_ABORTED" });
  const stopState = await host.call("goalExecutions.get", { sessionId: stopped.session.id, executionId: stopped.execution.id });
  assert.equal(await executionError(stopped), "TURN_ABORTED"); assert.equal(stopState.hold == null, true);
  pass("E2E-GOAL-BLOCKED-007", "F/G: restart preserves blocked hold, fresh runtime replays contract and resumes, existing finalized bytes unchanged, explicit Stop remains interrupted");
  if (legacy) {
    assert.deepEqual(await readFile(legacy.path), legacy.bytes);
    const legacyRead = await host.call("goalReports.get", { sessionId: legacy.session.id, executionId: legacy.execution.id });
    assert.equal(legacyRead.report.schemaVersion, 1); assert.equal(legacyRead.report.integrity.kind, "fallback");
    assert.equal(legacyRead.report.execution.status, "completed");
    assert.equal(validateGoalReport(legacyRead.report).ok, true);
    await host.call("goalReports.retry", { sessionId: legacy.session.id, executionId: legacy.execution.id });
    const retriedLegacy = await host.call("goalReports.get", { sessionId: legacy.session.id, executionId: legacy.execution.id });
    assert.equal(validateGoalReport(retriedLegacy.report).ok, true);
    assert.equal(retriedLegacy.report.integrity.kind, "fallback");
    await assert.rejects(host.call("goalExecutions.resume", { sessionId: legacy.session.id, executionId: legacy.execution.id, expectedVersion: 0 }));
    assert.deepEqual(await readFile(legacy.path), legacy.bytes);
    pass("E2E-GOAL-BLOCKED-009", "G: report created by supplied legacy Host survives v8 migration/restart byte-for-byte and cannot reopen");
  } else evidence.cases.push({ id: "E2E-GOAL-BLOCKED-009", result: "NOT RUN", detail: "Set PI_DESKTOP_LEGACY_HOST_BIN to validate historical fallback migration with a known old binary." });
  const proxied = await goal("FIXTURE_REAL_SIDECAR");
  const proxyCalls = [];
  const startSidecar = () => new AgentSidecar({ launch: { command: process.execPath,
    args: [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], cwd: workspace,
    env: { ...process.env, HOME: fixtureHome, PI_DESKTOP_DATA_DIR: dataDir } },
    onStderr: text => { if (process.env.DEBUG_GOAL_BLOCKED) process.stderr.write(text); } });
  const attachSidecar = () => {
  sidecar.setHost({ async call(method, params) {
    const result = await host.call(method, params); proxyCalls.push({ method, params, result }); return result;
  }, onNotification: listener => host.onNotification(listener), onExit: listener => host.onExit(listener) });
  sidecar.setProjectInstructionRoot(proxied.session.id, workspace);
  };
  sidecar = startSidecar(); attachSidecar();
  configureFixture((request, step) => step === 1 ? tool("UpdateGoalProgress", { items }) : "Prior sidecar work: spelling table is unavailable.");
  await runSidecar(proxied); assert.equal(fixture.requests.length, 3); await settle(proxied);
  const proxyHold = (await assertBlocked(proxied, "report_missing")).hold;
  await sidecar.dispose(); sidecar = startSidecar(); attachSidecar();
  const proxyContinued = await resume(proxied, proxyHold, supplement);
  configureFixture((request, step) => {
    const messages = JSON.stringify(request.messages);
    assert.ok(messages.includes(supplement) && messages.includes(proxied.execution.plan.replaceAll("\n", "\\n")));
    assert.equal(request.messages.filter(message => message.role === "user" && message.content === supplement).length, 1);
    if (step === 1) { assert.ok(messages.includes("Existing progress snapshot")); return tool("UpdateGoalProgress", { items: items.map(item => ({ ...item, status: "completed" })) }); }
    if (step === 2) return tool("SubmitGoalReport", metReport);
    return "Actual child sidecar verified every original criterion.";
  });
  await runSidecar(proxyContinued); await settle(proxyContinued);
  const proxyReport = (await host.call("goalReports.get", { sessionId: proxied.session.id, executionId: proxied.execution.id })).report;
  assert.equal(proxyReport.executionId, proxied.execution.id); assert.equal(proxyReport.verdict, "met");
  assert.equal(proxyReport.segments.length, 2); assert.equal(proxyReport.blocks.length, 1); assert.equal(validateGoalReport(proxyReport).ok, true);
  const progressRead = proxyCalls.filter(call => call.method === "goalProgress.get");
  assert.equal(progressRead.length, 1); assert.equal(progressRead[0].params.executionId, proxied.execution.id);
  assert.equal(progressRead[0].result.progress.items[1].status, "pending");
  const tokens = proxyCalls.filter(call => call.method === "goalProgress.issueToken").map(call => call.result.writeToken);
  assert.equal(tokens.length, 2); assert.notEqual(tokens[0], tokens[1]);
  assert.equal(proxyCalls.filter(call => call.method === "goalProgress.update").at(-1).params.writeToken, tokens[1]);
  const proxyTranscript = (await host.call("session.get", { id: proxied.session.id })).session.messages;
  assert.equal(proxyTranscript.filter(message => message.role === "user" && message.content === supplement).length, 1);
  await sidecar.dispose(); sidecar = undefined;
  pass("E2E-GOAL-BLOCKED-010", "Real AgentSidecar child + ParentHostProxy + Runtime + native Host: blocked then same-ID resume, authorized progress get, new token, child restart/full contract replay/supplement once, met report/segments2/blocks1");
  // A Host exit during an active segment must hold the same execution on boot.
  const crashed = await goal("FIXTURE_HOST_CRASH");
  const issueProgress = async segment => (await host.call("goalProgress.issueToken", {
    sessionId: segment.session.id, executionId: segment.execution.id, turnId: segment.turnId,
  })).writeToken;
  const initialCrashToken = await issueProgress(crashed);
  await host.call("goalProgress.update", { sessionId: crashed.session.id, executionId: crashed.execution.id,
    writeToken: initialCrashToken, items });
  const crashAndReopen = async () => {
    const oldPid = host.child.pid;
    // This is the harness-owned child only; deliberately no session.endTurn or settle.
    await Promise.all([...runtimes].map(runtime => runtime.dispose())); runtimes.clear();
    await host.dispose();
    assert.throws(() => process.kill(oldPid, 0), error => error.code === "ESRCH");
    await boot(); assert.notEqual(host.child.pid, oldPid);
  };
  const staleTokenRefused = (segment, writeToken) => assert.rejects(host.call("goalProgress.update", {
    sessionId: segment.session.id, executionId: segment.execution.id, writeToken, items,
  }), error => error.errorCode === "GOAL_PROGRESS_NOT_RUNNING");
  await crashAndReopen();
  const initialCrashHold = (await assertBlocked(crashed, "agent_error:HOST_RESTARTED")).hold;
  assert.equal(initialCrashHold.firstTurnId, crashed.turnId);
  assert.equal(initialCrashHold.segments.length, 1); assert.equal(initialCrashHold.blocks.length, 1);
  assert.deepEqual(initialCrashHold.progress.items.map(item => item.status), items.map(item => item.status));
  await staleTokenRefused(crashed, initialCrashToken);
  const crashResumed = await resume(crashed, initialCrashHold, "Continue the preserved crash fixture.");
  const resumedCrashToken = await issueProgress(crashResumed);
  assert.notEqual(resumedCrashToken, initialCrashToken);
  await host.call("goalProgress.update", { sessionId: crashed.session.id, executionId: crashed.execution.id,
    writeToken: resumedCrashToken, items });
  await crashAndReopen();
  const resumedCrashHold = (await assertBlocked(crashed, "agent_error:HOST_RESTARTED")).hold;
  assert.equal(resumedCrashHold.executionId, crashed.execution.id);
  assert.equal(resumedCrashHold.resumeCount, 1);
  assert.equal(resumedCrashHold.segments.length, 2); assert.equal(resumedCrashHold.blocks.length, 2);
  assert.equal(resumedCrashHold.segments[0].turnId, crashed.turnId);
  assert.equal(resumedCrashHold.segments[1].turnId, crashResumed.turnId);
  await staleTokenRefused(crashResumed, resumedCrashToken);
  const recoveredCrash = await resume(crashed, resumedCrashHold, "Finish the verified preserved contract.");
  const finalCrashToken = await issueProgress(recoveredCrash);
  assert.notEqual(finalCrashToken, resumedCrashToken);
  await host.call("goalProgress.update", { sessionId: crashed.session.id, executionId: crashed.execution.id,
    writeToken: finalCrashToken, items: items.map(item => ({ ...item, status: "completed" })) });
  await host.call("goalReports.submitDraft", { executionId: crashed.execution.id, draft: metReport });
  await settle(recoveredCrash);
  const crashReport = (await host.call("goalReports.get", { sessionId: crashed.session.id, executionId: crashed.execution.id })).report;
  assert.equal(crashReport.executionId, crashed.execution.id); assert.equal(crashReport.execution.status, "completed");
  assert.equal(crashReport.verdict, "met"); assert.equal(crashReport.closure, "agent_verified");
  assert.equal(crashReport.segments.length, 3); assert.equal(crashReport.blocks.length, 2);
  assert.equal(crashReport.execution.startedAt, crashReport.segments[0].startedAt);
  assert.equal(validateGoalReport(crashReport).ok, true);
  pass("E2E-GOAL-BLOCKED-011", "Real Host exits during initial and resumed running segments: boot blocks same ID with HOST_RESTARTED, revokes tokens/preserves progress/no completion; third segment finishes met, segments3/blocks2");
  evidence.limitations = ["Main/IPC/renderer integration is verified separately; this harness invokes native lifecycle RPC and runtime public interface.",
    "H follows accepted Plus v8 fail-closed compatibility; no old-binary downgrade is claimed."];
} finally {
  await sidecar?.dispose();
  await Promise.allSettled([...runtimes].map(runtime => runtime.dispose())); await host?.dispose();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (process.env.PI_GOAL_BLOCKED_EVIDENCE) await writeFile(process.env.PI_GOAL_BLOCKED_EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(evidence));
