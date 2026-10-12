import { describe, expect, it } from "vitest";
import type { RuntimeHost } from "../host-client.js";
import type { TeamMemberRecord, TeamTaskRecord } from "@pi-desktop/shared";
import { createTeamTools } from "./team-tools.js";

const member = (name: string, phase: TeamMemberRecord["phase"]): TeamMemberRecord => ({
  teamSessionId: "lead", memberSessionId: `session-${name}`, name, phase,
  contextKind: "fresh", createdAt: "1", updatedAt: "2",
});
const task = (taskId: string, owner: string | null, status: TeamTaskRecord["status"], deleted = false): TeamTaskRecord => ({
  teamSessionId: "lead", taskId, revision: 3, subject: taskId, status,
  ownerSessionId: owner ? `session-${owner}` : null, ownerMemberName: owner,
  blockedBy: [], writeScopes: [], deleted, createdAt: "1", updatedAt: "2",
});

async function status(members: TeamMemberRecord[], tasks: TeamTaskRecord[], withMail = false, legacy = false) {
  const calls: string[] = [];
  const runLimits = { enabled: true, softMs: 100, hardMs: 200, elapsedMs: 1 };
  const memberActivity = [{ memberSessionId: "session-qa", lastActivityAt: "2" }];
  const host: RuntimeHost = { call: async <T>(method: string): Promise<T> => {
    calls.push(method);
    const values: Record<string, unknown> = {
      "team.getRoster": { teamSessionId: "lead", paused: false, members, ...(legacy ? {} : { runLimits, memberActivity }) },
      "team.getBoard": { teamSessionId: "lead", revision: 4, tasks, readiness: [], scopeOverlaps: [],
        ...(legacy ? {} : { sharedGitWarningCount: 2, sharedGitWarnings: [{ memberName: "qa", count: 2 }] }) },
      "team.getPlanning": null,
      "team.listMessages": { messages: withMail ? [{ id: "mail", targetSessionId: "lead", sourceSessionId: "session-qa",
        sourceMemberName: "qa", status: "queued", turnId: null, createdAt: String(Date.now()), content: "private report" }] : [] },
    };
    if (!(method in values)) throw new Error(`Unexpected mutation: ${method}`);
    return values[method] as T;
  } };
  const tool = createTeamTools({ teamSessionId: "lead", callerSessionId: "lead", isLead: true, mode: "agent", host })
    .find(tool => tool.name === "team_status")!;
  const result = await tool.execute("status", {});
  const text = result.content[0];
  if (text.type !== "text") throw new Error("Missing status text");
  return { output: JSON.parse(text.text), details: result.details, calls, runLimits, memberActivity };
}

describe("completed member owned-open task advisory", () => {
  it("summarizes exact owners and only nondeleted pending/in-progress tasks without mutation", async () => {
    const tasks = [task("pending", "qa", "pending"), task("active", "qa", "in_progress"),
      task("done", "qa", "completed"), task("failed", "qa", "failed"), task("cancelled", "qa", "cancelled"),
      task("deleted", "qa", "pending", true), task("running", "runner", "pending"), task("unowned", null, "pending")];
    const result = await status([member("qa", "completed"), member("runner", "running")], tasks);
    expect(result.output.completedMembersWithOpenTasks).toEqual([
      { memberSessionId: "session-qa", memberName: "qa", taskIds: ["pending", "active"] },
    ]);
    expect(result.output.completedMemberOpenTaskNextStep).toContain("last turn");
    expect(result.output.completedMemberOpenTaskNextStep).toContain("expectedRevision");
    expect(result.output.completedMemberOpenTaskNextStep).toContain("Do not redo");
    expect(result.output.nextStep).toBe(result.output.completedMemberOpenTaskNextStep);
    expect(result.details).toMatchObject({ completedMembersWithOpenTasks: result.output.completedMembersWithOpenTasks });
    expect(result.output.tasks).toEqual(tasks);
    expect(result.output).toMatchObject({ runLimits: result.runLimits, memberActivity: result.memberActivity,
      sharedGitWarningCount: 2, sharedGitWarnings: [{ memberName: "qa", count: 2 }] });
    expect(result.calls.every(call => call.startsWith("team.get") || call === "team.listMessages")).toBe(true);
  });

  it("retains pending-mail nextStep and exposes the task advisory separately", async () => {
    const result = await status([member("qa", "completed")], [task("pending", "qa", "pending")], true);
    expect(result.output.nextStep).toContain("authenticated bodies");
    expect(result.output.nextStep).not.toBe(result.output.completedMemberOpenTaskNextStep);
    expect(result.output.pendingMessagesCount).toBe(1);
    expect(JSON.stringify(result.output)).not.toContain("private report");
  });

  it("has no false advisory for settled boards and tolerates absent optional Host fields", async () => {
    const result = await status([member("qa", "completed")], [task("done", "qa", "completed")], false, true);
    expect(result.output.completedMembersWithOpenTasks).toEqual([]);
    expect(result.output.completedMemberOpenTaskNextStep).toBeUndefined();
    expect(result.output.nextStep).toBeUndefined();
    expect(result.output.sharedGitWarningCount).toBe(0);
    expect(result.output.runLimits).toBeUndefined();
    expect(result.output.memberActivity).toBeUndefined();
  });

  it("does not attribute tasks by reused member names when the session owner differs", async () => {
    const old = { ...task("old-owner", "qa", "pending"), ownerSessionId: "previous-session-qa" };
    const result = await status([member("qa", "completed")], [old]);
    expect(result.output.completedMembersWithOpenTasks).toEqual([]);
  });
});
