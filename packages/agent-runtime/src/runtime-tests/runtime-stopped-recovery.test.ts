import "./runtime-test-harness.js";
import { expect, it, vi } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope, PlanExecution } from "@pi-desktop/shared";
import { assistantMessage, createRuntime } from "./runtime-test-harness.js";

const cases = ["silent", "progress", "provider", "overflow", "team", "goal"] as const;
const windows = cases.flatMap(recovery => [
  { recovery, window: "armed", order: "user" },
  ...(recovery === "provider" ? [] : [{ recovery, window: "prepared", order: "user" }]),
  ...(["goal", "team"].includes(recovery) ? [
    { recovery, window: "prepared", order: "budget-user" },
    { recovery, window: "prepared", order: "user-budget" },
  ] : []),
]);

it.each(windows)(
  "closes $recovery recovery in the $window window ($order)", async ({ recovery, window, order }) => {
    const events: AgentEventEnvelope["event"][] = [];
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (order === "budget-user") expect(runtime.requestGracefulStop(true).requested).toBe(true);
      void runtime.abort();
      if (order === "user-budget") expect(runtime.requestGracefulStop(true).requested).toBe(true);
    };
    const host = { call: vi.fn(async (method: string) => {
      if (method === "goalProgress.issueToken") return { writeToken: "stopped-report-test" };
      if (method === "team.getLaunchReview") return { review: null };
      if (method === "team.getLeadExecutionState") return { active: false };
      if (method === "team.authorizeLeadTool") throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: Dispatch experts first"), { code: "TEAM_APPROVAL_REQUIRED" });
      return undefined;
    }) };
    const runtime = createRuntime({ host,
      ...(recovery === "team" ? { executionProfile: "team" as const,
        teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true } } : {}),
      onEvent: envelope => {
        const event = (envelope as AgentEventEnvelope).event;
        events.push(event);
        if (window === "prepared" && !stopped && (
          recovery === "overflow" ? event.type === "compaction_end" && event.ok
            : event.type === "status" && event.status.activity?.phase === "recovering"
        )) stop();
      },
    });
    const view = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">;
      autonomousExecution: boolean; pendingSilentTurnRerun: boolean; pendingProgressTurnRerun: boolean;
      pendingProviderRetry?: unknown; pendingOverflow: boolean; teamLeadExecution: { pending?: unknown } };
    let requests = 0;
    view.models = { streamSimple: () => {
      requests++;
      if (stopped) throw new Error("Stop must fence recovery model requests");
      const failed = requests === 1 && (recovery === "provider" || recovery === "overflow");
      const message = { ...assistantMessage({ stopReason: failed ? "error" : "stop",
        content: recovery === "silent" ? [] : [{ type: "text", text: recovery === "progress"
          ? "Writing the remaining checks now." : "Completed the work." }],
      }), ...(failed ? { errorMessage: recovery === "provider" ? "502: Bad Gateway"
        : "400: prompt is too long: 1077172 tokens > 1000000 maximum" } : {}) } as AssistantMessage;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        if (failed) stream.push({ type: "error", reason: "error", error: message });
        else stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      });
      return stream;
    } };
    const idle = view.agent.waitForIdle.bind(view.agent);
    vi.spyOn(view.agent, "waitForIdle").mockImplementation(async () => {
      await idle();
      if (window !== "armed") return;
      const pending = recovery === "silent" ? view.pendingSilentTurnRerun
        : recovery === "progress" ? view.pendingProgressTurnRerun
          : recovery === "provider" ? view.pendingProviderRetry
            : recovery === "overflow" ? view.pendingOverflow : recovery === "goal"
              ? (runtime as unknown as { goalReportRecovery: { pending: boolean } }).goalReportRecovery.pending
              : view.teamLeadExecution.pending;
      expect(pending).toBeTruthy();
      expect(events.filter(event => event.type === "turn_end" || event.type === "agent_end")).toEqual([]);
      stop();
    });
    const execution: PlanExecution = { id: "stopped-execution", proposalId: "proposal", sessionId: "session-1",
      kind: recovery === "goal" ? "goal" : "plan", plan: "# Approved\nVerify the work.", title: "Verify", question: "Proceed?",
      artifact: { relativePath: ".pi/plan/approved.md", sha256: "hash", sizeBytes: 32 },
      targetPermissionMode: "auto", state: "running" };
    try {
      if (recovery === "progress" || recovery === "goal") await runtime.executeApprovedPlan(execution, "stopped-turn");
      else await runtime.prompt("Verify the work", "user", "stopped-turn");
      expect(events.filter(event => event.type === "turn_end" || event.type === "agent_end").map(event => event.type))
        .toEqual(["turn_end", "agent_end"]);
      expect(events.filter(event => event.type === "message_end").map(event => event.message.status)).toEqual(["aborted"]);
      expect(stopped).toBe(true);
      // The short overflow history writes a retained-tail checkpoint without
      // a summary model call; no continuation is admitted after Stop.
      expect(requests).toBe(1);
      expect(runtime.getStatus().isRunning).toBe(false);
      expect(view.autonomousExecution).toBe(false);
    } finally { await runtime.dispose(); }
  },
);
