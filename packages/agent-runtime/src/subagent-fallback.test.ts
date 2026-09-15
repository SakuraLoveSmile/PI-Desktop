import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { Type } from "typebox";
import { SubagentRun, type SubagentRunOptions } from "./subagent.js";
import { genericModelConfig } from "./model-capabilities.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

type Request = { model: string; messages: Array<{ role: string; content: unknown }>; reasoning_effort?: string };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function answer(res: ServerResponse, model: string, tool = false) {
  const delta = tool
    ? { role: "assistant", tool_calls: [{ index: 0, id: "once", type: "function", function: { name: "Edit", arguments: "{}" } }] }
    : { role: "assistant", content: "Completed with retained work." };
  const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model };
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function fixture(options: {
  fail?: string[];
  editFirst?: boolean;
  onRequest?: (request: Request) => void;
} = {}) {
  const requests: Request[] = [];
  const headers: Array<string | undefined> = [];
  let edits = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const request = JSON.parse(raw) as Request;
    requests.push(request);
    headers.push(req.headers.authorization);
    options.onRequest?.(request);
    if (options.editFirst && requests.length === 1) {
      answer(res, request.model, true);
    } else if ((options.fail ?? ["primary"]).includes(request.model)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "model not found" } }));
    } else {
      answer(res, request.model);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  const provider = (modelId: string): RuntimeProviderConfig => ({
    id: modelId, name: modelId, modelId,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: `fixture-${modelId}`, authKind: "api_key_and_base_url", apiStyle: "openai-chat",
    supportsReasoning: false, supportedThinkingLevels: ["off"],
  });
  const events: AgentEventEnvelope[] = [];
  const tool: AgentTool = {
    name: "Edit", label: "Edit", description: "Record a mutation once.", parameters: Type.Object({}),
    execute: async () => { edits++; return { content: [{ type: "text", text: "Saved exactly once" }], details: {} }; },
  };
  const run = (overrides: Partial<SubagentRunOptions> = {}) => new SubagentRun({
    definition: { name: "worker", description: "Fixture", tools: ["Edit"], prompt: "Finish.", source: "user" },
    sessionId: "s", parentToolCallId: "task", task: "Finish the work.", systemPrompt: "Finish the work.",
    provider: provider("primary"), thinkingLevel: "off", tools: [tool],
    fallbackModels: [{ key: "secondary/secondary", provider: provider("secondary") }],
    onEvent: (event) => events.push(event), ...overrides,
  }).run();
  return { run, provider, requests, headers, events, edits: () => edits };
}

describe("subagent model fallback over real transport", () => {
  it("changes credentials and model, preserving completed tool work and usage", async () => {
    const f = await fixture({ editFirst: true });
    const result = await f.run();
    expect(result.status).toBe("completed");
    expect(result.modelId).toBe("secondary");
    expect(f.requests.map((request) => request.model)).toEqual(["primary", "primary", "secondary"]);
    expect(f.headers).toEqual(["Bearer fixture-primary", "Bearer fixture-primary", "Bearer fixture-secondary"]);
    expect(f.edits()).toBe(1);
    expect(f.requests[2].messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(f.requests[2].messages.some((message) => message.role === "tool" && String(message.content).includes("Saved exactly once"))).toBe(true);
    expect(result.toolCalls).toBe(1);
    expect(result.usage?.outputTokens).toBe(10);
    expect(result.modelFailures).toEqual([expect.objectContaining({ model: "primary/primary", code: "MODEL_NOT_CONFIGURED" })]);
    expect(f.events.every((event) => event.parentToolCallId === "task")).toBe(true);
    expect(f.events.some((event) => event.event.type === "message_end" && event.event.message.modelId === "secondary")).toBe(true);
  });

  it("tries alternatives in order once, skips unresolved bindings visibly, and reports exhaustion", async () => {
    const f = await fixture({ fail: ["primary", "secondary", "third"] });
    const result = await f.run({ fallbackModels: [
      { key: "alias/primary", provider: f.provider("primary") },
      { key: "missing/model" },
      { key: "secondary/secondary", provider: f.provider("secondary") },
      { key: "alias/secondary", provider: f.provider("secondary") },
      { key: "third/third", provider: f.provider("third") },
    ] });
    expect(result.status).toBe("failed");
    expect(result.modelId).toBe("third");
    expect(f.requests.map((request) => request.model)).toEqual(["primary", "secondary", "third"]);
    expect(result.modelFailures?.map((failure) => failure.model)).toEqual(["primary/primary", "missing/model", "secondary/secondary", "third/third"]);
    expect(result.report).toContain("missing/model");
  });

  it("does not call alternatives on success or when none are configured", async () => {
    const f = await fixture({ fail: [] });
    expect((await f.run()).status).toBe("completed");
    expect(f.requests.map((request) => request.model)).toEqual(["primary"]);
    const failing = await fixture();
    expect((await failing.run({ fallbackModels: [] })).status).toBe("failed");
    expect(failing.requests.map((request) => request.model)).toEqual(["primary"]);
  });

  it("stops before fallback when the owner cancels", async () => {
    const controller = new AbortController();
    const f = await fixture({ onRequest: () => controller.abort() });
    expect((await f.run({ signal: controller.signal })).status).toBe("aborted");
    expect(f.requests.map((request) => request.model)).toEqual(["primary"]);
  });

  it("re-clamps inherited thinking from the original selection for each model", async () => {
    const f = await fixture();
    const next: RuntimeProviderConfig = { ...f.provider("secondary"), supportsReasoning: true, supportedThinkingLevels: ["off", "high"],
      modelConfig: { ...genericModelConfig("secondary", f.provider("secondary").baseUrl!), reasoning: true, supportedThinkingLevels: ["off", "high"] as const } };
    const changes: string[] = [];
    const result = await f.run({ inheritedThinkingLevel: "high", fallbackModels: [{ key: "s/secondary", provider: next }],
      onModelChange: (_, level) => changes.push(level) });
    expect(result.thinkingLevel).toBe("high");
    expect(changes).toEqual(["high"]);
    expect(f.requests[1].reasoning_effort).toBe("high");
  });
  it("does not retry a host tool failure through another model", async () => {
    const f = await fixture({ editFirst: true });
    await f.run({ resolveToolOutcome: () => ({ isError: true, terminate: true }) });
    expect(f.edits()).toBe(1);
    expect(f.requests.map((request) => request.model)).toEqual(["primary"]);
  });

  it("keeps thinking omission and honors cancellation during the switch", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const result = await f.run({ thinkingLevel: "omit", signal: controller.signal,
      onModelChange: () => controller.abort() });
    expect(result.status).toBe("aborted");
    expect(f.requests.map((request) => request.model)).toEqual(["primary"]);
    const g = await fixture();
    const omitted = await g.run({ thinkingLevel: "omit" });
    expect(omitted.thinkingLevel).toBe("omit");
    expect(g.requests.every((request) => request.reasoning_effort === undefined)).toBe(true);
  });

});
