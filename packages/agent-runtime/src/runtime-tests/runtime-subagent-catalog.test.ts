import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import { type SubagentDefinition } from "@pi-desktop/shared";
import { subagentRuns, createRuntime } from "./runtime-test-harness.js";
import { explorer, pinned, taskTool } from "./subagent-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("uses delegate-first guidance and subagent tools in the standard profile", async () => {
    const runtime = createRuntime({ executionProfile: "standard", subagents: [explorer] });
    try {
      const agent = (runtime as unknown as { agent: Agent }).agent;
      expect(agent.state.systemPrompt).toContain("## Delegation");
      expect(agent.state.systemPrompt).toContain("delegate-first");
      expect(agent.state.systemPrompt).toContain("Delegate those parts early");
      expect(agent.state.systemPrompt).toContain("even when each assignment is small");
      expect(agent.state.systemPrompt).toContain("TaskWait");
      expect(agent.state.systemPrompt).toContain("a few tool calls");
      expect(agent.state.systemPrompt).toContain("user participation");
      expect(agent.state.systemPrompt).toContain("Delegates may split meaningful separable work further");
      expect(agent.state.systemPrompt).toContain("at most one optional review pass");
      const task = agent.state.tools.find((tool) => tool.name === "Task");
      expect(task?.description).toContain("delegate-first");
      expect(task?.description).not.toContain("Prefer doing the work yourself");
      const names = agent.state.tools.map((tool) => tool.name);
      for (const name of ["declare_team_strategy", "spawn_teammate", "send_message", "wait_for_updates", "interrupt_agent", "task_create", "task_update", "task_list", "task_get", "team_status"]) {
        expect(names).not.toContain(name);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("omits delegation guidance and Task tools when no subagent is enabled", async () => {
    // The Host passes only enabled definitions to the runtime.
    const runtime = createRuntime({ executionProfile: "standard", subagents: [] });
    try {
      const agent = (runtime as unknown as { agent: Agent }).agent;
      expect(agent.state.systemPrompt).not.toContain("## Delegation");
      expect(agent.state.systemPrompt).not.toContain("delegate-first");
      const names = agent.state.tools.map((tool) => tool.name);
      for (const name of ["Task", "TaskWait", "TaskList", "TaskStop"]) {
        expect(names).not.toContain(name);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it("uses Team experts without Task or SessionTask declarations", async () => {
    const runtime = createRuntime({
      executionProfile: "team",
      subagents: [explorer],
      pluginTools: [{ name: "SessionTask", description: "Delegate to a session.", parameters: {} }],
      teamContext: { teamSessionId: "team-1", callerSessionId: "session-1", isLead: true },
    });
    try {
      const agent = (runtime as unknown as { agent: Agent }).agent;
      // SessionTask is a deferred plugin tool, so inspect the entire catalog.
      const catalog = (runtime as unknown as { toolCatalog: Map<string, unknown> }).toolCatalog;
      for (const name of ["Task", "TaskWait", "TaskList", "TaskStop", "SessionTask"]) {
        expect(catalog.has(name)).toBe(false);
      }
      expect(agent.state.tools.map((tool) => tool.name)).toContain("declare_team_strategy");
      expect(agent.state.systemPrompt).not.toContain("## Delegation");
      expect(agent.state.systemPrompt).toContain("always delegates");
      expect(agent.state.systemPrompt).toContain("Never choose lead_only or offer solo approval");
    } finally {
      await runtime.dispose();
    }
  });

  it("offers Task as a core Agent-mode tool that advertises every definition", async () => {
    const runtime = createRuntime({ subagents: [explorer, pinned] });
    const tool = taskTool(runtime);

    // Core, so delegation needs no ToolSearch round trip first.
    expect(tool).toBeDefined();
    expect((runtime as any).deferredToolNames.has("Task")).toBe(false);
    expect(tool.description).toContain(
      "- explorer (tools: Read, Glob, Grep): Search the workspace and report findings.",
    );
    expect(tool.description).toContain("- reviewer (tools: Read, Bash): Review a diff.");

    await runtime.dispose();
  });

  it("opts a definition with tools: inherit into the parent catalog minus the deny list", async () => {
    const inheritor: SubagentDefinition = {
      name: "worker",
      description: "Uses the parent toolset.",
      tools: [],
      inheritTools: true,
      prompt: "Do the job.",
      source: "user",
    };
    const runtime = createRuntime({
      subagents: [inheritor],
      pluginSkills: [
        {
          id: "demo.hello/release-notes",
          name: "Release notes",
          description: "Draft release notes.",
        },
      ],
      pluginTools: [
        {
          name: "plugin_demo_ping",
          description: "Ping a plugin.",
          parameters: {},
        },
      ],
    });
    subagentRuns.calls.length = 0;
    subagentRuns.deferred = false;
    await taskTool(runtime).execute("inherit-1", {
      agent: "worker",
      task: "Use Skill.",
    });

    expect(subagentRuns.calls).toHaveLength(1);
    const names = subagentRuns.calls[0].tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("Skill");
    expect(names).toContain("plugin_demo_ping");
    expect(names).toContain("Read");
    expect(names).not.toContain("Task");
    expect(names).not.toContain("TaskWait");
    expect(names).not.toContain("ToolSearch");
    expect(names).not.toContain("new_context");
    expect(names).not.toContain("asktool");
    expect(subagentRuns.calls[0].systemPrompt).toContain("Skill");
    expect(subagentRuns.calls[0].systemPrompt).toContain("demo.hello/release-notes");
    expect(subagentRuns.calls[0].systemPrompt).toContain("You may change files");
    expect(taskTool(runtime).description).toContain("(tools: inherit)");

    await runtime.dispose();
  });
});
