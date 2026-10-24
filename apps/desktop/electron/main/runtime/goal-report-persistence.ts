import type { GoalReportPersistenceBarrier } from "@pi-desktop/host-runtime";
import type { HostProcess } from "../host-process";
import type { PersistenceOutbox } from "../persistence-outbox";

/** Drain existing transcript writes before Host validates native report proof. */
export function createGoalReportPersistenceBarrier(input: {
  getHost: () => HostProcess | null;
  persistenceOutbox: PersistenceOutbox;
  claimedExecutionSessions: ReadonlyMap<string, string>;
  activeTurns: ReadonlyMap<string, string>;
}): GoalReportPersistenceBarrier {
  return async ({ sessionId, executionId }) => {
    const host = input.getHost();
    const turnId = input.activeTurns.get(sessionId);
    const reject = () => Object.assign(new Error(
      "Goal report tool results are not durably recorded for the current execution. Correct persistence before retrying SubmitGoalReport.",
    ), { errorCode: "INVALID_ARGUMENT" });
    if (!host || !turnId || input.claimedExecutionSessions.get(executionId) !== sessionId) throw reject();
    try {
      await input.persistenceOutbox.flush(() => input.getHost() === host ? host : null);
    } catch {
      throw reject();
    }
    if (input.getHost() !== host || input.activeTurns.get(sessionId) !== turnId ||
        input.claimedExecutionSessions.get(executionId) !== sessionId || input.persistenceOutbox.size(sessionId) > 0) {
      throw reject();
    }
  };
}
