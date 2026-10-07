#!/usr/bin/env node
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function createApprovedGoalFixture(projectPath) {
  let expertStarted = false, expertRead = false, resultSeen = false;
  let releaseExpert, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const markdown = "# Approved Team Goal\n\n## Acceptance criteria\n- Expert reads approved-goal-source.md and returns APPROVED_GOAL_VERIFIED.\n";
  const tool = (name, args = {}) => ({ toolCall: { name, args } });
  const report = { summary: "The approved expert read the isolated source and returned APPROVED_GOAL_VERIFIED.", verdict: "met",
    criteria: [{ id: "verified", text: "Expert reads approved-goal-source.md and returns APPROVED_GOAL_VERIFIED.", verdict: "met", explanation: "The full authenticated expert result was consumed within the original approved execution." }],
    steps: [{ id: "expert", title: "Read assigned source", status: "completed", detail: "A real Host expert turn read the source." }], files: [],
    checks: [{ id: "read", command: "Read approved-goal-source.md", result: "passed", detail: "APPROVED_GOAL_SOURCE was verified." }],
    evidences: [{ id: "source", kind: "file", refId: "approved-goal-source.md", summary: "APPROVED_GOAL_VERIFIED" }] };
  return {
    release() { releaseExpert?.(); },
    async respond({ userText, priorToolNames, activeToolText, activeTurnMessages, toolNames, allMessages }) {
      const has = name => priorToolNames.includes(name);
      if (userText.includes("APPROVED_GOAL_EXPERT_WORK")) {
        if (!expertStarted) { expertStarted = true; signalStarted(); await new Promise(resolve => { releaseExpert = resolve; }); }
        assert.equal(toolNames.includes("declare_team_strategy"), false);
        if (!has("team_status")) return tool("team_status");
        const status = [...activeTurnMessages].reverse().filter(m => m.role === "tool").map(m => { try { return JSON.parse(m.content); } catch { return null; } }).find(value => Array.isArray(value?.tasks));
        const task = status.tasks.find(task => task.subject === "Verify approved Goal source"); assert.ok(task);
        if (!has("Read")) return tool("Read", { path: "approved-goal-source.md" });
        assert.match(activeToolText, /APPROVED_GOAL_SOURCE/); expertRead = true;
        if (!has("task_update")) return tool("task_update", { taskId: task.taskId, expectedRevision: task.revision, status: "completed" });
        if (!has("send_message")) return tool("send_message", { targetMemberName: "Lead", content: "APPROVED_GOAL_VERIFIED: Read approved-goal-source.md containing APPROVED_GOAL_SOURCE. Full result preserved in the original approved Goal execution." });
        return { finalText: "Expert verification complete." };
      }
      if (userText.includes("Approved goal title:")) {
        assert.ok(toolNames.includes("UpdateGoalProgress")); assert.ok(toolNames.includes("SubmitGoalReport"));
        if (!has("declare_team_strategy")) return tool("declare_team_strategy", { strategy: "delegate", reason: "An expert must verify the approved source.", members: [{ name: "goal_expert", description: "Verify assigned source", contextKind: "fresh", presentation: { role: "executor", displayName: "Sam" } }] });
        if (!activeToolText.includes('"reason":"execution_inbox"')) return JSON.stringify(allMessages).includes("The Host confirmed the expert roster")
          ? tool("wait_for_updates", { timeoutSeconds: 60 }) : { finalText: "Waiting for trusted expert roster confirmation." };
        if (!has("task_create")) return tool("task_create", { subject: "Verify approved Goal source", ownerMemberName: "goal_expert", writeScopes: [] });
        if (!has("send_message")) return tool("send_message", { targetMemberName: "goal_expert", content: "APPROVED_GOAL_EXPERT_WORK: read your assigned approved-goal-source.md and return its full verified result." });
        await started;
        const progressCount = priorToolNames.filter(name => name === "UpdateGoalProgress").length;
        if (!progressCount) return tool("UpdateGoalProgress", { items: [{ id: "expert", label: "Verify approved source", status: "in_progress" }] });
        if (!activeToolText.includes("APPROVED_GOAL_VERIFIED")) return tool("wait_for_updates", { timeoutSeconds: 60 });
        assert.ok(expertRead); resultSeen = true;
        if (progressCount === 1) return tool("UpdateGoalProgress", { items: [{ id: "expert", label: "Verify approved source", status: "completed" }] });
        if (!has("SubmitGoalReport")) return tool("SubmitGoalReport", report);
        return { finalText: "APPROVED_GOAL_COMPLETE: verified with the approved expert in the original execution." };
      }
      if (userText.includes("AG_APPROVED_GOAL")) return tool("SubmitGoal", { title: "Approved Team Goal", markdown, question: "Approve expert source verification?" });
      throw new Error(`Unexpected approved Goal prompt ${userText.slice(0, 200)}`);
    },
    async runJourney({ planLead: goal, invoke, evaluate, sendCdp, waitFor, calls, submitComposerPrompt, saveScreenshot }) {
      await writeFile(join(projectPath, "approved-goal-source.md"), "APPROVED_GOAL_SOURCE\n");
      await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${goal.id}"]') && !document.querySelector('.startup-splash')`), "Goal session");
      await evaluate(`document.querySelector('[data-sidebar-session-row="${goal.id}"] .thread-item-main').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="goal"]')`), "Goal contract hydrated");
      await submitComposerPrompt(sendCdp, evaluate, "AG_APPROVED_GOAL: negotiate source verification with an expert.");
      const proposal = await waitFor(async () => (await invoke("plansPending", { sessionId: goal.id })).plans.find(plan => plan.status === "pending"), "Goal approval");
      await waitFor(() => evaluate(`!!document.querySelector('.plan-approval-approve-menu')`), "Goal approval menu");
      await evaluate(`document.querySelector('.plan-approval-approve-menu').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[data-approval-mode="auto"]')`), "Auto permission option");
      await evaluate(`document.querySelector('[data-approval-mode="auto"]').click()`);
      const review = await waitFor(async () => { const { review } = await invoke("teamGetLaunchReview", { teamSessionId: goal.id }); return review?.status === "pending" && review.launchPolicy === "user_confirmed" ? review : null; }, "approved Goal pending roster");
      const originalTurn = review.leadTurnId;
      assert.equal((await invoke("agentGetStatus", goal.id)).status.isRunning, true);
      assert.equal(expertStarted, false);
      const pendingReports = (await invoke("goalReportList", { sessionId: goal.id })).reports;
      assert.equal(pendingReports.length, 1); assert.equal(pendingReports[0].status, "pending");
      assert.equal(pendingReports[0].executionStatus, null, "pending review prematurely completed execution");
      const executionId = pendingReports[0].executionId;
      const pendingTurn = await invoke("turnGet", { sessionId: goal.id, turnId: originalTurn }); assert.equal(pendingTurn.status, "running");
      await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="goal"]')`), "approved execution preserves Goal contract presentation");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')`), "expert review automatically revealed for Goal execution");
      await waitFor(() => evaluate(`document.querySelector('[data-testid="team-review-waiting-indicator"]')?.innerText.includes('Waiting for team confirmation')`), "transcript explains staffing wait");
      await waitFor(() => evaluate(`document.querySelector('.goal-progress-capsule')?.innerText === 'Waiting for team confirmation'`), "Goal capsule explains staffing wait instead of preparing");
      await evaluate(`document.querySelector('[data-work-panel-tab-id="overview"] .work-panel-tab-button').click()`);
      await waitFor(() => evaluate(`document.querySelector('[data-testid="overview-tab"] .work-panel-overview-status strong')?.innerText === 'Waiting for team confirmation'`), "Overview explains staffing wait");
      await evaluate(`document.querySelector('[data-testid="team-review-waiting-indicator"] button').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')`), "transcript action reopens expert review");
      assert.equal((await invoke("agentGetStatus", goal.id)).status.currentTurnId, originalTurn);
      assert.equal(expertStarted, false, "view navigation cannot authorize experts");
      await saveScreenshot(sendCdp, "team-approved-goal-pending-review.png");
      await evaluate(`document.querySelector('[data-testid="team-launch-review-confirm-btn"]').click()`);
      await waitFor(() => expertStarted, "real Host-owned expert turn");
      const member = (await invoke("teamGetRoster", { teamSessionId: goal.id })).members.find(member => member.name === "goal_expert"); assert.ok(member);
      await waitFor(async () => (await invoke("goalProgressGet", { sessionId: goal.id, executionId: executionId })).progress?.revision === 1, "progress remains bound while expert works");
      assert.equal((await invoke("agentGetStatus", goal.id)).status.currentTurnId, originalTurn);
      assert.equal((await invoke("goalReportList", { sessionId: goal.id })).reports[0].status, "pending");
      releaseExpert();
      await waitFor(() => resultSeen, "full expert result consumed in original turn");
      await waitFor(async () => (await invoke("agentGetStatus", goal.id)).status.isRunning === false, "unique Goal completion");
      const reports = (await invoke("goalReportList", { sessionId: goal.id })).reports; assert.equal(reports.length, 1);
      const reportResult = (await invoke("goalReportGet", { sessionId: goal.id, executionId: reports[0].executionId })).report;
      assert.equal(reportResult.verdict, "met"); assert.equal(reportResult.execution.status, "completed"); assert.equal(reportResult.integrity.kind, "structured");
      const progress = (await invoke("goalProgressGet", { sessionId: goal.id, executionId: reports[0].executionId })).progress; assert.equal(progress.revision, 2); assert.equal(progress.items[0].status, "completed");
      const finalTurn = await invoke("turnGet", { sessionId: goal.id, turnId: originalTurn }); assert.equal(finalTurn.status, "completed");
      const detail = (await invoke("sessionGet", { id: goal.id })).session;
      assert.equal(detail.messages.filter(message => message.role === "user").length, 1, "confirmation or expert mail escaped into detached prompt");
      assert.equal(calls.filter(call => call.kind !== "title" && call.userText.includes("Team review") && call.userText.includes("confirmed")).length, 0, "duplicate mailbox kickoff");
      assert.equal(detail.messages.filter(message => message.toolName === "SubmitGoalReport").length, 1);
      await saveScreenshot(sendCdp, "team-approved-goal-completed.png");
      console.log("PASS approved Team Goal: negotiation, same running execution through review/expert, effective progress, full in-turn result, unique structured report/completion");
      const cancelled = (await invoke("sessionCreate", { title: "Cancelled Team Goal", mode: "goal", executionProfile: "team", projectPath, providerId: goal.providerId, modelId: goal.modelId, permissionMode: "auto" })).session;
      await sendCdp("Page.reload");
      await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${cancelled.id}"]') && !document.querySelector('.startup-splash')`), "cancel Goal session");
      await evaluate(`document.querySelector('[data-sidebar-session-row="${cancelled.id}"] .thread-item-main').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="goal"]')`), "cancel Goal contract");
      await submitComposerPrompt(sendCdp, evaluate, "AG_APPROVED_GOAL: negotiate expert source verification, then cancel roster.");
      await waitFor(async () => (await invoke("plansPending", { sessionId: cancelled.id })).plans.some(plan => plan.status === "pending"), "cancel Goal approval");
      await waitFor(() => evaluate(`!!document.querySelector('.plan-approval-approve-menu')`), "cancel Goal approval menu");
      await evaluate(`document.querySelector('.plan-approval-approve-menu').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[data-approval-mode="auto"]')`), "cancel Goal Auto permission");
      await evaluate(`document.querySelector('[data-approval-mode="auto"]').click()`);
      const cancelReview = await waitFor(async () => { const { review } = await invoke("teamGetLaunchReview", { teamSessionId: cancelled.id }); return review?.status === "pending" ? review : null; }, "cancel Goal roster pending");
      assert.equal((await invoke("agentGetStatus", cancelled.id)).status.isRunning, true);
      const callsBeforeCancel = calls.length;
      await invoke("teamCancelLaunchReview", { teamSessionId: cancelled.id, reviewId: cancelReview.reviewId, expectedRevision: cancelReview.revision });
      await waitFor(async () => (await invoke("agentGetStatus", cancelled.id)).status.isRunning === false, "cancelled approved execution interrupted");
      const cancelledTurn = await waitFor(async () => {
        const turn = await invoke("turnGet", { sessionId: cancelled.id, turnId: cancelReview.leadTurnId });
        return turn.status !== "running" ? turn : null;
      }, "cancelled Host turn durably settled");
      assert.equal(cancelledTurn.status, "aborted", "review cancel completed Host turn");
      const cancelledReports = await waitFor(async () => { const { reports } = await invoke("goalReportList", { sessionId: cancelled.id }); return reports[0]?.executionStatus === "interrupted" ? reports : null; }, "cancelled Goal execution interrupted");
      assert.equal(cancelledReports.length, 1); assert.equal(cancelledReports[0].status, "pending", "cancelled Goal published completed report");
      assert.equal((await invoke("teamGetRoster", { teamSessionId: cancelled.id })).members.length, 0);
      assert.equal(calls.slice(callsBeforeCancel).filter(call => call.kind !== "title").length, 0, "cancelled review restarted model");
      console.log("PASS cancelled approved Team Goal: trusted Main review cancel aborts original Host turn and interrupts execution without expert/model replay or completed report");

    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.PI_E2E_TEAM_APPROVED_GOAL = "1";
  setImmediate(() => import("./e2e-team.mjs").catch(error => { console.error(error); process.exitCode = 1; }));
}
