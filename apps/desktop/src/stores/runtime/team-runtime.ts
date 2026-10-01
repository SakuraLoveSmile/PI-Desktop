import type { TeamChangedEvent, TeamSnapshot } from "@pi-desktop/shared";

export type TeamSnapshotState = {
  snapshot: TeamSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccessAt: number | null;
};

export type TeamSnapshotTransport = {
  read: (teamSessionId: string) => Promise<TeamSnapshot>;
  subscribe: (listener: (event: TeamChangedEvent) => void) => () => void;
  onHostRestart?: (listener: () => void) => () => void;
  onFocus?: (listener: () => void) => () => void;
  onIdle?: (isIdle: () => boolean) => void;
};

/** One reader per visible Team, shared by Overview, board and sidebar. */
export function createTeamSnapshotReader(
  teamSessionId: string,
  transport: TeamSnapshotTransport,
  clock: {
    now: () => number;
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  } = {
    now: Date.now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
  },
) {
  let state: TeamSnapshotState = { snapshot: null, loading: true, error: null, lastSuccessAt: null };
  const listeners = new Set<() => void>();
  let generation = 0;
  let active = false;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeHostRestart: (() => void) | undefined;
  let unsubscribeFocus: (() => void) | undefined;
  let dissolved = false;

  const publish = (next: TeamSnapshotState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (!active || dissolved) return Promise.resolve();
    if (timer !== undefined) { clock.clearTimeout(timer); timer = undefined; }
    if (inFlight) { dirty = true; return inFlight; }
    const requestGeneration = generation;
    publish({ ...state, loading: true });
    inFlight = transport.read(teamSessionId).then((snapshot) => {
      if (!active || requestGeneration !== generation) return;
      if (snapshot.teamSessionId !== teamSessionId) throw new Error("TEAM_SCOPE_MISMATCH");
      if (dissolved) return;
      if (state.snapshot && snapshot.revision < state.snapshot.revision) {
        publish({ ...state, loading: false });
        return;
      }
      publish({ snapshot, loading: false, error: null, lastSuccessAt: clock.now() });
    }).catch((error: unknown) => {
      if (active && requestGeneration === generation) {
        publish({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    }).finally(() => {
      if (requestGeneration !== generation) return;
      inFlight = null;
      if (active && !dissolved && dirty) { dirty = false; void refresh(); }
    });
    return inFlight;
  };
  const invalidate = () => {
    if (!active || dissolved) return;
    if (inFlight) { dirty = true; return; }
    // A leading bounded window, not a trailing debounce that can starve.
    if (timer === undefined) timer = clock.setTimeout(() => { timer = undefined; void refresh(); }, 200);
  };
  const recover = () => {
    if (!active) return;
    if (recoveryTimer !== undefined) clock.clearTimeout(recoveryTimer);
    recoveryTimer = clock.setTimeout(() => {
      recoveryTimer = undefined;
      if (!active) return;
      void refresh();
      recover();
    }, 3000);
  };
  const stop = () => {
    active = false;
    generation += 1;
    unsubscribe?.();
    unsubscribeHostRestart?.();
    unsubscribeFocus?.();
    unsubscribe = undefined;
    unsubscribeHostRestart = undefined;
    unsubscribeFocus = undefined;
    if (timer !== undefined) clock.clearTimeout(timer);
    if (recoveryTimer !== undefined) clock.clearTimeout(recoveryTimer);
    timer = undefined;
    recoveryTimer = undefined;
    inFlight = null;
    dirty = false;
    dissolved = false;
    state = { snapshot: null, loading: false, error: null, lastSuccessAt: null };
    transport.onIdle?.(() => !active && listeners.size === 0);
  };
  return {
    getState: () => state,
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!active) {
        active = true;
        generation += 1;
        unsubscribe = transport.subscribe((event) => {
          if (event.teamSessionId !== teamSessionId) return;
          if (event.reason === "dissolved") {
            dissolved = true;
            generation += 1;
            inFlight = null;
            dirty = false;
            if (timer !== undefined) clock.clearTimeout(timer);
            timer = undefined;
            if (recoveryTimer !== undefined) clock.clearTimeout(recoveryTimer);
            recoveryTimer = undefined;
            publish({ snapshot: null, loading: false, error: "TEAM_DISSOLVED", lastSuccessAt: null });
            return;
          }
          invalidate();
        });
        unsubscribeHostRestart = transport.onHostRestart?.(() => {
          // A restarted Host may restore a snapshot with a lower revision.
          generation += 1;
          inFlight = null;
          dirty = false;
          dissolved = false;
          publish({ snapshot: null, loading: true, error: null, lastSuccessAt: null });
          void refresh();
          recover();
        });
        unsubscribeFocus = transport.onFocus?.(() => { void refresh(); });
        void refresh();
        recover();
      }
      return () => { listeners.delete(listener); if (listeners.size === 0) stop(); };
    },
  };
}

export type TeamSnapshotReader = ReturnType<typeof createTeamSnapshotReader>;
