/**
 * Goal Execution Progress Snapshot v1 contracts and validators.
 *
 * Persisted in the host KV store under namespace "goal_progress_v1".
 * Emits "goalProgress.changed" events decoupled from goal completion reports.
 */

export const GOAL_PROGRESS_SCHEMA_VERSION = 1 as const;
export const GOAL_PROGRESS_KV_NAMESPACE = "goal_progress_v1" as const;

export const GOAL_PROGRESS_ITEM_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
] as const;

export type GoalProgressItemStatus = (typeof GOAL_PROGRESS_ITEM_STATUSES)[number];

export type GoalProgressItem = {
  id: string;
  label: string;
  status: GoalProgressItemStatus;
};

export type GoalProgressSnapshot = {
  schemaVersion: typeof GOAL_PROGRESS_SCHEMA_VERSION;
  sessionId: string;
  proposalId: string;
  executionId: string;
  revision: number;
  items: GoalProgressItem[];
  updatedAt: number;
};

export type GoalProgressChangedEvent = {
  sessionId: string;
  executionId: string;
  revision: number;
};

export type GoalProgressUpdateParams = {
  sessionId: string;
  executionId: string;
  writeToken: string;
  expectedRevision?: number;
  items: GoalProgressItem[];
};

export function isGoalProgressItemStatus(
  value: unknown,
): value is GoalProgressItemStatus {
  return (
    typeof value === "string" &&
    (GOAL_PROGRESS_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

export function validateGoalProgressItems(
  items: unknown,
): { ok: true; items: GoalProgressItem[] } | { ok: false; error: string } {
  if (!Array.isArray(items)) {
    return { ok: false, error: "items must be an array" };
  }
  const validated: GoalProgressItem[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `items[${i}] must be an object` };
    }
    const { id, label, status } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: `items[${i}].id must be a non-empty string` };
    }
    const trimmedId = id.trim();
    if (seenIds.has(trimmedId)) {
      return { ok: false, error: `duplicate item id: "${trimmedId}"` };
    }
    seenIds.add(trimmedId);

    if (typeof label !== "string" || !label.trim()) {
      return { ok: false, error: `items[${i}].label must be a non-empty string` };
    }
    if (!isGoalProgressItemStatus(status)) {
      return {
        ok: false,
        error: `items[${i}].status must be one of: ${GOAL_PROGRESS_ITEM_STATUSES.join(", ")}`,
      };
    }
    validated.push({
      id: trimmedId,
      label: label.trim(),
      status,
    });
  }
  return { ok: true, items: validated };
}

export function validateGoalProgressSnapshot(
  snapshot: unknown,
): snapshot is GoalProgressSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false;
  }
  const s = snapshot as Record<string, unknown>;
  if (s.schemaVersion !== GOAL_PROGRESS_SCHEMA_VERSION) return false;
  if (typeof s.sessionId !== "string" || !s.sessionId.trim()) return false;
  if (typeof s.proposalId !== "string" || !s.proposalId.trim()) return false;
  if (typeof s.executionId !== "string" || !s.executionId.trim()) return false;
  if (typeof s.revision !== "number" || !Number.isInteger(s.revision) || s.revision < 1) {
    return false;
  }
  if (typeof s.updatedAt !== "number" || !Number.isFinite(s.updatedAt)) return false;
  const itemsCheck = validateGoalProgressItems(s.items);
  return itemsCheck.ok;
}
