#!/usr/bin/env node
// Real Host, runtime wait, Main delivery and AgentHost queue; no model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNdjsonLines } from "../packages/shared/dist/ndjson.js";
import { createHostQueueStore, createHostSessionPort } from "../packages/host-runtime/dist/host-ports.js";
import { AgentHost } from "../packages/agent-host/dist/index.js";
import { createWaitForUpdatesTool } from "../packages/agent-runtime/dist/team/wait-for-updates.js";
import { createTeamDeliveryService } from "../apps/desktop/electron/main/services/team-delivery.ts";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { resolvePlan } from "./e2e/plan.mjs";

const root = await mkdtemp(join(tmpdir(), "pi-team-member-failure-"));
try {
  await withScenario("E2E-TEAM-member-failure-wakes-lead", async ({ host, workspace, dataDir }) => {
    const { provider } = await host.call("providers.create", {
      name: "Member failure fixture", vendorKey: "custom", authKind: "none",
      apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1",
      defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
    });
    const { session: lead } = await host.call("session.create", {
      title: "Member failure fixture", mode: "agent", executionProfile: "team", projectPath: workspace,
      providerId: provider.id, modelId: "fixture", permissionMode: "auto",
    });
    const { turnId } = await host.call("session.beginTurn", { sessionId: lead.id });
    await host.call("plans.enter", { sessionId: lead.id, turnId, toolCallId: "goal-enter", requestedMode: "goal", kind: "goal" });
    const { proposal } = await host.call("plans.submit", { sessionId: lead.id, turnId, toolCallId: "goal-submit", kind: "goal",
      title: "Member failure fixture", markdown: "# Verify expert failures\n\n- Inspect member failure receipt.\n", question: "Approve fixture?" });
    const { execution } = await resolvePlan(host, proposal, "approve", "auto");
    await host.call("plans.claimExecution", { executionId: execution.id });
    await host.call("goalReports.bindExecutionTurn", { executionId: execution.id, turnId });
    const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id,
      leadTurnId: turnId, strategy: "delegate", reason: "Verify host-authored expert failures", members: [{ name: "expert", contextKind: "fresh" }] });
    const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
    const memberId = decision.memberSessionIds[0];
    await host.call("team.readExecutionInbox", { teamSessionId: lead.id, callerSessionId: lead.id, expectedTurnId: turnId });
    const dispatch = async (queueOnly = false) => {
      const { message } = await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: lead.id, target: "expert", content: "Inspect fixture work" });
      return queueOnly ? message.id : (await host.call("session.beginTurn", { sessionId: memberId, sessionMessageId: message.id })).turnId;
    };
    const successful = await dispatch();
    await host.call("session.endTurn", { turnId: successful, status: "completed", createNotification: false });
    const failedTurn = await dispatch();
    const { task } = await host.call("team.createTask", { teamSessionId: lead.id, callerSessionId: lead.id, taskId: "inspection", subject: "Inspect fixture", ownerMemberName: "expert" });
    await host.call("team.updateTask", { teamSessionId: lead.id, callerSessionId: memberId, taskId: task.taskId, expectedRevision: task.revision, status: "completed" });
    const listeners = new Set();
    const reader = readNdjsonLines(host.child.stdout, line => {
      const note = JSON.parse(line);
      if (note.id == null && note.method) for (const listener of listeners) listener(note.method, note.params);
    });
    const runtimeHost = { call: host.call.bind(host), onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
    let baselineRead;
    const baseline = new Promise(resolve => { baselineRead = resolve; });
    const waitingHost = { ...runtimeHost, async call(method, params) {
      const response = await runtimeHost.call(method, params);
      if (method === "team.listMessages") baselineRead();
      return response;
    } };
    try {
      const wait = createWaitForUpdatesTool({ teamSessionId: lead.id, callerSessionId: lead.id, host: waitingHost,
        approvedExecution: () => true, getTurnId: () => turnId });
      await wait.execute("prime-consumed-confirmation", {});
      const waiting = wait.execute("member-failure-wait", { timeoutSeconds: 60 });
      await baseline;
      await host.call("session.endTurn", { turnId: failedTurn, status: "error", errorCode: "MUTATION_RETRY_BUDGET_EXHAUSTED", createNotification: false });
      await assert.rejects(host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id, toolName: "TeamFinalAnswer" }),
        error => error.errorCode === "TEAM_APPROVAL_REQUIRED");
      const outcome = await waiting;
      assert.equal(outcome.details.reason, "execution_inbox");
      const failure = outcome.details.messages.find(message => JSON.parse(message.content).kind === "member_failed");
      assert.ok(failure);
      assert.deepEqual(JSON.parse(failure.content).taskIds, ["inspection"]);
      assert.equal(JSON.parse(failure.content).errorCode, "MUTATION_RETRY_BUDGET_EXHAUSTED");
      assert.equal(JSON.parse(failure.content).retriable, false);
      assert.equal((await host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id, toolName: "TeamFinalAnswer" })).authorized, true);
      assert.equal((await host.call("session.endTurn", { turnId: failedTurn, status: "error", errorCode: "HOST_OVERLOADED", createNotification: false })).ok, false);
      assert.equal(host.matchingNotifications("team.messageQueued", note => note.params.messageId === failure.id).length, 1);
      assert.equal((await host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id })).tasks[0].status, "failed");
      const idleMessage = await dispatch(true);
      await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
      const idleFailedTurn = (await host.call("session.beginTurn", { sessionId: memberId, sessionMessageId: idleMessage })).turnId;
      let started;
      const resumed = new Promise(resolve => { started = resolve; });
      const requests = [];
      const agentHost = new AgentHost({ runtime: { async prompt(request) {
        requests.push(request);
        const response = await host.call("session.beginTurn", { sessionId: request.sessionId, sessionMessageId: request.sessionMessageId });
        started(response); return response;
      } }, sessions: createHostSessionPort(() => runtimeHost), queueStore: createHostQueueStore(() => runtimeHost), approvals: {} });
      const deliveryHost = { call: host.call.bind(host), isAvailable: () => true };
      const service = createTeamDeliveryService({ principal: { subject: "fixture-owner", roles: ["owner"], pairedDevice: true },
        getHost: () => deliveryHost, getBridge: () => ({ agentHost }), activeTurns: new Map(),
        log(message, data) { throw new Error(`${message}: ${JSON.stringify(data)}`); } });
      const checkpoint = join(dataDir, "sessions", `${memberId}.inflight.json`);
      await mkdir(checkpoint, { recursive: true });
      await assert.rejects(host.call("session.endTurn", { turnId: idleFailedTurn, status: "error", errorCode: "HOST_OVERLOADED", createNotification: false }),
        error => error.errorCode === "INTERNAL", "Checkpoint I/O failure must remain observable");
      const notice = host.matchingNotifications("team.messageQueued").at(-1);
      assert.ok(notice);
      const committed = (await host.call("team.getMessage", { teamSessionId: lead.id, callerSessionId: lead.id, messageId: notice.params.messageId })).message;
      assert.equal(JSON.parse(committed.content).kind, "member_failed", "Committed notice must emit even after checkpoint failure");
      await assert.rejects(host.call("session.endTurn", { turnId: idleFailedTurn, status: "error", errorCode: "HOST_OVERLOADED", createNotification: false }),
        error => error.errorCode === "INTERNAL");
      assert.equal(host.matchingNotifications("team.messageQueued").at(-1).params.messageId, committed.id);
      await rm(checkpoint, { recursive: true });
      await service.onNotification(notice.method, notice.params);
      const resumedTurn = await resumed;
      assert.equal(requests.length, 1);
      assert.equal(requests[0].sessionId, lead.id);
      assert.equal(JSON.parse(requests[0].content).kind, "member_failed");
      assert.equal(JSON.parse(requests[0].content).retriable, true);
      await service.onNotification(notice.method, notice.params);
      assert.equal(requests.length, 1);
      const afterDelivery = host.matchingNotifications("team.messageQueued").length;
      assert.equal((await host.call("session.endTurn", { turnId: idleFailedTurn, status: "error", createNotification: false })).ok, false);
      assert.equal(host.matchingNotifications("team.messageQueued").length, afterDelivery);
      const abortTurn = await dispatch();
      await host.call("session.endTurn", { turnId: resumedTurn.turnId, status: "completed", createNotification: false });
      const beforeAbort = host.matchingNotifications("team.messageQueued").length;
      await host.call("session.endTurn", { turnId: abortTurn, status: "aborted", errorCode: "TURN_ABORTED", createNotification: false });
      assert.equal(host.matchingNotifications("team.messageQueued").length, beforeAbort);
      console.log("PASS E2E-TEAM-member-failure-wakes-lead: terminal transaction, runtime wait, unread completion gate, replay, checkpoint-error idle Main/AgentHost wake, abort exclusion");
    } finally { reader.close(); }
  }, resolveHostBinary(), root);
} finally { await rm(root, { recursive: true, force: true }); }
