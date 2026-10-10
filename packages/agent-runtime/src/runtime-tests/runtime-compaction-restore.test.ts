import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { buildSessionContext } from "../session-context.js";
import { estimateContextTokens as estimateAgentContextTokens } from "../pi-runtime-estimates.js";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime compaction restore", () => {

  it("restores summary plus retained tail while keeping the full transcript", async () => {
    const retained = { role: "user" as const, content: "recent", timestamp: 2 };
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "old",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "user-2",
          role: "user",
          content: "recent",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "Older work was summarized.",
        firstKeptMessageId: "user-2",
        throughMessageId: "user-2",
        tokensBefore: 200_000,
        retainedTail: [retained],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });

    const agentMessages = (runtime as any).agent.state.messages.filter((message: any) => message.role !== "system");
    expect(agentMessages.map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
    ]);
    expect(agentMessages[0].summary).toBe("Older work was summarized.");
    expect((runtime as any).fullEntries).toHaveLength(2);
    await runtime.dispose();
  });

  it("does not replay completed user requests after a checkpoint", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "old-user",
          role: "user",
          content: "Implement fix A",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "Fix A is complete.",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
        {
          id: "current-user",
          role: "user",
          content: "Implement fix B only; do not revisit fix A.",
          createdAt: "2026-07-28T00:00:02Z",
          status: "complete",
        },
        {
          id: "current-assistant",
          role: "assistant",
          content: "Fix B is complete.",
          createdAt: "2026-07-28T00:00:03Z",
          status: "complete",
        },
      ],
    });
    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(
      entries,
      budget,
      20_000,
      "completed_turn",
    );

    expect(preparation.value.retainedTail).toEqual([]);
    const checkpoint = (runtime as any).createCheckpoint(
      preparation.value,
      "current-assistant",
      "Fixes A and B are complete. Await the next requested fix.",
      undefined,
      { retainedTailMode: "completed_turn" },
    );
    const compacted = buildSessionContext(
      (runtime as any).entriesWithCompaction(checkpoint),
    ).messages;
    const nextPrompt = {
      role: "user",
      content: "Implement fix C only. Do not revisit A or B.",
      timestamp: 4,
    };

    expect(compacted.map((message: any) => message.role)).toEqual([
      "compactionSummary",
    ]);
    expect([...compacted, nextPrompt].map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
    ]);
    expect(JSON.stringify([...compacted, nextPrompt])).not.toContain(
      "Implement fix A",
    );
    expect(JSON.stringify([...compacted, nextPrompt])).toContain(
      "Implement fix C only",
    );
    await runtime.dispose();
  });

  it("does not reuse pre-compaction provider usage for the retained tail budget", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "old",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "recent answer",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "Older work was summarized.",
        firstKeptMessageId: "assistant-1",
        throughMessageId: "assistant-1",
        tokensBefore: 250_000,
        retainedTail: [
          {
            role: "assistant",
            content: [{ type: "text", text: "recent answer" }],
            api: "openai-completions",
            provider: "local",
            model: "local-model",
            stopReason: "stop",
            timestamp: 2,
            usage: {
              input: 249_000,
              output: 1_000,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 250_000,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          },
        ],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });

    const budget = (runtime as any).contextBudget(
      (runtime as any).agent.state.messages,
    );
    // System sections and tool declarations now participate in the estimate;
    // the invariant is that the old response's 250k usage is not reused.
    const estimate = estimateAgentContextTokens((runtime as any).agent.state.messages);
    expect(estimate.usageTokens).toBe(0);
    expect(estimate.lastUsageIndex).toBeNull();
    expect(budget.tokens).toBeGreaterThanOrEqual(estimate.tokens);
    expect(budget.tokens).toBeGreaterThan(0);
    expect(budget.tokens).toBeLessThan(250_000);
    await runtime.dispose();
  });
});
