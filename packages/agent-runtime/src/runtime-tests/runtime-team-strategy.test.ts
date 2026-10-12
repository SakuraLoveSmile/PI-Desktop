import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createRuntime, assistantMessage } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime Team strategy wiring", () => {

  it("preserves Team-profile Goal negotiation and restores consent on Agent transition", async () => {
    const markdown = "# Goal\n\nReach the bounded result.\n\n## Acceptance criteria\nVerified.\n\n## Boundaries\nFixture only.\n";
    const host = { call: vi.fn(async (method: string) => {
      if (method === "team.authorizeLeadTool") throw new Error("TEAM_APPROVAL_REQUIRED");
      if (method === "plans.submit") return { status: "pending", proposal: {
        id: "goal-proposal", kind: "goal", title: "Fixture Goal", markdown, question: "Approve?",
        artifact: { relativePath: ".pi/goal/fixture.md", sha256: "a".repeat(64), sizeBytes: markdown.length },
      } };
      return null;
    }) };
    const runtime = createRuntime({ mode: "goal", executionProfile: "team", turnId: "goal-turn",
      teamContext: { teamSessionId: "session-1", callerSessionId: "session-1", isLead: true }, host });
    try {
      let agent = (runtime as unknown as { agent: Agent }).agent;
      const submit = agent.state.tools.find(tool => tool.name === "SubmitGoal")!;
      const result = await submit.execute("submit-goal", { title: "Fixture Goal", markdown, question: "Approve?" });
      expect(result.details).toMatchObject({ proposal: { id: "goal-proposal" } });
      expect(host.call.mock.calls.some(([method]) => method === "team.authorizeLeadTool")).toBe(false);
      runtime.setMode("agent");
      agent = (runtime as unknown as { agent: Agent }).agent;
      const write = agent.state.tools.find(tool => tool.name === "Write")!;
      await expect(write.execute("agent-write", { path: "fixture.txt", content: "no approval" })).rejects.toThrow("TEAM_APPROVAL_REQUIRED");
    } finally { await runtime.dispose(); }
  });

  it("checks fresh Host approval before Lead tools, including skills and plugin tools", async () => {
    let approved = false;
    const executions: string[] = [];
    const host = {
      call: vi.fn(async (method: string, input?: Record<string, unknown>) => {
        if (method === "team.authorizeLeadTool") {
          expect(input).toMatchObject({ teamSessionId: "session-1", callerSessionId: "session-1" });
          if (!approved) throw new Error("TEAM_APPROVAL_REQUIRED: trusted review is pending");
          return { authorized: true };
        }
        if (method === "tools.execute") {
          executions.push(String(input?.toolName));
          return { ok: true, content: "Executed after confirmation" };
        }
        if (method === "project.instructions.resolve") return { entries: [] };
        return null;
      }),
    };
    const runtime = createRuntime({
      executionProfile: "team", teamContext: {
        teamSessionId: "session-1", callerSessionId: "session-1", isLead: true,
      },
      pluginTools: [{ name: "plugin_demo_run", description: "Fixture plugin", parameters: {} }],
      pluginSkills: [{ id: "demo.skill", name: "Demo skill" }], host,
    });
    try {
      const agent = (runtime as unknown as { agent: Agent }).agent;
      const search = agent.state.tools.find(tool => tool.name === "ToolSearch");
      if (search) {
        await search.execute("discover-skill", { query: "Skill" });
        await search.execute("discover-plugin", { query: "plugin_demo_run" });
        await (runtime as unknown as { rebuiltAgentContext: () => Promise<void> }).rebuiltAgentContext();
      }
      for (const name of ["Write", "Bash", "Skill", "plugin_demo_run"]) {
        const tool = agent.state.tools.find(candidate => candidate.name === name);
        expect(tool, name).toBeDefined();
        const input = name === "Write" ? { path: "pending.txt", content: "unapproved" }
          : name === "Bash" ? { command: "echo unapproved" }
          : name === "Skill" ? { id: "demo.skill" } : {};
        await expect(tool!.execute(`pending-${name}`, input)).rejects.toThrow("TEAM_APPROVAL_REQUIRED");
      }
      expect(executions).toEqual([]);
      const plugin = agent.state.tools.find(tool => tool.name === "plugin_demo_run")!;
      approved = true;
      await plugin.execute("confirmed-plugin", {});
      expect(executions).toEqual(["plugin_demo_run"]);
      approved = false;
      await expect(plugin.execute("new-user-turn", {})).rejects.toThrow("TEAM_APPROVAL_REQUIRED");
      expect(executions).toEqual(["plugin_demo_run"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("binds each declaration and same-turn retry to the durable active turn", async () => {
    const host = {
      call: vi.fn(async (method: string, params?: Record<string, any>) => {
        if (method !== "team.declareStrategy") return undefined;
        return {
          decision: {
            schemaVersion: 1,
            teamSessionId: params?.teamSessionId,
            leadTurnId: params?.leadTurnId,
            strategy: params?.strategy,
            reason: params?.reason,
            updatedAt: "2026-10-01T00:00:00.000Z",
            taskIds: [],
            memberSessionIds: [],
            messageIds: [],
          },
          review: null,
        };
      }),
    };
    const runtime = createRuntime({
      executionProfile: "team",
      teamContext: {
        teamSessionId: "team-1",
        callerSessionId: "lead-session",
        isLead: true,
      },
      host: host as never,
    });

    let request = 0;
    (runtime as any).models = {
      streamSimple: () => {
        request += 1;
        const declaration = request === 1 || request === 2 || request === 4;
        const stopReason = declaration ? "toolUse" : "stop";
        const message = assistantMessage({
          content: declaration
            ? [{
                type: "toolCall",
                id: `declare-${request}`,
                name: "declare_team_strategy",
                arguments: {
                  strategy: "delegate",
                  members: [{ name: "worker", description: "Execute the bounded task" }],
                  reason: "Expert Team requires delegation",
                },
              }]
            : [{ type: "text", text: "done" }],
          stopReason,
        }) as unknown as AssistantMessage;
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: stopReason, message });
          stream.end(message);
        });
        return stream;
      },
    };

    try {
      await runtime.prompt("First turn", "user-1", "durable-turn-1");
      await runtime.prompt("Second turn", "user-2", "durable-turn-2");
      const declarationCalls = host.call.mock.calls.filter(
        ([method]) => method === "team.declareStrategy",
      );
      expect(declarationCalls.map(([, args]) => args?.leadTurnId)).toEqual([
        "durable-turn-1",
        "durable-turn-1",
        "durable-turn-2",
      ]);
      expect(declarationCalls.every(([, args]) => args?.callerSessionId === "lead-session"))
        .toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("research members never declare mutation, shell, plugin or Plan transition tools", async () => {
    const runtime = createRuntime({executionProfile:"team",mode:"agent",teamContext:{teamSessionId:"lead",callerSessionId:"researcher",isLead:false,workPurpose:"plan_research",planningId:"plan",roundId:"round"}});
    try {
      const agent = (runtime as unknown as {agent:Agent}).agent;
      const names=agent.state.tools.map(tool=>tool.name);
      expect(names).toEqual(expect.arrayContaining(["Read","Glob","Grep","submit_research_result","team_status"]));
      for(const forbidden of ["Write","Edit","Bash","Skill","BrowserPreview","EnterPlanMode","SubmitPlan","task_create","spawn_teammate","asktool"]) expect(names).not.toContain(forbidden);
    } finally {await runtime.dispose();}
  });

  it("exposes coordinator tools in Plan and preserves Agent Team tools", async () => {
    const runtime = createRuntime({
      mode: "plan",
      executionProfile: "team",
      teamContext: {
        teamSessionId: "team-1",
        callerSessionId: "lead-session",
        isLead: true,
      },
    });
    const agent = (runtime as unknown as { agent: Agent }).agent;
    const teamNames = [
      "spawn_teammate",
      "send_message",
      "wait_for_updates",
      "interrupt_agent",
      "task_create",
      "task_update",
      "task_list",
      "task_get",
      "team_status",
    ];

    try {
      expect((runtime as any).agent.state.tools.map((tool: { name: string }) => tool.name))
        .toEqual(expect.arrayContaining([...teamNames, "declare_team_strategy"]));
      expect((runtime as any).agent.state.systemPrompt).toContain("declare_team_strategy");
      expect(agent.state.systemPrompt).toContain("primary language of the user's request");
      expect(agent.state.systemPrompt).toContain("8-16 Chinese characters");

      runtime.setMode("agent");
      expect((runtime as any).agent.state.tools.map((tool: { name: string }) => tool.name))
        .toEqual(expect.arrayContaining([...teamNames, "declare_team_strategy"]));
      const declaration = (runtime as any).agent.state.tools.find(
        (tool: { name: string }) => tool.name === "declare_team_strategy",
      );
      expect(declaration.parameters.properties).not.toHaveProperty("callerSessionId");
      expect(declaration.parameters.properties).not.toHaveProperty("turnId");
      expect((runtime as any).agent.state.systemPrompt).toContain("declare_team_strategy");
      expect(agent.state.systemPrompt).toContain("primary language of the user's request");
      expect(agent.state.systemPrompt).toContain("8-16 Chinese characters");

      runtime.setMode("plan");
      expect((runtime as any).agent.state.tools.map((tool: { name: string }) => tool.name))
        .toEqual(expect.arrayContaining([...teamNames, "declare_team_strategy"]));
      expect((runtime as any).agent.state.systemPrompt).toContain("declare_team_strategy");
      expect(agent.state.systemPrompt).toContain("primary language of the user's request");
      expect(agent.state.systemPrompt).toContain("8-16 Chinese characters");
    } finally {
      await runtime.dispose();
    }
  });
});
