import { useEffect, useState } from "react";
import type { ContextInsightsRequest } from "@pi-desktop/shared";
import { selectLatestMainRequest } from "./composition";
import { observeContextInsights } from "./service";

/**
 * The breakdown is only needed while the popover is open, so the subscription
 * lives with it: a long tool loop keeps the segments live, and closing the panel
 * or switching sessions releases the host reads instead of leaking them.
 */
export function useLatestComposition(
  sessionId: string | undefined,
  open: boolean,
): ContextInsightsRequest | undefined {
  const [request, setRequest] = useState<ContextInsightsRequest | undefined>(undefined);

  useEffect(() => {
    setRequest(undefined);
    if (!open || !sessionId) return;
    const observer = observeContextInsights(
      sessionId,
      (snapshot) => setRequest(selectLatestMainRequest(snapshot.requests)),
      () => setRequest(undefined),
    );
    return () => observer.dispose();
  }, [open, sessionId]);

  return request;
}