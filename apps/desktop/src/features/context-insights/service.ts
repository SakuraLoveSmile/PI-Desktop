import type {
  ContextInsightsRequest,
  ContextInsightsSnapshot,
  SessionSummary,
} from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { hydrateCapturedRequest } from "./model";

export async function readContextInsights(
  sessionId: string,
  options: { includeContent?: boolean; requestId?: string } = { includeContent: false },
): Promise<ContextInsightsSnapshot> {
  return api.getContextInsights(sessionId, options);
}

/** A new selection/revision cancels the right to publish an older read. */
export async function readSelectedRequest(
  sessionId: string,
  metadata: ContextInsightsRequest,
  signal: AbortSignal,
) {
  const snapshot = await readContextInsights(sessionId, {
    requestId: metadata.id,
    includeContent: true,
  });
  if (signal.aborted || snapshot.sessionId !== sessionId) return undefined;
  return hydrateCapturedRequest(
    metadata,
    snapshot.requests.find((request) => request.id === metadata.id),
  );
}

/** A disposed or switched view cannot publish an older session's data. */
export function observeContextInsights(
  sessionId: string,
  publish: (snapshot: ContextInsightsSnapshot) => void,
  fail: (error: unknown) => void,
) {
  let disposed = false;
  let reading = false;
  let again = false;
  const refresh = async () => {
    if (disposed) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      const snapshot = await readContextInsights(sessionId);
      if (!disposed && snapshot.sessionId === sessionId) publish(snapshot);
    } catch (error) {
      if (!disposed) fail(error);
    } finally {
      reading = false;
      if (again && !disposed) {
        again = false;
        void refresh();
      }
    }
  };
  const unsubscribe = api.onAgentEvent((envelope) => {
    if (envelope.sessionId !== sessionId) return;
    const type = envelope.event.type;
    if (
      type === "context_insights" ||
      type === "compaction_end" ||
      type === "agent_end" ||
      type === "error"
    )
      void refresh();
  });
  const unsubscribePersisted = api.onContextInsightsChanged((event) => {
    if (event.sessionId === sessionId) void refresh();
  });
  void refresh();
  return {
    refresh,
    dispose: () => {
      disposed = true;
      unsubscribe();
      unsubscribePersisted();
    },
  };
}

/** Bounded metadata page; only four host reads are in flight, and cancellation stops new reads. */
export async function readOverviewSnapshots(
  sessions: SessionSummary[],
  signal: AbortSignal,
  publish: (snapshots: ContextInsightsSnapshot[]) => void,
) {
  let cursor = 0;
  const snapshots: ContextInsightsSnapshot[] = [];
  let failed = false;
  const worker = async () => {
    while (!signal.aborted && cursor < sessions.length) {
      const session = sessions[cursor++];
      try {
        const snapshot = await readContextInsights(session.id);
        if (signal.aborted) return;
        if (snapshot.sessionId === session.id) snapshots.push(snapshot);
        publish([...snapshots]);
      } catch {
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, worker));
  if (failed && !signal.aborted) throw new Error("Some context diagnostics are unavailable");
}
