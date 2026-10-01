import { describe, expect, it } from "vitest";
import {
  MAX_TEAM_MEMBERS,
  MAX_TEAM_TASKS,
  MAX_TEAM_MAILBOX_MESSAGES,
  MAX_TEAM_MESSAGE_BYTES,
  TEAM_TOOL_NAMES,
  isTeamTool,
  validateTaskDependencies,
  detectWriteScopeOverlaps,
  type TeamTaskRecord,
  DECLARE_TEAM_STRATEGY_TOOL_NAME,
  TEAM_LEAD_TOOL_NAMES,
  MAX_TEAM_STRATEGY_REASON_CHARS,
} from "./team.js";
import {
  isExecutionProfile,
  normalizeExecutionProfile,
} from "./types/common.js";
import { ErrorCodes } from "./errors.js";

describe("team contracts and limits", () => {
  it("enforces canonical DSH limits and constants", () => {
    expect(MAX_TEAM_MEMBERS).toBe(8);
    expect(MAX_TEAM_TASKS).toBe(256);
    expect(MAX_TEAM_MAILBOX_MESSAGES).toBe(64);
    expect(MAX_TEAM_MESSAGE_BYTES).toBe(65536);
  });
  it("keeps the Lead declaration out of the nine dispatch tools", () => {
    expect(DECLARE_TEAM_STRATEGY_TOOL_NAME).toBe("declare_team_strategy");
    expect(TEAM_LEAD_TOOL_NAMES).toHaveLength(10);
    expect(TEAM_LEAD_TOOL_NAMES).toContain(DECLARE_TEAM_STRATEGY_TOOL_NAME);
    // The dispatch list and its guard stay at nine: the declaration tool is
    // not built by createTeamTools.
    expect(isTeamTool(DECLARE_TEAM_STRATEGY_TOOL_NAME)).toBe(false);
    expect(MAX_TEAM_STRATEGY_REASON_CHARS).toBe(1000);
  });

  it("identifies exactly the 9 DSH team tools", () => {
    expect(TEAM_TOOL_NAMES.length).toBe(9);
    expect(isTeamTool("spawn_teammate")).toBe(true);
    expect(isTeamTool("send_message")).toBe(true);
    expect(isTeamTool("wait_for_updates")).toBe(true);
    expect(isTeamTool("interrupt_agent")).toBe(true);
    expect(isTeamTool("task_create")).toBe(true);
    expect(isTeamTool("task_update")).toBe(true);
    expect(isTeamTool("task_list")).toBe(true);
    expect(isTeamTool("task_get")).toBe(true);
    expect(isTeamTool("team_status")).toBe(true);

    expect(isTeamTool("Task")).toBe(false);
    expect(isTeamTool("SessionTask")).toBe(false);
    expect(isTeamTool("random_tool")).toBe(false);
  });

  it("normalizes execution profile correctly", () => {
    expect(isExecutionProfile("standard")).toBe(true);
    expect(isExecutionProfile("team")).toBe(true);
    expect(isExecutionProfile("other")).toBe(false);
    expect(isExecutionProfile(undefined)).toBe(false);

    expect(normalizeExecutionProfile("standard")).toBe("standard");
    expect(normalizeExecutionProfile("team")).toBe("team");
    expect(normalizeExecutionProfile("unknown")).toBe("standard");
    expect(normalizeExecutionProfile(undefined)).toBe("standard");
    expect(normalizeExecutionProfile(null)).toBe("standard");
    expect(normalizeExecutionProfile(123)).toBe("standard");
  });

  it("exports stable team error codes", () => {
    expect(ErrorCodes.TEAM_UNAVAILABLE).toBe("TEAM_UNAVAILABLE");
    expect(ErrorCodes.TEAM_UNSUPPORTED_AGENT).toBe("TEAM_UNSUPPORTED_AGENT");
    expect(ErrorCodes.TEAM_MEMBER_LIMIT_EXCEEDED).toBe("TEAM_MEMBER_LIMIT_EXCEEDED");
    expect(ErrorCodes.TEAM_MEMBER_NOT_FOUND).toBe("TEAM_MEMBER_NOT_FOUND");
    expect(ErrorCodes.TEAM_MEMBER_ALREADY_EXISTS).toBe("TEAM_MEMBER_ALREADY_EXISTS");
    expect(ErrorCodes.TEAM_TASK_NOT_FOUND).toBe("TEAM_TASK_NOT_FOUND");
    expect(ErrorCodes.TEAM_TASK_LIMIT_EXCEEDED).toBe("TEAM_TASK_LIMIT_EXCEEDED");
    expect(ErrorCodes.TEAM_TASK_REVISION_MISMATCH).toBe("TEAM_TASK_REVISION_MISMATCH");
    expect(ErrorCodes.TEAM_TASK_DEPENDENCY_CYCLE).toBe("TEAM_TASK_DEPENDENCY_CYCLE");
    expect(ErrorCodes.TEAM_TASK_MISSING_DEPENDENCY).toBe("TEAM_TASK_MISSING_DEPENDENCY");
    expect(ErrorCodes.TEAM_MAILBOX_LIMIT_EXCEEDED).toBe("TEAM_MAILBOX_LIMIT_EXCEEDED");
    expect(ErrorCodes.TEAM_MESSAGE_TOO_LARGE).toBe("TEAM_MESSAGE_TOO_LARGE");
    expect(ErrorCodes.TEAM_PAUSED).toBe("TEAM_PAUSED");
    expect(ErrorCodes.TEAM_PERMISSION_DENIED).toBe("TEAM_PERMISSION_DENIED");
  });
});

describe("task dependency validation", () => {
  function makeTask(
    taskId: string,
    blockedBy: string[],
    deleted = false,
  ): TeamTaskRecord {
    return {
      teamSessionId: "team-1",
      taskId,
      revision: 1,
      subject: `Task ${taskId}`,
      status: "pending",
      blockedBy,
      writeScopes: [],
      deleted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  it("validates a healthy acyclic dependency graph", () => {
    const tasks = [
      makeTask("t1", []),
      makeTask("t2", ["t1"]),
      makeTask("t3", ["t1", "t2"]),
    ];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects dependencies on missing tasks", () => {
    const tasks = [makeTask("t1", ["non-existent"])];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/depends on missing/);
  });

  it("rejects dependencies on deleted tasks", () => {
    const tasks = [
      makeTask("t1", ["t2"]),
      makeTask("t2", [], true), // deleted
    ];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/depends on missing or deleted task t2/);
  });

  it("rejects self-dependencies", () => {
    const tasks = [makeTask("t1", ["t1"])];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/cannot depend on itself/);
  });

  it("rejects simple 2-node cycles", () => {
    const tasks = [
      makeTask("t1", ["t2"]),
      makeTask("t2", ["t1"]),
    ];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Dependency cycle detected/);
  });

  it("rejects indirect multi-node cycles", () => {
    const tasks = [
      makeTask("t1", ["t3"]),
      makeTask("t2", ["t1"]),
      makeTask("t3", ["t2"]),
    ];
    const result = validateTaskDependencies(tasks);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Dependency cycle detected/);
  });
});

describe("write scope overlap detection", () => {
  function makeTaskWithScopes(
    taskId: string,
    writeScopes: string[],
    status: TeamTaskRecord["status"] = "pending",
  ): TeamTaskRecord {
    return {
      teamSessionId: "team-1",
      taskId,
      revision: 1,
      subject: `Task ${taskId}`,
      status,
      blockedBy: [],
      writeScopes,
      deleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  it("returns no warnings for disjoint scopes", () => {
    const tasks = [
      makeTaskWithScopes("t1", ["src/components/"]),
      makeTaskWithScopes("t2", ["src/features/chat/"]),
    ];
    const warnings = detectWriteScopeOverlaps(tasks);
    expect(warnings.length).toBe(0);
  });

  it("warns on exact path matches", () => {
    const tasks = [
      makeTaskWithScopes("t1", ["src/lib/api.ts"]),
      makeTaskWithScopes("t2", ["src/lib/api.ts"]),
    ];
    const warnings = detectWriteScopeOverlaps(tasks);
    expect(warnings.length).toBe(1);
    expect(warnings[0].taskAId).toBe("t1");
    expect(warnings[0].taskBId).toBe("t2");
  });

  it("warns on ancestor/descendant directory matches", () => {
    const tasks = [
      makeTaskWithScopes("t1", ["src/lib"]),
      makeTaskWithScopes("t2", ["src/lib/context-usage.ts"]),
    ];
    const warnings = detectWriteScopeOverlaps(tasks);
    expect(warnings.length).toBe(1);
  });

  it("ignores completed tasks for active overlap warnings", () => {
    const tasks = [
      makeTaskWithScopes("t1", ["src/lib/api.ts"], "completed"),
      makeTaskWithScopes("t2", ["src/lib/api.ts"], "pending"),
    ];
    const warnings = detectWriteScopeOverlaps(tasks);
    expect(warnings.length).toBe(0);
  });
});
