import {
  ErrorCodes,
  isSessionSummaryRefreshResult,
  isSessionSummaryState,
} from "@pi-desktop/shared";
import type {
  SessionSummaryNote,
  SessionSummaryRefreshResult,
  SessionSummaryState,
} from "@pi-desktop/shared";

export type SessionSummaryUiState = {
  /** The note the card shows: the Host's latest, unless the session was rewound past it. */
  note: SessionSummaryNote | null;
  /** A model call for this session is under way, asked for by the control or by a turn end. */
  refreshing: boolean;
  /** The Host or the session cannot hold a summary; nothing is read or asked again. */
  unsupported: boolean;
};

type Dependencies = {
  read: (sessionId: string) => Promise<SessionSummaryState>;
  refresh: (sessionId: string, force: boolean) => Promise<SessionSummaryRefreshResult>;
  /** A refresh the person asked for failed; an automatic one stays quiet and keeps the old text. */
  onManualFailure: (error: unknown) => void;
};

function isUnsupported(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === ErrorCodes.SESSION_SUMMARY_UNSUPPORTED) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /METHOD_NOT_FOUND|method not found|No handler registered.*sessionSummary/i.test(message);
}

/**
 * Owner of one session's summary card. It reads the stored note only while the pane is active, asks for a new one when
 * a turn of the shown session ends, and keeps the last note while the pane is hidden so the card does not flicker in
 * again. Every answer is tagged with the activation it was asked in: one that arrives after the pane closed, the setting
 * went off or the session changed reaches nothing. Merely opening a session never calls the model.
 */
export function createSessionSummaryController(sessionId: string, deps: Dependencies) {
  let state: SessionSummaryUiState = { note: null, refreshing: false, unsupported: false };
  let stored: SessionSummaryNote | null = null;
  let active = false;
  let epoch = 0;
  let flight: Promise<void> | null = null;
  let wasRunning: boolean | null = null;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<SessionSummaryUiState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const shown = (note: SessionSummaryNote | null) => (note && !note.diverged ? note : null);
  /** Another window or a late read may answer with an older record; a record of this session with a lower revision is ignored. */
  const adopt = (note: SessionSummaryNote | null) => {
    if (!note || note.sessionId !== sessionId) return;
    if (stored && note.revision < stored.revision) return;
    stored = note;
    publish({ note: shown(note) });
  };
  const fail = (error: unknown, current: number, manual: boolean) => {
    if (current !== epoch) return;
    if (isUnsupported(error)) publish({ unsupported: true, note: null });
    else if (manual) deps.onManualFailure(error);
  };

  const read = async (current: number) => {
    try {
      const answer = await deps.read(sessionId);
      if (current !== epoch) return;
      if (!isSessionSummaryState(answer)) throw new Error("Invalid session summary response");
      adopt(answer.summary);
    } catch (error) {
      // Reading is quiet: the card simply stays as it was.
      fail(error, current, false);
    }
  };

  const run = (force: boolean): Promise<void> => {
    if (flight) return flight;
    const current = epoch;
    publish({ refreshing: true });
    const started: Promise<void> = deps.refresh(sessionId, force).then((result) => {
      if (current !== epoch) return;
      if (!isSessionSummaryRefreshResult(result)) throw new Error("Invalid session summary response");
      // A skipped answer still carries the Host's latest note (another window may have written it first).
      adopt(result.summary);
    }).catch((error: unknown) => fail(error, current, force)).finally(() => {
      if (flight === started) flight = null;
      if (current === epoch) publish({ refreshing: false });
    });
    flight = started;
    return started;
  };

  const ready = () => active && !state.unsupported;

  return {
    getState: (): SessionSummaryUiState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** The pane is visible, the session supports a summary and the setting is on. Leaving drops every pending answer. */
    setActive(next: boolean): void {
      if (next === active) return;
      active = next;
      epoch += 1;
      if (!next) {
        flight = null;
        if (state.refreshing) publish({ refreshing: false });
        return;
      }
      if (!state.unsupported) void read(epoch);
    },
    /** `running` going from true to false is the end of a turn; only an active pane asks, and the Host decides whether it is time. */
    observeRunning(running: boolean): void {
      const ended = wasRunning === true && !running;
      wasRunning = running;
      if (ended && ready()) void run(false);
    },
    /** The refresh control: forced, and a second press while one runs does nothing. */
    refresh(): Promise<void> {
      if (!ready() || flight) return Promise.resolve();
      return run(true);
    },
  };
}

export type SessionSummaryController = ReturnType<typeof createSessionSummaryController>;
