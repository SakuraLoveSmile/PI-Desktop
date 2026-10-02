/**
 * UpdateGoalProgress tool definition and state management.
 *
 * Available ONLY in the autonomous execution context of an approved Goal
 * when a valid private writeToken is held.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  type GoalProgressItem,
  type GoalProgressSnapshot,
  validateGoalProgressItems,
  validateGoalProgressSnapshot,
} from "@pi-desktop/shared";

export const UPDATE_GOAL_PROGRESS_TOOL_NAME = "UpdateGoalProgress" as const;

export type GoalProgressManagerOptions = {
  sessionId: string;
  executionId: string;
  writeToken: string;
  onUpdate: (items: GoalProgressItem[]) => Promise<GoalProgressSnapshot>;
};

export class GoalProgressManager {
  private lastSnapshot: GoalProgressSnapshot | null = null;

  constructor(private readonly options: GoalProgressManagerOptions) {}

  get executionId(): string {
    return this.options.executionId;
  }

  get writeToken(): string {
    return this.options.writeToken;
  }

  get snapshot(): GoalProgressSnapshot | null {
    return this.lastSnapshot;
  }

  buildTool(): AgentTool {
    return {
      name: UPDATE_GOAL_PROGRESS_TOOL_NAME,
      label: "Update goal progress",
      description:
        "Update the real-time progress items/milestones for the currently running approved Goal. " +
        "Call this tool to reflect progress as sub-tasks are started or completed.",
      parameters: Type.Object({
        items: Type.Array(
          Type.Object({
            id: Type.String({ description: "Unique identifier for this sub-task or milestone." }),
            label: Type.String({ description: "Brief label describing the sub-task or milestone." }),
            status: Type.Union(
              [
                Type.Literal("pending"),
                Type.Literal("in_progress"),
                Type.Literal("completed"),
                Type.Literal("failed"),
              ],
              {
                description: "Current status of the sub-task: pending, in_progress, completed, or failed.",
              },
            ),
          }),
          { description: "List of progress items/milestones." },
        ),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        const items =
          params !== null && typeof params === "object" && !Array.isArray(params)
            ? (params as Record<string, unknown>).items
            : undefined;
        const validation = validateGoalProgressItems(items);
        if (!validation.ok) {
          return {
            content: [{ type: "text", text: `Progress validation failed: ${validation.error}` }],
            details: { ok: false, error: validation.error },
          };
        }

        try {
          const snapshot = await this.options.onUpdate(validation.items);
          if (
            !validateGoalProgressSnapshot(snapshot) ||
            snapshot.sessionId !== this.options.sessionId ||
            snapshot.executionId !== this.options.executionId
          ) {
            throw new Error("Host returned an invalid goal progress snapshot");
          }
          this.lastSnapshot = snapshot;
          const completedCount = snapshot.items.filter((i) => i.status === "completed").length;
          return {
            content: [
              {
                type: "text",
                text: `Goal progress updated successfully (revision ${snapshot.revision}, ${completedCount}/${snapshot.items.length} completed).`,
              },
            ],
            details: { ok: true, revision: snapshot.revision },
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to update goal progress: ${message}` }],
            details: { ok: false, error: message },
          };
        }
      },
    };
  }
}
