import { validateGoalProgressSnapshot, type GoalProgressSnapshot, type PlanExecution } from "@pi-desktop/shared";
import type { RuntimeHost } from "./host-client.js";
import { GoalProgressManager } from "./goal-progress-tool.js";

/** Issue a turn-scoped capability and restore authoritative progress on continuation. */
export async function createGoalProgressCapability(options: {
  host: RuntimeHost;
  execution: PlanExecution;
  turnId: string;
  resumed: boolean;
  assertCurrent(): void;
  tokenFailure(error: unknown): void;
}): Promise<GoalProgressManager | undefined> {
  const { host, execution, turnId, assertCurrent } = options;
  let tokenResult: unknown;
  try {
    tokenResult = await host.call("goalProgress.issueToken", {
      sessionId: execution.sessionId, executionId: execution.id, turnId,
    });
  } catch (error) {
    assertCurrent();
    options.tokenFailure(error);
    if (options.resumed) throw error;
    return undefined;
  }
  assertCurrent();
  const writeToken = tokenResult !== null && typeof tokenResult === "object" && !Array.isArray(tokenResult)
    ? (tokenResult as Record<string, unknown>).writeToken : undefined;
  if (typeof writeToken !== "string" || !writeToken.trim()) {
    const error = new Error("Host returned no valid write token");
    options.tokenFailure(error);
    if (options.resumed) throw error;
    return undefined;
  }
  let initialSnapshot: GoalProgressSnapshot | null = null;
  if (options.resumed) {
    const result = await host.call<unknown>("goalProgress.get", {
      sessionId: execution.sessionId, executionId: execution.id,
    });
    assertCurrent();
    const snapshot = result !== null && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>).progress : undefined;
    if (snapshot !== null) {
      if (!validateGoalProgressSnapshot(snapshot) || snapshot.sessionId !== execution.sessionId ||
          snapshot.executionId !== execution.id) throw new Error("Host returned an invalid resumed goal progress snapshot");
      initialSnapshot = snapshot;
    }
  }
  return new GoalProgressManager({
    sessionId: execution.sessionId, executionId: execution.id, writeToken, initialSnapshot,
    onUpdate: async items => {
      const result = await host.call<unknown>("goalProgress.update", {
        sessionId: execution.sessionId, executionId: execution.id, writeToken, items,
      });
      const snapshot = result !== null && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>).progress : undefined;
      if (!validateGoalProgressSnapshot(snapshot) || snapshot.sessionId !== execution.sessionId ||
          snapshot.executionId !== execution.id) throw new Error("Host returned an invalid goal progress snapshot");
      return snapshot;
    },
  });
}
