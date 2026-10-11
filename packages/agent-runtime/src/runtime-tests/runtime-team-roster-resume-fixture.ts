import "./runtime-test-harness.js";
import { vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, PlanExecution, TeamLaunchReview } from "@pi-desktop/shared";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

export const execution: PlanExecution = {
  id: "approved-goal-1", proposalId: "proposal-1", sessionId: "session-1", kind: "goal",
  plan: "# Approved Goal\nDelegate the implementation to the approved researcher.", title: "Approved Goal",
  question: "Proceed?", artifact: { relativePath: ".pi/goal/approved.md", sha256: "abc", sizeBytes: 10 },
  targetPermissionMode: "auto", state: "running",
};

const pendingReview = {
  schemaVersion: 1, reviewId: "review-1", teamSessionId: "session-1", leadTurnId: "team-turn",
  revision: 1, status: "pending", strategy: "delegate",
  members: [{ name: "researcher", contextKind: "fresh", selection: { providerId: "local", modelId: "local-model", thinkingLevel: "medium" } }],
} satisfies TeamLaunchReview;

type ProviderContext = Parameters<Models["streamSimple"]>[1];
export type Request = { turnId: string; context: ProviderContext };

export function declarationPayload(request: Request): Record<string, unknown> | undefined {
  const message = request.context.messages.slice().reverse().find(message => message.role !== "system");
  if (message?.role !== "toolResult" || message.toolName !== "declare_team_strategy") return undefined;
  const text = message.content.find(part => part.type === "text");
  return text?.type === "text" ? JSON.parse(text.text) as Record<string, unknown> : undefined;
}

/** Only the provider and Host transport are substituted; runtime tools and recovery stay real. */
export function rosterResumeFixture(options: {
  confirmationBetweenReads?: boolean;
  declarationReviewId?: string;
  holdRecoveryReview?: boolean;
} = {}) {
  let review: TeamLaunchReview | null = null;
  let reviewStatus = "pending";
  let dispatched = false;
  let resultsConsumed = false;
  let executionQueries = 0;
  let reviewQueries = 0;
  let releaseReviewRead: (() => void) | undefined;
  const notifications = new Set<(method: string, params: unknown) => void>();
  const events: AgentEventEnvelope["event"][] = [];
  const requests: Request[] = [];
  const changeReview = (status: "confirmed" | "cancelled" | "interrupted") => {
    reviewStatus = status;
    review = { ...pendingReview, status, revision: 2, members: pendingReview.members.map(member => ({
      ...member, selection: { ...member.selection, modelId: "approved-model" },
    })) };
    for (const notify of notifications) notify("team.changed", { teamSessionId: "session-1", revision: 3 });
  };
  const host = {
    onNotification: vi.fn((listener: (method: string, params: unknown) => void) => {
      notifications.add(listener);
      return () => notifications.delete(listener);
    }),
    call: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "goalProgress.issueToken") return { writeToken: "goal-test-token" };
      if (method === "team.declareStrategy") {
        review = pendingReview;
        return { decision: { strategy: "delegate", reason: "Required experts", memberSessionIds: ["stale-proposed-session"] },
          review: { ...review, reviewId: options.declarationReviewId ?? review.reviewId } };
      }
      if (method === "team.getLaunchReview") {
        if (options.holdRecoveryReview && ++reviewQueries === 2) {
          await new Promise<void>(resolve => { releaseReviewRead = resolve; });
        }
        return { review };
      }
      if (method === "team.getLeadExecutionState") {
        executionQueries += 1;
        if (options.confirmationBetweenReads && executionQueries === 1) changeReview("confirmed");
        return { active: true, turnId: "team-turn", reviewStatus };
      }
      if (method === "team.authorizeLeadTool") {
        if (params?.toolName === "TeamFinalAnswer" && (!dispatched || !resultsConsumed)) {
          throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: no settled expert participation"), {
            code: "TEAM_APPROVAL_REQUIRED",
          });
        }
        return { authorized: true };
      }
      if (method === "team.createTask") {
        if (reviewStatus !== "confirmed") throw new Error("TEAM_APPROVAL_REQUIRED");
        return { task: { taskId: "research-task", ownerMemberName: "researcher", revision: 1 } };
      }
      if (method === "team.sendMessage") {
        if (reviewStatus !== "confirmed") throw new Error("TEAM_APPROVAL_REQUIRED");
        dispatched = true;
        return { message: { id: "dispatch-1", status: "delivered" } };
      }
      if (method === "team.readExecutionInbox") {
        resultsConsumed = dispatched;
        return { turnId: "team-turn", messages: [
          { id: "team-review:review-1:confirmed", content: "Roster confirmed." },
          ...(dispatched ? [{ id: "expert-result-1", content: "The approved implementation and verification completed.",
            kind: "completion", sourceTurnId: "expert-turn", replyToMessageId: "dispatch-1" }] : []),
        ] };
      }
      if (method === "team.listMessages") return { messages: [] };
      if (method === "team.getBoard") return {
        revision: reviewStatus === "pending" ? 2 : 3,
        tasks: dispatched ? [{ taskId: "research-task", status: "completed" }] : [],
      };
      if (method === "team.getRoster") return {
        teamSessionId: "session-1", members: dispatched ? [{ name: "researcher", phase: "completed" }] : [],
      };
      return undefined;
    }),
  };
  const runtime = createRuntime({
    executionProfile: "team", host,
    teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true },
    onEvent: envelope => events.push((envelope as AgentEventEnvelope).event),
  });
  const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">; turnId: string;
    liveSessionContext: () => { messages: Agent["state"]["messages"] } };
  view.models = {
    streamSimple: (_model, context) => {
      requests.push({ turnId: view.turnId, context: structuredClone(context) });
      const latest = context.messages.slice().reverse().find(message => message.role !== "system");
      let tool: { name: string; arguments: Record<string, unknown> } | undefined;
      if (requests.length === 1) tool = {
        name: "declare_team_strategy", arguments: { strategy: "delegate", reason: "Required experts", members: [{ name: "researcher" }] },
      };
      // This weak model ignores all system recovery nudges, following only the last tool result.
      else if (latest?.role === "toolResult") {
        if (latest.toolName === "declare_team_strategy" && declarationPayload(requests.at(-1)!)?.status === "confirmed") {
          tool = { name: "task_create", arguments: { subject: "Implement approved task", ownerMemberName: "researcher" } };
        } else if (latest.toolName === "task_create") tool = {
          name: "send_message", arguments: { targetMemberName: "researcher", content: "Complete research-task and return the result.",
            taskDispatch: { taskId: "research-task", expectedRevision: 1 } },
        };
        else if (latest.toolName === "send_message") tool = { name: "wait_for_updates", arguments: { timeoutSeconds: 1 } };
        else if (latest.toolName === "wait_for_updates") tool = { name: "SubmitGoalReport", arguments: { summary: "The approved experts completed the work.", verdict: "met" } };
      }
      const stopReason = tool ? "toolUse" : "stop";
      const message = assistantMessage({ stopReason,
        content: tool ? [{ type: "toolCall", id: `weak-${requests.length}`, ...tool }]
          : [{ type: "text", text: latest?.role === "toolResult" && latest.toolName === "SubmitGoalReport"
            ? "The approved experts completed the work." : "The proposed expert is researcher. Please confirm the roster." }],
      }) as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: stopReason, message });
        stream.end(message);
      });
      return stream;
    },
  };
  return { runtime, host, events, requests, changeReview,
    areResultsConsumed: () => resultsConsumed,
    getMessages: () => view.agent.state.messages,
    getLiveMessages: () => view.liveSessionContext().messages,
    isReviewReadHeld: () => !!releaseReviewRead,
    releaseReviewRead: () => releaseReviewRead?.(),
  };
}
