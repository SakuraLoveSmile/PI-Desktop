#!/usr/bin/env node
// Real Host, Main factories, bridge/AgentHost, sidecar and DesktopAgentRuntime.
// Only the provider and absent UI/extensions are fixture edges. No user profile.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC } from "@pi-desktop/shared";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";
import { InflightCheckpointer } from "../packages/host-runtime/dist/inflight-checkpoint.js";
import { resolveHostBinary } from "./e2e/host.mjs";

register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const { createTeamDeliveryService } = await import("../apps/desktop/electron/main/services/team-delivery.ts");
const { createAgentHostBridge, DESKTOP_PRINCIPAL } = await import("../apps/desktop/electron/main/agent-host-bridge.ts");
const { registerAgentIpc } = await import("../apps/desktop/electron/main/ipc/agent-ipc.ts");
const { createSessionCoordination } = await import("../apps/desktop/electron/main/runtime/session-coordination.ts");
const { createPlanRuntime } = await import("../apps/desktop/electron/main/runtime/plans.ts");
const { createEventPersistence } = await import("../apps/desktop/electron/main/runtime/event-persistence.ts");
const { PersistenceOutbox } = await import("../apps/desktop/electron/main/persistence-outbox.ts");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not settle within 20 seconds`)), 20000);
    })]);
  } finally { clearTimeout(timer); }
}
async function markerReady(path) {
  if (existsSync(path)) return Promise.resolve();
  let watcher;
  try {
    await bounded(new Promise((resolve, reject) => {
      watcher = watch(join(path, ".."), () => { if (existsSync(path)) resolve(); });
      watcher.once("error", reject);
      if (existsSync(path)) resolve();
    }), "foreground Bash start marker");
  } finally { watcher?.close(); }
}

const root = await mkdtemp(join(tmpdir(), "pi-team-interrupt-"));
const workspace = join(root, "workspace");
const dataDir = join(root, "data");
const home = join(root, "home");
await Promise.all([workspace, dataDir, home].map(path => mkdir(path, { recursive: true })));
const foregroundMarker = join(workspace, "foreground-started");
const requests = new Map();
const providerGates = new Map();
const gateEntered = new Map(["BACKGROUND", "REPLACEMENT"].map(key => [key, deferred()]));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = code => `${quote(process.execPath)} -e ${quote(code)}`;
let serverError;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const user = request.messages.filter(message => message.role === "user").at(-1);
    const marker = JSON.stringify(user?.content).match(/FIXTURE_(FOREGROUND|BACKGROUND|REPLACEMENT)/)?.[1];
    assert.ok(marker, "unexpected provider request outside the isolated scenario");
    const step = (requests.get(marker) ?? 0) + 1;
    requests.set(marker, step);
    const reply = tool => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "interrupt-fixture",
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      emit(tool ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
        function: { name: "Bash", arguments: JSON.stringify(tool) } }] } : { role: "assistant", content: "Fixture complete." }, null);
      emit({}, tool ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    };
    if (marker === "FOREGROUND" && step === 1) {
      reply({ command: command(`require('node:fs').writeFileSync(${JSON.stringify(foregroundMarker)},String(process.pid));setInterval(()=>{},1000)`), timeout: 120 });
    } else if (marker === "BACKGROUND" && step === 1) {
      reply({ command: command("setInterval(()=>{},1000)"), run_in_background: true, timeout: 120 });
    } else if (marker === "BACKGROUND" || marker === "REPLACEMENT") {
      assert.equal(step, marker === "BACKGROUND" ? 2 : 1, "fixture may not retry provider work");
      providerGates.set(marker, () => reply());
      gateEntered.get(marker).resolve();
    } else {
      throw new Error(`Unexpected provider continuation: ${marker}/${step}`);
    }
  } catch (error) {
    serverError = error;
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error));
  }
});
let host, sidecar, checkpointer, detachHost, detachSidecar;
let bridge, planRuntime, service;
let releaseRaceGate;
const errors = [];
const runtimeEvents = [];
const invocations = [];
const notices = [];
const deliveries = [];
const activeTurns = new Map();
const handlers = new Map();
const toolEndWaiters = new Map();
const endedWaiters = new Map();
const logger = { app(...args) { if (args[1] === "warn" || args[1] === "error") errors.push(args); } };
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  host = new HostProcess({ binaryPath: resolveHostBinary(), dataDir, env: { HOME: home }, onStderr: text => {
    if (process.env.DEBUG_TEAM_INTERRUPT) process.stderr.write(text);
  } });
  await host.call("app.handshake", { protocolVersion: 11 });
  await host.call("workspace.set", { path: workspace });
  const { provider } = await host.call("providers.create", { name: "Interrupt fixture", vendorKey: "custom", baseUrl,
    authKind: "none", apiStyle: "chat_completions", defaultModelId: "interrupt-fixture",
    models: [{ id: "interrupt-fixture", thinkingLevels: ["off"] }] });
  const { session: lead } = await host.call("session.create", { mode: "agent", executionProfile: "team", projectPath: workspace,
    permissionMode: "auto", providerId: provider.id, modelId: "interrupt-fixture", thinkingLevel: "off" });
  await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
  const declaration = await host.call("session.beginTurn", { sessionId: lead.id });
  const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id,
    leadTurnId: declaration.turnId, strategy: "delegate", reason: "Verify production exact-turn interruption", members: [{ name: "tester", contextKind: "fresh" }] });
  await host.call("session.endTurn", { turnId: declaration.turnId, status: "completed", createNotification: false });
  const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
  const member = decision.memberSessionIds[0];
  const shell = (await host.call("commandShells.list")).effective;
  sidecar = new AgentSidecar({ launch: { command: process.execPath,
    args: [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], cwd: workspace,
    env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: dataDir } }, onStderr: text => {
      if (process.env.DEBUG_TEAM_INTERRUPT) process.stderr.write(text);
    } });
  sidecar.setHost(host);
  sidecar.setProjectInstructionRoot(member, workspace);
  const coordination = createSessionCoordination({ activeTurns, getMainWindow: () => null, getViewingSessionId: () => null });
  const runtimeState = { host, sidecar };
  const activeToolCalls = new Map();
  const planSubmissionTurnIds = new Set();
  const approvedExecutionIdsBySession = new Map();
  const claimedExecutionSessions = new Map();
  const approvedExecutionTurns = new Map();
  const outbox = new PersistenceOutbox(dataDir, (...args) => errors.push(args));
  const unusedLaunch = async () => { throw new Error("Fixture prompt admission is explicit; unexpected UI launch"); };
  planRuntime = createPlanRuntime({ runtimeState, planState: { approvedExecutionDrain: null }, logger,
    sendToRenderer() {}, coordination, scheduledRunsBySession: new Map(), activeToolCalls, planSubmissionTurnIds,
    approvedExecutionIdsBySession, claimedExecutionSessions, approvedExecutionTurns, startedApprovedExecutions: new Set(),
    finishedApprovedExecutions: new Set(), dispatchingApprovedExecutions: new Set(), inFlightExecutionFinishes: new Set(),
    pendingExecutionFinishes: new Map(), announceTurnEnded(payload) { endedWaiters.get(payload.turnId)?.resolve(payload); },
    emitAgentEvent() {}, acquireSessionOperation: coordination.acquireSessionOperation, resolveAgentRuntimeLaunch: unusedLaunch,
    isQuitting: () => false, persistenceOutbox: outbox });
  bridge = createAgentHostBridge({ getHost: () => host, channels: IPC.invoke,
    isSessionBusy: coordination.isSessionBusy, log(level, message, data) { if (level === "warn") errors.push({ message, data }); },
    async invoke(channel, args) {
      const invocation = { channel, args };
      invocations.push(invocation);
      const handler = handlers.get(channel); assert.ok(handler);
      invocation.result = await handler(...args);
      return invocation.result;
    } });
  runtimeState.agentHostBridge = bridge;
  registerAgentIpc({ registrar: { handle(channel, handler) { handlers.set(channel, handler); } }, getHost: () => host,
    getSidecar: () => sidecar, getAgentHostBridge: () => bridge, logger, dataDir, activeTurns,
    agentExtensions: { cancelPrompts() {} }, cancelSessionTools() {}, persistenceOutbox: outbox,
    isTurnDispatchable: coordination.isTurnDispatchable, activeTurnUsages: coordination.activeTurnUsages,
    approvedExecutionIdsBySession, claimedExecutionSessions, acquireSessionOperation: coordination.acquireSessionOperation,
    resolveAgentRuntimeLaunch: unusedLaunch, lockAbortReason: coordination.lockAbortReason,
    ...planRuntime, waitForTurnSettlement: coordination.waitForTurnSettlement, emitAgentEvent() {},
    setNotificationViewingSessionId() {}, optionalWorkspaceRoot: async () => workspace,
    composerCommandService: { buildComposerCommands: async () => [] }, loadComposerTemplatesCached: async () => [] });
  checkpointer = new InflightCheckpointer(checkpoint => host.call("session.saveInflightMessage", checkpoint));
  const persistence = createEventPersistence({ runtimeState, steeringReplies: new Set(), activeTurns, activeToolCalls,
    activeToolCallKey: coordination.activeToolCallKey, approvedExecutionIdsBySession, approvedExecutionTurns,
    planSubmissionTurnIds, planSubmissionTurnKey: coordination.planSubmissionTurnKey, inflightCheckpointer: checkpointer,
    persistenceOutbox: outbox, addActiveTurnUsage: coordination.addActiveTurnUsage, logger,
    ...planRuntime, isStaleTerminalEvent: coordination.isStaleTerminalEvent, emitAgentEvent() {} });
  service = createTeamDeliveryService({ principal: DESKTOP_PRINCIPAL, getHost: () => host, getBridge: () => bridge, activeTurns,
    log(message, data) { errors.push({ message, data }); } });
  detachSidecar = sidecar.onNotification((method, envelope) => {
    if (method !== "agent.event") return;
    runtimeEvents.push(envelope);
    if (!coordination.isStaleTerminalEvent(envelope)) bridge.ingest(envelope);
    persistence.persistAgentEvent(envelope);
    if (envelope.event.type === "tool_end") toolEndWaiters.get(envelope.turnId)?.resolve(envelope.event);
  });
  detachHost = host.onNotification((method, params) => {
    if (method !== "team.interruptRequested") return;
    notices.push({ method, params });
    const delivery = service.onNotification(method, params);
    deliveries.push(delivery);
    delivery.catch(error => errors.push(error));
  });
  const prompt = async marker => {
    const { turnId } = await host.call("session.beginTurn", { sessionId: member });
    activeTurns.set(member, turnId);
    const ended = deferred(); endedWaiters.set(turnId, ended);
    const toolEnd = deferred(); toolEndWaiters.set(turnId, toolEnd);
    await sidecar.call("agent.prompt", { sessionId: member, turnId, content: `FIXTURE_${marker}`, mode: "agent", projectPath: workspace,
      executionProfile: "team", teamContext: { teamSessionId: lead.id, callerSessionId: member, isLead: false, memberName: "tester" },
      thinkingLevel: "off", subagents: [], pluginTools: [], pluginSkills: [], trustedExtensions: [], commandShell: shell,
      provider: { id: provider.id, name: "Fixture", modelId: "interrupt-fixture", baseUrl, apiKey: "", authKind: "none",
        apiStyle: "chat_completions", supportsReasoning: false, supportedThinkingLevels: ["off"], modelConfig: { source: "generic",
          name: "Fixture", baseUrl, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 256000, maxTokens: 32000 } } });
    return { turnId, ended: ended.promise, toolEnd: toolEnd.promise };
  };
  const force = async reason => host.call("team.interruptMember", { teamSessionId: lead.id, callerSessionId: lead.id, memberName: "tester", force: true, reason });

  const foreground = await prompt("FOREGROUND");
  await markerReady(foregroundMarker);
  const childPid = Number(await readFile(foregroundMarker, "utf8"));
  assert.ok(Number.isInteger(childPid) && childPid > 0);
  await assert.rejects(host.call("team.interruptMember", { teamSessionId: lead.id, callerSessionId: lead.id, memberName: "tester" }),
    error => error.errorCode === "TEAM_MEMBER_ACTIVE");
  assert.equal(notices.length, 0);
  assert.doesNotThrow(() => process.kill(childPid, 0), "refusal must preserve the running process");
  assert.equal((await force("User superseded the foreground test")).interrupted, true);
  await bounded(Promise.all(deliveries), "foreground notification dispatch");
  assert.equal((await bounded(foreground.ended, "foreground turn abort")).reason, "aborted");
  const foregroundResult = await bounded(foreground.toolEnd, "foreground Bash cancellation");
  assert.ok(JSON.stringify(foregroundResult).includes("TOOL_ABORTED"));
  assert.throws(() => process.kill(childPid, 0), error => error.code === "ESRCH", "the foreground process tree must be gone");
  assert.equal(bridge.agentHost.getTurn(foreground.turnId).status, "interrupted");

  const background = await prompt("BACKGROUND");
  await bounded(gateEntered.get("BACKGROUND").promise, "accepted background followed by provider wait");
  await bounded(background.toolEnd, "accepted background receipt");
  const jobs = (await host.call("backgroundProcesses.list", { sessionId: member })).processes;
  assert.equal(jobs.length, 1);
  const backgroundId = jobs[0].id;
  assert.equal(jobs[0].status, "running");
  // Hold the real Main session-operation gate after the notification's first
  // identity check, then let the old turn finish and admit its replacement.
  releaseRaceGate = await coordination.acquireSessionOperation(member);
  assert.equal((await force("An old request races with natural completion")).interrupted, true);
  const oldNotice = notices.at(-1);
  assert.equal(oldNotice.params.turnId, background.turnId);
  const gatedAbort = invocations.at(-1);
  assert.equal(gatedAbort.channel, IPC.invoke.agentAbort);
  assert.equal(gatedAbort.args[0].turnId, background.turnId);
  assert.equal(gatedAbort.result, undefined, "the real Main abort handler must be held at its session-operation gate");
  providerGates.get("BACKGROUND")();
  assert.equal((await bounded(background.ended, "old turn natural completion")).reason, "completed");
  const replacement = await prompt("REPLACEMENT");
  await bounded(gateEntered.get("REPLACEMENT").promise, "replacement provider wait");
  releaseRaceGate(); releaseRaceGate = undefined;
  await bounded(Promise.all(deliveries), "stale abort handler gate");
  assert.deepEqual(gatedAbort.result, { ok: false, aborted: false }, "Main must refuse the old turn after awaiting its gate");
  const countBeforeReplay = invocations.filter(call => call.channel === IPC.invoke.agentAbort).length;
  await service.onNotification(oldNotice.method, oldNotice.params);
  assert.equal(invocations.filter(call => call.channel === IPC.invoke.agentAbort).length, countBeforeReplay,
    "an already stale notification must not even enter IPC abort");
  assert.equal(activeTurns.get(member), replacement.turnId);
  const replacementStatus = (await sidecar.call("agent.getStatus", { sessionId: member })).status;
  assert.equal(replacementStatus.currentTurnId, replacement.turnId);
  assert.equal(replacementStatus.isRunning, true);
  assert.equal((await host.call("backgroundProcesses.read", { sessionId: member, id: backgroundId })).process.status, "running");
  const staleRuntime = await sidecar.call("agent.abort", { sessionId: member, turnId: background.turnId });
  assert.deepEqual(staleRuntime, { ok: false, aborted: false });
  assert.equal((await sidecar.call("agent.getStatus", { sessionId: member })).status.isRunning, true);

  assert.equal((await force("End the replacement fixture request")).interrupted, true);
  await bounded(Promise.all(deliveries), "replacement notification dispatch");
  assert.equal((await bounded(replacement.ended, "replacement abort")).reason, "aborted");
  assert.equal((await host.call("backgroundProcesses.read", { sessionId: member, id: backgroundId })).process.status, "running",
    "runtime abort must preserve accepted Host-owned background work");
  await sidecar.call("agent.disposeSession", { sessionId: member });
  assert.equal((await host.call("backgroundProcesses.read", { sessionId: member, id: backgroundId })).process.status, "running",
    "runtime dispose must also preserve accepted Host-owned background work");
  // Explicit session-owned stop is cleanup after the preservation assertions,
  // and is deliberately not presented as a consequence of force interruption.
  const stopped = deferred();
  let readingTerminal = false;
  let terminalChangedDuringRead = false;
  const readTerminal = async () => {
    if (readingTerminal) { terminalChangedDuringRead = true; return; }
    readingTerminal = true;
    terminalChangedDuringRead = false;
    try {
      const detail = await host.call("backgroundProcesses.read", { sessionId: member, id: backgroundId });
      if (!["starting", "running", "stopping"].includes(detail.process.status)) stopped.resolve(detail.process);
    } catch (error) { stopped.reject(error); }
    finally {
      readingTerminal = false;
      if (terminalChangedDuringRead) void readTerminal();
    }
  };
  const detachTerminal = host.onNotification((method, params) => {
    if (method === "backgroundProcesses.changed" && params.sessionId === member && params.id === backgroundId) void readTerminal();
  });
  try {
    await host.call("backgroundProcesses.stop", { sessionId: member, id: backgroundId });
    await readTerminal();
    assert.equal((await bounded(stopped.promise, "explicit background process stop")).status, "stopped");
  } finally { detachTerminal(); }
  await outbox.flush(() => host);
  if (serverError) throw serverError;
  assert.deepEqual(errors, [], "unexpected Main/transport/persistence failures");
  console.log("PASS E2E-TEAM-member-interrupt-production-chain: Host → Main delivery → bridge/AgentHost → registered abort IPC → real sidecar/runtime; foreground process stopped, replacement survives stale notifications, accepted background survives abort/dispose until explicit stop");
} finally {
  releaseRaceGate?.();
  detachHost?.(); detachSidecar?.(); checkpointer?.dispose();
  await sidecar?.dispose();
  await host?.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
