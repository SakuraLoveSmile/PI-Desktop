import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type RuntimeProviderConfig } from "../runtime.js";
import { provider, createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime Google Generative AI transport (#1072)", () => {

  it("streams a turn through the native endpoint with the provider's headers", async () => {
    const googleProvider: RuntimeProviderConfig = {
      ...provider,
      id: "google",
      name: "Google Gemini",
      vendorKey: "google",
      apiStyle: "google_generative_ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      modelId: "gemini-3.8-flash",
      apiKey: "AIza-test",
      authKind: "api_key",
      headers: { "X-Team": "platform" },
      modelConfig: {
        source: "generic",
        name: "Gemini 3.8 Flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_000_000,
        maxTokens: 65_536,
      },
    };
    const runtime = createRuntime({ provider: googleProvider, thinkingLevel: "off" });
    const agent = (runtime as any).agent;
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      requests.push({
        url: input instanceof Request ? input.url : String(input),
        headers,
      });
      const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
      return new Response(
        chunk({
          candidates: [{ content: { role: "model", parts: [{ text: "hello" }] }, index: 0 }],
        }) +
          chunk({
            candidates: [
              { content: { role: "model", parts: [] }, finishReason: "STOP", index: 0 },
            ],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
          }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });

    try {
      const stream = agent.streamFunction(
        agent.state.model,
        {
          systemPrompt: "system",
          messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
          tools: [],
        },
        {},
      );
      const result = await stream.result();

      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "hello" }]);
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
      );
      expect(requests[0].headers["x-team"]).toBe("platform");
    } finally {
      vi.unstubAllGlobals();
      await runtime.dispose();
    }
  }, 20_000);
});
