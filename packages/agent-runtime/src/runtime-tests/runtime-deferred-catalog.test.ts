import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { getCurrentTools } from "@earendil-works/pi-ai";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime deferred tool catalog", () => {

  it("starts Agent with core tools plus workspace search and discovery", async () => {
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
      "Glob",
      "Grep",
      "asktool",
      "Skill",
      "EnterPlanMode",
      "EnterGoalMode",
      "new_context",
      "ToolSearch",
    ]);
    expect((runtime as any).deferredToolNames.has("Glob")).toBe(false);
    expect((runtime as any).deferredToolNames.has("Grep")).toBe(false);
    expect(names).not.toContain("A2A");
    expect(names).not.toContain("Peer");
    expect(names).not.toContain("BrowserPreview");
    expect(names).not.toContain("PluginCheck");
    expect(names).not.toContain("plugin_demo_validate");

    const prompt = (runtime as any).agent.state.systemPrompt as string;
    expect(prompt).toContain("# On-demand tools");
    expect(prompt).toContain("BrowserPreview");
    expect(prompt).toContain("plugin_demo_validate");
    // The skill catalog ships with the tool, so `Skill` is never a catalog row.
    expect(prompt).toContain("# Skills");
    expect(prompt).not.toMatch(/^- Skill:/m);

    await runtime.dispose();
  });

  it("pauses asktool until the renderer resolves every question", async () => {
    const onEvent = vi.fn();
    const runtime = createRuntime({ onEvent });
    const askTool = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "asktool",
    );
    const optionVariants =
      (askTool.parameters as any).properties.questions.items.properties.options.items.anyOf;
    expect(optionVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "string" }),
        expect.objectContaining({
          type: "object",
          properties: expect.objectContaining({
            label: expect.objectContaining({ type: "string" }),
            description: expect.objectContaining({ type: "string" }),
          }),
        }),
      ]),
    );
    const pending = askTool.execute("ask-call-1", {
      questions: [
        {
          question: "**Color?**",
          options: [
            { label: "**Blue**", description: "A calm, cool color." },
            "Green",
          ],
        },
        { question: "Targets?", options: ["Web", "Desktop"], multiSelect: true },
      ],
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const request = onEvent.mock.calls
      .map(([envelope]) => envelope as any)
      .map((envelope) => envelope.event)
      .find((event) => event.type === "asktool_request")?.request;
    expect(request).toMatchObject({
      sessionId: "session-1",
      toolCallId: "ask-call-1",
      questions: [
        {
          question: "**Color?**",
          options: [
            { label: "**Blue**", description: "A calm, cool color." },
            "Green",
          ],
        },
        { question: "Targets?", options: ["Web", "Desktop"], multiSelect: true },
      ],
    });
    expect(
      runtime.resolveAskTool({
        requestId: request.requestId,
        sessionId: "session-1",
        answers: [["**Blue**"], null],
      }),
    ).toEqual({ ok: true });
    await expect(pending).resolves.toMatchObject({
      content: [{ text: "**Color?**：**Blue**\n---\nTargets?：" }],
      details: { answers: [["**Blue**"], null] },
    });
    const result = await pending;
    expect(result.details).toMatchObject({
      questions: request.questions,
      answers: [["**Blue**"], null],
    });
    expect((result.details as { resolvedAt?: unknown }).resolvedAt).toEqual(expect.any(String));
    await runtime.dispose();
  });

  it("normalizes legacy chat onto the Plan core", async () => {
    const runtime = createRuntime({
      mode: "chat",
      pluginTools: [
        { name: "plugin_demo_run", description: "demo", parameters: {} },
      ],
      pluginSkills: [{ id: "demo.skill", name: "Demo skill" }],
    });
    const names = (runtime as any).agent.state.tools.map(
      (tool: any) => tool.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "Read",
        "Glob",
        "Grep",
        "BrowserPreview",
        "Bash",
        "SubmitPlan",
      ]),
    );
    expect(names).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(names).not.toContain("Skill");
    expect(names).not.toContain("PluginCheck");
    expect(names).not.toContain("plugin_demo_run");
    expect(names).not.toContain("PluginScaffold");
    expect(names).not.toContain("PluginPack");

    await runtime.dispose();
  });

  it("hides plugin tools without plan-safe actions in Plan mode", async () => {
    const runtime = createRuntime({
      mode: "plan",
      pluginTools: [
        {
          name: "plugin_demo_mutate",
          description: "mutates state",
          parameters: {},
        },
      ],
    });
    const names = (runtime as any).agent.state.tools.map(
      (tool: any) => tool.name,
    );
    expect(names).not.toContain("plugin_demo_mutate");
    await runtime.dispose();
  });

  it("exposes plugin tools with plan-safe actions in Plan mode", async () => {
    const runtime = createRuntime({
      mode: "plan",
      pluginTools: [
        {
          name: "plugin_demo_browser",
          description: "browser",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["navigate", "click"] },
            },
          },
          planSafeActions: ["navigate"],
        },
        {
          name: "plugin_demo_other",
          description: "unrelated plugin tool",
          parameters: {},
          // Empty array is treated as Plan-denied.
          planSafeActions: [],
        },
      ],
    });
    const tools = (runtime as any).agent.state.tools as Array<{
      name: string;
      description: string;
    }>;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("plugin_demo_browser");
    expect(names).not.toContain("plugin_demo_other");
    const browser = tools.find((tool) => tool.name === "plugin_demo_browser");
    expect(browser?.description).toMatch(
      /plan mode: only navigate actions/,
    );
    await runtime.dispose();
  });

  it("activates matching tools for the next model turn", async () => {
    const runtime = createRuntime();
    const agent = (runtime as any).agent;
    const search = agent.state.tools.find(
      (tool: any) => tool.name === "ToolSearch",
    );

    const result = await search.execute("search-1", { query: "BrowserPreview" });
    expect(result.details.activated).toEqual(["BrowserPreview"]);
    expect(result.details.addedToolNames).toEqual(["BrowserPreview"]);
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
          isError: false,
          timestamp: Date.now(),
        },
      ],
    });
    expect(next.context.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      true,
    );
    // The Pi loop declares changes immediately before conversion; preparation
    // only changes the executable tool catalog.
    expect(getCurrentTools(next.context.messages).some((tool) => tool.name === "BrowserPreview")).toBe(false);

    await runtime.dispose();
  });

  it("keeps deferred capabilities sticky at the beginning of a new prompt (#1225)", async () => {
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

    // Sticky activation: the next prompt does not drop what the model still
    // sees and calls, even when the announcing rows leave the context window.
    (runtime as any).resetDeferredToolsForPrompt();
    expect(agent.state.tools.some((tool: any) => tool.name === "BrowserPreview")).toBe(
      true,
    );
    // Reset retains executability; Pi declares it at the next dispatch, not
    // while this test calls preparation helpers outside the agent loop.
    expect(getCurrentTools(agent.state.messages).some((tool) => tool.name === "BrowserPreview")).toBe(false);
    await runtime.dispose();
  });
});
