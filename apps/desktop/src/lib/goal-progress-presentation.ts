import type { GoalProgressSnapshot, PlanProposal } from "@pi-desktop/shared";

export function shouldShowGoalProgressBar({
  proposal,
  reportReady,
}: {
  proposal: PlanProposal | null | undefined;
  reportReady: boolean;
}): boolean {
  if (!proposal) return false;
  const isGoal = (proposal.executionKind ?? proposal.kind) === "goal";
  if (!isGoal) return false;
  if (!proposal.executionId) return false;
  if (proposal.executionState === "interrupted") return false;

  const isTerminal =
    proposal.executionState === "completed";

  if (isTerminal && reportReady) {
    return false;
  }

  return (
    proposal.executionState === "queued" ||
    proposal.executionState === "running" ||
    isTerminal
  );
}

export type GoalCapsuleState =
  | { kind: "error"; message: string }
  | { kind: "initializing"; message: string }
  | { kind: "progress"; completedCount: number; totalCount: number; ratio: number };

export type GoalProgressViewState = {
  executionId: string;
  progress: GoalProgressSnapshot | null;
  reportReady: boolean;
  error: string | null;
  loading: boolean;
};

export function selectExecutionProgressState(
  state: GoalProgressViewState,
  executionId: string,
): GoalProgressViewState {
  return state.executionId === executionId
    ? state
    : { executionId, progress: null, reportReady: false, error: null, loading: true };
}

export function shouldAcceptGoalProgressSnapshot(
  current: Pick<GoalProgressSnapshot, "revision"> | null,
  incoming: Pick<GoalProgressSnapshot, "revision"> | null,
): boolean {
  return incoming !== null && (current === null || incoming.revision > current.revision);
}

export function resolveGoalCapsuleState({
  loading,
  error,
  progress,
  labels,
}: {
  loading: boolean;
  error: string | null;
  progress: GoalProgressSnapshot | null;
  labels?: {
    initializing?: string;
    failed?: string;
  };
}): GoalCapsuleState {
  if (error) {
    return { kind: "error", message: labels?.failed ?? "进度读取失败" };
  }
  const items = progress?.items ?? [];
  if (loading || items.length === 0) {
    return { kind: "initializing", message: labels?.initializing ?? "准备中..." };
  }
  const totalCount = items.length;
  const completedCount = items.filter((i) => i.status === "completed").length;
  return {
    kind: "progress",
    completedCount,
    totalCount,
    ratio: totalCount > 0 ? completedCount / totalCount : 0,
  };
}
