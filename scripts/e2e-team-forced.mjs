#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Production Electron/Main/Host/sidecar with local SSE, isolated profiles only.
export function createForcedFixture(projectPath) {
  const workspace = realpathSync(projectPath);
  const marker = join(workspace, "forced-team-write.txt");
  const shellMarker = join(workspace, "forced-team-bash.txt");
  let retryEntered = false;
  let releaseRetry;
  let pendingAction = "execute";
  let resultEntered = false;
  let releaseResult;
  let expertStarted = false;
  let releaseExpertStarted;
  const noToolRequests = { recover: 0, persistent: 0, planRecover: 0 };
  const write = { name: "Write", args: { path: marker, content: "FORCED_EXPERT_APPROVED\n" } };
  const bash = { name: "Bash", args: { command: "printf 'FORCED_EXPERT_APPROVED\\n' > forced-team-bash.txt" } };
  const plan = { name: "SubmitPlan", args: { title: "Forced Expert Plan", question: "Approve the researched plan?", markdown: "# Forced Expert Plan\n\n1. Use the actual expert findings.\n" } };
  const delegate = { name: "declare_team_strategy", args: {
    strategy: "delegate", reason: "This Expert Team task requires a real expert contribution.",
    members: [{ name: "expert", description: "Inspect the source and report verified findings.", contextKind: "fresh", presentation: { role: "researcher", displayName: "Alex" } }],
  }};
  const statusFrom = messages => {
    for (const message of [...messages].reverse()) {
      if (message.role !== "tool") continue;
      try { const value = JSON.parse(message.content); if (Array.isArray(value.tasks)) return value; } catch {}
    }
  };
  const exists = async path => { try { await access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
  return {
    release() { releaseRetry?.(); releaseResult?.(); releaseExpertStarted?.(); },
    async respond({ userText, priorToolNames, activeToolText, activeTurnMessages, toolNames, allMessages }) {
      const has = name => priorToolNames.includes(name);
      const history = JSON.stringify(allMessages);
      const dispatchExpert = async () => {
        if (!has("task_create")) return { toolCall: { name: "task_create", args: { subject: "FORCE_OWNED_RESEARCH", description: "Read the source and return verified findings.", ownerMemberName: "expert", writeScopes: [] } } };
        if (!has("send_message")) return { toolCall: { name: "send_message", args: { targetMemberName: "expert", content: "FORCE_EXPERT_WORK: read your assigned task and source, then send FORCE_EXPERT_RESULT to Lead." } } };
        // A queued receipt is not proof of participation. Wait for the actual
        // provider request that starts the admitted Host-owned expert turn.
        if (!expertStarted) await new Promise(resolve => { releaseExpertStarted = resolve; });
        return { finalText: "The owned expert task is running." };
      };
      if (history.includes("FORCE_PLAN_TEXT_RECOVER") && !userText.includes("FORCE_EXPERT_RESULT") && !userText.includes("FORCE_EXPERT_WORK")) {
        pendingAction = "plan";
        if (has("declare_team_strategy")) return dispatchExpert();
        noToolRequests.planRecover += 1;
        if (noToolRequests.planRecover === 1) return { finalText: "MODEL_PLAN_PLAIN_DONE: I researched the plan myself." };
        expertStarted = false;
        return { toolCall: delegate };
      }
      if (history.includes("FORCE_TEXT_RECOVER")) {
        if (has("declare_team_strategy")) return { finalText: "Waiting for the required expert launch review." };
        noToolRequests.recover += 1;
        return noToolRequests.recover === 1 ? { finalText: "MODEL_PLAIN_DONE: I handled the entire task myself." } : { toolCall: delegate };
      }
      if (history.includes("FORCE_TEXT_PERSISTENT")) {
        noToolRequests.persistent += 1;
        return { finalText: "MODEL_PERSISTENT_PLAIN_DONE: I will answer without experts." };
      }
      if (userText.includes("FORCE_AGENT")) {
        pendingAction = "execute";
        const declarations = priorToolNames.filter(name => name === "declare_team_strategy").length;
        if (declarations === 0) {
          expertStarted = false;
          resultEntered = false;
          releaseResult = undefined;
          releaseExpertStarted = undefined;
          return { toolCall: { name: "declare_team_strategy", args: { strategy: "lead_only", reason: "The model tries to bypass the user's Expert Team choice." } } };
        }
        if (!has("Write")) return { toolCall: write };
        if (!has("Bash")) return { toolCall: bash };
        assert.match(activeToolText, /TEAM_APPROVAL_REQUIRED/);
        if (declarations === 1) {
          retryEntered = true;
          await new Promise(resolve => { releaseRetry = resolve; });
          return { toolCall: delegate };
        }
        return { finalText: "Waiting for the nonempty expert launch review." };
      }
      if (userText.includes("FORCE_PLAN_BYPASS")) return !has("SubmitPlan")
        ? { toolCall: plan } : { finalText: "Cannot submit a plan without the required expert contribution." };
      if (userText.includes("FORCE_PLAN_DELEGATE")) {
        pendingAction = "plan";
        if (!has("declare_team_strategy")) {
          expertStarted = false;
          return { toolCall: delegate };
        }
        return dispatchExpert();
      }
      if (userText.includes("Team review") && userText.includes("confirmed")) {
        assert.equal(pendingAction, "execute", "Plan research received a user-confirmation kickoff");
        return dispatchExpert();
      }
      if (userText.includes("FORCE_EXPERT_WORK")) {
        expertStarted = true;
        releaseExpertStarted?.();
        assert.equal(toolNames.includes("declare_team_strategy"), false, "expert became a Lead");
        if (!has("team_status")) return { toolCall: { name: "team_status", args: {} } };
        const task = statusFrom(activeTurnMessages)?.tasks.find(item => item.subject === "FORCE_OWNED_RESEARCH");
        assert.ok(task, "actual expert has no owned assignment");
        if (!has("task_get")) return { toolCall: { name: "task_get", args: { taskId: task.taskId } } };
        if (!has("Read")) return { toolCall: { name: "Read", args: { path: "forced-source.md" } } };
        assert.match(activeToolText, /FORCE_VERIFIED_SOURCE/);
        if (pendingAction === "plan") {
          assert.ok(toolNames.includes("submit_research_result"));
          for (const forbidden of ["Write", "Bash", "SubmitPlan"]) assert.equal(toolNames.includes(forbidden), false, `research expert exposed ${forbidden}`);
          if (!has("submit_research_result")) return { toolCall: { name: "submit_research_result", args: { taskId: task.taskId, expectedRevision: task.revision,
            structuredResult: { summary: "FORCE_VERIFIED_FINDING", findings: ["Verified the assigned source"], risks: [], recommendations: ["Use the existing source"], verifiedSources: ["forced-source.md"] },
          } } };
        } else if (!has("task_update")) return { toolCall: { name: "task_update", args: { taskId: task.taskId, expectedRevision: task.revision, status: "completed" } } };
        if (!has("send_message")) return { toolCall: { name: "send_message", args: { targetMemberName: "Lead", content: "FORCE_EXPERT_RESULT: verified the assigned workspace source." } } };
        return { finalText: "The assigned expert contribution is complete." };
      }
      if (userText.includes("FORCE_EXPERT_RESULT")) {
        if (!has("Write") && !has("team_status")) {
          resultEntered = true;
          await new Promise(resolve => { releaseResult = resolve; });
        }
        if (pendingAction === "plan") {
          if (!has("team_status")) return { toolCall: { name: "team_status", args: {} } };
          const status = statusFrom(activeTurnMessages);
          assert.equal(status?.planning?.isReadyForPlanSubmission, true);
          assert.equal(status.planning.results[0].structuredResult.summary, "FORCE_VERIFIED_FINDING");
          return { toolCall: plan };
        }
        if (!has("Write")) return { toolCall: write };
        if (!has("Bash")) return { toolCall: bash };
        return { finalText: "FORCED_EXPERT_DONE" };
      }
      throw new Error(`Unexpected forced Team prompt: ${userText.slice(0, 180)}`);
    },
    async runJourney(context) {
      const { lead, planLead, completionSessions, invoke, evaluate, sendCdp, waitFor, calls, submitComposerPrompt, openTeamPanel, saveScreenshot } = context;
      // UiMessage intentionally omits turnId. Observe the public event envelope
      // and verify those IDs against the Host-owned durable turn API instead.
      await evaluate(`(() => {
        window.__forcedTurnEvidence = {};
        window.__forcedTurnEvidenceUnsubscribe = window.piDesktop.on(window.piDesktop.channels.event.agentMessage, envelope => {
          if (!envelope?.sessionId || !envelope.turnId) return;
          const ids = window.__forcedTurnEvidence[envelope.sessionId] ??= [];
          if (!ids.includes(envelope.turnId)) ids.push(envelope.turnId);
        });
      })()`);
      const observedTurnIds = session => evaluate(`window.__forcedTurnEvidence[${JSON.stringify(session.id)}] ?? []`);
      const select = async session => {
        await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${session.id}"]') && !document.querySelector('.startup-splash')`), "forced Team sidebar");
        await evaluate(`document.querySelector('[data-sidebar-session-row="${session.id}"] .thread-item-main').click()`);
        await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${session.id}"] .thread-item-main[aria-current="page"]') && !!document.querySelector('.composer-input[contenteditable="true"]')`), "forced Team Composer ready");
        await waitFor(() => evaluate(session.mode === "plan" ? `!!document.querySelector('.composer-contract-chip[data-mode="plan"]')` : `!document.querySelector('.composer-contract-chip')`), "forced Team mode hydrated");
      };
      const idle = session => waitFor(async () => (await invoke("agentGetStatus", session.id)).status?.isRunning === false, "forced Team turn settled");
      const noSideEffects = async session => {
        assert.equal(await exists(marker), false);
        assert.equal(await exists(shellMarker), false);
        assert.deepEqual((await invoke("plansPending", { sessionId: session.id })).plans, []);
        assert.equal((await invoke("teamGetRoster", { teamSessionId: session.id })).members.length, 0);
        assert.equal((await invoke("teamGetBoard", { teamSessionId: session.id })).tasks.length, 0);
      };
      const approveAndWaitExpert = async session => {
        const review = await waitFor(async () => {
          const current = (await invoke("teamGetLaunchReview", { teamSessionId: session.id })).review;
          return current?.status === "pending" && (current.strategy ?? "delegate") === "delegate" && current.members.length === 1 ? current : null;
        }, "nonempty delegate launch review");
        await idle(session);
        await noSideEffects(session);
        await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)') && document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === 'team:${session.id}'`), "expert approval automatically opens the closed Work Panel");
        await saveScreenshot(sendCdp, `forced-team-${session.mode}-pending.png`);
        await evaluate(`document.querySelector('[data-testid="team-launch-review-confirm-btn"]').click()`);
        await waitFor(() => resultEntered, "actual assigned expert result delivered");
        const members = (await invoke("teamGetRoster", { teamSessionId: session.id })).members;
        assert.equal(members.length, 1);
        await waitFor(async () => (await invoke("agentGetStatus", members[0].memberSessionId)).status?.isRunning === false, "expert settled before substantive Lead work");
        assert.equal(await exists(marker), false, "Lead wrote before receiving the real expert contribution");
        assert.equal(await exists(shellMarker), false);
        assert.deepEqual((await invoke("plansPending", { sessionId: session.id })).plans, [], "Lead finalized a plan before actual expert dispatch");
        assert.ok(calls.some(call => call.userText.includes("FORCE_EXPERT_WORK") && call.tool === "Read"), "no actual expert model Read occurred");
        const completedReview = (await invoke("teamGetLaunchReview", { teamSessionId: session.id })).review;
        assert.equal(completedReview.reviewId, review.reviewId);
        assert.equal(completedReview.status, "confirmed");
        releaseResult();
      };
      const waitAutomaticPlanExpert = async session => {
        const current = await waitFor(async () => {
          const review = (await invoke("teamGetLaunchReview", { teamSessionId: session.id })).review;
          return review?.status === "confirmed" && review.launchPolicy === "automatic_plan" && review.members.length === 1 ? review : null;
        }, "automatic readonly Plan expert authority");
        await openTeamPanel(sendCdp, evaluate, session.id);
        assert.equal(await evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), false, "automatic Plan displayed a launch approval card");
        await waitFor(() => resultEntered, "real automatic Plan expert result delivered");
        const members = (await invoke("teamGetRoster", { teamSessionId: session.id })).members;
        assert.equal(members.length, 1);
        await waitFor(async () => (await invoke("agentGetStatus", members[0].memberSessionId)).status?.isRunning === false, "automatic Plan expert settled");
        const expert = (await invoke("sessionGet", { id: members[0].memberSessionId })).session;
        assert.ok(expert.messages.some(row => row.toolName === "Read" && row.toolStatus === "success"), "automatic expert never read its owned workspace source");
        assert.deepEqual((await invoke("plansPending", { sessionId: session.id })).plans, [], "Plan finalized before expert contribution");
        releaseResult();
        await waitFor(async () => (await invoke("plansPending", { sessionId: session.id })).plans.some(item => item.title === plan.args.title), "automatic expert-backed Plan proposal");
        return current;
      };
      await writeFile(join(projectPath, "forced-source.md"), "FORCE_VERIFIED_SOURCE\n");
      await select(completionSessions.recover);
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_TEXT_RECOVER: use the Expert Team; verify text-only completion cannot bypass it.");
      const recoveredReview = await waitFor(async () => {
        const current = (await invoke("teamGetLaunchReview", { teamSessionId: completionSessions.recover.id })).review;
        return current?.status === "pending" && current.members.length === 1 ? current : null;
      }, "one text-only recovery creates nonempty expert review");
      await idle(completionSessions.recover);
      assert.equal(noToolRequests.recover, 2, "text-only completion must use one bounded recovery");
      const recoveredMessages = (await invoke("sessionGet", { id: completionSessions.recover.id })).session.messages;
      const recoveredTurnIds = await observedTurnIds(completionSessions.recover);
      assert.deepEqual(recoveredTurnIds, [recoveredReview.leadTurnId], "recovery started a different durable user turn");
      const recoveredTurn = await invoke("turnGet", { sessionId: completionSessions.recover.id, turnId: recoveredReview.leadTurnId });
      assert.equal(recoveredTurn.turnId, recoveredReview.leadTurnId);
      assert.equal(recoveredTurn.status, "completed", "pending expert review did not settle the original durable turn");
      assert.equal(recoveredMessages.filter(row => row.role === "user" && row.content?.includes("FORCE_TEXT_RECOVER")).length, 1, "recovery invented another user submission");
      await noSideEffects(completionSessions.recover);
      console.log("PASS Forced Team text recovery: no-tool answer gets one same-durable-turn recovery and a nonempty pending expert review");

      await select(completionSessions.persistent);
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_TEXT_PERSISTENT: keep using the Expert Team even if the model repeatedly avoids tools.");
      await waitFor(() => noToolRequests.persistent >= 2, "persistent plain-answer recovery attempted");
      await idle(completionSessions.persistent);
      assert.equal(noToolRequests.persistent, 2, "persistent no-tool answers were retried without a bound");
      const persistentMessages = (await invoke("sessionGet", { id: completionSessions.persistent.id })).session.messages;
      assert.equal(persistentMessages.filter(row => row.role === "user" && row.content?.includes("FORCE_TEXT_PERSISTENT")).length, 1);
      const persistentTurnIds = await observedTurnIds(completionSessions.persistent);
      assert.equal(persistentTurnIds.length, 1, "persistent recovery started another durable turn");
      const failedTurn = await waitFor(async () => {
        const value = await invoke("turnGet", { sessionId: completionSessions.persistent.id, turnId: persistentTurnIds[0] });
        return value.status === "error" ? value : null;
      }, "persistent text-only answer is explicitly failed");
      assert.equal(failedTurn.errorCode, "TEAM_APPROVAL_REQUIRED");
      const persistentFinalRows = (await invoke("sessionGet", { id: completionSessions.persistent.id })).session.messages
        .filter(row => row.role === "assistant" && row.content?.includes("MODEL_PERSISTENT_PLAIN_DONE"));
      assert.ok(persistentFinalRows.length > 0, "persistent no-tool response disappeared from the transcript");
      assert.ok(persistentFinalRows.every(row => row.status !== "complete"), "unverified plain answer was persisted as a healthy completion");
      await noSideEffects(completionSessions.persistent);
      console.log("PASS Forced Team persistent text: one recovery, explicit failed durable turn, no healthy completion or side effects");

      await select(completionSessions.planRecover);
      resultEntered = false;
      const planRecoveryCallBase = calls.length;
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_PLAN_TEXT_RECOVER: automatically research this implementation plan with real experts.");
      const planRecoveryReview = await waitAutomaticPlanExpert(completionSessions.planRecover);
      await idle(completionSessions.planRecover);
      assert.equal(noToolRequests.planRecover, 2, "Plan text-only completion must use one bounded recovery");
      const planRecoveryTurn = await invoke("turnGet", { sessionId: completionSessions.planRecover.id, turnId: planRecoveryReview.leadTurnId });
      assert.equal(planRecoveryTurn.status, "completed", "automatic recovery did not retain its original durable user turn");
      const planRecoveryMessages = (await invoke("sessionGet", { id: completionSessions.planRecover.id })).session.messages;
      assert.equal(planRecoveryMessages.filter(row => row.role === "user" && row.content?.includes("FORCE_PLAN_TEXT_RECOVER")).length, 1, "Plan recovery invented a new user submission");
      assert.equal(calls.slice(planRecoveryCallBase).filter(call => call.userText.includes("Team review") && call.userText.includes("confirmed")).length, 0, "Plan text recovery required launch confirmation");
      await saveScreenshot(sendCdp, "forced-team-plan-text-recovery.png");
      console.log("PASS Forced Team Plan text recovery: one same-turn recovery automatically dispatches an owned readonly expert and full verified research before proposal, zero launch confirmations");

      await select(lead);
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_AGENT: use the Expert Team for this task.");
      await waitFor(() => retryEntered, "model solo bypass rejected before same-turn retry");
      await noSideEffects(lead);
      assert.equal((await invoke("teamGetLaunchReview", { teamSessionId: lead.id })).review, null, "rejected solo request persisted a review");
      assert.equal((await invoke("teamGetExecutionDecision", { teamSessionId: lead.id })).decision, null, "rejected solo request persisted a decision");
      const rejected = (await invoke("sessionGet", { id: lead.id })).session.messages;
      for (const name of ["declare_team_strategy", "Write", "Bash"]) assert.ok(rejected.some(row => row.toolName === name && row.toolStatus === "error"), `${name} bypass was not rejected`);
      console.log("PASS Forced Team: model lead_only rejected without decisions/reviews/tasks/members; Write/Bash bypass denied");
      // Session switches project their panel presentation asynchronously.
      // Wait for a stable closed/open state instead of toggling a stale one.
      const panelState = await waitFor(() => evaluate(`(() => {
        const panel=document.querySelector('[data-testid="work-panel"]');
        const pressed=document.querySelector('.app-work-panel-toggle')?.getAttribute('aria-pressed');
        if (!panel && pressed === 'false') return 'closed';
        if (panel && panel.getAttribute('data-exiting') !== 'true' && pressed === 'true') return 'open';
        return null;
      })()`), "stable Agent Work Panel presentation before closed-case setup");
      if (panelState === "open") {
        await evaluate(`(async () => { const panel=document.querySelector('[data-testid="work-panel"]'); await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); })()`);
        await evaluate(`document.querySelector('.app-work-panel-toggle').click()`);
      }
      await waitFor(() => evaluate(`!document.querySelector('[data-testid="work-panel"]') && document.querySelector('.app-work-panel-toggle')?.getAttribute('aria-pressed') === 'false'`), "Work Panel closed before new Agent review");
      releaseRetry();
      await approveAndWaitExpert(lead);
      await waitFor(async () => (await exists(marker)) && (await exists(shellMarker)), "real expert-backed Lead writes");
      await idle(lead);
      assert.equal(await readFile(marker, "utf8"), "FORCED_EXPERT_APPROVED\n");
      assert.equal(await readFile(shellMarker, "utf8"), "FORCED_EXPERT_APPROVED\n");
      console.log("PASS Forced Team Agent: same-turn delegate retry, existing launch approval, owned expert task/read/result before Lead Write/Bash");

      // Isolate the Plan bypass assertions from the legitimate Agent outputs.
      await select(planLead);
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_PLAN_BYPASS: attempt to submit without an expert.");
      await idle(planLead);
      await waitFor(async () => (await invoke("sessionGet", { id: planLead.id })).session.messages.some(row => row.toolName === "SubmitPlan" && row.toolStatus === "error"), "SubmitPlan bypass rejected");
      await idle(planLead);
      assert.deepEqual((await invoke("plansPending", { sessionId: planLead.id })).plans, []);
      assert.equal((await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review, null);
      resultEntered = false;
      await submitComposerPrompt(sendCdp, evaluate, "FORCE_PLAN_DELEGATE: use the actual expert to research the plan.");
      // Existing Agent outputs are intentional; Plan has its own roster,
      // owned readonly research tasks and final user-approvable proposal.
      await waitAutomaticPlanExpert(planLead);
      await saveScreenshot(sendCdp, "forced-team-plan-complete.png");
      console.log("PASS Forced Team Plan: premature SubmitPlan denied, automatically dispatched readonly expert completes assigned research before final user-approvable plan");
      await evaluate(`window.__forcedTurnEvidenceUnsubscribe()`);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.PI_E2E_TEAM_FORCED = "1";
  setImmediate(() => import("./e2e-team.mjs").catch(error => { console.error(error); process.exitCode = 1; }));
}
