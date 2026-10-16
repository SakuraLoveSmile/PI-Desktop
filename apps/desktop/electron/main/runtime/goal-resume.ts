import { randomUUID } from "node:crypto";
import type { AgentEventEnvelope, GoalHold, GoalModelOverride, GoalResumeContext, PlanExecution, UiMessage } from "@pi-desktop/shared";
import type { RuntimeState } from "./context";
import type { FinishTurn, LockExecutionInterruption, ExecutionSettlementOptions, PlanRuntimeDependencies } from "./plans";

export type ResumeBlockedGoalInput = {
  sessionId: string;
  executionId: string;
  expectedVersion: number;
  message?: string;
  modelOverride?: GoalModelOverride;
};

type Dependencies = Pick<PlanRuntimeDependencies, "acquireSessionOperation" | "resolveAgentRuntimeLaunch" | "emitAgentEvent"> & {
  runtimeState: RuntimeState;
  activeTurns: Map<string, string>;
  waitForExecutionSettlement: (executionId: string) => Promise<void>;
  registerResumedExecution: (execution: PlanExecution, turnId?: string) => void;
  finishTurn: FinishTurn;
  lockExecutionInterruption: LockExecutionInterruption;
  finishApprovedExecution: (executionId: string, status: "interrupted", errorCode: string, options: ExecutionSettlementOptions) => Promise<void>;
  onGoalResumed: (sessionId: string) => Promise<void>;
};

/** Host owns the CAS; Main owns the new turn and rolls back every failed dispatch. */
export function createGoalResumeRuntime(deps: Dependencies) {
  return async function resumeBlockedGoal(input: ResumeBlockedGoalInput) {
    const release = await deps.acquireSessionOperation(input.sessionId);
    const host = deps.runtimeState.host;
    const sidecar = deps.runtimeState.sidecar;
    let claimed = false;
    let turnId: string | undefined;
    try {
      await deps.waitForExecutionSettlement(input.executionId);
      if (!host || !sidecar) throw new Error("Goal runtime unavailable");
      if (deps.activeTurns.has(input.sessionId)) throw new Error("Session already has an active turn");
      const result = await host.call<{ execution: PlanExecution; hold: GoalHold; resume: GoalResumeContext }>("goalExecutions.resume", {
        sessionId: input.sessionId,
        executionId: input.executionId,
        expectedVersion: input.expectedVersion,
        ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      });
      claimed = true;
      deps.registerResumedExecution(result.execution);
      const [settings, detail] = await Promise.all([
        host.call("settings.get"),
        host.call<{ session?: Record<string, unknown> }>("session.get", { id: input.sessionId }),
      ]);
      if (!detail.session) throw new Error("Session not found");
      const execution = result.execution;
      const launch = await deps.resolveAgentRuntimeLaunch(input.sessionId, detail.session, settings, {
        mode: "agent",
        ...(execution.executionProviderId ? { providerId: execution.executionProviderId } : {}),
        ...(execution.executionModelId ? { modelId: execution.executionModelId } : {}),
      });
      if ((execution.executionProviderId && launch.providerId !== execution.executionProviderId) ||
          (execution.executionModelId && launch.modelId !== execution.executionModelId)) {
        throw new Error("Selected Goal model is unavailable");
      }
      if (deps.runtimeState.host !== host || deps.runtimeState.sidecar !== sidecar) throw new Error("Goal runtime changed");
      const turn = await host.call<{ turnId: string }>("session.beginTurn", {
        sessionId: input.sessionId, providerId: launch.providerId, modelId: launch.modelId, createNotification: false,
        expectedInteractionMode: detail.session.interactionMode === undefined ? "interactive" : detail.session.interactionMode,
      });
      turnId = turn.turnId?.trim();
      if (!turnId) throw new Error("Goal resume turn was not created");
      deps.registerResumedExecution(execution, turnId);
      await host.call("goalReports.bindExecutionTurn", { executionId: input.executionId, turnId });
      const message = input.message?.trim();
      let userMessageId: string | undefined;
      if (message) {
        const userMessage: UiMessage = { id: randomUUID(), role: "user", content: message, status: "complete", createdAt: new Date().toISOString() };
        userMessageId = userMessage.id;
        await host.call("session.appendMessage", { sessionId: input.sessionId, turnId, message: userMessage });
        deps.emitAgentEvent({ sessionId: input.sessionId, turnId, ts: Date.now(), event: { type: "message_end", message: userMessage } } satisfies AgentEventEnvelope);
      }
      if (deps.runtimeState.host !== host || deps.runtimeState.sidecar !== sidecar) throw new Error("Goal runtime changed");
      const accepted = await sidecar.call<{ accepted: boolean }>("agent.executeApprovedPlan", {
        ...launch.sidecarParams, mode: "agent", turnId, execution,
        ...(userMessageId ? { userMessageId } : {}),
        resume: { ...result.resume, ...(message ? { userMessage: message } : {}) },
      });
      if (!accepted?.accepted) throw new Error("Goal resume was not accepted");
      await deps.onGoalResumed(input.sessionId);
      return { ...result, turnId };
    } catch (error) {
      if (claimed && host) {
        if (turnId) deps.lockExecutionInterruption(input.sessionId, turnId, { errorCode: "resume_failed", errored: true, stopHint: "resume_failed" });
        // Cancel a partially accepted segment before releasing its durable claim.
        try {
          if (turnId) {
            await sidecar?.call("agent.abort", { sessionId: input.sessionId, turnId });
          }
        } finally {
          if (turnId) await deps.finishTurn(input.sessionId, "error", "resume_failed", { turnId, createNotification: false });
          await deps.finishApprovedExecution(input.executionId, "interrupted", "resume_failed", { ended: "errored", stopHint: "resume_failed" });
        }
      }
      throw error;
    } finally {
      release();
    }
  };
}
