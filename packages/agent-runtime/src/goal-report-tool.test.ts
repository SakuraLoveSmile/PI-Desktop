import { describe, expect, it, vi } from "vitest";
import type { GoalProgressSnapshot } from "@pi-desktop/shared";
import {
  GoalReportDraftManager,
  persistGoalReportFailure,
  SUBMIT_GOAL_REPORT_TOOL_NAME,
} from "./goal-report-tool.js";

describe("GoalReportDraftManager", () => {
  it("does not accept a first submission invalidated by steering while Host persistence is pending", async () => {
    let finishSubmission!: () => void;
    const gate = new Promise<void>((resolve) => { finishSubmission = resolve; });
    let hostDraft: string | null = null;
    const manager = new GoalReportDraftManager({
      sessionId: "sess-1", executionId: "exec-1",
      onDraftSubmitted: async (draft) => { await gate; hostDraft = draft.summary; },
      onDraftInvalidated: () => { hostDraft = null; },
    });
    const submission = manager.buildTool().execute("report", { summary: "Before steering", verdict: "met" });
    await Promise.resolve();
    await manager.invalidate();
    finishSubmission();
    const result = await submission;
    expect(result.details).toMatchObject({ ok: false });
    expect(manager.isDraftValid()).toBe(false);
    expect(hostDraft).toBeNull();
  });

  it("drops an earlier local draft when Host rejects a replacement against newer progress", async () => {
    const onDraftSubmitted = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("UpdateGoalProgress before claiming met"), { errorCode: "INVALID_ARGUMENT" }));
    const onDraftPersistenceFailure = vi.fn();
    const manager = new GoalReportDraftManager({ sessionId: "sess-1", executionId: "exec-1", onDraftSubmitted, onDraftPersistenceFailure });
    await manager.buildTool().execute("before", { summary: "Previously met", verdict: "met" });
    expect(manager.isDraftValid()).toBe(true);
    const rejected = await manager.buildTool().execute("after", { summary: "Still met", verdict: "met" });
    expect(rejected.details).toMatchObject({ ok: false });
    expect(manager.isDraftValid()).toBe(false);
    expect(onDraftPersistenceFailure).not.toHaveBeenCalled();
  });
  it("waits for Host invalidation before persisting a replacement draft", async () => {
    let finishInvalidation!: () => void;
    const gate = new Promise<void>((resolve) => { finishInvalidation = resolve; });
    let hostDraft: string | null = null;
    const manager = new GoalReportDraftManager({
      sessionId: "sess-1", executionId: "exec-1",
      onDraftSubmitted: (draft) => { hostDraft = draft.summary; },
      onDraftInvalidated: async () => { await gate; hostDraft = null; },
    });
    const tool = manager.buildTool();
    await tool.execute("first", { summary: "Before change", verdict: "met" });
    const invalidating = manager.invalidate();
    let replacementSettled = false;
    const replacing = tool.execute("replacement", { summary: "After change", verdict: "met" })
      .then(() => { replacementSettled = true; });
    await Promise.resolve();
    expect(replacementSettled).toBe(false);
    finishInvalidation();
    await Promise.all([invalidating, replacing]);
    expect(hostDraft).toBe("After change");
    expect(manager.isDraftValid()).toBe(true);
  });

  it("returns Host progress validation as a correctable rejection without marking persistence failed", async () => {
    const onDraftPersistenceFailure = vi.fn();
    const manager = new GoalReportDraftManager({
      sessionId: "sess-1", executionId: "exec-1", onDraftPersistenceFailure,
      onDraftSubmitted: () => { throw Object.assign(new Error("UpdateGoalProgress before claiming met"), { errorCode: "INVALID_ARGUMENT" }); },
    });
    const result = await manager.buildTool().execute("report", { summary: "Done", verdict: "met" });
    expect(result.details).toMatchObject({ ok: false, error: expect.stringContaining("UpdateGoalProgress") });
    expect(onDraftPersistenceFailure).not.toHaveBeenCalled();
    expect(manager.isDraftValid()).toBe(false);
  });
  it.each(["pending", "in_progress", "failed"] as const)(
    "requires progress reconciliation for a met report with %s work", async (status) => {
      let snapshot: GoalProgressSnapshot = {
        schemaVersion: 1, sessionId: "sess-1", executionId: "exec-1",
        proposalId: "proposal-1", revision: 1, updatedAt: 1,
        items: [{ id: "check", label: "Run checks", status }],
      };
      const onDraftSubmitted = vi.fn();
      const manager = new GoalReportDraftManager({
        sessionId: "sess-1", executionId: "exec-1", onDraftSubmitted,
        getProgressSnapshot: () => snapshot,
      });
      const tool = manager.buildTool();
      const result = await tool.execute("report", { summary: "Done", verdict: "met" });
      expect(result.details).toMatchObject({ ok: false });
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("UpdateGoalProgress") }),
      ]));
      expect(onDraftSubmitted).not.toHaveBeenCalled();
      expect(manager.isDraftValid()).toBe(false);
      await tool.execute("partial", { summary: "Some work remains", verdict: "partial" });
      expect(manager.isDraftValid()).toBe(true);
      await tool.execute("blocked", { summary: "Cannot run checks", verdict: "blocked" });
      expect(manager.isDraftValid()).toBe(true);
      snapshot = { ...snapshot, revision: 2, items: [{ ...snapshot.items[0]!, status: "completed" }] };
      const accepted = await tool.execute("reconciled", { summary: "Verified", verdict: "met" });
      expect(accepted.details).toMatchObject({ ok: true });
      expect(manager.isDraftValid()).toBe(true);
      snapshot = { ...snapshot, revision: 3, items: [{ ...snapshot.items[0]!, status }] };
      expect(manager.isDraftValid()).toBe(false);
    },
  );

  it("warns that further evidence-changing tools require report resubmission", async () => {
    const manager = new GoalReportDraftManager({ sessionId: "sess-1", executionId: "exec-1" });
    const result = await manager.buildTool().execute("report", { summary: "Done", verdict: "met" });
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringMatching(/invalidate.*SubmitGoalReport/) }),
    ]));
  });
  it("marks draft persistence failures against their owning session", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const execution = { sessionId: "sess-1", executionId: "exec-1" };

    await persistGoalReportFailure(host, execution, "REPORT_DRAFT_PERSIST_FAILED");
    await persistGoalReportFailure(host, execution, "REPORT_DRAFT_INVALIDATION_FAILED");

    expect(host.call).toHaveBeenNthCalledWith(1, "goalReports.markFailed", {
      sessionId: "sess-1",
      executionId: "exec-1",
      errorCode: "REPORT_DRAFT_PERSIST_FAILED",
    });
    expect(host.call).toHaveBeenNthCalledWith(2, "goalReports.markFailed", {
      sessionId: "sess-1",
      executionId: "exec-1",
      errorCode: "REPORT_DRAFT_INVALIDATION_FAILED",
    });
  });

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
