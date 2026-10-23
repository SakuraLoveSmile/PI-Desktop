import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, getCurrentTools, type AssistantMessage, type Models } from "@earendil-works/pi-ai";
import type { Mode, ProjectMemoryAlias, ProjectMemoryEntry, ProjectMemoryRuntimeState } from "@pi-desktop/shared";
import type { RuntimeHost } from "./host-client.js";
import { createAutoMemoryTool, loadAutoMemory } from "./project-auto-memory.js";
import { DesktopAgentRuntime, type AgentRuntimeOptions } from "./runtime.js";

const runtimes: DesktopAgentRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())); });

function fixture(options: { mode?: Mode; projectPath?: string; sessionId?: string; host?: RuntimeHost; memoryAlias?: ProjectMemoryAlias } = {}) {
  let enabled = true;
  let failReads = false;
  let entries: ProjectMemoryEntry[] = [{ id: "style", title: "Style", content: "Prefer concise replies." }];
  let memoryAlias = options.memoryAlias;
  const state = (): ProjectMemoryRuntimeState => ({ memory: memoryAlias?.memory ?? {
    content: entries.map(entry => `${entry.title}\n${entry.content}`).join("\n\n"), entries: [...entries],
  }, autoRecordEnabled: memoryAlias ? false : enabled, ...(memoryAlias ? { memoryAlias } : {}) });
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
  const runtimeOptions: AgentRuntimeOptions = {
    host, sessionId: options.sessionId ?? "real-session", mode: options.mode ?? "agent", projectPath: options.projectPath ?? "/fixture/project",
    projectMemory: "Stale launch note.", thinkingLevel: "off",
    projectInstructions: { entries: [{ source: "AGENTS.md", content: "Slot file instructions." }] },
    projectMemoryAlias: options.memoryAlias,
    provider: { id: "local", name: "Fixture", baseUrl: "http://127.0.0.1:1/v1", modelId: "fixture-model", apiKey: "", authKind: "none",
      supportsReasoning: false, supportedThinkingLevels: ["off"],
      modelConfig: { source: "generic", name: "Fixture", baseUrl: "http://127.0.0.1:1/v1", reasoning: false,
        input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 256_000, maxTokens: 32_000 } },
    commandShell: { id: "bash", label: "Bash", dialect: "posix", available: true, isDefault: true }, onEvent: () => {},
  };
  const runtime = new DesktopAgentRuntime(runtimeOptions);
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
  return { runtime, runtimeOptions, probe, requests, responses, call, state, setEnabled: (value: boolean) => { enabled = value; },
    deleteNotes: () => { entries = []; }, failReads: () => { failReads = true; },
    setMemoryAlias: (value: ProjectMemoryAlias | undefined) => { memoryAlias = value; } };
}

describe("automatic project memory user path", () => {
  it("writes a sourced decision from one checkout and recalls it in another without moving either workspace", async () => {
    let enabled = true;
    let entries: ProjectMemoryEntry[] = [];
    const memory = () => ({ content: entries.map(entry => `${entry.title}\n${entry.content}`).join("\n\n"), entries: [...entries] });
    const state = (): ProjectMemoryRuntimeState => ({ memory: memory(), autoRecordEnabled: enabled,
      memoryAlias: { memory: memory(), instructions: "Shared project rules." } });
    const call = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "project.autoMemory.agentList") return state();
      if (method === "project.autoMemory.agentUpsert") {
        if (!enabled) throw new Error("recording disabled");
        entries.push({ id: "decision", title: String(params?.title), content: String(params?.content) });
        return state();
      }
      return {};
    });
    const host: RuntimeHost = { call: <T>(method: string, params?: unknown) => call(method, params as Record<string, unknown>) as Promise<T> };
    const first = fixture({ host, sessionId: "checkout-session", projectPath: "/fixture/worktrees/feature", memoryAlias: state().memoryAlias });
    const source = "Use pnpm. Verified in package.json at merged commit abc123; source session checkout-session.";
    first.responses.push([{ type: "toolCall", id: "decision", name: "ProjectMemory", arguments: { action: "upsert", title: "Package manager", content: source } }]);
    await first.runtime.prompt("Save the verified package manager decision with its source.");
    expect(call).toHaveBeenCalledWith("project.autoMemory.agentUpsert", expect.objectContaining({ sessionId: "checkout-session", content: source }));
    expect(first.requests[0].prompt).toContain("verified technical conclusions");
    expect(first.requests[0].prompt).toContain("unmerged experiments");
    expect(first.requests[0].prompt).toContain("source session and commit");
    expect(first.requests[0].prompt).toContain("Slot file instructions.");
    const retained = first.probe.agent.state.tools.find(tool => tool.name === "ProjectMemory")!;

    const second = fixture({ host, mode: "plan", sessionId: "review-session", projectPath: "/fixture/pool/repo/slot-3", memoryAlias: state().memoryAlias });
    await second.runtime.prompt("Recall the package manager decision.");
    expect(second.requests[0].prompt).toContain(source);
    expect(second.requests[0].prompt).toContain("Shared project rules.");
    expect(second.requests[0].prompt).not.toContain("# Updating project memory");
    expect(second.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    expect(first.runtimeOptions.projectPath).toBe("/fixture/worktrees/feature");
    expect(second.runtimeOptions.projectPath).toBe("/fixture/pool/repo/slot-3");
    expect(call).toHaveBeenCalledWith("project.autoMemory.agentList", { sessionId: "review-session" });

    enabled = false;
    await first.runtime.prompt("Read the decision after recording was disabled.");
    expect(first.requests.at(-1)?.prompt).toContain(source);
    expect(first.requests.at(-1)?.tools).not.toContain("ProjectMemory");
    await expect(retained.execute("revoked", { action: "upsert", content: "Late note" })).rejects.toThrow("no longer active");
    expect(call.mock.calls.filter(([method]) => method === "project.autoMemory.agentUpsert")).toHaveLength(1);
  });

  it("retires a runtime when its launch alias instructions change", () => {
    const memoryAlias = { memory: { content: "Owner notes.", entries: [] }, instructions: "Original owner rules." };
    const f = fixture({ memoryAlias });
    expect(f.runtime.matches(f.runtimeOptions)).toBe(true);
    expect(f.runtime.matches({ ...f.runtimeOptions, projectMemoryAlias: { ...memoryAlias, instructions: "New owner rules." } })).toBe(false);
    expect(f.runtime.matches({ ...f.runtimeOptions, projectMemoryAlias: undefined })).toBe(false);
  });

  it.each(["plan", "goal"] as const)("refreshes aliased memory and instructions without moving the %s workspace", async mode => {
    const alias = { memory: { content: "Real project notes.", entries: [] }, instructions: "Real group instructions." };
    const f = fixture({ mode, projectPath: "/fixture/pool/repo/slot-1", memoryAlias: alias });
    expect(f.probe.agentSystemPromptContent()).toContain("Real group instructions.");
    await f.runtime.prompt("first question");
    expect(f.requests.at(-1)?.prompt).toContain("Real project notes.");
    expect(f.requests.at(-1)?.prompt).toContain("Real group instructions.");
    expect(f.requests.at(-1)?.prompt).toContain("Slot file instructions.");
    f.setMemoryAlias({ memory: { content: "Updated real notes.", entries: [] }, instructions: "Updated group instructions." });
    await f.runtime.prompt("second question");
    expect(f.requests.at(-1)?.prompt).toContain("Updated real notes.");
    expect(f.requests.at(-1)?.prompt).toContain("Updated group instructions.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Real project notes.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Real group instructions.");
    f.setMemoryAlias({ memory: { content: "", entries: [] }, instructions: "" });
    await f.runtime.prompt("after delete");
    expect(f.requests.at(-1)?.prompt).not.toContain("Updated real notes.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Updated group instructions.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Prefer concise replies.");
    expect(f.requests.at(-1)?.prompt).toContain("Slot file instructions.");
    expect(f.requests.at(-1)?.prompt).not.toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    expect(f.call.mock.calls.filter(([method]) => method === "project.autoMemory.agentList")).toHaveLength(3);
    expect(f.call.mock.calls.some(([method]) => method === "project.autoMemory.agentUpsert")).toBe(false);
  });

  it.each(["invalidated", "failed"] as const)("clears aliased instructions when the next owner read is %s", async outcome => {
    const f = fixture({ memoryAlias: { memory: { content: "Private owner notes.", entries: [] }, instructions: "Private owner instructions." } });
    await f.runtime.prompt("first question");
    expect(f.requests.at(-1)?.prompt).toContain("Private owner notes.");
    expect(f.requests.at(-1)?.prompt).toContain("Private owner instructions.");
    expect(f.requests.at(-1)?.prompt).not.toContain("# Updating project memory");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
    if (outcome === "invalidated") f.setMemoryAlias(undefined);
    else f.failReads();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { await f.runtime.prompt("second question"); } finally { warning.mockRestore(); }
    expect(f.requests.at(-1)?.prompt).not.toContain("Private owner notes.");
    expect(f.requests.at(-1)?.prompt).not.toContain("Private owner instructions.");
    expect(f.requests.at(-1)?.prompt).toContain("Slot file instructions.");
    if (outcome === "invalidated") expect(f.requests.at(-1)?.prompt).toContain("Prefer concise replies.");
  });

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
    resolveRead({ memory: { content: "Late deleted note", entries: [] }, autoRecordEnabled: false,
      memoryAlias: { memory: { content: "Late deleted note", entries: [] }, instructions: "Late owner instructions" } });
    await Promise.resolve();
    expect(f.requests).toHaveLength(0);
    expect(f.probe.agentSystemPromptContent()).not.toContain("Late deleted note");
    expect(f.probe.agentSystemPromptContent()).not.toContain("Late owner instructions");
    expect(f.probe.agent.state.tools.some(tool => tool.name === "ProjectMemory")).toBe(false);
  });
});

describe("project memory tool boundary", () => {
  it.each([false, true])("returns authoritative alias entries, including an empty shared collection (%s)", async empty => {
    const old = { id: "slot", title: "Old slot", content: "An unrelated slot note." };
    const shared = { id: "shared", title: "Project decision", content: "Verified project convention." };
    const call = vi.fn(async () => ({
      memory: { content: old.content, entries: [old] }, autoRecordEnabled: true,
      memoryAlias: { memory: { content: empty ? "" : shared.content, entries: empty ? [] : [shared] }, instructions: "" },
    }));
    const tool = createAutoMemoryTool({ call: <T>() => call() as Promise<T> }, "checkout-session");
    const result = await tool.execute("shared-read", { action: "list" });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(empty ? [] : [shared]) }]);
  });

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
    for (const memoryAlias of [null, {}, { instructions: "bad", memory: { content: 123 } }, { memory: { content: "bad", entries: [] } }]) {
      await expect(loadAutoMemory({ call: async <T>() => ({ memory: { content: "", entries: [] }, autoRecordEnabled: false, memoryAlias }) as T }, "real-session"))
        .rejects.toThrow("Invalid project memory response");
    }
  });
});
