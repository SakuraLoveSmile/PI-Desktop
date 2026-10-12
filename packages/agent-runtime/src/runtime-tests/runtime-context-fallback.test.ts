import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { COMPACTION_FALLBACK_MARKER } from "../runtime.js";
import { buildSessionContext } from "../session-context.js";
import { createRuntime } from "./runtime-test-harness.js";
import { nextTurn } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime per-turn context protection", () => {

  it("persists a retained-tail fallback when automatic summary generation fails", async () => {
    const onEvent = vi.fn();
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({
      host,
      onEvent,
      history: [
        {
          id: "old-user",
          role: "user",
          content: "older task context",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "recent-user",
          role: "user",
          content: "continue the task",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
    });
    vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue({
      ok: false,
      error: {
        code: "summarization_failed",
        message: "provider terminated the summary request",
      },
    });

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    const checkpoint = host.call.mock.calls[0]?.[0] === "session.appendCompaction"
      ? (host.call.mock.calls[0]?.[1] as any).compaction
      : undefined;
    expect(checkpoint).toEqual(
      expect.objectContaining({
        throughMessageId: "recent-user",
        details: expect.objectContaining({
          fallback: "retained_tail",
          failureCode: "CONTEXT_COMPACTION_FAILED",
          retainedTailMode: "completed_turn",
        }),
      }),
    );
    expect((runtime as any).fullEntries).toHaveLength(2);
    expect((runtime as any).agent.state.messages.filter((message: any) => message.role !== "system")[0]).toEqual(
      expect.objectContaining({ role: "compactionSummary" }),
    );
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        ok: true,
        fallback: "retained_tail",
      }),
    );
    expect(
      onEvent.mock.calls.some(
        ([envelope]) => (envelope as any).event.type === "error",
      ),
    ).toBe(false);
    await runtime.dispose();
  });

  it("shrinks a terminal checkpoint tail when a new prompt leaves no history to summarize", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({
      host,
      history: [
        {
          id: "old-user",
          role: "user",
          content: "older task context",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "recent-user",
          role: "user",
          content: "recent context",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "The previous task summary.",
        throughMessageId: "recent-user",
        tokensBefore: 220_000,
        retainedTail: [
          { role: "user", content: "recent context", timestamp: 2 },
        ],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });
    const generateCompaction = vi.spyOn(
      runtime as any,
      "generateCompaction",
    );

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    expect(generateCompaction).not.toHaveBeenCalled();
    expect(host.call).toHaveBeenCalledWith(
      "session.appendCompaction",
      expect.objectContaining({
        compaction: expect.objectContaining({
          details: expect.objectContaining({ fallback: "retained_tail" }),
          summary: expect.stringContaining("The previous task summary."),
        }),
      }),
    );
    await runtime.dispose();
  });

  it("keeps the summary a fallback checkpoint carries forward", async () => {
    // A fallback checkpoint stores any carried-forward summary ahead of its
    // recovery notice (see `createFallbackCheckpoint`). The next preparation
    // must strip only the notice: preparation cannot rebuild the older context
    // from the transcript on its own, so dropping the carried summary would
    // lose it permanently (#224).
    const runtime = createRuntime();
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "anchor-user",
        seq: 0,
        parentId: null,
        timestamp: Date.parse("2026-08-01T00:00:00Z"),
        message: { role: "user", content: "anchor ask", timestamp: 1 },
      },
      {
        type: "message",
        id: "later-user",
        seq: 1,
        parentId: "anchor-user",
        timestamp: Date.parse("2026-08-01T00:00:01Z"),
        message: { role: "user", content: "later ask", timestamp: 2 },
      },
    ];
    (runtime as any).activeCompaction = {
      id: "fallback-1",
      summary: [
        "The earlier task summary.",
        COMPACTION_FALLBACK_MARKER,
        "The automatic summary request did not complete.",
      ].join("\n\n"),
      firstKeptMessageId: "anchor-user",
      throughMessageId: "anchor-user",
      tokensBefore: 240_000,
      retainedTail: [{ role: "user", content: "remembered ask", timestamp: 0 }],
      details: { generation: 1, fallback: "retained_tail" },
      providerId: "local",
      modelId: "local-model",
      createdAt: "2026-08-01T00:00:00Z",
    };

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      buildSessionContext(entries).messages,
    );
    const preparation = (runtime as any).prepareCompactionInput(
      entries,
      budget,
      20_000,
      "active_turn",
    );

    expect(preparation.value.previousSummary).toBe("The earlier task summary.");
    await runtime.dispose();
  });

  it("keeps the carried summary when a fallback checkpoint is the terminal entry", async () => {
    // The rebuild path (`fallbackPreparation`) carries the terminal summary
    // into a smaller-tail checkpoint. When that terminal entry is itself a
    // fallback, the notice must be stripped without losing the summary it
    // carries, or the older context disappears for good (#224).
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({
      host,
      history: [
        {
          id: "old-user",
          role: "user",
          content: "older task context",
          createdAt: "2026-08-01T00:00:00Z",
          status: "complete",
        },
        {
          id: "recent-user",
          role: "user",
          content: "recent context",
          createdAt: "2026-08-01T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "fallback-1",
        summary: [
          "The earlier task summary.",
          COMPACTION_FALLBACK_MARKER,
          "The automatic summary request did not complete.",
        ].join("\n\n"),
        throughMessageId: "recent-user",
        tokensBefore: 220_000,
        retainedTail: [
          { role: "user", content: "recent context", timestamp: 2 },
        ],
        details: { generation: 1, fallback: "retained_tail" },
        createdAt: "2026-08-01T00:00:02Z",
      },
    });
    const generateCompaction = vi.spyOn(runtime as any, "generateCompaction");

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    expect(generateCompaction).not.toHaveBeenCalled();
    expect(host.call).toHaveBeenCalledWith(
      "session.appendCompaction",
      expect.objectContaining({
        compaction: expect.objectContaining({
          details: expect.objectContaining({ fallback: "retained_tail" }),
          summary: expect.stringContaining("The earlier task summary."),
        }),
      }),
    );
    await runtime.dispose();
  });

  it("keeps manual compaction failures terminal instead of silently dropping context", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const runtime = createRuntime({ host, onEvent });
    vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue({
      ok: false,
      error: {
        code: "summarization_failed",
        message: "summary unavailable",
      },
    });

    await expect((runtime as any).runCompaction("manual", false)).resolves.toBe(
      false,
    );
    expect(host.call).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        reason: "manual",
        ok: false,
        error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
      }),
    );
    await runtime.dispose();
  });

  it("does not issue another model turn when hard-limit compaction fails", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);

    await expect((runtime as any).prepareNextTurn(nextTurn)).rejects.toThrow(
      "CONTEXT_COMPACTION_FAILED",
    );
    await runtime.dispose();
  });
});
