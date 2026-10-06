import { createContext } from "react";
import type { UiMessage } from "@pi-desktop/shared";
import type { TaskVisualState } from "./team-presentation";

export function dispatchFallbackState(status: string | undefined): TaskVisualState {
  switch (status) {
    case "pending":
    case "in_progress":
    case "completed":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "pending";
  }
}

export function isTeammateJoining(
  tools: readonly Pick<UiMessage, "toolName" | "toolStatus">[],
): boolean {
  return tools.some((tool) => tool.toolName === "spawn_teammate" && tool.toolStatus === "running");
}

function parseJsonSafe(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  if (typeof val === "string") {
    try {
      const parsed: unknown = JSON.parse(val);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function stringField(
  ...values: unknown[]
): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

export type TeamDispatchTask = {
  taskId: string;
  subject: string;
  status: string;
  ownerMemberName?: string;
  ownerSessionId?: string;
  description?: string;
};

export type TeamDispatchCardItem = {
  teamSessionId: string;
  taskId: string;
  firstCreateMessageId: string;
  task: TeamDispatchTask;
};

export type TeamDispatchIndex = {
  cardsByMessageId: Map<string, TeamDispatchCardItem[]>;
  cardsByTaskId: Map<string, TeamDispatchCardItem>;
};

export const TeamDispatchContext = createContext<TeamDispatchIndex>({
  cardsByMessageId: new Map(),
  cardsByTaskId: new Map(),
});

export function extractTaskFromToolMessage(message: UiMessage): {
  action: "create" | "update" | null;
  taskId: string | null;
  teamSessionId?: string;
  subject?: string;
  status?: string;
  ownerMemberName?: string;
  ownerSessionId?: string;
  description?: string;
} {
  if (message.toolName !== "task_create" && message.toolName !== "task_update") {
    return { action: null, taskId: null };
  }
  const isCreate = message.toolName === "task_create";
  const args = parseJsonSafe(message.toolArgs);
  const result = parseJsonSafe(message.toolResult);

  if (
    message.isError ||
    message.toolStatus === "running" ||
    message.toolStatus === "error" ||
    message.toolStatus === "denied" ||
    result?.isError === true ||
    (result?.error !== undefined && result.error !== null && result.error !== false)
  ) {
    return { action: null, taskId: null };
  }

  const resTask = parseJsonSafe(result?.task) ?? (result?.taskId ? result : null);
  const taskId = stringField(resTask?.taskId);
  if (!taskId) return { action: null, taskId: null };

  const teamSessionId = stringField(
    args?.teamSessionId,
    resTask?.teamSessionId,
    result?.teamSessionId,
  );

  const subject = stringField(resTask?.subject, args?.subject);
  const status = stringField(resTask?.status, args?.status) ?? (isCreate ? "pending" : undefined);
  const ownerMemberName = stringField(resTask?.ownerMemberName, args?.ownerMemberName);
  const ownerSessionId = stringField(resTask?.ownerSessionId, args?.ownerSessionId);
  const description = stringField(resTask?.description, args?.description);

  return {
    action: isCreate ? "create" : "update",
    taskId: taskId ?? null,
    teamSessionId,
    subject,
    status,
    ownerMemberName,
    ownerSessionId,
    description,
  };
}

export function buildTeamDispatchIndex(
  messages: readonly UiMessage[],
  defaultTeamSessionId?: string,
): TeamDispatchIndex {
  const cardsByTaskId = new Map<string, TeamDispatchCardItem>();
  const cardsByMessageId = new Map<string, TeamDispatchCardItem[]>();

  for (const message of messages) {
    const extracted = extractTaskFromToolMessage(message);
    if (!extracted.action || !extracted.taskId) continue;

    const teamSessionId =
      extracted.teamSessionId || defaultTeamSessionId || "";
    const key = `${teamSessionId}:${extracted.taskId}`;

    if (extracted.action === "create") {
      const existing = cardsByTaskId.get(key);
      if (!existing) {
        const item: TeamDispatchCardItem = {
          teamSessionId,
          taskId: extracted.taskId,
          firstCreateMessageId: message.id,
          task: {
            taskId: extracted.taskId,
            subject: extracted.subject || "",
            status: extracted.status || "pending",
            ownerMemberName: extracted.ownerMemberName || undefined,
            ownerSessionId: extracted.ownerSessionId || undefined,
            description: extracted.description || undefined,
          },
        };
        cardsByTaskId.set(key, item);
        const list = cardsByMessageId.get(message.id) ?? [];
        list.push(item);
        cardsByMessageId.set(message.id, list);
      } else {
        // Subsequent create call for the same task id updates details, keeping anchor
        if (extracted.subject) existing.task.subject = extracted.subject;
        if (extracted.status) existing.task.status = extracted.status;
        if (extracted.ownerMemberName !== undefined) {
          existing.task.ownerMemberName = extracted.ownerMemberName || undefined;
        }
        if (extracted.ownerSessionId) existing.task.ownerSessionId = extracted.ownerSessionId;
        if (extracted.description) existing.task.description = extracted.description;
      }
    } else if (extracted.action === "update") {
      const existing = cardsByTaskId.get(key);
      if (existing) {
        if (extracted.subject) existing.task.subject = extracted.subject;
        if (extracted.status) existing.task.status = extracted.status;
        if (extracted.ownerMemberName !== undefined) {
          existing.task.ownerMemberName = extracted.ownerMemberName || undefined;
        }
        if (extracted.ownerSessionId) existing.task.ownerSessionId = extracted.ownerSessionId;
        if (extracted.description) existing.task.description = extracted.description;
        // Do NOT add to cardsByMessageId for this message.id! Anchor stays at firstCreateMessageId.
      } else {
        // Fallback if update appears without create
        const item: TeamDispatchCardItem = {
          teamSessionId,
          taskId: extracted.taskId,
          firstCreateMessageId: message.id,
          task: {
            taskId: extracted.taskId,
            subject: extracted.subject || "",
            status: extracted.status || "pending",
            ownerMemberName: extracted.ownerMemberName || undefined,
            ownerSessionId: extracted.ownerSessionId || undefined,
            description: extracted.description || undefined,
          },
        };
        cardsByTaskId.set(key, item);
        const list = cardsByMessageId.get(message.id) ?? [];
        list.push(item);
        cardsByMessageId.set(message.id, list);
      }
    }
  }

  return { cardsByTaskId, cardsByMessageId };
}
