import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { createSessionActivityReader, type SessionActivityState } from "../stores/runtime/session-activity-runtime";
const empty: SessionActivityState = { snapshot: null, loading: false, error: null, unsupported: false };

/** Hidden panes own no transport subscriptions; changing sessions creates a new reader. */
export function useSessionActivity(sessionId: string, enabled: boolean) {
  const reader = useMemo(() => enabled ? createSessionActivityReader(sessionId, {
    read: api.getSessionActivity,
    onChanged: api.onSessionActivityChanged,
    onRestart: (listener) => api.onHostStatus((event) => { if (event.ok && event.restarted) listener(); }),
    onFocus: (listener) => { window.addEventListener("focus", listener); return () => window.removeEventListener("focus", listener); },
  }) : null, [sessionId, enabled]);
  const subscribe = useCallback((listener: () => void) => reader?.subscribe(listener) ?? (() => {}), [reader]);
  const getState = useCallback(() => reader?.getState() ?? empty, [reader]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  const refresh = useCallback(() => reader?.refresh() ?? Promise.resolve(), [reader]);
  return { ...state, refresh };
}
