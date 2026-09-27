/**
 * Expert Team domain types, limits, validation, and tool contracts.
 *
 * An Expert Team consists of a Lead Session and up to 8 permanently named
 * teammates running in durable Sessions. The Host owns the canonical roster,
 * task board, and mailbox delivery ledger.
 */

export const MAX_TEAM_MEMBERS = 8;
export const MAX_TEAM_TASKS = 256;
export const MAX_TEAM_MAILBOX_MESSAGES = 64;
export const MAX_TEAM_MESSAGE_BYTES = 65536; // 64 KiB
export const MAX_TEAM_MEMBER_NAME_CHARS = 64;

export type TeamContextKind = "fresh" | "fork";

export type TeamMemberPhase =
  | "provisioning"
  | "idle"
  | "running"
  | "failed"
  | "completed";

export type TeamTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type TeamRecord = {
  teamSessionId: string;
  revision: number;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberRecord = {
  teamSessionId: string;
  memberSessionId: string;
  name: string;
  description?: string;
  contextKind: TeamContextKind;
  phase: TeamMemberPhase;
  modelId?: string;
  providerId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamDeliveryStatus =
  | "queued"
  | "accepted"
  | "acknowledged"
  | "completed"
  | "failed";

export type TeamMessageRecord = {
  id: string;
  teamSessionId: string;
  sourceSessionId: string;
  sourceMemberName: string;
  targetSessionId: string;
  targetMemberName: string;
  content: string;
  turnId?: string | null;
  /** Underlying collaboration lifecycle retained for compatibility. */
  status: string;
  deliveryStatus: TeamDeliveryStatus;
  createdAt: string;
  updatedAt: string;
};

export type TeamTaskRecord = {
  teamSessionId: string;
  taskId: string;
  revision: number;
  subject: string;
  description?: string;
  status: TeamTaskStatus;
  ownerSessionId?: string | null;
  ownerMemberName?: string | null;
  blockedBy: string[];
  writeScopes: string[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeamTaskWriteScopeOverlapWarning = {
  taskAId: string;
  taskBId: string;
  scope: string;
};

/** Frozen Host DTO for team.getRoster. */
export type TeamRosterProjection = {
  teamSessionId: string;
  revision: number;
  paused: boolean;
  members: TeamMemberRecord[];
};

/** Frozen Host DTO for team.getBoard. */
export type TeamBoardProjection = {
  teamSessionId: string;
  revision: number;
  tasks: TeamTaskRecord[];
  readiness: Array<{
    taskId: string;
    isReady: boolean;
    unresolvedBlockedBy: string[];
  }>;
  scopeOverlaps: Array<{
    scope: string;
    taskIds: string[];
  }>;
};

/** @deprecated Use the separate frozen roster and board projections. */
export type TeamProjection = TeamBoardProjection;

// ---- DSH 9 Team Tools ----

export const TEAM_TOOL_NAMES = [
  "spawn_teammate",
  "send_message",
  "wait_for_updates",
  "interrupt_agent",
  "task_create",
  "task_update",
  "task_list",
  "task_get",
  "team_status",
] as const;

export type TeamToolName = (typeof TEAM_TOOL_NAMES)[number];

export function isTeamTool(toolName: string): toolName is TeamToolName {
  return (TEAM_TOOL_NAMES as readonly string[]).includes(toolName);
}

export type SpawnTeammateArgs = {
  name: string;
  description?: string;
  contextKind?: TeamContextKind;
  modelId?: string;
  providerId?: string;
  prompt?: string;
};

export type SpawnTeammateResult = {
  memberSessionId: string;
  name: string;
};

export type SendMessageArgs = {
  targetMemberName: string;
  content: string;
};

export type SendMessageResult = {
  messageId: string;
  delivered: boolean;
};

export type WaitForUpdatesArgs = {
  timeoutSeconds?: number;
};

export type WaitForUpdatesResult = {
  updated: boolean;
  reason?: string;
};

export type InterruptAgentArgs = {
  memberName: string;
};

export type InterruptAgentResult = {
  interrupted: boolean;
};

export type TaskCreateArgs = {
  subject: string;
  description?: string;
  blockedBy?: string[];
  writeScopes?: string[];
  ownerMemberName?: string;
};

export type TaskCreateResult = {
  task: TeamTaskRecord;
};

export type TaskUpdateArgs = {
  taskId: string;
  expectedRevision: number;
  subject?: string;
  description?: string;
  status?: TeamTaskStatus;
  blockedBy?: string[];
  writeScopes?: string[];
  ownerMemberName?: string | null;
};

export type TaskUpdateResult = {
  task: TeamTaskRecord;
};

export type TaskListArgs = {
  includeDeleted?: boolean;
};

export type TaskListResult = {
  tasks: TeamTaskRecord[];
  revision: number;
};

export type TaskGetArgs = {
  taskId: string;
};

export type TaskGetResult = {
  task: TeamTaskRecord;
};

export type TeamStatusArgs = Record<string, never>;

export type TeamStatusResult = TeamRosterProjection &
  Pick<TeamBoardProjection, "tasks" | "readiness" | "scopeOverlaps">;

// ---- Validation and Helpers ----

/**
 * Validates task dependency graph:
 * 1. All `blockedBy` IDs must exist among active (non-deleted) tasks.
 * 2. No cycles are allowed in the dependency graph.
 */
export function validateTaskDependencies(tasks: TeamTaskRecord[]): {
  valid: boolean;
  error?: string;
} {
  const activeTasks = tasks.filter((t) => !t.deleted);
  const activeIds = new Set(activeTasks.map((t) => t.taskId));

  // Check missing dependencies
  for (const task of activeTasks) {
    for (const depId of task.blockedBy) {
      if (!activeIds.has(depId)) {
        return {
          valid: false,
          error: `Task ${task.taskId} depends on missing or deleted task ${depId}`,
        };
      }
      if (depId === task.taskId) {
        return {
          valid: false,
          error: `Task ${task.taskId} cannot depend on itself`,
        };
      }
    }
  }

  // Detect cycles using DFS
  const visited = new Map<string, 0 | 1 | 2>(); // 0: unvisited, 1: visiting, 2: visited
  for (const task of activeTasks) {
    visited.set(task.taskId, 0);
  }

  function hasCycle(taskId: string): boolean {
    visited.set(taskId, 1);
    const task = activeTasks.find((t) => t.taskId === taskId);
    if (task) {
      for (const depId of task.blockedBy) {
        const state = visited.get(depId);
        if (state === 1) return true; // cycle detected
        if (state === 0 && hasCycle(depId)) return true;
      }
    }
    visited.set(taskId, 2);
    return false;
  }

  for (const task of activeTasks) {
    if (visited.get(task.taskId) === 0) {
      if (hasCycle(task.taskId)) {
        return {
          valid: false,
          error: `Dependency cycle detected involving task ${task.taskId}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Detects advisory write scope overlaps across concurrent in-progress/pending tasks.
 */
export function detectWriteScopeOverlaps(
  tasks: TeamTaskRecord[],
): TeamTaskWriteScopeOverlapWarning[] {
  const warnings: TeamTaskWriteScopeOverlapWarning[] = [];
  const activeTasks = tasks.filter(
    (t) => !t.deleted && (t.status === "in_progress" || t.status === "pending"),
  );

  for (let i = 0; i < activeTasks.length; i++) {
    for (let j = i + 1; j < activeTasks.length; j++) {
      const taskA = activeTasks[i];
      const taskB = activeTasks[j];
      for (const scopeA of taskA.writeScopes) {
        const normA = scopeA.trim().toLowerCase();
        for (const scopeB of taskB.writeScopes) {
          const normB = scopeB.trim().toLowerCase();
          if (normA === normB || normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`)) {
            warnings.push({
              taskAId: taskA.taskId,
              taskBId: taskB.taskId,
              scope: scopeA,
            });
          }
        }
      }
    }
  }

  return warnings;
}
