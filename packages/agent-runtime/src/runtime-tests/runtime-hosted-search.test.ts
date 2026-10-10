import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import { estimateContextTokens as estimateAgentContextTokens } from "../pi-runtime-estimates.js";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime hosted web search rounds (ADR 0297)", () => {

  it("emits each search round as it happens and closes open rounds on message_end", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    const round = (id: string, status: string, query: string, sources: unknown[] = []) => ({
      type: "hostedSearch",
      phase: "web_search_call",
      blockId: id,
      status,
      wire: {
        type: "web_search_call",
        id,
        status,
        action: { type: "search", query, ...(sources.length ? { sources } : {}) },
      },
    });

    await handleAgentEvent({ type: "agent_start" });
    await handleAgentEvent({ type: "turn_start" });
    // Round 1 starts searching.
    await handleAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [round("ws_1", "in_progress", "first query")] },
    });
    // Round 1 completes and round 2 starts, still without any text.
    await handleAgentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          round("ws_1", "completed", "first query", [
            { url: "https://example.com/a", title: "A" },
          ]),
          round("ws_2", "in_progress", "second query"),
        ],
      },
    });
    // The turn ends while round 2 is still open; text arrived meanwhile.
    await handleAgentEvent({
      type: "message_end",
      message: assistantMessage({
        content: [
          round("ws_1", "completed", "first query", [
            { url: "https://example.com/a", title: "A" },
          ]),
          round("ws_2", "in_progress", "second query"),
          { type: "text", text: "The answer." },
        ],
      }),
    });
    await handleAgentEvent({ type: "turn_end" });
    await handleAgentEvent({ type: "agent_end", messages: [] });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    const searchUpdates = events.filter(
      (event: any) => event.type === "message_update" && event.message?.hostedSearch,
    );
    // Round 1 streamed the moment it started; round 2 the moment it appeared.
    expect(searchUpdates[0]?.message?.hostedSearch?.rounds).toEqual([
      { id: "ws_1", status: "searching", query: "first query", sources: [] },
    ]);
    expect(searchUpdates.at(-1)?.message?.hostedSearch?.rounds).toEqual([
      {
        id: "ws_1",
        status: "completed",
        query: "first query",
        sources: [{ url: "https://example.com/a", title: "A" }],
      },
      { id: "ws_2", status: "searching", query: "second query", sources: [] },
    ]);

    const end = events.find((event: any) => event.type === "message_end");
    // A round still open when the turn ends closes as completed, not left
    // blinking "searching" in a settled transcript.
    expect(end?.message?.hostedSearch).toEqual({
      status: "completed",
      rounds: [
        {
          id: "ws_1",
          status: "completed",
          query: "first query",
          sources: [{ url: "https://example.com/a", title: "A" }],
        },
        { id: "ws_2", status: "completed", query: "second query", sources: [] },
      ],
      replay: [
        round("ws_1", "completed", "first query", [
          { url: "https://example.com/a", title: "A" },
        ]),
        round("ws_2", "in_progress", "second query"),
      ],
    });
    await runtime.dispose();
  });

  it("replays persisted hostedSearch blocks into model context on restore", async () => {
    const restored = createRuntime({
      history: [
        {
          id: "u1",
          role: "user",
          content: "news?",
          status: "complete",
          createdAt: "2026-09-19T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "here is the news",
          status: "complete",
          createdAt: "2026-09-19T00:00:01.000Z",
          hostedSearch: {
            status: "completed",
            rounds: [
              { id: "srvtoolu_01", status: "completed", query: "news", sources: [] },
            ],
            replay: [
              {
                type: "hostedSearch",
                phase: "server_tool_use",
                blockId: "srvtoolu_01",
                name: "web_search",
                input: { query: "news" },
              },
              {
                type: "hostedSearch",
                phase: "web_search_tool_result",
                blockId: "srvtoolu_01",
                wire: {
                  type: "web_search_tool_result",
                  content: [{ type: "web_search_result", encrypted_content: "enc-1", title: "News", url: "https://example.test/news" }],
                },
              },
            ],
          },
        },
      ],
    });
    const assistant = (restored as unknown as { agent: Agent }).agent.state.messages.find(
      (message) => message.role === "assistant",
    ) as { content: unknown[] } | undefined;
    expect(assistant?.content).toEqual([
      {
        type: "hostedSearch",
        phase: "server_tool_use",
        blockId: "srvtoolu_01",
        name: "web_search",
        input: { query: "news" },
      },
      {
        type: "hostedSearch",
        phase: "web_search_tool_result",
        blockId: "srvtoolu_01",
        isError: false,
        wire: {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", encrypted_content: "enc-1", title: "News", url: "https://example.test/news" }],
        },
      },
      { type: "text", text: "here is the news" },
    ]);
    await restored.dispose();
  });

describe("context estimate calibration", () => {
  /** A request-level usage report: the shape `usageFromPi` hands the runtime. */
  const report = (inputTokens: number) => ({
    inputTokens,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens + 1,
  });

  const messages = [
    { role: "user" as const, content: "x".repeat(40_000), timestamp: 1 },
  ];

  it("moves the gate by what past requests actually cost", async () => {
    const runtime = createRuntime();
    const raw = estimateAgentContextTokens(messages).tokens;
    const initialBudget = (runtime as any).contextBudget(messages).tokens;
    expect(initialBudget).toBeGreaterThan(raw);

    // Two unanchored reports, each costing three times the estimate: CJK text
    // against the estimator's `chars / 4` constant. Below the sample threshold
    // the gate has to stay exactly where it was.
    for (let i = 0; i < 2; i++) {
      (runtime as any).inFlightContextEstimate = {
        tokens: raw,
        usageTokens: 0,
        trailingTokens: raw,
        lastUsageIndex: null,
      };
      (runtime as any).recordContextCalibration(report(raw * 3), false);
    }
    expect((runtime as any).contextBudget(messages).tokens).toBe(initialBudget);

    (runtime as any).inFlightContextEstimate = {
      tokens: raw,
      usageTokens: 0,
      trailingTokens: raw,
      lastUsageIndex: null,
    };
    (runtime as any).recordContextCalibration(report(raw * 3), false);
    expect((runtime as any).contextBudget(messages).tokens).toBe(
      Math.max(raw * 3, initialBudget),
    );

    await runtime.dispose();
  });

  it("ignores a failed attempt, a missing report, and a consumed park", async () => {
    const runtime = createRuntime();
    const raw = (runtime as any).contextBudget(messages).tokens;
    const parked = {
      tokens: raw,
      usageTokens: 0,
      trailingTokens: raw,
      lastUsageIndex: null,
    };
    const overhead = () => (runtime as any).contextCalibration.overheadTokens();

    // Two usable observations, then four that must not count. If any of them
    // did, the series would already be trusted and the overhead non-zero.
    for (let i = 0; i < 2; i++) {
      (runtime as any).inFlightContextEstimate = { ...parked };
      (runtime as any).recordContextCalibration(report(raw * 3), false);
    }
    (runtime as any).inFlightContextEstimate = { ...parked };
    // A failed stream never carried the request...
    (runtime as any).recordContextCalibration(report(raw * 3), true);
    // ...and it still consumed the park, so this report has nothing to pair
    // with rather than reusing the failed attempt's estimate.
    (runtime as any).recordContextCalibration(report(raw * 3), false);
    // A settled attempt whose response carried no usage at all.
    (runtime as any).inFlightContextEstimate = { ...parked };
    (runtime as any).recordContextCalibration(undefined, false);
    // A report with nothing parked.
    (runtime as any).recordContextCalibration(report(raw * 10), false);
    expect(overhead()).toBe(0);

    // The third usable observation crosses the threshold: the two above plus
    // this one, each measuring `3 * raw - raw`.
    (runtime as any).inFlightContextEstimate = { ...parked };
    (runtime as any).recordContextCalibration(report(raw * 3), false);
    expect(overhead()).toBe(raw * 2);

    await runtime.dispose();
  });
});
});
