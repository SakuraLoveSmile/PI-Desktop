import { useEffect, useState } from "react";
import type { AgentEventEnvelope, SessionSummary } from "@pi-desktop/shared";
import { api } from "../lib/api";
import { useAppStore } from "../stores/app-store";

type SessionMetadataUpdater = (current: SessionSummary) => SessionSummary;

export type OverviewMetadataDependencies = {
  getSession: typeof api.getSession;
  getCurrentSession: () => SessionSummary | undefined;
  isCurrentSession: () => boolean;
  updateSession: (updater: SessionMetadataUpdater) => void;
  subscribeAgentEvent: (listener: (event: AgentEventEnvelope) => void) => () => void;
  subscribeSessionsChanged: (listener: () => void) => () => void;
  subscribePlansChanged: (listener: (sessionId: string) => void) => () => void;
  subscribeHostRestart: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  startInterval: (listener: () => void) => ReturnType<typeof setInterval>;
  stopInterval: (timer: ReturnType<typeof setInterval>) => void;
  isManualTitle: () => boolean;
  onError: (error: string | null) => void;
};

function timestamp(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameTeamRelation(a: SessionSummary["team"], b: SessionSummary["team"]): boolean {
  return a?.teamSessionId === b?.teamSessionId && a?.role === b?.role && a?.memberName === b?.memberName;
}

function mergeOverviewMetadata(
  before: SessionSummary,
  current: SessionSummary,
  incoming: SessionSummary,
  manualTitle: boolean,
): SessionSummary {
  const currentTimestamp = timestamp(current.updatedAt);
  const incomingTimestamp = timestamp(incoming.updatedAt);
  const newerProjection =
    (currentTimestamp !== null && incomingTimestamp !== null && currentTimestamp > incomingTimestamp) ||
    current.messageCount > incoming.messageCount;
  const preserve = <K extends keyof SessionSummary>(key: K) => current[key] !== before[key];

  return {
    ...current,
    title: manualTitle || preserve("title") ? current.title : incoming.title,
    messageCount: newerProjection ? current.messageCount : incoming.messageCount,
    projectPath: preserve("projectPath") ? current.projectPath : incoming.projectPath,
    providerId: preserve("providerId") ? current.providerId : incoming.providerId,
    modelId: preserve("modelId") ? current.modelId : incoming.modelId,
    mode: preserve("mode") ? current.mode : incoming.mode,
    thinkingLevel: preserve("thinkingLevel") ? current.thinkingLevel : incoming.thinkingLevel,
    permissionMode: preserve("permissionMode") ? current.permissionMode : incoming.permissionMode,
    executionProfile: preserve("executionProfile") ? current.executionProfile : incoming.executionProfile,
    updatedAt: newerProjection ? current.updatedAt : incoming.updatedAt,
    team: newerProjection || !sameTeamRelation(current.team, before.team)
      ? current.team
      : incoming.team,
  };
}

/** Owns one session's bounded metadata reads and all event/timer subscriptions. */
export function createOverviewMetadataController(
  sessionId: string,
  dependencies: OverviewMetadataDependencies,
) {
  let disposed = false;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const cleanups: Array<() => void> = [];

  const canRead = () => {
    const current = dependencies.getCurrentSession();
    return dependencies.isCurrentSession() &&
      current?.id === sessionId &&
      current.source === "desktop" &&
      current.capabilities?.canRefresh !== false;
  };

  const invalidate = () => {
    if (disposed || !canRead()) return;
    if (inFlight) {
      dirty = true;
      return;
    }
    void refresh();
  };

  const refresh = (): Promise<void> => {
    if (disposed || !canRead()) return Promise.resolve();
    const before = dependencies.getCurrentSession();
    if (!before) return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const { session } = await dependencies.getSession(sessionId, { messageLimit: 1 });
        if (!session || disposed || !dependencies.isCurrentSession()) return;
        dependencies.updateSession((current) =>
          current.id === sessionId
            ? mergeOverviewMetadata(before, current, session, dependencies.isManualTitle())
            : current,
        );
        dependencies.onError(null);
      } catch (cause: unknown) {
        if (!disposed && dependencies.isCurrentSession()) {
          dependencies.onError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        inFlight = null;
        if (!disposed && dirty && dependencies.isCurrentSession()) {
          dirty = false;
          invalidate();
        }
      }
    })();
    return inFlight;
  };

  const start = () => {
    if (disposed) return dispose;
    if (!canRead()) return dispose;
    cleanups.push(dependencies.subscribeAgentEvent((envelope) => {
      if (
        envelope.sessionId === sessionId &&
        ["agent_end", "message_end", "user_message_persisted"].includes(envelope.event.type)
      ) {
        invalidate();
      }
    }));
    cleanups.push(dependencies.subscribeSessionsChanged(invalidate));
    cleanups.push(dependencies.subscribePlansChanged((changedSessionId) => {
      if (changedSessionId === sessionId) invalidate();
    }));
    cleanups.push(dependencies.subscribeHostRestart(invalidate));
    cleanups.push(dependencies.addFocusListener(invalidate));
    timer = dependencies.startInterval(invalidate);
    void refresh();
    return dispose;
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    dirty = false;
    if (timer !== undefined) dependencies.stopInterval(timer);
    timer = undefined;
    for (const cleanup of cleanups.splice(0)) cleanup();
  }

  return { start, refresh, dispose };
}

/** Refresh canonical totals without replacing a paginated transcript. */
export function useOverviewMetadata(sessionId: string | null | undefined) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    if (!sessionId) return;
    const controller = createOverviewMetadataController(sessionId, {
      getSession: api.getSession,
      getCurrentSession: () => useAppStore.getState().sessions.find((session) => session.id === sessionId),
      isCurrentSession: () => useAppStore.getState().activeSessionId === sessionId,
      updateSession: (updater) => {
        useAppStore.setState((state) => ({
          sessions: state.sessions.map((current) =>
            current.id === sessionId ? updater(current) : current,
          ),
        }));
      },
      subscribeAgentEvent: (listener) => api.onAgentEvent(listener),
      subscribeSessionsChanged: (listener) => api.onSessionsChanged(listener),
      subscribePlansChanged: (listener) => api.onPlansChanged((event) => listener(event.sessionId)),
      subscribeHostRestart: (listener) => api.onHostStatus((event) => {
        if (event.ok && event.restarted) listener();
      }),
      addFocusListener: (listener) => {
        window.addEventListener("focus", listener);
        return () => window.removeEventListener("focus", listener);
      },
      startInterval: (listener) => setInterval(listener, 3000),
      stopInterval: (handle) => clearInterval(handle),
      isManualTitle: () => useAppStore.getState().sessionMeta[sessionId]?.manualTitle === true,
      onError: setError,
    });
    return controller.start();
  }, [sessionId]);
  return { error };
}
