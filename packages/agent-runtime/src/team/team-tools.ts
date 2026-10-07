/**
 * DSH 9 Expert Team Agent Tools (ADR 0304).
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RuntimeHost } from "../host-client.js";
import { createWaitForUpdatesTool } from "./wait-for-updates.js";
import {
  TEAM_TASK_SUBJECT_GUIDANCE,
  TEAM_STRATEGY_REASON_GUIDANCE,
  TEAM_MEMBER_DESCRIPTION_GUIDANCE,
  TEAM_MEMBER_DISPLAY_NAME_GUIDANCE,
} from "./team-prompt.js";
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
  MAX_TEAM_MEMBERS,
  type TeamWorkPurpose, type TeamPlanningProjection, type StructuredResearchResult, type TeamResearchResult,
  SUBMIT_RESEARCH_RESULT_TOOL_NAME,
} from "@pi-desktop/shared";

export interface TeamToolsOptions {
  teamSessionId: string;
  callerSessionId: string;
  isLead: boolean;
  mode?: string;
  workPurpose?: TeamWorkPurpose;
  planningId?: string;
  roundId?: string;
  host: RuntimeHost;
  getTurnId?: () => string | undefined;
  approvedExecution?: () => boolean;
  captureInboxYield?: () => ((toolCallId: string) => boolean) | undefined;
  abortActiveTurn?: (memberSessionId: string) => Promise<boolean>;
}

export function createTeamTools(opts: TeamToolsOptions): AgentTool[] {
  const { teamSessionId, callerSessionId, isLead, host } = opts;
  const declareTeamStrategyTool: AgentTool = {
    name: DECLARE_TEAM_STRATEGY_TOOL_NAME,
    label: "Declare Team Strategy",
    description:
      "Expert Team mode requires expert delegation. Declare at least one named expert with a role and context. In Plan mode, the Host automatically starts a read-only research roster without user confirmation; immediately assign owned tasks and dispatch researchers. In Agent execution mode, stop for trusted user launch review before dispatch. Solo execution and lead_only are unavailable.",
    parameters: Type.Object({
      strategy: Type.Literal("delegate", {
        description: "Required delegation strategy. Expert Team mode does not permit lead_only.",
      }),
      reason: Type.String({
        description: TEAM_STRATEGY_REASON_GUIDANCE,
        minLength: 1,
        maxLength: MAX_TEAM_STRATEGY_REASON_CHARS,
      }),
      members: Type.Array(
          Type.Object({
            name: Type.String({
              description: "Permanent, stable English alphanumeric/underscore routing handle for this proposed expert. Do not translate it; use presentation.displayName for display.",
              minLength: 1,
              maxLength: 64,
            }),
            description: Type.Optional(Type.String({ description: TEAM_MEMBER_DESCRIPTION_GUIDANCE })),
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
                displayName: Type.String({ description: TEAM_MEMBER_DISPLAY_NAME_GUIDANCE, minLength: 1, maxLength: 64 }),
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
          { description: "At least one proposed expert is required in Expert Team mode.", minItems: 1, maxItems: MAX_TEAM_MEMBERS },
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
                launchPolicy: result.review?.launchPolicy ?? "user_confirmed",
                awaitingUserApproval: result.review?.status === "pending",
                ...(result.review?.status === "pending" ? {
                  nextStep: opts.approvedExecution?.()
                    ? "Explain the proposal and keep this approved execution open while waiting for trusted roster confirmation. After confirmation use wait_for_updates to consume authenticated Team messages in this same execution; dispatch owned expert tasks and await their full results before completion."
                    : "Explain the proposal and stop this turn. Wait for trusted user review confirmation before executing work or submitting a plan.",
                } : result.review?.status === "confirmed" ? {
                  nextStep: result.review.launchPolicy === "automatic_plan"
                    ? "The read-only researchers are ready automatically. Do not ask for roster confirmation or stop to explain dispatch: create owned research tasks, send_message each taskId to its researcher, and await full structured research results. Synthesize settled findings and questions, then call SubmitPlan for user approval of the implementation plan."
                    : "The user confirmed the execution roster. Create owned tasks and dispatch the approved experts; await actual expert participation before substantive execution or completion.",
                } : {}),
                memberSessionIds: result.decision.memberSessionIds,
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

  const waitForUpdatesTool = createWaitForUpdatesTool({ ...opts,
    captureInboxYield: isLead && opts.mode === "plan" ? opts.captureInboxYield : undefined,
  });

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

  const researchOwner = Type.String({
    description: "Name of the approved researcher assigned to this task. Required for Plan research; send_message does not assign ownership.",
    minLength: 1,
  });
  const taskCreateTool: AgentTool = {
    name: "task_create",
    label: "Create Task",
    description: "Create a new shared task on the team task board.",
    parameters: Type.Object({
      subject: Type.String({
        description: TEAM_TASK_SUBJECT_GUIDANCE,
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
      ownerMemberName: isLead && opts.mode === "plan"
        ? researchOwner
        : Type.Optional(researchOwner),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult> => {
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
      subject: Type.Optional(Type.String({ description: TEAM_TASK_SUBJECT_GUIDANCE })),
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
              text: JSON.stringify({ task, planning: await host.call<TeamPlanningProjection | null>("team.getPlanning", {teamSessionId,callerSessionId}) }),
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
        const [roster, board, planning] = await Promise.all([
          host.call<TeamRosterProjection>("team.getRoster", {
            teamSessionId,
            callerSessionId,
          }),
          host.call<TeamBoardProjection>("team.getBoard", {
            teamSessionId,
            callerSessionId,
          }),
          host.call<TeamPlanningProjection | null>("team.getPlanning", {teamSessionId, callerSessionId}),
        ]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                planning,
                ...(isLead && planning && (planning.pendingMessagesCount ?? 0) > 0 ? {
                  nextStep: "Expert messages are pending. Finish the current aggregation turn to let the mailbox consume their full contents; do not keep waiting while holding the Lead turn. Resume synthesis after those messages are consumed, then call SubmitPlan.",
                } : {}),
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
          details: { roster, board, planning },
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

  const submitResearchTool: AgentTool = {
    name: SUBMIT_RESEARCH_RESULT_TOOL_NAME, label: "Submit Research Result",
    description: "Submit bounded findings for your assigned research task. Atomically completes it.",
    parameters: Type.Object({taskId: Type.String(), expectedRevision: Type.Integer({minimum:1}), structuredResult: Type.Object({
      summary: Type.String({minLength:1,maxLength:4000}),
      findings: Type.Array(Type.String({maxLength:2000}),{maxItems:32}),
      risks: Type.Array(Type.String({maxLength:2000}),{maxItems:32}),
      recommendations: Type.Array(Type.String({maxLength:2000}),{maxItems:32}),
      verifiedSources: Type.Array(Type.String({maxLength:2000}),{maxItems:32}),
    })}),
    execute: async (_id,params) => {
      const p=params as {taskId:string;expectedRevision:number;structuredResult:StructuredResearchResult};
      const result=await host.call<{result:TeamResearchResult}>("team.submitResearchResult",{teamSessionId,callerSessionId,planningId:opts.planningId,roundId:opts.roundId,taskId:p.taskId,expectedRevision:p.expectedRevision,structuredResult:p.structuredResult});
      return {content:[{type:"text",text:JSON.stringify({...result,nextStep:"Your structured research result has already been reported to the Lead. Finish this research turn. Use send_message only for meaningful additional updates or questions; no completion message is needed."})}],details:result};
    },
  };
  if (opts.workPurpose === "plan_research") return [sendMessageTool,waitForUpdatesTool,taskUpdateTool,taskListTool,taskGetTool,teamStatusTool,submitResearchTool];
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
