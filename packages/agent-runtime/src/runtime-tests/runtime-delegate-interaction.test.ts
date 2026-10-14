import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, getCurrentTools, Type, type AssistantMessage, type Context, type ToolCall } from "@earendil-works/pi-ai";
import * as bindings from "../provider-binding.js";
import { SubagentRun, type SubagentRunOptions } from "../subagent.js";
import { ask, bash, fixture, questions, runtimeAccess } from "./runtime-interaction-fixture.js";

afterEach(() => vi.restoreAllMocks());

function childProvider(calls: ToolCall[], firstFailure = false, gate?: Promise<void>) {
  const requests: Context[] = [];
  const original = bindings.createProviderModels;
  vi.spyOn(bindings, "createProviderModels").mockImplementation((provider, model) => {
    const models = original(provider, model);
    return { ...models, streamSimple: (_m, context) => {
      const failure = firstFailure && requests.length === 0;
      const followup = requests.length > (firstFailure ? 1 : 0);
      requests.push({ ...context, messages: [...context.messages] });
      const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture-model",
        content: followup ? [{ type: "text", text: "Unexpected follow-up" }] : calls,
        stopReason: failure ? "error" : followup ? "stop" : "toolUse", timestamp: 1,
        ...(failure ? { errorMessage: "401: authentication failed" } : {}),
        usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(async () => { await gate; stream.push({ type: "start", partial: message });
        if (failure) stream.push({ type: "error", reason: "error", error: message });
        else stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(message); });
      return stream;
    } };
  });
  return requests;
}

describe("unattended delegation admission", () => {
  it.each(["initial", "resumed", "fallback"])("rejects a child's entire unknown-ask batch for %s and preserves questions", async path => {
    const requests = childProvider([bash, ask], path === "fallback");
    const parent = fixture([], "unattended");
    let effects = 0;
    const run = new SubagentRun({ definition: { name: "worker", description: "Fixture", tools: ["Bash"], prompt: "Fixture", source: "builtin" },
      interactionMode: "unattended", sessionId: "fixture", turnId: "turn", parentToolCallId: "task",
      task: "Fixture", provider: parent.options.provider, thinkingLevel: "off", systemPrompt: "Fixture",
      fallbackModels: [{ key: "fallback", provider: { ...parent.options.provider, modelId: "fallback" } }],
      tools: [{ name: "Bash", label: "Bash", description: "Fixture", parameters: Type.Object({ command: Type.String() }),
        execute: async () => { effects++; return { content: [], details: {} }; } }], onEvent: () => {},
      ...(path === "resumed" ? { initialMessages: [{ role: "user", content: "Earlier brief", timestamp: 0 }] } : {}),
    } as SubagentRunOptions);
    try {
      const result = await run.run();
      expect(effects).toBe(0);
      expect(requests).toHaveLength(path === "fallback" ? 2 : 1);
      expect(result).toMatchObject({ status: "failed", toolCalls: 0,
        error: { code: "INTERACTION_REQUIRED", details: { kind: "interaction_required", questions, toolCallId: "ask" } } });
      if (path === "fallback") expect(result.modelFailures).toHaveLength(1);
      else expect(result.modelFailures).toBeUndefined();
    } finally { await parent.runtime.dispose(); }
  });

  it("ends the parent turn with the child's questions instead of asking the main model to decide", async () => {
    const requests = childProvider([bash, ask]);
    const task: ToolCall = { type: "toolCall", name: "Task", id: "task", arguments: { agent: "worker", task: "Fixture" } };
    let requestsAtDecision = -1;
    const parent = fixture([[task], []], "unattended", "agent", { observe: envelope => {
      if (envelope.event.type === "error") requestsAtDecision = parent.requests.length;
    } }, { subagents: [
      { name: "worker", description: "Fixture", tools: ["Bash"], prompt: "Fixture", source: "builtin" },
    ] });
    try {
      await parent.runtime.prompt("Delegate fixture", "user", "turn");
      expect(parent.effects).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requestsAtDecision).toBeGreaterThan(0);
      expect(parent.requests).toHaveLength(requestsAtDecision);
      const errors = parent.events.filter(e => e.event.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.event).toMatchObject({ type: "error", error: { code: "INTERACTION_REQUIRED",
        details: { kind: "interaction_required", questions, toolCallId: "ask" } } });
      expect(parent.events.filter(e => e.event.type === "asktool_request")).toEqual([]);
      expect(parent.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
      expect(parent.runtime.getStatus()).toMatchObject({ isRunning: false });
      expect(parent.events.filter(e => ["error", "turn_end", "agent_end"].includes(e.event.type)).map(e => e.event.type)).toEqual([
        "error", "turn_end", "agent_end",
      ]);
      expect(parent.events.find(e => e.event.type === "turn_end")?.event).toMatchObject({
        type: "turn_end", subagentUsage: { outputTokens: 3, inputTokens: 7 },
      });
      const childEnd = parent.events.findIndex(e => e.event.type === "message_end" && e.agentName === "worker");
      const parentError = parent.events.findIndex(e => e.event.type === "error");
      expect(childEnd).toBeGreaterThan(-1);
      expect(parentError).toBeGreaterThan(childEnd);
    } finally { await parent.runtime.dispose(); }
  });

  it("removes child asktool declarations even from an explicit or restored catalog", async () => {
    const requests = childProvider([ask]);
    const parent = fixture([], "unattended");
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    const run = new SubagentRun({ interactionMode: "unattended",
      definition: { name: "worker", description: "Fixture", tools: ["Read"], prompt: "Fixture", source: "builtin" },
      sessionId: "fixture", parentToolCallId: "task", task: "Fixture", provider: parent.options.provider,
      thinkingLevel: "off", systemPrompt: "Fixture", onEvent: () => {},
      tools: [{ name: "asktool", label: "Ask", description: "Fixture", parameters: Type.Object({}), execute }],
    });
    try {
      await run.run();
      expect(execute).not.toHaveBeenCalled();
      expect(getCurrentTools(requests[0].messages).some(tool => tool.name === "asktool")).toBe(false);
    } finally { await parent.runtime.dispose(); }
  });

  it("interrupts an active parent request, accounts the child, and isolates the next human turn", async () => {
    let releaseChild = () => {};
    const gate = new Promise<void>(resolve => { releaseChild = resolve; });
    const requests = childProvider([bash, ask], false, gate);
    const task: ToolCall = { type: "toolCall", name: "Task", id: "task", arguments: { agent: "worker", task: "Fixture" } };
    const parent = fixture([[task], []], "unattended", "agent", { beforeFinish: async (round, signal) => {
      if (round !== 2) return;
      releaseChild();
      if (signal?.aborted) return;
      await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
    } }, { subagents: [{ name: "worker", description: "Fixture", tools: ["Bash"], prompt: "Fixture", source: "builtin" }] });
    try {
      await parent.runtime.prompt("Delegate fixture", "user-1", "turn-1");
      expect(parent.requests).toHaveLength(2);
      expect(requests).toHaveLength(1);
      expect(parent.effects).toEqual([]);
      expect(parent.events.filter(e => e.event.type === "error")).toHaveLength(1);
      expect(parent.events.find(e => e.event.type === "turn_end")?.event).toMatchObject({ type: "turn_end",
        subagentUsage: { outputTokens: 3, inputTokens: 7 } });
      expect(parent.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
      await parent.runtime.prompt("New human turn", "user-2", "turn-2");
      expect(parent.requests).toHaveLength(3);
      const secondEnd = parent.events.find(e => e.turnId === "turn-2" && e.event.type === "turn_end");
      expect(secondEnd?.event).toEqual({ type: "turn_end" });
      expect(parent.runtime.getStatus().isRunning).toBe(false);
    } finally { releaseChild(); await parent.runtime.dispose(); }
  });

  it("settles exactly once when the parent is already idle awaiting the child", async () => {
    let releaseChild = () => {};
    const gate = new Promise<void>(resolve => { releaseChild = resolve; });
    const requests = childProvider([ask, bash], false, gate);
    const task: ToolCall = { type: "toolCall", name: "Task", id: "task", arguments: { agent: "worker", task: "Fixture" } };
    let sawIdle = false;
    const parent = fixture([[task], []], "unattended", "agent", { observe: envelope => {
      if (envelope.event.type === "status" && envelope.event.status.activity?.phase === "waiting-subagents") {
        sawIdle = !runtimeAccess(parent.runtime).agent.state.isStreaming;
        releaseChild();
      }
    } }, { subagents: [{ name: "worker", description: "Fixture", tools: ["Bash"], prompt: "Fixture", source: "builtin" }] });
    try {
      await parent.runtime.prompt("Wait for delegate", "user", "turn");
      expect(sawIdle).toBe(true);
      expect(requests).toHaveLength(1);
      expect(parent.requests).toHaveLength(2);
      expect(parent.effects).toEqual([]);
      expect(parent.events.filter(e => ["error", "turn_end", "agent_end"].includes(e.event.type)).map(e => e.event.type)).toEqual([
        "error", "turn_end", "agent_end",
      ]);
      expect(parent.events.find(e => e.event.type === "turn_end")?.event).toMatchObject({ type: "turn_end",
        subagentUsage: { outputTokens: 3, inputTokens: 7 } });
      expect(parent.runtime.getStatus().isRunning).toBe(false);
    } finally { releaseChild(); await parent.runtime.dispose(); }
  });
});
