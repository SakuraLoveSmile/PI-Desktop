import "./runtime-test-harness.js";
import { describe, vi, it, expect } from "vitest";
import {
  DesktopAgentRuntime,
  COMPACTION_FALLBACK_MARKER,
  type RuntimeProviderConfig,
} from "../runtime.js";
import { provider, createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("compaction fallback retention (#827)", () => {

  function messageEntry(
    id: string,
    parentId: string | null,
    message: unknown,
    seq: number,
  ) {
    return {
      type: "message" as const,
      id,
      seq,
      parentId,
      timestamp: Date.parse("2026-09-21T18:00:00Z") + seq * 1_000,
      message,
    };
  }

  function userNote(text: string, timestamp: number) {
    return { role: "user", content: [{ type: "text", text }], timestamp };
  }

  function assistantNote(text: string, timestamp: number) {
    return { ...assistantMessage({ content: [{ type: "text", text }] }), timestamp };
  }

  /**
   * `toolName` is what pi's file-operation extraction matches on, and it knows
   * the lowercase names: a chunk test that asserts the file list has to use one.
   */
  function toolStep(ids: string[], timestamp: number, toolName = "Read") {
    return {
      ...assistantMessage({
        content: ids.map((id, index) => ({
          type: "toolCall" as const,
          id,
          name: toolName,
          arguments: { path: `large-${index}.txt` },
        })),
        stopReason: "toolUse",
      }),
      timestamp,
    };
  }

  function toolOutput(toolCallId: string, text: string, timestamp: number) {
    return {
      role: "toolResult" as const,
      toolCallId,
      toolName: "Read",
      content: [{ type: "text" as const, text }],
      isError: false,
      timestamp,
    };
  }

  function appendedCheckpoint(host: { call: ReturnType<typeof vi.fn> }) {
    const call = host.call.mock.calls.find(
      ([method]) => method === "session.appendCompaction",
    );
    return (call?.[1] as any)?.compaction;
  }

  function failingSummary(runtime: DesktopAgentRuntime) {
    return vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue({
      ok: false,
      error: {
        code: "summarization_failed",
        message: "provider terminated the summary request",
      },
    });
  }

  function replayedMessages(runtime: DesktopAgentRuntime) {
    return (runtime as any).agent.state.messages.filter(
      (message: any) => message.role !== "system",
    );
  }

  it("keeps the real recent window when an automatic summary fails", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({ host });
    (runtime as any).fullEntries = [
      messageEntry("user-1", null, userNote("start the migration", 1), 0),
      messageEntry("assistant-1", "user-1", assistantNote("I mapped the schema.", 2), 1),
      messageEntry("assistant-2", "assistant-1", toolStep(["tool-1"], 3), 2),
      messageEntry(
        "tool-1",
        "assistant-2",
        toolOutput("tool-1", "CREATE TABLE projects (id TEXT)", 4),
        3,
      ),
      messageEntry("user-2", "tool-1", userNote("now rename the column", 5), 4),
    ];
    failingSummary(runtime);

    await expect(
      (runtime as any).runCompaction("threshold", false, "active_turn"),
    ).resolves.toBe(true);

    const checkpoint = appendedCheckpoint(host);
    expect(checkpoint.details).toMatchObject({
      fallback: "retained_tail",
      failureCode: "CONTEXT_COMPACTION_FAILED",
      failureReason: "summary_provider",
      retainedTailMode: "active_turn",
      retainedTailShape: "recent_window",
      retainedTailCount: 5,
    });
    // The whole window survives, not the one latest user line: the earlier
    // decision, the tool output, and the in-flight request all outlive the
    // failed summary.
    expect(checkpoint.retainedTail.map((message: any) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "toolResult",
      "user",
    ]);
    expect(checkpoint.summary).toContain(COMPACTION_FALLBACK_MARKER);
    // A failed summary must not tell the model that one leftover user line is
    // the source of truth for the whole continuation.
    expect(checkpoint.summary).not.toContain("source of truth");

    const replayed = replayedMessages(runtime);
    expect(replayed.map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
      "assistant",
      "assistant",
      "toolResult",
      "user",
    ]);
    expect(
      replayed
        .filter((message: any) => message.role === "toolResult")
        .map((message: any) => message.content[0].text),
    ).toEqual(["CREATE TABLE projects (id TEXT)"]);
    await runtime.dispose();
  });

  it("restores the same window for a completed turn without inventing a request", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({ host });
    (runtime as any).fullEntries = [
      messageEntry("user-1", null, userNote("start the migration", 1), 0),
      messageEntry("assistant-1", "user-1", assistantNote("I mapped the schema.", 2), 1),
      messageEntry("assistant-2", "assistant-1", toolStep(["tool-1"], 3), 2),
      messageEntry(
        "tool-1",
        "assistant-2",
        toolOutput("tool-1", "CREATE TABLE projects (id TEXT)", 4),
        3,
      ),
      messageEntry(
        "assistant-3",
        "tool-1",
        assistantNote("The migration is complete: 3 files changed.", 5),
        4,
      ),
    ];
    failingSummary(runtime);

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    const checkpoint = appendedCheckpoint(host);
    const replayed = replayedMessages(runtime);
    expect(replayed.map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
      "assistant",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    // The window ends on the finished assistant message, so nothing in it reads
    // as a request the next task still has to answer (#563, #224).
    expect(replayed.at(-1).role).toBe("assistant");
    await runtime.dispose();
  });

  it("summarizes a range no single prompt can carry instead of skipping it", async () => {
    const constrained: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    };
    const runtime = createRuntime({ provider: constrained });
    const resultCount = 600;
    (runtime as any).fullEntries = [
      messageEntry(
        "old-user",
        null,
        { role: "user", content: "inspect the repository", timestamp: 1 },
        0,
      ),
      messageEntry(
        "carrier",
        "old-user",
        toolStep(
          Array.from({ length: resultCount }, (_, index) => `tool-${index}`),
          2,
          "read",
        ),
        1,
      ),
      ...Array.from({ length: resultCount }, (_, index) =>
        messageEntry(
          `tool-${index}`,
          index === 0 ? "carrier" : `tool-${index - 1}`,
          toolOutput(`tool-${index}`, "r".repeat(2_000), 3),
          index + 2,
        ),
      ),
    ];
    const generate = vi
      .spyOn(runtime as any, "generateCompaction")
      .mockImplementation(async () => ({
        ok: true,
        value: {
          summary: `part ${generate.mock.calls.length}`,
          tokensBefore: 80_000,
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          details: { readFiles: ["large-0.txt"], modifiedFiles: [] },
        },
      }));

    const build = await (runtime as any).buildCheckpoint(
      new AbortController().signal,
      "active_turn",
    );

    expect(build.ok).toBe(true);
    const calls = generate.mock.calls.map(([preparation]: any[]) => preparation);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(16);
    // Every request after the first carries its predecessor's summary, so the
    // chain converges on one summary for the whole range.
    expect(calls[0].previousSummary).toBeUndefined();
    for (let index = 1; index < calls.length; index += 1) {
      expect(calls[index].previousSummary).toBe(`part ${index}`);
    }
    // Coverage: the chunks are contiguous and together carry every message, so
    // nothing leaves the context without the summary covering it.
    const summarized = calls.flatMap(
      (preparation: any) => preparation.messagesToSummarize,
    );
    expect(summarized).toHaveLength(resultCount + 2);
    expect(summarized[0].content).toBe("inspect the repository");
    expect(
      summarized.filter((message: any) => message.role === "toolResult"),
    ).toHaveLength(resultCount);
    // The range's file operations ride on the last request only, so pi appends
    // the file list to the installed summary exactly once.
    expect(calls[0].fileOps.read.size).toBe(0);
    expect(calls.at(-1)!.fileOps).toBe((build as any).preparation.fileOps);
    // One checkpoint, not a fallback: the model still summarized the range.
    const checkpoint = (build as any).checkpoint;
    expect(checkpoint.summary).toBe(`part ${calls.length}`);
    expect(checkpoint.usage).toMatchObject({ totalTokens: 15 * calls.length });
    expect(checkpoint.details).toMatchObject({
      strategy: "summary",
      retainedTailMode: "active_turn",
      readFiles: ["large-0.txt"],
    });
    expect(checkpoint.details.fallback).toBeUndefined();
    await runtime.dispose();
  });

  it("records why a fallback had to run", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({ host });
    (runtime as any).fullEntries = [
      messageEntry("user-1", null, userNote("continue the migration", 1), 0),
    ];

    await expect(
      (runtime as any).recoverCompactionFailure(
        (runtime as any).entriesWithCompaction(),
        (runtime as any).contextBudget(
          (runtime as any).liveSessionContext().messages,
        ),
        "threshold",
        false,
        undefined,
        "Compaction summary input exceeds the safe model budget",
        "active_turn",
        "summary_budget",
      ),
    ).resolves.toBe(true);

    expect(appendedCheckpoint(host).details).toMatchObject({
      failureReason: "summary_budget",
      retainedTailMode: "active_turn",
      retainedTailShape: "recent_window",
    });
    await runtime.dispose();
  });
});
