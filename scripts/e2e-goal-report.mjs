#!/usr/bin/env node
/**
 * Headless Goal Completion Report acceptance harness.
 *
 * Exercises the host RPC protocol for Goal completion reports:
 * - Structured draft submission and ready report lifecycle
 * - Invalidation and automatic fallback generation
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
import { setTimeout as delay } from "node:timers/promises";

import { assert, shortJson, expectRpcError } from "./e2e/assert.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { createSession, beginTurn, endTurn } from "./e2e/session.mjs";
import { resolvePlan } from "./e2e/plan.mjs";

const results = [];

function record(id, ok, detail = "") {
  results.push({ id, ok, skipped: false, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` - ${detail}` : ""}`);
}

async function approvedGoalExecution(ctx, title, shouldClaim = true) {
  const session = await createSession(ctx.host, ctx.workspace, title, "agent");
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

    ctx.host.clearNotifications();
    const submitDraftRes = await ctx.host.call("goalReports.submitDraft", {
      executionId,
      draft,
    });
    assert(submitDraftRes.ok === true, shortJson(submitDraftRes));

    // Finalize report
    const finalizeRes = await ctx.host.call("goalReports.finalizeReport", {
      executionId,
      status: "completed",
    });
    assert(finalizeRes.report?.status === "ready", shortJson(finalizeRes));
    assert(finalizeRes.report?.integrity === "structured", shortJson(finalizeRes));
    assert(finalizeRes.report?.verdict === "met", shortJson(finalizeRes));

    await delay(50);
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
    assert(report.schemaVersion === 1, shortJson(report));
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
    assert(parsedFile.schemaVersion === 1, "file JSON schemaVersion mismatch");

    await expectRpcError(
      () => ctx.host.call("goalReports.submitDraft", {
        executionId,
        draft: { ...draft, summary: "Late replacement" },
      }),
      ["INTERNAL"],
    );
    const afterLateDraft = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    assert(afterLateDraft.report?.summary === draft.summary, shortJson(afterLateDraft));
    assert(await readFile(reportFilePath, "utf8") === fileBytes, "late draft changed the report file");

    await endTurn(ctx.host, turnId);
    return `reportId=${report.reportId} integrity=structured verdict=met fileExists=true`;
  }, binary, tempRoot);
}

async function scenarioFallbackReport(binary, tempRoot) {
  return withScenario("E2E-GOAL-REPORT-002", async (ctx) => {
    const title = "Fallback Invalidation Run";
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

    // Finalize report with interrupted status
    const finalizeRes = await ctx.host.call("goalReports.finalizeReport", {
      executionId,
      status: "interrupted",
      errorCode: "USER_CANCELLED",
    });
    assert(finalizeRes.report?.status === "ready", shortJson(finalizeRes));
    assert(finalizeRes.report?.integrity === "fallback", shortJson(finalizeRes));

    const getRes = await ctx.host.call("goalReports.get", {
      sessionId: session.id,
      executionId,
    });
    const report = getRes.report;
    assert(report?.execution?.status === "interrupted", shortJson(report));
    assert(report?.integrity?.kind === "fallback", shortJson(report));
    assert(report?.verdict === "blocked", shortJson(report));
    assert(report?.summary?.includes("USER_CANCELLED"), `fallback summary should mention error: ${report?.summary}`);

    await endTurn(ctx.host, turnId);
    return `reportId=${report.reportId} integrity=fallback verdict=${report.verdict}`;
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
    await ctx.host.call("goalReports.finalizeReport", { executionId: execA, status: "completed" });

    const { session: sessionB, turnId: turnB, executionId: execB } = await approvedGoalExecution(
      ctx,
      "Session B Goal",
      true,
    );
    await ctx.host.call("goalReports.bindExecutionTurn", { executionId: execB, turnId: turnB });
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
    await runScenario("E2E-GOAL-REPORT-001", () => scenarioStructuredReport(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-002", () => scenarioFallbackReport(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-003", () => scenarioSessionIsolation(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-004", () => scenarioRestartRecovery(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-005", () => scenarioDraftBounds(binary, tempRoot));
    await runScenario("E2E-GOAL-REPORT-006", () => scenarioPlanExclusion(binary, tempRoot));
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
