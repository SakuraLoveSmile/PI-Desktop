#!/usr/bin/env node
/**
 * Headless Goal Completion Report acceptance harness.
 *
 * Exercises the host RPC protocol for Goal completion reports:
 * - Structured draft submission and ready report lifecycle
 * - Completed-only publication, interruption refusal, and blocked unverified executions
 * - Session isolation, scope validation, and cascade deletion
 * - Persistence and host restart recovery
 * - Bounds enforcement (size limits, metrics, criteria)
 * - Exclusion of non-Goal executions (Plans)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { assert, shortJson, expectRpcError } from "./e2e/assert.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { createSession, beginTurn, endTurn } from "./e2e/session.mjs";
import { resolvePlan } from "./e2e/plan.mjs";

import { TeamLeadExecutionGuard } from "../packages/agent-runtime/dist/team/lead-execution-guard.js";
import { GoalReportDraftManager } from "../packages/agent-runtime/dist/goal-report-tool.js";
import { withTeamLeadApproval } from "../packages/agent-runtime/dist/team/lead-tool-approval.js";
import { createWaitForUpdatesTool } from "../packages/agent-runtime/dist/team/wait-for-updates.js";

const results = [];

function record(id, ok, detail = "") {
  results.push({ id, ok, skipped: false, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` - ${detail}` : ""}`);
}

async function approvedGoalExecution(ctx, title, shouldClaim = true, teamProvider) {
  const session = teamProvider ? (await ctx.host.call("session.create", {
    title, mode: "agent", executionProfile: "team", projectPath: ctx.workspace,
    providerId: teamProvider, modelId: "fixture", permissionMode: "auto",
  })).session : await createSession(ctx.host, ctx.workspace, title, "agent");
  const turnId = await beginTurn(ctx.host, session.id);
  await ctx.host.call("plans.enter", {
    sessionId: session.id,
    turnId,
    toolCallId: `${title}-enter`,
    requestedMode: "goal",
    kind: "goal",
  });
  const submitRes = await ctx.host.call("plans.submit", {
    sessionId: session.id,
    turnId,
    toolCallId: `${title}-submit`,
    title,
    markdown: `# ${title}\n\n- Step 1: Implement feature\n- Step 2: Verify tests\n`,
    question: `Approve ${title}?`,
    kind: "goal",
  });
  const proposal = submitRes.proposal;
  assert(proposal?.id, `proposal missing: ${shortJson(submitRes)}`);
  const resolved = await resolvePlan(ctx.host, proposal, "approve", "ask");
  assert(resolved.execution?.state === "queued", shortJson(resolved));
  const executionId = resolved.execution.id;
  let execution = resolved.execution;
  if (shouldClaim) {
    const claimed = await ctx.host.call("plans.claimExecution", { executionId });
    assert(claimed.execution?.state === "running", shortJson(claimed));
    execution = claimed.execution;
  }
  return { session, turnId, proposal, execution, executionId };
}

async function scenarioSettledTeam(binary, tempRoot) {
  return withScenario("E2E-GOAL-report-waits-for-settled-team", async ctx => {
    const { host } = ctx;
    const { provider } = await host.call("providers.create", {
      name: "Settled Team fixture", vendorKey: "custom", authKind: "none", apiStyle: "chat_completions",
      baseUrl: "http://127.0.0.1:9/v1", defaultModelId: "fixture", models: [{ id: "fixture", thinkingLevels: ["off"] }],
    });
    const { session, turnId, executionId } = await approvedGoalExecution(ctx, "Settled Team Goal", true, provider.id);
    await host.call("goalReports.bindExecutionTurn", { executionId, turnId });
    const team = { teamSessionId: session.id, callerSessionId: session.id };
    const declaration = await host.call("team.declareStrategy", {
      ...team, leadTurnId: turnId, strategy: "delegate", reason: "Verify settled Goal report boundary",
      members: [{ name: "report_expert", contextKind: "fresh" }],
    });
    const approval = await host.call("team.confirmLaunchReview", {
      teamSessionId: session.id, reviewId: declaration.review.reviewId, expectedRevision: declaration.review.revision,
    });
    const memberId = approval.decision.memberSessionIds[0];
    const wait = createWaitForUpdatesTool({ ...team, host, getTurnId: () => turnId, approvedExecution: () => true });
    await wait.execute("confirmation", { timeoutSeconds: 1 });
    const { task } = await host.call("team.createTask", { ...team, taskId: "verify-report", subject: "Verify report", ownerMemberName: "report_expert" });
    const { message } = await host.call("team.sendMessage", { ...team, target: "report_expert", content: "Verify report evidence" });
    try {
      await host.call("team.authorizeLeadTool", { ...team, toolName: "SubmitGoalReport" });
      throw new Error("Queued-only report authorization accepted");
    } catch (error) {
      assert(error.errorCode === "TEAM_APPROVAL_REQUIRED" && error.message.includes(message.id) && error.message.includes("report_expert") && error.message.includes("verify-report"), error.message);
    }
    const { turnId: memberTurn } = await host.call("session.beginTurn", { sessionId: memberId, sessionMessageId: message.id });
    const manager = new GoalReportDraftManager({ executionId, sessionId: session.id,
      onDraftSubmitted: draft => host.call("goalReports.submitDraft", { executionId, draft }),
    });
    const reportTool = withTeamLeadApproval(manager.buildTool(), { host, ...team, getTurnId: () => turnId, currentModeDenial: () => undefined });
    const draft = { verdict: "partial", summary: "Verified expert evidence" };
    let hostReason;
    try { await reportTool.execute("early-report", draft); throw new Error("Unsettled report accepted"); }
    catch (error) {
      assert(error.errorCode === "TEAM_APPROVAL_REQUIRED", error.message);
      hostReason = error.message;
      assert(hostReason.includes("report_expert") && hostReason.includes(message.id) && hostReason.includes("verify-report"), hostReason);
    }
    assert(!manager.isDraftValid(), "Rejected report recorded a local draft");
    const guard = new TeamLeadExecutionGuard();
    const state = () => ({ turnId, epoch: 1, mode: "agent", inactive: false });
    let prompt = "approved goal";
    for (let index = 0; index < 3; index++) {
      const outcome = await guard.authorizeCompletion(host, team, state, true, "", true);
      assert(outcome.kind === "recover", shortJson(outcome));
      await guard.recover({ host, team, state, abort: () => { throw new Error("Unexpected recovery abort"); },
        prepare: () => {}, getPrompt: () => prompt, setPrompt: value => { prompt = value; }, start: () => {},
        continue: async () => { assert(prompt.includes(hostReason), "Recovery dropped the Host reason"); }, restore: () => {},
      });
    }
    const terminal = await guard.authorizeCompletion(host, team, state, true, "", true);
    assert(terminal.kind === "blocked", shortJson(terminal));
    record("E2E-TEAM-completion-blocked-keeps-host-reason", true, "three bounded runtime nudges; Goal ends blocked after native Host rejection");
    const result = await host.call("team.sendMessage", { teamSessionId: session.id, callerSessionId: memberId, target: "Lead", content: "Verified full report evidence" });
    await host.call("team.updateTask", { teamSessionId: session.id, callerSessionId: memberId,
      taskId: task.taskId, expectedRevision: task.revision, status: "completed" });
    await endTurn(host, memberTurn);
    await expectRpcError(() => reportTool.execute("unconsumed-report", draft), ["TEAM_APPROVAL_REQUIRED"]);
    const update = await wait.execute("consume-result", { timeoutSeconds: 1 });
    assert(JSON.stringify(update).includes(result.message.id), "wait_for_updates did not consume the full result");
    assert((await host.call("team.getLeadExecutionState", { ...team, expectedTurnId: turnId })).active, "Member wake replaced original execution");
    const accepted = await reportTool.execute("settled-report", draft);
    assert(accepted.details.ok && manager.isDraftValid(), shortJson(accepted));
    assert((await guard.authorizeCompletion(host, team, state, true, "", true)).kind === "authorized", "Settled completion denied");
  }, binary, tempRoot);
}

async function scenarioStructuredReport(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-001", async (ctx) => {
    const title = "Structured Goal Run";
    const { session, turnId, proposal, executionId } = await approvedGoalExecution(ctx, title, true);

    // Bind execution turn
    const bindRes = await ctx.host.call("goalReports.bindExecutionTurn", {
      executionId,
      turnId,
    });
    assert(bindRes.ok === true, shortJson(bindRes));

    // Exercise real progress writes through the Host boundary, before settlement.
    const { writeToken } = await ctx.host.call("goalProgress.issueToken", {
      sessionId: session.id, executionId, turnId,
    });
    const items = [
      { id: "build", label: "Build", status: "completed" },
      { id: "check", label: "Check", status: "failed" },
    ];
    const progressResult = await ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken, expectedRevision: 0, items,
    });
    assert(progressResult.progress?.revision === 1, shortJson(progressResult));
    assert(progressResult.progress?.items[1]?.status === "failed", shortJson(progressResult));
    await expectRpcError(() => ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken, expectedRevision: 0, items,
    }), ["CONFLICT"]);
    await expectRpcError(() => ctx.host.call("goalProgress.get", {
      sessionId: "different-session", executionId,
    }), ["UNAUTHORIZED"]);

    // Submit structured draft matching SubmitGoalReport schema
    const draft = {
      verdict: "met",
      summary: "All goal acceptance criteria implemented and verified cleanly.",
      metrics: [
        { label: "Passed Tests", value: "655/655" },
        { label: "Build Status", value: "clean" },
      ],
      criteria: [
        { id: "crit-1", text: "Schema v20 migration", verdict: "met", explanation: "Migration checks passed." },
        { id: "crit-2", text: "Report viewer", verdict: "met", explanation: "The report viewer is wired." },
      ],
      steps: [
        { id: "step-1", title: "Define contracts and types", status: "completed" },
        { id: "step-2", title: "Implement host persistence", status: "completed" },
      ],
      files: [
        { path: "crates/host-core/src/goal_reports/mod.rs", changeType: "created", attribution: "direct" },
        { path: "packages/shared/src/goal-report.ts", changeType: "created", attribution: "direct" },
      ],
      checks: [
        { id: "chk-1", command: "cargo test -p host-core --locked", result: "passed" },
      ],
      limitations: ["None noted in this release."],
      nextSteps: ["Deploy to production fleet."],
      evidences: [
        { id: "ev-1", kind: "tool_result", refId: "chk-1", summary: "655 passed cleanly" },
      ],
    };

    // A completion claim must not contradict the persisted Goal checklist.
    await expectRpcError(() => ctx.host.call("goalReports.submitDraft", {
      executionId, draft,
    }), ["INVALID_ARGUMENT"]);
    const reconciled = await ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken, expectedRevision: 1,
      items: items.map(item => ({ ...item, status: "completed" })),
    });
    assert(reconciled.progress?.revision === 2, shortJson(reconciled));

    ctx.host.clearNotifications();
    const submitDraftRes = await ctx.host.call("goalReports.submitDraft", {
      executionId,
      draft,
    });
    assert(submitDraftRes.ok === true, shortJson(submitDraftRes));

    // Attempting to finalize while execution is running must be rejected
    await expectRpcError(
      () => ctx.host.call("goalReports.finalizeReport", { executionId, status: "completed" }),
      ["GOAL_EXECUTION_NOT_TERMINAL"]
    );

    // Settle execution to terminal state
    await ctx.host.call("plans.finishExecution", { executionId, status: "completed" });

    await expectRpcError(() => ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken, items,
    }), ["GOAL_PROGRESS_NOT_RUNNING"]);
    const settledProgress = await ctx.host.call("goalProgress.get", {
      sessionId: session.id, executionId,
    });
    assert(settledProgress.progress?.revision === 2, "settlement must retain readable progress");

    // Finalize report
    const finalizeRes = await ctx.host.call("goalReports.finalizeReport", {
      executionId,
      status: "completed",
    });
    assert(finalizeRes.report?.status === "ready", shortJson(finalizeRes));
    assert(finalizeRes.report?.integrity === "structured", shortJson(finalizeRes));
    assert(finalizeRes.report?.verdict === "met", shortJson(finalizeRes));

    const notifications = ctx.host.matchingNotifications("goalReports.changed");
    assert(notifications.length >= 1, "goalReports.changed notification not emitted");
    const changed = notifications[notifications.length - 1].params;
    assert(changed.executionId === executionId, shortJson(changed));
    assert(changed.status === "ready", shortJson(changed));
    assert(changed.integrity === "structured", shortJson(changed));

    // Get report
    const getRes = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    const report = getRes.report;
    assert(report, "report not returned");
    assert(report.schemaVersion === 2, shortJson(report));
    assert(report.execution?.status === "completed", shortJson(report));
    assert(report.integrity?.kind === "structured", shortJson(report));
    assert(report.verdict === "met", shortJson(report));
    assert(report.summary === draft.summary, shortJson(report));
    assert(report.metrics?.length === 2, shortJson(report));
    assert(report.criteria?.length === 2, shortJson(report));
    assert(report.steps?.length === 2, shortJson(report));
    assert(report.files?.length === 2, shortJson(report));
    assert(report.checks?.length === 1, shortJson(report));
    assert(report.evidences?.length === 1, shortJson(report));
    assert(report.limitations?.length === 1, shortJson(report));
    assert(report.nextSteps?.length === 1, shortJson(report));

    await expectRpcError(
      () => ctx.host.call("goalReports.finalizeReport", { executionId, status: "interrupted" }),
      ["GOAL_EXECUTION_NOT_TERMINAL"],
    );
    const afterWrongOverride = await ctx.host.call("goalReports.get", {
      sessionId: session.id, executionId,
    });
    assert(JSON.stringify(afterWrongOverride.report) === JSON.stringify(report), "interrupted override rewrote a completed report");

    // List reports
    const listRes = await ctx.host.call("goalReports.list", {
      sessionId: session.id,
    });
    assert(listRes.reports?.length === 1, shortJson(listRes));
    assert(listRes.reports[0].executionId === executionId, shortJson(listRes));
    assert(listRes.reports[0].status === "ready", shortJson(listRes));

    // Check report file on disk
    const reportFilePath = join(ctx.dataDir, "goal_reports", session.id, `${executionId}.json`);
    assert(existsSync(reportFilePath), `report file missing on disk: ${reportFilePath}`);
    const fileBytes = await readFile(reportFilePath, "utf8");
    const parsedFile = JSON.parse(fileBytes);
    assert(parsedFile.executionId === executionId, "file JSON executionId mismatch");
    assert(parsedFile.schemaVersion === 2, "file JSON schemaVersion mismatch");

    await expectRpcError(
      () => ctx.host.call("goalReports.submitDraft", {
        executionId,
        draft: { ...draft, summary: "Late replacement" },
      }),
      ["INVALID_ARGUMENT"],
    );
    const afterLateDraft = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    assert(afterLateDraft.report?.summary === draft.summary, shortJson(afterLateDraft));
    assert(await readFile(reportFilePath, "utf8") === fileBytes, "late draft changed the report file");

    await endTurn(ctx.host, turnId);
    await ctx.host.call("session.delete", { id: session.id });
    const deletedProgress = await ctx.host.call("goalProgress.get", {
      sessionId: session.id, executionId,
    });
    assert(deletedProgress.progress === null, "session deletion must remove its progress");
    return `reportId=${report.reportId} integrity=structured verdict=met fileExists=true progressLifecycle=true`;
  }, binary, tempRoot);
}

async function scenarioBlockedReport(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-002", async (ctx) => {
    const title = "Blocked Invalidation Run";
    const { session, turnId, executionId } = await approvedGoalExecution(ctx, title, true);

    await ctx.host.call("goalReports.bindExecutionTurn", {
      executionId,
      turnId,
    });

    // Submit draft, then invalidate it (simulating steering or subsequent tool execution)
    await ctx.host.call("goalReports.submitDraft", {
      executionId,
      draft: {
        verdict: "met",
        summary: "Draft to be invalidated.",
        metrics: [],
        criteria: [],
        steps: [],
        files: [],
        checks: [],
      },
    });

    const invalidateRes = await ctx.host.call("goalReports.invalidateDraft", {
      executionId,
    });
    assert(invalidateRes.ok === true, shortJson(invalidateRes));

    const { writeToken } = await ctx.host.call("goalProgress.issueToken", {
      sessionId: session.id, executionId, turnId,
    });
    const progress = await ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken,
      items: [
        { id: "implemented", label: "Implemented", status: "completed" },
        { id: "verification", label: "Verification", status: "in_progress" },
        { id: "remaining", label: "Remaining", status: "pending" },
        { id: "blocked", label: "Blocked", status: "failed" },
      ],
    });
    assert(progress.progress?.revision === 1, shortJson(progress));

    ctx.host.clearNotifications();
    await endTurn(ctx.host, turnId);
    const settled = await ctx.host.call("goalExecutions.settle", {
      sessionId: session.id, executionId, ended: "agent_stopped",
    });
    assert(settled.execution?.state === "interrupted", shortJson(settled));
    const { history } = await ctx.host.call("plans.pending", { sessionId: session.id });
    assert(history.find(proposal => proposal.executionId === executionId)?.errorCode === "GOAL_BLOCKED", shortJson(history));
    assert(settled.hold?.state === "blocked" && settled.hold.reasons.some(reason => reason.code === "report_missing"), shortJson(settled));
    const read = await ctx.host.call("goalReports.get", { sessionId: session.id, executionId });
    assert(read.state !== "ready" && read.report?.schemaVersion == null, shortJson(read));
    assert(!existsSync(join(ctx.dataDir, "goal_reports", session.id, `${executionId}.json`)), "blocked Goal published a report file");
    assert(!ctx.host.matchingNotifications("goalReports.changed").some(note => note.params.status === "ready"), "blocked Goal broadcast ready");
    const notices = await ctx.host.call("notification.list");
    assert(!notices.notifications.some(note => note.sessionId === session.id && note.kind === "task.completed"), shortJson(notices));
    assert(notices.notifications.some(note => note.sessionId === session.id && note.kind === "task.failed" && note.errorCode === "GOAL_BLOCKED"), shortJson(notices));
    const snapshot = await ctx.host.call("goalProgress.get", { sessionId: session.id, executionId });
    assert(snapshot.progress?.items[1]?.status === "in_progress", "blocking fabricated completed progress");
    await expectRpcError(() => ctx.host.call("goalProgress.update", {
      sessionId: session.id, executionId, writeToken, items: [],
    }), ["GOAL_PROGRESS_NOT_RUNNING"]);
    return "hold=blocked report_missing noArtifact=true noCompletedNotification=true progressRetained=true";
  }, binary, tempRoot);
}

async function scenarioInterruptedExecution(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-007", async (ctx) => {
    const executions = [];
    for (const withDraft of [false, true]) {
      const { session, turnId, executionId } = await approvedGoalExecution(
        ctx, `Interrupted Goal ${withDraft ? "Draft" : "Pending"}`, true,
      );
      await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });
      if (withDraft) {
        await ctx.host.call("goalReports.submitDraft", {
          executionId,
          draft: { verdict: "met", summary: "Unfinished draft must never be published." },
        });
      }
      await ctx.host.call("plans.finishExecution", {
        executionId, status: "interrupted", errorCode: "USER_CANCELLED",
      });
      const before = await ctx.host.call("goalReports.list", { sessionId: session.id });
      const draftPath = join(ctx.dataDir, "goal_reports", session.id, `${executionId}.draft.json`);
      const draftBytes = withDraft ? await readFile(draftPath, "utf8") : null;
      ctx.host.clearNotifications();
      for (const status of [undefined, "interrupted", "completed"]) {
        await expectRpcError(
          () => ctx.host.call("goalReports.finalizeReport", { executionId, status }),
          ["GOAL_EXECUTION_NOT_TERMINAL"],
        );
      }
      await expectRpcError(
        () => ctx.host.call("goalReports.retry", { sessionId: session.id, executionId }),
        ["GOAL_EXECUTION_NOT_TERMINAL"],
      );
      const read = await ctx.host.call("goalReports.get", { sessionId: session.id, executionId });
      const after = await ctx.host.call("goalReports.list", { sessionId: session.id });
      assert(read.state === (withDraft ? "draft" : "pending"), shortJson(read));
      assert(read.report?.schemaVersion == null, "interruption exposed a finalized report body");
      assert(JSON.stringify(after) === JSON.stringify(before), "refused calls changed report metadata");
      assert(!existsSync(join(ctx.dataDir, "goal_reports", session.id, `${executionId}.json`)), "interruption published an artifact");
      assert(ctx.host.matchingNotifications("goalReports.changed").length === 0, "refusal broadcast a report change");
      if (withDraft) assert(await readFile(draftPath, "utf8") === draftBytes, "refusal changed the draft");
      await endTurn(ctx.host, turnId);
      executions.push({ sessionId: session.id, executionId, withDraft, draftPath, draftBytes });
    }
    await ctx.host.restart();
    for (const { sessionId, executionId, withDraft, draftPath, draftBytes } of executions) {
      const read = await ctx.host.call("goalReports.get", { sessionId, executionId });
      const list = await ctx.host.call("goalReports.list", { sessionId });
      assert(read.state === (withDraft ? "draft" : "pending"), shortJson(read));
      assert(list.reports?.every((report) => report.status !== "ready"), shortJson(list));
      assert(!existsSync(join(ctx.dataDir, "goal_reports", sessionId, `${executionId}.json`)), "restart published an interrupted artifact");
      if (withDraft) assert(await readFile(draftPath, "utf8") === draftBytes, "restart changed the interrupted draft");
      await expectRpcError(
        () => ctx.host.call("goalReports.retry", { sessionId, executionId }),
        ["GOAL_EXECUTION_NOT_TERMINAL"],
      );
    }
    return "interruptedPendingAndDraftRefused=true metadataAndDraftPreserved=true restartHasNoArtifact=true";
  }, binary, tempRoot);
}

async function scenarioSessionIsolation(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-003", async (ctx) => {
    const { session: sessionA, turnId: turnA, executionId: execA } = await approvedGoalExecution(
      ctx,
      "Session A Goal",
      true,
    );
    await ctx.host.call("goalReports.bindExecutionTurn", { executionId: execA, turnId: turnA });
    await ctx.host.call("goalReports.submitDraft", { executionId: execA, draft: { verdict: "met", summary: "Verified session A." } });
    await ctx.host.call("plans.finishExecution", { executionId: execA, status: "completed" });
    await ctx.host.call("goalReports.finalizeReport", { executionId: execA, status: "completed" });

    const { session: sessionB, turnId: turnB, executionId: execB } = await approvedGoalExecution(
      ctx,
      "Session B Goal",
      true,
    );
    await ctx.host.call("goalReports.bindExecutionTurn", { executionId: execB, turnId: turnB });
    await ctx.host.call("goalReports.submitDraft", { executionId: execB, draft: { verdict: "met", summary: "Verified session B." } });
    await ctx.host.call("plans.finishExecution", { executionId: execB, status: "completed" });
    await ctx.host.call("goalReports.finalizeReport", { executionId: execB, status: "completed" });

    // Verify isolation
    const listA = await ctx.host.call("goalReports.list", { sessionId: sessionA.id });
    assert(listA.reports?.length === 1 && listA.reports[0].executionId === execA, shortJson(listA));

    const listB = await ctx.host.call("goalReports.list", { sessionId: sessionB.id });
    assert(listB.reports?.length === 1 && listB.reports[0].executionId === execB, shortJson(listB));

    // Cross-session access must return only a not-found state, with no report identity.
    const crossAccessRes = await ctx.host.call("goalReports.get", {
      sessionId: sessionB.id,
      executionId: execA,
    });
    assert(crossAccessRes.state === "not_found", `cross-session state was not hidden: ${shortJson(crossAccessRes)}`);
    assert(
      crossAccessRes.report?.state === "not_found" &&
        crossAccessRes.report.reportId == null &&
        crossAccessRes.report.executionId == null,
      `cross-session report identity leaked: ${shortJson(crossAccessRes)}`,
    );

    // Cascade deletion check
    const dirA = join(ctx.dataDir, "goal_reports", sessionA.id);
    const dirB = join(ctx.dataDir, "goal_reports", sessionB.id);
    assert(existsSync(dirA), "dirA missing before delete");
    assert(existsSync(dirB), "dirB missing before delete");

    await ctx.host.call("session.delete", { id: sessionA.id });
    assert(!existsSync(dirA), `dirA not deleted on session.delete: ${dirA}`);
    assert(existsSync(dirB), `dirB was incorrectly removed: ${dirB}`);

    const listAAfter = await ctx.host.call("goalReports.list", { sessionId: sessionA.id });
    assert(listAAfter.reports?.length === 0, shortJson(listAAfter));

    await endTurn(ctx.host, turnB);
    return `crossSessionDenied=true cascadeDeleteA=true retainB=true`;
  }, binary, tempRoot);
}

async function scenarioRestartRecovery(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-004", async (ctx) => {
    const title = "Restart Recovery Goal";
    const { session, turnId, executionId } = await approvedGoalExecution(ctx, title, true);

    await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });
    const draft = {
      verdict: "met",
      summary: "Testing durable persistence across host restarts.",
      metrics: [{ label: "Downtime", value: "0s" }],
      criteria: [{ id: "crit-1", text: "Survives restart", verdict: "met", explanation: "The report remains readable after restart." }],
      steps: [{ id: "step-1", title: "Commit", status: "completed" }],
      files: [],
      checks: [],
      limitations: [],
      nextSteps: [],
      evidences: [],
    };
    await ctx.host.call("goalReports.submitDraft", { executionId, draft });
    await ctx.host.call("plans.finishExecution", { executionId, status: "completed" });
    const finalized = await ctx.host.call("goalReports.finalizeReport", {
      executionId,
      status: "completed",
    });
    const preRestart = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    assert(preRestart.report?.execution?.status === "completed", shortJson(preRestart));

    // Restart the host process
    await ctx.host.restart();

    // Query report after restart
    const postRestart = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    const r = postRestart.report;
    assert(r, "report missing after host restart");
    assert(r.reportId === preRestart.report.reportId, "reportId mismatch after restart");
    assert(r.execution?.status === "completed", "execution status changed after restart");
    assert(r.integrity?.kind === "structured", "integrity changed after restart");
    assert(r.verdict === "met", "verdict changed after restart");
    assert(r.summary === draft.summary, "summary changed after restart");
    assert(r.criteria?.length === 1, "criteria changed after restart");

    // Retry report
    const retryRes = await ctx.host.call("goalReports.retry", {
      sessionId: session.id,
      executionId,
    });
    assert(retryRes.report?.executionId === executionId, shortJson(retryRes));
    assert(retryRes.report?.status === "ready", shortJson(retryRes));

    return `survivesRestart=true reportId=${r.reportId} retry=ok`;
  }, binary, tempRoot);
}

async function scenarioDraftBounds(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-005", async (ctx) => {
    const { session, turnId, executionId } = await approvedGoalExecution(ctx, "Bounds Test", true);
    await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });

    // 1. Oversized JSON (> 256 KiB)
    const largeSummary = "X".repeat(260 * 1024);
    const oversizedError = await expectRpcError(
      () =>
        ctx.host.call("goalReports.submitDraft", {
          executionId,
          draft: {
            verdict: "met",
            summary: largeSummary,
            metrics: [],
            criteria: [],
            steps: [],
            files: [],
            checks: [],
          },
        }),
      ["INVALID_ARGUMENT", "INTERNAL"],
    );
    assert(oversizedError, "oversized draft (>256 KiB) was unexpectedly accepted");

    // 2. Oversized evidence summary (> 2 KiB)
    const largeEvidence = "E".repeat(3 * 1024);
    const oversizedEvidenceError = await expectRpcError(
      () =>
        ctx.host.call("goalReports.submitDraft", {
          executionId,
          draft: {
            verdict: "met",
            summary: "Small summary",
            metrics: [],
            criteria: [],
            steps: [],
            files: [],
            checks: [],
            evidences: [{ id: "ev-1", kind: "file", refId: "test", summary: largeEvidence }],
          },
        }),
      ["INVALID_ARGUMENT", "INTERNAL"],
    );
    assert(oversizedEvidenceError, "oversized evidence summary (>2 KiB) was unexpectedly accepted");

    // 3. Excess metrics (> 8)
    const excessMetrics = Array.from({ length: 9 }, (_, i) => ({
      label: `Metric ${i}`,
      value: `${i}`,
    }));
    const excessMetricsError = await expectRpcError(
      () =>
        ctx.host.call("goalReports.submitDraft", {
          executionId,
          draft: {
            verdict: "met",
            summary: "Small summary",
            metrics: excessMetrics,
            criteria: [],
            steps: [],
            files: [],
            checks: [],
          },
        }),
      ["INVALID_ARGUMENT", "INTERNAL"],
    );
    assert(excessMetricsError, "excess metrics (>8) was unexpectedly accepted");

    await endTurn(ctx.host, turnId);
    return `oversizedDraftRejected=true oversizedEvidenceRejected=true excessMetricsRejected=true`;
  }, binary, tempRoot);
}

async function scenarioPlanExclusion(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-006", async (ctx) => {
    // Normal Plan execution (kind: "plan")
    const session = await createSession(ctx.host, ctx.workspace, "Plan Run", "agent");
    const turnId = await beginTurn(ctx.host, session.id);
    await ctx.host.call("plans.enter", {
      sessionId: session.id,
      turnId,
      toolCallId: "plan-enter",
      requestedMode: "agent",
      kind: "plan",
    });
    const submitRes = await ctx.host.call("plans.submit", {
      sessionId: session.id,
      turnId,
      toolCallId: "plan-submit",
      title: "Plan Exclusion Test",
      markdown: "# Plan exclusion\n\n1. Should not create goal report\n",
      question: "Approve plan?",
      kind: "plan",
    });
    const resolved = await resolvePlan(ctx.host, submitRes.proposal, "approve", "ask");
    const executionId = resolved.execution.id;
    await ctx.host.call("plans.claimExecution", { executionId });

    // Attempting to bind a non-goal execution should be a no-op (kind != 'goal')
    await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });

    // List reports should be empty
    const listRes = await ctx.host.call("goalReports.list", { sessionId: session.id });
    assert(listRes.reports?.length === 0, `non-goal execution produced reports: ${shortJson(listRes)}`);

    await endTurn(ctx.host, turnId);
    return `planReportExcluded=true listCount=0`;
  }, binary, tempRoot);
}

async function runScenario(id, fn) {
  try {
    const detail = await fn();
    record(id, true, detail || "completed");
  } catch (error) {
    record(id, false, error?.message || String(error));
  }
}

async function main() {
  const binary = resolveHostBinary();
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-desktop-goal-report-e2e-"));
  try {
    await runScenario("E2E-GOAL-report-waits-for-settled-team", () => scenarioSettledTeam(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-001", () => scenarioStructuredReport(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-002", () => scenarioBlockedReport(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-003", () => scenarioSessionIsolation(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-004", () => scenarioRestartRecovery(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-005", () => scenarioDraftBounds(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-006", () => scenarioPlanExclusion(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-007", () => scenarioInterruptedExecution(binary, tempRoot));
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }

  const failed = results.filter((r) => !r.ok).length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nSummary: ${passed} passed, ${failed} failed (${results.length} executed)`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("E2E harness error:", err);
  process.exit(1);
});
