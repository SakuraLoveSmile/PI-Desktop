import { useCallback, useEffect, useRef, useState } from "react";
import type { BackgroundProcessSummary } from "@pi-desktop/shared";
import { api } from "../../../lib/api";

/** Visible-session reads coalesce notifications and reject stale completions. */
export function useBackgroundProcessList(sessionId: string, enabled: boolean) {
  const [state, setState] = useState<{ processes: BackgroundProcessSummary[]; loading: boolean; error: string | null }>({ processes: [], loading: enabled, error: null });
  const owner = useRef(sessionId);
  const reader = useRef<(() => void) | null>(null);
  useEffect(() => {
    const sameSession = owner.current === sessionId;
    owner.current = sessionId;
    setState((current) => ({ processes: sameSession ? current.processes : [], loading: enabled, error: null }));
    if (!enabled) { reader.current = null; return; }
    let disposed = false;
    let inFlight = false;
    let dirty = false;
    const refresh = async () => {
      if (disposed) return;
      if (inFlight) { dirty = true; return; }
      inFlight = true;
      try {
        const { processes } = await api.listBackgroundProcesses(sessionId);
        if (!disposed) setState({ processes: processes.filter((process) => process.sessionId === sessionId), loading: false, error: null });
      } catch (error) {
        if (!disposed) setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        inFlight = false;
        if (!disposed && dirty) { dirty = false; void refresh(); }
      }
    };
    reader.current = () => { void refresh(); };
    const remove = api.onBackgroundProcessesChanged((event) => { if (event.sessionId === sessionId) void refresh(); });
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    const removeRestart = api.onHostStatus((event) => { if (event.ok) void refresh(); });
    void refresh();
    return () => {
      disposed = true;
      reader.current = null;
      remove(); removeRestart(); window.removeEventListener("focus", focus);
    };
  }, [sessionId, enabled]);
  const refresh = useCallback(() => reader.current?.(), []);
  return { ...state, processes: owner.current === sessionId ? state.processes : [], refresh };
}
