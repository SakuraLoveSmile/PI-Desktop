import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SubagentPermission, SubagentThinkingLevel } from "@pi-desktop/shared";
import type { RuntimeProviderConfig } from "./provider-binding.js";

/** A bounded execution owner, independent from the durable Host session. */
export type DelegationOwnerContext = {
  /** Stable delegate chain identity, absent for the session root. */
  ownerId?: string;
  depth: number;
  tools: AgentTool[];
  permission: SubagentPermission;
  provider: () => RuntimeProviderConfig;
  thinkingLevel: () => SubagentThinkingLevel;
  signal?: AbortSignal;
};

/** Nested overrides can restrict their ancestor, never elevate it. */
export function nestedDelegationPermission(
  parent: SubagentPermission,
  requested: SubagentPermission = "inherit",
): SubagentPermission {
  if (requested === "inherit") return parent;
  if (parent === "inherit") return requested === "ask" ? "ask" : "inherit";
  const rank = { ask: 0, "accept-edits": 1, auto: 2 };
  return rank[requested] < rank[parent] ? requested : parent;
}
