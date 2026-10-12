import { isSessionActivityPage } from "@pi-desktop/shared";
import type { SessionActivityChanged, SessionActivityPage, SessionActivitySnapshot } from "@pi-desktop/shared";

export type SessionActivityState = { snapshot: SessionActivitySnapshot | null; loading: boolean; error: string | null; unsupported: boolean };
type Dependencies = {
  read: (sessionId: string, offset: number) => Promise<{ activity: SessionActivityPage }>;
  onChanged: (listener: (event: SessionActivityChanged) => void) => () => void;
  onRestart: (listener: () => void) => () => void;
  onFocus: (listener: () => void) => () => void;
};
const groups = ["subagents", "changedFiles", "websites", "attachments"] as const;
const references = ["skills", "memory", "mcp"] as const;
function unsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /METHOD_NOT_FOUND|method not found|SESSION_ACTIVITY_UNSUPPORTED|No handler registered.*sessionActivity/i.test(message);
}

/** One visible owner; pages are published atomically and discarded across changes/restarts. */
export function createSessionActivityReader(sessionId: string, deps: Dependencies) {
  let state: SessionActivityState = { snapshot: null, loading: true, error: null, unsupported: false };
  const listeners = new Set<() => void>();
  let generation = 0;
  let dirty = false;
  let inFlight: Promise<void> | null = null;
  let cleanups: (() => void)[] = [];
  const publish = (next: SessionActivityState) => { state = next; for (const listener of listeners) listener(); };
  const read = async (epoch: number) => {
    while (listeners.size && generation === epoch) {
      dirty = false;
      try {
        let offset = 0;
        let merged: SessionActivityPage | null = null;
        for (;;) {
          const { activity: page } = await deps.read(sessionId, offset);
          if (!listeners.size || generation !== epoch) return;
          if (dirty) break;
          if (!isSessionActivityPage(page) || page.sessionId !== sessionId) throw new Error("Invalid session activity identity");
          if (!merged) merged = { ...page, references: { ...page.references } };
          else {
            if (page.revision !== merged.revision) { dirty = true; break; }
            merged.subagents = [...merged.subagents, ...page.subagents];
            merged.changedFiles = [...merged.changedFiles, ...page.changedFiles];
            merged.websites = [...merged.websites, ...page.websites];
            merged.attachments = [...merged.attachments, ...page.attachments];
            for (const key of references) merged.references[key] = [...merged.references[key], ...page.references[key]];
          }
          if (!page.hasMore) {
            for (const key of groups) if (merged[key].length !== page.totals[key]) throw new Error("Incomplete session activity page sequence");
            for (const key of references) if (merged.references[key].length !== page.totals[key]) throw new Error("Incomplete session activity references");
            publish({ snapshot: merged, loading: false, error: null, unsupported: false });
            return;
          }
          if (!Number.isSafeInteger(page.nextOffset) || (page.nextOffset ?? 0) <= offset) throw new Error("Invalid session activity cursor");
          offset = page.nextOffset as number;
        }
      } catch (error) {
        if (!listeners.size || generation !== epoch) return;
        if (!dirty) {
          publish({ ...state, loading: false, error: error instanceof Error ? error.message : String(error), unsupported: unsupported(error) });
          return;
        }
      }
      // A notification or changed revision invalidated the partial read. Coalesce
      // it into a new read rather than exposing an incomplete mixed snapshot.
    }
  };
  const refresh = (): Promise<void> => {
    if (!listeners.size) return Promise.resolve();
    if (inFlight) { dirty = true; return inFlight; }
    publish({ ...state, loading: true, error: null });
    const epoch = generation;
    const pending = read(epoch).finally(() => { if (inFlight === pending) { inFlight = null; if (dirty && listeners.size && generation === epoch) void refresh(); } });
    inFlight = pending;
    return pending;
  };
  return {
    getState: () => state,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        generation++;
        cleanups = [deps.onChanged((event) => { if (event.sessionId === sessionId) void refresh(); }),
          deps.onRestart(() => { generation++; inFlight = null; void refresh(); }), deps.onFocus(() => { void refresh(); })];
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { generation++; inFlight = null; for (const cleanup of cleanups) cleanup(); cleanups = []; }
      };
    },
  };
}

/** Retain canonical history, plus pending/newer visible delegation state until persistence catches up. */
export function mergeActivitySubagents(host: SessionActivitySnapshot["subagents"], live: SessionActivitySnapshot["subagents"]): SessionActivitySnapshot["subagents"] {
  const result = new Map(host.map((item) => [item.delegationId, item]));
  for (const local of live) {
    const priorHandle = local.messageId ? [...result.values()].find((item) => item.messageId === local.messageId && item.toolCallId === local.toolCallId) : undefined;
    const persisted = result.get(local.delegationId) ?? priorHandle;
    if (priorHandle && priorHandle.delegationId !== local.delegationId) result.delete(priorHandle.delegationId);
    if (!persisted || priorHandle && priorHandle.delegationId !== local.delegationId || persisted.status === "running" && local.status !== "running"
      || (local.timing?.completedAt ?? local.timing?.startedAt ?? -1) > (persisted.timing?.completedAt ?? persisted.timing?.startedAt ?? -1)) {
      result.set(local.delegationId, local);
    }
  }
  return [...result.values()];
}
