/**
 * Model-written status note for one local session: the pinned card at the top of
 * the activity rail. Host core stores it, the Node runtime writes it, and it is
 * never fed back to the agent. `SessionSummary` (session list row) is a different
 * type; this one is the note.
 */
export type SessionSummaryNote = {
  sessionId: string;
  /** One plain paragraph; render as text, never as HTML or Markdown. */
  text: string;
  revision: number;
  /** The session's message counter when the note was written. */
  basedOnMessageCount: number;
  updatedAt: string;
  /** Messages added since the note was written. */
  behind: number;
  /** The transcript is now shorter than the note's basis, as after a rewind. */
  diverged: boolean;
};

export type SessionSummaryState = {
  summary: SessionSummaryNote | null;
  messageCount: number;
};

export type SessionSummaryRefreshRequest = {
  sessionId: string;
  /** The refresh control: skips the new-message threshold and the interval. */
  force?: boolean;
};

/** Why no model call was made, or why its result was not stored. */
export type SessionSummarySkipReason =
  | "disabled"
  | "no-content"
  | "not-behind"
  | "too-soon"
  | "conflict";

export type SessionSummaryRefreshResult =
  | { outcome: "updated"; summary: SessionSummaryNote }
  | { outcome: "skipped"; reason: SessionSummarySkipReason; summary: SessionSummaryNote | null };

const SKIP_REASONS: readonly string[] = ["disabled", "no-content", "not-behind", "too-soon", "conflict"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate Host-origin data before a note enters renderer state. */
export function isSessionSummaryNote(value: unknown): value is SessionSummaryNote {
  return isRecord(value)
    && typeof value.sessionId === "string" && value.sessionId.length > 0
    && typeof value.text === "string" && value.text.trim().length > 0
    && new TextEncoder().encode(value.text).length <= 2000
    && isCount(value.revision) && value.revision > 0
    && isCount(value.basedOnMessageCount)
    && typeof value.updatedAt === "string" && !Number.isNaN(Date.parse(value.updatedAt))
    && isCount(value.behind)
    && typeof value.diverged === "boolean";
}

export function isSessionSummaryState(value: unknown): value is SessionSummaryState {
  return isRecord(value) && isCount(value.messageCount)
    && (value.summary === null || isSessionSummaryNote(value.summary));
}

export function isSessionSummaryRefreshResult(value: unknown): value is SessionSummaryRefreshResult {
  if (!isRecord(value)) return false;
  if (value.outcome === "updated") return isSessionSummaryNote(value.summary);
  return value.outcome === "skipped"
    && typeof value.reason === "string" && SKIP_REASONS.includes(value.reason)
    && (value.summary === null || isSessionSummaryNote(value.summary));
}
