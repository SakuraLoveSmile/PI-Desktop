import { describe, expect, it } from "vitest";
import {
  GOAL_PROGRESS_KV_NAMESPACE,
  GOAL_PROGRESS_SCHEMA_VERSION,
  isGoalProgressItemStatus,
  validateGoalProgressItems,
  validateGoalProgressSnapshot,
  type GoalProgressSnapshot,
} from "./goal-progress";

describe("Goal Progress Shared Contract", () => {
  it("defines schema constants", () => {
    expect(GOAL_PROGRESS_SCHEMA_VERSION).toBe(1);
    expect(GOAL_PROGRESS_KV_NAMESPACE).toBe("goal_progress_v1");
  });

  it("checks valid item statuses", () => {
    expect(isGoalProgressItemStatus("pending")).toBe(true);
    expect(isGoalProgressItemStatus("in_progress")).toBe(true);
    expect(isGoalProgressItemStatus("completed")).toBe(true);
    expect(isGoalProgressItemStatus("failed")).toBe(true);
    expect(isGoalProgressItemStatus("")).toBe(false);
    expect(isGoalProgressItemStatus(null)).toBe(false);
  });

  it("validates progress items array and rejects duplicate or malformed items", () => {
    const valid = [
      { id: "item-1", label: "Read requirements", status: "completed" },
      { id: "item-2", label: "Implement core logic", status: "in_progress" },
      { id: "item-3", label: "Run test suite", status: "pending" },
      { id: "item-4", label: "Build release", status: "failed" },
    ];
    const res = validateGoalProgressItems(valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.items).toHaveLength(4);
      expect(res.items[0].id).toBe("item-1");
    }

    // Duplicate ID
    const duplicate = [
      { id: "item-1", label: "Task 1", status: "pending" },
      { id: "item-1", label: "Task 1 duplicate", status: "completed" },
    ];
    expect(validateGoalProgressItems(duplicate).ok).toBe(false);

    // Invalid status
    const invalidStatus = [
      { id: "item-1", label: "Task 1", status: "done" },
    ];
    expect(validateGoalProgressItems(invalidStatus).ok).toBe(false);

    // Empty label
    const emptyLabel = [
      { id: "item-1", label: "   ", status: "pending" },
    ];
    expect(validateGoalProgressItems(emptyLabel).ok).toBe(false);

    // Not an array
    expect(validateGoalProgressItems(null).ok).toBe(false);
  });

  it("validates full GoalProgressSnapshot structure", () => {
    const validSnapshot: GoalProgressSnapshot = {
      schemaVersion: 1,
      sessionId: "session-123",
      proposalId: "prop-456",
      executionId: "exec-789",
      revision: 1,
      items: [
        { id: "task-1", label: "First step", status: "completed" },
      ],
      updatedAt: Date.now(),
    };
    expect(validateGoalProgressSnapshot(validSnapshot)).toBe(true);

    // Invalid schemaVersion
    expect(
      validateGoalProgressSnapshot({ ...validSnapshot, schemaVersion: 2 }),
    ).toBe(false);

    // Invalid revision
    expect(
      validateGoalProgressSnapshot({ ...validSnapshot, revision: 0 }),
    ).toBe(false);

    // Missing sessionId
    expect(
      validateGoalProgressSnapshot({ ...validSnapshot, sessionId: "" }),
    ).toBe(false);
  });
});
