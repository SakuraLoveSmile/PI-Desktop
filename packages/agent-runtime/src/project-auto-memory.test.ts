import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { Mode, ProjectMemoryEntry, ProjectMemoryRuntimeState } from "@pi-desktop/shared";
import type { RuntimeHost } from "./host-client.js";
import { createAutoMemoryTool, loadAutoMemory } from "./project-auto-memory.js";
import { DesktopAgentRuntime } from "./runtime.js";

const runtimes: DesktopAgentRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())); });

function fixture(options: { mode?: Mode; projectPath?: string; host?: RuntimeHost } = {}) {
  let enabled = true;
  let failReads = false;
  let entries: ProjectMemoryEntry[] = [{ id: "style", title: "Style", content: "Prefer concise replies." }];
  const state = (): ProjectMemoryRuntimeState => ({ memory: {
    content: entries.map(entry => `${entry.title}\n${entry.content}`).join("\n\n"), entries: [...entries],
  }, autoRecordEnabled: enabled });
  const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "project.autoMemory.agentList") {
      if (failReads) throw new Error("fixture unavailable");
      return state();
    }
    if (method === "project.autoMemory.agentUpsert") {
      if (!enabled) throw new Error("recording disabled");
      entries = [...entries, { id: "stack", title: String(params?.title), content: String(params?.content) }];
      return state();
    }
    if (method === "project.history.search") return { hits: [{ sessionId: "source-session", title: "Package manager decision",
      projectPath: "/fixture/project", messageCount: 1, matches: [{ messageId: "source-message", role: "assistant", createdAt: 1, snippet: "Use pnpm." }] }], hasMore: false };
    if (method === "project.history.context") return { sessionId: "source-session", title: "Package manager decision",
      messages: [{ id: "source-message", role: "assistant", createdAt: 1, content: "Use pnpm." }], truncated: false };
    if (method === "project.codeSearch") return { hits: [{ path: "package.json", line: 1, text: "pnpm" }], truncated: false,
      index: { fileCount: 1, indexedBytes: 4, skippedFiles: 0, status: "fresh" } };
    return {};
  });
  const host: RuntimeHost = options.host ?? { call: <T>(method: string, params?: unknown) => call(method, params as Record<string, unknown>) as Promise<T> };
  const runtime = new DesktopAgentRuntime({
    host, sessionId: "real-session", mode: options.mode ?? "agent", projectPath: options.projectPath ?? "/fixture/project",
    projectMemory: "Stale launch note.", thinkingLevel: "off",
    provider: { id: "local", name: "Fixture", baseUrl: "http://127.0.0.1:1/v1", modelId: "fixture-model", apiKey: "", authKind: "none",
      supportsReasoning: false, supportedThinkingLevels: ["off"],
      modelConfig: { source: "generic", name: "Fixture", baseUrl: "http://127.0.0.1:1/v1", reasoning: false,
        input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 32_000 } },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true }, onEvent: () => {},
  });
  runtimes.push(runtime);
  const probe = runtime as unknown as { agent: Agent; models: Pick<Models, "streamSimple">; agentSystemPromptContent(): string };
  const requests: Array<{ prompt: string; tools: string[]; messages: AgentMessage[] }> = [];
  const responses: AssistantMessage["content"][] = [];
  probe.models = {
    streamSimple: (_model, context) => {
      requests.push({ prompt: probe.agentSystemPromptContent(), tools: getCurrentTools(context.messages).map(tool => tool.name), messages: [...context.messages] });
      const content = responses.shift() ?? [{ type: "text", text: "Done." }];
      const stopReason = content.some(block => block.type === "toolCall") ? "toolUse" : "stop";
      const message: AssistantMessage = { role: "assistant", api: "openai-completions", provider: "local", model: "fixture-model",
        content, stopReason, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0,
          totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: stopReason, message }); stream.end(message); });
      return stream;
    },
  };
  return { runtime, probe, requests, responses, call, state, setEnabled: (value: boolean) => { enabled = value; },
    deleteNotes: () => { entries = []; }, failReads: () => { failReads = true; } };
}

describe("automatic project memory user path", () => {
  it("remembers during conversation, refreshes on the next turn and preserves reads when recording is disabled", async () => {
    const f = fixture();
    f.responses.push([{ type: "toolCall", id: "remember", name: "ProjectMemory", arguments: { action: "upsert", title: "Stack", content: "Use pnpm." } }]);
    await f.runtime.prompt("Remember to use pnpm for this project.");
    expect(f.state().memory.entries).toHaveLength(2);
    expect(f.call.mock.calls.filter(([method]) => method === "project.autoMemory.agentList")).toHaveLength(1);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].messages.some(message => message.role === "toolResult" && message.toolName === "ProjectMemory")).toBe(true);
    const retained = f.probe.agent.state.tools.find(tool => tool.name === "ProjectMemory")!;
    f.setEnabled(false);
    await f.runtime.prompt("Which package manager should I use?");
    expect(f.requests.at(-1)?.prompt).toContain("Use pnpm.");
    expect(f.requests.at(-1)?.prompt).toContain("Prefer concise replies.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Stale launch note.");
    expect(f.requests.at(-1)?.prompt).not.toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    expect(f.requests.at(-1)?.tools).not.toContain("ProjectMemory");
    await expect(retained.execute("stale", { action: "upsert", content: "stale note" })).rejects.toThrow("no longer active");
    expect(f.call.mock.calls.filter(([method]) => method === "project.autoMemory.agentList")).toHaveLength(2);
    expect(f.call.mock.calls.filter(([method]) => method === "project.autoMemory.agentUpsert")).toHaveLength(1);
    expect(f.requests.at(-1)?.messages.filter(message => message.role === "user").at(-1)?.content).toEqual([{ type: "text", text: "Which package manager should I use?" }]);
  });

  it("refreshes deleted notes and clears stale context and write guidance on a read failure", async () => {
    const f = fixture();
    await f.runtime.prompt("first question");
    f.failReads();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { await f.runtime.prompt("second question"); expect(warning).toHaveBeenCalled(); } finally { warning.mockRestore(); }
    expect(f.requests.at(-1)?.prompt).not.toContain("Prefer concise replies.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Stale launch note.");
    expect(f.requests.at(-1)?.prompt).not.toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    const other = fixture();
    await other.runtime.prompt("before delete");
    other.deleteNotes();
    await other.runtime.prompt("after delete");
    expect(other.requests.at(-1)?.prompt).not.toContain("Prefer concise replies.");
  });

  it.each(["plan", "goal"] as const)("reads memory in %s without exposing writes", async mode => {
    const f = fixture({ mode });
    await f.runtime.prompt("Plan the task.");
    expect(f.requests.at(-1)?.prompt).toContain("Prefer concise replies.");
    expect(f.requests.at(-1)?.prompt).not.toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    expect(f.call.mock.calls.some(([method]) => method === "project.autoMemory.agentUpsert")).toBe(false);
  });

  it("recalls a sourced discussion and searches code through the project tools in Plan", async () => {
    const f = fixture({ mode: "plan" });
    f.responses.push(
      [{ type: "toolCall", id: "recall-search", name: "ProjectHistory", arguments: { action: "search", query: "pnpm" } }],
      [{ type: "toolCall", id: "recall-read", name: "ProjectHistory", arguments: { action: "read", targetSessionId: "source-session", messageId: "source-message" } }],
      [{ type: "toolCall", id: "code-search", name: "CodeSearch", arguments: { query: "pnpm" } }],
    );
    await f.runtime.prompt("Find the earlier package manager decision and confirm it in the code.");
    expect(f.call.mock.calls).toContainEqual(["project.history.search", expect.objectContaining({ sessionId: "real-session", query: "pnpm" })]);
    expect(f.call.mock.calls).toContainEqual(["project.history.context", expect.objectContaining({ sessionId: "real-session", targetSessionId: "source-session", messageId: "source-message" })]);
    expect(f.call.mock.calls).toContainEqual(["project.codeSearch", { sessionId: "real-session", boundPath: "/fixture/project", action: "search", query: "pnpm" }]);
    expect(f.requests).toHaveLength(4);
    const outputs = f.requests.at(-1)?.messages.filter(message => message.role === "toolResult");
    expect(outputs?.map(message => message.toolName)).toEqual(["ProjectHistory", "ProjectHistory", "CodeSearch"]);
    const code = f.probe.agent.state.tools.find(tool => tool.name === "CodeSearch")!;
    await expect(code.execute("clear-plan", { action: "clear" })).rejects.toThrow("not allowed in plan");
    expect(f.call.mock.calls.filter(([method]) => method === "project.codeSearch")).toHaveLength(1);
  });

  it("revokes a retained write tool when switching from Agent to Plan or Goal", async () => {
    const f = fixture();
    await f.runtime.prompt("first question");
    const retained = f.probe.agent.state.tools.find(tool => tool.name === "ProjectMemory")!;
    for (const mode of ["plan", "goal"] as const) {
      f.runtime.setMode(mode);
      await expect(retained.execute("stale", { action: "upsert", content: "Should not save" })).rejects.toThrow("not allowed");
      expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
      expect(f.probe.agentSystemPromptContent()).toContain("Prefer concise replies.");
      expect(f.probe.agentSystemPromptContent()).not.toContain("# Updating project memory");
    }
    expect(f.call.mock.calls.some(([method]) => method === "project.autoMemory.agentUpsert")).toBe(false);
  });

  it("preserves legacy projectless context without issuing a project memory RPC", async () => {
    const f = fixture({ projectPath: "" });
    await f.runtime.prompt("legacy question");
    expect(f.requests.at(-1)?.prompt).toContain("Stale launch note.");
    expect(f.call.mock.calls.some(([method]) => method.startsWith("project."))).toBe(false);
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
  });

  it("refreshes memory before executing an approved plan with the normal Agent tools", async () => {
    const f = fixture({ mode: "plan" });
    await f.runtime.executeApprovedPlan({
      id: "execution-1", proposalId: "proposal-1", sessionId: "real-session", kind: "plan", state: "running",
      title: "Fixture plan", question: "Proceed?", plan: "# Approved fixture plan", targetPermissionMode: "auto",
      artifact: { relativePath: ".pi/plan/fixture.md", sha256: "a".repeat(64), sizeBytes: 23 },
    }, "approved-turn");
    expect(f.requests[0].prompt).toContain("Prefer concise replies.");
    expect(f.requests[0].prompt).toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(true);
    expect(f.call.mock.calls.filter(([method]) => method === "project.autoMemory.agentList")).toHaveLength(1);
  });

  it.each(["abort", "dispose"] as const)("fences a late memory refresh after %s", async action => {
    let resolveRead!: (state: ProjectMemoryRuntimeState) => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const host: RuntimeHost = { call: <T>(method: string) => {
      if (method !== "project.autoMemory.agentList") return Promise.resolve({} as T);
      started();
      return new Promise<ProjectMemoryRuntimeState>(resolve => { resolveRead = resolve; }) as Promise<T>;
    } };
    const f = fixture({ host });
    const running = f.runtime.prompt("question");
    const rejected = expect(running).rejects.toThrow("aborted");
    await reading;
    await f.runtime[action]();
    await rejected;
    resolveRead({ memory: { content: "Late deleted note", entries: [] }, autoRecordEnabled: true });
    await Promise.resolve();
    expect(f.requests).toHaveLength(0);
    expect(f.probe.agentSystemPromptContent()).not.toContain("Late deleted note");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
  });
});

describe("project memory tool boundary", () => {
  it("captures session id and requires entry snapshots for updates and deletes", async () => {
    const call = vi.fn(async (_method: string, _params?: unknown) => ({ memory: { content: "", entries: [] }, autoRecordEnabled: true }));
    const tool = createAutoMemoryTool({ call: <T>(method: string, params?: unknown) => call(method, params) as Promise<T> }, "real-session");
    await expect(tool.execute("update", { action: "upsert", id: "saved", content: "Use pnpm." })).rejects.toThrow("list memory first");
    await expect(tool.execute("delete", { action: "delete", id: "saved" })).rejects.toThrow("list memory first");
    await tool.execute("update", { action: "upsert", id: "saved", title: "Stack", content: "Use pnpm.", expectedTitle: "Stack", expectedContent: "Use npm." });
    expect(call).toHaveBeenCalledWith("project.autoMemory.agentUpsert", { sessionId: "real-session", id: "saved", title: "Stack",
      content: "Use pnpm.", expectedTitle: "Stack", expectedContent: "Use npm." });
    await tool.execute("delete", { action: "delete", id: "saved", expectedTitle: "Stack", expectedContent: "Use pnpm." });
    expect(call).toHaveBeenLastCalledWith("project.autoMemory.agentDelete", expect.objectContaining({ sessionId: "real-session", id: "saved" }));
  });

  it("rejects malformed host state instead of retaining or enabling old memory", async () => {
    await expect(loadAutoMemory({ call: async <T>() => ({ memory: { content: "bad", entries: [{}] }, autoRecordEnabled: true }) as T }, "real-session"))
      .rejects.toThrow("Invalid project memory response");
  });
});
