import { describe, expect, it, vi } from "vitest";
import {
  GoalReportDraftManager,
  SUBMIT_GOAL_REPORT_TOOL_NAME,
} from "./goal-report-tool.js";

describe("GoalReportDraftManager", () => {
  it("builds the SubmitGoalReport tool definition", () => {
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
    });
    const tool = manager.buildTool();
    expect(tool.name).toBe(SUBMIT_GOAL_REPORT_TOOL_NAME);
    expect(tool.executionMode).toBe("sequential");
  });

  it("records valid draft and triggers onDraftSubmitted", async () => {
    const onDraftSubmitted = vi.fn();
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftSubmitted,
    });
    const tool = manager.buildTool();

    const result = await tool.execute("call-1", {
      summary: "Completed work successfully.",
      verdict: "met",
      metrics: [{ label: "Tests", value: "5/5" }],
    });

    expect((result.details as any)?.ok).toBe(true);
    expect(manager.isDraftValid()).toBe(true);
    expect(manager.draft?.verdict).toBe("met");
    expect(manager.draft?.summary).toBe("Completed work successfully.");
    expect(onDraftSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "met" }),
    );
  });

  it("rejects invalid draft with validation error", async () => {
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
    });
    const tool = manager.buildTool();

    const result = await tool.execute("call-1", {
      // missing summary
      verdict: "met",
    });

    expect((result.details as any)?.ok).toBe(false);
    expect(manager.isDraftValid()).toBe(false);
  });

  it("supports repeated submissions with idempotent replacement", async () => {
    const submitted: string[] = [];
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftSubmitted: (draft) => {
        submitted.push(draft.summary);
      },
    });
    const tool = manager.buildTool();

    await tool.execute("call-1", { summary: "First draft", verdict: "partial" });
    expect(manager.draft?.summary).toBe("First draft");
    expect(manager.draft?.verdict).toBe("partial");

    await tool.execute("call-2", { summary: "Second updated draft", verdict: "met" });
    expect(manager.draft?.summary).toBe("Second updated draft");
    expect(manager.draft?.verdict).toBe("met");
    expect(submitted).toEqual(["First draft", "Second updated draft"]);
  });

  it("invalidates draft and calls onDraftInvalidated", async () => {
    const onDraftInvalidated = vi.fn();
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftInvalidated,
    });
    const tool = manager.buildTool();

    await tool.execute("call-1", { summary: "Draft", verdict: "met" });
    expect(manager.isDraftValid()).toBe(true);

    await manager.invalidate();
    expect(manager.isDraftValid()).toBe(false);
    expect(manager.draft).toBeNull();
    expect(onDraftInvalidated).toHaveBeenCalledTimes(1);

    // Calling invalidate again when draft is null does not re-trigger callback
    await manager.invalidate();
    expect(onDraftInvalidated).toHaveBeenCalledTimes(1);

    // Resubmitting recovers validity
    await tool.execute("call-2", { summary: "New Draft", verdict: "met" });
    expect(manager.isDraftValid()).toBe(true);
    expect(manager.draft?.summary).toBe("New Draft");
    expect(manager.draft?.summary).toBe("New Draft");
  });

  it("surfaces a persistence failure instead of reporting a recorded draft", async () => {
    // A swallowed failure would let the agent believe the Host received a
    // structured report while it actually publishes a fallback, so the tool must
    // fail loudly and drop the draft rather than look successful.
    const onDraftPersistenceFailure = vi.fn();
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftSubmitted: () => {
        throw new Error("private transport detail");
      },
      onDraftPersistenceFailure,
    });
    const tool = manager.buildTool();

    await expect(
      tool.execute("call-1", { summary: "Draft", verdict: "met" }),
    ).rejects.toThrow(/could not be persisted to the host/);
    expect(manager.isDraftValid()).toBe(false);
    expect(manager.draft).toBeNull();
    expect(onDraftPersistenceFailure).toHaveBeenCalledOnce();

    // A later successful submission restores validity.
    const recovered = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftSubmitted: () => {},
    });
    await recovered.buildTool().execute("call-2", { summary: "Retry", verdict: "met" });
    expect(recovered.isDraftValid()).toBe(true);
  });

  it("clears the local draft and reports invalidation persistence failures", async () => {
    const onDraftInvalidated = vi.fn().mockRejectedValue(new Error("host unavailable"));
    const onDraftInvalidationFailure = vi.fn();
    const manager = new GoalReportDraftManager({
      executionId: "exec-1",
      sessionId: "sess-1",
      onDraftInvalidated,
      onDraftInvalidationFailure,
    });

    await manager.buildTool().execute("call-1", { summary: "Draft", verdict: "met" });
    await expect(manager.invalidate()).rejects.toThrow("host unavailable");
    expect(manager.isDraftValid()).toBe(false);
    expect(manager.draft).toBeNull();
    expect(onDraftInvalidationFailure).toHaveBeenCalledOnce();
  });
});
