import type { SessionCollaborationSummary } from "@pi-desktop/shared";

const REFRESH_MS = 4_000;
const SLOW_READ_MS = 5_000;

/** One visible card owns one serial read loop. Disposal never schedules another read. */
export function observeSessionCollaboration({
  sessionId,
  read,
  onSummary,
  onUnavailable,
  isVisible = () => true,
}: {
  sessionId: string;
  read: (sessionId: string) => Promise<SessionCollaborationSummary>;
  onSummary: (summary: SessionCollaborationSummary) => void;
  onUnavailable: () => void;
  isVisible?: () => boolean;
}) {
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  const active = () => !disposed && isVisible();

  const refresh = async () => {
    if (!active()) return;
    slowTimer = setTimeout(() => {
      if (active()) onUnavailable();
    }, SLOW_READ_MS);
    try {
      const summary = await read(sessionId);
      if (!active()) return;
      if (summary.sessionId === sessionId) onSummary(summary);
      else onUnavailable();
    } catch {
      if (active()) onUnavailable();
    } finally {
      clearTimeout(slowTimer);
      slowTimer = undefined;
      // A slow read can show an unavailable state, but never starts overlapping requests.
      if (active()) refreshTimer = setTimeout(() => void refresh(), REFRESH_MS);
    }
  };

  void refresh();
  return () => {
    disposed = true;
    clearTimeout(refreshTimer);
    clearTimeout(slowTimer);
  };
}
