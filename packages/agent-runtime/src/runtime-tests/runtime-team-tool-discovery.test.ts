import { describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream, getCurrentTools,
  type AssistantMessage, type Context, type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExpertTeamConfigSnapshot } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";
import { DesktopAgentRuntime } from "../runtime.js";

async function runMember(options: { config?: ExpertTeamConfigSnapshot; research?: boolean; calls: ToolCall[] }) {
  const requests: Context[] = [];
  const hostCalls: Array<{ method: string; params: unknown }> = [];
  const host: RuntimeHost = { call: async <T>(method: string, params?: unknown): Promise<T> => {
    hostCalls.push({ method, params });
    if (method === "tools.execute") return { ok: true, content: "Checklist saved." } as T;
    if (method === "team.updateTask") return { task: { taskId: "owned-task", revision: 2, status: "in_progress" } } as T;
    if (method === "session.appendMessage" || method === "session.updateCompaction") return undefined as T;
    throw new Error(`Unexpected Host call: ${method}`);
  } };
  const runtime = new DesktopAgentRuntime({
    host, sessionId: "expert", mode: "agent", executionProfile: "team",
    teamContext: { teamSessionId: "lead", callerSessionId: "expert", isLead: false,
      memberName: "qa", workPurpose: options.research ? "plan_research" : "execute", expertConfig: options.config },
    provider: { id: "fixture", name: "Fixture", baseUrl: "http://fixture.invalid/v1", modelId: "fixture-model",
      apiKey: "", authKind: "none", supportsReasoning: false, supportedThinkingLevels: ["off"] },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    thinkingLevel: "off", history: [], onEvent: () => {},
  });
  let round = 0;
  const streamSimple = (_model: unknown, context: Context) => {
    requests.push({ ...context, messages: [...context.messages] });
    const call = options.calls[round++];
    const message: AssistantMessage = {
      role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture-model",
      content: call ? [call] : [{ type: "text", text: "Task update recorded." }],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: call ? "toolUse" : "stop", timestamp: round,
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: call ? "toolUse" : "stop", message }); stream.end(message); });
    return stream;
  };
  (runtime as unknown as { models: { streamSimple: typeof streamSimple } }).models = { streamSimple };
  try { await runtime.prompt("Maintain the assigned task using the permitted tools.", "request", "expert-turn"); }
  finally { await runtime.dispose(); }
  return { requests, hostCalls, results: requests.at(-1)?.messages.filter(message => message.role === "toolResult") ?? [] };
}

const search: ToolCall = { type: "toolCall", id: "search", name: "ToolSearch", arguments: { query: "TodoWrite" } };
const update: ToolCall = { type: "toolCall", id: "update", name: "task_update",
  arguments: { taskId: "owned-task", expectedRevision: 1, status: "in_progress" } };

describe("Team member tool discovery and legal task workflow", () => {
  it("retains TodoWrite activation and execution for a standard Agent member", async () => {
    const result = await runMember({ calls: [search, { type: "toolCall", id: "todo", name: "TodoWrite",
      arguments: { todos: [{ content: "Verify the source", status: "in_progress" }] } }] });
    expect(result.hostCalls.filter(call => call.method === "tools.execute")).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ toolName: "TodoWrite", sessionId: "expert" }) }),
    ]);
    expect(result.results).toContainEqual(expect.objectContaining({ toolName: "TodoWrite", isError: false }));
    expect(getCurrentTools(result.requests[1].messages).some(tool => tool.name === "TodoWrite")).toBe(true);
  });

  it("explains exact restricted discovery without activating TodoWrite and then performs task_update", async () => {
    const result = await runMember({ config: { presetId: "reviewer", tools: ["Read"] },
      calls: [{ ...search, arguments: { query: "todowrite" } }, update] });
    const discovery = result.results.find(message => message.toolName === "ToolSearch");
    expect(discovery?.content).toEqual([expect.objectContaining({ type: "text",
      text: expect.stringContaining("Host-approved reviewer") })]);
    expect(JSON.stringify(discovery?.content)).toContain("task_update");
    expect(JSON.stringify(discovery?.content)).toContain("expectedRevision");
    expect(JSON.stringify(discovery?.content)).not.toContain("No matching");
    expect(result.requests.every(request => !getCurrentTools(request.messages).some(tool => tool.name === "TodoWrite"))).toBe(true);
    expect(result.hostCalls.filter(call => call.method === "tools.execute")).toEqual([]);
    expect(result.hostCalls.filter(call => call.method === "team.updateTask")).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ callerSessionId: "expert", expectedCallerTurnId: "expert-turn",
        taskId: "owned-task", expectedRevision: 1, status: "in_progress" }) }),
    ]);
    expect(result.results).toContainEqual(expect.objectContaining({ toolName: "task_update", isError: false }));
  });

  it("does not reinterpret an unknown exact name as a restricted tool or activate work tools", async () => {
    const result = await runMember({ config: { presetId: "reviewer", tools: ["Read"] },
      calls: [{ ...search, arguments: { query: "ImaginaryTool" } }, update] });
    const discovery = result.results.find(message => message.toolName === "ToolSearch");
    expect(discovery?.isError).toBe(false);
    expect(JSON.stringify(discovery?.content)).toContain("No matching on-demand tool");
    expect(result.hostCalls.filter(call => call.method === "tools.execute")).toEqual([]);
    expect(result.results).toContainEqual(expect.objectContaining({ toolName: "task_update", isError: false }));
  });

  it("keeps research discovery denied with an actionable read-only explanation and task_update path", async () => {
    const result = await runMember({ research: true, calls: [search, update] });
    const discovery = result.results.find(message => message.toolName === "ToolSearch");
    expect(discovery?.isError).toBe(true);
    expect(JSON.stringify(discovery?.content)).toContain("Plan research");
    expect(JSON.stringify(discovery?.content)).toContain("task_update");
    expect(result.requests.every(request => !getCurrentTools(request.messages).some(tool => tool.name === "TodoWrite"))).toBe(true);
    expect(result.hostCalls.filter(call => call.method === "tools.execute")).toEqual([]);
    expect(result.results).toContainEqual(expect.objectContaining({ toolName: "task_update", isError: false }));
  });
});
