/** Shared public types grouped by the owning application domain. */
export type FsEntry = {
  name: string;
  kind: "dir" | "file";
  size: number;
};

export type FsReadResult = {
  kind: "text" | "image" | "binary" | "tooLarge";
  /** UTF-8 file content when kind is "text". */
  content?: string;
  /** Base64 data URL when kind is "image". */
  dataUrl?: string;
  size: number;
};

/** Bounded in-chat image read. Non-images never include file bytes. */
export type FsImageDataUrlResult = {
  kind: "image" | "missing" | "notImage" | "tooLarge";
  dataUrl?: string;
  size?: number;
  errorCode?: string;
};

export type AgentInstructionFile = {
  scope: "global" | "project";
  path: string;
  content: string;
  exists: boolean;
};

export type ProjectMemory = {
  content: string;
  entries?: ProjectMemoryEntry[];
  updatedAt?: number;
};

export type ProjectMemoryEntry = {
  id: string;
  title: string;
  content: string;
};

/** Workspace-relative entry of the `fs/index` snapshot for the "@" menu (D124). */
export type FsIndexEntry = {
  path: string;
  kind: "dir" | "file";
};

export type FsIndexResult = {
  entries: FsIndexEntry[];
  /** True when the index hit its entry cap and results were dropped. */
  truncated: boolean;
};

export type TokenUsageBucket = "day" | "week" | "month";

export type TokenUsageHistoryItem = {
  date: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  turnCount: number;
};

export type TokenUsageHistoryResult = {
  bucket: TokenUsageBucket;
  rangeStart: number;
  rangeEnd: number;
  items: TokenUsageHistoryItem[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    turnCount: number;
  };
};

/**
 * A file referenced from chat text, resolved to a real file (D320 follow-up).
 *
 * `root` names which store answered, because the caller routes on it: a
 * project file is expressed to the work panel as a root-relative path, while a
 * scratch or attachment file can only be addressed by its absolute path.
 */
export type FsChatRefRoot = "workspace" | "scratch" | "attachments";

/** Which rule produced the match; the shallow tiers are informational. */
export type FsChatRefMatchKind =
  | "exact-relative"
  | "exact-absolute"
  | "path-suffix"
  | "basename";

export type FsChatRefMatch = {
  root: FsChatRefRoot;
  /** POSIX path relative to the matched root. */
  relativePath: string;
  /** Native absolute path of the matched regular file. */
  absolutePath: string;
  matchedBy: FsChatRefMatchKind;
};

export type FsChatRefResolveResult = {
  match: FsChatRefMatch | null;
};
