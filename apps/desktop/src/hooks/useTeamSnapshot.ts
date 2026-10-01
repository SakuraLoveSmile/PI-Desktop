import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { useAppStore } from "../stores/app-store";
import { createTeamSnapshotReader, type TeamSnapshotReader, type TeamSnapshotState } from "../stores/runtime/team-runtime";

const readers = new Map<string, TeamSnapshotReader>();
const empty: TeamSnapshotState = { snapshot: null, loading: false, error: null, lastSuccessAt: null };

export function useTeamSnapshot(teamSessionId: string | null | undefined, options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false && Boolean(teamSessionId);
  const reader = useMemo(() => {
    if (!enabled || !teamSessionId) return null;
    let current = readers.get(teamSessionId);
    if (!current) {
      current = createTeamSnapshotReader(teamSessionId, {
        read: api.getTeamSnapshot,
        subscribe: (listener) => api.onTeamChanged((event) => {
          if (event.teamSessionId === teamSessionId &&
            (event.reason === "member" || event.reason === "dissolved")) {
            void useAppStore.getState().refreshSessions();
          }
          listener(event);
        }),
        onHostRestart: (listener) => {
          const removeHost = api.onHostStatus((event) => { if (event.ok && event.restarted) listener(); });
          return removeHost;
        },
        onFocus: (listener) => {
          window.addEventListener("focus", listener);
          return () => window.removeEventListener("focus", listener);
        },
        onIdle: (isIdle) => {
          queueMicrotask(() => {
            if (isIdle() && readers.get(teamSessionId) === current) readers.delete(teamSessionId);
          });
        },
      });
      readers.set(teamSessionId, current);
    }
    return current;
  }, [enabled, teamSessionId]);
  const subscribe = useCallback((listener: () => void) =>
    enabled && reader ? reader.subscribe(listener) : () => undefined, [enabled, reader]);
  const getState = useCallback(() => enabled && reader ? reader.getState() : empty, [enabled, reader]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  const refresh = useCallback(() => reader?.refresh() ?? Promise.resolve(), [reader]);
  return { ...state, refresh };
}
