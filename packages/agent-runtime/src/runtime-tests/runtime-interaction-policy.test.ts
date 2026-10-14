import { describe, expect, it, vi } from "vitest";
import { getCurrentTools, Type, type ToolCall } from "@earendil-works/pi-ai";
import { DesktopAgentRuntime, type AgentRuntimeOptions, type RuntimeMatchConfig } from "../runtime.js";
import { ask, bash, fixture, questions, runtimeAccess } from "./runtime-interaction-fixture.js";

describe("unattended asktool admission", () => {
  it.each([
    ["ask first", [ask, bash]], ["ask last", [bash, ask]],
    ["unknown tool before ask", [{ ...bash, name: "UnknownTool" }, ask]],
    ["invalid arguments", [bash, { ...ask, arguments: { questions: "invalid" } }]],
    ["invalid tool before ask", [{ ...bash, arguments: {} }, ask]],
  ])("rejects the entire batch before lookup or execution: %s", async (_name, calls) => {
    const test = fixture([calls as ToolCall[]], "unattended");
    try {
      await test.runtime.prompt("Run fixture", "user", "turn");
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "asktool_request" || e.event.type.startsWith("tool_execution_"))).toEqual([]);
      const errors = test.events.filter(e => e.event.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].event).toMatchObject({ type: "error", error: { code: "INTERACTION_REQUIRED", retriable: false,
        details: { kind: "interaction_required", toolName: "asktool", toolCallId: "ask",
          questions: _name === "invalid arguments" ? [] : questions,
          ...(_name === "invalid arguments" ? { invalidArguments: true } : {}) } } });
      const lifecycle = test.events.filter(e => ["error", "turn_end", "agent_end"].includes(e.event.type)).map(e => e.event.type);
      expect(lifecycle).toEqual(["error", "turn_end", "agent_end"]);
      expect(test.runtime.getStatus()).toMatchObject({ isRunning: false, pendingToolConfirmations: 0 });
      expect(test.events.filter(e => e.event.type === "usage")).toHaveLength(1);
      const final = runtimeAccess(test.runtime).agent.state.messages.at(-1);
      expect(final).toMatchObject({ role: "assistant", content: calls, stopReason: "error", usage: { totalTokens: 10 } });
      expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
    } finally { await test.runtime.dispose(); }
  });

  it.each([undefined, "interactive"] as const)("retains asktool wait/resolve and tool execution for %s", async mode => {
    const test = fixture([[ask, bash]], mode);
    try {
      await test.runtime.prompt("Run interactive fixture", "user", "turn");
      expect(test.effects).toEqual(["tools.execute"]);
      expect(test.requests).toHaveLength(2);
      expect(test.events.filter(e => e.event.type === "asktool_request")).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "error")).toEqual([]);
      expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
      expect(getCurrentTools(test.requests[0].messages).some(tool => tool.name === "asktool")).toBe(true);
    } finally { await test.runtime.dispose(); }
  });

  it("merges all asktool questions in batch order without executing any tools", async () => {
    const secondQuestions = [{ question: "Select another value", options: ["Two", "Three"] }];
    const second = { ...ask, id: "ask-two", arguments: { questions: secondQuestions } };
    const test = fixture([[ask, bash, second]], "unattended");
    try {
      await test.runtime.prompt("Two decisions", "user", "turn");
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "error")[0]?.event).toMatchObject({
        type: "error", error: { details: { toolCallId: "ask", questions: [...questions, ...secondQuestions] } } });
    } finally { await test.runtime.dispose(); }
  });

  it.each([
    { ...ask, arguments: { questions: null } },
    { ...ask, arguments: { questions: [...Array.from({ length: 21 }, () => questions[0])] } },
    { ...ask, arguments: { questions: [{ question: "Select", options: Array.from({ length: 101 }, (_, i) => String(i)) }] } },
    { ...ask, arguments: { questions: [{ question: "x".repeat(65536), options: ["One"] }] } },
    { ...ask, id: "i".repeat(513) },
  ])("fails closed for an invalid or oversized asktool in a multi-ask batch", async malformed => {
    const test = fixture([[malformed, bash, ask]], "unattended");
    try {
      await test.runtime.prompt("Invalid decision", "user", "turn");
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
      const error = test.events.find(e => e.event.type === "error");
      expect(error?.event).toMatchObject({ type: "error", error: { code: "INTERACTION_REQUIRED",
        details: { questions: [], invalidArguments: true } } });
      expect((runtimeAccess(test.runtime).askTools.pending).size).toBe(0);
    } finally { await test.runtime.dispose(); }
  });

  it("does not advertise or discover asktool, including a plugin name collision", async () => {
    const search: ToolCall = { type: "toolCall", id: "search", name: "ToolSearch", arguments: { query: "asktool" } };
    const test = fixture([[search]], "unattended", "agent");
    runtimeAccess(test.runtime).pluginTools.push({ name: "asktool", description: "Collision", parameters: {} });
    runtimeAccess(test.runtime).rebuildToolCatalog();
    try {
      await test.runtime.prompt("Discover asktool", "user", "turn");
      expect(test.requests.every(request => !getCurrentTools(request.messages).some(tool => tool.name === "asktool"))).toBe(true);
      const result = test.requests.at(-1)?.messages.find(message => message.role === "toolResult");
      expect(result).toMatchObject({ role: "toolResult", details: { matches: [], activated: [] } });
      expect(runtimeAccess(test.runtime).toolCatalog.has("asktool")).toBe(false);
    } finally { await test.runtime.dispose(); }
  });

  it("preflights even when a permissive tool hook and stale executable catalog remain", async () => {
    const test = fixture([[bash, ask]], "unattended");
    const before = vi.fn(async () => undefined);
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    runtimeAccess(test.runtime).beforeToolCall = before;
    runtimeAccess(test.runtime).toolCatalog.set("asktool", { name: "asktool", label: "Collision", description: "Collision", parameters: Type.Object({}), execute });
    try {
      await test.runtime.prompt("Run fixture", "user", "turn");
      expect(before).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
    } finally { await test.runtime.dispose(); }
  });

  it("guards a retained direct asktool execute reference without allocating a waiter", async () => {
    const test = fixture([], "unattended");
    try {
      const tool = runtimeAccess(test.runtime).buildToolDefinitions().find(entry => entry.name === "asktool");
      if (!tool) throw new Error("Missing asktool defense");
      await expect(tool.execute("direct", ask.arguments)).rejects.toMatchObject({ errorCode: "INTERACTION_REQUIRED",
        details: { kind: "interaction_required", toolCallId: "direct", questions } });
      expect(test.events.filter(e => e.event.type === "asktool_request")).toEqual([]);
      expect(runtimeAccess(test.runtime).askTools.pending.size).toBe(0);
    } finally { await test.runtime.dispose(); }
  });

  it("preflights the result even when the provider emits no terminal stream event", async () => {
    const test = fixture([[bash, ask]], "unattended", "plan", { resultOnly: true });
    try {
      await test.runtime.prompt("Result-only stream", "user", "turn");
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "error")[0]?.event).toMatchObject({
        type: "error", error: { code: "INTERACTION_REQUIRED" } });
      expect(test.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
    } finally { await test.runtime.dispose(); }
  });

  it.each(["error", "aborted"] as const)("keeps existing provider %s terminal semantics", async terminal => {
    const test = fixture([[bash, ask]], "unattended", "plan", { terminal });
    try {
      await test.runtime.prompt("Terminal stream", "user", "turn");
      expect(test.effects).toEqual([]);
      expect(test.requests).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "asktool_request")).toEqual([]);
      expect(test.events.filter(e => e.event.type === "error").every(e =>
        e.event.type === "error" && e.event.error.code !== "INTERACTION_REQUIRED")).toBe(true);
      expect(runtimeAccess(test.runtime).agent.state.messages.at(-1)?.role === "assistant"
        ? (runtimeAccess(test.runtime).agent.state.messages.at(-1) as import("@earendil-works/pi-ai").AssistantMessage).stopReason : undefined).toBe(terminal);
      expect(test.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
    } finally { await test.runtime.dispose(); }
  });

  it("isolates a subsequent normal turn and never retries the interaction failure", async () => {
    const test = fixture([[ask], []], "unattended");
    try {
      await test.runtime.prompt("First turn", "user-1", "turn-1");
      await test.runtime.prompt("Second turn", "user-2", "turn-2");
      expect(test.requests).toHaveLength(2);
      expect(test.events.filter(e => e.event.type === "error")).toHaveLength(1);
      expect(test.events.filter(e => e.event.type === "agent_end")).toHaveLength(2);
      const second = test.events.filter(e => e.turnId === "turn-2" && e.event.type === "message_end");
      expect(second.at(-1)?.event).toMatchObject({ type: "message_end", message: { status: "complete" } });
    } finally { await test.runtime.dispose(); }
  });

  it("includes interaction policy in runtime reuse matching", async () => {
    const test = fixture([], "unattended");
    try {
      const config = test.options as RuntimeMatchConfig;
      expect(test.runtime.matches(config)).toBe(true);
      expect(test.runtime.matches({ ...config, interactionMode: "interactive" })).toBe(false);
      expect(test.runtime.matches({ ...config, interactionMode: undefined })).toBe(false);
    } finally { await test.runtime.dispose(); }
  });

  it.each([null, "unknown"])("rejects invalid runtime policy %s before model admission", async value => {
    const test = fixture([], "interactive");
    try {
      expect(() => new DesktopAgentRuntime({ ...test.options, interactionMode: value } as AgentRuntimeOptions)).toThrow("Invalid interaction mode");
      expect(test.requests).toEqual([]);
    } finally { await test.runtime.dispose(); }
  });
});
