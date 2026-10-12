#!/usr/bin/env node
// Real Host, Main delivery, AgentHost and Runtime; only the provider is scripted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { readNdjsonLines } from "../packages/shared/dist/ndjson.js";
import { formatSessionMessage } from "../packages/shared/dist/session-collaboration.js";
import { createHostQueueStore, createHostSessionPort } from "../packages/host-runtime/dist/host-ports.js";
import { AgentHost } from "../packages/agent-host/dist/index.js";
import { DesktopAgentRuntime } from "../packages/agent-runtime/dist/runtime.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";

const base = "26db5043860db8412a988cdce31362a424eea407";
const principal = { subject: "ordinary-inbox-fixture-owner", roles: ["owner"], pairedDevice: true };
const reportBodies = ["EXPERT_REPORT_A: command one completed; do not repeat.", "EXPERT_REPORT_B: command two completed; do not repeat."];
const binary = resolveHostBinary();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = execFileSync("git", ["ls-files", "-c", "-o", "--exclude-standard", "crates/host-core/src", "packages/agent-runtime/src", "packages/agent-host/src", "packages/host-runtime/src", "packages/shared/src", "apps/desktop/electron/main/services", "scripts/e2e-team-agent-ordinary-inbox.mjs"], { encoding: "utf8" }).trim().split("\n").sort();
const fingerprint = async () => {
  const entries = await Promise.all(sourcePaths.map(async path => [path, sha256(await readFile(path))]));
  return { sha256: sha256(JSON.stringify(entries)), files: Object.fromEntries(entries) };
};
const evidence = { scenario: "E2E-TEAM-agent-lead-wait-boundary-ordinary-inbox", base,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  hostBinary: binary, hostBinarySha256: sha256(await readFile(binary)), source: await fingerprint(),
  builtModules: {}, timeline: [], result: "running" };
for (const path of ["packages/agent-runtime/dist/runtime.js", "packages/agent-runtime/dist/team/wait-for-updates.js", "packages/agent-host/dist/agent-host.js", "packages/host-runtime/dist/host-ports.js", "packages/shared/dist/team-ordinary-inbox.js"]) evidence.builtModules[path] = sha256(await readFile(path));
const record = (stage, data = {}) => evidence.timeline.push({ at: Date.now(), stage, ...data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const assistant = content => ({ role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", content,
  stopReason: content.some(block => block.type === "toolCall") ? "toolUse" : "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
// Bundle the actual Main module without touching Desktop output; its internal
// imports use the production bundler's extension resolution, not Node's TS loader.
const { build } = createRequire(new URL("../packages/agent-runtime/package.json", import.meta.url))("esbuild");
const mainBundle = await build({ entryPoints: ["apps/desktop/electron/main/services/team-delivery.ts"], bundle: true, platform: "node", format: "esm", write: false });
evidence.mainBundleSha256 = sha256(mainBundle.outputFiles[0].contents);
const { createTeamDeliveryService } = await import(`data:text/javascript;base64,${Buffer.from(mainBundle.outputFiles[0].contents).toString("base64")}`);
const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-ordinary-inbox-"));
try {
  await withScenario(evidence.scenario, async ({ host, workspace, dataDir }) => {
    const { provider } = await host.call("providers.create", { name: "Ordinary inbox fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }] });
    const { session: lead } = await host.call("session.create", { title: "Wait-boundary ordinary inbox", mode: "agent", executionProfile: "team", projectPath: workspace, providerId: provider.id, modelId: "fixture", permissionMode: "auto" });
    await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
    const seed = await host.call("session.beginTurn", { sessionId: lead.id });
    const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: seed.turnId, strategy: "delegate", reason: "Expert runs exactly two commands and reports; Lead never repeats them.", members: [{ name: "expert", contextKind: "fresh" }] });
    const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
    await host.call("session.endTurn", { turnId: seed.turnId, status: "completed", createNotification: false });
    const expertId = decision.memberSessionIds[0];
    await host.call("session.configure", { id: expertId, mode: "agent", permissionMode: "auto" });
    evidence.sessions = { lead: lead.id, expert: expertId, scopeTurnId: seed.turnId };
    const activeTurns = new Map(), runtimes = new Map(), listeners = new Set(), runs = new Set();
    const reportIds = [], reads = [], ackParams = [], leadPrompts = [], turnIds = [];
    const leadStarted = deferred(), reportsStored = deferred(), expertDone = deferred(), leadDone = deferred();
    const failed = deferred();
    let failure, agentHost, service, leadStep = 0, expertStep = 0, initialLead = true, activeLeadTurn;
    const fail = error => { failure ||= error; failed.resolve(); };
    const track = promise => { runs.add(promise); promise.finally(() => runs.delete(promise)).catch(fail); return promise; };
    const runtimeHost = { async call(method, params) {
      record("rpc-start", { method, sessionId: params?.sessionId ?? params?.callerSessionId });
      // The production Main service owns this internal authority/admission route.
      const value = (method === "team.readOrdinaryInbox" || method === "team.ackOrdinaryInbox")
        ? await service.ordinaryInboxRequest(method, params)
        : await host.call(method, params);
      if (method === "team.readOrdinaryInbox") { reads.push({ params, value }); record("inbox-read", { boundaryId: params.boundaryId, messageIds: value?.messages?.map(m => m.messageId) }); }
      if (method === "team.ackOrdinaryInbox") {
        ackParams.push(params);
        // Replay exactly the same authenticated ACK while its owning turn runs.
        const replay = await service.ordinaryInboxRequest(method, params); assert.deepEqual(replay, value);
        record("ack-replayed", { boundaryId: params.boundaryId, messageIds: params.messageIds });
      }
      if (method === "team.sendMessage" && params.callerSessionId === expertId) {
        reportIds.push(value.message.id); record("report-stored", { messageId: value.message.id, content: value.message.content, createdAt: value.message.createdAt });
        track(service.dispatchMessage({ teamSessionId: lead.id, messageId: value.message.id }).catch(fail));
        track(service.onNotification("team.messageQueued", { teamSessionId: lead.id, messageId: value.message.id }).catch(fail));
        if (reportIds.length === 2) reportsStored.resolve();
      }
      if (method === "session.queuePush") record("queue-admitted", { messageId: params.sessionMessageId, idempotencyKey: params.idempotencyKey });
      return value;
    }, onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
    const reader = readNdjsonLines(host.child.stdout, line => {
      const notification = JSON.parse(line);
      if (notification.id != null || !notification.method) return;
      record("notification", { method: notification.method, messageId: notification.params?.messageId });
      for (const listener of listeners) listener(notification.method, notification.params);
      if (service) track(service.onNotification(notification.method, notification.params).catch(fail));
    });
    const runtimePort = {
      isBusy: id => runtimes.get(id)?.getStatus().isRunning === true,
      async stop(id) { await runtimes.get(id)?.abort(); return { requested: true }; },
      async abort(id) { await runtimes.get(id)?.abort(); },
      async prompt(request) {
        assert.ok(request.sessionId !== lead.id || initialLead, "Mail must not start another Lead turn");
        const started = await host.call("session.beginTurn", { sessionId: request.sessionId, ...(request.sessionMessageId ? { sessionMessageId: request.sessionMessageId } : {}) });
        if (request.sessionId === lead.id) { initialLead = false; activeLeadTurn = started.turnId; }
        activeTurns.set(request.sessionId, started.turnId); turnIds.push({ sessionId: request.sessionId, turnId: started.turnId, sessionMessageId: request.sessionMessageId });
        record("runtime-turn-start", { sessionId: request.sessionId, turnId: started.turnId });
        const teamContext = await host.call("team.getRuntimeContext", { sessionId: request.sessionId });
        const runtime = new DesktopAgentRuntime({ host: runtimeHost, sessionId: request.sessionId, mode: "agent", executionProfile: "team", teamContext, projectPath: workspace, thinkingLevel: "off",
          commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
          provider: { id: provider.id, name: "Fixture", modelId: "fixture", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", authKind: "none", supportsReasoning: false, modelConfig: { source: "generic", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
          onEvent(envelope) {
            const event = envelope.event;
            if (event.type === "tool_end") record("tool-return", { sessionId: request.sessionId, event });

          } });
        runtimes.set(request.sessionId, runtime);
        runtime.models = { streamSimple(_model, context) {
          const stream = createAssistantMessageEventStream();
          const isLead = request.sessionId === lead.id;
          const bodies = context.messages.filter(m => m.role === "user").flatMap(m => reportBodies.filter(body => JSON.stringify(m.content).includes(body)));
          record("provider-request", { sessionId: request.sessionId, turnId: started.turnId, reportBodies: bodies });
          (async () => {
            let content;
            const tool = (name, args) => [{ type: "toolCall", id: `fixture-${isLead ? "lead" : "expert"}-${isLead ? leadStep : expertStep}`, name, arguments: args }];
            if (isLead) {
              leadStep++; assert.ok(leadStep <= 6, "Lead provider sequence must be bounded");
              leadPrompts.push(bodies);
              if (bodies.length) {
                const delivered = reads.flatMap(read => read.value?.messages ?? []);
                const actualMessages = context.messages.filter(m => m.role === "user" && reportBodies.some(body => JSON.stringify(m.content).includes(body)));
                assert.deepEqual(actualMessages.map(m => m.content), delivered.map(m => formatSessionMessage(m.message.content, m.message.sessionMessage)), "Model sees authenticated agent framing with no new user authorization");
                evidence.modelReports = actualMessages;
              }
              if (leadStep === 1) { assert.deepEqual(bodies, []); leadStarted.resolve(); content = tool("task_create", { subject: "Run exactly two isolated commands", ownerMemberName: "expert", writeScopes: [] }); }
              else if (leadStep === 2) content = tool("send_message", { targetMemberName: "expert", content: "Run exactly two sleep 0.05 background commands, send report A and B, and never retry." });
              else if (leadStep === 3) { await reportsStored.promise; assert.deepEqual(bodies, []); content = tool("team_status", {}); }
              else if (leadStep === 4) { assert.deepEqual(bodies, []); content = tool("wait_for_updates", { timeoutSeconds: 10 }); }
              else if (leadStep === 5) { assert.deepEqual(bodies, reportBodies, "First wait boundary consumes both reports in FIFO order"); content = tool("wait_for_updates", { timeoutSeconds: 1 }); }
              else { assert.deepEqual(bodies, reportBodies, "Repeated wait never duplicates reports"); content = [{ type: "text", text: "Lead ran no commands; expert ran exactly two. Both authenticated reports were consumed in this turn." }]; }
            } else {
              expertStep++; assert.ok(expertStep <= 5, "Expert cannot retry commands");
              if (expertStep <= 2) content = tool("Bash", { command: "sleep 0.05", run_in_background: true });
              else if (expertStep <= 4) { await leadStarted.promise; content = tool("send_message", { targetMemberName: "Lead", content: reportBodies[expertStep - 3] }); }
              else content = [{ type: "text", text: "Two commands complete and both reports sent." }];
            }
            const message = assistant(content); stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
          })().catch(error => { fail(error); stream.end(assistant([{ type: "text", text: String(error) }])); });
          return stream;
        } };
        let input = request.content;
        if (request.sessionMessageId) {
          const { message } = await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: request.sessionId, messageId: request.sessionMessageId });
          input = { text: request.content, sessionMessage: { messageId: message.id, sourceSessionId: message.sourceSessionId, sourceTitle: message.sourceMemberName, targetSessionId: message.targetSessionId, kind: "message", ...(message.senderHead ? { senderHead: message.senderHead } : {}) } };
        }
        track(runtime.prompt(input, `user-${started.turnId}`, started.turnId).then(async () => {
          record("runtime-turn-end", { sessionId: request.sessionId, turnId: started.turnId });
          await host.call("session.endTurn", { turnId: started.turnId, status: "completed", createNotification: false });
          activeTurns.delete(request.sessionId); agentHost.endTurn(request.sessionId, started.turnId, "completed");
          await host.call("session.collaboration.settle", { turnId: started.turnId });
          (request.sessionId === lead.id ? leadDone : expertDone).resolve();
        }).catch(fail));
        return started;
      }
    };
    agentHost = new AgentHost({ runtime: runtimePort, sessions: createHostSessionPort(() => runtimeHost), queueStore: createHostQueueStore(() => runtimeHost), approvals: {} });
    const stableHost = { call: host.call.bind(host), isAvailable: () => true };
    const bridge = { agentHost };
    const runtimeIdentity = {};
    service = createTeamDeliveryService({ principal, getHost: () => stableHost, getBridge: () => bridge, activeTurns, getRuntimeIdentity: () => runtimeIdentity, isTurnDispatchable: (id, turn) => activeTurns.get(id) === turn && runtimes.get(id)?.getStatus().isRunning === true, stopAtBoundary: async id => runtimePort.abort(id), log(message, data) { record("delivery-log", { message, ...data }); fail(new Error(`${message}: ${JSON.stringify(data)}`)); } });
    let deadline;
    try {
      await service.dispatchMessage({ teamSessionId: lead.id, messageId: decision.messageIds[0] });
      await Promise.race([Promise.all([leadDone.promise, expertDone.promise]), failed.promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Ordinary inbox fixture exceeded 45 seconds")), 45000); })]);
      if (failure) throw failure;
      assert.equal(turnIds.filter(t => t.sessionId === lead.id).length, 1);
      assert.equal(turnIds.find(t => t.sessionId === lead.id).turnId, activeLeadTurn);
      const leadTools = evidence.timeline.filter(e => e.stage === "tool-return" && e.sessionId === lead.id);
      assert.equal(leadTools.length, 5);
      for (const entry of leadTools) assert.ok(reportBodies.every(body => !JSON.stringify(entry.event.result).includes(body)), "Tool outputs never contain report bodies");
      assert.ok(leadTools.some(e => e.event.result.details?.reason === "ordinary_inbox"));
      const admitted = reads.flatMap(read => read.value?.messages ?? []);
      assert.deepEqual(admitted.map(m => m.messageId), reportIds);
      assert.ok(admitted.every(m => m.leadTurnId === activeLeadTurn && m.scopeTurnId === seed.turnId && m.phase === "persisted"));
      assert.equal(ackParams.length, 1);
      const detail = (await host.call("session.get", { id: lead.id })).session;
      const storedReports = detail.messages.filter(m => reportBodies.includes(m.content));
      assert.deepEqual(storedReports.map(m => m.content), reportBodies);
      assert.deepEqual(storedReports.map(m => m.id), admitted.map(m => m.userMessageId));
      for (const message of storedReports) { assert.equal(message.role, "user"); assert.equal(message.sessionMessage.sourceSessionId, expertId); assert.equal(message.sessionMessage.targetSessionId, lead.id); assert.ok(reportIds.includes(message.sessionMessage.messageId)); assert.notEqual(message.steering, true); }
      evidence.persistedReports = storedReports; evidence.turns = turnIds;
      evidence.processes = {};
      for (const [label, sessionId] of [["lead", lead.id], ["expert", expertId]]) evidence.processes[label] = (await host.call("backgroundProcesses.list", { sessionId })).processes;
      assert.equal(evidence.processes.lead.length, 0); assert.equal(evidence.processes.expert.length, 2);
      assert.ok(evidence.processes.expert.every(p => p.status === "completed"));
      for (const messageId of reportIds) {
        const { message } = await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: lead.id, messageId });
        assert.equal(message.status, "completed"); assert.ok(!message.turnId, "Same-turn inbox must not bind a separate collaboration turn");
        await service.dispatchMessage({ teamSessionId: lead.id, messageId });
        await service.onNotification("team.messageQueued", { teamSessionId: lead.id, messageId });
      }
      assert.equal(agentHost.queue.list(lead.id).length, 0, "No consumed mail remains in the live queue");
      assert.equal((await host.call("session.get", { id: lead.id })).session.messages.filter(m => reportBodies.includes(m.content)).length, 2);
      assert.equal(turnIds.filter(t => t.sessionId === lead.id).length, 1, "Duplicate notification cannot start another Lead turn");
      // Read-only inspection of this isolated fixture's authoritative ledger:
      // independent of provider claims and the harness runtime-start counter.
      const sqlString = value => "'" + value.replaceAll("'", "''") + "'";
      evidence.durableTurns = JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", join(dataDir, "pi.sqlite"), `SELECT id,session_id,status FROM turns WHERE session_id IN (${sqlString(lead.id)},${sqlString(expertId)}) ORDER BY started_at,id;`], { encoding: "utf8" }));
      assert.equal(evidence.durableTurns.filter(t => t.session_id === lead.id).length, 2, "Only declaration and the original mail continuation exist in Host storage");
      assert.equal(evidence.durableTurns.filter(t => t.session_id === expertId).length, 1);
      assert.ok(evidence.durableTurns.every(t => t.status === "completed"));
      evidence.durableInbox = JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", join(dataDir, "pi.sqlite"), `SELECT i.message_id,i.user_message_id,i.lead_turn_id,i.scope_turn_id,i.phase,m.turn_id FROM team_ordinary_inbox i JOIN messages m ON m.id=i.user_message_id WHERE i.team_session_id=${sqlString(lead.id)} ORDER BY i.created_at,i.message_id;`], { encoding: "utf8" }));
      assert.equal(evidence.durableInbox.length, 2);
      assert.ok(evidence.durableInbox.every(i => i.phase === "acked" && i.lead_turn_id === activeLeadTurn && i.turn_id === activeLeadTurn && i.scope_turn_id === seed.turnId));
      assert.equal(leadPrompts.length, 6, "One final follows both waits; no premature final turn");
      const firstBodyRequest = evidence.timeline.find(e => e.stage === "provider-request" && e.sessionId === lead.id && e.reportBodies.length === 2);
      const turnEnd = evidence.timeline.find(e => e.stage === "runtime-turn-end" && e.sessionId === lead.id);
      assert.ok(firstBodyRequest.at < turnEnd.at, "Bodies are visible before Lead turn settlement");
      evidence.reportDelayMs = firstBodyRequest.at - evidence.timeline.filter(e => e.stage === "report-stored").at(-1).at;
      assert.ok(evidence.reportDelayMs < 5000, "Next waiting boundary promptly admits ready reports");
      evidence.result = "passed";
      console.log(`PASS ${evidence.scenario}: same-turn FIFO 2 reports, expert 2 / Lead 0 processes, ACK and notification replay, ${evidence.reportDelayMs}ms`);
    } finally {
      clearTimeout(deadline); reader.close();
      leadStarted.resolve(); reportsStored.resolve();
      let cleanupDeadline;
      try {
        await Promise.race([
          (async () => { for (const runtime of runtimes.values()) await runtime.dispose(); await Promise.allSettled([...runs]); })(),
          new Promise((_, reject) => { cleanupDeadline = setTimeout(() => reject(new Error("Runtime fixture cleanup exceeded 10 seconds")), 10000); }),
        ]);
      } finally { clearTimeout(cleanupDeadline); }
    }
  }, binary, temporaryRoot);
  evidence.sourceAfter = (await fingerprint()).sha256;
  assert.equal(evidence.sourceAfter, evidence.source.sha256, "Source changed while the candidate was under test");
} catch (error) {
  evidence.result = "failed"; evidence.error = error.stack ?? String(error); throw error;
} finally {
  if (process.env.PI_E2E_EVIDENCE_DIR) { await mkdir(process.env.PI_E2E_EVIDENCE_DIR, { recursive: true }); await writeFile(join(process.env.PI_E2E_EVIDENCE_DIR, "wp16-s3-ordinary-inbox.json"), JSON.stringify(evidence, null, 2) + "\n"); }
  await rm(temporaryRoot, { recursive: true, force: true });
}
