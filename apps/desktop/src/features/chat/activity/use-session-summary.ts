import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";
import { createSessionSummaryController } from "../../../stores/runtime/session-summary-runtime";
import type { ActivitySummary } from "./activity-rail-types";

/**
 * The pinned summary of one session. The controller owns the reads and the single flight; this hook says when it may act:
 * only while the rail pane is visible, the session supports a summary and the setting is on. The card exists only while
 * there is a note to show, so a first run shows nothing until it finishes.
 */
export function useSessionSummary({ sessionId, visible, supported, running, onRefreshFailed }: {
  sessionId: string; visible: boolean; supported: boolean; running: boolean; onRefreshFailed: () => void;
}): ActivitySummary | undefined {
  const enabled = useAppStore((state) => state.settings?.autoSummarizeSessions !== false);
  const failed = useRef(onRefreshFailed);
  failed.current = onRefreshFailed;
  const controller = useMemo(() => createSessionSummaryController(sessionId, {
    read: api.getSessionSummary,
    refresh: api.refreshSessionSummary,
    onManualFailure: () => failed.current(),
  }), [sessionId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const active = visible && supported && enabled;
  useEffect(() => {
    controller.setActive(active);
    return () => controller.setActive(false);
  }, [controller, active]);
  useEffect(() => { controller.observeRunning(running); }, [controller, running]);
  if (!enabled || !supported || state.unsupported || !state.note) return undefined;
  return { text: state.note.text, updatedAt: state.note.updatedAt, refreshing: state.refreshing, onRefresh: () => void controller.refresh() };
}
