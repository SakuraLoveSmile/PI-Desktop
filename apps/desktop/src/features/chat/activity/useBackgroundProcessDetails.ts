import { useCallback, useEffect, useRef, useState } from "react";
import { backgroundProcessIsActive, type BackgroundProcessDetail } from "@pi-desktop/shared";
import { api } from "../../../lib/api";

type DetailState = {
  sessionId: string;
  id: string;
  detail: BackgroundProcessDetail | null;
  loading: boolean;
  stopping: boolean;
  error: string | null;
};

export function useBackgroundProcessDetails(sessionId: string, id: string, visible: boolean) {
  const [state, setState] = useState<DetailState | null>(null);
  const actions = useRef<{ refresh: () => void; stop: () => void } | null>(null);
  useEffect(() => {
    if (!visible || !sessionId || !id) { setState(null); return; }
    let alive = true;
    let request = 0;
    let mutation = 0;
    let stopPending = false;
    const initial: DetailState = { sessionId, id, detail: null, loading: true, stopping: false, error: null };
    let current = initial;
    const update = (patch: Partial<DetailState>) => {
      if (!alive) return;
      current = { ...current, ...patch };
      setState(current);
    };
    const refresh = async () => {
      if (!alive) return;
      const token = ++request;
      update({ loading: true, error: null });
      try {
        const detail = await api.readBackgroundProcess(sessionId, id);
        if (!alive || token !== request) return;
        if (detail.process.sessionId !== sessionId || detail.process.id !== id) throw new Error("Background process identity mismatch");
        update({ detail, loading: false });
      } catch (error) {
        if (!alive || token !== request) return;
        update({ loading: false, error: String(error) });
      }
    };
    const stop = async () => {
      if (!alive || stopPending || !current.detail || !backgroundProcessIsActive(current.detail.process.status)
        || current.detail.process.status === "stopping") return;
      const previousDetail = current.detail;
      const token = ++mutation;
      stopPending = true;
      ++request;
      update({ stopping: true, loading: false, error: null });
      try {
        const { process } = await api.stopBackgroundProcess(sessionId, id);
        if (!alive || token !== mutation) return;
        if (process.sessionId !== sessionId || process.id !== id) throw new Error("Background process identity mismatch");
        update({ detail: { ...previousDetail, process }, stopping: false });
        stopPending = false;
        void refresh();
      } catch (error) {
        if (!alive || token !== mutation) return;
        stopPending = false;
        update({ stopping: false, error: String(error) });
      }
    };
    actions.current = { refresh: () => { void refresh(); }, stop: () => { void stop(); } };
    setState(initial);
    const unsubscribe = api.onBackgroundProcessesChanged((event) => {
      if (event.sessionId === sessionId && event.id === id) void refresh();
    });
    const unsubscribeHost = api.onHostStatus((status) => {
      if (!status.ok || !status.restarted || status.component === "sidecar") return;
      // The restarted Host owns terminal recovery; pre-restart stop replies cannot override it.
      ++mutation;
      stopPending = false;
      update({ stopping: false });
      void refresh();
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    void refresh();
    return () => {
      alive = false; ++request; ++mutation; actions.current = null;
      unsubscribe(); unsubscribeHost(); window.removeEventListener("focus", onFocus);
    };
  }, [sessionId, id, visible]);
  const matching = visible && state?.sessionId === sessionId && state.id === id ? state : null;
  const refresh = useCallback(() => actions.current?.refresh(), []);
  const stop = useCallback(() => actions.current?.stop(), []);
  return { detail: matching?.detail ?? null, loading: matching?.loading ?? visible,
    stopping: matching?.stopping ?? false, error: matching?.error ?? null, refresh, stop };
}
