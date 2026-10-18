import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { createGoalActivityReader, type GoalActivityReader, type GoalActivityState } from "../stores/runtime/goal-activity-runtime";

const readers = new Map<string, GoalActivityReader>();
const empty: GoalActivityState = { progress: null, loading: false, error: null, reportState: "none", reportError: null, reportKnown: false };

export function useGoalActivity(sessionId: string, executionId: string | undefined, enabled = true) {
  const reader = useMemo(() => {
    if (!enabled || !executionId) return null;
    const key = `${sessionId}\u0000${executionId}`;
    let current = readers.get(key);
    if (!current) {
      current = createGoalActivityReader(sessionId, executionId, {
        readProgress: api.getGoalProgress,
        readReport: api.getGoalReport,
        onProgress: api.onGoalProgressChanged,
        onReport: api.onGoalReportChanged,
        readExecution: api.goalExecutionGet,
        onExecution: api.onGoalExecutionChanged,
        onHostRestart: (listener) => api.onHostStatus((event) => { if (event.ok && event.restarted) listener(); }),
        onFocus: (listener) => {
          window.addEventListener("focus", listener);
          return () => window.removeEventListener("focus", listener);
        },
        onIdle: (isIdle) => queueMicrotask(() => {
          if (isIdle() && readers.get(key) === current) readers.delete(key);
        }),
      });
      readers.set(key, current);
    }
    return current;
  }, [sessionId, executionId, enabled]);
  const subscribe = useCallback((listener: () => void) => reader?.subscribe(listener) ?? (() => undefined), [reader]);
  const getState = useCallback(() => reader?.getState() ?? empty, [reader]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  const refresh = useCallback(() => reader?.refresh() ?? Promise.resolve(), [reader]);
  return { ...state, reportReady: state.reportState === "ready" || state.reportState === "fallback", refresh };
}
