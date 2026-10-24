import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "../runtime.js";
import { SubagentRun } from "../subagent.js";
import type { ClassifiedAgentError } from "../agent-errors.js";
import type { RuntimeProviderConfig } from "../provider-binding.js";
import { createCompactionSummaryMessage } from "../pi-runtime-messages.js";

const provider: RuntimeProviderConfig = {
  id: "retry-fixture", name: "Retry fixture", baseUrl: "http://127.0.0.1:1/v1",
  modelId: "fixture", apiKey: "", authKind: "none", supportsReasoning: false,
  supportedThinkingLevels: ["off"],
};

type RetryView = {
  agent: Agent;
  pendingProviderRetry?: ClassifiedAgentError;
  providerTransientRetryAttempt: number;
  retryPendingProviderFailure(): Promise<void>;
};

const response: AssistantMessage = {
  role: "assistant", content: [{ type: "text", text: "Recovered after compaction." }],
  api: "openai-completions", provider: provider.id, model: provider.modelId,
  usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: 5,
};

describe("provider retry after transcript compaction", () => {
  for (const kind of ["parent", "delegate"] as const) {
    it.each([false, true])(`${kind} continues the retained summary (system update: %s)`, async (systemUpdate) => {
      const events: AgentEventEnvelope["event"][] = [];
      const onEvent = (envelope: AgentEventEnvelope) => events.push(envelope.event);
      const runtime = kind === "parent" ? new DesktopAgentRuntime({
        sessionId: "session-1", mode: "agent", provider, thinkingLevel: "off", onEvent,
        commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
        host: { call: async <T>(method: string): Promise<T> => {
          if (method === "session.appendMessage") return undefined as T;
          throw new Error(`Unexpected host method: ${method}`);
        }, onNotification: () => () => {} },
      }) : new SubagentRun({
        sessionId: "session-1", turnId: "turn-1", parentToolCallId: "task-1",
        definition: { name: "explorer", description: "Review", prompt: "Review", tools: [], source: "builtin" },
        task: "Continue the review", provider, thinkingLevel: "off", systemPrompt: "Review", tools: [], onEvent,
      });
      const view = runtime as unknown as RetryView;
      const lifecycle: string[] = [];
      const unsubscribe = view.agent.subscribe(event => {
        if (event.type === "turn_end" || event.type === "agent_end") lifecycle.push(event.type);
      });
      // Compaction has already removed the failed assistant. Preserve the new
      // summary and any following system delta while the real Agent continues.
      const retained: AgentMessage[] = [
        { role: "user", content: "Continue the review", timestamp: 1 },
        createCompactionSummaryMessage("Earlier work was summarized.", 100_000, 2) as unknown as AgentMessage,
        ...(systemUpdate ? [{ role: "system" as const, content: "", sections: { context_budget: null }, timestamp: 3 }] : []),
      ];
      view.agent.state.messages = retained;
      view.pendingProviderRetry = { code: "STREAM_FAILED", message: "stream terminated", retriable: true };
      view.providerTransientRetryAttempt = 1;
      const requests: Array<{ messages: unknown }> = [];
      view.agent.streamFunction = (_model, context) => {
        requests.push(context);
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: response });
          stream.push({ type: "done", reason: "stop", message: response });
          stream.end(response);
        });
        return stream;
      };
      vi.useFakeTimers();
      try {
        const retry = view.retryPendingProviderFailure().catch((error: unknown) => error);
        await vi.runAllTimersAsync();
        expect(await retry).toBeUndefined();
        expect(requests).toHaveLength(1);
        expect(JSON.stringify(requests[0].messages)).toContain("Earlier work was summarized.");
        expect(view.agent.state.messages.slice(0, retained.length)).toEqual(retained);
        expect(events.filter(event => event.type === "message_end").map(event => event.message.content))
          .toEqual(["Recovered after compaction."]);
        expect(events.filter(event => event.type === "turn_end" || event.type === "agent_end")
          .map(event => event.type)).toEqual(kind === "parent" ? ["turn_end", "agent_end"] : []);
        expect(lifecycle).toEqual(["turn_end", "agent_end"]);
        expect(events.some(event => event.type === "error")).toBe(false);
      } finally {
        vi.useRealTimers();
        unsubscribe();
        if (runtime instanceof DesktopAgentRuntime) await runtime.dispose();
        else view.agent.abort();
      }
    });
  }
});
