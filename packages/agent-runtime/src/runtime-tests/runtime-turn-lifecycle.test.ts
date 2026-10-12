import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type PlanExecution } from "@pi-desktop/shared";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime per-turn context protection", () => {

  it("reports a Stop during pre-flight compaction as an aborted turn, not a compaction failure", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    agent.prompt = vi.fn();
    vi.spyOn(runtime as any, "automaticCompactionNeeded").mockReturnValue(true);
    // The summary request is in flight when the user presses Stop.
    vi.spyOn(runtime as any, "buildCheckpoint").mockImplementation(
      async (...args: unknown[]) => {
        const signal = args[0] as AbortSignal;
        await runtime.abort();
        return {
          ok: false,
          entries: [],
          budget: { tokens: 0, hardLimit: 1, requestHeadroom: 0 },
          message: "The operation was aborted",
          recoverable: !signal.aborted,
        };
      },
    );

    await expect(runtime.prompt("stopped request", "user-stopped")).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(agent.prompt).not.toHaveBeenCalled();
    expect((runtime as any).fullEntries).toEqual([
      expect.objectContaining({
        id: "user-stopped",
        message: expect.objectContaining({ role: "user", content: "stopped request" }),
      }),
    ]);
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        ok: false,
        error: expect.objectContaining({ code: "TURN_ABORTED" }),
      }),
    );
    expect(
      events.some(
        (event) =>
          JSON.stringify(event).includes("CONTEXT_COMPACTION_FAILED") ||
          event.type === "error",
      ),
    ).toBe(false);
    expect(runtime.getStatus().isRunning).toBe(false);
    await runtime.dispose();
  });

  it("closes an overflow recovery cut short by Stop as aborted", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    vi.spyOn(runtime as any, "runCompaction").mockImplementation(async () => {
      (runtime as any).compactionInProgress = true;
      await runtime.abort();
      (runtime as any).compactionInProgress = false;
      return false;
    });
    (runtime as any).pendingOverflow = true;
    (runtime as any).currentAssistant = {
      id: "assistant-overflow",
      role: "assistant",
      content: "partial",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    await expect((runtime as any).runPendingRecoveries()).resolves.toBe(false);

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({ id: "assistant-overflow", status: "aborted" }),
      }),
    );
    expect(events.some((event) => event.type === "agent_end")).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
    await runtime.dispose();
  });

  it("rejects prompt() and executeApprovedPlan() as AGENT_BUSY before touching turn state", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent, turnId: "turn-live" });
    const agent = (runtime as any).agent;
    agent.prompt = vi.fn();
    agent.continue = vi.fn();
    agent.state.isStreaming = true;
    const epochBefore = (runtime as any).turnEpoch;

    await expect(runtime.prompt("second prompt", "user-2", "turn-2")).rejects.toMatchObject({
      errorCode: "AGENT_BUSY",
    });
    await expect(
      runtime.executeApprovedPlan(
        {
          id: "plan-1",
          sessionId: "session-1",
          kind: "plan",
          title: "t",
          question: "q",
          plan: "p",
          artifact: { relativePath: ".pi/plan.md" },
        } as unknown as PlanExecution,
        "turn-3",
      ),
    ).rejects.toMatchObject({ errorCode: "AGENT_BUSY" });

    expect((runtime as any).turnId).toBe("turn-live");
    expect((runtime as any).turnEpoch).toBe(epochBefore);
    expect(agent.prompt).not.toHaveBeenCalled();
    expect(agent.continue).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();

    agent.state.isStreaming = false;
    await runtime.dispose();
  });

  it("logs a throwing event handler against the session instead of rejecting the run", async () => {
    const runtime = createRuntime();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      vi.spyOn(runtime as any, "handleAgentEvent").mockRejectedValue(
        new Error("handler exploded"),
      );
      const listeners = [...((runtime as any).agent.listeners as Set<Function>)];
      expect(listeners).toHaveLength(1);
      await expect(
        listeners[0]({ type: "agent_start" }, new AbortController().signal),
      ).resolves.toBeUndefined();
      const line = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(line).toContain("event handler failed");
      expect(line).toContain("session=session-1");
      expect(line).toContain("event=agent_start");
      expect(line).toContain("handler exploded");
    } finally {
      stderr.mockRestore();
      await runtime.dispose();
    }
  });
});
