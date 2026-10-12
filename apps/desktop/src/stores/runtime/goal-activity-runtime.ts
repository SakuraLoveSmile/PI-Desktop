import type { GoalProgressChangedEvent, GoalProgressSnapshot, GoalReportChangedEvent } from "@pi-desktop/shared";
import { shouldAcceptGoalProgressSnapshot } from "../../lib/goal-progress-presentation";

export type GoalActivityReportState = "none" | "generating" | "ready" | "fallback" | "failed";
export type GoalActivityState = {
  progress: GoalProgressSnapshot | null;
  loading: boolean;
  error: string | null;
  reportState: GoalActivityReportState;
  reportError: string | null;
  reportKnown: boolean;
};
export type GoalActivityTransport = {
  readProgress: (params: { sessionId: string; executionId: string }) => Promise<{ progress: GoalProgressSnapshot | null }>;
  readReport: (params: { sessionId: string; executionId: string }) => Promise<{ state: string; report: unknown; detail?: string }>;
  onProgress: (listener: (event: GoalProgressChangedEvent) => void) => () => void;
  onReport: (listener: (event: GoalReportChangedEvent) => void) => () => void;
  onHostRestart?: (listener: () => void) => () => void;
  onFocus?: (listener: () => void) => () => void;
  onIdle?: (isIdle: () => boolean) => void;
};

const initial = (): GoalActivityState => ({ progress: null, loading: true, error: null, reportState: "none", reportError: null, reportKnown: false });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A single Host-backed view per session/execution, shared by capsule and Overview. */
export function createGoalActivityReader(sessionId: string, executionId: string, transport: GoalActivityTransport) {
  let state = initial();
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let progressSequence = 0;
  let reportSequence = 0;
  let remove: (() => void)[] = [];
  const matches = (value: { sessionId: string; executionId: string }) => value.sessionId === sessionId && value.executionId === executionId;
  const publish = (next: GoalActivityState) => { state = next; for (const listener of listeners) listener(); };
  const refreshProgress = async () => {
    if (!active) return;
    const currentGeneration = generation;
    const sequence = ++progressSequence;
    try {
      const { progress } = await transport.readProgress({ sessionId, executionId });
      if (!active || generation !== currentGeneration || sequence !== progressSequence) return;
      if (progress && !matches(progress)) throw new Error("GOAL_PROGRESS_SCOPE_MISMATCH");
      publish({ ...state, progress: shouldAcceptGoalProgressSnapshot(state.progress, progress) ? progress : state.progress, loading: false, error: null });
    } catch (error: unknown) {
      if (active && generation === currentGeneration && sequence === progressSequence) publish({ ...state, loading: false, error: message(error) });
    }
  };
  const refreshReport = async () => {
    if (!active) return;
    const currentGeneration = generation;
    const sequence = ++reportSequence;
    try {
      const response = await transport.readReport({ sessionId, executionId });
      if (!active || generation !== currentGeneration || sequence !== reportSequence) return;
      let reportState: GoalActivityReportState;
      if (response.state === "ready") {
        const report = response.report;
        if (!record(report) || report.sessionId !== sessionId || report.executionId !== executionId || !record(report.integrity)) {
          throw new Error("GOAL_REPORT_SCOPE_MISMATCH");
        }
        if (report.integrity.kind !== "structured" && report.integrity.kind !== "fallback") throw new Error("GOAL_REPORT_INVALID_INTEGRITY");
        reportState = report.integrity.kind === "fallback" ? "fallback" : "ready";
      } else if (response.state === "draft" || response.state === "pending") reportState = "generating";
      else if (response.state === "not_found") reportState = "none";
      else if (response.state === "failed" || response.state === "corrupt" || response.state === "truncated") reportState = "failed";
      else throw new Error("GOAL_REPORT_INVALID_STATE");
      publish({ ...state, reportState, reportKnown: true, reportError: reportState === "failed" ? response.detail ?? null : null });
    } catch (error: unknown) {
      if (active && generation === currentGeneration && sequence === reportSequence) publish({ ...state, reportError: message(error) });
    }
  };
  const refresh = async () => { if (active) await Promise.all([refreshProgress(), refreshReport()]); };
  return {
    getState: () => state,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!active) {
        active = true;
        generation += 1;
        remove = [
          transport.onProgress((event) => { if (matches(event) && (!state.progress || event.revision > state.progress.revision)) void refreshProgress(); }),
          transport.onReport((event) => { if (matches(event)) void refreshReport(); }),
        ];
        const restart = transport.onHostRestart?.(() => {
          generation += 1;
          // Durable revisions stay monotonic; old requests no longer own state.
          void refresh();
        });
        const focus = transport.onFocus?.(() => { void refresh(); });
        if (restart) remove.push(restart);
        if (focus) remove.push(focus);
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          active = false;
          generation += 1;
          for (const unsubscribe of remove) unsubscribe();
          remove = [];
          state = initial();
          transport.onIdle?.(() => !active && listeners.size === 0);
        }
      };
    },
  };
}

export type GoalActivityReader = ReturnType<typeof createGoalActivityReader>;
