import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { type RuntimeProviderConfig, DesktopAgentRuntime } from "../runtime.js";
import { provider, createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime compaction request headers", () => {

  const openCodeProvider: RuntimeProviderConfig = {
    ...provider,
    id: "row-uuid",
    name: "OpenCode Go",
    vendorKey: "opencode-go",
    apiStyle: "opencode_go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    headers: { "X-Team": "platform" },
  };

  /** The shape `prepareCompaction` returns for a single-turn history. */
  function preparation() {
    return {
      messagesToSummarize: [
        {
          role: "user",
          content: [{ type: "text", text: "older task context" }],
          timestamp: 1,
        },
      ],
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

  /** Replaces the collection with a recorder; only `completeSimple` is used. */
  function captureSummaryRequest(runtime: DesktopAgentRuntime) {
    const calls: any[] = [];
    (runtime as any).models = {
      completeSimple: async (_model: unknown, _context: unknown, options: unknown) => {
        calls.push(options);
        return assistantMessage({ content: [{ type: "text", text: "Older work." }] });
      },
    };
    return calls;
  }

  it("sends the session's OpenCode header on the summary request", async () => {
    const runtime = createRuntime({ provider: openCodeProvider });
    const calls = captureSummaryRequest(runtime);

    const result = await (runtime as any).generateCompaction(
      preparation(),
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe("session-1");
    expect(calls[0]?.headers).toMatchObject({
      "x-opencode-session": "session-1",
      "x-opencode-client": "pi-desktop",
      "X-Team": "platform",
    });
    await runtime.dispose();
  });

  it("sends a provider row's own headers without adding OpenCode's", async () => {
    const runtime = createRuntime({
      provider: { ...provider, headers: { "X-Team": "platform" } },
    });
    const calls = captureSummaryRequest(runtime);

    await (runtime as any).generateCompaction(
      preparation(),
      new AbortController().signal,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({ "X-Team": "platform" });
    await runtime.dispose();
  });
});
