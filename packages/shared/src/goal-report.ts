/**
 * Goal Completion Report v1 contract and validation.
 *
 * Owned by Host persistence; submitted as a structured draft by the autonomous
 * Goal agent and finalized into an immutable snapshot upon turn settlement.
 */

export const GOAL_REPORT_SCHEMA_VERSION = 1 as const;
export const HOST_DB_SCHEMA_VERSION = 20 as const;

export const GOAL_REPORT_MAX_JSON_BYTES = 256 * 1024; // 256 KiB
export const GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES = 2 * 1024; // 2 KiB
export const GOAL_REPORT_MAX_METRICS = 8;
export const GOAL_REPORT_MAX_CRITERIA = 100;
export const GOAL_REPORT_MAX_STEPS = 100;
export const GOAL_REPORT_MAX_FILES = 500;
export const GOAL_REPORT_MAX_CHECKS = 200;

export type GoalReportExecutionStatus = "completed" | "interrupted";
export type GoalReportIntegrity = "structured" | "fallback";
export type GoalReportVerdict = "met" | "partial" | "blocked" | "unknown";
export type GoalReportCriterionVerdict = "met" | "unmet" | "partial" | "unknown";
export type GoalReportStepStatus = "completed" | "failed" | "skipped";
export type GoalReportFileChangeType = "created" | "modified" | "deleted" | "referenced";
export type GoalReportFileAttribution = "direct" | "subagent" | "declared";
export type GoalReportCheckResult = "passed" | "failed" | "inconclusive";
export type GoalReportEvidenceKind = "tool_call" | "tool_result" | "message" | "file" | "subagent";

export type GoalReportMetric = {
  label: string;
  value: string;
  source?: string;
};

export type GoalReportCriterion = {
  id: string;
  text: string;
  contractRef?: string;
  verdict: GoalReportCriterionVerdict;
  explanation: string;
  evidenceRefs?: string[];
};

export type GoalReportStep = {
  id: string;
  title: string;
  status: GoalReportStepStatus;
  detail?: string;
  evidenceRefs?: string[];
};

export type GoalReportFile = {
  path: string;
  changeType: GoalReportFileChangeType;
  attribution: GoalReportFileAttribution;
  detail?: string;
};

export type GoalReportCheck = {
  id: string;
  command: string;
  exitCode?: number | null;
  result: GoalReportCheckResult;
  detail?: string;
  evidenceRefs?: string[];
};

export type GoalReportEvidence = {
  id: string;
  kind: GoalReportEvidenceKind;
  refId: string;
  summary: string;
  detail?: string;
};

/**
 * Full Goal Completion Report snapshot (schema version 1).
 */
export type GoalReport = {
  schemaVersion: typeof GOAL_REPORT_SCHEMA_VERSION;
  reportId: string;
  sessionId: string;
  executionId: string;
  proposalId: string;
  turnId?: string | null;

  /** Snapshot of the approved contract that guided this execution. */
  goal: {
    title: string;
    markdown: string;
    contractPath?: string | null;
    contractHash?: string | null;
  };

  /** Host-verified facts about the turn execution. */
  execution: {
    startedAt: number;
    completedAt: number;
    status: GoalReportExecutionStatus;
    errorCode?: string | null;
    durableSeq?: number;
  };

  /** Integrity status of the report. */
  integrity: {
    kind: GoalReportIntegrity;
    missingFields?: string[];
    truncationNotice?: string | null;
  };

  /** Model verdict on whether the goal was satisfied. */
  verdict: GoalReportVerdict;

  /** Core report content sections. */
  summary: string;
  metrics: GoalReportMetric[];
  criteria: GoalReportCriterion[];
  steps: GoalReportStep[];
  files: GoalReportFile[];
  checks: GoalReportCheck[];
  limitations: string[];
  nextSteps: string[];

  /** Evidences referenced by criteria, steps, and checks. */
  evidences: GoalReportEvidence[];
};

/**
 * Condensed report summary for session listings.
 */
export type GoalReportSummary = {
  reportId: string;
  sessionId: string;
  executionId: string;
  proposalId: string;
  turnId?: string | null;
  status: GoalReportExecutionStatus;
  verdict: GoalReportVerdict;
  integrity: GoalReportIntegrity;
  summary: string;
  goalTitle: string;
  completedAt: number;
  createdAt: number;
};

/**
 * Structured draft payload submitted by the SubmitGoalReport tool.
 */
export type SubmitGoalReportDraftInput = {
  summary: string;
  verdict: GoalReportVerdict;
  metrics?: GoalReportMetric[];
  criteria?: GoalReportCriterion[];
  steps?: GoalReportStep[];
  files?: GoalReportFile[];
  checks?: GoalReportCheck[];
  limitations?: string[];
  nextSteps?: string[];
  evidences?: GoalReportEvidence[];
};

/**
 * Notification event emitted when a goal report changes status.
 */
export type GoalReportChangedEvent = {
  sessionId: string;
  reportId: string;
  executionId: string;
  proposalId: string;
  status: "draft" | "pending" | "ready" | "failed";
  integrity?: GoalReportIntegrity;
  verdict?: GoalReportVerdict;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLengthUtf8(str: string): number {
  return new TextEncoder().encode(str).length;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Validates a draft payload submitted by the agent via SubmitGoalReport.
 */
export function validateGoalReportDraft(
  input: unknown,
): ValidationResult<SubmitGoalReportDraftInput> {
  if (!isRecord(input)) {
    return { ok: false, error: "Draft payload must be a JSON object" };
  }

  const rawJson = JSON.stringify(input);
  if (byteLengthUtf8(rawJson) > GOAL_REPORT_MAX_JSON_BYTES) {
    return {
      ok: false,
      error: `Report size (${byteLengthUtf8(rawJson)} bytes) exceeds maximum limit of ${GOAL_REPORT_MAX_JSON_BYTES} bytes (256 KiB)`,
    };
  }

  if (typeof input.summary !== "string" || !input.summary.trim()) {
    return { ok: false, error: "Report summary is required and must not be empty" };
  }

  const validVerdicts: GoalReportVerdict[] = ["met", "partial", "blocked", "unknown"];
  if (
    typeof input.verdict !== "string" ||
    !validVerdicts.includes(input.verdict as GoalReportVerdict)
  ) {
    return {
      ok: false,
      error: `Report verdict must be one of: ${validVerdicts.join(", ")}`,
    };
  }

  const metrics: GoalReportMetric[] = [];
  if (input.metrics !== undefined) {
    if (!Array.isArray(input.metrics)) {
      return { ok: false, error: "metrics must be an array" };
    }
    if (input.metrics.length > GOAL_REPORT_MAX_METRICS) {
      return {
        ok: false,
        error: `metrics count (${input.metrics.length}) exceeds maximum of ${GOAL_REPORT_MAX_METRICS}`,
      };
    }
    for (let i = 0; i < input.metrics.length; i++) {
      const item = input.metrics[i];
      if (!isRecord(item) || typeof item.label !== "string" || typeof item.value !== "string") {
        return { ok: false, error: `metrics[${i}] must have label and value strings` };
      }
      metrics.push({
        label: item.label.trim(),
        value: item.value.trim(),
        ...(typeof item.source === "string" ? { source: item.source.trim() } : {}),
      });
    }
  }

  const criteria: GoalReportCriterion[] = [];
  if (input.criteria !== undefined) {
    if (!Array.isArray(input.criteria)) {
      return { ok: false, error: "criteria must be an array" };
    }
    if (input.criteria.length > GOAL_REPORT_MAX_CRITERIA) {
      return {
        ok: false,
        error: `criteria count (${input.criteria.length}) exceeds maximum of ${GOAL_REPORT_MAX_CRITERIA}`,
      };
    }
    const validCritVerdicts: GoalReportCriterionVerdict[] = ["met", "unmet", "partial", "unknown"];
    for (let i = 0; i < input.criteria.length; i++) {
      const item = input.criteria[i];
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.text !== "string") {
        return { ok: false, error: `criteria[${i}] must have id and text strings` };
      }
      if (typeof item.verdict !== "string" || !validCritVerdicts.includes(item.verdict as GoalReportCriterionVerdict)) {
        return { ok: false, error: `criteria[${i}].verdict must be one of: ${validCritVerdicts.join(", ")}` };
      }
      criteria.push({
        id: item.id.trim(),
        text: item.text.trim(),
        verdict: item.verdict as GoalReportCriterionVerdict,
        explanation: typeof item.explanation === "string" ? item.explanation.trim() : "",
        ...(typeof item.contractRef === "string" ? { contractRef: item.contractRef.trim() } : {}),
        ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs.filter((s): s is string => typeof s === "string") } : {}),
      });
    }
  }

  const steps: GoalReportStep[] = [];
  if (input.steps !== undefined) {
    if (!Array.isArray(input.steps)) {
      return { ok: false, error: "steps must be an array" };
    }
    if (input.steps.length > GOAL_REPORT_MAX_STEPS) {
      return {
        ok: false,
        error: `steps count (${input.steps.length}) exceeds maximum of ${GOAL_REPORT_MAX_STEPS}`,
      };
    }
    const validStepStatuses: GoalReportStepStatus[] = ["completed", "failed", "skipped"];
    for (let i = 0; i < input.steps.length; i++) {
      const item = input.steps[i];
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") {
        return { ok: false, error: `steps[${i}] must have id and title strings` };
      }
      if (typeof item.status !== "string" || !validStepStatuses.includes(item.status as GoalReportStepStatus)) {
        return { ok: false, error: `steps[${i}].status must be one of: ${validStepStatuses.join(", ")}` };
      }
      steps.push({
        id: item.id.trim(),
        title: item.title.trim(),
        status: item.status as GoalReportStepStatus,
        ...(typeof item.detail === "string" ? { detail: item.detail.trim() } : {}),
        ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs.filter((s): s is string => typeof s === "string") } : {}),
      });
    }
  }

  const files: GoalReportFile[] = [];
  if (input.files !== undefined) {
    if (!Array.isArray(input.files)) {
      return { ok: false, error: "files must be an array" };
    }
    if (input.files.length > GOAL_REPORT_MAX_FILES) {
      return {
        ok: false,
        error: `files count (${input.files.length}) exceeds maximum of ${GOAL_REPORT_MAX_FILES}`,
      };
    }
    const validChangeTypes: GoalReportFileChangeType[] = ["created", "modified", "deleted", "referenced"];
    const validAttributions: GoalReportFileAttribution[] = ["direct", "subagent", "declared"];
    for (let i = 0; i < input.files.length; i++) {
      const item = input.files[i];
      if (!isRecord(item) || typeof item.path !== "string") {
        return { ok: false, error: `files[${i}] must have a path string` };
      }
      const changeType = typeof item.changeType === "string" && validChangeTypes.includes(item.changeType as GoalReportFileChangeType)
        ? (item.changeType as GoalReportFileChangeType)
        : "modified";
      const attribution = typeof item.attribution === "string" && validAttributions.includes(item.attribution as GoalReportFileAttribution)
        ? (item.attribution as GoalReportFileAttribution)
        : "direct";
      files.push({
        path: item.path.trim(),
        changeType,
        attribution,
        ...(typeof item.detail === "string" ? { detail: item.detail.trim() } : {}),
      });
    }
  }

  const checks: GoalReportCheck[] = [];
  if (input.checks !== undefined) {
    if (!Array.isArray(input.checks)) {
      return { ok: false, error: "checks must be an array" };
    }
    if (input.checks.length > GOAL_REPORT_MAX_CHECKS) {
      return {
        ok: false,
        error: `checks count (${input.checks.length}) exceeds maximum of ${GOAL_REPORT_MAX_CHECKS}`,
      };
    }
    const validResults: GoalReportCheckResult[] = ["passed", "failed", "inconclusive"];
    for (let i = 0; i < input.checks.length; i++) {
      const item = input.checks[i];
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.command !== "string") {
        return { ok: false, error: `checks[${i}] must have id and command strings` };
      }
      const result = typeof item.result === "string" && validResults.includes(item.result as GoalReportCheckResult)
        ? (item.result as GoalReportCheckResult)
        : "inconclusive";
      checks.push({
        id: item.id.trim(),
        command: item.command.trim(),
        result,
        exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
        ...(typeof item.detail === "string" ? { detail: item.detail.trim() } : {}),
        ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs.filter((s): s is string => typeof s === "string") } : {}),
      });
    }
  }

  const limitations: string[] = [];
  if (input.limitations !== undefined) {
    if (!Array.isArray(input.limitations)) {
      return { ok: false, error: "limitations must be an array" };
    }
    for (const lim of input.limitations) {
      if (typeof lim === "string" && lim.trim()) {
        limitations.push(lim.trim());
      }
    }
  }

  const nextSteps: string[] = [];
  if (input.nextSteps !== undefined) {
    if (!Array.isArray(input.nextSteps)) {
      return { ok: false, error: "nextSteps must be an array" };
    }
    for (const ns of input.nextSteps) {
      if (typeof ns === "string" && ns.trim()) {
        nextSteps.push(ns.trim());
      }
    }
  }

  const evidences: GoalReportEvidence[] = [];
  if (input.evidences !== undefined) {
    if (!Array.isArray(input.evidences)) {
      return { ok: false, error: "evidences must be an array" };
    }
    const validEvidenceKinds: GoalReportEvidenceKind[] = ["tool_call", "tool_result", "message", "file", "subagent"];
    for (let i = 0; i < input.evidences.length; i++) {
      const item = input.evidences[i];
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.summary !== "string") {
        return { ok: false, error: `evidences[${i}] must have id and summary strings` };
      }
      if (byteLengthUtf8(item.summary) > GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES) {
        return {
          ok: false,
          error: `evidence[${i}] summary exceeds maximum limit of ${GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES} bytes (2 KiB)`,
        };
      }
      const kind = typeof item.kind === "string" && validEvidenceKinds.includes(item.kind as GoalReportEvidenceKind)
        ? (item.kind as GoalReportEvidenceKind)
        : "tool_result";
      evidences.push({
        id: item.id.trim(),
        kind,
        refId: typeof item.refId === "string" ? item.refId.trim() : "",
        summary: item.summary.trim(),
        ...(typeof item.detail === "string" ? { detail: item.detail.trim() } : {}),
      });
    }
  }

  return {
    ok: true,
    value: {
      summary: input.summary.trim(),
      verdict: input.verdict as GoalReportVerdict,
      metrics,
      criteria,
      steps,
      files,
      checks,
      limitations,
      nextSteps,
      evidences,
    },
  };
}

/**
 * Validates a complete GoalReport snapshot.
 */
export function validateGoalReport(input: unknown): ValidationResult<GoalReport> {
  if (!isRecord(input)) {
    return { ok: false, error: "Report snapshot must be a JSON object" };
  }

  if (input.schemaVersion !== GOAL_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported report schemaVersion: ${String(input.schemaVersion)} (expected ${GOAL_REPORT_SCHEMA_VERSION})`,
    };
  }

  for (const idField of ["reportId", "sessionId", "executionId", "proposalId"] as const) {
    if (typeof input[idField] !== "string" || !input[idField].trim()) {
      return { ok: false, error: `Report must include non-empty ${idField}` };
    }
  }

  if (!isRecord(input.goal) || typeof input.goal.title !== "string" || typeof input.goal.markdown !== "string") {
    return { ok: false, error: "Report must include goal with title and markdown" };
  }

  if (
    !isRecord(input.execution) ||
    typeof input.execution.startedAt !== "number" ||
    typeof input.execution.completedAt !== "number" ||
    (input.execution.status !== "completed" && input.execution.status !== "interrupted")
  ) {
    return { ok: false, error: "Report execution facts are invalid or incomplete" };
  }

  if (!isRecord(input.integrity) || (input.integrity.kind !== "structured" && input.integrity.kind !== "fallback")) {
    return { ok: false, error: "Report integrity kind must be 'structured' or 'fallback'" };
  }

  const draftResult = validateGoalReportDraft(input);
  if (!draftResult.ok) {
    return draftResult;
  }

  const validated = draftResult.value;
  return {
    ok: true,
    value: {
      schemaVersion: GOAL_REPORT_SCHEMA_VERSION,
      reportId: (input.reportId as string).trim(),
      sessionId: (input.sessionId as string).trim(),
      executionId: (input.executionId as string).trim(),
      proposalId: (input.proposalId as string).trim(),
      turnId: typeof input.turnId === "string" ? input.turnId.trim() : null,
      goal: {
        title: input.goal.title.trim(),
        markdown: input.goal.markdown,
        contractPath: typeof input.goal.contractPath === "string" ? input.goal.contractPath : null,
        contractHash: typeof input.goal.contractHash === "string" ? input.goal.contractHash : null,
      },
      execution: {
        startedAt: input.execution.startedAt,
        completedAt: input.execution.completedAt,
        status: input.execution.status as GoalReportExecutionStatus,
        errorCode: typeof input.execution.errorCode === "string" ? input.execution.errorCode : null,
        durableSeq: typeof input.execution.durableSeq === "number" ? input.execution.durableSeq : undefined,
      },
      integrity: {
        kind: input.integrity.kind as GoalReportIntegrity,
        missingFields: Array.isArray(input.integrity.missingFields)
          ? input.integrity.missingFields.filter((s): s is string => typeof s === "string")
          : undefined,
        truncationNotice: typeof input.integrity.truncationNotice === "string"
          ? input.integrity.truncationNotice
          : null,
      },
      verdict: validated.verdict,
      summary: validated.summary,
      metrics: validated.metrics ?? [],
      criteria: validated.criteria ?? [],
      steps: validated.steps ?? [],
      files: validated.files ?? [],
      checks: validated.checks ?? [],
      limitations: validated.limitations ?? [],
      nextSteps: validated.nextSteps ?? [],
      evidences: validated.evidences ?? [],
    },
  };
}
