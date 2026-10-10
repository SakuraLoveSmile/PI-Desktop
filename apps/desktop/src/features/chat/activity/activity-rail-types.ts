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
  groupLabel?: string;
  changeCount?: number;
  addedLines?: number;
  removedLines?: number;
  lastChangedAt?: string;
  sourceCount?: number;
  roleLabel?: string;
};

export type ActivityAttentionItem = {
  id: string;
  label: string;
  group: "plans" | "agents" | "team-members" | "processes" | "approvals";
  itemId?: string;
  onOpen?: () => void;
};
