import { describe, it, expect, vi } from "vitest";
import { createTeamTools } from "./team-tools.js";
import { teamSystemPrompt } from "./team-prompt.js";
import { TEAM_TOOL_NAMES, isTeamTool } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

describe("Expert Team tools and prompt (ADR 0304)", () => {
  const createMockHost = (handlers: Record<string, (params: any) => Promise<any>>) => {
    return {
      call: vi.fn(async (method: string, params?: any) => {
        if (method === "team.getPlanning" && !handlers[method]) return null;
        if (handlers[method]) {
          return handlers[method](params);
        }
        throw new Error(`Unexpected host call: ${method}`);
      }),
    } as unknown as RuntimeHost;
  };

  it("registers team tools and lead-only declare_team_strategy", () => {
    const host = createMockHost({});
    const leadTools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
      getTurnId: () => "turn-100",
    });

    expect(leadTools.length).toBe(10);
    const leadNames = leadTools.map((t) => t.name);
    expect(leadNames).toContain("declare_team_strategy");
    expect(leadTools.find(tool => tool.name === "declare_team_strategy")?.parameters).toMatchObject({
      required: expect.arrayContaining(["strategy", "reason", "members"]),
      properties: { strategy: { const: "delegate" }, members: { minItems: 1 } },
    });
    for (const expected of TEAM_TOOL_NAMES) {
      expect(leadNames).toContain(expected);
      expect(isTeamTool(expected)).toBe(true);
    }

    const nonLeadTools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "member-1",
      isLead: false,
      host,
      getTurnId: () => "turn-100",
    });
    expect(nonLeadTools.length).toBe(9);
    expect(nonLeadTools.map((t) => t.name)).not.toContain("declare_team_strategy");
  });

  it("declare_team_strategy executes through host.call", async () => {
    const host = createMockHost({
      "team.declareStrategy": async (params) => ({
        decision: {
          schemaVersion: 1,
          teamSessionId: params.teamSessionId,
          leadTurnId: params.leadTurnId,
          strategy: params.strategy,
          reason: params.reason,
          updatedAt: "2026-10-01T00:00:00.000Z",
          taskIds: [],
          memberSessionIds: [],
          messageIds: [],
        },
        review: params.strategy === "delegate" ? {
          schemaVersion: 1,
          reviewId: "tlr_test",
          teamSessionId: params.teamSessionId,
          leadTurnId: params.leadTurnId,
          revision: 1,
          status: "pending",
          members: params.members?.map((m: any) => ({
            name: m.name,
            contextKind: m.contextKind ?? "fresh",
            presentation: m.presentation,
            selection: {
              providerId: m.selection?.providerId ?? "default",
              modelId: m.selection?.modelId ?? "default",
              thinkingLevel: m.selection?.thinkingLevel ?? "low",
            },
          })),
        } : null,
      }),
    });

    const leadTools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
      getTurnId: () => "turn-100",
    });

    const declareTool = leadTools.find((t) => t.name === "declare_team_strategy")!;
    const res = await declareTool.execute("call-dec", {
      strategy: "delegate",
      reason: "Needs specialists",
      members: [
        {
          name: "coder",
          description: "Write code",
          presentation: { role: "executor", displayName: "Alex" },
        },
      ],
    });

    expect(res.content[0].type).toBe("text");
    if (res.content[0].type === "text") {
      const data = JSON.parse(res.content[0].text);
      expect(data.strategy).toBe("delegate");
      expect(data.reviewId).toBe("tlr_test");
      expect(data.status).toBe("pending");
      expect(data.members[0].name).toBe("coder");
    }
    expect(host.call).toHaveBeenCalledWith("team.declareStrategy", expect.objectContaining({
      teamSessionId: "team-1",
      leadTurnId: "turn-100",
      strategy: "delegate",
      members: [expect.objectContaining({
        presentation: { role: "executor", displayName: "Alex" },
      })],
    }));
  });

  it("continues automatically after Plan researchers are materialized", async () => {
    const host = createMockHost({
      "team.declareStrategy": async () => ({
        decision: { strategy: "delegate", reason: "Inspect architecture", memberSessionIds: ["research-session"] },
        review: { reviewId: "automatic-review", status: "confirmed", launchPolicy: "automatic_plan",
          members: [{ name: "researcher", selection: { providerId: "local", modelId: "fixture" } }] },
      }),
    });
    const declaration = createTeamTools({ teamSessionId: "team-1", callerSessionId: "team-1", isLead: true,
      getTurnId: () => "plan-turn", host }).find(tool => tool.name === "declare_team_strategy")!;
    const result = await declaration.execute("declaration", { strategy: "delegate", reason: "Inspect architecture", members: [{ name: "researcher" }] });
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining('"awaitingUserApproval":false') });
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining("create owned research tasks") });
    expect(result.content[0]).toEqual({ type: "text", text: expect.stringContaining("SubmitPlan") });
    expect(teamSystemPrompt({ isLead: true, mode: "plan" })).toContain("Do not ask the user to approve");
    expect(teamSystemPrompt({ isLead: true })).toContain("trusted user roster confirmation");
  });

  it("reads the active durable turn on each call and reports a missing turn", async () => {
    const host = createMockHost({
      "team.declareStrategy": async (params) => ({
        decision: {
          schemaVersion: 1,
          teamSessionId: params.teamSessionId,
          leadTurnId: params.leadTurnId,
          strategy: params.strategy,
          reason: params.reason,
          updatedAt: "2026-10-01T00:00:00.000Z",
          taskIds: [],
          memberSessionIds: [],
          messageIds: [],
        },
        review: null,
      }),
    });
    let activeTurnId: string | undefined;
    const tools = createTeamTools({
      teamSessionId: "team-1",
      callerSessionId: "team-1",
      isLead: true,
      host,
      getTurnId: () => activeTurnId,
    });
    const declaration = tools.find((tool) => tool.name === "declare_team_strategy")!;

    const missingTurn = await declaration.execute("call-missing", {
      strategy: "delegate", members: [{ name: "worker" }],
      reason: "One indivisible task",
    });
    expect(missingTurn.details).toEqual({ error: "TURN_NOT_FOUND" });
    expect(host.call).not.toHaveBeenCalled();

    activeTurnId = "durable-turn-1";
    await declaration.execute("call-1", { strategy: "delegate", members: [{ name: "worker" }], reason: "One task" });
    await declaration.execute("call-1-retry", { strategy: "delegate", members: [{ name: "worker" }], reason: "One task" });
    activeTurnId = "durable-turn-2";
    await declaration.execute("call-2", { strategy: "delegate", members: [{ name: "worker" }], reason: "Another task" });

    expect(host.call).toHaveBeenNthCalledWith(1, "team.declareStrategy", expect.objectContaining({
      leadTurnId: "durable-turn-1",
    }));
    expect(host.call).toHaveBeenNthCalledWith(2, "team.declareStrategy", expect.objectContaining({
      leadTurnId: "durable-turn-1",
    }));
    expect(host.call).toHaveBeenNthCalledWith(3, "team.declareStrategy", expect.objectContaining({
      leadTurnId: "durable-turn-2",
    }));
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
    expect(leadPrompt).toContain("task_create");
    expect(leadPrompt).toContain("Subagent `Task*` delegation is disabled");
    expect(leadPrompt).toContain("always delegates");
    expect(leadPrompt).toContain("trusted user roster confirmation");
    expect(leadPrompt).toContain("Never choose lead_only or offer solo approval");

    const memberPrompt = teamSystemPrompt({ isLead: false, memberName: "Coder" });
    expect(memberPrompt).toContain('teammate "Coder"');
    expect(memberPrompt).toContain("Teammates cannot spawn other teammates");
  });
});

describe("planning research boundary", () => {
  it("binds research authority to Host context and returns full planning evidence", async () => {
    const planning = { planningId: "trusted-plan", roundId: "trusted-round", results: [{ structuredResult: {summary:"source", findings:["facts"],risks:["race"],recommendations:["CAS"],verifiedSources:["src/main.ts"]}}] };
    const call=vi.fn(async (method:string) => {
      if(method==="team.getBoard") return {teamSessionId:"lead",revision:1,tasks:[{taskId:"research",subject:"Inspect"}],readiness:[],scopeOverlaps:[]};
      if(method==="team.getPlanning") return planning;
      if(method==="team.submitResearchResult") return {result:planning.results[0]};
      if(method==="team.getRoster") return {teamSessionId:"lead",paused:false,members:[]};
      throw new Error(`Unexpected ${method}`);
    });
    const tools=createTeamTools({teamSessionId:"lead",callerSessionId:"approved-member",isLead:false,workPurpose:"plan_research",planningId:"trusted-plan",roundId:"trusted-round",host:{call} as unknown as RuntimeHost});
    expect(tools.map(t=>t.name)).toEqual(["send_message","wait_for_updates","task_update","task_list","task_get","team_status","submit_research_result"]);
    const submit=tools.find(t=>t.name==="submit_research_result")!;
    expect(submit.parameters).not.toHaveProperty("properties.planningId");
    const reported = await submit.execute("result",{taskId:"research",expectedRevision:1,structuredResult:planning.results[0].structuredResult,planningId:"forged",roundId:"forged",callerSessionId:"lead"});
    expect(reported.content[0]).toEqual({type:"text",text:expect.stringContaining("already been reported to the Lead")});
    expect(reported.content[0]).toEqual({type:"text",text:expect.stringContaining("no completion message is needed")});
    if (reported.content[0].type !== "text") throw new Error("Missing research result text");
    expect(JSON.parse(reported.content[0].text).result).toEqual(planning.results[0]);
    expect(call).toHaveBeenCalledWith("team.submitResearchResult",expect.objectContaining({callerSessionId:"approved-member",planningId:"trusted-plan",roundId:"trusted-round"}));
    const status=await tools.find(t=>t.name==="team_status")!.execute("status",{});
    expect(status.content[0]).toEqual({type:"text",text:expect.stringContaining('"risks":["race"]')});
    const detail=await tools.find(t=>t.name==="task_get")!.execute("task",{taskId:"research"});
    expect(detail.content[0]).toEqual({type:"text",text:expect.stringContaining('"verifiedSources":["src/main.ts"]')});
    expect(teamSystemPrompt({isLead:true,mode:"plan"})).toContain("Lead and coordinator");
    expect(teamSystemPrompt({isLead:false,workPurpose:"plan_research"})).toContain("Read, Glob and Grep only");
    expect(teamSystemPrompt({isLead:false,workPurpose:"plan_research"})).not.toContain("Send the Lead a completion message");
  });

  it("instructs a Lead to release its aggregation turn for pending mailbox work", async () => {
    const planning = { pendingMessagesCount: 2, isReadyForPlanSubmission: false, results: [] };
    const call = vi.fn(async (method: string) => {
      if (method === "team.getRoster") return { teamSessionId: "lead", paused: false, members: [] };
      if (method === "team.getBoard") return { teamSessionId: "lead", revision: 1, tasks: [] };
      if (method === "team.getPlanning") return planning;
      throw new Error(`Unexpected ${method}`);
    });
    const tools = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, host: { call } as unknown as RuntimeHost });
    const status = await tools.find(tool => tool.name === "team_status")!.execute("status", {});
    expect(status.content[0]).toEqual({ type: "text", text: expect.stringContaining("Finish the current aggregation turn") });
    expect(status.details).toMatchObject({ planning });
    expect(teamSystemPrompt({ isLead: true, mode: "plan" })).toContain("do not keep waiting while holding the Lead turn");
  });
});
