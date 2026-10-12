#!/usr/bin/env node
// Real Host terminal transaction and runtime inbox wait; no external model.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNdjsonLines } from "../packages/shared/dist/ndjson.js";
import { createWaitForUpdatesTool } from "../packages/agent-runtime/dist/team/wait-for-updates.js";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { resolvePlan } from "./e2e/plan.mjs";

const root = await mkdtemp(join(tmpdir(), "pi-team-member-silence-"));
try {
  await withScenario("E2E-TEAM-member-silent-completion-wakes-lead", async ({ host, workspace }) => {
    const { provider } = await host.call("providers.create", {
      name: "Silent member fixture", vendorKey: "custom", authKind: "none",
      apiStyle: "chat_completions", baseUrl: "http://127.0.0.1:9/v1",
      defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
    });
    const { session: lead } = await host.call("session.create", {
      title: "Silent member fixture", mode: "agent", executionProfile: "team", projectPath: workspace,
      providerId: provider.id, modelId: "fixture", permissionMode: "auto",
    });
    const { turnId } = await host.call("session.beginTurn", { sessionId: lead.id });
    await host.call("plans.enter", { sessionId: lead.id, turnId, toolCallId: "enter", requestedMode: "goal", kind: "goal" });
    const { proposal } = await host.call("plans.submit", { sessionId: lead.id, turnId, toolCallId: "submit", kind: "goal",
      title: "Silence fixture", markdown: "# Verify silent member completion\n", question: "Approve fixture?" });
    const { execution } = await resolvePlan(host, proposal, "approve", "auto");
    await host.call("plans.claimExecution", { executionId: execution.id });
    await host.call("goalReports.bindExecutionTurn", { executionId: execution.id, turnId });
    const { review } = await host.call("team.declareStrategy", { teamSessionId: lead.id, callerSessionId: lead.id,
      leadTurnId: turnId, strategy: "delegate", reason: "Verify silent completion", members: [{ name: "core_dev", contextKind: "fresh" }] });
    const { decision } = await host.call("team.confirmLaunchReview", { teamSessionId: lead.id, reviewId: review.reviewId, expectedRevision: review.revision });
    const memberId = decision.memberSessionIds[0];
    const { task } = await host.call("team.createTask", { teamSessionId: lead.id, callerSessionId: lead.id,
      taskId: "core-task", subject: "Implement fixture", ownerMemberName: "core_dev" });
    const { message: dispatch } = await host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: lead.id,
      target: "core_dev", content: "Inspect and report fixture work" });
    const memberTurn = (await host.call("session.beginTurn", { sessionId: memberId, sessionMessageId: dispatch.id })).turnId;
    await host.call("team.updateTask", { teamSessionId: lead.id, callerSessionId: memberId,
      taskId: task.taskId, expectedRevision: task.revision, status: "in_progress" });
    const listeners = new Set();
    const reader = readNdjsonLines(host.child.stdout, line => {
      const note = JSON.parse(line);
      if (note.id == null && note.method) for (const listener of listeners) listener(note.method, note.params);
    });
    let signalBaseline;
    const baseline = new Promise(resolve => { signalBaseline = resolve; });
    const runtimeHost = {
      async call(method, params) {
        const result = await host.call(method, params);
        if (method === "team.listMessages") signalBaseline();
        return result;
      },
      onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    try {
      const wait = createWaitForUpdatesTool({ teamSessionId: lead.id, callerSessionId: lead.id,
        host: runtimeHost, approvedExecution: () => true, getTurnId: () => turnId });
      await wait.execute("prime-confirmation", {});
      const waiting = wait.execute("await-silent-member", { timeoutSeconds: 60 });
      await baseline;
      await host.call("session.endTurn", { turnId: memberTurn, status: "completed", createNotification: false });
      const mails = (await host.call("team.listMessages", { teamSessionId: lead.id, callerSessionId: lead.id, sessionId: lead.id })).messages;
      const notices = mails.filter(mail => { try { return JSON.parse(mail.content).kind === "member_ended_without_report"; } catch { return false; } });
      assert.equal(notices.length, 1);
      const notice = notices[0];
      assert.deepEqual(JSON.parse(notice.content).taskIds, ["core-task"]);
      assert.equal(JSON.parse(notice.content).memberName, "core_dev");
      const queuedCount = () => host.matchingNotifications("team.messageQueued", event => event.params.messageId === notice.id).length;
      assert.equal(queuedCount(), 1);
      assert.equal((await host.call("session.endTurn", { turnId: memberTurn, status: "completed", createNotification: false })).ok, false);
      assert.equal(queuedCount(), 1, "Terminal replay does not repeat the silent wake");
      await assert.rejects(host.call("team.sendMessage", { teamSessionId: lead.id, callerSessionId: memberId,
        target: "Lead", content: "Forged", idempotencyKey: `member-turn-silent:${memberTurn}` }), error => error.errorCode === "TEAM_UNAUTHORIZED");
      // The wait may already have consumed mail; the independent task barrier
      // must still refuse completion until the Lead honestly closes the task.
      await assert.rejects(host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id,
        toolName: "TeamFinalAnswer" }), error => error.errorCode === "TEAM_APPROVAL_REQUIRED");
      const outcome = await waiting;
      assert.equal(outcome.details.reason, "execution_inbox");
      assert.ok(outcome.details.messages.some(mail => mail.id === notice.id));
      const open = (await host.call("team.getBoard", { teamSessionId: lead.id, callerSessionId: lead.id })).tasks.find(row => row.taskId === task.taskId);
      assert.equal(open.status, "in_progress", "Notice consumption does not complete work");
      await host.call("team.updateTask", { teamSessionId: lead.id, callerSessionId: lead.id,
        taskId: open.taskId, expectedRevision: open.revision, status: "failed", description: "Member ended without implementation or report." });
      assert.equal((await host.call("team.authorizeLeadTool", { teamSessionId: lead.id, callerSessionId: lead.id,
        toolName: "TeamFinalAnswer" })).authorized, true);
      console.log("PASS E2E-TEAM-member-silent-completion-wakes-lead: atomic notice, one wake, replay, reserved key, real runtime consumption, explicit unsuccessful closure");
    } finally { reader.close(); }
  }, resolveHostBinary(), root);
} finally { await rm(root, { recursive: true, force: true }); }
