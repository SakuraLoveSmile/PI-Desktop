import type { GoalHold, PlanExecution } from "@pi-desktop/shared";

export type GoalExecutionSnapshot = { execution?: PlanExecution; hold?: GoalHold; title?: string };
export type GoalModelOverride = { providerId: string; modelId: string };
export type BlockedGoalTransport = {
  read: (params: { sessionId: string }) => Promise<GoalExecutionSnapshot>;
  resume: (params: { sessionId: string; executionId: string; expectedVersion: number; message?: string; modelOverride?: GoalModelOverride }) => Promise<GoalExecutionSnapshot>;
  close: (params: { sessionId: string; executionId: string; expectedVersion: number; action: "accept" | "abandon" }) => Promise<GoalExecutionSnapshot>;
  onChanged: (listener: (event: { sessionId: string }) => void) => () => void;
  onRestart: (listener: () => void) => () => void;
  onIdle?: (isIdle: () => boolean) => void;
};
export type BlockedGoalState = GoalExecutionSnapshot & { loading: boolean; busy: boolean; error: string | null; optedOut: boolean };

/** Owns the durable held Goal, shared by its transcript card and Composer. */
export function createBlockedGoalReader(sessionId: string, transport: BlockedGoalTransport, readOnly = false) {
  let state: BlockedGoalState = { loading: true, busy: false, error: null, optedOut: false };
  let active = false;
  let sequence = 0;
  let remove: (() => void)[] = [];
  const listeners = new Set<() => void>();
  const publish = (next: BlockedGoalState) => { state = next; for (const listener of listeners) listener(); };
  const apply = (snapshot: GoalExecutionSnapshot) => {
    if ((snapshot.hold && (snapshot.hold.sessionId !== sessionId || (snapshot.execution && snapshot.hold.executionId !== snapshot.execution.id))) ||
      (snapshot.execution && snapshot.execution.sessionId !== sessionId)) throw new Error("GOAL_EXECUTION_SCOPE_MISMATCH");
    if (snapshot.hold && state.hold?.executionId === snapshot.hold.executionId && snapshot.hold.version < state.hold.version) return;
    publish({ ...state, ...snapshot, execution: snapshot.execution, hold: snapshot.hold, title: snapshot.title,
      loading: false, error: null, optedOut: snapshot.hold?.executionId === state.hold?.executionId ? state.optedOut : false });
  };
  const refresh = async () => {
    if (!active) return;
    const request = ++sequence;
    try {
      const snapshot = await transport.read({ sessionId });
      if (active && sequence === request) apply(snapshot);
    } catch (error) {
      if (active && sequence === request) publish({ ...state, loading: false, error: error instanceof Error ? error.message : "GOAL_READ_FAILED" });
    }
  };
  const act = async (action: "resume" | "accept" | "abandon", message?: string, modelOverride?: GoalModelOverride) => {
    if (readOnly) throw new Error("GOAL_READ_ONLY");
    if (!state.hold || state.hold.state !== "blocked" || state.busy) throw new Error("GOAL_NOT_BLOCKED");
    const { executionId, version } = state.hold;
    const request = ++sequence;
    publish({ ...state, busy: true, error: null });
    try {
      const identity = { sessionId, executionId, expectedVersion: version };
      const snapshot = action === "resume" ? await transport.resume({ ...identity, message, modelOverride })
        : await transport.close({ ...identity, action });
      if (active && sequence === request) apply(snapshot);
      return snapshot;
    } catch (error) {
      // A competing close/resume may have won the CAS. Re-read before another action.
      await refresh();
      throw error;
    } finally {
      publish({ ...state, busy: false });
    }
  };
  return {
    getState: () => state,
    refresh,
    shouldResume: () => !readOnly && !state.optedOut && state.hold?.state === "blocked",
    dismiss: () => publish({ ...state, optedOut: true }),
    resume: (message?: string, modelOverride?: GoalModelOverride) => act("resume", message, modelOverride),
    close: (action: "accept" | "abandon") => act(action),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (!active) {
        active = true;
        remove = [transport.onChanged((event) => { if (event.sessionId === sessionId) void refresh(); }),
          transport.onRestart(() => { void refresh(); })];
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          active = false; sequence += 1; for (const off of remove) off(); remove = [];
          transport.onIdle?.(() => !active && !listeners.size);
        }
      };
    },
  };
}
