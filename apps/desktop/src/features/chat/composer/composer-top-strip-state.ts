/**
 * The workspace strip above the input card. Idle runs keep it open; an active
 * run folds it to the branch. A manual expansion holds only for the run it was
 * made in, so the next run starts folded again.
 */
export type TopStripState = {
  /** The run state the strip was last anchored to. */
  running: boolean;
  /** The user's expansion while running; ignored while idle. */
  expandedWhileRunning: boolean;
};

export function initialTopStripState(running: boolean): TopStripState {
  return { running, expandedWhileRunning: false };
}

/** A run start or end drops a manual expansion; an unchanged run returns the same object. */
export function syncTopStripState(state: TopStripState, running: boolean): TopStripState {
  return state.running === running ? state : initialTopStripState(running);
}

export function topStripExpanded(state: TopStripState): boolean {
  return !state.running || state.expandedWhileRunning;
}

export function toggleTopStrip(state: TopStripState): TopStripState {
  return { running: state.running, expandedWhileRunning: !topStripExpanded(state) };
}
