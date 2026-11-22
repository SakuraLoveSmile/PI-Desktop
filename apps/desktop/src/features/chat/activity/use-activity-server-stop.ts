import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../lib/api";

const NO_PENDING: ReadonlySet<string> = new Set();
/** A stop in flight is told apart by its session as well as its process. */
const requestKey = (sessionId: string, id: string) => `${sessionId}\u0000${id}`;

export type ActivityServerStop = {
  /** Asks the Host to stop the server, through the call the process details use. A second click while it runs does nothing. */
  stop: (id: string) => Promise<void>;
  /** Servers of this session whose stop has been asked for and not yet answered. */
  stopping: ReadonlySet<string>;
};

/**
 * One stop per process runs at a time: the ref refuses a second click in the same tick, before any render could hide the
 * button, and the state paints the spinner. An answer that arrives after the pane closed is dropped. A failure is
 * logged by name only and handed to `onFailed`, so the row can say so once.
 */
export function useActivityServerStop(sessionId: string, onStopped: () => void, onFailed: (id: string) => void): ActivityServerStop {
  const running = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(NO_PENDING);
  const mounted = useRef(true);
  const callbacks = useRef({ onStopped, onFailed });
  callbacks.current = { onStopped, onFailed };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const stop = useCallback(async (id: string) => {
    const key = requestKey(sessionId, id);
    if (running.current.has(key)) return;
    running.current.add(key);
    setPending(new Set(running.current));
    try {
      const { process } = await api.stopBackgroundProcess(sessionId, id);
      if (process.sessionId !== sessionId || process.id !== id) throw new Error("Background process identity mismatch");
      if (mounted.current) callbacks.current.onStopped();
    } catch (error) {
      console.warn("A background server could not be stopped", error instanceof Error ? error.name : "UnknownError");
      if (mounted.current) callbacks.current.onFailed(id);
    } finally {
      running.current.delete(key);
      if (mounted.current) setPending(new Set(running.current));
    }
  }, [sessionId]);
  const stopping = useMemo(() => {
    const prefix = requestKey(sessionId, "");
    return new Set([...pending].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
  }, [pending, sessionId]);
  return { stop, stopping };
}
