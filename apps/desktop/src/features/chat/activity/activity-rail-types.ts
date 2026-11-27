import type { ReactNode } from "react";
import type { SubagentTiming } from "../../../lib/subagent-topology";

export type ActivityRailItem = {
  id: string;
  label: string;
  path?: string;
  detail?: string;
  status?: string;
  attentionStatus?: string;
  statusLabel?: string;
  timing?: SubagentTiming;
  onOpen?: () => void;
  onLocate?: () => void;
  onCopyPath?: () => void;
  content?: ReactNode;
  /** A goal row's say in the Goal section's folded heading while it is the only goal; `fallback` is the heading's default counts. */
  foldedSummary?: (fallback: string) => ReactNode;
  groupLabel?: string;
  changeCount?: number;
  addedLines?: number;
  removedLines?: number;
  lastChangedAt?: string;
  sourceCount?: number;
  roleLabel?: string;
};

/** The project a session runs in and its git branch. A project outside git has no environment to show. */
export type ActivityEnvironment = { name: string; path: string; branch: string | null };

/** The recorded changes the Review tab lists, as counts. */
export type ActivityChanges = { count: number; additions: number; deletions: number };

/** The pinned session summary: the model-written paragraph, when it was written and the one control the card offers. */
export type ActivitySummary = { text: string; updatedAt: string; refreshing: boolean; onRefresh: () => void };

export type ActivityAttentionItem = {
  id: string;
  label: string;
  group: "goals" | "plans" | "agents" | "team-members" | "processes" | "approvals";
  itemId?: string;
  onOpen?: () => void;
};
