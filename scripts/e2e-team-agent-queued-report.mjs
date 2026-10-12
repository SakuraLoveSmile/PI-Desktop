#!/usr/bin/env node
// Production Host, Main delivery, AgentHost and runtime; only the model boundary is scripted.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { readNdjsonLines } from "../packages/shared/dist/ndjson.js";
import { createHostQueueStore, createHostSessionPort } from "../packages/host-runtime/dist/host-ports.js";
import { AgentHost } from "../packages/agent-host/dist/index.js";
import { DesktopAgentRuntime } from "../packages/agent-runtime/dist/runtime.js";
import { createTeamDeliveryService } from "../apps/desktop/electron/main/services/team-delivery.ts";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";

const baseline = process.argv.includes("--baseline");
const timeoutAcceptance = process.argv.includes("--timeout-acceptance");
const concurrentMail = process.argv.includes("--concurrent-mail");
assert.ok([baseline, timeoutAcceptance, concurrentMail].filter(Boolean).length <= 1, "Select one replay mode");
const root = await mkdtemp(join(tmpdir(), "pi-agent-mailbox-"));
const binary = resolveHostBinary();
const evidence = { baseline, timeoutAcceptance, concurrentMail, ordinaryInboxCapability: "legacy-unsupported", base: "26db5043860db8412a988cdce31362a424eea407", originalS1Baseline: "144b28bbb", hostBinarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"), timeline: [] };
const record = (stage, data = {}) => evidence.timeline.push({ at: Date.now(), stage, ...data });
const principal = { subject: "fixture-owner", roles: ["owner"], pairedDevice: true };
const waits = [60, 60, 60, 30, 5, 30, 15, 60];
function assistant(content) {
  return { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", content,
    stopReason: content.some(block => block.type === "toolCall") ? "toolUse" : "stop", timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
try {
  await withScenario("E2E-TEAM-agent-lead-sees-queued-expert-report", async ({ host, workspace }) => {
    const { provider } = await host.call("providers.create", { name: "Queued report fixture", vendorKey: "custom", authKind: "none",
      apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }] });
    const { session: lead } = await host.call("session.create", { title: "Agent queued report fixture", mode: "agent", executionProfile: "team",
      projectPath: workspace, providerId: provider.id, modelId: "fixture", permissionMode: "auto" });
    await host.call("session.configure", { id: lead.id, mode: "agent", permissionMode: "auto" });
    const seed = await host.call("session.beginTurn", { sessionId: lead.id });
    const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id, leadTurnId: seed.turnId,
      strategy: "delegate", reason: "Delegate the two isolated commands to an expert, never repeat them.", members: [{ name: "expert", contextKind: "fresh" }] });
    await host.call("session.endTurn", { turnId: seed.turnId, status: "completed", createNotification: false });
    const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
    const expertId = decision.memberSessionIds[0];
    await host.call("session.configure", { id: expertId, mode: "agent", permissionMode: "auto" });
    const activeTurns = new Map();
    const runtimes = new Map();
    const listeners = new Set();
    const runs = new Set();
    let agentHost, service, failure, reportId, waitIndex = 0, leadDuplicates = 0, leadStep = 0, expertStep = 0;
    let expertPhase = "explicit";
    const expertTimeoutOutcomes = [];
    let noticeId, reportFinished = false, noticeFinished = !concurrentMail;
    let releaseConcurrentSends, resolveReportStored;
    const concurrentSends = new Promise(resolve => { releaseConcurrentSends = resolve; });
    const reportStored = new Promise(resolve => { resolveReportStored = resolve; });
    let concurrentSendCount = 0;
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const runtimeHost = { async call(method, params) {
      // This retained S1 scenario represents an older Host without the optional
      // ordinary-inbox capability; the production RPC/queue path stays real.
      if (method === "team.getOrdinaryInboxCapability") {
        throw Object.assign(new Error("Legacy Host does not support ordinary inbox"), { code: -32601 });
      }
      const concurrentParty = concurrentMail && method === "team.sendMessage" &&
        (params.content.startsWith("EXPERT_COMPLETE_BODY") ? "expert" : params.content.startsWith("LEAD_NOTICE_BODY") ? "lead" : undefined);
      if (concurrentParty) {
        record("concurrent-send-ready", { party: concurrentParty, sessionId: params.callerSessionId });
        if (++concurrentSendCount === 2) releaseConcurrentSends();
        // Both production send_message tools reach this explicit synchronization
        // point before either real Host request is issued. No result is stubbed.
        await concurrentSends;
        record("concurrent-send-start", { party: concurrentParty, sessionId: params.callerSessionId });
      }
      record("rpc-start", { method, sessionId: params?.sessionId ?? params?.callerSessionId });
      const value = await host.call(method, params);
      if (method === "team.sendMessage" && params.callerSessionId === expertId) {
        reportId = value.message.id; record("report-stored", { reportId, createdAt: value.message.createdAt }); resolveReportStored();
      }
      if (concurrentParty === "lead") { noticeId = value.message.id; record("notice-stored", { noticeId, createdAt: value.message.createdAt }); }
      if (method === "team.ackMessage") record("ack", { messageId: params.messageId, acknowledged: value.acknowledged });
      if (method === "session.queuePush") record("queue-admitted", { messageId: params.sessionMessageId, idempotencyKey: params.idempotencyKey });
      return value;
    }, onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
    const nativeReader = readNdjsonLines(host.child.stdout, line => {
      const note = JSON.parse(line);
      if (note.id != null || !note.method) return;
      record("notification", { method: note.method, messageId: note.params?.messageId });
      for (const listener of listeners) listener(note.method, note.params);
      if (service) {
        const dispatch = service.onNotification(note.method, note.params).then(() => record("notification-dispatched", { method: note.method, messageId: note.params?.messageId })).catch(error => { failure = error; resolveDone(); });
        runs.add(dispatch); dispatch.finally(() => runs.delete(dispatch));
      }
    });
    const runtimePort = { isBusy: id => runtimes.get(id)?.getStatus().isRunning === true,
      async prompt(request) {
        record("dequeue-runtime-start", { sessionId: request.sessionId, messageId: request.sessionMessageId });
        const started = await host.call("session.beginTurn", { sessionId: request.sessionId, ...(request.sessionMessageId ? { sessionMessageId: request.sessionMessageId } : {}) });
        activeTurns.set(request.sessionId, started.turnId);
        let runtime = runtimes.get(request.sessionId);
        if (!runtime) {
          const teamContext = await host.call("team.getRuntimeContext", { sessionId: request.sessionId });
          runtime = new DesktopAgentRuntime({ host: runtimeHost, sessionId: request.sessionId, mode: "agent", executionProfile: "team", teamContext,
            projectPath: workspace, thinkingLevel: "off", commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
            provider: { id: provider.id, name: "Fixture", modelId: "fixture", baseUrl: "http://127.0.0.1:9/v1", apiKey: "", authKind: "none", supportsReasoning: false,
              modelConfig: { source: "generic", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256000, maxTokens: 32000 } },
            onEvent(envelope) { if (envelope.event.type === "tool_end") record("tool-return", { sessionId: request.sessionId, event: envelope.event }); } });
          runtime.models = { streamSimple(_model, context) {
            const stream = createAssistantMessageEventStream();
            const isLead = request.sessionId === lead.id;
            const toolResults = context.messages.filter(message => message.role === "toolResult");
            const projections = toolResults.map(message => {
              const text = message.content.find(block => block.type === "text")?.text;
              return text?.trimStart().startsWith("{") ? JSON.parse(text) : undefined;
            });
            const pending = projections.some(value => value?.reason === "pending_mailbox_messages" || value?.pendingMessagesCount > 0);
            const fullReport = context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("EXPERT_COMPLETE_BODY"));
            if (!isLead && context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("LEAD_NOTICE_BODY"))) record("notice-in-model", { noticeId });
            record("provider-request", { sessionId: request.sessionId, pending, fullReport });
            (async () => {
              let content;
              const tool = (name, args) => [{ type: "toolCall", id: `fixture-${isLead ? "lead" : "expert"}-${Date.now()}-${isLead ? leadStep : expertStep}`, name, arguments: args }];
              if (!isLead) {
                expertStep++;
                if (timeoutAcceptance) {
                  assert.ok(expertStep <= 12, "Expert wait sequence exceeded its bounded fixture budget");
                  const outcome = projections.at(-1);
                  if ((expertPhase === "wait-explicit" || expertPhase === "wait-default") && outcome?.reason === "background_process_completed") {
                    assert.equal(outcome.backgroundProcess.process.status, "timed_out");
                    assert.equal(outcome.backgroundProcess.errorCode, "TOOL_TIMEOUT");
                    expertTimeoutOutcomes.push(outcome.backgroundProcess);
                    expertPhase = expertPhase === "wait-explicit" ? "default" : "report";
                  }
                  if (expertPhase === "explicit") {
                    content = tool("Bash", { command: "sleep 5", timeout: 2, run_in_background: true });
                    expertPhase = "wait-explicit";
                  } else if (expertPhase === "default") {
                    content = tool("Bash", { command: "sleep 75", run_in_background: true });
                    expertPhase = "wait-default";
                  } else if (expertPhase === "report") {
                    content = tool("send_message", { targetMemberName: "Lead", content: `EXPERT_COMPLETE_BODY: ${JSON.stringify(expertTimeoutOutcomes)}. Both commands timed out; no retries or writes.` });
                    expertPhase = "done";
                  } else if (expertPhase === "done") content = [{ type: "text", text: "Expert timeout results reported." }];
                  else content = tool("wait_for_updates", { timeoutSeconds: expertPhase === "wait-explicit" ? 10 : 60 });
                } else if (expertStep <= 2) content = tool("Bash", { command: "sleep 0.05", run_in_background: true });
                else if (expertStep === 3) { await delay(5000); content = tool("send_message", { targetMemberName: "Lead", content: "EXPERT_COMPLETE_BODY: both delegated fixture commands completed. Do not repeat them." }); }
                else content = [{ type: "text", text: "Expert commands and report complete." }];
              } else {
                leadStep++;
                if (fullReport) { record("body-in-model", { reportId }); content = [{ type: "text", text: "Consumed the authenticated expert report; expert ran two commands, lead ran none." }]; }
                else if (leadStep === 1) content = tool("task_create", { subject: "Run two isolated commands", ownerMemberName: "expert", writeScopes: [] });
                else if (leadStep === 2) content = tool("send_message", { targetMemberName: "expert", content: "Run exactly two isolated background commands, then send the complete report. Lead must not repeat them." });
                else if (concurrentMail && leadStep === 3) content = tool("send_message", { targetMemberName: "expert", content: "LEAD_NOTICE_BODY: coordination update only; do not repeat any commands." });
                else if (concurrentMail && leadStep === 4) { await reportStored; content = tool("team_status", {}); }
                else if (pending) content = [{ type: "text", text: "Reports are queued; ending this turn so authenticated delivery can occur. No duplicate commands." }];
                else if (leadStep % 2 === 1 && waitIndex < waits.length) content = tool("wait_for_updates", { timeoutSeconds: waits[waitIndex++] });
                else if (waitIndex < waits.length) content = tool("team_status", {});
                else if (leadDuplicates++ < 2) content = tool("Bash", { command: "sleep 0.05", run_in_background: true });
                else content = [{ type: "text", text: "Could not see the report; repeated the delegated commands." }];
              }
              const message = assistant(content); stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
            })().catch(error => { failure = error; stream.end(assistant([{ type: "text", text: String(error) }])); });
            return stream;
          } };
          runtimes.set(request.sessionId, runtime);
        }
        let input = request.content;
        if (request.sessionMessageId) {
          const { message } = await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: request.sessionId, messageId: request.sessionMessageId });
          input = { text: request.content, sessionMessage: { messageId: message.id, sourceSessionId: message.sourceSessionId, sourceTitle: message.sourceMemberName, targetSessionId: message.targetSessionId, kind: "message", ...(message.senderHead ? { senderHead: message.senderHead } : {}) } };
        }
        const run = runtime.prompt(input, `user-${started.turnId}`, started.turnId).then(async () => {
          record("runtime-turn-end", { sessionId: request.sessionId, turnId: started.turnId });
          await host.call("session.endTurn", { turnId: started.turnId, status: "completed", createNotification: false });
          activeTurns.delete(request.sessionId);
          agentHost.endTurn(request.sessionId, started.turnId, "completed");
          // Match Main's onTurnSettled collaboration callback after durable
          // turn settlement. The Host derives status from the real bound turn.
          await host.call("session.collaboration.settle", { turnId: started.turnId });
          if (request.sessionMessageId === reportId) reportFinished = true;
          if (request.sessionMessageId === noticeId) noticeFinished = true;
          if (reportFinished && noticeFinished) resolveDone();
        }).catch(error => { failure = error; resolveDone(); });
        runs.add(run); run.finally(() => runs.delete(run));
        return started;
      } };
    agentHost = new AgentHost({ runtime: runtimePort, sessions: createHostSessionPort(() => runtimeHost), queueStore: createHostQueueStore(() => runtimeHost), approvals: {} });
    const originalKick = agentHost.kick.bind(agentHost);
    agentHost.kick = id => { record("kick", { sessionId: id, busy: runtimePort.isBusy(id) }); originalKick(id); };
    // Delivery's identity fence expects a stable Host object.
    const stableHost = { call: runtimeHost.call, isAvailable: () => true };
    service = createTeamDeliveryService({ principal, getHost: () => stableHost, getBridge: () => ({ agentHost }), activeTurns,
      log(message, data) {
        if (concurrentMail && data.error === "Error: Lead execution changed during delivery") {
          // A duplicate notification can race the very short mailbox continuation.
          // Keep the existing fence visible; final durable/once-only assertions
          // below still require both real messages to finish authenticated delivery.
          record("delivery-context-pending", { message, ...data });
          return;
        }
        failure = new Error(`${message}: ${JSON.stringify(data)}`); resolveDone();
      } });
    try {
      await service.dispatchMessage({ teamSessionId: lead.id, messageId: decision.messageIds[0] });
      await done;
      if (failure) throw failure;
      const stored = evidence.timeline.find(entry => entry.stage === "report-stored");
      const ack = evidence.timeline.find(entry => entry.stage === "ack" && entry.messageId === reportId);
      const body = evidence.timeline.find(entry => entry.stage === "body-in-model");
      assert.ok(stored && ack && body, "Report storage, ACK and authenticated body must all occur");
      evidence.reportDelayMs = body.at - stored.at;
      assert.ok(ack.at - stored.at < 2000, "Lock/admission/ACK must finish promptly");
      evidence.processCounts = {};
      evidence.processRecords = {};
      for (const [label, id] of [["lead", lead.id], ["expert", expertId]]) {
        const { processes } = await host.call("backgroundProcesses.list", { sessionId: id });
        evidence.processCounts[label] = processes.length;
        evidence.processRecords[label] = processes.map(process => ({ id: process.id, status: process.status }));
      }
      assert.equal(evidence.processCounts.expert, 2);
      if (timeoutAcceptance) {
        assert.equal(expertTimeoutOutcomes.length, 2, "Both expert terminal results must be consumed before reporting");
        const records = [];
        for (const { id } of evidence.processRecords.expert) records.push(await host.call("backgroundProcesses.read", { sessionId: expertId, id }));
        records.sort((a, b) => Date.parse(a.process.startedAt) - Date.parse(b.process.startedAt));
        evidence.timeoutResults = records;
        evidence.timeoutDurationsMs = records.map(detail => Date.parse(detail.process.endedAt) - Date.parse(detail.process.startedAt));
        for (const detail of records) { assert.equal(detail.process.status, "timed_out"); assert.equal(detail.errorCode, "TOOL_TIMEOUT"); }
        assert.equal(records[0].process.command, "sleep 5");
        assert.equal(records[1].process.command, "sleep 75");
        assert.ok(records[0].errorMessage.includes("explicit 2 second"));
        assert.ok(records[1].errorMessage.includes("default 60 second"));
        assert.ok(evidence.timeoutDurationsMs[0] >= 1900 && evidence.timeoutDurationsMs[0] < 5000);
        assert.ok(evidence.timeoutDurationsMs[1] >= 59000 && evidence.timeoutDurationsMs[1] < 65000);
      } else assert.ok(evidence.processRecords.expert.every(process => process.status === "completed"), "Expert fixture commands must be healthy");
      if (baseline) {
        assert.ok(evidence.reportDelayMs > 180000, "S0 must reproduce more than three minutes behind a busy Lead");
        assert.equal(evidence.processCounts.lead, 2);
      } else {
        assert.equal(evidence.processCounts.lead, 0, "Lead must not rerun delegated commands");
        assert.ok(evidence.reportDelayMs < 5000, "Next wait/status must make pending reports visible promptly");
      }
      assert.equal(evidence.timeline.filter(entry => entry.stage === "body-in-model").length, 1);
      if (concurrentMail) {
        assert.equal(concurrentSendCount, 2);
        const starts = evidence.timeline.filter(entry => entry.stage === "concurrent-send-start");
        assert.deepEqual(starts.map(entry => entry.party).sort(), ["expert", "lead"]);
        const firstStored = evidence.timeline.find(entry => entry.stage === "report-stored" || entry.stage === "notice-stored");
        assert.ok(starts.every(entry => entry.at <= firstStored.at), "Both real send RPCs start before either stored response");
        const status = evidence.timeline.find(entry => entry.stage === "tool-return" && entry.sessionId === lead.id &&
          entry.event.result.details?.pendingMessagesCount === 1)?.event.result;
        assert.ok(status, "The still-running Lead must see exactly one inbound report despite its concurrent outgoing message");
        assert.deepEqual(status.details.pendingMessageSenders, ["expert"]);
        assert.ok(Number.isInteger(status.details.oldestPendingMessageAgeSeconds));
        assert.ok(status.details.oldestPendingMessageAgeSeconds >= 0);
        evidence.concurrentSummary = { pendingMessagesCount: status.details.pendingMessagesCount,
          pendingMessageSenders: status.details.pendingMessageSenders, oldestPendingMessageAgeSeconds: status.details.oldestPendingMessageAgeSeconds };
        assert.ok(!JSON.stringify(status).includes("EXPERT_COMPLETE_BODY") && !JSON.stringify(status).includes("LEAD_NOTICE_BODY"));
        assert.equal(evidence.timeline.filter(entry => entry.stage === "notice-in-model").length, 1);
        evidence.concurrentMessages = [];
        for (const messageId of [reportId, noticeId]) {
          assert.ok(evidence.timeline.some(entry => entry.stage === "queue-admitted" && entry.messageId === messageId && entry.idempotencyKey === `team-message:${messageId}`));
          const { message } = await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: lead.id, messageId });
          assert.equal(message.status, "completed");
          assert.ok(message.turnId, "A summary does not bind or consume the body; genuine mailbox continuation does");
          evidence.concurrentMessages.push({ id: message.id, status: message.status, turnId: message.turnId,
            sourceSessionId: message.sourceSessionId, targetSessionId: message.targetSessionId });
        }
      }
      assert.ok(evidence.timeline.some(entry => entry.stage === "runtime-turn-end" && entry.sessionId === lead.id && entry.at <= body.at));
      await Promise.all((concurrentMail ? [reportId, noticeId] : [reportId]).map(messageId =>
        service.dispatchMessage({ teamSessionId: lead.id, messageId })));
      assert.equal(evidence.timeline.filter(entry => entry.stage === "body-in-model").length, 1, "Replay must not consume twice");
      if (concurrentMail) assert.equal(evidence.timeline.filter(entry => entry.stage === "notice-in-model").length, 1);
      console.log(`PASS ${baseline ? "S0 baseline" : timeoutAcceptance ? "R4 timeout acceptance" : concurrentMail ? "R3 concurrent mail" : "R1 regression"}: report delay ${evidence.reportDelayMs}ms, process counts ${JSON.stringify(evidence.processCounts)}${timeoutAcceptance ? `, timeouts ${JSON.stringify(evidence.timeoutDurationsMs)}ms` : ""}`);
    } finally {
      nativeReader.close();
      for (const runtime of runtimes.values()) await runtime.dispose();
      await Promise.allSettled([...runs]);
    }
  }, binary, root);
} finally {
  const dir = process.env.PI_E2E_EVIDENCE_DIR;
  if (dir) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, baseline ? "wp16-s0-baseline.json" : timeoutAcceptance ? "wp16-r4.json" : concurrentMail ? "wp16-r3.json" : "wp16-r1.json"), JSON.stringify(evidence, null, 2) + "\n"); }
  await rm(root, { recursive: true, force: true });
}
