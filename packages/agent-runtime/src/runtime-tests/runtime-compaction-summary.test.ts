import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { DesktopAgentRuntime, type RuntimeProviderConfig } from "../runtime.js";
import { COMPACTION_SUMMARY_MAX_RETRIES } from "../compaction-summary-input.js";
import { provider, createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime compaction summary retry and sizing (#543, ADR 0282)", () => {

  /** The shape `prepareCompaction` returns for a single-turn history. */
  function preparation(messagesToSummarize: unknown[] = [
    {
      role: "user",
      content: [{ type: "text", text: "older task context" }],
      timestamp: 1,
    },
  ]) {
    return {
      messagesToSummarize,
      turnPrefixMessages: [],
      retainedTail: [],
      isSplitTurn: false,
      tokensBefore: 240_000,
      fileOps: {
        read: new Set<string>(),
        edited: new Set<string>(),
        written: new Set<string>(),
      },
      settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    };
  }

  function providerError(errorMessage: string) {
    return {
      ...assistantMessage({ content: [], stopReason: "error" }),
      errorMessage,
    };
  }

  /** Scripted `completeSimple` responses; the recorder returns them in order. */
  function scriptSummaryRequests(runtime: DesktopAgentRuntime, responses: unknown[]) {
    const calls: unknown[] = [];
    (runtime as any).models = {
      completeSimple: async (_model: unknown, _context: unknown, options: unknown) => {
        calls.push(options);
        const next = responses.shift();
        if (!next) throw new Error("unexpected summary request");
        return next;
      },
    };
    return calls;
  }

  function toolResultOf(text: string, index: number) {
    return {
      role: "toolResult" as const,
      toolCallId: `tool-${index}`,
      toolName: "Read",
      content: [{ type: "text" as const, text }],
      isError: false,
      timestamp: index + 2,
    };
  }

  it("retries a transient summary failure and installs the real summary", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createRuntime();
      const calls = scriptSummaryRequests(runtime, [
        providerError("503 Service Unavailable"),
        assistantMessage({ content: [{ type: "text", text: "Older work." }] }),
      ]);

      const pending = (runtime as any).generateCompaction(
        preparation(),
        new AbortController().signal,
      );
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(calls).toHaveLength(2);
      expect(result.ok).toBe(true);
      expect(result.value.summary).toContain("Older work.");
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a deterministic provider rejection", async () => {
    const runtime = createRuntime();
    const calls = scriptSummaryRequests(runtime, [
      providerError("Invalid API key"),
    ]);

    const result = await (runtime as any).generateCompaction(
      preparation(),
      new AbortController().signal,
    );

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("summarization_failed");
    await runtime.dispose();
  });

  it("gives up after the bounded retry budget", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createRuntime();
      const calls = scriptSummaryRequests(
        runtime,
        Array.from({ length: COMPACTION_SUMMARY_MAX_RETRIES + 1 }, () =>
          providerError("upstream connect error or disconnect/reset before headers"),
        ),
      );

      const pending = (runtime as any).generateCompaction(
        preparation(),
        new AbortController().signal,
      );
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(calls).toHaveLength(COMPACTION_SUMMARY_MAX_RETRIES + 1);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("summarization_failed");
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying when the compaction is aborted during the backoff", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createRuntime();
      const calls = scriptSummaryRequests(runtime, [
        providerError("503 Service Unavailable"),
        assistantMessage({ content: [{ type: "text", text: "never sent" }] }),
      ]);
      const controller = new AbortController();

      const pending = (runtime as any).generateCompaction(
        preparation(),
        controller.signal,
      );
      await vi.advanceTimersByTimeAsync(500);
      controller.abort();
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(calls).toHaveLength(1);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("aborted");
      await runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sizes the budget guard on the serialized prompt, not the raw tool output", async () => {
    const runtime = createRuntime();
    // 128k window: the raw estimate of one 600k-character tool result is
    // 150k tokens and used to fail the guard outright; pi caps the result at
    // 2 000 characters when it serializes the prompt, so the request fits.
    const budget = { hardLimit: 111_616, requestHeadroom: 16_384 };
    const input = preparation([
      { role: "user", content: "read the log", timestamp: 1 },
      toolResultOf("x".repeat(600_000), 0),
    ]);

    expect((runtime as any).compactionSummaryWouldExceedBudget(input, budget)).toBe(
      false,
    );
    expect((runtime as any).fitSummaryInputToBudget(input, budget)).toBe(input);
    await runtime.dispose();
  });

  it("reduces an oversized prompt once before giving up on the summary", async () => {
    const runtime = createRuntime();
    // 8k window leaves ~4-6k tokens for the prompt; 15 capped tool results
    // serialize to ~30k characters and overshoot, the reduced prefixes fit.
    const budget = { hardLimit: 6_000, requestHeadroom: 2_000 };
    const input = preparation(
      Array.from({ length: 15 }, (_, index) => toolResultOf("y".repeat(5_000), index)),
    );

    expect((runtime as any).compactionSummaryWouldExceedBudget(input, budget)).toBe(true);
    const fitted = (runtime as any).fitSummaryInputToBudget(input, budget);
    expect(fitted).toBeDefined();
    expect(fitted).not.toBe(input);
    expect(fitted.messagesToSummarize).toHaveLength(15);
    for (const message of fitted.messagesToSummarize) {
      expect(message.content[0].text.length).toBeLessThan(600);
    }
    // The original preparation is untouched: the checkpoint still files the
    // complete messages behind its boundary.
    expect((input.messagesToSummarize[0] as any).content[0].text).toHaveLength(5_000);
    await runtime.dispose();
  });

  it("falls back only when even the reduced prompt cannot fit", async () => {
    const runtime = createRuntime();
    const budget = { hardLimit: 6_000, requestHeadroom: 2_000 };
    const userText = preparation(
      Array.from({ length: 15 }, (_, index) => ({
        role: "user",
        content: "u".repeat(5_000),
        timestamp: index + 1,
      })),
    );
    // User text is never reduced, so there is no second attempt to make.
    expect((runtime as any).fitSummaryInputToBudget(userText, budget)).toBeUndefined();

    const tooManyResults = preparation(
      Array.from({ length: 120 }, (_, index) => toolResultOf("z".repeat(5_000), index)),
    );
    expect(
      (runtime as any).fitSummaryInputToBudget(tooManyResults, budget),
    ).toBeUndefined();
    await runtime.dispose();
  });

  it("sends the reduced prompt to the model instead of skipping the summary", async () => {
    const constrainedProvider: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    };
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({ host, provider: constrainedProvider });
    const resultCount = 60;
    const toolCalls = Array.from({ length: resultCount }, (_, index) => ({
      type: "toolCall" as const,
      id: `tool-${index}`,
      name: "Read",
      arguments: { path: `large-${index}.txt` },
    }));
    const carrier = {
      ...assistantMessage({ content: toolCalls, stopReason: "toolUse" }),
      usage: {
        ...assistantMessage({ content: [] }).usage,
        input: 80_000,
        totalTokens: 80_000,
      },
    };
    const results = Array.from({ length: resultCount }, (_, index) =>
      toolResultOf("r".repeat(5_000), index),
    );
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "old-user",
        seq: 0,
        parentId: null,
        timestamp: Date.parse("2026-09-18T00:00:00Z"),
        message: { role: "user", content: "inspect the repository", timestamp: 1 },
      },
      {
        type: "message",
        id: "carrier",
        seq: 1,
        parentId: "old-user",
        timestamp: Date.parse("2026-09-18T00:00:01Z"),
        message: carrier,
      },
      ...results.map((message, index) => ({
        type: "message",
        id: message.toolCallId,
        seq: index + 2,
        parentId: index === 0 ? "carrier" : results[index - 1].toolCallId,
        timestamp: Date.parse("2026-09-18T00:00:02Z") + index,
        message,
      })),
    ];
    const generate = vi
      .spyOn(runtime as any, "generateCompaction")
      .mockResolvedValue({
        ok: true,
        value: { summary: "Sixty reads, summarized.", tokensBefore: 80_000 },
      });

    const build = await (runtime as any).buildCheckpoint(
      new AbortController().signal,
      "active_turn",
    );

    expect(build.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    const sent = generate.mock.calls[0]?.[0] as any;
    const sentResults = sent.messagesToSummarize.filter(
      (message: any) => message.role === "toolResult",
    );
    expect(sentResults).toHaveLength(resultCount);
    for (const message of sentResults) {
      expect(message.content[0].text.length).toBeLessThan(600);
    }
    // The checkpoint itself still covers every message and carries no
    // fallback marker: this was a real summary, not retained-tail recovery.
    expect(build.checkpoint.throughMessageId).toBe(`tool-${resultCount - 1}`);
    expect(build.checkpoint.summary).toContain("Sixty reads, summarized.");
    expect(build.checkpoint.details).not.toHaveProperty("fallback");
    await runtime.dispose();
  });
});
