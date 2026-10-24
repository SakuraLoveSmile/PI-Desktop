#!/usr/bin/env node
/** Isolated, no-model Goal approval -> tool -> real Host report contract. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withScenario } from "./e2e/fixture.mjs";
import { resolveHostBinary } from "./e2e/host.mjs";
import { createSession, beginTurn, endTurn } from "./e2e/session.mjs";
import { resolveParams } from "./e2e/plan.mjs";
import { GoalReportDraftManager } from "../packages/agent-runtime/dist/goal-report-tool.js";
import { planExecutionFromUnknown } from "../packages/host-runtime/dist/plan-execution.js";

const binary = resolveHostBinary();
const tempRoot = await mkdtemp(join(tmpdir(), "pi-required-verification-"));
try {
  await withScenario("E2E-GOAL-required-verification-001", async ({ host, workspace }) => {
    const session = await createSession(host, workspace, "Required verification", "goal");
    const negotiation = await beginTurn(host, session.id);
    const { proposal } = await host.call("plans.submit", {
      sessionId: session.id, turnId: negotiation, toolCallId: "required-submit", kind: "goal",
      title: "Bound report checks", markdown: "# Goal\nReport actual results for the frozen commands.", question: "Proceed?",
    });
    await endTurn(host, negotiation);
    // Escaped trailing space demonstrates why whitespace is part of shell syntax.
    const requiredVerificationCommands = ["printf '%s' suffix\\ ", "printf '%s\\n' verified"];
    const approve = { ...resolveParams(proposal, "approve", "auto"), requiredVerificationCommands };
    const approved = await host.call("plans.resolve", approve);
    assert.deepEqual(approved.proposal.requiredVerificationCommands, requiredVerificationCommands);
    const execution = planExecutionFromUnknown(approved.execution);
    assert.deepEqual(execution.requiredVerificationCommands, requiredVerificationCommands);
    assert.equal((await host.call("plans.resolve", approve)).execution.id, execution.id);
    await host.call("plans.claimExecution", { executionId: execution.id });
    const turnId = await beginTurn(host, session.id);
    await host.call("goalReports.bindExecutionTurn", { executionId: execution.id, turnId });
    const hostDrafts = [];
    const persistenceFailures = [];
    const manager = new GoalReportDraftManager({ sessionId: session.id, executionId: execution.id,
      onDraftSubmitted: async draft => {
        hostDrafts.push(draft);
        await host.call("goalReports.submitDraft", { executionId: execution.id, draft });
      },
      onDraftPersistenceFailure: error => { persistenceFailures.push(error); },
    });
    const tool = manager.buildTool();
    const report = { summary: "No actual check results yet", verdict: "met", checks: [] };
    const missing = await tool.execute("missing", report);
    assert.equal(missing.details.ok, false);
    assert.match(missing.details.error, /missing from checks/);
    assert.equal(manager.isDraftValid(), false);
    const checks = requiredVerificationCommands.map((command, index) => ({ id: `check-${index}`, command, exitCode: 0, result: "passed" }));
    const trimmed = structuredClone(checks);
    trimmed[0].command = trimmed[0].command.trim();
    assert.equal((await tool.execute("trimmed", { ...report, checks: trimmed })).details.ok, false);
    assert.equal(hostDrafts.at(-1).checks[0].command, trimmed[0].command);
    const honest = checks.map(check => ({ ...check, exitCode: null, result: "inconclusive", disposition: "not_run", detail: "This fixture validates reporting and does not execute verification commands." }));
    assert.equal((await tool.execute("honest", { ...report, verdict: "blocked", checks: honest })).details.ok, true);
    assert.deepEqual(hostDrafts.at(-1).checks, honest);
    const shell = (await host.call("commandShells.list", {})).effective;
    assert.ok(shell, "A configured fixture shell is required");
    const evidences = [];
    for (const [index, command] of requiredVerificationCommands.entries()) {
      const callId = `native-check-${index}`;
      const native = await host.call("tools.execute", {
        sessionId: session.id, turnId, toolCallId: callId, toolName: "Bash", mode: "agent",
        expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect, args: { command },
      });
      assert.equal(native.ok, true);
      assert.equal(native.content.exitCode, 0);
      // Runtime's actual AgentToolResult wrapper, persisted through the same
      // UiMessage API used by tool_end. No model or external project is used.
      await host.call("session.appendMessage", { sessionId: session.id, turnId, message: {
        id: callId, role: "tool", content: JSON.stringify(native.content), createdAt: new Date().toISOString(),
        toolName: "Bash", toolCallId: callId, toolStatus: "success", toolArgs: { command },
        toolResult: { content: [{ type: "text", text: JSON.stringify(native.content) }], details: native.content, isError: false },
      } });
      evidences.push({ id: `ev-${index}`, kind: "tool_result", refId: callId, summary: "Native command exit result" });
      checks[index].evidenceRefs = [`ev-${index}`];
    }
    for (const [label, change] of [
      ["shell-id", evidence => { evidence.refId = "bash"; }],
      ["tool-call", evidence => { evidence.kind = "tool_call"; }],
    ]) {
      const invalid = structuredClone(evidences);
      change(invalid[0]);
      const rejected = await tool.execute(label, { summary: "Invalid evidence reference", verdict: "met", checks, evidences: invalid });
      assert.equal(rejected.details.ok, false);
      assert.match(rejected.details.error, /durable native success evidence/);
      assert.equal(manager.isDraftValid(), false);
    }
    assert.equal((await tool.execute("corrected", { summary: "Native command results verified", verdict: "met", checks, evidences })).details.ok, true);
    assert.deepEqual(hostDrafts.at(-1).checks, checks);
    assert.equal(manager.isDraftValid(), true);
    assert.equal(persistenceFailures.length, 0);
    await endTurn(host, turnId);
    const settled = await host.call("goalExecutions.settle", { sessionId: session.id, executionId: execution.id, ended: "agent_stopped" });
    assert.equal(settled.execution.state, "completed");
    const read = await host.call("goalReports.get", { sessionId: session.id, executionId: execution.id });
    assert.equal(read.state, "ready");
    assert.deepEqual(read.report.checks, checks);
    assert.equal(read.report.checkObservations.length, checks.length);
    for (const observation of read.report.checkObservations) {
      assert.equal(observation.result, "passed");
      assert.equal(observation.exitCode, 0);
    }
    await assert.rejects(() => host.call("goalReports.submitDraft", { executionId: execution.id, draft: { summary: "Attempted history rewrite", verdict: "met", checks, evidences } }), /execution is not running|ready report/);
    assert.match(read.reportSha256, /^[a-f0-9]{64}$/);
    assert.equal((await host.call("goalReports.get", { sessionId: session.id, executionId: execution.id })).reportSha256, read.reportSha256);
    await host.stop();
    await host.start();
    const restored = await host.call("plans.pending", { sessionId: session.id });
    assert.deepEqual(restored.history.find(item => item.id === proposal.id).requiredVerificationCommands, requiredVerificationCommands);
    if (process.env.PI_E2E_REPORT_OUTPUT) {
      await writeFile(process.env.PI_E2E_REPORT_OUTPUT, JSON.stringify({ requiredVerificationCommands, ...read }, null, 2) + "\n");
    }
    console.log("PASS: exact-byte approval binding, missing/trimmed and wrong evidence rejection, honest not-run report, real native Bash wrapper results, same-execution correction, immutable finalized native observations and restart persistence; no model calls.");
  }, binary, tempRoot);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
