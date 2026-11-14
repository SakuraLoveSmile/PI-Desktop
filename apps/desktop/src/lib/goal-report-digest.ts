import type {
  GoalReport,
  GoalReportCheck,
  GoalReportCheckObservation,
  GoalReportEvidence,
  GoalReportEvidenceResolution,
  GoalReportMetric,
} from "@pi-desktop/shared";

/**
 * Pure read-side summaries for the Goal report first screen. They only
 * condense what the report and the Host already recorded; they never invent
 * a number the report cannot back.
 */

/** Metrics and next steps shown before the "full report" fold. */
export const FIRST_SCREEN_METRICS = 3;
export const FIRST_SCREEN_NEXT_STEPS = 3;

export type GoalReportTiming = { activeMs: number; spanMs: number; waitMs: number };

/**
 * Active working time is the sum of the execution segments. The wall-clock
 * span (first start to completion) also contains every wait for the user, so
 * it is only the answer when the Host recorded no segments. An open last
 * segment ends at the completion time; a closed-early segment with no end
 * contributes nothing rather than guessing that the wait was work.
 */
export function goalReportTiming(report: GoalReport): GoalReportTiming | null {
  const { startedAt, completedAt, timingSource } = report.execution;
  if (timingSource !== "turn" || !startedAt || !completedAt) return null;
  const spanMs = Math.max(0, completedAt - startedAt);
  const segments = report.segments ?? [];
  if (segments.length === 0) return { activeMs: spanMs, spanMs, waitMs: 0 };
  const lastIndex = segments.length - 1;
  const summed = segments.reduce((total, segment, index) => {
    const end = segment.endedAt ?? (index === lastIndex ? completedAt : segment.startedAt);
    return total + Math.max(0, end - segment.startedAt);
  }, 0);
  const activeMs = Math.min(summed, spanMs);
  return { activeMs, spanMs, waitMs: spanMs - activeMs };
}

export function metricTone(metric: GoalReportMetric, report: GoalReport): "neutral" | "success" | "error" {
  const refs = new Set(metric.evidenceRefs ?? []);
  const observations = (report.checkObservations ?? []).filter((observation) =>
    observation.evidenceIds.some((id) => refs.has(id)));
  if (observations.some((observation) => observation.result === "failed")) return "error";
  const recordedRefs = new Set((report.evidenceResolution ?? [])
    .filter((resolution) => resolution.state === "recorded")
    .map((resolution) => resolution.evidenceId));
  if ([...refs].some((ref) => !recordedRefs.has(ref))) return "neutral";
  return observations.length > 0 && observations.every((observation) => observation.result === "passed")
    ? "success" : "neutral";
}

/** The model and the Host both gave a verdict on one check and they differ. */
export function checkContradicts(check: GoalReportCheck, observation: GoalReportCheckObservation | undefined): boolean {
  return observation !== undefined && check.result !== "inconclusive"
    && observation.result !== "inconclusive" && check.result !== observation.result;
}

export type ChecksDigest = {
  /** Checks that actually ran; the denominator of every ratio. */
  executed: number;
  /** Executed checks the model reports as passed. */
  passed: number;
  /** Declared checks that were not run or were blocked. */
  skipped: number;
  /** Executed checks the Host has an observation for. */
  hostObserved: number;
  /** Of those, the Host observed a pass. */
  hostPassed: number;
  conflicts: number;
};

export function summarizeChecks(report: GoalReport): ChecksDigest {
  const observations = new Map((report.checkObservations ?? []).map((observation) => [observation.checkId, observation]));
  const digest: ChecksDigest = { executed: 0, passed: 0, skipped: 0, hostObserved: 0, hostPassed: 0, conflicts: 0 };
  for (const check of report.checks ?? []) {
    if (check.disposition === "not_run" || check.disposition === "blocked") {
      digest.skipped += 1;
      continue;
    }
    digest.executed += 1;
    if (check.result === "passed") digest.passed += 1;
    const observation = observations.get(check.id);
    if (!observation) continue;
    digest.hostObserved += 1;
    if (observation.result === "passed") digest.hostPassed += 1;
    if (checkContradicts(check, observation)) digest.conflicts += 1;
  }
  return digest;
}

export function summarizeCriteria(report: GoalReport): { total: number; met: number } {
  const criteria = report.criteria ?? [];
  return { total: criteria.length, met: criteria.filter((criterion) => criterion.verdict === "met").length };
}

export type HostLineTone = "neutral" | "warn" | "error";
export type HostLineItem =
  | { kind: "checks"; tone: HostLineTone; passed: number; total: number }
  | { kind: "notRun"; tone: HostLineTone; n: number }
  | { kind: "hostVerified"; tone: HostLineTone; passed: number; total: number }
  | { kind: "hostNotObserved"; tone: HostLineTone }
  | { kind: "hostConflict"; tone: HostLineTone; n: number }
  | { kind: "criteria"; tone: HostLineTone; met: number; total: number }
  | { kind: "active"; tone: HostLineTone; ms: number }
  | { kind: "blocks"; tone: HostLineTone; n: number; resumed: boolean }
  | { kind: "limitations"; tone: HostLineTone; n: number };

/**
 * The one muted line under the result: what the Host can vouch for first,
 * then what the model only claims. Limitations appear here only when no next
 * steps block exists to carry the pointer, so the first screen always says
 * that they exist exactly once.
 */
export function hostLine(report: GoalReport): HostLineItem[] {
  const items: HostLineItem[] = [];
  const checks = summarizeChecks(report);
  if (checks.executed > 0) {
    items.push({ kind: "checks", tone: checks.passed === checks.executed ? "neutral" : "warn", passed: checks.passed, total: checks.executed });
  }
  if (checks.skipped > 0) items.push({ kind: "notRun", tone: "warn", n: checks.skipped });
  if (checks.executed > 0) {
    items.push(checks.hostObserved === 0
      ? { kind: "hostNotObserved", tone: "warn" }
      : { kind: "hostVerified", tone: checks.hostPassed === checks.executed ? "neutral" : "warn", passed: checks.hostPassed, total: checks.executed });
  }
  if (checks.conflicts > 0) items.push({ kind: "hostConflict", tone: "error", n: checks.conflicts });
  const criteria = summarizeCriteria(report);
  if (criteria.total > 0) {
    items.push({ kind: "criteria", tone: criteria.met === criteria.total ? "neutral" : "warn", met: criteria.met, total: criteria.total });
  }
  const timing = goalReportTiming(report);
  if (timing) items.push({ kind: "active", tone: "neutral", ms: timing.activeMs });
  const blocks = report.blocks?.length ?? 0;
  if (blocks > 0) items.push({ kind: "blocks", tone: "neutral", n: blocks, resumed: report.closure !== "user_accepted" });
  const limitations = report.limitations?.length ?? 0;
  if ((report.nextSteps?.length ?? 0) === 0 && limitations > 0) items.push({ kind: "limitations", tone: "neutral", n: limitations });
  return items;
}

export type EvidenceDisplay = {
  /** The Host's recorded state; a missing resolution is "unknown", never "recorded". */
  state: "recorded" | "unresolved" | "unknown";
  /**
   * The Host resolves references against messages, approvals and turns, so a
   * file reference can never resolve. Showing it as a missing record would be a
   * false alarm; only that exact combination is neutral.
   */
  untracked: boolean;
};

export function evidenceDisplay(evidence: GoalReportEvidence, resolution: GoalReportEvidenceResolution | undefined): EvidenceDisplay {
  const state = resolution?.state ?? "unknown";
  return { state, untracked: state === "unresolved" && evidence.kind === "file" };
}
