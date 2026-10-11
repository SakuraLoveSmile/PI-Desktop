import { describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../host-client.js";
import { createTeamTools } from "./team-tools.js";

describe("Host-owned Team member activity", () => {
  it("forwards explicit force and reason without granting a member Lead authority", async () => {
    const call = vi.fn(async (method: string) => {
      if (method === "team.getRoster") return { members: [{ name: "tester", memberSessionId: "expert" }] };
      if (method === "team.interruptMember") return { interrupted: true };
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const host = { call } as unknown as RuntimeHost;
    const tools = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, host });
    const interrupt = tools.find(tool => tool.name === "interrupt_agent")!;
    await interrupt.execute("forced", { memberName: "tester", force: true, reason: "User superseded the test" });
    expect(call).toHaveBeenCalledWith("team.interruptMember", {
      teamSessionId: "lead", callerSessionId: "lead", memberName: "tester", force: true, reason: "User superseded the test",
    });
    call.mockClear();
    const memberTools = createTeamTools({ teamSessionId: "lead", callerSessionId: "expert", isLead: false, host });
    const denial = await memberTools.find(tool => tool.name === "interrupt_agent")!.execute("unauthorized", {
      memberName: "tester", force: true, reason: "Attempted override",
    });
    expect(denial.details).toEqual({ error: "TEAM_UNAUTHORIZED" });
    expect(call).not.toHaveBeenCalled();
  });

  it("preserves Host activity evidence in team_status and reports a genuinely idle target accurately", async () => {
    const evidence = [{ memberSessionId: "expert", memberName: "tester", requiresForce: true,
      incomingQueue: { count: 1, oldestAgeMs: 18_000_000 }, runningBackgroundProcesses: [{ id: "long-test", status: "running" }] }];
    const host = { call: vi.fn(async (method: string) => {
      if (method === "team.getRoster") return { teamSessionId: "lead", paused: false, members: [{ name: "tester", memberSessionId: "expert" }], memberActivity: evidence };
      if (method === "team.getBoard") return { revision: 1, tasks: [], readiness: [], scopeOverlaps: [] };
      if (method === "team.getPlanning") return null;
      if (method === "team.listMessages") return { messages: [] };
      if (method === "team.interruptMember") return { interrupted: false };
      throw new Error(`Unexpected RPC: ${method}`);
    }) } as unknown as RuntimeHost;
    const tools = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, host });
    const result = await tools.find(tool => tool.name === "team_status")!.execute("status", {});
    expect(result.content[0].type).toBe("text");
    if (result.content[0].type === "text") expect(JSON.parse(result.content[0].text).memberActivity).toEqual(evidence);
    const idle = await tools.find(tool => tool.name === "interrupt_agent")!.execute("idle", { memberName: "tester" });
    expect(idle.details).toEqual({ interrupted: false, memberName: "tester", turnInterrupted: false });
  });
});
