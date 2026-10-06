import type { AgentEventEnvelope, SessionDetail, UiMessage } from "@pi-desktop/shared";
import type { SessionHistoryReadOptions } from "../../lib/api";
import { mergeLiveSessionMessages, upsertLiveSessionMessage } from "../../lib/session-transcript";
import { boundTeamMemberMessages, projectTeamMemberEvent, teamMemberVisibleMessageMatches } from "../../lib/team-member-transcript-overlay";

export type TeamMemberTranscriptState = {
  messages: UiMessage[]; loading: boolean; error: string | null; truncated: boolean; lastSuccessAt: number | null;
};
export type TeamMemberTranscriptDeps = {
  getSession: (id: string, options: SessionHistoryReadOptions) => Promise<{ session: SessionDetail | null }>;
  readOptions: SessionHistoryReadOptions;
  subscribeAgentEvent: (listener: (envelope: AgentEventEnvelope) => void) => () => void;
  subscribeHostRestart: (listener: () => void) => () => void;
  addFocusListener: (listener: () => void) => () => void;
  now?: () => number;
};

export function createTeamMemberTranscriptController(memberSessionId: string, deps: TeamMemberTranscriptDeps) {
  let state: TeamMemberTranscriptState = { messages: [], loading: true, error: null, truncated: false, lastSuccessAt: null };
  const listeners = new Set<() => void>();
  const limit = Math.min(200, deps.readOptions.messageLimit ?? 200);
  const contentLimit = Math.min(64 * 1024, deps.readOptions.contentLimit ?? 64 * 1024);
  const live = new Map<string, { message: UiMessage; revision: number; partial: boolean }>();
  const removed = new Set<string>();
  let revision = 0;
  let active = false;
  let generation = 0;
  let hostEpoch = 0;
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  let localTruncated = false;
  const bound = (messages: UiMessage[]) => boundTeamMemberMessages(messages, limit, contentLimit);
  const publish = (next: TeamMemberTranscriptState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const refresh = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (inFlight) { dirty = true; return inFlight; }
    const readGeneration = generation;
    const readRevision = revision;
    const readHostEpoch = hostEpoch;
    publish({ ...state, loading: true });
    inFlight = Promise.resolve().then(() => {
      if (!active || readGeneration !== generation) return null;
      return deps.getSession(memberSessionId, deps.readOptions);
    }).then((result) => {
      if (!result || !active || readGeneration !== generation || readHostEpoch !== hostEpoch) return;
      const bounded = bound(result.session?.messages ?? []);
      for (const [id, entry] of live) {
        const durable = bounded.messages.find((message) => message.id === id);
        const windowStart = bounded.messages[0]?.createdAt;
        if (!durable && windowStart && (bounded.messages.length === limit || result.session?.hasMoreBefore) && entry.message.createdAt < windowStart) {
          live.delete(id);
          continue;
        }
        if (entry.revision <= readRevision && durable && teamMemberVisibleMessageMatches(durable, entry.message, entry.partial)) live.delete(id);
      }
      const overlays = [...live.values()].map((entry) => {
        const durable = entry.partial && bounded.messages.find((message) => message.id === entry.message.id);
        // A tab can miss tool_start. Preserve persisted name/arguments while
        // the final event still takes precedence over a stale running row.
        return durable ? { ...durable, ...entry.message } : entry.message;
      });
      let merged = mergeLiveSessionMessages(bounded.messages.filter((message) => !removed.has(message.id)), overlays);
      for (const message of overlays) merged = upsertLiveSessionMessage(merged, message);
      const next = bound(merged);
      publish({ messages: next.messages, loading: false, error: null,
        truncated: result.session?.hasMoreBefore === true || bounded.messagesTruncated || next.messagesTruncated || localTruncated,
        lastSuccessAt: (deps.now ?? Date.now)() });
    }).catch((error: unknown) => {
      if (active && readGeneration === generation && readHostEpoch === hostEpoch) publish({ ...state, loading: false, error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      if (readGeneration !== generation) return;
      inFlight = null;
      if (active && dirty) { dirty = false; void refresh(); }
    });
    return inFlight;
  };
  const invalidate = () => {
    if (!active) return;
    if (inFlight) dirty = true;
    else void refresh();
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, invalidate,
    start: () => {
      if (active) return () => {};
      active = true;
      const ownerGeneration = ++generation;
      const unsubscribeEvents = deps.subscribeAgentEvent((envelope) => {
        if (!active || ownerGeneration !== generation || envelope.sessionId !== memberSessionId) return;
        if (!["message_end", "tool_start", "tool_end", "user_message_persisted", "agent_end"].includes(envelope.event.type)) return;
        revision++;
        const projected = projectTeamMemberEvent(state.messages, envelope, contentLimit);
        const bounded = bound(projected.messages);
        localTruncated ||= bounded.messagesTruncated;
        for (const id of projected.removed) { live.delete(id); removed.add(id); }
        for (const item of projected.changed) {
          const message = bound([item]).messages[0];
          removed.delete(message.id);
          live.set(message.id, { message, revision, partial: projected.partial });
        }
        while (live.size > limit) { live.delete(live.keys().next().value!); localTruncated = true; }
        while (removed.size > limit * 2) removed.delete(removed.values().next().value!);
        publish({ ...state, messages: bounded.messages, truncated: state.truncated || localTruncated });
        invalidate();
      });
      const unsubscribeHost = deps.subscribeHostRestart(() => {
        if (!active || ownerGeneration !== generation) return;
        hostEpoch++;
        const unfinished = new Set<string>();
        for (const [id, entry] of live) {
          if (entry.message.status === "streaming" || entry.message.toolStatus === "running") {
            unfinished.add(id);
            live.delete(id);
          }
        }
        if (unfinished.size) publish({ ...state, messages: state.messages.filter((message) => !unfinished.has(message.id)) });
        invalidate();
      });
      const unsubscribeFocus = deps.addFocusListener(() => { if (active && ownerGeneration === generation) invalidate(); });
      void refresh();
      return () => {
        if (ownerGeneration !== generation) return;
        active = false;
        generation++;
        unsubscribeEvents(); unsubscribeHost(); unsubscribeFocus();
        inFlight = null; dirty = false;
        live.clear(); removed.clear(); localTruncated = false;
      };
    },
  };
}
