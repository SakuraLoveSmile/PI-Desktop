import { useCallback, useEffect, useRef, useState } from "react";
import {
  createStartupWatchdog,
  type StartupPhase,
} from "../../lib/startup-watchdog";
import { useAppStore } from "../../stores/app-store";

const clockNow = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export type StartupWatchdogState = {
  /** Where the wait for the first state currently is. */
  phase: StartupPhase;
  /** Milliseconds waited so far, read on demand (never during render). */
  waitedMs: () => number;
  /**
   * Ask for the initial state again after a stalled boot. The watchdog restarts
   * with the attempt, so the retry gets its own full window before it is called
   * stalled again.
   */
  retry: () => void;
};

/**
 * Watch the initial-state wait and report it as it ages.
 *
 * The watchdog never cancels the startup it watches: a slow launch that does
 * finish still flips `ready` and takes the window over, which is why the phase
 * resets as soon as it does. Failure to reach the first state at all is the case
 * issue #831 reports, and that is the one the caller renders a recovery surface
 * for.
 */
export function useStartupWatchdog(ready: boolean): StartupWatchdogState {
  const [phase, setPhase] = useState<StartupPhase>("starting");
  const [attempt, setAttempt] = useState(0);
  const startedAtRef = useRef(clockNow());

  useEffect(() => {
    if (ready) {
      setPhase("starting");
      return;
    }
    startedAtRef.current = clockNow();
    const watchdog = createStartupWatchdog({
      onPhase: setPhase,
      scheduler: {
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
    watchdog.start();
    // The wait is over on either exit: the initial state arrived, the retry
    // restarted it, or the surface unmounted. Leaving either timer armed past
    // that would publish a phase for an app that already has data.
    return () => watchdog.stop();
  }, [ready, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
    void useAppStore.getState().bootstrap();
  }, []);

  const waitedMs = useCallback(() => clockNow() - startedAtRef.current, []);

  return { phase, waitedMs, retry };
}
