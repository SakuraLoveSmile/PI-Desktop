import { describe, expect, it, vi } from "vitest";
import { estimateTokens } from "@earendil-works/pi-agent-core";
import {
  DesktopAgentRuntime,
  PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS,
  type RuntimeProviderConfig,
} from "./runtime.js";
import type {
  ContextCompactionRecord,
  ContextCompactionSettings,
  ThinkingLevel,
  UiMessage,
} from "@pi-desktop/shared";

const provider: RuntimeProviderConfig = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  modelId: "local-model",
  apiKey: "",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "low", "medium", "high"],
  modelConfig: {
    source: "pi",
    name: "Local Catalog Model",
    baseUrl: "https://catalog.invalid/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: null, max: null },
    input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    contextWindow: 256_000,
    maxTokens: 32_000,
  },
};

function createRuntime(
  overrides: Partial<{
    provider: RuntimeProviderConfig;
    mode: "chat" | "agent";
    thinkingLevel: ThinkingLevel;
    history: UiMessage[];
    compaction: ContextCompactionRecord;
    compactionSettings: ContextCompactionSettings;
    projectPath: string;
    projectInstructions: import("./project-instructions.js").ProjectInstructions;
    pluginTools: import("./runtime.js").PluginToolDef[];
    pluginSkills: import("./plugin-skills-prompt.js").PluginSkillDef[];
    host: { call: ReturnType<typeof vi.fn> };
    onEvent: (envelope: unknown) => void;
  }> = {},
) {
  return new DesktopAgentRuntime({
    host: (overrides.host ?? { call: vi.fn() }) as never,
    sessionId: "session-1",
    mode: overrides.mode ?? "agent",
    provider: overrides.provider ?? provider,
    thinkingLevel: overrides.thinkingLevel ?? "medium",
    history: overrides.history,
    compaction: overrides.compaction,
    compactionSettings: overrides.compactionSettings,
    projectPath: overrides.projectPath,
    projectInstructions: overrides.projectInstructions,
    pluginTools: overrides.pluginTools,
    pluginSkills: overrides.pluginSkills,
    onEvent: overrides.onEvent ?? vi.fn(),
  });
}

describe("DesktopAgentRuntime configuration matching", () => {
  it("accepts no-auth providers and reuses only an exact pi configuration", async () => {
    const runtime = createRuntime();

    expect(runtime.matches("agent", provider, "medium")).toBe(true);
    expect(runtime.matches("chat", provider, "medium")).toBe(false);
    expect(
      runtime.matches("agent", { ...provider, authKind: "api_key" }, "medium"),
    ).toBe(false);
    expect(
      runtime.matches(
        "agent",
        { ...provider, modelId: "another-model" },
        "medium",
      ),
    ).toBe(false);
    expect(runtime.matches("agent", provider, "high")).toBe(false);

    await runtime.dispose();
  });

  it("guides mutation tools away from patch repair loops", async () => {
    const runtime = createRuntime();
    const prompt = (runtime as any).agent.state.systemPrompt as string;

    expect(prompt).toContain("Do not create or hand-edit unified-diff files");
    expect(prompt).toContain("Never issue concurrent Write/Edit calls for the same path");
    expect(prompt).toContain("regenerate the change from that current content");

    const edit = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Edit",
    );
    expect(edit.description).toContain("do not repair an old patch");
    expect(edit.description).toContain("same path concurrently");

    await runtime.dispose();
  });

  it("preserves host failure diagnostics while marking the agent tool result", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        ok: false,
        isError: true,
        errorCode: "TOOL_FAILED",
        content: { exitCode: 7, stderr: "diagnostic" },
      }),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    const result = await bash.execute("tool-failed", { command: "exit 7" });

    expect(result.details).toEqual({ exitCode: 7, stderr: "diagnostic" });
    expect(result.content[0].text).toContain('"exitCode": 7');
    await expect(
      (runtime as any).agent.afterToolCall({ toolCall: { id: "tool-failed" } }),
    ).resolves.toEqual({ isError: true });
    expect((runtime as any).failedHostToolCalls.size).toBe(0);

    await runtime.dispose();
  });

  it("terminates a repeated Edit mismatch after one recovery attempt", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({
          ok: false,
          isError: true,
          errorCode: "TOOL_FAILED",
          content: { error: "old_string not found" },
        }),
    };
    const runtime = createRuntime({ host });
    const agent = (runtime as any).agent;
    const edit = agent.state.tools.find((tool: any) => tool.name === "Edit");
    const args = {
      path: "src/example.ts",
      old_string: "stale",
      new_string: "fresh",
    };

    const first = await edit.execute("edit-1", args);
    await expect(
      agent.afterToolCall({ toolCall: { id: "edit-1" } }),
    ).resolves.toEqual({ isError: true });
    expect(first.terminate).toBeUndefined();

    const second = await edit.execute("edit-2", args);
    expect(second.terminate).toBe(true);
    await expect(
      agent.afterToolCall({ toolCall: { id: "edit-2" } }),
    ).resolves.toEqual({ isError: true, terminate: true });

    await runtime.dispose();
  });

  it("recreates the runtime when project instructions change", async () => {
    const projectInstructions = {
      entries: [{ source: "AGENTS.md", content: "Run unit tests." }],
    };
    const runtime = createRuntime({ projectInstructions });

    expect((runtime as any).agent.state.systemPrompt).toContain(
      "# Project instructions\n\n",
    );
    expect((runtime as any).agent.state.systemPrompt).toContain(
      "Run unit tests.",
    );
    expect(runtime.matches("agent", provider, "medium", [], projectInstructions)).toBe(
      true,
    );
    expect(runtime.matches("agent", provider, "medium", [], {
      entries: [{ source: "AGENTS.md", content: "Run lint." }],
    })).toBe(
      false,
    );

    await runtime.dispose();
  });

  it("loads newly discovered nested instructions before a file tool runs", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            {
              source: "packages/api/AGENTS.md",
              content: "Run API tests.",
            },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "file contents" }),
    };
    const runtime = createRuntime({ host });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-1", { path: "packages/api/handler.ts" });

    expect(host.call.mock.calls[0][0]).toBe("project.instructions.resolve");
    expect((runtime as any).agent.state.systemPrompt).toContain(
      "packages/api/AGENTS.md",
    );
    expect((runtime as any).agent.state.systemPrompt).toContain("Run API tests.");
    await runtime.dispose();
  });

  it.each([
    ["Read", { path: "packages/api/handler.ts" }],
    ["Write", { path: "packages/api/handler.ts", content: "export {};" }],
    ["Edit", {
      path: "packages/api/handler.ts",
      old_string: "before",
      new_string: "after",
    }],
    ["BrowserPreview", { path: "packages/api/index.html" }],
  ])("resolves path-scoped instructions before %s", async (toolName, params) => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [{ source: "packages/api/AGENTS.md", content: "Use API rules." }],
        })
        .mockResolvedValueOnce({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host });
    let tool = (runtime as any).agent.state.tools.find(
      (candidate: any) => candidate.name === toolName,
    );
    if (!tool) {
      const search = (runtime as any).agent.state.tools.find(
        (candidate: any) => candidate.name === "ToolSearch",
      );
      await search.execute("search-1", { query: toolName });
      await (runtime as any).rebuiltAgentContext();
      tool = (runtime as any).agent.state.tools.find(
        (candidate: any) => candidate.name === toolName,
      );
    }

    await tool.execute(`tool-${toolName}`, params);

    expect(host.call.mock.calls[0][0]).toBe("project.instructions.resolve");
    expect((runtime as any).agent.state.systemPrompt).toContain("Use API rules.");
    await runtime.dispose();
  });

  it("replaces sibling-directory instructions for each file path", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/a/AGENTS.md", content: "Use A rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "A contents" })
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/b/AGENTS.md", content: "Use B rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "B contents" }),
    };
    const runtime = createRuntime({ host });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/a/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use A rules.");

    await read.execute("tool-b", { path: "packages/b/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use B rules.");
    expect((runtime as any).agent.state.systemPrompt).not.toContain("Use A rules.");
    await runtime.dispose();
  });

  it("claims one instruction chain per target directory within a prompt", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [{ source: "packages/api/AGENTS.md", content: "Use API rules." }],
        })
        .mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host, projectPath: "/workspace/project" });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/api/handler.ts" });
    await read.execute("tool-b", { path: "packages/api/routes.ts" });

    expect(
      host.call.mock.calls.filter(
        (call: unknown[]) => call[0] === "project.instructions.resolve",
      ),
    ).toHaveLength(1);
    expect(host.call.mock.calls[0][1]).toEqual({
      sessionId: "session-1",
      path: "packages/api/handler.ts",
      projectPath: "/workspace/project",
    });
    expect(host.call.mock.calls[1][0]).toBe("tools.execute");
    expect(host.call.mock.calls[2][0]).toBe("tools.execute");
    await runtime.dispose();
  });

  it("claims a fallback so one resolver failure cannot stall every sibling read", async () => {
    const host = {
      call: vi
        .fn()
        .mockRejectedValueOnce(new Error("resolver unavailable"))
        .mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({
      host,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Use root rules." }],
      },
    });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/api/handler.ts" });
    await read.execute("tool-b", { path: "packages/api/routes.ts" });

    expect(
      host.call.mock.calls.filter(
        (call: unknown[]) => call[0] === "project.instructions.resolve",
      ),
    ).toHaveLength(1);
    expect((runtime as any).agent.state.systemPrompt).toContain("Use root rules.");
    await runtime.dispose();
  });

  it("keeps file tools moving when path instruction resolution times out", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          entries: [
            { source: "AGENTS.md", content: "Use root rules." },
            { source: "packages/a/AGENTS.md", content: "Use A rules." },
          ],
        })
        .mockResolvedValueOnce({ ok: true, content: "A contents" })
        .mockRejectedValueOnce(new Error("parent host proxy timeout"))
        .mockResolvedValueOnce({ ok: true, content: "B contents" }),
    };
    const runtime = createRuntime({
      host,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Use root rules." }],
      },
    });
    const read = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Read",
    );

    await read.execute("tool-a", { path: "packages/a/file.ts" });
    expect((runtime as any).agent.state.systemPrompt).toContain("Use A rules.");

    await read.execute("tool-b", { path: "packages/b/file.ts" });

    expect(host.call.mock.calls[2]).toEqual([
      "project.instructions.resolve",
      { sessionId: "session-1", path: "packages/b/file.ts" },
      PATH_INSTRUCTION_RESOLUTION_TIMEOUT_MS,
    ]);
    expect(host.call.mock.calls[3][0]).toBe("tools.execute");
    expect((runtime as any).agent.state.systemPrompt).toContain("Use root rules.");
    expect((runtime as any).agent.state.systemPrompt).not.toContain("Use A rules.");

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime deferred tool catalog", () => {
  it("keeps the first agent request on core tools plus discovery", async () => {
    const runtime = createRuntime({
      pluginTools: [
        {
          name: "plugin_demo_validate",
          description: "Validate a plugin package.",
          parameters: {},
        },
      ],
      pluginSkills: [
        {
          id: "demo/release-notes",
          name: "Release notes",
          description: "Draft release notes.",
        },
      ],
    });
    const tools = (runtime as any).agent.state.tools as Array<{ name: string }>;
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "Read",
      "Bash",
      "Edit",
      "Write",
      "CompactContext",
      "ToolSearch",
    ]);
    expect(names).not.toContain("BrowserPreview");
    expect(names).not.toContain("PluginCheck");
    expect(names).not.toContain("plugin_demo_validate");
    expect(names).not.toContain("Skill");

    const prompt = (runtime as any).agent.state.systemPrompt as string;
    expect(prompt).toContain("# On-demand tools");
    expect(prompt).toContain("BrowserPreview");
    expect(prompt).toContain("plugin_demo_validate");

    await runtime.dispose();
  });

  it("keeps chat on the read-only core while sharing discovery", async () => {
    const runtime = createRuntime({ mode: "chat" });
    const names = (runtime as any).agent.state.tools.map(
      (tool: any) => tool.name,
    );

    expect(names).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "CompactContext", "ToolSearch"]),
    );
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("Bash");

    await runtime.dispose();
  });

  it("activates matching tools for the next model turn", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const search = agent.state.tools.find(
      (tool: any) => tool.name === "ToolSearch",
    );

    const result = await search.execute("search-1", { query: "BrowserPreview" });
    expect(result.addedToolNames).toEqual(["BrowserPreview"]);
    expect(agent.state.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      false,
    );

    const next = await (runtime as any).prepareNextTurn({
      context: { systemPrompt: "", messages: [], tools: agent.state.tools },
      messages: [],
      newMessages: [],
      toolResults: [
        {
          role: "toolResult",
          toolCallId: "search-1",
          toolName: "ToolSearch",
          content: result.content,
          details: result.details,
          addedToolNames: result.addedToolNames,
          isError: false,
          timestamp: Date.now(),
        },
      ],
    });
    expect(next.context.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      true,
    );

    await runtime.dispose();
  });

  it("resets deferred capabilities at the beginning of a new prompt", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const search = agent.state.tools.find(
      (tool: any) => tool.name === "ToolSearch",
    );
    await search.execute("search-1", { query: "BrowserPreview" });
    await (runtime as any).prepareNextTurn({
      context: { systemPrompt: "", messages: [], tools: agent.state.tools },
      messages: [],
      newMessages: [],
      toolResults: [],
    });
    expect(agent.state.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      true,
    );

    (runtime as any).resetDeferredToolsForPrompt();
    expect(agent.state.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      false,
    );

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime thinking configuration", () => {
  it("clamps the requested level and exposes model reasoning capability", async () => {
    const runtime = createRuntime({ thinkingLevel: "minimal" });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("low");
    expect(agent.state.model.reasoning).toBe(true);
    expect(agent.state.model.thinkingLevelMap.minimal).toBeNull();
    expect(agent.state.model.thinkingLevelMap.xhigh).toBeNull();

    await runtime.dispose();
  });

  it("forces off for providers without reasoning support", async () => {
    const noReasoning: RuntimeProviderConfig = {
      ...provider,
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
      modelConfig: undefined,
    };
    const runtime = createRuntime({
      provider: noReasoning,
      thinkingLevel: "high",
    });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.model.reasoning).toBe(false);

    await runtime.dispose();
  });

  it("applies the complete pi model record while preserving endpoint identity", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelId: "mimo-v2.5-pro-think",
      supportedThinkingLevels: ["off", "high"],
      modelConfig: {
        source: "pi",
        name: "MiMo-V2.5-Pro",
        baseUrl: "https://api.xiaomimimo.com/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
        contextWindow: 1_048_576,
        maxTokens: 131_072,
        headers: { "X-Catalog-Model": "mimo-v2.5-pro" },
        compat: {
          thinkingFormat: "deepseek",
          requiresReasoningContentOnAssistantMessages: true,
        },
      },
    };
    const runtime = createRuntime({ provider: mimo, thinkingLevel: "off" });
    const model = (runtime as any).agent.state.model;

    expect(model.compat).toMatchObject({
      thinkingFormat: "deepseek",
      requiresReasoningContentOnAssistantMessages: true,
    });
    expect(model.name).toBe("MiMo-V2.5-Pro");
    expect(model.baseUrl).toBe(provider.baseUrl);
    expect(model.contextWindow).toBe(1_048_576);
    expect(model.maxTokens).toBe(131_072);
    expect(model.input).toEqual(["text"]);
    expect(model.cost).toEqual({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
      cacheWrite: 0,
    });
    expect(model.headers).toEqual({ "X-Catalog-Model": "mimo-v2.5-pro" });
    expect((runtime as any).thinkingLevel).toBe("off");

    await runtime.dispose();
  });

  it("preserves adaptive model metadata without desktop-side rewrites", async () => {
    const adaptive: RuntimeProviderConfig = {
      ...provider,
      apiStyle: "anthropic_messages",
      modelId: "claude-opus-4-6",
      supportedThinkingLevels: ["off", "minimal", "low", "medium", "high", "max"],
      modelConfig: {
        source: "pi",
        name: "Claude Opus 4.6",
        baseUrl: "https://api.anthropic.com",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        compat: { forceAdaptiveThinking: true },
        thinkingLevelMap: { max: "max" },
      },
    };
    const runtime = createRuntime({ provider: adaptive, thinkingLevel: "off" });
    const agent = (runtime as any).agent;

    expect(agent.state.thinkingLevel).toBe("off");
    expect(agent.state.model.compat.forceAdaptiveThinking).toBe(true);
    expect(agent.state.model.thinkingLevelMap).toEqual({ max: "max" });

    await runtime.dispose();
  });

  it("recreates the runtime when the pi model record changes", async () => {
    const mimo: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        compat: { thinkingFormat: "deepseek" },
      },
    };
    const runtime = createRuntime({ provider: mimo, thinkingLevel: "medium" });

    expect(runtime.matches("agent", mimo, "medium")).toBe(true);
    expect(
      runtime.matches("agent", { ...mimo, modelConfig: undefined }, "medium"),
    ).toBe(false);

    await runtime.dispose();
  });

  it("restores assistant thinking blocks into the pi transcript", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "answer",
          thinking: "private plan",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const agent = (runtime as any).agent;
    const assistant = agent.state.messages.find(
      (message: any) => message.role === "assistant",
    );

    expect(assistant.content).toEqual([
      { type: "thinking", thinking: "private plan" },
      { type: "text", text: "answer" },
    ]);

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime tool history restore (D120)", () => {
  const toolRow = (overrides: Partial<UiMessage> = {}): UiMessage => ({
    id: "tool-1",
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    status: "complete",
    toolName: "Grep",
    toolCallId: "call-1",
    toolStatus: "success",
    toolArgs: { pattern: "renderFormContent" },
    toolResult: {
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
    },
    ...overrides,
  });

  it("restores tool call/result pairs adjacent to their assistant turn", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "optimize the form",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Let me find the render code.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
        {
          id: "assistant-2",
          role: "assistant",
          content: "Found it.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(messages[1].stopReason).toBe("toolUse");
    expect(messages[1].content).toEqual([
      { type: "text", text: "Let me find the render code." },
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "Grep",
      content: [{ type: "text", text: "index.html:2924 match" }],
      details: { count: 1 },
      isError: false,
    });
    expect(messages[3].stopReason).toBe("stop");

    await runtime.dispose();
  });

  it("keeps call-only assistant turns as carriers and drops truly empty ones", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-empty-with-tools",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ id: "tool-a", toolCallId: "call-a" }),
        toolRow({ id: "tool-b", toolCallId: "call-b" }),
        {
          id: "assistant-empty",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
    ]);
    expect(messages[0].content.map((b: any) => b.id)).toEqual([
      "call-a",
      "call-b",
    ]);

    await runtime.dispose();
  });

  it("synthesizes a carrier for tool rows whose assistant row was lost", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow(),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(messages[1].content).toEqual([
      {
        type: "toolCall",
        id: "call-1",
        name: "Grep",
        arguments: { pattern: "renderFormContent" },
      },
    ]);
    expect(messages[1].stopReason).toBe("toolUse");

    await runtime.dispose();
  });

  it("restores interrupted tool rows as errored results", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Running it now.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({
          toolStatus: "running",
          toolResult: undefined,
        }),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [
        {
          type: "text",
          text: "[tool call was interrupted before a result was recorded]",
        },
      ],
    });

    await runtime.dispose();
  });

  it("restores deferred tool activation markers from persisted results", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Loading the preview tool.",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({
          toolName: "ToolSearch",
          toolResult: {
            content: [{ type: "text", text: "Activated BrowserPreview." }],
            details: { activated: ["BrowserPreview"] },
            addedToolNames: ["BrowserPreview"],
          },
        }),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages[1]).toMatchObject({
      role: "toolResult",
      addedToolNames: ["BrowserPreview"],
    });

    await runtime.dispose();
  });

  it("skips tool rows without a call id and keeps plain restores unchanged", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "answer",
          createdAt: new Date().toISOString(),
          status: "complete",
        },
        toolRow({ toolCallId: undefined }),
      ],
    });
    const messages = (runtime as any).agent.state.messages;

    expect(messages.map((m: any) => m.role)).toEqual(["assistant"]);
    expect(messages[0].content).toEqual([{ type: "text", text: "answer" }]);
    expect(messages[0].stopReason).toBe("stop");

    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime assistant thinking events", () => {
  it("normalizes thinking blocks and emits independent thinking deltas", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "plan " }],
      },
    });
    await handleAgentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan done" },
          { type: "text", text: "answer" },
        ],
      },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan done" },
          { type: "text", text: "answer" },
        ],
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events[0].event.message.thinking).toBe("plan ");
    expect(events[1].event.deltaText).toBe("answer");
    expect(events[1].event.deltaThinking).toBe("done");
    expect(events[1].event.message).toMatchObject({
      content: "answer",
      thinking: "plan done",
    });
    expect(events[2].event.message).toMatchObject({
      content: "answer",
      thinking: "plan done",
      status: "complete",
    });

    await runtime.dispose();
  });

  it("recognizes the Bedrock prompt-too-long response and defers the terminal error", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage:
          "400: prompt is too long: 1077172 tokens > 1000000 maximum (Service: BedrockRuntime)",
      },
    });
    await handleAgentEvent({ type: "turn_end" });
    await handleAgentEvent({ type: "agent_end", messages: [] });

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "error",
          error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
        }),
      }),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "agent_end")).toBe(false);
    expect((runtime as any).pendingOverflow).toBe(true);

    await runtime.dispose();
  });

  it("does not recover provider overflow when automatic compaction is disabled", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({
      onEvent,
      compactionSettings: {
        enabled: false,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage:
          "400: prompt is too long: 1077172 tokens > 1000000 maximum",
      },
    });

    expect((runtime as any).pendingOverflow).toBe(false);
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_TOO_LARGE" }),
      }),
    );
    await runtime.dispose();
  });

  it("removes the failed overflow assistant before compacting and retries once", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const user = { role: "user", content: "hello", timestamp: 1 };
    const failed = {
      role: "assistant",
      content: [],
      stopReason: "error",
      timestamp: 2,
    };
    agent.prompt = vi.fn(async () => {
      agent.state.messages = [user, failed];
      (runtime as any).pendingOverflow = true;
      (runtime as any).suppressOverflowRunEnd = true;
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => undefined);
    (runtime as any).automaticCompactionNeeded = vi.fn(() => false);
    (runtime as any).runCompaction = vi.fn(async () => {
      expect(agent.state.messages).toEqual([user]);
      return true;
    });

    await runtime.prompt("hello", "user-1");

    expect((runtime as any).runCompaction).toHaveBeenCalledOnce();
    expect((runtime as any).runCompaction).toHaveBeenCalledWith("overflow", true);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect((runtime as any).overflowRecoveryAttempted).toBe(true);
    await runtime.dispose();
  });

  it("turns a provider model failure into an error message and event", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);

    await handleAgentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
      },
    });
    await handleAgentEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: '404: {"error":{"message":"model not found"}}',
      },
    });

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-2)?.event).toMatchObject({
      type: "message_end",
      message: {
        status: "error",
        isError: true,
        error: {
          code: "MODEL_NOT_CONFIGURED",
          message: '404: {"error":{"message":"model not found"}}',
          retriable: false,
          details: {
            phase: "stream",
            providerStatus: 404,
          },
        },
      },
    });
    expect(events.at(-1)?.event).toMatchObject({
      type: "error",
      error: {
        code: "MODEL_NOT_CONFIGURED",
        retriable: false,
      },
    });

    await runtime.dispose();
  });

  it("retries one transient stream failure without duplicating the assistant bubble", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    const failedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "partial response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "terminated",
      timestamp: 2,
    };
    const successfulMessage = {
      role: "assistant",
      content: [{ type: "text", text: "recovered response" }],
      api: "openai-completions",
      provider: "local",
      model: "local-model",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 3,
    };

    agent.prompt = vi.fn(async () => {
      agent.state.messages = [
        { role: "user", content: "hello", timestamp: 1 },
        failedMessage,
      ];
      await handleAgentEvent({ type: "message_start", message: failedMessage });
      await handleAgentEvent({ type: "message_end", message: failedMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });
    agent.waitForIdle = vi.fn(async () => undefined);
    agent.continue = vi.fn(async () => {
      expect(agent.state.messages).toHaveLength(1);
      await handleAgentEvent({ type: "agent_start" });
      await handleAgentEvent({ type: "turn_start" });
      await handleAgentEvent({
        type: "message_start",
        message: { role: "assistant", content: [] },
      });
      await handleAgentEvent({ type: "message_end", message: successfulMessage });
      await handleAgentEvent({ type: "turn_end" });
      await handleAgentEvent({ type: "agent_end", messages: [] });
    });

    await runtime.prompt("hello", "user-1");

    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(agent.continue).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.filter((event) => event.type === "message_start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "agent_end")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          status: "complete",
          content: "recovered response",
        }),
      }),
    );

    await runtime.dispose();
  });

  it("does not restore failed assistant details into model context", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "failed-1",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "error",
          isError: true,
          error: {
            code: "PROVIDER_ERROR",
            message: "upstream detail",
            retriable: true,
          },
        },
      ],
    });

    expect((runtime as any).agent.state.messages).toEqual([]);
    await runtime.dispose();
  });

  it("creates an assistant error message when a prompt rejects before streaming", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const error = {
      code: "NETWORK_ERROR",
      message: "fetch failed",
      retriable: true,
    };

    (runtime as any).finalizeCurrentAssistant("error", error);

    const events = onEvent.mock.calls.map(([envelope]) => envelope as any);
    expect(events.at(-2)?.event).toMatchObject({
      type: "message_start",
      message: { role: "assistant", status: "error", error },
    });
    expect(events.at(-1)?.event).toMatchObject({
      type: "message_end",
      message: { role: "assistant", status: "error", error },
    });
    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime compaction restore", () => {
  it("restores summary plus retained tail while keeping the full transcript", async () => {
    const retained = { role: "user" as const, content: "recent", timestamp: 2 };
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "old",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "user-2",
          role: "user",
          content: "recent",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "Older work was summarized.",
        firstKeptMessageId: "user-2",
        throughMessageId: "user-2",
        tokensBefore: 200_000,
        retainedTail: [retained],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });

    const agentMessages = (runtime as any).agent.state.messages;
    expect(agentMessages.map((message: any) => message.role)).toEqual([
      "compactionSummary",
      "user",
    ]);
    expect(agentMessages[0].summary).toBe("Older work was summarized.");
    expect((runtime as any).fullEntries).toHaveLength(2);
    await runtime.dispose();
  });

  it("does not reuse pre-compaction provider usage for the retained tail budget", async () => {
    const runtime = createRuntime({
      history: [
        {
          id: "user-1",
          role: "user",
          content: "old",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "recent answer",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "Older work was summarized.",
        firstKeptMessageId: "assistant-1",
        throughMessageId: "assistant-1",
        tokensBefore: 250_000,
        retainedTail: [
          {
            role: "assistant",
            content: [{ type: "text", text: "recent answer" }],
            api: "openai-completions",
            provider: "local",
            model: "local-model",
            stopReason: "stop",
            timestamp: 2,
            usage: {
              input: 249_000,
              output: 1_000,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 250_000,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          },
        ],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });

    const budget = (runtime as any).contextBudget(
      (runtime as any).agent.state.messages,
    );
    expect(budget.tokens).toBeLessThan(1_000);
    expect(budget.tokens).not.toBe(250_000);
    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime per-turn context protection", () => {
  const toolResult = {
    role: "toolResult" as const,
    toolCallId: "tool-call-1",
    toolName: "Read",
    content: [{ type: "text" as const, text: "large result" }],
    isError: false,
    timestamp: 2,
  };
  const assistant = {
    role: "assistant" as const,
    content: [],
    api: "openai-completions" as const,
    provider: "local",
    model: "local-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse" as const,
    timestamp: 1,
  };
  const nextTurn = {
    message: assistant,
    toolResults: [toolResult],
    context: { systemPrompt: "base", messages: [], tools: [] },
    newMessages: [assistant, toolResult],
  };

  it("derives soft and hard limits with provider-request headroom", async () => {
    const runtime = createRuntime();

    expect((runtime as any).contextBudget([])).toMatchObject({
      tokens: 0,
      softLimit: 204_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });

    await runtime.dispose();
  });

  it("clamps the retained tail for a small model context window", async () => {
    const runtime = createRuntime({
      provider: {
        ...provider,
        modelConfig: {
          ...provider.modelConfig!,
          contextWindow: 32_000,
          maxTokens: 8_000,
        },
      },
    });

    expect((runtime as any).contextBudget([])).toMatchObject({
      softLimit: 12_000,
      hardLimit: 16_000,
      requestHeadroom: 16_000,
      keepRecentTokens: 8_000,
    });

    await runtime.dispose();
  });

  it("nudges a long tool loop, deduplicates reminders, then compacts before agent_end", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const prepareNextTurn = (runtime as any).prepareNextTurn.bind(runtime);
    const handleAgentEvent = (runtime as any).handleAgentEvent.bind(runtime);
    vi.spyOn(runtime as any, "contextBudget")
      .mockReturnValueOnce({
        tokens: 205_000,
        softLimit: 204_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      })
      .mockReturnValueOnce({
        tokens: 210_000,
        softLimit: 204_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      })
      .mockReturnValueOnce({
        tokens: 225_000,
        softLimit: 204_000,
        hardLimit: 224_000,
        requestHeadroom: 32_000,
      });
    const runCompaction = vi
      .spyOn(runtime as any, "runCompaction")
      .mockResolvedValue(true);

    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });
    const soft = await prepareNextTurn(nextTurn);
    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });
    const deduplicated = await prepareNextTurn(nextTurn);
    await handleAgentEvent({ type: "turn_end", message: assistant, toolResults: [toolResult] });
    const hard = await prepareNextTurn(nextTurn);

    expect(soft.context.systemPrompt).toContain("<context_management>");
    expect(deduplicated.context.systemPrompt).not.toContain("<context_management>");
    expect(hard.context.systemPrompt).not.toContain("<context_management>");
    expect((runtime as any).agent.state.systemPrompt).not.toContain(
      "<context_management>",
    );
    expect(runCompaction).toHaveBeenCalledOnce();
    expect(runCompaction).toHaveBeenCalledWith("threshold", false, undefined);
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events.filter((event) => event.type === "turn_end")).toHaveLength(3);
    expect(events.some((event) => event.type === "agent_end")).toBe(false);

    await runtime.dispose();
  });

  it("lets the model request one checkpoint with an active-task focus", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const compactTool = agent.state.tools.find(
      (tool: any) => tool.name === "CompactContext",
    );
    expect(compactTool).toBeDefined();
    await compactTool.execute("compact-call", {
      focus: "Keep the migration plan and files already changed.",
    });
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 100_000,
      softLimit: 204_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });
    const runCompaction = vi
      .spyOn(runtime as any, "runCompaction")
      .mockResolvedValue(true);

    await (runtime as any).prepareNextTurn(nextTurn);

    expect(runCompaction).toHaveBeenCalledWith(
      "threshold",
      false,
      "Preserve this active focus with high fidelity: Keep the migration plan and files already changed.",
    );
    expect((runtime as any).pendingModelCompaction).toBeUndefined();
    await runtime.dispose();
  });

  it("keeps an oversized trailing tool result with its assistant carrier", async () => {
    const runtime = createRuntime();
    const toolAssistant = {
      ...assistant,
      content: [
        {
          type: "toolCall" as const,
          id: "large-tool-call",
          name: "Read",
          arguments: { path: "large.log" },
        },
      ],
      stopReason: "toolUse" as const,
    };
    const largeToolResult = {
      ...toolResult,
      toolCallId: "large-tool-call",
      content: [{ type: "text" as const, text: "x".repeat(80_001) }],
    };
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "old-user",
        parentId: null,
        timestamp: "2026-07-28T00:00:00Z",
        message: { role: "user", content: "old context", timestamp: 1 },
      },
      {
        type: "message",
        id: "current-user",
        parentId: "old-user",
        timestamp: "2026-07-28T00:00:01Z",
        message: { role: "user", content: "inspect the log", timestamp: 2 },
      },
      {
        type: "message",
        id: "tool-assistant",
        parentId: "current-user",
        timestamp: "2026-07-28T00:00:02Z",
        message: toolAssistant,
      },
      {
        type: "message",
        id: "large-tool-call",
        parentId: "tool-assistant",
        timestamp: "2026-07-28T00:00:03Z",
        message: largeToolResult,
      },
    ];

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(entries, budget);

    expect(preparation.ok).toBe(true);
    expect(preparation.value.firstKeptEntryId).toBe("tool-assistant");
    expect(preparation.value.retainedTail.map((message: any) => message.role)).toEqual([
      "assistant",
      "toolResult",
    ]);
    await runtime.dispose();
  });

  it("bounds an atomic parallel tool batch in the checkpoint copy", async () => {
    const constrainedProvider: RuntimeProviderConfig = {
      ...provider,
      modelConfig: {
        ...provider.modelConfig!,
        contextWindow: 128_000,
        maxTokens: 8_192,
      },
    };
    const runtime = createRuntime({ provider: constrainedProvider });
    const resultSizes = [2_687, 90_920, 41_099, 155_573];
    const toolCalls = resultSizes.map((_, index) => ({
      type: "toolCall" as const,
      id: `parallel-tool-${index}`,
      name: "Read",
      arguments: { path: `large-${index}.txt` },
    }));
    const toolCarrier = {
      ...assistant,
      content: toolCalls,
      usage: {
        ...assistant.usage,
        input: 110_000,
        totalTokens: 110_000,
      },
      stopReason: "toolUse" as const,
    };
    const largeResults = resultSizes.map((size, index) => ({
      ...toolResult,
      toolCallId: `parallel-tool-${index}`,
      content: [
        { type: "text" as const, text: `${index}${"x".repeat(size - 1)}` },
      ],
      details: { duplicatedDiagnostic: "x".repeat(size) },
    }));
    (runtime as any).fullEntries = [
      {
        type: "message",
        id: "old-user",
        parentId: null,
        timestamp: "2026-07-29T00:00:00Z",
        message: { role: "user", content: "inspect the repository", timestamp: 1 },
      },
      {
        type: "message",
        id: "parallel-carrier",
        parentId: "old-user",
        timestamp: "2026-07-29T00:00:01Z",
        message: toolCarrier,
      },
      ...largeResults.map((message, index) => ({
        type: "message",
        id: message.toolCallId,
        parentId:
          index === 0
            ? "parallel-carrier"
            : largeResults[index - 1].toolCallId,
        timestamp: `2026-07-29T00:00:0${index + 2}Z`,
        message,
      })),
    ];

    const entries = (runtime as any).entriesWithCompaction();
    const budget = (runtime as any).contextBudget(
      entries.map((entry: any) => entry.message),
    );
    const preparation = (runtime as any).prepareCompactionInput(entries, budget);
    const retainedTail = preparation.value.retainedTail;

    expect(budget.tokens).toBeGreaterThan(budget.hardLimit);
    expect(preparation.ok).toBe(true);
    expect(preparation.value.firstKeptEntryId).toBe("parallel-carrier");
    expect(retainedTail.map((message: any) => message.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
      "toolResult",
      "toolResult",
    ]);
    expect(
      retainedTail.reduce(
        (sum: number, message: any) => sum + estimateTokens(message),
        0,
      ),
    ).toBeLessThan(Math.floor(budget.hardLimit * 0.5));
    expect(
      retainedTail.filter((message: any) => message.role === "toolResult"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "parallel-tool-3",
          details: undefined,
          content: [
            expect.objectContaining({
              text: expect.stringContaining("[checkpoint truncated:"),
            }),
          ],
        }),
      ]),
    );
    expect(
      (runtime as any).fullEntries.at(-1).message.content[0].text,
    ).toHaveLength(155_573);
    expect((runtime as any).fullEntries.at(-1).message.details).toEqual({
      duplicatedDiagnostic: "x".repeat(155_573),
    });
    await runtime.dispose();
  });

  it("rechecks the hard budget after a reported successful compaction", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      softLimit: 204_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
      keepRecentTokens: 20_000,
    });
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(true);

    await expect((runtime as any).prepareNextTurn(nextTurn)).rejects.toThrow(
      "checkpoint remained above the safe model context budget",
    );
    await runtime.dispose();
  });

  it("persists a retained-tail fallback when automatic summary generation fails", async () => {
    const onEvent = vi.fn();
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({
      host,
      onEvent,
      history: [
        {
          id: "old-user",
          role: "user",
          content: "older task context",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "recent-user",
          role: "user",
          content: "continue the task",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
    });
    vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue({
      ok: false,
      error: {
        code: "summarization_failed",
        message: "provider terminated the summary request",
      },
    });

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    const checkpoint = host.call.mock.calls[0]?.[0] === "session.appendCompaction"
      ? (host.call.mock.calls[0]?.[1] as any).compaction
      : undefined;
    expect(checkpoint).toEqual(
      expect.objectContaining({
        throughMessageId: "recent-user",
        details: expect.objectContaining({
          fallback: "retained_tail",
          failureCode: "CONTEXT_COMPACTION_FAILED",
        }),
      }),
    );
    expect((runtime as any).fullEntries).toHaveLength(2);
    expect((runtime as any).agent.state.messages[0]).toEqual(
      expect.objectContaining({ role: "compactionSummary" }),
    );
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        ok: true,
        fallback: "retained_tail",
      }),
    );
    expect(
      onEvent.mock.calls.some(
        ([envelope]) => (envelope as any).event.type === "error",
      ),
    ).toBe(false);
    await runtime.dispose();
  });

  it("shrinks a terminal checkpoint tail when a new prompt leaves no history to summarize", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const runtime = createRuntime({
      host,
      history: [
        {
          id: "old-user",
          role: "user",
          content: "older task context",
          createdAt: "2026-07-28T00:00:00Z",
          status: "complete",
        },
        {
          id: "recent-user",
          role: "user",
          content: "recent context",
          createdAt: "2026-07-28T00:00:01Z",
          status: "complete",
        },
      ],
      compaction: {
        id: "compact-1",
        summary: "The previous task summary.",
        throughMessageId: "recent-user",
        tokensBefore: 220_000,
        retainedTail: [
          { role: "user", content: "recent context", timestamp: 2 },
        ],
        createdAt: "2026-07-28T00:00:02Z",
      },
    });
    const generateCompaction = vi.spyOn(
      runtime as any,
      "generateCompaction",
    );

    await expect((runtime as any).runCompaction("threshold", false)).resolves.toBe(
      true,
    );

    expect(generateCompaction).not.toHaveBeenCalled();
    expect(host.call).toHaveBeenCalledWith(
      "session.appendCompaction",
      expect.objectContaining({
        compaction: expect.objectContaining({
          details: expect.objectContaining({ fallback: "retained_tail" }),
          summary: expect.stringContaining("The previous task summary."),
        }),
      }),
    );
    await runtime.dispose();
  });

  it("keeps manual compaction failures terminal instead of silently dropping context", async () => {
    const host = { call: vi.fn().mockResolvedValue(undefined) };
    const onEvent = vi.fn();
    const runtime = createRuntime({ host, onEvent });
    vi.spyOn(runtime as any, "generateCompaction").mockResolvedValue({
      ok: false,
      error: {
        code: "summarization_failed",
        message: "summary unavailable",
      },
    });

    await expect((runtime as any).runCompaction("manual", false)).resolves.toBe(
      false,
    );
    expect(host.call).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.map(([envelope]) => (envelope as any).event)).toContainEqual(
      expect.objectContaining({
        type: "compaction_end",
        reason: "manual",
        ok: false,
        error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
      }),
    );
    await runtime.dispose();
  });

  it("does not issue another model turn when hard-limit compaction fails", async () => {
    const runtime = createRuntime();
    vi.spyOn(runtime as any, "contextBudget").mockReturnValue({
      tokens: 225_000,
      softLimit: 204_000,
      hardLimit: 224_000,
      requestHeadroom: 32_000,
    });
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);

    await expect((runtime as any).prepareNextTurn(nextTurn)).rejects.toThrow(
      "CONTEXT_COMPACTION_FAILED",
    );
    await runtime.dispose();
  });

  it("removes the model compaction tool when automatic protection is disabled", async () => {
    const runtime = createRuntime();

    runtime.setCompactionSettings({
      enabled: false,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });

    expect(
      (runtime as any).agent.state.tools.some(
        (tool: any) => tool.name === "CompactContext",
      ),
    ).toBe(false);
    await runtime.dispose();
  });

  it("keeps a preflight-rejected user message in reusable runtime context", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const agent = (runtime as any).agent;
    agent.prompt = vi.fn();
    vi.spyOn(runtime as any, "automaticCompactionNeeded").mockReturnValue(true);
    vi.spyOn(runtime as any, "runCompaction").mockResolvedValue(false);

    await runtime.prompt("oversized request", "user-preflight");

    expect(agent.prompt).not.toHaveBeenCalled();
    expect((runtime as any).fullEntries).toEqual([
      expect.objectContaining({
        id: "user-preflight",
        message: expect.objectContaining({
          role: "user",
          content: "oversized request",
        }),
      }),
    ]);
    expect(agent.state.messages).toEqual([
      expect.objectContaining({ role: "user", content: "oversized request" }),
    ]);
    const events = onEvent.mock.calls.map(([envelope]) => (envelope as any).event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        message: expect.objectContaining({
          role: "assistant",
          status: "error",
          error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "CONTEXT_COMPACTION_FAILED" }),
      }),
    );
    await runtime.dispose();
  });
});

describe("DesktopAgentRuntime plugin skills (D174)", () => {
  const pluginSkills = [
    {
      id: "demo.hello/release-notes",
      name: "Release notes",
      description: "Draft release notes from the changelog.",
    },
  ];

  it("advertises the catalog and loads the Skill tool on demand", async () => {
    const runtime = createRuntime({
      pluginSkills,
      projectInstructions: {
        entries: [{ source: "AGENTS.md", content: "Run unit tests." }],
      },
    });
    const agent = (runtime as any).agent;
    const prompt = agent.state.systemPrompt as string;

    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("`demo.hello/release-notes`");
    // Only the catalog line travels up front; the body loads on demand.
    expect(prompt).not.toContain("Skill: Release notes");
    expect(agent.state.tools.some((tool: any) => tool.name === "Skill")).toBe(false);
    const search = agent.state.tools.find(
      (tool: any) => tool.name === "ToolSearch",
    );
    await search.execute("search-1", { query: "Skill" });
    await (runtime as any).rebuiltAgentContext();
    expect(agent.state.tools.some((tool: any) => tool.name === "Skill")).toBe(true);
    // The user's own instructions come last, so they keep the final word.
    expect(prompt.indexOf("# Skills")).toBeLessThan(
      prompt.indexOf("# Project instructions"),
    );

    await runtime.dispose();
  });

  it("omits the Skill tool and section when no plugin taught a skill", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;

    expect(agent.state.systemPrompt).not.toContain("# Skills");
    expect(agent.state.tools.some((tool: any) => tool.name === "Skill")).toBe(false);

    await runtime.dispose();
  });

  it("keeps the catalog through a nested instruction reload", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        entries: [{ source: "src/AGENTS.md", content: "Use tabs." }],
      }),
    };
    const runtime = createRuntime({ pluginSkills, host });

    await (runtime as any).loadPathInstructions("Read", { path: "src/a.ts" });

    const prompt = (runtime as any).agent.state.systemPrompt;
    expect(prompt).toContain("# Skills");
    expect(prompt).toContain("Use tabs.");

    await runtime.dispose();
  });

  it("does not reuse a runtime whose skill catalog changed", async () => {
    const runtime = createRuntime({ pluginSkills });

    expect(
      runtime.matches("agent", provider, "medium", [], undefined, pluginSkills),
    ).toBe(true);
    // Revoking agent.prompt.inject empties the catalog.
    expect(runtime.matches("agent", provider, "medium", [], undefined, [])).toBe(false);
    expect(
      runtime.matches("agent", provider, "medium", [], undefined, [
        ...pluginSkills,
        { id: "demo.hello/other", name: "Other" },
      ]),
    ).toBe(false);
    // A renamed skill rewrites the catalog line the model reads.
    expect(
      runtime.matches("agent", provider, "medium", [], undefined, [
        { ...pluginSkills[0], name: "Renamed" },
      ]),
    ).toBe(false);

    await runtime.dispose();
  });

  it("routes a Skill call to the host tool bridge", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ ok: true, content: "# Skill: Release notes" }),
    };
    const runtime = createRuntime({ pluginSkills, host });
    const search = (runtime as any).agent.state.tools.find(
      (entry: any) => entry.name === "ToolSearch",
    );
    await search.execute("search-1", { query: "Skill" });
    await (runtime as any).rebuiltAgentContext();
    const tool = (runtime as any).agent.state.tools.find(
      (entry: any) => entry.name === "Skill",
    );

    const result = await tool.execute("call-1", { id: "demo.hello/release-notes" });

    expect(host.call).toHaveBeenCalledWith(
      "tools.execute",
      expect.objectContaining({
        toolName: "Skill",
        args: { id: "demo.hello/release-notes" },
      }),
    );
    expect(result.content).toEqual([
      { type: "text", text: "# Skill: Release notes" },
    ]);

    await runtime.dispose();
  });
});
