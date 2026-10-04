import { describe, expect, it } from "vitest";
import type { Agent } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getCurrentSystemMessage,
  getCurrentTools,
  type AssistantMessage,
  type Message,
} from "@earendil-works/pi-ai";
import type { PlanExecution } from "@pi-desktop/shared";
import { entriesFromExecutionStart } from "./approved-execution-context.js";
import type { MessageEntry } from "./pi-runtime-types.js";
import { DesktopAgentRuntime, type RuntimeProviderConfig } from "./runtime.js";

const provider: RuntimeProviderConfig = {
  id: "fixture", name: "Fixture", modelId: "fixture", apiKey: "", authKind: "none",
  baseUrl: "https://fixture.invalid/v1", supportsReasoning: false, supportedThinkingLevels: ["off"],
};

function entry(id: string, message: MessageEntry["message"]): MessageEntry {
  return { type: "message", id, seq: 0, parentId: null, timestamp: 1, message };
}

describe("entriesFromExecutionStart", () => {
  const system = (sections: Record<string, string>) =>
    ({ role: "system", content: "", sections, timestamp: 1 }) as const;
  const user = (content: string) => ({ role: "user", content, timestamp: 1 }) as const;
  const entries = [
    entry("base", system({ runtime: "base prompt" })),
    entry("planning-user", user("planning detail")),
    entry("tools", system({ context: "later state" })),
    entry("instruction", user("approved contract")),
    entry("late-state", system({ context: "state during execution" })),
  ];

  it("drops the planning turns and keeps the system state from before the start", () => {
    expect(entriesFromExecutionStart(entries, 3).map(({ id }) => id)).toEqual([
      "base", "tools", "instruction", "late-state",
    ]);
  });

  it("is the whole transcript when execution starts at its beginning", () => {
    expect(entriesFromExecutionStart(entries, 0)).toEqual(entries);
  });
});

function fixture() {
  const requests: Message[][] = [];
  const runtime = new DesktopAgentRuntime({
    sessionId: "fixture", mode: "agent", provider, thinkingLevel: "off",
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true },
    host: { call: async <T>(method: string): Promise<T> => {
      if (method !== "session.appendMessage") throw new Error(`Unexpected host method: ${method}`);
      return undefined as T;
    } },
    onEvent: () => {},
  });
  const agent = (runtime as unknown as { agent: Agent }).agent;
  agent.streamFunction = async (_model, context) => {
    requests.push(structuredClone(context.messages));
    const message: AssistantMessage = {
      role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture",
      timestamp: Date.now() + 10, stopReason: "stop", content: [{ type: "text", text: "Done." }],
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  };
  return { runtime, agent, requests };
}

const execution: PlanExecution = {
  id: "execution-1", proposalId: "proposal-1", sessionId: "fixture", kind: "plan",
  plan: "# Approved\n\nUse the exact snapshot.", title: "Approved plan", question: "Proceed?",
  artifact: { relativePath: ".pi/plan/proposal-1.md", sha256: "abc123", sizeBytes: 31 },
  targetPermissionMode: "auto", state: "running",
};

describe("approved execution request", () => {
  it("keeps the runtime prompt and tools while dropping the planning turns", async () => {
    const { runtime, agent, requests } = fixture();
    try {
      await runtime.prompt("First planning turn", "user-1", "turn-1");
      runtime.setMode("plan");
      await runtime.prompt("Second planning turn", "user-2", "turn-2");
      await runtime.executeApprovedPlan(execution, "execution-turn-1");
      await agent.waitForIdle();
      // A compaction checkpoint folds the live state into its durable one.
      const liveRuntime = () =>
        getCurrentSystemMessage(agent.state.messages as Message[])?.sections?.runtime;
      const liveAfterExecution = liveRuntime();

      // The start index outlives the execution, so a later prompt in the same
      // runtime is built from the same sliced transcript.
      await runtime.prompt("Follow-up turn", "user-3", "turn-3");
      await agent.waitForIdle();

      expect(requests).toHaveLength(4);
      const [normal, , approved, followUp] = requests;
      const base = getCurrentSystemMessage(normal)?.sections?.runtime;
      expect(base).toBeTruthy();
      // The prompt leads the request, as it does in every request of a session.
      expect(approved[0].role).toBe("system");
      expect(getCurrentSystemMessage(approved)?.sections?.runtime).toBe(base);
      expect(getCurrentSystemMessage(followUp)?.sections?.runtime).toBe(base);
      expect(liveAfterExecution).toBe(base);
      expect(liveRuntime()).toBe(base);
      // Plan mode may declare more tools; none of the Agent tools is lost.
      const normalTools = getCurrentTools(normal).map((tool) => tool.name);
      expect(normalTools.length).toBeGreaterThan(0);
      expect(getCurrentTools(approved).map((tool) => tool.name)).toEqual(
        expect.arrayContaining(normalTools),
      );

      const turns = JSON.stringify(approved.filter((message) => message.role !== "system"));
      expect(turns).toContain("Use the exact snapshot.");
      expect(turns).not.toContain("First planning turn");
      expect(turns).not.toContain("Second planning turn");
    } finally { await runtime.dispose(); }
  });
});
