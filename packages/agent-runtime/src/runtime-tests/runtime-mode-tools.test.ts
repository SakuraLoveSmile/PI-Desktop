import "./runtime-test-harness.js";
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime mode and tool composition", () => {

  it("switches one pi Agent between Agent and Plan tool sets", async () => {
    const runtime = createRuntime({
      pluginTools: [
        {
          name: "plugin_demo_run",
          description: "demo",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    const agent = (runtime as any).agent;
    const initialAgent = agent;
    const agentTools = agent.state.tools.map((tool: any) => tool.name);
    expect(agentTools).toEqual(
      expect.arrayContaining([
        "Read",
        "Glob",
        "Grep",
        "Write",
        "Edit",
        "Bash",
        "EnterPlanMode",
        "ToolSearch",
      ]),
    );
    expect(agentTools).not.toContain("SubmitPlan");
    expect(agentTools).not.toContain("SubmitGoal");

    runtime.setMode("plan");
    expect((runtime as any).agent).toBe(initialAgent);
    expect(runtime.getMode()).toBe("plan");
    const planTools = agent.state.tools.map((tool: any) => tool.name);
    expect(planTools).toEqual(
      expect.arrayContaining([
        "Read",
        "Glob",
        "Grep",
        "BrowserPreview",
        "Bash",
        "SubmitPlan",
      ]),
    );
    expect(planTools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(planTools).not.toContain("plugin_demo_run");
    expect(planTools).not.toContain("EnterPlanMode");
    expect(planTools).not.toContain("SubmitGoal");
    expect(agent.state.systemPrompt).toContain("SubmitPlan");
    expect(agent.state.systemPrompt).toContain("Do not use Write, Edit, Task");
    expect(agent.state.systemPrompt).toContain("plan-safe actions");
    expect(agent.state.systemPrompt).not.toContain("plugin_demo_run");
    expect(agent.state.systemPrompt).not.toContain("PluginCheck");

    runtime.setMode("agent");
    expect((runtime as any).agent).toBe(initialAgent);
    expect(agent.state.tools.map((tool: any) => tool.name)).toContain("EnterPlanMode");
    await runtime.dispose();
  });

  it("gives Goal mode the read-only core, guarded editing declarations, and SubmitGoal", async () => {
    const runtime = createRuntime({
      mode: "goal",
      pluginTools: [
        {
          name: "plugin_demo_run",
          description: "demo",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    const agent = (runtime as any).agent;
    const goalTools = agent.state.tools.map((tool: any) => tool.name);

    expect(goalTools).toEqual(
      expect.arrayContaining([
        "Read",
        "Glob",
        "Grep",
        "BrowserPreview",
        "Bash",
        "SubmitGoal",
      ]),
    );
    expect(goalTools).toEqual(expect.arrayContaining(["Write", "Edit"]));
    expect(goalTools).not.toContain("plugin_demo_run");
    expect(goalTools).not.toContain("SubmitPlan");
    expect(goalTools).not.toContain("EnterGoalMode");
    expect(runtime.getStatus().planningState).toBe("planning");
    expect(agent.state.systemPrompt).toContain("SubmitGoal");
    expect(agent.state.systemPrompt).toContain("acceptance criteria");

    await runtime.dispose();
  });
});
