import { describe, expect, it } from "vitest";
import {
  GOAL_REPORT_MAX_CRITERIA,
  GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES,
  GOAL_REPORT_MAX_JSON_BYTES,
  GOAL_REPORT_MAX_METRICS,
  GOAL_REPORT_SCHEMA_VERSION,
  type GoalReport,
  type SubmitGoalReportDraftInput,
  validateGoalReport,
  validateGoalReportDraft,
} from "./goal-report.js";

describe("Goal Completion Report v1 Contract & Validation", () => {
  const sampleValidDraft: SubmitGoalReportDraftInput = {
    summary: "Goal was successfully implemented with all tests passing.",
    verdict: "met",
    metrics: [
      { label: "Tests Passed", value: "42/42", source: "cargo test" },
      { label: "Lines Changed", value: "+120 / -15", source: "git diff" },
    ],
    criteria: [
      {
        id: "crit-1",
        text: "Database schema migration v20",
        contractRef: "Acceptance criteria #1",
        verdict: "met",
        explanation: "Added migration from v19 to v20 and verified cleanly.",
        evidenceRefs: ["ev-check-1"],
      },
    ],
    steps: [
      {
        id: "step-1",
        title: "Define shared report contract",
        status: "completed",
        detail: "Exported types and validators in packages/shared.",
      },
    ],
    files: [
      {
        path: "packages/shared/src/goal-report.ts",
        changeType: "created",
        attribution: "direct",
      },
    ],
    checks: [
      {
        id: "chk-1",
        command: "cargo test -p host-core",
        exitCode: 0,
        result: "passed",
        detail: "All host-core unit tests passed.",
        evidenceRefs: ["ev-check-1"],
      },
    ],
    limitations: ["No PDF export in v1"],
    nextSteps: ["Perform user walkthrough"],
    evidences: [
      {
        id: "ev-check-1",
        kind: "tool_result",
        refId: "call_bash_1",
        summary: "cargo test output exited with code 0",
        detail: "test result: ok. 120 passed; 0 failed",
      },
    ],
  };

  const sampleValidReport: GoalReport = {
    schemaVersion: GOAL_REPORT_SCHEMA_VERSION,
    reportId: "rep-12345",
    sessionId: "sess-abc",
    executionId: "exec-xyz",
    proposalId: "prop-999",
    turnId: "turn-1",
    goal: {
      title: "Implement Goal Completion Report",
      markdown: "# Goal\n\nBuild goal report.",
      contractPath: ".pi/goal/contract.md",
      contractHash: "abc123sha",
    },
    execution: {
      startedAt: 1000,
      completedAt: 5000,
      status: "completed",
      errorCode: null,
      durableSeq: 15,
    },
    integrity: {
      kind: "structured",
    },
    ...sampleValidDraft,
    metrics: sampleValidDraft.metrics!,
    criteria: sampleValidDraft.criteria!,
    steps: sampleValidDraft.steps!,
    files: sampleValidDraft.files!,
    checks: sampleValidDraft.checks!,
    limitations: sampleValidDraft.limitations!,
    nextSteps: sampleValidDraft.nextSteps!,
    evidences: sampleValidDraft.evidences!,
  };

  it("validates a healthy structured draft", () => {
    const res = validateGoalReportDraft(sampleValidDraft);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.summary).toBe(sampleValidDraft.summary);
      expect(res.value.verdict).toBe("met");
      expect(res.value.metrics?.length).toBe(2);
    }
  });

  it("validates a complete healthy report snapshot", () => {
    const res = validateGoalReport(sampleValidReport);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reportId).toBe("rep-12345");
      expect(res.value.goal.title).toBe("Implement Goal Completion Report");
      expect(res.value.execution.status).toBe("completed");
      expect(res.value.integrity.kind).toBe("structured");
    }
  });

  it("validates a fallback report snapshot", () => {
    const fallbackReport: GoalReport = {
      schemaVersion: GOAL_REPORT_SCHEMA_VERSION,
      reportId: "rep-fallback",
      sessionId: "sess-abc",
      executionId: "exec-xyz",
      proposalId: "prop-999",
      turnId: null,
      goal: {
        title: "Fallback Goal",
        markdown: "# Goal",
      },
      execution: {
        startedAt: 1000,
        completedAt: 2000,
        status: "interrupted",
        errorCode: "TURN_ABORTED",
      },
      integrity: {
        kind: "fallback",
        missingFields: ["metrics", "criteria"],
        truncationNotice: "Generated from raw execution logs",
      },
      verdict: "unknown",
      summary: "Execution was interrupted before structured report was submitted.",
      metrics: [],
      criteria: [],
      steps: [],
      files: [],
      checks: [],
      limitations: [],
      nextSteps: [],
      evidences: [],
    };
    const res = validateGoalReport(fallbackReport);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.integrity.kind).toBe("fallback");
      expect(res.value.verdict).toBe("unknown");
      expect(res.value.execution.status).toBe("interrupted");
    }
  });

  it("rejects draft missing summary or verdict", () => {
    expect(validateGoalReportDraft({}).ok).toBe(false);
    expect(validateGoalReportDraft({ summary: "" }).ok).toBe(false);
    expect(validateGoalReportDraft({ summary: "Summary", verdict: "invalid" }).ok).toBe(false);
  });

  it("enforces metric count bounds", () => {
    const metrics = Array.from({ length: GOAL_REPORT_MAX_METRICS + 1 }, (_, i) => ({
      label: `Metric ${i}`,
      value: `${i}`,
    }));
    const res = validateGoalReportDraft({
      summary: "Test",
      verdict: "met",
      metrics,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("metrics count");
    }
  });

  it("enforces criteria count bounds", () => {
    const criteria = Array.from({ length: GOAL_REPORT_MAX_CRITERIA + 1 }, (_, i) => ({
      id: `crit-${i}`,
      text: `Criterion ${i}`,
      verdict: "met" as const,
      explanation: "done",
    }));
    const res = validateGoalReportDraft({
      summary: "Test",
      verdict: "met",
      criteria,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("criteria count");
    }
  });

  it("enforces evidence summary size limit (2 KiB)", () => {
    const largeSummary = "a".repeat(GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES + 10);
    const res = validateGoalReportDraft({
      summary: "Test",
      verdict: "met",
      evidences: [
        {
          id: "ev-1",
          kind: "tool_result",
          refId: "call-1",
          summary: largeSummary,
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("summary exceeds maximum limit");
    }
  });

  it("enforces overall json byte limit (256 KiB)", () => {
    const largeString = "x".repeat(GOAL_REPORT_MAX_JSON_BYTES + 100);
    const res = validateGoalReportDraft({
      summary: largeString,
      verdict: "met",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("exceeds maximum limit");
    }
  });
});
