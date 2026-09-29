import type { ComposerDraftSnapshot } from "./composer-smart-stop";

export type ComposerHistoryEntry = {
  text: string;
  fileReferences: ComposerDraftSnapshot["fileReferences"];
};

type HistoryBucket = { sessionId: string; entries: ComposerHistoryEntry[] };
type HistoryReference = ComposerHistoryEntry["fileReferences"][number];

const KEY = "pi.desktop.composerInputHistory";
export const COMPOSER_INPUT_HISTORY_MAX = 100;
export const COMPOSER_INPUT_HISTORY_SESSIONS_MAX = 20;

function historyStorage(): Storage | null {
  try {
    return typeof globalThis !== "undefined" && "localStorage" in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

function readReference(value: unknown): HistoryReference | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.path !== "string" || !row.path || typeof row.name !== "string") return null;
  const kind = row.kind === "image" || row.kind === "file" ? row.kind : undefined;
  return {
    path: row.path,
    name: row.name,
    kind,
    ...(typeof row.mimeType === "string" && row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(typeof row.token === "string" && row.token ? { token: row.token } : {}),
  };
}

function readEntry(value: unknown): ComposerHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.text !== "string" || !Array.isArray(row.fileReferences)) return null;
  const fileReferences: HistoryReference[] = [];
  for (const reference of row.fileReferences) {
    const parsed = readReference(reference);
    if (!parsed) return null;
    fileReferences.push(parsed);
  }
  if (!row.text.trim() && fileReferences.length === 0) return null;
  return { text: row.text, fileReferences };
}

function readBuckets(): HistoryBucket[] {
  const storage = historyStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const sessions = (parsed as { sessions?: unknown }).sessions;
    if (!Array.isArray(sessions)) return [];
    const buckets: HistoryBucket[] = [];
    for (const value of sessions) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (typeof row.sessionId !== "string" || !row.sessionId || !Array.isArray(row.entries)) continue;
      const entries: ComposerHistoryEntry[] = [];
      for (const candidate of row.entries) {
        const entry = readEntry(candidate);
        if (entry) entries.push(entry);
        if (entries.length >= COMPOSER_INPUT_HISTORY_MAX) break;
      }
      buckets.push({ sessionId: row.sessionId, entries });
      if (buckets.length >= COMPOSER_INPUT_HISTORY_SESSIONS_MAX) break;
    }
    return buckets;
  } catch {
    return [];
  }
}

function writeBuckets(buckets: readonly HistoryBucket[]): void {
  const storage = historyStorage();
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify({ sessions: buckets }));
  } catch {
    // History is best-effort and must never block sending.
  }
}

export function loadComposerInputHistory(sessionId: string): ComposerHistoryEntry[] {
  if (!sessionId) return [];
  return readBuckets().find((bucket) => bucket.sessionId === sessionId)?.entries ?? [];
}

function sameContent(left: ComposerHistoryEntry, right: ComposerHistoryEntry): boolean {
  return left.text === right.text && left.fileReferences.length === right.fileReferences.length &&
    left.fileReferences.every((reference, index) => reference.path === right.fileReferences[index]?.path);
}

export function rememberComposerInput(sessionId: string, snapshot: ComposerDraftSnapshot): void {
  if (!sessionId || (!snapshot.text.trim() && snapshot.fileReferences.length === 0)) return;
  const entry: ComposerHistoryEntry = {
    text: snapshot.text,
    fileReferences: snapshot.fileReferences.map((reference) => ({ ...reference })),
  };
  const buckets = readBuckets();
  const current = buckets.find((bucket) => bucket.sessionId === sessionId);
  if (current?.entries[0] && sameContent(current.entries[0], entry)) {
    writeBuckets([current, ...buckets.filter((bucket) => bucket !== current)]);
    return;
  }
  const entries = [entry, ...(current?.entries ?? [])].slice(0, COMPOSER_INPUT_HISTORY_MAX);
  writeBuckets([
    { sessionId, entries },
    ...buckets.filter((bucket) => bucket.sessionId !== sessionId),
  ].slice(0, COMPOSER_INPUT_HISTORY_SESSIONS_MAX));
}
