/**
 * DSH 9 Expert Team Agent Tools (ADR 0304).
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RuntimeHost } from "../host-client.js";
import {
  type TeamTaskRecord,
  type TeamMemberRecord,
  type TeamBoardProjection,
  type TeamRosterProjection,
  type TeamTaskStatus,
  type TeamContextKind,
  type DeclareTeamStrategyArgs,
  type TeamExecutionDecision,
  type TeamLaunchReview,
  DECLARE_TEAM_STRATEGY_TOOL_NAME,
  MAX_TEAM_STRATEGY_REASON_CHARS,
} from "@pi-desktop/shared";

export interface TeamToolsOptions {
  teamSessionId: string;
  callerSessionId: string;
  isLead: boolean;
  host: RuntimeHost;
  getTurnId?: () => string | undefined;
  abortActiveTurn?: (memberSessionId: string) => Promise<boolean>;
}

export function createTeamTools(opts: TeamToolsOptions): AgentTool[] {
  const { teamSessionId, callerSessionId, isLead, host } = opts;
  const declareTeamStrategyTool: AgentTool = {
    name: DECLARE_TEAM_STRATEGY_TOOL_NAME,
    label: "Declare Team Strategy",
    description:
      "Declare the coordination strategy for this turn: either 'lead_only' for indivisible work, or 'delegate' to propose expert teammates. Only available to the Team Lead.",
    parameters: Type.Object({
      strategy: Type.Union([Type.Literal("lead_only"), Type.Literal("delegate")], {
        description: "Whether the Lead handles this turn alone ('lead_only') or delegates to expert teammates ('delegate').",
      }),
      reason: Type.String({
        description: "Reasoning for the strategy choice (up to 1000 chars).",
        minLength: 1,
        maxLength: MAX_TEAM_STRATEGY_REASON_CHARS,
      }),
      members: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String({
              description: "Permanent alphanumeric/underscore name for this proposed expert.",
              minLength: 1,
              maxLength: 64,
            }),
            description: Type.Optional(Type.String({ description: "Expert role or specialty description." })),
            contextKind: Type.Optional(
              Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
                description: "Context initialization: 'fresh' (default) or 'fork'.",
              }),
            ),
            memberSessionId: Type.Optional(Type.String({ description: "Existing member session ID to reuse." })),
            presentation: Type.Optional(
              Type.Object({
                role: Type.Union([
                  Type.Literal("researcher"),
                  Type.Literal("executor"),
                  Type.Literal("reviewer"),
                  Type.Literal("planner"),
                  Type.Literal("collaborator"),
                ]),
                displayName: Type.String({ minLength: 1, maxLength: 64 }),
              }),
            ),
            selection: Type.Optional(
              Type.Object({
                providerId: Type.Optional(Type.String()),
                modelId: Type.Optional(Type.String()),
                thinkingLevel: Type.Optional(Type.String()),
              }),
            ),
          }),
          { description: "Proposed expert members (required for 'delegate' strategy)." },
        ),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      if (!isLead) {
        return {
          content: [
            {
              type: "text",
              text: "Error: TEAM_UNAUTHORIZED: Only the Team Lead may declare team strategy",
            },
          ],
          details: { error: "TEAM_UNAUTHORIZED" },
        };
      }
      try {
        const p = params as DeclareTeamStrategyArgs;
        const leadTurnId = opts.getTurnId?.()?.trim();
        if (!leadTurnId) {
          return {
            content: [{ type: "text", text: "Error: TURN_NOT_FOUND: No durable Lead turn is active" }],
            details: { error: "TURN_NOT_FOUND" },
          };
        }
        const result = await host.call<{
          decision: TeamExecutionDecision;
          review: TeamLaunchReview | null;
        }>("team.declareStrategy", {
          teamSessionId,
          callerSessionId,
          leadTurnId,
          strategy: p.strategy,
          reason: p.reason,
          ...(p.strategy === "delegate" ? { members: p.members } : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                strategy: result.decision.strategy,
                reason: result.decision.reason,
                reviewId: result.review?.reviewId,
                status: result.review?.status ?? "none",
                members: result.review?.members?.map(
                  (m: { name: string; selection: { modelId: string; providerId: string } }) => ({
                    name: m.name,
                    modelId: m.selection.modelId,
                    providerId: m.selection.providerId,
                  }),
                ),
              }),
            },
          ],
          details: result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };


  const spawnTeammateTool: AgentTool = {
    name: "spawn_teammate",
    label: "Spawn Teammate",
    description:
      "Spawn a new named teammate session in the Expert Team. Only available to the Team Lead. Can optionally provide initial instructions (prompt).",
    parameters: Type.Object({
      name: Type.String({
        description:
          "Permanent alphanumeric/underscore name for this teammate (max 64 characters).",
        minLength: 1,
        maxLength: 64,
      }),
      description: Type.Optional(
        Type.String({ description: "Role or specialty description." }),
      ),
      contextKind: Type.Optional(
        Type.Union([Type.Literal("fresh"), Type.Literal("fork")], {
          description:
            "Whether the teammate starts with clean context ('fresh') or forks from the lead ('fork'). Default is 'fresh'.",
        }),
      ),
      modelId: Type.Optional(
        Type.String({ description: "Optional specific model ID to bind." }),
      ),
      providerId: Type.Optional(
        Type.String({ description: "Optional provider ID." }),
      ),
      prompt: Type.Optional(
        Type.String({
          description:
            "Initial instruction/task message to queue for this teammate.",
        }),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      if (!isLead) {
        return {
          content: [
            {
              type: "text",
              text: "Error: TEAM_UNAUTHORIZED: Only the Team Lead may spawn teammates",
            },
          ],
          details: { error: "TEAM_UNAUTHORIZED" },
        };
      }
      try {
        const p = params as {
          name: string;
          description?: string;
          contextKind?: TeamContextKind;
          modelId?: string;
          providerId?: string;
          prompt?: string;
        };
        const result = await host.call<{ member: TeamMemberRecord }>(
          "team.createMember",
          {
            teamSessionId,
            callerSessionId,
            name: p.name,
            description: p.description,
            contextKind: p.contextKind ?? "fresh",
            modelId: p.modelId,
            providerId: p.providerId,
          },
        );

        if (p.prompt) {
          await host.call("team.sendMessage", {
            teamSessionId,
            callerSessionId,
            target: result.member.name,
            content: p.prompt,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                memberSessionId: result.member.memberSessionId,
                name: result.member.name,
                phase: result.member.phase,
              }),
            },
          ],
          details: result.member,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const sendMessageTool: AgentTool = {
    name: "send_message",
    label: "Send Message",
    description:
      "Send an authenticated message to a team member (or Lead) via the team mailbox.",
    parameters: Type.Object({
      targetMemberName: Type.String({
        description: "Name of the recipient teammate, or 'Lead'.",
      }),
      content: Type.String({ description: "Message body (up to 64 KiB)." }),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const p = params as { targetMemberName: string; content: string };
        const result = await host.call<{
          message: {
            id: string;
            targetMemberName?: string;
            target_member_name?: string;
            status: string;
            deliveryStatus?: string;
          };
        }>("team.sendMessage", {
          teamSessionId,
          callerSessionId,
          target: p.targetMemberName,
          content: p.content,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                messageId: result.message.id,
                target: result.message.targetMemberName ?? result.message.target_member_name,
                status: result.message.status,
                deliveryStatus: result.message.deliveryStatus ?? "queued",
                delivered: false,
              }),
            },
          ],
          details: result.message,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const waitForUpdatesTool: AgentTool = {
    name: "wait_for_updates",
    label: "Wait for Updates",
    description:
      "Wait for teammate updates (mailbox messages, task board updates) with a timeout in seconds.",
    parameters: Type.Object({
      timeoutSeconds: Type.Optional(
        Type.Number({
          description: "Timeout in seconds (1-60, default 10).",
          minimum: 1,
          maximum: 60,
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult> => {
      try {
        const p = params as { timeoutSeconds?: number };
        const timeoutMs =
          Math.min(Math.max(Number(p.timeoutSeconds) || 10, 1), 60) * 1000;
        const start = Date.now();

        // Baseline state
        const [initBoard, initMsgs] = await Promise.all([
          host
            .call<TeamBoardProjection>("team.getBoard", { teamSessionId, callerSessionId })
            .catch(() => null),
          host
            .call<{ messages: unknown[] }>("team.listMessages", {
              teamSessionId,
              callerSessionId,
              sessionId: callerSessionId,
            })
            .catch(() => null),
        ]);
        const baselineRev = initBoard?.revision ?? 0;
        const baselineMsgCount = initMsgs?.messages?.length ?? 0;

        while (Date.now() - start < timeoutMs) {
          if (signal?.aborted) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ updated: false, reason: "aborted" }),
                },
              ],
              details: { updated: false, reason: "aborted" },
            };
          }

          await new Promise((r) => setTimeout(r, 1000));

          const [currBoard, currMsgs] = await Promise.all([
            host
              .call<TeamBoardProjection>("team.getBoard", { teamSessionId, callerSessionId })
              .catch(() => null),
            host
              .call<{ messages: unknown[] }>("team.listMessages", {
                teamSessionId,
                callerSessionId,
                sessionId: callerSessionId,
              })
              .catch(() => null),
          ]);

          if (currBoard && currBoard.revision !== baselineRev) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    updated: true,
                    reason: "task_board_changed",
                    revision: currBoard.revision,
                  }),
                },
              ],
              details: {
                updated: true,
                reason: "task_board_changed",
                revision: currBoard.revision,
              },
            };
          }

          if (currMsgs && currMsgs.messages.length !== baselineMsgCount) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    updated: true,
                    reason: "new_mailbox_messages",
                    count: currMsgs.messages.length,
                  }),
                },
              ],
              details: {
                updated: true,
                reason: "new_mailbox_messages",
                count: currMsgs.messages.length,
              },
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ updated: false, reason: "timeout" }),
            },
          ],
          details: { updated: false, reason: "timeout" },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const interruptAgentTool: AgentTool = {
    name: "interrupt_agent",
    label: "Interrupt Agent",
    description:
      "Interrupt the current running turn of a named teammate. Only available to the Team Lead.",
    parameters: Type.Object({
      memberName: Type.String({
        description: "Name of the teammate to interrupt.",
      }),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      if (!isLead) {
        return {
          content: [
            {
              type: "text",
              text: "Error: TEAM_UNAUTHORIZED: Only the Team Lead may interrupt teammates",
            },
          ],
          details: { error: "TEAM_UNAUTHORIZED" },
        };
      }
      try {
        const p = params as { memberName: string };
        const roster = await host.call<{ members: TeamMemberRecord[] }>(
          "team.getRoster",
          { teamSessionId, callerSessionId },
        );
        const member = roster.members.find((m) => m.name === p.memberName);
        if (!member) {
          return {
            content: [
              {
                type: "text",
                text: "Error: TEAM_TARGET_NOT_FOUND: Member '" + p.memberName + "' not found in team",
              },
            ],
            details: { error: "TEAM_TARGET_NOT_FOUND" },
          };
        }

        const interrupt = await host.call<{ interrupted?: boolean }>(
          "team.interruptMember",
          { teamSessionId, callerSessionId, memberName: p.memberName },
        );
        const interrupted = interrupt.interrupted === true;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                interrupted,
                memberName: p.memberName,
                turnInterrupted: interrupted,
              }),
            },
          ],
          details: {
            interrupted: true,
            memberName: p.memberName,
            turnInterrupted: interrupted,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const taskCreateTool: AgentTool = {
    name: "task_create",
    label: "Create Task",
    description: "Create a new shared task on the team task board.",
    parameters: Type.Object({
      subject: Type.String({
        description: "Brief title or summary of the task.",
      }),
      description: Type.Optional(
        Type.String({ description: "Detailed task requirements." }),
      ),
      blockedBy: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "IDs of tasks that must complete before this task can start.",
        }),
      ),
      writeScopes: Type.Optional(
        Type.Array(Type.String(), {
          description: "File/directory paths this task expects to modify.",
        }),
      ),
      ownerMemberName: Type.Optional(
        Type.String({
          description: "Name of the teammate assigned to this task.",
        }),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const p = params as {
          subject: string;
          description?: string;
          blockedBy?: string[];
          writeScopes?: string[];
          ownerMemberName?: string;
        };
        const result = await host.call<{ task: TeamTaskRecord }>(
          "team.createTask",
          {
            teamSessionId,
            callerSessionId,
            subject: p.subject,
            description: p.description,
            blockedBy: p.blockedBy,
            writeScopes: p.writeScopes,
            ownerMemberName: p.ownerMemberName,
          },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ task: result.task }),
            },
          ],
          details: result.task,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const taskUpdateTool: AgentTool = {
    name: "task_update",
    label: "Update Task",
    description:
      "Update an existing task on the team task board with optimistic concurrency check (expectedRevision).",
    parameters: Type.Object({
      taskId: Type.String({ description: "ID of the task to update." }),
      expectedRevision: Type.Number({
        description:
          "The revision of the task you are updating (CAS revision check).",
      }),
      subject: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([
          Type.Literal("pending"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
          Type.Literal("failed"),
          Type.Literal("cancelled"),
        ]),
      ),
      blockedBy: Type.Optional(Type.Array(Type.String())),
      writeScopes: Type.Optional(Type.Array(Type.String())),
      ownerMemberName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      deleted: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const p = params as {
          taskId: string;
          expectedRevision: number;
          subject?: string;
          description?: string;
          status?: TeamTaskStatus;
          blockedBy?: string[];
          writeScopes?: string[];
          ownerMemberName?: string | null;
          deleted?: boolean;
        };
        const result = await host.call<{ task: TeamTaskRecord }>(
          "team.updateTask",
          {
            teamSessionId,
            callerSessionId,
            taskId: p.taskId,
            expectedRevision: p.expectedRevision,
            subject: p.subject,
            description: p.description,
            status: p.status,
            blockedBy: p.blockedBy,
            writeScopes: p.writeScopes,
            ownerMemberName: p.ownerMemberName,
            deleted: p.deleted,
          },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ task: result.task }),
            },
          ],
          details: result.task,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const taskListTool: AgentTool = {
    name: "task_list",
    label: "List Tasks",
    description: "List all active and completed tasks on the team task board.",
    parameters: Type.Object({
      includeDeleted: Type.Optional(
        Type.Boolean({
          description: "Whether to include deleted/tombstoned tasks.",
        }),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const p = params as { includeDeleted?: boolean };
        const board = await host.call<TeamBoardProjection>("team.getBoard", {
          teamSessionId,
          callerSessionId,
        });
        const tasks = p.includeDeleted
          ? board.tasks
          : board.tasks.filter((t) => !t.deleted);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ tasks, revision: board.revision }),
            },
          ],
          details: board,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const taskGetTool: AgentTool = {
    name: "task_get",
    label: "Get Task",
    description: "Get a single task by ID from the team task board.",
    parameters: Type.Object({
      taskId: Type.String({ description: "Task ID." }),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
      try {
        const p = params as { taskId: string };
        const board = await host.call<TeamBoardProjection>("team.getBoard", {
          teamSessionId,
          callerSessionId,
        });
        const task = board.tasks.find((t) => t.taskId === p.taskId);
        if (!task) {
          return {
            content: [
              {
                type: "text",
                text: "Error: TEAM_TASK_NOT_FOUND: Task '" + p.taskId + "' not found",
              },
            ],
            details: { error: "TEAM_TASK_NOT_FOUND" },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ task }),
            },
          ],
          details: task,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const teamStatusTool: AgentTool = {
    name: "team_status",
    label: "Team Status",
    description:
      "Get full Expert Team status, including roster of members, task board, and current paused state.",
    parameters: Type.Object({}),
    execute: async (): Promise<AgentToolResult> => {
      try {
        const [roster, board] = await Promise.all([
          host.call<TeamRosterProjection>("team.getRoster", {
            teamSessionId,
            callerSessionId,
          }),
          host.call<TeamBoardProjection>("team.getBoard", {
            teamSessionId,
            callerSessionId,
          }),
        ]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                teamSessionId: roster.teamSessionId,
                paused: roster.paused,
                revision: board.revision,
                members: roster.members,
                tasks: board.tasks,
                readiness: board.readiness,
                scopeOverlaps: board.scopeOverlaps,
              }),
            },
          ],
          details: { roster, board },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: "Error: " + message,
            },
          ],
          details: { error: message },
        };
      }
    },
  };

  const tools = [
    ...(isLead ? [declareTeamStrategyTool] : []),
    spawnTeammateTool,
    sendMessageTool,
    waitForUpdatesTool,
    interruptAgentTool,
    taskCreateTool,
    taskUpdateTool,
    taskListTool,
    taskGetTool,
    teamStatusTool,
  ];
  return tools;
}
