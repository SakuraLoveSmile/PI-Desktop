import type { GoalExecutionResult, GoalModelOverride } from "@pi-desktop/shared";

type ResumeInput = { sessionId: string; executionId: string; expectedVersion: number; message?: string; modelOverride?: GoalModelOverride };
type Dependencies<T> = {
  resume: (input: ResumeInput) => Promise<T>;
  refreshSessions: () => Promise<void>;
  onRefreshFailed: (error: unknown) => void;
};

export async function resumeGoalAndRefreshSessions<T extends GoalExecutionResult>(input: ResumeInput, deps: Dependencies<T>): Promise<T> {
  const result = await deps.resume(input);
  if (result.execution?.id !== input.executionId || result.execution.sessionId !== input.sessionId) {
    throw new Error("GOAL_EXECUTION_SCOPE_MISMATCH");
  }
  // Host restored the approved permission ceiling. Refresh only canonical
  // summaries by durable id, preserving whichever session/turn is now visible.
  try { await deps.refreshSessions(); }
  catch (error) {
    // The turn is already accepted; keep its draft consumed and surface a
    // separate synchronization warning rather than inviting duplicate resume.
    deps.onRefreshFailed(error);
  }
  return result;
}
