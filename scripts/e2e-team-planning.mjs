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
  let completeResultsObserved = false;
  const canonicalProjectPath = realpathSync(projectPath);
  const markerPath = join(canonicalProjectPath, "approved-team-plan-marker.txt");
  const statusFrom = (messages) => {
    for (const message of [...messages].reverse()) {
      if (message.role !== "tool") continue;
      try {
        const value = JSON.parse(message.content);
        if (value.planning && value.tasks) return value;
      } catch { /* Other tool results are plain text. */ }
    }
    return null;
  };
  const plan = (title) => ({ name: "SubmitPlan", args: {
    title, question: "Approve this isolated expert research plan?",
    markdown: `# ${title}\n\n1. Preserve both verified research results.\n2. Write the approved execution marker.\n${title === "Complete Team Research" ? "\nTP_VERIFIED_ONE: Verified finding ONE (source-ONE.md).\nTP_VERIFIED_TWO: Verified finding TWO (source-TWO.md).\n" : ""}`,
  }});
  const leadOnly = () => ({ name: "declare_team_strategy", args: {
    strategy: "lead_only", reason: "The Lead can handle this bounded revision or execution.",
  }});

  return {
    releaseResearch() { releaseSecond?.(); },
    async respond({ userText, priorToolNames, activeTurnMessages, activeToolText, toolNames }) {
      const has = (name) => priorToolNames.includes(name);
      const answer = (finalText) => ({ finalText });
      const tool = (name, args = {}) => ({ toolCall: { name, args } });
      if (/TP_CANCEL|TP_DELEGATE/.test(userText)) {
        assert.ok(toolNames.includes("declare_team_strategy"), "Team Plan Lead lacks delegation");
        assert.equal(toolNames.includes("submit_research_result"), false, "Lead became a researcher");
        if (!has("declare_team_strategy")) return tool("declare_team_strategy", {
          strategy: "delegate", reason: "Two independent read-only investigations are needed.",
          members: ["one", "two"].map((id) => ({
            name: `research_${id}`, description: `Read-only research ${id}`, contextKind: "fresh",
            presentation: { role: "researcher", displayName: id === "one" ? "Alex" : "Tina" },
          })),
        });
        return answer("Research waits for your trusted launch review.");
      }
      if (userText.includes("Team review") && userText.includes("confirmed")) {
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
        return answer("Both owned research tasks were dispatched.");
      }
      if (/TP_RESEARCH_(ONE|TWO)/.test(userText)) {
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
        return answer(`TP_RESULT_${id} complete.`);
      }
      if (userText.includes("TP_RESULT_")) return answer("Lead received a verified research result.");
      if (/TP_EARLY_SUBMIT|TP_FINALIZE/.test(userText)) {
        if (!has("team_status")) return tool("team_status");
        const status = statusFrom(activeTurnMessages);
        assert.equal(status?.planning?.totalExpectedTasks, 2);
        assert.equal(status.planning.openQuestionsCount, 0);
        if (userText.includes("TP_EARLY_SUBMIT")) {
          assert.equal(status.planning.completedResearchTasks, 1);
          assert.equal(status.planning.isReadyForPlanSubmission, false);
          if (!has("SubmitPlan")) return { toolCall: plan("Incomplete Team Research") };
          assert.match(activeToolText, /TEAM_PLANNING_NOT_READY/);
          return answer("Incomplete research cannot submit a plan.");
        }
        assert.equal(status.planning.completedResearchTasks, 2);
        assert.equal(status.planning.isReadyForPlanSubmission, true);
        assert.deepEqual(status.planning.results.map((result) => result.structuredResult.summary).sort(), ["TP_VERIFIED_ONE", "TP_VERIFIED_TWO"]);
        assert.ok(status.planning.results.every((result) => result.structuredResult.verifiedSources.length === 1));
        completeResultsObserved = true;
        return { toolCall: plan("Complete Team Research") };
      }
      if (/TP_REVISE|TP_RETRY/.test(userText)) {
        if (!has("declare_team_strategy")) return { toolCall: leadOnly() };
        return { toolCall: plan(userText.includes("TP_REVISE") ? "Revised Team Research" : "Retry Team Research") };
      }
      if (userText.includes("Approved plan title:")) {
        assert.ok(toolNames.includes("Write"), "approved Lead did not regain normal Agent permissions");
        assert.equal(toolNames.includes("submit_research_result"), false, "approved Lead retained researcher tools");
        if (!has("declare_team_strategy")) return { toolCall: leadOnly() };
        if (!has("Write")) return tool("Write", { path: markerPath, content: "APPROVED_TEAM_EXECUTION\n" });
        return answer("Approved execution wrote its isolated marker.");
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
      const researchCalls = () => calls.filter((call) => call.kind !== "title" && /TP_RESEARCH_(ONE|TWO)/.test(call.userText));
      await Promise.all(["ONE", "TWO"].map((id) => writeFile(join(projectPath, `source-${id}.md`), `TP_SOURCE_${id}\nVerified finding ${id}\n`)));
      await selectLead();
      await prompt("TP_CANCEL: propose two experts before research.");
      await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review?.status === "pending", "first pending review");
      await idle();
      await openTeamPanel(sendCdp, evaluate);
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review"]')`), "review UI");
      assert.equal(researchCalls().length, 0, "research ran before launch approval");
      await evaluate(`Array.from(document.querySelectorAll('[data-testid="team-launch-review"] button')).find(button => /cancel/i.test(button.innerText)).click()`);
      await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review?.status === "cancelled", "review cancellation");
      assert.equal((await invoke("teamGetRoster", { teamSessionId: planLead.id })).members.length, 0);
      assert.equal(researchCalls().length, 0, "cancelled review launched research");
      console.log("PASS Team Plan review cancellation: zero expert provider requests or materialized members");

      await prompt("TP_DELEGATE: investigate with two experts.");
      await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review?.status === "pending", "second pending review");
      await idle();
      await context.stopApp();
      ({ invoke, evaluate, sendCdp } = await context.startApp());
      await selectLead();
      await openTeamPanel(sendCdp, evaluate);
      await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review?.status === "interrupted", "restart interrupts unapproved review");
      assert.equal(researchCalls().length, 0, "restart bypassed review");
      assert.equal((await invoke("teamGetRoster", { teamSessionId: planLead.id })).members.length, 0);
      await prompt("TP_DELEGATE: investigate with two experts after interrupted review.");
      await waitFor(async () => (await invoke("teamGetLaunchReview", { teamSessionId: planLead.id })).review?.status === "pending", "fresh review after restart");
      await idle();
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="team-launch-review-confirm-btn"]:not(:disabled)')`), "fresh review Confirm enabled");
      await evaluate(`document.querySelector('[data-testid="team-launch-review-confirm-btn"]').click()`);
      await waitFor(async () => {
        const board = await invoke("teamGetBoard", { teamSessionId: planLead.id });
        return secondEntered && board.tasks.length === 2 && board.tasks.filter((task) => task.status === "completed").length === 1;
      }, "first result with second researcher held");
      await waitFor(() => calls.some((call) => call.kind !== "title" && call.userText.includes("TP_RESULT_ONE") && call.tool === null), "first result delivered to Lead");
      await idle();
      await prompt("TP_EARLY_SUBMIT: test incomplete research finalization.");
      await waitFor(async () => {
        const session = (await invoke("sessionGet", { id: planLead.id })).session;
        return session.messages.some((message) => message.toolName === "SubmitPlan" &&
          message.toolStatus === "error" && message.toolResult?.details?.errorCode === "TEAM_PLANNING_NOT_READY");
      }, "Host rejected first-result SubmitPlan");
      await idle();
      assert.deepEqual((await invoke("plansPending", { sessionId: planLead.id })).plans, [], "incomplete result created a proposal");
      console.log("PASS Team Plan research: two owned tasks, read-only researcher tools, first result cannot SubmitPlan");
      releaseSecond();
      await waitFor(async () => (await invoke("teamGetBoard", { teamSessionId: planLead.id })).tasks.every((task) => task.status === "completed"), "both structured results committed");
      await waitFor(() => calls.some((call) => call.kind !== "title" && call.userText.includes("TP_RESULT_TWO") && call.tool === null), "second result delivered to Lead");
      await waitFor(async () => {
        const members = (await invoke("teamGetRoster", { teamSessionId: planLead.id })).members;
        const statuses = await Promise.all(members.map((member) => invoke("agentGetStatus", member.memberSessionId)));
        return statuses.length === 2 && statuses.every((result) => result.status?.isRunning === false);
      }, "all researcher turns settled before submission");
      await idle();
      await prompt("TP_FINALIZE: synthesize both verified results.");
      await waitFor(() => completeResultsObserved, "full bounded results visible through team_status");
      await waitFor(() => evaluate(`document.querySelector('[data-testid="plan-approval-bar"]')?.getAttribute('data-status') === 'pending'`), "complete research plan proposal");
      const completeProposal = (await invoke("plansPending", { sessionId: planLead.id })).plans[0];
      assert.match(completeProposal.markdown, /TP_VERIFIED_ONE/);
      assert.match(completeProposal.markdown, /TP_VERIFIED_TWO/);
      assert.equal(await readFile(join(projectPath, completeProposal.artifact.relativePath), "utf8"), completeProposal.markdown, "Host plan artifact differs from research synthesis");
      await saveScreenshot(sendCdp, "team-planning-complete-proposal.png");
      console.log("PASS Team Plan results: full findings and verified sources visible, all expected tasks complete before proposal");

      await prompt("TP_REVISE: revise the pending proposal with a fresh Lead-only synthesis.");
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.some((item) => item.title === "Revised Team Research"), "revised lead_only proposal");
      const revisedHistory = await invoke("plansPending", { sessionId: planLead.id });
      assert.ok(revisedHistory.history.some((item) => item.id === completeProposal.id && item.status === "changes_requested"), "Composer revision did not resolve the old proposal");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-reject')`), "revised pending card");
      await evaluate(`document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-reject').click()`);
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.length === 0, "rejected proposal settled");
      await idle();
      await prompt("TP_RETRY: create a fresh Lead-only proposal after rejection.");
      await waitFor(async () => (await invoke("plansPending", { sessionId: planLead.id })).plans.some((item) => item.title === "Retry Team Research"), "retry lead_only proposal");
      await waitFor(() => evaluate(`!!document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-approve-main')`), "retry pending card");
      await evaluate(`document.querySelector('[data-testid="plan-approval-bar"][data-status="pending"] .plan-approval-approve-main').click()`);
      await waitFor(async () => {
        if (await evaluate(`!!document.querySelector('.permission-card')`)) return true;
        try { return (await readFile(markerPath, "utf8")) === "APPROVED_TEAM_EXECUTION\n"; } catch { return false; }
      }, "ordinary execution permission or marker");
      if (await evaluate(`!!document.querySelector('.permission-card')`)) {
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
      console.log("PASS Team Plan reject/revise/retry/lead_only and trusted approval: normal Agent writes isolated marker");
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
