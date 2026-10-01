/**
 * Goal Completion Report v1 contract and validation.
 *
 * Owned by Host persistence; submitted as a structured draft by the autonomous
 * Goal agent and finalized into an immutable snapshot upon turn settlement.
 */

export const GOAL_REPORT_SCHEMA_VERSION = 1 as const;
export const HOST_DB_SCHEMA_VERSION = 22 as const;

export const GOAL_REPORT_MAX_JSON_BYTES = 256 * 1024; // 256 KiB
export const GOAL_REPORT_MAX_EVIDENCE_SUMMARY_BYTES = 2 * 1024; // 2 KiB
export const GOAL_REPORT_MAX_METRICS = 8;
export const GOAL_REPORT_MAX_CRITERIA = 100;
export const GOAL_REPORT_MAX_STEPS = 100;
export const GOAL_REPORT_MAX_FILES = 500;
export const GOAL_REPORT_MAX_CHECKS = 200;
export const GOAL_REPORT_MAX_SCREENSHOTS = 12;
export const GOAL_REPORT_MAX_CHECK_OBSERVATIONS = 200;

export type GoalReportExecutionStatus = "completed" | "interrupted";
export type GoalReportStatus = "draft" | "pending" | "ready" | "failed";
export type GoalReportIntegrity = "structured" | "fallback";
export type GoalReportVerdict = "met" | "partial" | "blocked" | "unknown";
export type GoalReportCriterionVerdict = "met" | "unmet" | "partial" | "unknown";
export type GoalReportStepStatus = "completed" | "failed" | "skipped";
export type GoalReportFileChangeType = "created" | "modified" | "deleted" | "referenced";
export type GoalReportFileAttribution = "direct" | "subagent" | "declared";
export type GoalReportCheckResult = "passed" | "failed" | "inconclusive";
export type GoalReportEvidenceKind = "tool_call" | "tool_result" | "message" | "file" | "subagent";

export type GoalReportCheckDisposition = "executed" | "not_run" | "blocked";
/** Timing provenance of the reported duration; absent means legacy stamps. */
export type GoalReportTimingSource = "turn" | "unavailable";

export type GoalReportMetric = {
  label: string;
  value: string;
  source?: string;
  /** Evidence ids that support the value, when any were recorded. */
  evidenceRefs?: string[];
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
  /** Optional display grouping, for example a module or layer name. */
  group?: string;
};

export type GoalReportCheck = {
  id: string;
  command: string;
  exitCode?: number | null;
  result: GoalReportCheckResult;
  detail?: string;
  evidenceRefs?: string[];
  /** Human label for the check row; falls back to the command. */
  label?: string;
  /**
   * Whether the check ran at all. `not_run` and `blocked` pair with an
   * `inconclusive` result and an explanation.
   */
  disposition?: GoalReportCheckDisposition;
};

export type GoalReportEvidence = {
  id: string;
  kind: GoalReportEvidenceKind;
  refId: string;
  summary: string;
  detail?: string;
};

/**
 * What the Host could observe for one referenced evidence id.
 *
 * `recorded` means the record exists in the owning execution. It is not a
 * semantic acceptance of whatever claimed it.
 */
export type GoalReportEvidenceResolution = {
  evidenceId: string;
  state: "recorded" | "unresolved";
  detail?: string;
};

/** Host-observed facts for one check, rendered beside the model's claim. */
export type GoalReportCheckObservation = {
  checkId: string;
  result: "passed" | "failed" | "inconclusive";
  command?: string;
  exitCode?: number | null;
  evidenceIds: string[];
  detail?: string;
};

/** Optional context line for the report header. */
export type GoalReportDeliveryContext = {
  sourceLabel?: string;
  targetVersion?: string;
  revisionLabel?: string;
  evidenceRefs?: string[];
};

/** One image the report shows; the bytes come from the referenced evidence. */
export type GoalReportScreenshot = {
  id: string;
  evidenceRef: string;
  caption: string;
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
    /** Timing provenance; absent means legacy proposal/publication stamps. */
    timingSource?: GoalReportTimingSource;
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

  /** Optional model-authored presentation fields. */
  deliveryContext?: GoalReportDeliveryContext;
  conclusion?: string;
  /** Gallery entries; each one points at an existing evidence id. */
  screenshots?: GoalReportScreenshot[];

  /** Host-owned: manifest of resolved screenshot assets stored for this report. */
  assets?: GoalReportAsset[];
  /** Host-owned: what could be resolved for each referenced evidence id. */
  evidenceResolution?: GoalReportEvidenceResolution[];
  /** Host-owned: what the recorded results say about each check. */
  checkObservations?: GoalReportCheckObservation[];
};

export type GoalReportAsset = {
  screenshotId: string;
  assetId: string;
  evidenceId: string;
  relativePath: string;
  mimeType: string;
  bytes: number;
  sha256: string;
};

export type GoalReportAssetChunk = {
  state: "ready" | "unavailable" | "not_found" | "corrupt";
  assetId?: string;
  mimeType?: string;
  totalBytes?: number;
  offset?: number;
  length?: number;
  sha256?: string;
  dataBase64?: string;
  eof?: boolean;
  sessionId?: string;
  detail?: string;
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
  status: GoalReportStatus;
  executionStatus: GoalReportExecutionStatus | null;
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
  /**
   * Optional presentation fields. Host-owned resolution, hashes and assets are
   * not part of a draft and are rejected by the validator.
   */
  deliveryContext?: GoalReportDeliveryContext;
  conclusion?: string;
  screenshots?: GoalReportScreenshot[];
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
  options: { hostOwned?: "reject" | "accept" } = {},
): ValidationResult<SubmitGoalReportDraftInput> {
  if (!isRecord(input)) {
    return { ok: false, error: "Draft payload must be a JSON object" };
  }

  // Host-owned facts are never a model input. A draft that tries to submit
  // resolution, hashes or assets is rejected rather than silently ignored, so
  // a model cannot claim host verification.
  if (options.hostOwned !== "accept") {
    for (const reserved of ["evidenceResolution", "checkObservations", "verificationSource", "assets", "reportSha256"]) {
      if (input[reserved] !== undefined) {
        return { ok: false, error: `${reserved} is host-owned and cannot be submitted in a draft` };
      }
    }
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
        ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs.filter((s): s is string => typeof s === "string") } : {}),
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
        ...(typeof item.group === "string" && item.group.trim() ? { group: item.group.trim() } : {}),
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
      const detail = typeof item.detail === "string" ? item.detail.trim() : undefined;
      const disposition = item.disposition === "executed" || item.disposition === "not_run" || item.disposition === "blocked"
        ? (item.disposition as GoalReportCheckDisposition)
        : undefined;
      // A check that never ran cannot claim a passing result.
      if ((disposition === "not_run" || disposition === "blocked") && (result !== "inconclusive" || !detail)) {
        return {
          ok: false,
          error: `checks[${i}] with disposition ${disposition} must use an inconclusive result and explain why`,
        };
      }
      checks.push({
        id: item.id.trim(),
        command: item.command.trim(),
        result,
        exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
        ...(detail ? { detail } : {}),
        ...(Array.isArray(item.evidenceRefs) ? { evidenceRefs: item.evidenceRefs.filter((s): s is string => typeof s === "string") } : {}),
        ...(typeof item.label === "string" && item.label.trim() ? { label: item.label.trim() } : {}),
        ...(disposition ? { disposition } : {}),
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

  const screenshots: GoalReportScreenshot[] = [];
  if (input.screenshots !== undefined) {
    if (!Array.isArray(input.screenshots)) {
      return { ok: false, error: "screenshots must be an array" };
    }
    if (input.screenshots.length > GOAL_REPORT_MAX_SCREENSHOTS) {
      return {
        ok: false,
        error: `screenshots count (${input.screenshots.length}) exceeds maximum of ${GOAL_REPORT_MAX_SCREENSHOTS}`,
      };
    }
    const seenIds = new Set<string>();
    for (let i = 0; i < input.screenshots.length; i++) {
      const item = input.screenshots[i];
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.evidenceRef !== "string") {
        return { ok: false, error: `screenshots[${i}] must have id and evidenceRef strings` };
      }
      const id = item.id.trim();
      if (seenIds.has(id)) {
        return { ok: false, error: `screenshots[${i}] repeats id ${id}` };
      }
      seenIds.add(id);
      screenshots.push({
        id,
        evidenceRef: item.evidenceRef.trim(),
        caption: typeof item.caption === "string" ? item.caption.trim() : "",
      });
    }
  }

  const deliveryContext = parseDeliveryContext(input.deliveryContext);
  const conclusion = typeof input.conclusion === "string" && input.conclusion.trim()
    ? input.conclusion.trim()
    : undefined;

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
      ...(deliveryContext ? { deliveryContext } : {}),
      ...(conclusion ? { conclusion } : {}),
      ...(screenshots.length > 0 ? { screenshots } : {}),
    },
  };
}


/**
 * Reads Host-owned fields back from a finalized snapshot.
 *
 * They are preserved on read so a re-validated report never loses recorded
 * facts, and they travel through the same shape the writer produced.
 */
function parseEvidenceResolution(value: unknown): GoalReportEvidenceResolution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GoalReportEvidenceResolution[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.evidenceId !== "string" || !item.evidenceId.trim()) continue;
    if (item.state !== "recorded" && item.state !== "unresolved") continue;
    out.push({
      evidenceId: item.evidenceId.trim(),
      state: item.state,
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    });
  }
  return out;
}

function parseCheckObservations(value: unknown): GoalReportCheckObservation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GoalReportCheckObservation[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.checkId !== "string" || !item.checkId.trim()) continue;
    if (item.result !== "passed" && item.result !== "failed" && item.result !== "inconclusive") continue;
    out.push({
      checkId: item.checkId.trim(),
      result: item.result,
      ...(typeof item.command === "string" ? { command: item.command } : {}),
      ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
      evidenceIds: Array.isArray(item.evidenceIds)
        ? item.evidenceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [],
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    });
  }
  return out;
}
function parseAssets(value: unknown): GoalReportAsset[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GoalReportAsset[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (
      typeof item.screenshotId !== "string" ||
      typeof item.assetId !== "string" ||
      typeof item.evidenceId !== "string" ||
      typeof item.relativePath !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.bytes !== "number" ||
      typeof item.sha256 !== "string"
    ) continue;
    out.push({
      screenshotId: item.screenshotId.trim(),
      assetId: item.assetId.trim(),
      evidenceId: item.evidenceId.trim(),
      relativePath: item.relativePath.trim(),
      mimeType: item.mimeType.trim(),
      bytes: item.bytes,
      sha256: item.sha256.trim(),
    });
  }
  return out;
}

/** A header context line; dropped entirely when it carries nothing. */
function parseDeliveryContext(value: unknown): GoalReportDeliveryContext | undefined {
  if (!isRecord(value)) return undefined;
  const context: GoalReportDeliveryContext = {};
  for (const key of ["sourceLabel", "targetVersion", "revisionLabel"] as const) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) context[key] = raw.trim();
  }
  if (Array.isArray(value.evidenceRefs)) {
    const refs = value.evidenceRefs.filter((ref): ref is string => typeof ref === "string" && ref.trim().length > 0);
    if (refs.length > 0) context.evidenceRefs = refs;
  }
  return Object.keys(context).length > 0 ? context : undefined;
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

  const draftResult = validateGoalReportDraft(input, { hostOwned: "accept" });
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
        ...(input.execution.timingSource === "turn" || input.execution.timingSource === "unavailable"
          ? { timingSource: input.execution.timingSource }
          : {}),
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
      ...(validated.deliveryContext ? { deliveryContext: validated.deliveryContext } : {}),
      ...(validated.conclusion ? { conclusion: validated.conclusion } : {}),
      ...(validated.screenshots ? { screenshots: validated.screenshots } : {}),
      ...(input.assets ? { assets: parseAssets(input.assets) } : {}),
      evidenceResolution: parseEvidenceResolution(input.evidenceResolution),
      checkObservations: parseCheckObservations(input.checkObservations),
    },
  };
}
