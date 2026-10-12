import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { buildSessionContext } from "../session-context.js";
import { estimateTokens } from "../pi-runtime-estimates.js";
import { type RuntimeProviderConfig } from "../runtime.js";
import { provider, createRuntime } from "./runtime-test-harness.js";
import { toolResult, assistant, nextTurn } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime per-turn context protection", () => {

  it("keeps only user messages in the model context past a boundary", async () => {
    const runtime = createRuntime();
    const toolAssistant = {
      ...assistant,
      content: [
        {
          type: "toolCall" as const,
          id: "large-tool-call",
          name: "Read",
          arguments: { path: "large.log" },
        },
      ],
      stopReason: "toolUse" as const,
    };
    const largeToolResult = {
      ...toolResult,
      toolCallId: "large-tool-call",
      content: [{ type: "text" as const, text: "x".repeat(200_000) }],
    };
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "old-user",
        seq: 0,
        parentId: null,
        timestamp: Date.parse("2026-07-28T00:00:00Z"),
        message: { role: "user", content: "old context", timestamp: 1 },
      },
      {
        type: "message",
        id: "current-user",
        seq: 1,
        parentId: "old-user",
        timestamp: Date.parse("2026-07-28T00:00:01Z"),
        message: { role: "user", content: "inspect the log", timestamp: 2 },
      },
      {
        type: "message",
        id: "tool-assistant",
        seq: 2,
        parentId: "current-user",
        timestamp: Date.parse("2026-07-28T00:00:02Z"),
        message: toolAssistant,
      },
      {
        type: "message",
        id: "large-tool-call",
        seq: 3,
        parentId: "tool-assistant",
        timestamp: Date.parse("2026-07-28T00:00:03Z"),
        message: largeToolResult,
      },
    ];

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(
      entries,
      budget,
      20_000,
      "active_turn",
    );

    expect(preparation.ok).toBe(true);
    // Everything is summarized as one range, so nothing leaves the context
    // without the summary covering it.
    expect(preparation.value.isSplitTurn).toBe(false);
    expect(preparation.value.turnPrefixMessages).toEqual([]);
    expect(
      preparation.value.messagesToSummarize.map((message: any) => message.role),
    ).toEqual(["user", "user", "assistant", "toolResult"]);
    // The anchor becomes the next boundary.
    expect(preparation.value.firstKeptEntryId).toBe("large-tool-call");
    expect(
      preparation.value.retainedTail.map((message: any) => message.content),
    ).toEqual(["inspect the log"]);

    const checkpoint = (runtime as any).createCheckpoint(
      preparation.value,
      "large-tool-call",
      "Older work was summarized.",
      undefined,
      { retainedTailMode: "active_turn" },
    );
    const compacted = buildSessionContext(
      (runtime as any).entriesWithCompaction(checkpoint),
    ).messages;
    expect(compacted.map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
    ]);
    // No assistant message means no toolCall block, so no orphaned tool call can
    // reach a provider.
    expect(
      compacted.flatMap((message: any) =>
        Array.isArray(message.content)
          ? message.content.filter((block: any) => block.type === "toolCall")
          : [],
      ),
    ).toEqual([]);
    await runtime.dispose();
  });

  it("retains only the active user message and truncates it at the retention cap", async () => {
    const runtime = createRuntime();
    // Historical user messages are summarized. The active prompt is retained
    // only when the provider still needs another turn, and it is truncated if
    // it alone crosses the 20k retention cap.
    const asks = ["oldest", "third", "second", "newest"].map(
      (label, index) => ({
        type: "message",
        id: `ask-${index}`,
        parentId: index === 0 ? null : `ask-${index - 1}`,
        timestamp: `2026-07-30T00:00:0${index}Z`,
        message: {
          role: "user",
          content: `${label}:${"x".repeat(index === 3 ? 100_000 : 100)}`,
          timestamp: index + 1,
        },
      }),
    );
    (runtime as any).fullEntries = asks;

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(
      entries,
      budget,
      20_000,
      "active_turn",
    );
    const retained = preparation.value.retainedTail;

    expect(retained).toHaveLength(1);
    expect(
      retained.reduce(
        (sum: number, message: any) => sum + estimateTokens(message),
        0,
      ),
    ).toBeLessThanOrEqual(20_000);
    expect(retained[0].content.slice(0, 7)).toBe("newest:");
    expect(retained[0].content).toContain("[checkpoint truncated:");
    await runtime.dispose();
  });

  it("still sees the user messages an earlier checkpoint retained", async () => {
    const runtime = createRuntime();
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "anchor-user",
        seq: 0,
        parentId: null,
        timestamp: Date.parse("2026-07-31T00:00:00Z"),
        message: { role: "user", content: "anchor ask", timestamp: 1 },
      },
      {
        type: "message",
        id: "later-user",
        seq: 1,
        parentId: "anchor-user",
        timestamp: Date.parse("2026-07-31T00:00:01Z"),
        message: { role: "user", content: "later ask", timestamp: 2 },
      },
    ];
    (runtime as any).activeCompaction = {
      id: "checkpoint-1",
      summary: "First summary.",
      firstKeptMessageId: "anchor-user",
      throughMessageId: "anchor-user",
      tokensBefore: 240_000,
      retainedTail: [
        { role: "user", content: "remembered ask", timestamp: 0 },
      ],
      details: { generation: 1 },
      providerId: "local",
      modelId: "local-model",
      createdAt: "2026-07-31T00:00:00Z",
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

    // "anchor ask" is the message the previous checkpoint was filed against, so
    // it sits behind the boundary and "First summary." already covers it. pi
    // 0.84 starts the compactable range at the checkpoint entry (replaying its
    // retained tail as virtual entries) instead of walking back to the anchor,
    // so the one-entry overlap 0.82 produced is gone. What matters to this test
    // still holds: only the latest active user message survives into the next
    // tail, so an older checkpoint tail cannot reintroduce another request.
    expect(
      preparation.value.retainedTail.map((message: any) => message.content),
    ).toEqual(["later ask"]);
    await runtime.dispose();
  });

  it("summarizes an atomic parallel tool batch rather than carrying it forward", async () => {
    const constrainedProvider: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        contextWindow: 128_000,
        maxTokens: 8_192,
      },
    };
    const runtime = createRuntime({ provider: constrainedProvider });
    const resultSizes = [2_687, 90_920, 41_099, 155_573];
    const toolCalls = resultSizes.map((_, index) => ({
      type: "toolCall" as const,
      id: `parallel-tool-${index}`,
      name: "Read",
      arguments: { path: `large-${index}.txt` },
    }));
    const toolCarrier = {
      ...assistant,
      content: toolCalls,
      usage: {
        ...assistant.usage,
        input: 110_000,
        totalTokens: 110_000,
      },
      stopReason: "toolUse" as const,
    };
    const largeResults = resultSizes.map((size, index) => ({
      ...toolResult,
      toolCallId: `parallel-tool-${index}`,
      content: [
        { type: "text" as const, text: `${index}${"x".repeat(size - 1)}` },
      ],
      details: { duplicatedDiagnostic: "x".repeat(size) },
    }));
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "old-user",
        seq: 0,
        parentId: null,
        timestamp: Date.parse("2026-07-29T00:00:00Z"),
        message: { role: "user", content: "inspect the repository", timestamp: 1 },
      },
      {
        type: "message",
        id: "parallel-carrier",
        seq: 1,
        parentId: "old-user",
        timestamp: Date.parse("2026-07-29T00:00:01Z"),
        message: toolCarrier,
      },
      ...largeResults.map((message, index) => ({
        type: "message",
        id: message.toolCallId,
        seq: index + 2,
        parentId:
          index === 0
            ? "parallel-carrier"
            : largeResults[index - 1].toolCallId,
        timestamp: Date.parse(`2026-07-29T00:00:0${index + 2}Z`),
        message,
      })),
    ];

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(
      entries,
      budget,
      20_000,
      "active_turn",
    );
    const retainedTail = preparation.value.retainedTail;

    expect(budget.tokens).toBeGreaterThan(budget.hardLimit);
    expect(preparation.ok).toBe(true);
    expect(preparation.value.firstKeptEntryId).toBe("parallel-tool-3");
    // The batch that used to force a full-tail retention is now summary input.
    expect(
      preparation.value.messagesToSummarize.map((message: any) => message.role),
    ).toEqual([
      "user",
      "assistant",
      "toolResult",
      "toolResult",
      "toolResult",
      "toolResult",
    ]);
    expect(retainedTail.map((message: any) => message.role)).toEqual(["user"]);
    expect(retainedTail[0].content).toBe("inspect the repository");
    // The visible transcript keeps the complete results either way.
    expect(
      (runtime as any).fullEntries.at(-1).message.content[0].text,
    ).toHaveLength(155_573);
    expect((runtime as any).fullEntries.at(-1).message.details).toEqual({
      duplicatedDiagnostic: "x".repeat(155_573),
    });
    await runtime.dispose();
  });

  it("rechecks the hard budget after a reported successful compaction", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 44_800,
    });
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(true);

    await expect((runtime as any).prepareNextTurn(nextTurn)).rejects.toThrow(
      "checkpoint remained above the safe model context budget",
    );
    await runtime.dispose();
  });
});
