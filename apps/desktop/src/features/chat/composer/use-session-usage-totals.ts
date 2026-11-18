import { useEffect, useState } from "react";
import type { SessionUsageTotals } from "@pi-desktop/shared";
import { api } from "../../../lib/api";

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Cumulative session usage comes from the host turn ledger, never from the
 * loaded transcript page: the renderer only holds the newest 100 messages, so a
 * local sum would under-report a reopened long session. Reads coalesce while a
 * tool loop streams usage events, and a switched or unmounted consumer cannot
 * publish an older session's total.
 */
export function useSessionUsageTotals(
  sessionId: string | undefined,
): SessionUsageTotals | undefined {
  const [totals, setTotals] = useState<SessionUsageTotals | undefined>(undefined);

  useEffect(() => {
    setTotals(undefined);
    if (!sessionId) return;
    let disposed = false;
    let reading = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      if (disposed) return;
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        const next = await api.getSessionUsageTotals(sessionId);
        if (!disposed) setTotals(next);
      } catch {
        // An unavailable host leaves the strip on its unavailable figure rather
        // than inventing a total from the partial transcript.
      } finally {
        reading = false;
        if (again && !disposed) {
          again = false;
          void read();
        }
      }
    };

    void read();
    const unsubscribe = api.onAgentEvent((envelope) => {
      if (envelope.sessionId !== sessionId) return;
      const type = envelope.event.type;
      if (type !== "usage" && type !== "turn_end" && type !== "agent_end") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void read();
      }, REFRESH_DEBOUNCE_MS);
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [sessionId]);

  return totals;
}