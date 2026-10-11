import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createTeamTools } from "./team-tools.js";
import type { RuntimeHost } from "../host-client.js";
import { isRecord } from "../agent-messages.js";
import { teamSystemPrompt } from "./team-prompt.js";

function declarationTool(approvedExecution = true) {
  const host = { call: async () => ({ decision: { strategy: "delegate", reason: "Implement the approved work" },
    review: { reviewId: "review", status: "pending", members: [] } }) } as unknown as RuntimeHost;
  const tool = createTeamTools({ host, teamSessionId: "lead", callerSessionId: "lead",
    isLead: true, getTurnId: () => "turn", approvedExecution: () => approvedExecution })
    .find(item => item.name === "declare_team_strategy");
  if (!tool) throw new Error("Expected declaration tool");
  return tool;
}

describe("execution roster guidance", () => {
  it("describes all presentation roles and maps builders to executor", () => {
    let schema: unknown = declarationTool().parameters;
    for (const key of ["properties", "members", "items", "properties", "presentation", "properties", "role"]) {
      if (!isRecord(schema)) throw new Error(`Missing schema path: ${key}`);
      schema = schema[key];
    }
    if (!isRecord(schema)) throw new Error("Expected role schema");
    for (const role of ["researcher", "executor", "reviewer", "planner", "collaborator"]) {
      expect(schema.description).toContain(role);
    }
    expect(schema.description).toContain("builder");
    expect(schema.description).toContain("executor");
  });

  it.each(["researcher", "executor", "reviewer", "planner", "collaborator"])("validates %s using the actual provider schema", role => {
    const tool = declarationTool();
    const args = { strategy: "delegate", reason: "Implement the approved work",
      members: [{ name: "builder", presentation: { role, displayName: "Implementation expert" } }] };
    expect(validateToolArguments(tool, { type: "toolCall", id: "declare", name: tool.name, arguments: args })).toEqual(args);
  });

  it("retains the enum boundary for the invalid builder role", () => {
    const tool = declarationTool();
    expect(() => validateToolArguments(tool, { type: "toolCall", id: "declare", name: tool.name,
      arguments: { strategy: "delegate", reason: "Implement work",
        members: [{ name: "builder", presentation: { role: "builder", displayName: "Builder" } }] } })).toThrow();
  });

  it("offers both Host-managed waiting paths only for an approved execution", async () => {
    const args = { strategy: "delegate", reason: "Implement work", members: [{ name: "builder" }] };
    const approved = await declarationTool().execute("declare", args);
    expect(JSON.stringify(approved.content)).toContain("either call wait_for_updates");
    expect(JSON.stringify(approved.content)).toContain("or end your message");
    expect(JSON.stringify(approved.content)).toContain("resumes you with the confirmed roster");
    const ordinary = await declarationTool(false).execute("declare", args);
    expect(JSON.stringify(ordinary.content)).toContain("Explain the proposal and stop this turn.");
    expect(JSON.stringify(ordinary.content)).not.toContain("or end your message");
    const approvedPrompt = teamSystemPrompt({ isLead: true, mode: "agent", approvedExecution: true });
    expect(approvedPrompt).toContain("either call wait_for_updates");
    expect(approvedPrompt).toContain("or end your message");
    const ordinaryPrompt = teamSystemPrompt({ isLead: true, mode: "agent" });
    expect(ordinaryPrompt).toContain("stop for trusted user roster confirmation");
    expect(ordinaryPrompt).not.toContain("or end your message");
    const plan = teamSystemPrompt({ isLead: true, mode: "plan", approvedExecution: true });
    expect(plan).toContain("automatically materializes researchers");
    expect(plan).not.toContain("or end your message");
  });
});
