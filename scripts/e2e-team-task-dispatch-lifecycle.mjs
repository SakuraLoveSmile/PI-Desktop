#!/usr/bin/env node
// Real Host, Main factories, bridge/AgentHost, sidecar and DesktopAgentRuntime.
// Only the provider and absent UI/extensions are fixture edges. No user profile.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC } from "@pi-desktop/shared";
import { HostProcess } from "../packages/host-runtime/dist/host-process.js";
import { AgentSidecar } from "../packages/host-runtime/dist/agent-sidecar.js";
import { InflightCheckpointer } from "../packages/host-runtime/dist/inflight-checkpoint.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { verifyBuildReceipt } from "./e2e/build-candidate-receipt.mjs";

const buildReceipt = await verifyBuildReceipt(resolveHostBinary());

register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const { createCollaborationRuntime } = await import("../apps/desktop/electron/main/services/collaboration-runtime.ts");
const { createAgentHostBridge, DESKTOP_PRINCIPAL } = await import("../apps/desktop/electron/main/agent-host-bridge.ts");
const { registerAgentIpc } = await import("../apps/desktop/electron/main/ipc/agent-ipc.ts");
const { createSessionCoordination } = await import("../apps/desktop/electron/main/runtime/session-coordination.ts");
const { createPlanRuntime } = await import("../apps/desktop/electron/main/runtime/plans.ts");
const { createEventPersistence } = await import("../apps/desktop/electron/main/runtime/event-persistence.ts");
const { PersistenceOutbox } = await import("../apps/desktop/electron/main/persistence-outbox.ts");

const { createSessionLaunchRuntime } = await import("../apps/desktop/electron/main/runtime/session-launch.ts");
const { ModelsDevCatalog } = await import("../apps/desktop/electron/main/models-dev-catalog.ts");
const { capabilitiesFromModelConfig } = await import("@pi-desktop/agent-runtime");

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

const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
const executedScriptHash = await hash(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), "pi-team-dispatch-"));
const workspace = join(root, "workspace"), dataDir = join(root, "data"), home = join(root, "home");
await Promise.all([workspace, dataDir, home].map(path => mkdir(path, { recursive: true })));
const originalHome = process.env.HOME;
process.env.HOME = home;
const requests = [];
const counts = new Map();
const gates = new Map();
const occupied = deferred(), latest = deferred(), ordinaryLast = deferred(), leadReady = deferred(), firstSendsDone = deferred(), repeatDone = deferred();
let task, completionRevision, repeatRevision, serverError;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST");
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const user = request.messages.filter(message => message.role === "user").at(-1);
    const input = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
    const marker = input.includes("Team review ") && input.includes(" confirmed. Approved members: tester.") ? "FIXTURE_SENDS" : input.match(/FIXTURE_(OCCUPIED|SENDS|REPEAT|DISPATCH_[ABC]|MAIL_[123])/g)?.at(-1);
    assert.ok(marker, "unexpected provider request outside the isolated scenario");
    const step = (counts.get(marker) ?? 0) + 1;
    counts.set(marker, step);
    requests.push({ marker, step, input, arrivedAt: new Date().toISOString() });
    const reply = tool => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ id: randomUUID(), model: "dispatch-fixture",
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      emit(tool ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
        function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: "assistant", content: "Fixture complete." }, null);
      emit({}, tool ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    };
    const send = (content, revision) => ({ name: "send_message", args: { targetMemberName: "tester", content,
      ...(revision ? { taskDispatch: { taskId: task.taskId, expectedRevision: revision } } : {}) } });
    if (marker === "FIXTURE_OCCUPIED") {
      assert.equal(step, 1); gates.set(marker, () => reply()); occupied.resolve();
    } else if (marker === "FIXTURE_SENDS") {
      assert.ok(step <= 8, "Lead may not retry sends");
      if (step === 1) { gates.set("LEAD_START", () => reply(send("FIXTURE_DISPATCH_A", task.revision))); leadReady.resolve(); }
      else if (step === 2) reply(send("FIXTURE_MAIL_1"));
      else if (step === 3) reply(send("FIXTURE_DISPATCH_B", task.revision));
      else if (step === 4) reply(send("FIXTURE_MAIL_2"));
      else if (step === 5) { gates.set("LEAD_REPEAT", () => reply(send("FIXTURE_DISPATCH_C", repeatRevision))); firstSendsDone.resolve(); }
      else if (step === 6) reply(send("FIXTURE_MAIL_3"));
      else if (step === 7) { gates.set("LEAD_END", () => reply()); repeatDone.resolve(); }
      else throw new Error("Unexpected lead continuation");
    } else if (marker === "FIXTURE_DISPATCH_B") {
      assert.ok(step <= 3, "Expert may not retry task work");
      if (step === 1) reply({ name: "task_update", args: { taskId: task.taskId, expectedRevision: task.revision, status: "in_progress" } });
      else if (step === 2) { gates.set(marker, () => reply({ name: "task_update", args: { taskId: task.taskId, expectedRevision: completionRevision, status: "completed" } })); latest.resolve(); }
      else reply();
    } else {
      assert.ok(marker.startsWith("FIXTURE_MAIL_"), "Canceled dispatch must never reach provider");
      assert.equal(step, 1, "Each ordinary FIFO mail must be consumed exactly once");
      reply();
      if (marker === "FIXTURE_MAIL_3") ordinaryLast.resolve();
    }
  } catch (error) {
    serverError = error;
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error));
  }
});
let host, sidecar, checkpointer, detachHost, detachSidecar;
let bridge, planRuntime, service, acceptedEvidence;
const ownedPids = [];
const errors = [], runtimeEvents = [], invocations = [], notices = [], deliveries = [];
const activeTurns = new Map(), handlers = new Map(), endedWaiters = new Map();
const settledTurns = new Map();
const logger = { app(...args) { if (args[1] === "warn" || args[1] === "error") errors.push(args); } };
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  host = new HostProcess({ binaryPath: resolveHostBinary(), dataDir, env: { HOME: home }, onStderr: text => {
    if (process.env.DEBUG_TEAM_DISPATCH) process.stderr.write(text);
  } });
  ownedPids.push({ kind: "host", pid: host.child.pid });
  await host.call("app.handshake", { protocolVersion: 11 });
  await host.call("workspace.set", { path: workspace });
  const { provider } = await host.call("providers.create", { name: "Dispatch fixture", vendorKey: "custom", baseUrl,
    authKind: "none", apiStyle: "chat_completions", defaultModelId: "dispatch-fixture",
    models: [{ id: "dispatch-fixture", thinkingLevels: ["off"] }] });
  const { session: lead } = await host.call("session.create", { mode: "agent", executionProfile: "team", projectPath: workspace,
    permissionMode: "auto", providerId: provider.id, modelId: "dispatch-fixture", thinkingLevel: "off" });
  await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
  const declaration = await host.call("session.beginTurn", { sessionId: lead.id });
  const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id,
    leadTurnId: declaration.turnId, strategy: "delegate", reason: "Verify production task dispatch", members: [{ name: "tester", contextKind: "fresh" }] });
  await host.call("session.endTurn", { turnId: declaration.turnId, status: "completed", createNotification: false });
  const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
  const member = decision.memberSessionIds[0];

  sidecar = new AgentSidecar({ launch: { command: process.execPath,
    args: [fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))], cwd: workspace,
    env: { ...process.env, HOME: home, PI_DESKTOP_DATA_DIR: dataDir } }, onStderr: text => {
      if (process.env.DEBUG_TEAM_DISPATCH) process.stderr.write(text);
    } });
  ownedPids.push({ kind: "sidecar", pid: sidecar.child.pid });
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
  const launchRuntime = createSessionLaunchRuntime({ runtimeState, logger,
    userMcp: { setRecords() {}, toolsForProject: async () => [] },
    plugins: { listLoaded: () => [], getSkills: () => [], getTools: () => [], getAgentExtensions: () => [] },
    sessionProjects: new Map(), dataDir, vendorOAuth: {},
    modelsDevCatalog: new ModelsDevCatalog({ catalogPath: fileURLToPath(new URL("../apps/desktop/resources/models.dev/api.json", import.meta.url)) }),
    getWorkspacePath: () => workspace, pluginActiveInProject: () => false,
    bindingForModel: (row, id) => row.models?.find(model => model.id === id),
    effectiveSubagentModelConfig: (_provider, _id, modelConfig) => ({ modelConfig, capabilities: capabilitiesFromModelConfig(modelConfig) }),
    normalizeThinkingLevel: () => "off" });
  const resolveAgentRuntimeLaunch = launchRuntime.resolveAgentRuntimeLaunch;
  const collaborationRuntime = createCollaborationRuntime({ activeTurns, principal: DESKTOP_PRINCIPAL,
    getHost: () => host, getSidecar: () => sidecar, getBridge: () => bridge,
    isPluginLoaded: () => false, isQuitting: () => false, logger, persistenceOutbox: outbox, sendToRenderer() {} });
  service = collaborationRuntime.teamDelivery;
  planRuntime = createPlanRuntime({ runtimeState, planState: { approvedExecutionDrain: null }, logger,
    sendToRenderer() {}, coordination, scheduledRunsBySession: new Map(), activeToolCalls, planSubmissionTurnIds,
    approvedExecutionIdsBySession, claimedExecutionSessions, approvedExecutionTurns, startedApprovedExecutions: new Set(),
    finishedApprovedExecutions: new Set(), dispatchingApprovedExecutions: new Set(), inFlightExecutionFinishes: new Set(),
    pendingExecutionFinishes: new Map(), announceTurnEnded(payload) { settledTurns.set(payload.turnId, payload); endedWaiters.get(payload.turnId)?.resolve(payload); },
    emitAgentEvent() {}, acquireSessionOperation: coordination.acquireSessionOperation, resolveAgentRuntimeLaunch,
    isQuitting: () => false, persistenceOutbox: outbox,
    onTurnSettled(sessionId, turnId) {
      const settlement = collaborationRuntime.sessionCollaboration.settle(sessionId, turnId);
      deliveries.push(settlement); return settlement;
    } });
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
    resolveAgentRuntimeLaunch, lockAbortReason: coordination.lockAbortReason,
    ...planRuntime, waitForTurnSettlement: coordination.waitForTurnSettlement, emitAgentEvent() {},
    setNotificationViewingSessionId() {}, optionalWorkspaceRoot: async () => workspace,
    composerCommandService: { buildComposerCommands: async () => [] }, loadComposerTemplatesCached: async () => [] });
  checkpointer = new InflightCheckpointer(checkpoint => host.call("session.saveInflightMessage", checkpoint));
  const persistence = createEventPersistence({ runtimeState, steeringReplies: new Set(), activeTurns, activeToolCalls,
    activeToolCallKey: coordination.activeToolCallKey, approvedExecutionIdsBySession, approvedExecutionTurns,
    planSubmissionTurnIds, planSubmissionTurnKey: coordination.planSubmissionTurnKey, inflightCheckpointer: checkpointer,
    persistenceOutbox: outbox, addActiveTurnUsage: coordination.addActiveTurnUsage, logger,
    ...planRuntime, isStaleTerminalEvent: coordination.isStaleTerminalEvent, emitAgentEvent() {} });
  detachSidecar = sidecar.onNotification((method, envelope) => {
    if (method !== "agent.event") return;
    runtimeEvents.push(envelope);
    if (!coordination.isStaleTerminalEvent(envelope)) bridge.ingest(envelope);
    persistence.persistAgentEvent(envelope);

  });
  detachHost = host.onNotification((method, params) => {
    if (!["team.changed", "team.messageQueued", "team.queueChanged"].includes(method)) return;
    notices.push({ method, params });
    const delivery = service.onNotification(method, params);
    deliveries.push(delivery);
    delivery.catch(error => errors.push(error));
  });
  async function settled(turnId) {
    if (settledTurns.has(turnId)) return settledTurns.get(turnId);
    const ended = deferred(); endedWaiters.set(turnId, ended);
    return bounded(ended.promise, `turn ${turnId} persistence settlement`);
  }
  async function settleDeliveries() {
    // Notifications may append more work during Host calls; drain to a stable
    // boundary rather than sleeping or manually delivering synthetic events.
    for (;;) {
      const count = deliveries.length;
      await bounded(Promise.all(deliveries), "Main delivery notifications");
      if (count === deliveries.length) return;
    }
  }
  const start = async (sessionId, marker, sessionMessageId) => {
    const result = await bridge.agentHost.startTurn(DESKTOP_PRINCIPAL, {
      sessionId, input: { text: marker, ...(sessionMessageId ? { sessionMessageId } : {}) }, context: { requestId: randomUUID() }, admission: "reject" });
    assert.ok(result.turn.id);
    return result.turn.id;
  };
  const getMail = async id => (await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: lead.id, messageId: id })).message;
  const messages = async () => (await host.call("team.listMessages", { teamSessionId: lead.id, callerSessionId: lead.id, sessionId: member })).messages;
  const getTask = async () => (await host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id })).tasks.find(row => row.taskId === task.taskId);
  const leadTurn = await start(lead.id, "FIXTURE_SENDS", decision.messageIds[0]);
  await bounded(leadReady.promise, "Approved lead entered provider");
  task = (await host.call("team.createTask", { teamSessionId: lead.id, callerSessionId: lead.id,
    subject: "Explicit dispatch lifecycle", ownerMemberName: "tester" })).task;
  const initialTurn = await start(member, "FIXTURE_OCCUPIED");
  await bounded(occupied.promise, "Expert occupying real provider turn");
  gates.get("LEAD_START")();
  await bounded(firstSendsDone.promise, "Lead sends A, ordinary 1, B, ordinary 2");
  await settleDeliveries();
  const allFirst = await messages();
  const byContent = new Map(allFirst.map(mail => [mail.content, mail]));
  const a = byContent.get("FIXTURE_DISPATCH_A"), b = byContent.get("FIXTURE_DISPATCH_B");
  const ordinary1 = byContent.get("FIXTURE_MAIL_1"), ordinary2 = byContent.get("FIXTURE_MAIL_2");
  for (const mail of [a, b, ordinary1, ordinary2]) assert.ok(mail?.id);
  assert.equal(a.status, "cancelled"); assert.equal(a.dispatchCancellation, "superseded"); assert.equal(a.turnId, undefined);
  assert.equal(b.status, "queued"); assert.equal(b.targetBusyAtSend, true);
  assert.deepEqual(bridge.agentHost.queue.list(member).map(entry => entry.sessionMessageId), [ordinary1.id, b.id, ordinary2.id],
    "Host supersede notification must remove only the canceled authenticated Main mirror entry");
  assert.equal(requests.filter(request => request.marker === "FIXTURE_DISPATCH_A").length, 0);
  assert.equal((await sidecar.call("agent.getStatus", { sessionId: member })).status.currentTurnId, initialTurn);
  const beforeRelease = bridge.agentHost.queue.list(member).map(entry => ({ id: entry.id, sessionMessageId: entry.sessionMessageId, idempotencyKey: entry.idempotencyKey }));
  gates.get("FIXTURE_OCCUPIED")();
  assert.equal((await settled(initialTurn)).reason, "completed");
  await bounded(latest.promise, "Expert reaches latest dispatch after ordinary FIFO mail");
  const activeTask = await getTask();
  assert.equal(activeTask.status, "in_progress");
  completionRevision = repeatRevision = activeTask.revision;
  gates.get("LEAD_REPEAT")();
  await bounded(repeatDone.promise, "Lead queues repeat C and ordinary 3");
  await settleDeliveries();
  const c = (await messages()).find(mail => mail.content === "FIXTURE_DISPATCH_C");
  assert.ok(c?.id); assert.equal(c.status, "queued");
  assert.ok(bridge.agentHost.queue.list(member).some(entry => entry.sessionMessageId === c.id));
  const bRunning = await getMail(b.id);
  assert.equal(bRunning.status, "running"); assert.ok(bRunning.turnId);
  gates.get("FIXTURE_DISPATCH_B")();
  assert.equal((await settled(bRunning.turnId)).reason, "completed");
  await bounded(ordinaryLast.promise, "Unrelated ordinary FIFO mail preserved after task completion");
  await settleDeliveries();
  const finalMail = await messages();
  const mail3 = finalMail.find(mail => mail.content === "FIXTURE_MAIL_3");
  assert.ok(mail3?.turnId);
  await settled(mail3.turnId);
  await settleDeliveries();
  const finalTask = await getTask();
  assert.equal(finalTask.status, "completed");
  const canceled = await getMail(c.id);
  assert.equal(canceled.status, "cancelled"); assert.equal(canceled.dispatchCancellation, "task_completed"); assert.equal(canceled.turnId, undefined);
  assert.deepEqual(bridge.agentHost.queue.list(member), []);
  const promptInputs = invocations.filter(call => call.channel === IPC.invoke.agentPrompt && call.args[0].sessionId === member).map(call => call.args[0]);
  assert.deepEqual(promptInputs.map(input => input.sessionMessageId ?? input.content), ["FIXTURE_OCCUPIED", ordinary1.id, b.id, ordinary2.id, mail3.id]);
  const primaryRequests = requests.filter(request => request.step === 1 && !["FIXTURE_SENDS", "FIXTURE_REPEAT"].includes(request.marker));
  assert.deepEqual(primaryRequests.map(request => request.marker), ["FIXTURE_OCCUPIED", "FIXTURE_MAIL_1", "FIXTURE_DISPATCH_B", "FIXTURE_MAIL_2", "FIXTURE_MAIL_3"]);
  const bInput = primaryRequests.find(request => request.marker === "FIXTURE_DISPATCH_B").input;
  assert.ok(bInput.includes("may be stale")); assert.ok(bInput.includes(task.taskId));
  assert.equal(primaryRequests.filter(request => request.marker === "FIXTURE_DISPATCH_B").length, 1);
  assert.equal(requests.filter(request => ["FIXTURE_DISPATCH_A", "FIXTURE_DISPATCH_C"].includes(request.marker)).length, 0);
  for (const mail of [ordinary1, b, ordinary2, mail3]) {
    const completed = await getMail(mail.id);
    assert.equal(completed.status, "completed"); assert.equal(completed.deliveryStatus, "acknowledged");
    const session = (await host.call("session.get", { id: member, messageLimit: 50 })).session;
    const userMessages = session.messages.filter(message => message.role === "user" && message.sessionMessage?.messageId === mail.id);
    assert.equal(userMessages.length, 1, "Authenticated body must enter durable transcript exactly once");
    assert.equal(userMessages[0].content, mail.content);
  }
  gates.get("LEAD_END")();
  assert.equal((await settled(leadTurn)).reason, "completed");
  await outbox.flush(() => host);
  if (serverError) throw serverError;
  assert.deepEqual(errors, [], "Unexpected Main/transport/persistence failures");
  const backgroundCounts = {};
  for (const sessionId of [lead.id, member]) {
    backgroundCounts[sessionId] = (await host.call("backgroundProcesses.list", { sessionId })).processes.length;
    assert.equal(backgroundCounts[sessionId], 0);
  }
  const sourceModules = ["services/team-delivery.ts", "services/collaboration-runtime.ts", "services/session-collaboration.ts",
    "agent-host-bridge.ts", "ipc/agent-ipc.ts", "runtime/plans.ts", "runtime/event-persistence.ts", "runtime/session-launch.ts"];
  const mainSourceHashes = Object.fromEntries(await Promise.all(sourceModules.map(async name => [name, await hash(fileURLToPath(new URL(`../apps/desktop/electron/main/${name}`, import.meta.url)))])));
  acceptedEvidence = {
    scenario: "E2E-TEAM-busy-member-latest-task-dispatch + E2E-TEAM-completed-task-retires-queued-dispatch",
    testedSourceSha: buildReceipt.source.head, baseRevision: buildReceipt.source.baseMain,
    compiledCandidateSha: buildReceipt.source.head, buildReceipt,
    artifacts: { hostBinary: resolveHostBinary(), hostSha256: await hash(resolveHostBinary()),
      runtimeSha256: await hash(fileURLToPath(new URL("../packages/agent-runtime/dist/runtime.js", import.meta.url))),
      scriptSha256: executedScriptHash,
      agentHostSha256: await hash(fileURLToPath(new URL("../packages/agent-host/dist/agent-host.js", import.meta.url))),
      sidecarSha256: await hash(fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url))),
      mainSourceHashes },
    initialTurn, leadTurn, beforeRelease, providerInputs: primaryRequests,
    providerCounts: Object.fromEntries(counts), expertPromptOrder: promptInputs,
    hostLedger: await messages(), task: finalTask,
    notificationCounts: Object.fromEntries([...new Set(notices.map(note => note.method))].map(method => [method, notices.filter(note => note.method === method).length])),
    exactOnce: { latestDispatch: 1, supersededDispatch: 0, completedTaskRepeat: 0, ordinaryMail: 3 },
    backgroundCounts, completedAt: new Date().toISOString(),
  };
} finally {
  detachHost?.(); detachSidecar?.(); checkpointer?.dispose();
  await sidecar?.dispose(); await host?.dispose();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  await rm(root, { recursive: true, force: true });
}

assert.ok(acceptedEvidence, "The scenario must complete before writing passing evidence");
assert.equal(existsSync(root), false, "The isolated profile must be removed");
assert.equal(server.listening, false);
for (const child of ownedPids) {
  assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH", `${child.kind} process must leave after dispose`);
}
acceptedEvidence.cleanup = { cleaned: true, temporaryRootRemoved: true, providerServerClosed: true, ownedProcessesExited: ownedPids };
await verifyBuildReceipt(resolveHostBinary(), { expected: buildReceipt });
const evidencePath = fileURLToPath(new URL("../.review-evidence/closeout-dispatch.json", import.meta.url));
await mkdir(join(evidencePath, ".."), { recursive: true });
await writeFile(evidencePath, JSON.stringify(acceptedEvidence, null, 2) + "\n");
console.log("PASS WP10 real Host → Main reconciliation → AgentHost/registered prompt IPC → sidecar/runtime → loopback provider: A superseded, B exactly once, C canceled on completed task, ordinary FIFO preserved; owned processes/profile removed");
