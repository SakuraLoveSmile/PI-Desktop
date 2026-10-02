import { describe, expect, it, vi } from "vitest";
import {
  GoalProgressManager,
  UPDATE_GOAL_PROGRESS_TOOL_NAME,
} from "./goal-progress-tool.js";
import type { GoalProgressSnapshot } from "@pi-desktop/shared";

describe("GoalProgressManager", () => {
  it("builds the UpdateGoalProgress tool definition", () => {
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate: vi.fn(),
    });
    const tool = manager.buildTool();
    expect(tool.name).toBe(UPDATE_GOAL_PROGRESS_TOOL_NAME);
    expect(tool.executionMode).toBe("sequential");
  });

  it("updates progress with valid items and triggers onUpdate", async () => {
    const mockSnapshot: GoalProgressSnapshot = {
      schemaVersion: 1,
      sessionId: "sess-1",
      proposalId: "prop-1",
      executionId: "exec-1",
      revision: 1,
      items: [
        { id: "step-1", label: "Inspect code", status: "completed" },
        { id: "step-2", label: "Write tests", status: "in_progress" },
      ],
      updatedAt: 123456789,
    };
    const onUpdate = vi.fn().mockResolvedValue(mockSnapshot);
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate,
    });
    const tool = manager.buildTool();

    const result = await tool.execute("call-1", {
      items: [
        { id: "step-1", label: "Inspect code", status: "completed" },
        { id: "step-2", label: "Write tests", status: "in_progress" },
      ],
    });

    expect(result.details).toMatchObject({ ok: true, revision: 1 });
    expect(manager.snapshot).toEqual(mockSnapshot);
    expect(onUpdate).toHaveBeenCalledWith([
      { id: "step-1", label: "Inspect code", status: "completed" },
      { id: "step-2", label: "Write tests", status: "in_progress" },
    ]);
  });

  it("rejects invalid items with validation error", async () => {
    const onUpdate = vi.fn();
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate,
    });
    const tool = manager.buildTool();

    const result = await tool.execute("call-1", {
      items: [
        { id: "step-1", label: "Inspect code", status: "invalid_status" },
      ],
    });

    expect(result.details).toMatchObject({
      ok: false,
      error: expect.stringContaining("status must be one of"),
    });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(manager.snapshot).toBeNull();
  });

  it("handles host update failures gracefully", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("CONFLICT: revision mismatch"));
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate,
    });
    const tool = manager.buildTool();

    const result = await tool.execute("call-1", {
      items: [
        { id: "step-1", label: "Inspect code", status: "completed" },
      ],
    });

    expect(result.details).toMatchObject({
      ok: false,
      error: expect.stringContaining("CONFLICT"),
    });
  });

  it("rejects malformed snapshots returned by the host", async () => {
    const onUpdate = vi.fn().mockResolvedValue({ revision: 2 });
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate,
    });

    const result = await manager.buildTool().execute("call-1", {
      items: [{ id: "step-1", label: "Run checks", status: "failed" }],
    });

    expect(result.details).toMatchObject({ ok: false, error: expect.any(String) });
    expect(manager.snapshot).toBeNull();
  });

  it("rejects snapshots belonging to a different execution", async () => {
    const snapshot: GoalProgressSnapshot = {
      schemaVersion: 1,
      sessionId: "sess-1",
      proposalId: "prop-1",
      executionId: "another-exec",
      revision: 1,
      items: [],
      updatedAt: 123456789,
    };
    const manager = new GoalProgressManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      writeToken: "gptk_test123",
      onUpdate: vi.fn().mockResolvedValue(snapshot),
    });

    const result = await manager.buildTool().execute("call-1", { items: [] });

    expect(result.details).toMatchObject({ ok: false, error: expect.any(String) });
    expect(manager.snapshot).toBeNull();
  });
});
