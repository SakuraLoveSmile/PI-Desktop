import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";
import { nextTurn } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime per-turn context protection", () => {

  it("blocks an over-budget continuation when automatic compaction is disabled", async () => {
    const runtime = createRuntime({
      compactionSettings: {
        enabled: false,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    });
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });
    const runCompaction = vi.spyOn(runtime as any, "runCompaction");

    await expect((runtime as any).prepareNextTurn(nextTurn)).rejects.toThrow(
      "CONTEXT_TOO_LARGE",
    );
    expect(runCompaction).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("withdraws the compaction tool when automatic protection is disabled", async () => {
    const runtime = createRuntime();
    const before = (runtime as any).agent.state.tools.map(
      (tool: any) => tool.name,
    );
    expect(before).toContain("new_context");

    runtime.setCompactionSettings({
      enabled: false,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });

    const after = (runtime as any).agent.state.tools.map(
      (tool: any) => tool.name,
    );
    // With protection off there is no checkpoint to ask for, so the tool would
    // only ever return a promise the host does not keep.
    expect(after).toEqual(before.filter((name: string) => name !== "new_context"));
    await runtime.dispose();
  });

  it("rejects an over-budget first prompt when automatic compaction is disabled", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({
      onEvent,
      compactionSettings: {
        enabled: false,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    });
    const agent = (runtime as any).agent;
    agent.prompt = vi.fn();
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });

    await runtime.prompt("oversized request", "user-disabled-compaction");

    expect(agent.prompt).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
      }),
    );
    await runtime.dispose();
  });

  it("keeps a preflight-rejected user message in reusable runtime context", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    agent.prompt = vi.fn();
    vi.spyOn(runtime as any, "automaticCompactionNeeded").mockReturnValue(true);
    vi.spyOn(runtime as any, "automaticCompactionWouldExceedHardLimit").mockReturnValue(true);
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);

    await runtime.prompt("oversized request", "user-preflight");

    expect(agent.prompt).not.toHaveBeenCalled();
    expect((runtime as any).fullEntries).toEqual([
      expect.objectContaining({
        id: "user-preflight",
        message: expect.objectContaining({
          role: "user",
          content: "oversized request",
        }),
      }),
    ]);
    expect(agent.state.messages.filter((message: any) => message.role !== "system")).toEqual([
      expect.objectContaining({ role: "user", content: "oversized request" }),
    ]);
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          role: "assistant",
          status: "error",
          error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
      }),
    );
    await runtime.dispose();
  });
});
