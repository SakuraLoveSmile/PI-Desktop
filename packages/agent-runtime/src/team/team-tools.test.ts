import { describe, it, expect, vi } from "vitest";
import { createTeamTools } from "./team-tools.js";
import { teamSystemPrompt } from "./team-prompt.js";
import { TEAM_TOOL_NAMES, isTeamTool } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

describe("Expert Team tools and prompt (ADR 0304)", () => {
  const createMockHost = (handlers: Record<string, (params: any) => Promise<any>>) => {
    return {
      call: vi.fn(async (method: string, params?: any) => {
        if (handlers[method]) {
          return handlers[method](params);
        }
        throw new Error(`Unexpected host call: ${method}`);
      }),
    } as unknown as RuntimeHost;
  };

  it("registers all 9 DSH team tools", () => {
    const host = createMockHost({});
    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
    });

    expect(tools.length).toBe(9);
    const names = tools.map((t) => t.name);
    for (const expected of TEAM_TOOL_NAMES) {
      expect(names).toContain(expected);
      expect(isTeamTool(expected)).toBe(true);
    }
  });

  it("spawn_teammate rejects non-lead and succeeds for lead", async () => {
    const host = createMockHost({
      "team.createMember": async (params) => ({
        member: {
          teamSessionId: params.teamSessionId,
          memberSessionId: "sess-member-1",
          name: params.name,
          phase: "idle",
        },
      }),
      "team.sendMessage": async () => ({
        message: { id: "msg-1" },
      }),
    });

    // 1. Non-lead call fails
    const nonLeadTools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "sess-member-1",
      isLead: false,
      host,
    });
    const spawnToolNonLead = nonLeadTools.find((t) => t.name === "spawn_teammate")!;
    const failRes = await spawnToolNonLead.execute("call-1", { name: "researcher" });
    expect(failRes.content[0].type).toBe("text");
    if (failRes.content[0].type === "text") {
      expect(failRes.content[0].text).toContain("TEAM_UNAUTHORIZED");
    }

    // 2. Lead call succeeds and queues initial prompt
    const leadTools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
    });
    const spawnToolLead = leadTools.find((t) => t.name === "spawn_teammate")!;
    const okRes = await spawnToolLead.execute("call-2", {
      name: "researcher",
      description: "Code researcher",
      prompt: "Investigate architecture",
    });
    expect(okRes.content[0].type).toBe("text");
    if (okRes.content[0].type === "text") {
      const data = JSON.parse(okRes.content[0].text);
      expect(data.memberSessionId).toBe("sess-member-1");
      expect(data.name).toBe("researcher");
    }
    expect(host.call).toHaveBeenCalledWith("team.createMember", expect.objectContaining({
      name: "researcher",
      teamSessionId: "team-1",
    }));
    expect(host.call).toHaveBeenCalledWith("team.sendMessage", expect.objectContaining({
      target: "researcher",
      content: "Investigate architecture",
    }));
  });

  it("send_message routes through host team.sendMessage", async () => {
    const host = createMockHost({
      "team.sendMessage": async (params) => ({
        message: {
          id: "msg-42",
          targetMemberName: params.target,
          status: "queued",
          deliveryStatus: "queued",
        },
      }),
    });

    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "sess-2",
      isLead: false,
      host,
    });
    const sendTool = tools.find((t) => t.name === "send_message")!;
    const res = await sendTool.execute("call-3", {
      targetMemberName: "Lead",
      content: "Here is the report",
    });
    if (res.content[0].type === "text") {
      const data = JSON.parse(res.content[0].text);
      expect(data.messageId).toBe("msg-42");
      expect(data.delivered).toBe(false);
      expect(data.deliveryStatus).toBe("queued");
    }
    expect(host.call).toHaveBeenCalledWith("team.sendMessage", {
      teamSessionId: "team-1",
      callerSessionId: "sess-2",
      target: "Lead",
      content: "Here is the report",
    });
  });

  it("interrupt_agent requires lead and invokes turn abort callback", async () => {
    const host = createMockHost({
      "team.getRoster": async () => ({
        members: [{ name: "worker-1", memberSessionId: "sess-worker-1" }],
      }),
      "team.interruptMember": async (params) => {
        expect(params).toEqual({
          teamSessionId: "team-1",
          callerSessionId: "team-1",
          memberName: "worker-1",
        });
        return { interrupted: true };
      },
    });

    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
    });
    const interruptTool = tools.find((t) => t.name === "interrupt_agent")!;
    const res = await interruptTool.execute("call-4", { memberName: "worker-1" });
    if (res.content[0].type === "text") {
      const data = JSON.parse(res.content[0].text);
      expect(data.interrupted).toBe(true);
      expect(data.turnInterrupted).toBe(true);
    }
    expect(host.call).toHaveBeenCalledWith("team.interruptMember", {
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      memberName: "worker-1",
    });
  });

  it("task_create and task_update interact with host task board", async () => {
    const host = createMockHost({
      "team.createTask": async (params) => ({
        task: {
          taskId: "task-100",
          revision: 1,
          subject: params.subject,
          status: "pending",
        },
      }),
      "team.updateTask": async (params) => ({
        task: {
          taskId: params.taskId,
          revision: 2,
          status: params.status,
        },
      }),
    });

    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
    });
    const createTool = tools.find((t) => t.name === "task_create")!;
    const updateTool = tools.find((t) => t.name === "task_update")!;

    const createRes = await createTool.execute("c1", { subject: "Build UI" });
    if (createRes.content[0].type === "text") {
      const data = JSON.parse(createRes.content[0].text);
      expect(data.task.taskId).toBe("task-100");
    }

    const updateRes = await updateTool.execute("c2", {
      taskId: "task-100",
      expectedRevision: 1,
      status: "in_progress",
    });
    if (updateRes.content[0].type === "text") {
      const data = JSON.parse(updateRes.content[0].text);
      expect(data.task.revision).toBe(2);
      expect(data.task.status).toBe("in_progress");
    }
  });

  it("task_list and task_get filter and retrieve tasks", async () => {
    const mockTasks = [
      { taskId: "t1", subject: "Active task", deleted: false },
      { taskId: "t2", subject: "Deleted task", deleted: true },
    ];
    const host = createMockHost({
      "team.getBoard": async () => ({
        revision: 3,
        teamSessionId: "team-1",
        tasks: mockTasks,
        readiness: [],
        scopeOverlaps: [],
      }),
    });

    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
    });
    const listTool = tools.find((t) => t.name === "task_list")!;
    const getTool = tools.find((t) => t.name === "task_get")!;

    // List without deleted
    const listRes = await listTool.execute("l1", {});
    if (listRes.content[0].type === "text") {
      const data = JSON.parse(listRes.content[0].text);
      expect(data.tasks.length).toBe(1);
      expect(data.tasks[0].taskId).toBe("t1");
    }

    // List with deleted
    const listAllRes = await listTool.execute("l2", { includeDeleted: true });
    if (listAllRes.content[0].type === "text") {
      const data = JSON.parse(listAllRes.content[0].text);
      expect(data.tasks.length).toBe(2);
    }

    // Get specific task
    const getRes = await getTool.execute("g1", { taskId: "t1" });
    if (getRes.content[0].type === "text") {
      const data = JSON.parse(getRes.content[0].text);
      expect(data.task.subject).toBe("Active task");
    }
  });

  it("teamSystemPrompt tailors guidance for lead vs member", () => {
    const leadPrompt = teamSystemPrompt({ isLead: true });
    expect(leadPrompt).toContain("Lead of an Expert Team");
    expect(leadPrompt).toContain("spawn_teammate");
    expect(leadPrompt).toContain("Subagent `Task*` delegation is disabled");

    const memberPrompt = teamSystemPrompt({ isLead: false, memberName: "Coder" });
    expect(memberPrompt).toContain('teammate "Coder"');
    expect(memberPrompt).toContain("Teammates cannot spawn other teammates");
  });
});
