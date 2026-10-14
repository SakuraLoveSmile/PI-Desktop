import { createAssistantMessageEventStream, type AssistantMessage, type Context, type ToolCall, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { Agent, AgentTool, BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime, type AgentRuntimeOptions, type PluginToolDef } from "../runtime.js";

/** Explicit test seam for inspecting execution resources and injecting providers. */
export type RuntimeTestAccess = {
  agent: Agent;
  askTools: { pending: Map<string, unknown> };
  toolCatalog: Map<string, AgentTool>;
  pluginTools: PluginToolDef[];
  buildToolDefinitions(): AgentTool[];
  rebuildToolCatalog(): void;
  beforeToolCall(context: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined>;
};
export const runtimeAccess = (runtime: DesktopAgentRuntime): RuntimeTestAccess => runtime as unknown as RuntimeTestAccess;

export const questions = [{ question: "Choose a result", options: ["Zero", { label: "One", description: "Return one" }] }];
export const ask: ToolCall = { type: "toolCall", name: "asktool", id: "ask", arguments: { questions } };
export const bash: ToolCall = { type: "toolCall", name: "Bash", id: "bash", arguments: { command: "printf fixture" } };

export function fixture(batches: ToolCall[][], mode?: "interactive" | "unattended", runtimeMode: "agent" | "plan" = "plan",
  response: { terminal?: "error" | "aborted"; resultOnly?: boolean; observe?: (event: AgentEventEnvelope) => void;
    beforeFinish?: (round: number, signal?: AbortSignal) => Promise<void> } = {}, overrides: Partial<AgentRuntimeOptions> = {}) {
  const events: AgentEventEnvelope[] = [];
  const requests: Context[] = [];
  const effects: string[] = [];
  const options = {
    sessionId: "policy-fixture", mode: runtimeMode, interactionMode: mode,
    provider: { id: "fixture", name: "Fixture", modelId: "fixture-model", authKind: "none",
      apiKey: "", baseUrl: "http://fixture.invalid/v1", supportsReasoning: false, supportedThinkingLevels: ["off"] },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    thinkingLevel: "off", history: [],
    host: { call: async <T>(method: string): Promise<T> => {
      if (method === "tools.execute") { effects.push(method); return { ok: true, content: "Fixture done" } as T; }
      if (method === "session.appendMessage") return undefined as T;
      throw new Error(`Unexpected host method: ${method}`);
    } },
    onEvent: (envelope: AgentEventEnvelope) => {
      events.push(envelope);
      response.observe?.(envelope);
      // Keep the old implementation from hanging during the failing baseline.
      if (envelope.event.type === "asktool_request") runtime.resolveAskTool({ requestId: envelope.event.request.requestId,
        sessionId: "policy-fixture", answers: [["Zero"]] });
    },
    ...overrides,
  } as AgentRuntimeOptions;
  const runtime = new DesktopAgentRuntime(options);
  let round = 0;
  const streamSimple = (_model: unknown, context: Context, streamOptions?: SimpleStreamOptions) => {
    requests.push({ ...context, messages: [...context.messages] });
    const calls = batches[round++] ?? [];
    const requestRound = round;
    const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "fixture",
      model: "fixture-model", content: calls.length ? calls : [{ type: "text", text: "Fixture complete." }],
      stopReason: response.terminal ?? (calls.length ? "toolUse" : "stop"), timestamp: round,
      ...(response.terminal ? { errorMessage: response.terminal === "error" ? "401: authentication failed" : "Cancelled" } : {}),
      usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      await response.beforeFinish?.(requestRound, streamOptions?.signal);
      if (streamOptions?.signal?.aborted) { message.stopReason = "aborted"; message.errorMessage = "Cancelled"; }
      if (!response.resultOnly) {
        stream.push({ type: "start", partial: message });
        if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
        else stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
      }
      stream.end(message);
    });
    return stream;
  };
  (runtime as unknown as { models: { streamSimple: typeof streamSimple } }).models = { streamSimple };
  return { runtime, events, requests, effects, options };
}
