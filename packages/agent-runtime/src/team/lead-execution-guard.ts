import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Mode, PlanSubmitResult, TeamLaunchReview } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";
import { createWaitForUpdatesTool } from "./wait-for-updates.js";
import { classifyAgentError } from "../agent-errors.js";
import { recoverFinalAnswer, type FinalAnswerRecovery } from "../final-answer-recovery.js";

interface LeadTurn { turnId: string | undefined; epoch: number; mode: Mode; inactive: boolean }
type Completion = { kind: "authorized" | "stale" | "superseded" | "recover" }
  | { kind: "error"; error: ReturnType<typeof classifyAgentError> };

const TEAM_COMPLETION_NUDGE = [
  "<team_completion_recovery>",
  "Expert Team mode requires actual expert participation; your previous final answer did not satisfy that requirement.",
  "If this turn has no approved roster, call declare_team_strategy with strategy delegate and at least one expert, then explain the pending review and stop for trusted user confirmation.",
  "If the roster is already approved, do not redeclare it: create owned tasks, dispatch to approved experts using send_message, and use wait_for_updates to receive the full expert results; keep the approved execution running until assigned experts and their results settle.",
  "Do not finish alone, claim expert participation without Host evidence, or bypass the user review. Coordinate expert results before your final answer.",
  "</team_completion_recovery>",
].join("\n");

const TEAM_PLAN_COMPLETION_NUDGE = [
  "<team_completion_recovery>",
  "Expert Team Plan mode requires actual read-only expert research; your previous final answer did not satisfy that requirement.",
  "Automatically declare delegate with at least one researcher using declare_team_strategy if the current research roster is not ready. The Host materializes the researchers without user confirmation.",
  "Do not ask the user to approve the research roster or stop to explain dispatch. Create owned research tasks, dispatch each taskId using send_message, and await actual research turns and full structured results with wait_for_updates, team_status and task_get.",
  "Once all research results and questions settle, synthesize the implementation plan and call SubmitPlan. Execution roster confirmation belongs only to the later Agent execution phase.",
  "Do not finish alone or claim expert participation without Host evidence.",
  "</team_completion_recovery>",
].join("\n");

/** Owns the single bounded recovery for a Lead final answer lacking participation. */
export class TeamLeadExecutionGuard {
  pending?: LeadTurn;
  attempted = false;
  inProgress = false;
  suppressRunEnd = false;
  private waitingForReview = false;
  private waitAbort?: AbortController;

  cancel(): void { this.waitAbort?.abort(); }

  reset(): void {
    this.cancel();
    this.waitingForReview = false;
    this.pending = undefined;
    this.attempted = false;
    this.inProgress = false;
    this.suppressRunEnd = false;
  }

  async authorizeCompletion(host: RuntimeHost,
    team: { teamSessionId: string; callerSessionId: string }, state: () => LeadTurn, approvedExecution = false): Promise<Completion> {
    const snapshot = state();
    const superseded = () => snapshot.turnId !== state().turnId || snapshot.epoch !== state().epoch;
    const stale = () => superseded() || snapshot.mode !== state().mode || state().inactive;
    let outcome: Completion = { kind: "authorized" };
    try {
      const { review } = await host.call<{ review: TeamLaunchReview | null }>(
        "team.getLaunchReview", { teamSessionId: team.teamSessionId });
      if (approvedExecution && !stale()) {
        const active = await host.call<{ active: boolean; reviewStatus?: string }>("team.getLeadExecutionState", {
          ...team, expectedTurnId: snapshot.turnId,
        });
        if (!stale() && active?.active && active.reviewStatus === "pending") {
          this.pending = snapshot;
          this.waitingForReview = true;
          this.suppressRunEnd = true;
          return { kind: "recover" };
        }
      }
      if (stale()) outcome = { kind: "stale" };
      else if (!(snapshot.mode === "agent" && review &&
        (review.launchPolicy ?? "user_confirmed") === "user_confirmed" &&
        review.teamSessionId === team.teamSessionId && review.leadTurnId === snapshot.turnId &&
        review.status === "pending" && (review.strategy ?? "delegate") === "delegate" &&
        Array.isArray(review.members) && review.members.length > 0)) {
        const authority = await host.call<{ authorized: boolean }>("team.authorizeLeadTool", {
          teamSessionId: team.teamSessionId, callerSessionId: team.callerSessionId, toolName: "TeamFinalAnswer",
        });
        if (stale()) outcome = { kind: "stale" };
        else if (authority?.authorized !== true) {
          throw Object.assign(new Error("TEAM_APPROVAL_REQUIRED: Expert Team completion is not authorized"), {
            code: "TEAM_APPROVAL_REQUIRED",
          });
        }
      }
    } catch (cause) {
      if (stale()) outcome = { kind: "stale" };
      else {
        const error = classifyAgentError(cause);
        const approvalRequired = error.code === "TEAM_APPROVAL_REQUIRED" ||
          (cause instanceof Error && cause.message.startsWith("TEAM_APPROVAL_REQUIRED"));
        if (approvalRequired && !this.attempted) {
          this.attempted = true;
          this.pending = snapshot;
          this.suppressRunEnd = true;
          return { kind: "recover" };
        }
        outcome = { kind: "error", error: {
          ...error,
          ...(approvalRequired ? {
            code: "TEAM_APPROVAL_REQUIRED",
            message: snapshot.mode === "plan"
              ? "Expert Team planning stopped because the Lead did not coordinate actual read-only expert research."
              : "Expert Team stopped because the Lead did not propose approved experts or coordinate actual expert participation.",
            retriable: true,
          } : {}),
          details: { ...error.details, origin: "local", stage: "team_completion" },
        } };
      }
    }
    return superseded() ? { kind: "superseded" } : outcome;
  }

  async recover(runtime: FinalAnswerRecovery & {
    state: () => LeadTurn;
    abort: (error?: ReturnType<typeof classifyAgentError>) => void;
    host: RuntimeHost;
    team: { teamSessionId: string; callerSessionId: string };
  }): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    const awaitingReview = this.waitingForReview;
    this.waitingForReview = false;
    const controller = new AbortController();
    this.waitAbort = controller;
    const ownsTurn = () => {
      const current = runtime.state();
      return pending.epoch === current.epoch && pending.turnId === current.turnId;
    };
    const executionState = () => abortableHostCall<{ active: boolean; reviewStatus?: string }>(runtime.host,
      "team.getLeadExecutionState", { ...runtime.team, expectedTurnId: pending.turnId }, controller.signal);
    try {
      if (awaitingReview) {
        const wait = createWaitForUpdatesTool({ ...runtime.team, host: runtime.host });
        while (!controller.signal.aborted) {
          const state = runtime.state();
          if (state.inactive || state.turnId !== pending.turnId || state.epoch !== pending.epoch || state.mode !== pending.mode) break;
          const execution = await executionState();
          if (!execution.active || execution.reviewStatus === "cancelled" || execution.reviewStatus === "interrupted") break;
          if (execution.reviewStatus === "confirmed") break;
          const update = await wait.execute("team-review-wait", { timeoutSeconds: 60 }, controller.signal);
          if (update.details && typeof update.details === "object" && "error" in update.details) throw new Error(String(update.details.error));
        }
      }
      this.suppressRunEnd = false;
      const current = runtime.state();
      if (pending.epoch !== current.epoch || pending.turnId !== current.turnId) return;
      if (current.inactive || pending.mode !== current.mode) { runtime.abort(); return; }
      if (awaitingReview) {
        const execution = await executionState();
        const state = runtime.state();
        if (!ownsTurn()) return;
        if (state.inactive || state.mode !== pending.mode) { runtime.abort(); return; }
        if (!execution.active || execution.reviewStatus !== "confirmed") { runtime.abort(); return; }
      }
      await recoverFinalAnswer(awaitingReview
        ? "The Host confirmed the expert roster for this SAME approved execution. Continue the exact approved contract without renegotiation. Call wait_for_updates to read authenticated confirmation mail, create owned tasks, dispatch approved experts, then call wait_for_updates to consume their full results within this turn. Keep GoalProgress and SubmitGoalReport bound to this execution."
        : pending.mode === "plan" ? TEAM_PLAN_COMPLETION_NUDGE : TEAM_COMPLETION_NUDGE, {
        ...runtime,
        start: () => { this.inProgress = true; runtime.start(); },
        restore: () => {
          runtime.restore();
          this.inProgress = false;
          this.suppressRunEnd = false;
        },
      });
    } catch (cause) {
      if (ownsTurn()) runtime.abort(controller.signal.aborted ? undefined : classifyAgentError(cause));
    } finally {
      if (this.waitAbort === controller) this.waitAbort = undefined;
      if (ownsTurn()) { this.inProgress = false; this.suppressRunEnd = false; }
    }
  }
}

/** Cancel waiting without requiring the transport to settle; late failures remain handled. */
function abortableHostCall<T>(host: RuntimeHost, method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Execution interrupted.", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => host.call<T>(method, params)).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Team Plan may yield normally for full mailbox evidence; other contracts cannot. */
export function teamPlanSubmission(enabled: boolean, state: () => LeadTurn, signal?: AbortSignal) {
  const snapshot = state();
  return {
    assertCurrent(): void {
      if (!enabled) return;
      signal?.throwIfAborted();
      const current = state();
      if (current.inactive || snapshot.turnId !== current.turnId ||
          snapshot.epoch !== current.epoch || snapshot.mode !== current.mode) {
        throw new DOMException("The active submission turn changed.", "AbortError");
      }
    },
    deferredResult(result: PlanSubmitResult): AgentToolResult | undefined {
      if (!enabled || result?.status !== "deferred" || result.reason !== "team_messages_pending" ||
          typeof result.pendingMessagesCount !== "number" || !Number.isSafeInteger(result.pendingMessagesCount) ||
          result.pendingMessagesCount <= 0 || "proposal" in result) return undefined;
      return {
        content: [{ type: "text", text: "Expert messages are pending. End this aggregation turn so the mailbox can consume their full contents, then synthesize and submit the complete plan." }],
        details: result, terminate: true,
      };
    },
  };
}
