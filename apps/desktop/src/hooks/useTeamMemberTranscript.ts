import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import { SESSION_TRANSCRIPT_CONTENT_LIMIT } from "../stores/app-store";
import { createTeamMemberTranscriptController } from "../stores/runtime/team-member-transcript-runtime";

export function useTeamMemberTranscript(memberSessionId: string, { snapshotRevision }: { snapshotRevision?: number } = {}) {
  const controller = useMemo(() => createTeamMemberTranscriptController(memberSessionId, {
    getSession: api.getSession,
    readOptions: { messageLimit: 200, contentLimit: SESSION_TRANSCRIPT_CONTENT_LIMIT },
    subscribeAgentEvent: api.onAgentEvent,
    subscribeHostRestart: (listener) => api.onHostStatus((event) => { if (event.ok && event.restarted) listener(); }),
    addFocusListener: (listener) => {
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
  }), [memberSessionId]);
  useEffect(() => controller.start(), [controller]);
  useEffect(() => { controller.invalidate(); }, [controller, snapshotRevision]);
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  return useSyncExternalStore(subscribe, controller.getState, controller.getState);
}
