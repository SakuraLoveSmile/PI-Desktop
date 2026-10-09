import { describe, expect, it, vi } from "vitest";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, Type, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import type { ContextInsightsRequest } from "@pi-desktop/shared";
import { captureContextRequest, contextRequestObserver } from "./context-insights.js";
import { accountModelStream } from "./request-usage.js";
import { estimateContextTokens } from "./pi-runtime-estimates.js";

const model: Model<"openai-completions"> = { id: "fixture", name: "Fixture", provider: "fixture", api: "openai-completions",
  baseUrl: "https://invalid.local", reasoning: false, input: ["text", "image"], contextWindow: 100_000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 10, output: 2, cacheRead: 5, cacheWrite: 0, totalTokens: 17, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const metadata = { id: "request", providerId: "binding", turnId: "turn", mode: "agent", step: 1, startedAt: 100 };
function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 3, content, stopReason, usage: { ...usage } };
}

describe("model context diagnostics", () => {
  it("preserves system epochs/effective tools, user/skill/result/reasoning blocks without mutating input or retaining images", () => {
    const context: Context = { messages: [
      { role: "system", content: "Base", sections: { runtime: "Policy", "skill:read": "Read skill", context: "Project memory" }, toolsAdded: [{ name: "Old", description: "Old tool", parameters: Type.Object({}) }], timestamp: 1 },
      { role: "system", content: "", sections: { runtime: "New policy" }, toolsRemoved: [{ name: "Old" }], toolsAdded: [{ name: "Read", description: "Read file", parameters: Type.Object({ path: Type.String() }) }], timestamp: 2 },
      { role: "user", content: [{ type: "text", text: "Read file" }, { type: "image", data: "private-image-data", mimeType: "image/png" }], timestamp: 3 },
      assistant([{ type: "thinking", thinking: "Inspect file" }, { type: "toolCall", id: "call", name: "Read", arguments: { path: "a.ts" } }], "toolUse"),
      { role: "toolResult", toolName: "Skill", toolCallId: "skill", content: [{ type: "text", text: "Actual skill body" }], isError: false, timestamp: 4 },
      { role: "toolResult", toolName: "Read", toolCallId: "call", content: [{ type: "text", text: "File contents" }], isError: false, timestamp: 5 },
    ] };
    const before = JSON.stringify(context);
    const request = captureContextRequest(model, context, metadata);
    expect(JSON.stringify(context)).toBe(before);
    expect(JSON.stringify(request)).not.toContain("private-image-data");
    expect(request.entries.find(entry => entry.category === "user")?.images).toEqual([{ mimeType: "image/png", encodedBytes: 18 }]);
    expect(request.entries.find(entry => entry.label === "runtime [1]")).toMatchObject({ content: "Policy", historical: true });
    expect(request.entries.find(entry => entry.label === "runtime [2]")).toMatchObject({ content: "New policy", historical: false });
    expect(request.entries.filter(entry => entry.category === "tools").map(entry => entry.label)).toEqual(["Read"]);
    expect(request.entries.find(entry => entry.kind === "thinking")?.content).toBe("Inspect file");
    expect(request.entries.find(entry => entry.kind === "toolCall")?.content).toContain('"path": "a.ts"');
    expect(request.entries.filter(entry => entry.category === "skill")).toHaveLength(2);
    expect(request.estimatedTokens).toBe(estimateContextTokens(context.messages, model).tokens);
  });

  it("explicitly truncates browser text at the content budget while estimating original input", () => {
    const context: Context = { messages: [{ role: "user", content: "x".repeat(150_000), timestamp: 1 }] };
    const request = captureContextRequest(model, context, metadata);
    expect(request.entries[0]).toMatchObject({ originalChars: 150_000, truncated: true, estimatedTokens: 37_500 });
    expect(request.entries[0]?.content).toHaveLength(120_000);
    expect(request.contentTruncated).toBe(true);
  });

  it("observes the real Agent user → tool → follow-up path with matching operation identities and unchanged outputs", async () => {
    const captured: ContextInsightsRequest[] = [];
    let step = 0;
    const agent = new Agent({ initialState: { model, tools: [{ name: "Read", label: "Read", description: "Read", parameters: Type.Object({ path: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "Real fixture result" }], details: {} }) }] },
      streamFn: (m, context) => {
        step++;
        return accountModelStream(m, () => {
          const stream = createAssistantMessageEventStream();
          const message = step === 1 ? assistant([{ type: "toolCall", id: "read", name: "Read", arguments: { path: "file.ts" } }], "toolUse") : assistant([{ type: "text", text: "Done" }]);
          stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
          stream.end(); return stream;
        }, contextRequestObserver(m, context, { providerId: "binding", mode: "agent", turnId: "turn", step }, request => captured.push(request)));
      },
    });
    await agent.prompt("Read file.ts");
    const settled = captured.filter(request => request.status === "completed");
    expect(settled).toHaveLength(2);
    expect(settled[0]?.entries.some(entry => entry.content.includes("Read file.ts"))).toBe(true);
    expect(settled[1]?.entries.some(entry => entry.label === "Read" && entry.category === "toolResult" && entry.content.includes("Real fixture result"))).toBe(true);
    expect(settled[1]?.usage?.operationId).toBe(settled[1]?.id);
    expect(settled[1]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(agent.state.messages.at(-1)).toMatchObject({ content: [{ type: "text", text: "Done" }] });
  });

  it("settles each aborted attempt once across iterator/result and preserves cancellation", async () => {
    vi.useFakeTimers();
    try {
      const captured: ContextInsightsRequest[] = [];
      const context: Context = { messages: [{ role: "user", content: "Stop", timestamp: 1 }] };
      const stream = accountModelStream(model, () => {
        const inner = createAssistantMessageEventStream();
        inner.push({ type: "error", reason: "aborted", error: assistant([], "aborted") }); inner.end(); return inner;
      }, contextRequestObserver(model, context, metadata, request => captured.push(request)));
      vi.advanceTimersByTime(250);
      for await (const _event of stream) { /* Consume the owned stream. */ }
      expect((await stream.result()).stopReason).toBe("aborted");
      expect(captured.map(request => request.status)).toEqual(["running", "aborted"]);
      expect(captured[1]?.durationMs).toBe(250);
    } finally { vi.useRealTimers(); }
  });
  it("keeps Unicode valid at the cutoff and bounds serialized control escapes", () => {
    const unicode = captureContextRequest(model, { messages: [{ role: "user", content: "x".repeat(119999) + "😀more", timestamp: 1 }] }, metadata);
    expect(unicode.entries[0]?.content).toHaveLength(119999);
    expect(unicode.entries[0]?.content.at(-1)).toBe("x");
    const escaped = captureContextRequest(model, { messages: [{ role: "user", content: "\u0001".repeat(120000), timestamp: 1 }] }, metadata);
    expect(Buffer.byteLength(JSON.stringify(escaped))).toBeLessThan(600000);
    expect(escaped.contentTruncated).toBe(true);
    expect(escaped.entries[0]?.originalChars).toBe(120000);
  });

  it("captures the observed final provider payload separately and redacts auth/image binaries", () => {
    const captured: ContextInsightsRequest[] = [];
    const observer = contextRequestObserver(model, { messages: [{ role: "user", content: "Before hook", timestamp: 1 }] }, metadata, request => captured.push(request));
    observer.onRequest({ operationId: "wire" });
    observer.onPayload({ messages: [{ role: "user", content: "After extension hook" }], headers: { Authorization: "secret" }, api_key: "secret-key",
      image_url: "data:image/png;base64,private-image" });
    const request = captured.at(-1)!;
    expect(request.captureSource).toBe("provider-payload");
    expect(request.providerPayload?.content).toContain("After extension hook");
    expect(request.providerPayload?.content).not.toContain("Before hook");
    expect(request.providerPayload?.content).not.toContain("secret");
    expect(request.providerPayload?.content).not.toContain("private-image");
    expect(request.providerPayload?.redacted).toBe(true);
  });

  it("redacts Google/Bedrock binary structures while preserving ordinary text data", () => {
    const captured: ContextInsightsRequest[] = [];
    const observer = contextRequestObserver(model, { messages: [] }, metadata, request => captured.push(request));
    observer.onRequest({ operationId: "binary" });
    observer.onPayload({ contents: [{ inlineData: { mimeType: "image/png", data: "gemini-private-binary" } },
      { inline_data: { mime_type: "image/jpeg", data: "other-private-binary" } }],
      image: { source: { bytes: new Uint8Array([112, 114, 105, 118, 97, 116, 101]) } },
      buffer: Buffer.from("private buffer"), arrayBuffer: new Uint8Array([254, 253]).buffer,
      tool: { data: "ordinary file text" } });
    const payload = captured.at(-1)!.providerPayload!;
    expect(payload.content).not.toContain("gemini-private-binary");
    expect(payload.content).not.toContain("other-private-binary");
    expect(payload.content).not.toContain('"0": 112');
    expect(payload.content).not.toContain('"type": "Buffer"');
    expect(payload.content).toContain("ordinary file text");
    expect(payload.redacted).toBe(true);
  });

});
