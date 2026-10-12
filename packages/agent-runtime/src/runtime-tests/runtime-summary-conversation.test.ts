import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { provider, createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime summary conversation key", () => {

  /** Minimal 200 SSE answer for a Responses summary request. */
  function summarySse(): Response {
    const item = {
      id: "msg_fixture_summary",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "A short synthetic summary.", annotations: [] }],
    };
    const events = [
      { type: "response.created", response: { id: "resp_fixture_summary" } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "A short synthetic summary." },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: "resp_fixture_summary",
          status: "completed",
          output: [item],
          usage: { input_tokens: 100, output_tokens: 8 },
        },
      },
    ];
    return new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  it("sends the session id so a conversation-keyed gateway accepts the summary request", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return summarySse();
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createRuntime({
      provider: {
        ...provider,
        apiStyle: "responses",
        baseUrl: "https://summary-fixture.invalid/v1",
        apiKey: "sk-fixture-not-for-logs",
      },
      history: [
        {
          id: "old-user",
          role: "user",
          content: "private-fixture-history ".repeat(6_000),
          createdAt: "2026-09-25T00:00:00Z",
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "Earlier work is complete.",
          status: "complete",
          createdAt: "2026-09-25T00:00:01Z",
        },
        {
          id: "latest-user",
          role: "user",
          content: "Keep working after the checkpoint.",
          createdAt: "2026-09-25T00:00:02Z",
        },
      ],
    });
    try {
      await runtime.compactManually();

      expect(requests).toHaveLength(1);
      expect(requests[0]?.prompt_cache_key).toBe("session-1");
      const logged = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(logged).not.toContain("compaction summary failed");
    } finally {
      await runtime.dispose();
      stderr.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
