#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The existing Team harness owns Electron/CDP, Rust Host, the real sidecar,
// local SSE transport and all profile cleanup. Only this scenario is new.
export function createPlanningFixture(projectPath) {
  let releaseSecond;
  let secondEntered = false;
  let releaseFinalize;
  let finalizeEntered = false;
  let completeResultsObserved = false;
  let signalFinalizing;
  const finalizing = new Promise(resolve => { signalFinalizing = resolve; });
  let supplementaryMessageId;
  let supplementaryEntered = false;
  let releaseSupplementary;
  const supplementaryReport = "补充调查结论：删除用户需要保留审计记录，避免账户关联数据丢失。TP_MAIL_RISK: preserve audit history when deleting a user.";
  const queuedUserPrompt = "TP_USER_QUEUED: keep my follow-up until I choose what to do with the plan.";
  const structuredGates = ["ONE", "TWO"].map(id => ({ id, entered: false, release: null }));
  let pendingExpertAction;
  let actionSequence = 0;
  let actionTaskSubject;
  let actionExpertSessionId;
  let actionResultEntered = false;
  let releaseActionResult;
  let signalResearchStart;
  const researchStarted = new Promise(resolve => { signalResearchStart = resolve; });
  let signalActionStart;
  let actionStarted = Promise.resolve();
  const canonicalProjectPath = realpathSync(projectPath);
  const markerPath = join(canonicalProjectPath, "approved-team-plan-marker.txt");
  const statusFrom = (messages) => {
    for (const message of [...messages].reverse()) {
      if (message.role !== "tool") continue;
      try {
        const value = JSON.parse(message.content);
        if (Array.isArray(value.tasks)) return value;
      } catch { /* Other tool results are plain text. */ }
    }
    return null;
  };
  const plan = (title) => ({ name: "SubmitPlan", args: {
    title, question: "Approve this isolated expert research plan?",
    markdown: `# ${title}\n\n1. Preserve both verified research results.\n2. Write the approved execution marker.\n${title === "Complete Team Research" ? `\nTP_VERIFIED_ONE: Verified finding ONE (source-ONE.md).\nTP_VERIFIED_TWO: Verified finding TWO (source-TWO.md).\n\n${supplementaryReport}\n` : ""}`,
  }});
  const actionExpertName = () => pendingExpertAction === "execute" ? "execution_expert" : "research_one";
  const actionTitle = () => pendingExpertAction === "revision" ? "Revised Team Research" : "Retry Team Research";
  const delegateAction = () => {
    actionTaskSubject = `TP_ACTION_${pendingExpertAction}_${++actionSequence}`;
    actionStarted = new Promise(resolve => { signalActionStart = resolve; });
    return { name: "declare_team_strategy", args: {
    strategy: "delegate", reason: "The approved expert must investigate this revision or execution.",
    // Approved Agent execution defaults to Ask. A fresh execution expert
    // inherits that ceiling; the prior Auto researchers retain their settings.
    members: [{ name: actionExpertName(),
      ...(pendingExpertAction === "execute" ? {} : { memberSessionId: actionExpertSessionId }),
      description: "Verify the requested action.", contextKind: "fresh",
      presentation: pendingExpertAction === "execute" ? { role: "executor", displayName: "Sam" } : { role: "researcher", displayName: "Alex" },
    }],
  }};
  };

  return {
    releaseResearch() { releaseSecond?.(); releaseFinalize?.(); releaseSupplementary?.(); releaseActionResult?.(); structuredGates.forEach(gate => gate.release?.()); signalFinalizing?.(); signalResearchStart?.(); signalActionStart?.(); },
    async respond({ userText, priorToolNames, activeTurnMessages, activeToolText, toolNames }) {
      const has = (name) => priorToolNames.includes(name);
      const answer = (finalText) => ({ finalText });
      const tool = (name, args = {}) => ({ toolCall: { name, args } });
      if (userText.includes("TP_STRUCTURED_ONLY_LEAD")) {
        assert.ok(toolNames.includes("wait_for_updates"), "structured-only Lead cannot await actual research updates");
        if (!has("declare_team_strategy")) return tool("declare_team_strategy", {
          strategy: "delegate", reason: "Verify two sources without duplicate completion mail.",
          members: ["one", "two"].map(id => ({ name: `structured_${id}`, description: "Return the complete structured research result.", contextKind: "fresh", presentation: { role: "researcher", displayName: id === "one" ? "Alex" : "Tina" } })),
        });
        const created = priorToolNames.filter(name => name === "task_create").length;
        if (created < 2) return tool("task_create", { subject: `TP_STRUCTURED_${created === 0 ? "ONE" : "TWO"}`, ownerMemberName: created === 0 ? "structured_one" : "structured_two", writeScopes: [] });
        const sent = priorToolNames.filter(name => name === "send_message").length;
        if (sent < 2) return tool("send_message", { targetMemberName: sent === 0 ? "structured_one" : "structured_two", content: sent === 0 ? "TP_STRUCTURED_WORK_ONE" : "TP_STRUCTURED_WORK_TWO" });
        if (priorToolNames.at(-1) !== "team_status") return tool("team_status");
        const status = statusFrom(activeTurnMessages);
        assert.equal(status?.planning?.pendingMessagesCount, 0, "structured-only research created duplicate completion mail");
        if (!status.planning.isReadyForPlanSubmission) return tool("wait_for_updates", { timeoutSeconds: 2 });
        assert.equal(status.planning.completedResearchTasks, 2);
        assert.deepEqual(status.planning.results.map(item => item.structuredResult.summary).sort(), ["TP_STRUCTURED_VERIFIED_ONE", "TP_STRUCTURED_VERIFIED_TWO"]);
        return tool("SubmitPlan", { title: "Structured Only Team Research", question: "Approve the complete structured-only research plan?", markdown: "# Structured Only Team Research\n\nTP_STRUCTURED_VERIFIED_ONE: preserve the verified first source.\nTP_STRUCTURED_VERIFIED_TWO: preserve the verified second source.\n" });
      }
      if (/TP_STRUCTURED_WORK_(ONE|TWO)/.test(userText)) {
        const id = userText.includes("TP_STRUCTURED_WORK_ONE") ? "ONE" : "TWO";
        assert.ok(toolNames.includes("submit_research_result"));
        for (const forbidden of ["Write", "Bash", "SubmitPlan", "declare_team_strategy"]) assert.equal(toolNames.includes(forbidden), false, `structured researcher exposed ${forbidden}`);
        if (!has("team_status")) {
          const gate = structuredGates.find(item => item.id === id);
          gate.entered = true;
          await new Promise(resolve => { gate.release = resolve; });
          return tool("team_status");
        }
        const task = statusFrom(activeTurnMessages)?.tasks.find(item => item.subject === `TP_STRUCTURED_${id}`);
        assert.ok(task, "structured-only expert lost its owned task");
        if (!has("Read")) return tool("Read", { path: `source-${id}.md` });
        assert.ok(activeToolText.includes(`TP_SOURCE_${id}`), "structured-only expert did not read its source");
        if (!has("submit_research_result")) return tool("submit_research_result", { taskId: task.taskId, expectedRevision: task.revision, structuredResult: { summary: `TP_STRUCTURED_VERIFIED_${id}`, findings: [`Verified source ${id}`], risks: ["Preserve audit history"], recommendations: ["Use the verified source"], verifiedSources: [`source-${id}.md`] } });
        assert.equal(has("send_message"), false, "structured-only expert emitted redundant completion mail");
        return answer(`Structured investigation ${id} complete.`);
      }
      const dispatchAction = async () => {
        if (!has("task_create")) return tool("task_create", {
          subject: actionTaskSubject, description: "Verify the requested action using the workspace source.",
          ownerMemberName: actionExpertName(), writeScopes: [],
        });
        if (!has("send_message")) return tool("send_message", { targetMemberName: actionExpertName(), content: "TP_ACTION_RESEARCH: verify your assigned action and send TP_ACTION_RESULT to Lead." });
        await actionStarted;
        return answer("The action expert is running.");
      };
      if (userText.includes("TP_DELEGATE")) {
        assert.ok(toolNames.includes("declare_team_strategy"), "Team Plan Lead lacks delegation");
        assert.equal(toolNames.includes("submit_research_result"), false, "Lead became a researcher");
        if (!has("declare_team_strategy")) return tool("declare_team_strategy", {
          strategy: "delegate", reason: "Two independent read-only investigations are needed.",
          members: ["one", "two"].map((id) => ({
            name: `research_${id}`, description: `Read-only research ${id}`, contextKind: "fresh",
            presentation: { role: "researcher", displayName: id === "one" ? "Alex" : "Tina" },
          })),
        });
        // Plan declarations authorize read-only research immediately, in the
        // same user turn; there is no trusted user-confirmation kickoff mail.
        const created = priorToolNames.filter((name) => name === "task_create").length;
        if (created < 2) return tool("task_create", {
          subject: `TP_RESEARCH_${created === 0 ? "ONE" : "TWO"}`,
          description: "Read-only research; return a bounded structured result.",
          ownerMemberName: created === 0 ? "research_one" : "research_two", writeScopes: [],
        });
        const sent = priorToolNames.filter((name) => name === "send_message").length;
        if (sent < 2) return tool("send_message", {
          targetMemberName: sent === 0 ? "research_one" : "research_two",
          content: sent === 0 ? "TP_RESEARCH_ONE" : "TP_RESEARCH_TWO",
        });
        await researchStarted;
        return answer("Owned read-only research tasks are running automatically.");
      }
      if (userText.includes("Team review") && userText.includes("confirmed")) {
        assert.equal(pendingExpertAction, "execute", "Plan research unexpectedly required user launch confirmation");
        return dispatchAction();
      }
      if (userText.includes("TP_ACTION_RESEARCH")) {
        signalActionStart?.();
        assert.equal(toolNames.includes("declare_team_strategy"), false, "action expert became a Lead");
        if (!has("team_status")) return tool("team_status");
        const status = statusFrom(activeTurnMessages);
        const task = status?.tasks.find(item => item.subject === actionTaskSubject);
        assert.ok(task, "expert action has no owned task");
        if (!has("task_get")) return tool("task_get", { taskId: task.taskId });
        if (!has("Read")) return tool("Read", { path: "source-ONE.md" });
        assert.match(activeToolText, /TP_SOURCE_ONE/, "action expert did not read its source");
        if (toolNames.includes("submit_research_result")) {
          if (!has("submit_research_result")) return tool("submit_research_result", { taskId: task.taskId, expectedRevision: task.revision,
            structuredResult: { summary: "TP_ACTION_VERIFIED", findings: ["Verified the workspace source"],
              risks: ["Preserve compatibility"], recommendations: ["Use the verified action"], verifiedSources: ["source-ONE.md"] },
          });
        } else if (!has("task_update")) return tool("task_update", { taskId: task.taskId, expectedRevision: task.revision, status: "completed" });
        if (!has("send_message")) return tool("send_message", { targetMemberName: "Lead", content: "TP_ACTION_RESULT: verified the assigned action." });
        return answer("The assigned expert action is complete.");
      }
      if (userText.includes("TP_ACTION_RESULT")) {
        if (!has("team_status") && !has("Write")) {
          actionResultEntered = true;
          await new Promise(resolve => { releaseActionResult = resolve; });
        }
        if (pendingExpertAction === "execute") {
          assert.ok(toolNames.includes("Write"));
          if (!has("Write")) return tool("Write", { path: markerPath, content: "APPROVED_TEAM_EXECUTION\n" });
          return answer("Approved execution used its expert and wrote the isolated marker.");
        }
        if (!has("team_status")) return tool("team_status");
        const status = statusFrom(activeTurnMessages);
        assert.equal(status?.planning?.isReadyForPlanSubmission, true, "action research was not complete before SubmitPlan");
        return { toolCall: plan(actionTitle()) };
      }
      if (/TP_RESEARCH_(ONE|TWO)/.test(userText)) {
        signalResearchStart();
        const id = userText.includes("TP_RESEARCH_ONE") ? "ONE" : "TWO";
        for (const forbidden of ["Write", "Edit", "Bash", "Skill", "SubmitPlan", "spawn_teammate", "task_create", "declare_team_strategy"]) {
          assert.equal(toolNames.includes(forbidden), false, `researcher exposed ${forbidden}`);
        }
        assert.ok(toolNames.includes("submit_research_result"), "researcher cannot submit a result");
        assert.ok(toolNames.includes("Read"), "researcher lost read-only investigation");
        if (!has("team_status")) {
          if (id === "TWO") {
            secondEntered = true;
            await new Promise((resolve) => { releaseSecond = resolve; });
          }
          return tool("team_status");
        }
        const status = statusFrom(activeTurnMessages);
        assert.ok(status?.planning?.roundId, "Host round missing from researcher status");
        const task = status.tasks.find((item) => item.subject === `TP_RESEARCH_${id}`);
        assert.ok(task, "Lead did not create an owned research task");
        if (!has("task_get")) return tool("task_get", { taskId: task.taskId });
        if (!has("Read")) return tool("Read", { path: `source-${id}.md` });
        assert.ok(activeToolText.includes(`TP_SOURCE_${id}`), "researcher did not actually read its workspace source");
        if (!has("submit_research_result")) return tool("submit_research_result", {
          taskId: task.taskId, expectedRevision: task.revision,
          structuredResult: {
            summary: `TP_VERIFIED_${id}`, findings: [`Verified finding ${id}`],
            risks: [`Compatibility risk ${id}`], recommendations: [`Recommendation ${id}`],
            verifiedSources: [`source-${id}.md`],
          },
        });
        assert.equal(activeToolText.includes("TEAM_RESEARCH_INVALID"), false, "research submission failed");
        if (!has("send_message")) return tool("send_message", {
          targetMemberName: "Lead", content: `TP_RESULT_${id}`,
        });
        if (id === "TWO") {
          const sends = priorToolNames.filter(name => name === "send_message").length;
          if (sends === 1) {
            // Reproduce a genuine expert completion report arriving after the
            // structured result, while the Lead is already synthesizing it.
            await finalizing;
            return tool("send_message", { targetMemberName: "Lead", content: supplementaryReport });
          }
          const receipt = [...activeTurnMessages].reverse().find(message => message.role === "tool");
          assert.ok(receipt, "supplementary report lost its real Host receipt");
          supplementaryMessageId = JSON.parse(receipt.content).messageId;
          assert.ok(supplementaryMessageId, "supplementary report has no authenticated mailbox ID");
        }
        return answer(`TP_RESULT_${id} complete.`);
      }
      if (userText.includes(supplementaryReport)) {
        if (!has("team_status")) {
          supplementaryEntered = true;
          await new Promise(resolve => { releaseSupplementary = resolve; });
          return tool("team_status");
        }
        const status = statusFrom(activeTurnMessages);
        assert.equal(status?.planning?.pendingMessagesCount, 0, "final mailbox continuation still has unread expert reports");
        assert.equal(status.planning.isReadyForPlanSubmission, true);
        assert.equal(status.planning.completedResearchTasks, 2);
        completeResultsObserved = true;
        return { toolCall: plan("Complete Team Research") };
      }
      // Probe submission inside the genuine researcher-to-Lead continuation.
      // A new user prompt would correctly invalidate this research approval.
      if (/TP_RESULT_(ONE|TWO)/.test(userText)) {
        if (!has("team_status")) {
          if (userText.includes("TP_RESULT_TWO")) {
            finalizeEntered = true;
            signalFinalizing();
            await new Promise(resolve => { releaseFinalize = resolve; });
          }
          return tool("team_status");
        }
        const status = statusFrom(activeTurnMessages);
        assert.equal(status?.planning?.totalExpectedTasks, 2);
        assert.equal(status.planning.openQuestionsCount, 0);
        if (userText.includes("TP_RESULT_ONE")) {
          assert.equal(status.planning.completedResearchTasks, 1);
          assert.equal(status.planning.isReadyForPlanSubmission, false);
          if (!has("SubmitPlan")) return { toolCall: plan("Incomplete Team Research") };
          assert.match(activeToolText, /TEAM_PLANNING_NOT_READY/);
          return answer("Incomplete research cannot submit a plan.");
        }
        assert.equal(status.planning.completedResearchTasks, 2);
        assert.equal(status.planning.pendingMessagesCount, 1, "supplementary report did not participate in readiness");
        assert.equal(status.planning.isReadyForPlanSubmission, false, "full structured results hid unread expert mail");
        assert.deepEqual(status.planning.results.map((result) => result.structuredResult.summary).sort(), ["TP_VERIFIED_ONE", "TP_VERIFIED_TWO"]);
        assert.ok(status.planning.results.every((result) => result.structuredResult.verifiedSources.length === 1));
        return { toolCall: plan("Complete Team Research") };
      }
      if (/TP_REVISE|TP_RETRY/.test(userText)) {
        if (!has("declare_team_strategy")) {
          pendingExpertAction = userText.includes("TP_REVISE") ? "revision" : "retry";
          actionResultEntered = false;
          return { toolCall: delegateAction() };
        }
        return dispatchAction();
      }
      if (userText.includes("Approved plan title:")) {
        assert.ok(toolNames.includes("Write"), "approved Lead did not regain normal Agent permissions");
        assert.equal(toolNames.includes("submit_research_result"), false, "approved Lead retained researcher tools");
        if (!has("declare_team_strategy")) {
          pendingExpertAction = "execute";
          actionResultEntered = false;
          return { toolCall: delegateAction() };
        }
        return answer("The approved plan requires an expert execution review.");
      }
      throw new Error(`Unexpected Team planning fixture prompt: ${userText.slice(0, 240)}`);
    },

    async runJourney(context) {
      let { invoke, evaluate, sendCdp } = context;
      const { planLead, waitFor, calls, submitComposerPrompt, openTeamPanel, saveScreenshot } = context;
      const selectLead = async () => {
        await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${planLead.id}"]') && !document.querySelector('.startup-splash')`), "isolated Plan Lead");
        await evaluate(`document.querySelector('[data-sidebar-session-row="${planLead.id}"] button.thread-item-main').click()`);
        await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="plan"]')`), "Team Plan Composer");
      };
      const idle = () => waitFor(async () => (await invoke("agentGetStatus", planLead.id)).status?.isRunning === false, "Lead settled");
      const prompt = (text) => submitComposerPrompt(sendCdp, evaluate, text);
      let lastAutomaticReviewId;
      const assertAutomaticReview = async (memberCount, fresh = false) => {
        const review = await waitFor(async () => {
          const current = (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review;
          return current?.status === "confirmed" && current.launchPolicy === "automatic_plan" && current.members.length === memberCount && (!fresh || current.reviewId !== lastAutomaticReviewId) ? current : null;
        }, "durable automatic Plan research authority");
        lastAutomaticReviewId = review.reviewId;
        await openTeamPanel(sendCdp, evaluate, planLead.id);
        assert.equal(await evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), false, "automatic Plan research displayed launch confirmation UI");
        assert.equal(calls.filter(call => call.kind !== "title" && call.userText.includes("Team review") && call.userText.includes("confirmed")).length, 0, "automatic research received a user-confirmation kickoff");
        return review;
      };
      let executionCallBase = 0;
      const waitActionExpert = async (requiresApproval) => {
        if (requiresApproval) {
          await waitFor(async () => {
            const review = (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review;
            return review?.status === "pending" && review.launchPolicy === "user_confirmed" && review.members.length === 1;
          }, "pending Agent execution expert review");
          await idle();
          // Agent review must reveal itself from the current Overview surface;
          // do not open Team manually, which would hide a missing auto-open.
          await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review"]') && document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === 'team:${planLead.id}'`), "Agent execution review automatically visible from Overview");
          await saveScreenshot(sendCdp, "team-planning-execution-review-auto-open.png");
          assert.equal(calls.slice(executionCallBase).some(call => call.kind !== "title" && call.userText.includes("TP_ACTION_RESEARCH") && call.tool === "Read"), false, "execution expert ran before user launch approval");
          await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')`), "Agent execution expert launch enabled");
          await evaluate(`document.querySelector('[data-testid="team-launch-review-confirm-btn"]').click()`);
        } else {
          await assertAutomaticReview(1, true);
        }
        await waitFor(() => actionResultEntered, "real action expert result delivered");
        const approvedExpert = (await invoke("teamGetRoster", { teamSessionId: planLead.id })).members.find(member => member.name === actionExpertName());
        assert.ok(approvedExpert?.memberSessionId, "action expert has no real session");
        actionExpertSessionId = approvedExpert.memberSessionId;
        const expertSession = (await invoke("sessionGet", { id: actionExpertSessionId })).session;
        if (requiresApproval) assert.equal(expertSession.permissionMode, "ask", "fresh execution expert did not inherit Ask permission");
        await waitFor(async () => (await invoke("agentGetStatus", actionExpertSessionId)).status?.isRunning === false, "action expert settled before Lead finalization");
        releaseActionResult();
      };
      await Promise.all(["ONE", "TWO"].map((id) => writeFile(join(projectPath, `source-${id}.md`), `TP_SOURCE_${id}\nVerified finding ${id}\n`)));
      await selectLead();
      await prompt("TP_DELEGATE: create a user management implementation plan using the Expert Team.");
      await assertAutomaticReview(2);
      await waitFor(async () => {
        const board = await invoke("teamGetBoard", { teamSessionId: planLead.id });
        return secondEntered && board.tasks.length === 2 && board.tasks.filter((task) => task.status === "completed").length === 1;
      }, "first result with second researcher held");
      // Failed SubmitPlan terminates the turn; no extra model final answer follows.
      await waitFor(() => calls.some((call) => call.kind !== "title" && call.userText.includes("TP_RESULT_ONE") && call.tool === "SubmitPlan"), "first result delivered to Lead and early submission attempted");
      await waitFor(async () => {
        const session = (await invoke("sessionGet", { id: planLead.id })).session;
        return session.messages.some((message) => message.toolName === "SubmitPlan" &&
          message.toolStatus === "error" && message.toolResult?.details?.errorCode === "TEAM_PLANNING_NOT_READY");
      }, "Host rejected first-result SubmitPlan");
      await idle();
      assert.deepEqual((await invoke("plansPending", { sessionId: planLead.id })).plans, [], "incomplete result created a proposal");
      console.log("PASS Team Plan automatic research: zero launch confirmations, two owned tasks, read-only tools, first result cannot SubmitPlan");
      releaseSecond();
      await waitFor(async () => (await invoke("teamGetBoard", { teamSessionId: planLead.id })).tasks.every((task) => task.status === "completed"), "both structured results committed");
      await waitFor(() => finalizeEntered, "second result delivered to Lead with finalization held");
      await waitFor(async () => {
        const members = (await invoke("teamGetRoster", { teamSessionId: planLead.id })).members;
        const statuses = await Promise.all(members.map((member) => invoke("agentGetStatus", member.memberSessionId)));
        return statuses.length === 2 && statuses.every((result) => result.status?.isRunning === false);
      }, "all researcher turns settled before submission");
      assert.ok(supplementaryMessageId, "real researcher did not send its supplementary completion report");
      const beforeSubmission = await waitFor(async () => {
        const entries = (await invoke("agentQueueList", { sessionId: planLead.id })).entries;
        return entries.find(entry => entry.sessionMessageId === supplementaryMessageId);
      }, "supplementary report durably queued behind busy Lead");
      assert.ok(beforeSubmission.content.includes(supplementaryReport), "queued report dropped its full original content");
      // Explicit sync point: both researchers must finish before final SubmitPlan.
      releaseFinalize();
      await waitFor(() => supplementaryEntered, "normal deferred submission yields to real supplementary mail");
      const deferredSession = (await invoke("sessionGet", { id: planLead.id })).session;
      const submissions = deferredSession.messages.filter(message => message.toolName === "SubmitPlan");
      const deferredSubmission = submissions.at(-1);
      assert.notEqual(deferredSubmission?.toolStatus, "error", "pending expert mail became a model-visible tool error");
      const deferred = deferredSubmission?.toolResult?.details;
      assert.equal(deferred.status, "deferred");
      assert.equal(deferred.reason, "team_messages_pending");
      assert.equal(deferred.pendingMessagesCount, 1);
      assert.deepEqual((await invoke("plansPending", { sessionId: planLead.id })).plans, [], "unconsumed report created a premature proposal");
      await waitFor(async () => !(await invoke("agentQueueList", { sessionId: planLead.id })).entries.some(entry => entry.sessionMessageId === supplementaryMessageId), "supplementary report admitted exactly by mailbox ID");
      await prompt(queuedUserPrompt);
      await waitFor(async () => {
        const entries = (await invoke("agentQueueList", { sessionId: planLead.id })).entries;
        return entries.some(entry => entry.content === queuedUserPrompt && !entry.sessionMessageId);
      }, "ordinary user follow-up queued during supplementary synthesis");
      releaseSupplementary();
      await waitFor(() => completeResultsObserved, "full bounded results visible through team_status");
      await waitFor(() => evaluate(`document.querySelector('[data-testid="plan-approval-bar"]')?.getAttribute('data-status') === 'pending'`), "complete research plan proposal");
      await idle();
      const completeProposal = (await invoke("plansPending", { sessionId: planLead.id })).plans[0];
      assert.match(completeProposal.markdown, /TP_VERIFIED_ONE/);
      assert.match(completeProposal.markdown, /TP_VERIFIED_TWO/);
      assert.ok(completeProposal.markdown.includes(supplementaryReport), "final proposal omitted the full supplementary risk report");
      const completedQueue = (await invoke("agentQueueList", { sessionId: planLead.id })).entries;
      assert.deepEqual(completedQueue.map(entry => ({ content: entry.content, sessionMessageId: entry.sessionMessageId ?? null })), [{ content: queuedUserPrompt, sessionMessageId: null }], "final proposal left research mail or silently removed the user's queued follow-up");
      const leadMessages = (await invoke("sessionGet", { id: planLead.id })).session.messages;
      const admittedReports = leadMessages.filter(message => message.role === "user" && message.sessionMessage?.messageId === supplementaryMessageId);
      assert.equal(admittedReports.length, 1, "authenticated supplementary mailbox report was duplicated or not delivered");
      assert.ok(admittedReports[0].content.includes(supplementaryReport), "admitted report lost its full content");
      assert.equal(await readFile(join(projectPath, completeProposal.artifact.relativePath), "utf8"), completeProposal.markdown, "Host plan artifact differs from research synthesis");
      await saveScreenshot(sendCdp, "team-planning-complete-proposal.png");
      console.log("PASS Team Plan mailbox finalization: full structured results defer normally while authenticated extra report waits, FIFO consumes full multilingual report exactly once, final proposal preserves the user's queued follow-up");
      // Remove only the fixture user's own follow-up via the user-visible
      // queue action, after proving that automatic finalization preserved it.
      await evaluate(`document.querySelector('.composer-queued-prompt-remove').click()`);
      await waitFor(async () => (await invoke("agentQueueList", { sessionId: planLead.id })).entries.length === 0, "fixture user explicitly removes their preserved follow-up");

      actionExpertSessionId = (await invoke("teamGetRoster", { teamSessionId: planLead.id })).members.find(item => item.name === "research_one")?.memberSessionId;
      assert.ok(actionExpertSessionId);
      actionResultEntered = false;
      await prompt("TP_REVISE: revise the pending proposal using automatic expert research.");
      await waitActionExpert(false);
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.some((item) => item.title === "Revised Team Research"), "revised expert-backed proposal");
      const revisedHistory = await invoke("plansPending", { sessionId: planLead.id });
      assert.ok(revisedHistory.history.some((item) => item.id === completeProposal.id && item.status === "changes_requested"), "Composer revision did not resolve the old proposal");
      const revisedProposal = revisedHistory.plans.find(item => item.title === "Revised Team Research");
      const revisionReview = await assertAutomaticReview(1);
      const researchRequestCount = calls.filter(call => call.kind !== "title").length;
      await context.stopApp();
      ({ invoke, evaluate, sendCdp } = await context.startApp());
      await selectLead();
      const restoredReview = await assertAutomaticReview(1);
      assert.equal(restoredReview.reviewId, revisionReview.reviewId, "restart replaced the automatic authority audit");
      const restoredProposals = await invoke("plansPending", { sessionId: planLead.id });
      assert.deepEqual(restoredProposals.plans, [], "startup fence left an executable pending proposal");
      const restoredProposal = restoredProposals.history.find(item => item.id === revisedProposal.id);
      assert.equal(restoredProposal?.status, "interrupted", "startup fence did not interrupt the pending proposal");
      assert.equal(restoredProposal.markdown, revisedProposal.markdown, "restart lost the researched proposal history");
      assert.equal(calls.filter(call => call.kind !== "title").length, researchRequestCount, "restart repeated settled research provider calls");
      assert.equal((await invoke("teamGetBoard", { teamSessionId: planLead.id })).tasks.filter(task => task.status === "completed").length, 3);
      console.log("PASS Team Plan restart: automatic authority, complete owned research and interrupted proposal history persist without confirmation or redispatch");

      actionResultEntered = false;
      await prompt("TP_RETRY: investigate a fresh expert-backed proposal after interrupted startup history.");
      await waitActionExpert(false);
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.some(item => item.title === "Retry Team Research"), "automatic retry after interrupted proposal");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-reject')`), "retried pending card");
      await evaluate(`document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-reject').click()`);
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.length === 0, "rejected proposal settled");
      await idle();
      actionResultEntered = false;
      await prompt("TP_RETRY: investigate a fresh expert-backed proposal after rejection.");
      await waitActionExpert(false);
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.some((item) => item.title === "Retry Team Research"), "retry expert-backed proposal");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-approve-main')`), "retry pending card");
      await waitFor(() => evaluate(`!!document.querySelector('[data-work-panel-tab-id="overview"] .work-panel-tab-button')`), "Overview tab before Plan approval");
      await evaluate(`document.querySelector('[data-work-panel-tab-id="overview"] .work-panel-tab-button').click()`);
      await waitFor(() => evaluate(`document.querySelector('[data-work-panel-tab-id].active')?.getAttribute('data-work-panel-tab-id') === 'overview'`), "Overview active before execution approval");
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), false, "Plan research left launch review visible in Overview");
      executionCallBase = calls.length;
      actionResultEntered = false;
      await evaluate(`document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-approve-main').click()`);
      await waitActionExpert(true);
      assert.equal((await invoke("sessionGet", { id: planLead.id })).session.permissionMode, "ask", "approved execution did not retain the default Ask ceiling");
      await waitFor(() => evaluate(`!!document.querySelector('.permission-card')`), "approved execution Write permission request");
      await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" }, "Ask Write executed before ordinary permission approval");
      {
        const permission = await evaluate(`(() => { const card=document.querySelector('.permission-card'); return {
          text: card.innerText, workspace: card.querySelector('.permission-card-meta span')?.title,
          reason: card.querySelector('.permission-card-reason')?.innerText ?? '',
        }; })()`);
        assert.match(permission.text, /Write/);
        const requests = await invoke("pendingInteractive", { sessionId: planLead.id });
        const writeRequest = requests.permissions.find((request) => request.toolName === "Write");
        assert.equal(writeRequest?.argsPreview?.path, markerPath, "permission did not bind the canonical fixture marker");
        assert.equal(permission.workspace, canonicalProjectPath);
        assert.doesNotMatch(permission.reason, /outside.*workspace/i, "fixture marker escaped the session workspace");
        await evaluate(`Array.from(document.querySelectorAll('.permission-card button')).find(button => /allow once/i.test(button.innerText) && !button.disabled).click()`);
      }
      await waitFor(async () => {
        try { return (await readFile(markerPath, "utf8")) === "APPROVED_TEAM_EXECUTION\n"; } catch { return false; }
      }, "approved Agent Write marker");
      await idle();
      assert.equal((await invoke("sessionGet", { id: planLead.id })).session.mode, "agent");
      console.log("PASS Team Plan revise/retry automatically, proposal approval then Agent launch confirmation and fresh Ask expert before isolated execution");

      // The recommended path needs no expert-to-Lead completion message:
      // structured results and real update waits must suffice by themselves.
      const structuredLead = (await invoke("sessionCreate", {
        title: "Structured-only research", mode: "plan", executionProfile: "team", projectPath,
        providerId: planLead.providerId, modelId: planLead.modelId, permissionMode: "auto",
      })).session;
      assert.equal(structuredLead.executionProfile, "team");
      // Raw preload creation persists the session but does not perform the
      // renderer's session-list store update. Reload only after all old work
      // has settled, then enter the persisted session through the real sidebar.
      await sendCdp("Page.reload");
      await waitFor(() => evaluate(`!!document.querySelector('[data-sidebar-session-row="${structuredLead.id}"]')`), "structured-only Plan session visible");
      await evaluate(`document.querySelector('[data-sidebar-session-row="${structuredLead.id}"] button.thread-item-main').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('.composer-contract-chip[data-mode="plan"]')`), "structured-only Team Plan Composer");
      await prompt("TP_STRUCTURED_ONLY_LEAD: automatically research both sources and submit a plan using only complete structured results; await actual updates without duplicate completion mail.");
      await waitFor(() => structuredGates.every(gate => gate.entered) && calls.some(call => call.userText.includes("TP_STRUCTURED_ONLY_LEAD") && call.tool === "wait_for_updates"), "Lead really waits while two structured-only researchers are held");
      structuredGates.forEach(gate => gate.release());
      const structuredProposal = await waitFor(async () => (await invoke("plansPending", { sessionId: structuredLead.id })).plans.find(item => item.title === "Structured Only Team Research"), "structured-only research proceeds without a mailbox wakeup");
      await waitFor(async () => (await invoke("agentGetStatus", structuredLead.id)).status?.isRunning === false, "structured-only Lead settles after proposal");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"]')`), "structured-only proposal approval visible");
      assert.match(structuredProposal.markdown, /TP_STRUCTURED_VERIFIED_ONE/);
      assert.match(structuredProposal.markdown, /TP_STRUCTURED_VERIFIED_TWO/);
      const structuredBoard = await invoke("teamGetBoard", { teamSessionId: structuredLead.id });
      assert.equal(structuredBoard.tasks.length, 2);
      assert.ok(structuredBoard.tasks.every(task => task.status === "completed"));
      assert.deepEqual((await invoke("agentQueueList", { sessionId: structuredLead.id })).entries, [], "structured-only proposal left queued expert messages");
      const structuredSession = (await invoke("sessionGet", { id: structuredLead.id })).session;
      assert.equal(structuredSession.messages.some(message => message.toolStatus === "error" || message.error), false, "normal structured-only planning showed an error");
      assert.equal(structuredSession.messages.filter(message => message.sessionMessage).length, 0, "structured-only planning depended on unsolicited completion mail");
      assert.equal(calls.some(call => /TP_STRUCTURED_WORK_(ONE|TWO)/.test(call.userText) && call.tool === "send_message"), false, "structured-only expert sent a duplicate completion report");
      const structuredReview = (await invoke("teamGetLaunchReview", { teamSessionId: structuredLead.id })).review;
      assert.equal(structuredReview.launchPolicy, "automatic_plan");
      assert.equal(structuredReview.status, "confirmed");
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), false, "structured-only Plan research asked for launch approval");
      await saveScreenshot(sendCdp, "team-planning-structured-only-proposal.png");
      console.log("PASS Team Plan default structured-only path: two automatic readonly experts submit full results without send_message; real wait_for_updates/team_status reaches a clean pending proposal with no research queue or errors");
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.PI_E2E_TEAM_PLANNING = "1";
  // Finish evaluating this module before the shared harness imports its exports.
  setImmediate(() => import("./e2e-team.mjs").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }));
}
