import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldShowGoalProgressBar,
  resolveGoalCapsuleState,
  selectExecutionProgressState,
  shouldAcceptGoalProgressSnapshot,
} from "../src/lib/goal-progress-presentation.ts";

test("interrupted goal progress does not wait for a completion report", () => {
  assert.equal(shouldShowGoalProgressBar({
    proposal: { kind: "goal", executionId: "interrupted", executionState: "interrupted" },
    reportReady: false,
  }), false);
});

test("execution changes hide previous progress, report readiness, and errors", () => {
  const previous = {
    executionId: "old-execution",
    progress: { executionId: "old-execution", revision: 4, items: [{ id: "old", label: "Old", status: "completed" }] },
    reportReady: true,
    error: "old error",
    loading: false,
  };
  assert.deepEqual(selectExecutionProgressState(previous, "new-execution"), {
    executionId: "new-execution",
    progress: null,
    reportReady: false,
    error: null,
    loading: true,
  });
});

test("goal progress snapshots are accepted only when their revision advances", () => {
  assert.equal(shouldAcceptGoalProgressSnapshot(null, { revision: 2 }), true);
  assert.equal(shouldAcceptGoalProgressSnapshot({ revision: 3 }, { revision: 2 }), false);
  assert.equal(shouldAcceptGoalProgressSnapshot({ revision: 2 }, { revision: 2 }), false);
  assert.equal(shouldAcceptGoalProgressSnapshot({ revision: 2 }, { revision: 3 }), true);
});

test("goal progress bar visibility rules", () => {
  // Not goal proposal
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "plan", executionId: "exec-1", executionState: "running" },
      reportReady: false,
    }),
    false,
  );

  // Goal without executionId
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionState: "running" },
      reportReady: false,
    }),
    false,
  );

  // Goal running
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionId: "exec-1", executionState: "running" },
      reportReady: false,
    }),
    true,
  );

  // Goal queued
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionId: "exec-1", executionState: "queued" },
      reportReady: false,
    }),
    true,
  );

  // Goal completed but report NOT ready yet -> still visible
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionId: "exec-1", executionState: "completed" },
      reportReady: false,
    }),
    true,
  );

  // Goal completed and report ready -> REMOVED
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionId: "exec-1", executionState: "completed" },
      reportReady: true,
    }),
    false,
  );

  // Goal interrupted and report ready -> REMOVED
  assert.equal(
    shouldShowGoalProgressBar({
      proposal: { kind: "goal", executionId: "exec-1", executionState: "interrupted" },
      reportReady: true,
    }),
    false,
  );
});

test("capsule state does not show fake 0/0 or 0% when uninitialized or failed", () => {
  // Error state
  const errState = resolveGoalCapsuleState({
    loading: false,
    error: "Network error",
    progress: null,
  });
  assert.equal(errState.kind, "error");
  assert.equal(errState.message, "进度读取失败");

  // Loading uninitialized
  const loadState = resolveGoalCapsuleState({
    loading: true,
    error: null,
    progress: null,
  });
  assert.equal(loadState.kind, "initializing");
  assert.equal(loadState.message, "准备中...");

  // Progress with empty items
  const emptyState = resolveGoalCapsuleState({
    loading: false,
    error: null,
    progress: { items: [] },
  });
  assert.equal(emptyState.kind, "initializing");
  assert.equal(emptyState.message, "准备中...");

  // Real progress with 3 of 5 completed
  const progressState = resolveGoalCapsuleState({
    loading: false,
    error: null,
    progress: {
      items: [
        { id: "1", label: "T1", status: "completed" },
        { id: "2", label: "T2", status: "completed" },
        { id: "3", label: "T3", status: "completed" },
        { id: "4", label: "T4", status: "in_progress" },
        { id: "5", label: "T5", status: "pending" },
      ],
    },
  });
  assert.equal(progressState.kind, "progress");
  assert.equal(progressState.completedCount, 3);
  assert.equal(progressState.totalCount, 5);
  assert.equal(progressState.ratio, 0.6);
});
