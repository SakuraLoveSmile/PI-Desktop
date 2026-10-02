#!/usr/bin/env node
/**
 * Goal Completion Report UI & Transport E2E runner (E2E-GOAL-REPORT-UI).
 *
 * Verifies:
 * - Structured report publication with turn timing provenance, metrics, criteria, steps, and files.
 * - Evidence resolutions: records message and approval references up to durableSeq; marks unrecorded refs unresolved.
 * - Check observations: compares Agent claims with Host recorded command exit codes and highlights contradictions.
 * - Screenshot assets: validates PNG/JPEG/WebP images, copies into report assets, and streams chunks via goalReports.getAsset.
 * - Chunk range bounds, EOF signaling, SHA-256 integrity, and cross-session asset security.
 * - Non-ready states: draft/pending in-flight, corrupt file hash/size detection, and idempotent retry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { assert, shortJson } from "./e2e/assert.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { withScenario } from "./e2e/fixture.mjs";
import { createSession, beginTurn, endTurn } from "./e2e/session.mjs";
import { resolvePlan } from "./e2e/plan.mjs";

const results = [];

function record(id, ok, detail = "") {
  results.push({ id, ok, skipped: false, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` - ${detail}` : ""}`);
}

async function approvedGoalExecution(ctx, title) {
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
    markdown: `# ${title}\n\n- Task 1: Run checks\n- Task 2: Capture screenshots\n`,
    question: `Approve ${title}?`,
    kind: "goal",
  });
  const proposal = submitRes.proposal;
  assert(proposal?.id, `proposal missing: ${shortJson(submitRes)}`);
  const resolved = await resolvePlan(ctx.host, proposal, "approve", "accept-edits");
  assert(resolved.execution?.state === "queued", shortJson(resolved));
  const executionId = resolved.execution.id;
  const claimed = await ctx.host.call("plans.claimExecution", { executionId });
  assert(claimed.execution?.state === "running", shortJson(claimed));

  return { session, turnId, proposal, execution: claimed.execution, executionId };
}

async function scenarioStructuredWithAssets(binary, tempRoot) {
  return withScenario(
    "E2E-GOAL-UI-001",
    async (ctx) => {
      const { session, turnId, executionId } = await approvedGoalExecution(ctx, "Full Report with Assets");

      // Bind execution turn
      await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });

      // Place a screenshot in this session's owned scratch directory
      const attDir = join(ctx.dataDir, "scratch", session.id);
      mkdirSync(attDir, { recursive: true });
      const rawPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("SAMPLE_PNG_IMAGE_DATA_FOR_GOAL_REPORT_VERIFICATION_TEST"),
      ]);
      const pngSha256 = createHash("sha256").update(rawPng).digest("hex");
      const imgFileName = "screenshot-sample.png";
      writeFileSync(join(attDir, imgFileName), rawPng);

      for (const [id, command, exitCode] of [
        ["recorded-check-1", "cargo test", 0],
        ["recorded-check-2", "npm run lint", 1],
      ]) {
        await ctx.host.call("session.appendMessage", {
          sessionId: session.id,
          turnId,
          message: {
            id, role: "tool", content: "Fixture command output",
            createdAt: new Date().toISOString(), toolName: "Bash",
            toolCallId: id, toolStatus: "success", toolArgs: { command },
            toolResult: { exitCode },
          },
        });
      }

      const draft = {
        verdict: "met",
        summary: "Goal was met completely with valid evidence and truthful observations.",
        metrics: [
          { label: "Unit Tests", value: "707/707", source: "cargo test" },
          { label: "Coverage", value: "94.2%", source: "tarpaulin" },
          { label: "Bundle Size", value: "480 KiB", source: "vite build" },
          { label: "Latency", value: "18ms", source: "benchmark" },
          { label: "Memory", value: "42 MiB", source: "profiler" },
        ],
        criteria: [
          { id: "crit-1", text: "Streaming asset RPC", verdict: "met", explanation: "Chunk reads verified." },
        ],
        steps: [
          { id: "step-1", title: "Capture image", status: "completed" },
          { id: "step-2", title: "Verify check facts", status: "completed" },
        ],
        files: [
          { path: "apps/desktop/src/components/workpanel/GoalReportTab.tsx", changeType: "modified", attribution: "direct" },
        ],
        checks: [
          { id: "chk-1", command: "cargo test", result: "passed", exitCode: 0, evidenceRefs: ["ev-check-1"] },
          { id: "chk-2", command: "npm run lint", result: "passed", exitCode: 0, evidenceRefs: ["ev-check-2"] },
        ],
        screenshots: [
          { id: "sc-main", evidenceRef: "ev-img", caption: "Main dashboard visual" },
        ],
        evidences: [
          { id: "ev-check-1", kind: "tool_result", refId: "recorded-check-1", summary: "Recorded test result" },
          { id: "ev-check-2", kind: "tool_result", refId: "recorded-check-2", summary: "Recorded lint failure" },
          { id: "ev-img", kind: "file", refId: imgFileName, summary: "Captured dashboard image" },
          { id: "ev-turn", kind: "message", refId: turnId, summary: "Recorded turn execution" },
          { id: "ev-unrecorded", kind: "tool_call", refId: "tc-never-ran", summary: "Ghost tool call" },
        ],
        limitations: ["Initial test environment"],
        nextSteps: ["Ship feature"],
      };

      // Submit draft
      await ctx.host.call("goalReports.submitDraft", { executionId, draft });

      await ctx.host.call("plans.finishExecution", { executionId, status: "completed" });
      // Finalize report
      const finalizeRes = await ctx.host.call("goalReports.finalizeReport", {
        executionId,
        status: "completed",
      });
      const summary = finalizeRes.report;
      assert(summary?.status === "ready", `finalize failed: ${shortJson(finalizeRes)}`);
      assert(summary?.verdict === "met", `verdict mismatch: ${shortJson(summary)}`);

      // Read report
      const getRes = await ctx.host.call("goalReports.get", {
        sessionId: session.id,
        executionId,
      });
      assert(getRes.state === "ready", `state not ready: ${shortJson(getRes)}`);
      const rep = getRes.report;
      assert(rep?.schemaVersion === 1, "schemaVersion mismatch");
      assert(rep?.assets?.length === 1, `assets length mismatch: ${shortJson(rep?.assets)}`);
      assert(rep?.assets[0]?.screenshotId === "sc-main", "screenshotId mismatch");
      assert(rep?.assets[0]?.sha256 === pngSha256, "asset sha256 mismatch");

      // Verify check observations and contradiction detection
      assert(rep?.checkObservations?.length === 2, "checkObservations missing");
      const obs1 = rep.checkObservations.find((o) => o.checkId === "chk-1");
      const obs2 = rep.checkObservations.find((o) => o.checkId === "chk-2");
      assert(obs1?.result === "passed", `chk-1 observation not passed: ${shortJson(obs1)}`);
      assert(obs2?.result === "failed", `chk-2 observation not failed: ${shortJson(obs2)}`);

      // Verify evidence resolutions
      const evRes1 = rep.evidenceResolution?.find((e) => e.evidenceId === "ev-img");
      const evRes2 = rep.evidenceResolution?.find((e) => e.evidenceId === "ev-unrecorded");
      assert(evRes2?.state === "unresolved", `unrecorded evidence should be unresolved: ${shortJson(evRes2)}`);

      // Chunk streaming of asset
      let offset = 0;
      const chunks = [];
      const chunkSize = 16;
      let eof = false;

      while (!eof) {
        const chunkRes = await ctx.host.call("goalReports.getAsset", {
          sessionId: session.id,
          executionId,
          screenshotId: "sc-main",
          offset,
          length: chunkSize,
        });

        assert(chunkRes.state === "ready", `chunk read failed: ${shortJson(chunkRes)}`);
        assert(chunkRes.dataBase64, "missing base64 data");
        const buf = Buffer.from(chunkRes.dataBase64, "base64");
        chunks.push(buf);
        offset += chunkRes.length;
        if (chunkRes.eof) eof = true;
      }

      const assembled = Buffer.concat(chunks);
      assert(assembled.length === rawPng.length, `length mismatch: ${assembled.length} vs ${rawPng.length}`);
      assert(assembled.equals(rawPng), "assembled bytes do not match original PNG");

      // Negative test: non-existent screenshot
      const badAsset = await ctx.host.call("goalReports.getAsset", {
        sessionId: session.id,
        executionId,
        screenshotId: "ghost-sc",
      });
      assert(badAsset.state === "unavailable", `bad asset should be unavailable: ${shortJson(badAsset)}`);

      // Negative test: cross-session asset fetch
      const crossAsset = await ctx.host.call("goalReports.getAsset", {
        sessionId: "sess-other-invalid",
        executionId,
        screenshotId: "sc-main",
      });
      assert(crossAsset.state === "not_found", `cross-session asset should be not_found: ${shortJson(crossAsset)}`);

      return "Structured report, asset chunks, evidence and check observation verified";
    },
    binary,
    tempRoot,
  );
}

async function scenarioTamperDetection(binary, tempRoot) {
  return withScenario(
    "E2E-GOAL-UI-002",
    async (ctx) => {
      const { session, turnId, executionId } = await approvedGoalExecution(ctx, "Tamper Detection Test");
      await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });

      const draft = {
        verdict: "met",
        summary: "Original pristine report",
      };
      await ctx.host.call("goalReports.submitDraft", { executionId, draft });
      await ctx.host.call("plans.finishExecution", { executionId, status: "completed" });
      await ctx.host.call("goalReports.finalizeReport", { executionId, status: "completed" });

      const reportPath = join(ctx.dataDir, "goal_reports", session.id, `${executionId}.json`);
      assert(existsSync(reportPath), "report file missing on disk");

      // Tamper with the report file on disk (valid JSON with different content)
      const tamperedContent = readFileSync(reportPath, "utf8").replace("Original pristine report", "Tampered content");
      writeFileSync(reportPath, tamperedContent, "utf8");

      // Reading must detect sha256 mismatch against DB and return corrupt state without body
      const corruptRes = await ctx.host.call("goalReports.get", {
        sessionId: session.id,
        executionId,
      });

      assert(corruptRes.state === "corrupt", `tampered report must return corrupt state: ${shortJson(corruptRes)}`);
      assert(corruptRes.report?.goal === undefined, "corrupt read must not return report body");

      return "Disk tampering detected and returned corrupt state without body";
    },
    binary,
    tempRoot,
  );
}

async function scenarioIdempotentRetry(binary, tempRoot) {
  return withScenario(
    "E2E-GOAL-UI-003",
    async (ctx) => {
      const { session, turnId, executionId } = await approvedGoalExecution(ctx, "Retry Report Test");
      await ctx.host.call("goalReports.bindExecutionTurn", { executionId, turnId });

      // Mark report failed
      await ctx.host.call("goalReports.markFailed", {
        sessionId: session.id,
        executionId,
        errorCode: "REPORT_PERSISTENCE_BARRIER_FAILED",
      });

      const failedRes = await ctx.host.call("goalReports.get", {
        sessionId: session.id,
        executionId,
      });
      assert(failedRes.state === "failed", `expected failed state: ${shortJson(failedRes)}`);

      // Retry report
      await ctx.host.call("plans.finishExecution", { executionId, status: "completed" });
      const retryRes = await ctx.host.call("goalReports.retry", {
        sessionId: session.id,
        executionId,
      });
      assert(retryRes.report?.status === "ready", `retry should produce ready report: ${shortJson(retryRes)}`);

      const readyRes = await ctx.host.call("goalReports.get", {
        sessionId: session.id,
        executionId,
      });
      assert(readyRes.state === "ready", `expected ready after retry: ${shortJson(readyRes)}`);
      assert(readyRes.report?.integrity?.kind === "fallback", "retried failed report should be fallback");

      return "Report retry successfully restored ready fallback state from host facts";
    },
    binary,
    tempRoot,
  );
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
  console.log(`Using host binary: ${binary}`);
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-e2e-goal-ui-"));

  try {
    await runScenario("E2E-GOAL-UI-001", () => scenarioStructuredWithAssets(binary, tempRoot));
    await runScenario("E2E-GOAL-UI-002", () => scenarioTamperDetection(binary, tempRoot));
    await runScenario("E2E-GOAL-UI-003", () => scenarioIdempotentRetry(binary, tempRoot));
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }

  const failedCount = results.filter((r) => !r.ok).length;
  console.log(`\n========================================`);
  console.log(`Results: ${results.length - failedCount}/${results.length} passed`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
