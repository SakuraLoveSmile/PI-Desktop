import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTeamTaskRows,
  deriveTeamLeadVisualState,
  filterTeamTaskRows,
  localTeamSessionId,
  projectMemberIdentities,
  selectOverviewTaskRows,
} from "../src/lib/team-presentation.ts";

test("local Team navigation resolves members to their Lead and excludes remote/native authorities", () => {
  const lead = { id: "lead", executionProfile: "team" };
  assert.equal(localTeamSessionId(lead), "lead");
  const child = { ...lead, id: "child", team: { role: "member", teamSessionId: "lead" } };
  assert.equal(localTeamSessionId(child), "lead");
  assert.equal(localTeamSessionId({ ...child, source: "remote" }), undefined);
  assert.equal(localTeamSessionId({ ...child, source: "pi-native" }), undefined);
  assert.equal(localTeamSessionId({ ...child, id: "remote:child" }), undefined);
  assert.equal(localTeamSessionId({ ...child, id: "native-pi:child" }), undefined);
  assert.equal(localTeamSessionId({ ...lead, executionProfile: "standard" }), undefined);
});

function member(name, id, extra = {}) {
  return {
    teamSessionId: "team-1",
    memberSessionId: id,
    name,
    contextKind: "fresh",
    phase: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function task(taskId, status, createdAt, extra = {}) {
  return {
    teamSessionId: "team-1",
    taskId,
    revision: 1,
    subject: `Task ${taskId}`,
    status,
    ownerSessionId: null,
    ownerMemberName: null,
    blockedBy: [],
    writeScopes: [],
    deleted: false,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

test("member display projection keeps routing handles and maps legacy identities predictably", () => {
  const members = [
    member("V1_preview_scout", "member-1"),
    member("V2_archive_scout", "member-2"),
    member("reviewer", "member-3"),
    member("custom-handle", "member-4"),
    member("custom-machine-name", "member-5", {
      presentation: { role: "executor", displayName: "Rae" },
    }),
  ];
  const projected = projectMemberIdentities(members);

  assert.deepEqual(projected.map(({ role, displayName }) => [role, displayName]), [
    ["researcher", "Alex"],
    ["researcher", "Sam"],
    ["reviewer", "Tina"],
    ["collaborator", "custom-handle"],
    ["executor", "Rae"],
  ]);
  assert.deepEqual(projected.map(({ handle }) => handle), members.map(({ name }) => name));
  assert.equal(projected[0].phase, "idle");
});

test("task rows preserve creation order and only pending unresolved dependencies become blocked", () => {
  const tasks = [
    task("c", "completed", "2026-01-03T00:00:00.000Z", { blockedBy: ["a"] }),
    task("a", "pending", "2026-01-01T00:00:00.000Z", { blockedBy: ["missing"] }),
    task("b", "pending", "2026-01-02T00:00:00.000Z"),
    task("gone", "failed", "2026-01-04T00:00:00.000Z", { deleted: true }),
  ];
  const rows = buildTeamTaskRows(tasks, [], [
    { taskId: "a", isReady: false, unresolvedBlockedBy: ["missing"] },
    { taskId: "b", isReady: true, unresolvedBlockedBy: [] },
    { taskId: "c", isReady: false, unresolvedBlockedBy: ["a"] },
  ]);

  assert.deepEqual(rows.map(({ task: item, ordinal, state }) => [item.taskId, ordinal, state]), [
    ["a", 1, "blocked"],
    ["b", 2, "pending"],
    ["c", 3, "completed"],
  ]);
});

test("overview prioritizes active and failed work while preserving stable ordinal labels", () => {
  const tasks = [
    task("done", "completed", "2026-01-01T00:00:00.000Z"),
    task("waiting", "pending", "2026-01-02T00:00:00.000Z", { blockedBy: ["missing"] }),
    task("active", "in_progress", "2026-01-03T00:00:00.000Z"),
    task("error", "failed", "2026-01-04T00:00:00.000Z"),
    task("cancelled", "cancelled", "2026-01-05T00:00:00.000Z"),
  ];
  const rows = buildTeamTaskRows(tasks, [], [
    { taskId: "waiting", isReady: false, unresolvedBlockedBy: ["missing"] },
  ]);
  const overview = selectOverviewTaskRows(rows, 4);

  assert.deepEqual(overview.map(({ task: item, ordinal }) => [item.taskId, ordinal]), [
    ["error", 4],
    ["active", 3],
    ["waiting", 2],
    ["done", 1],
  ]);
  assert.equal(selectOverviewTaskRows(rows, 5).length, 5);
});

test("board filters and searches without changing task state or losing cancelled tasks from All", () => {
  const rows = buildTeamTaskRows([
    task("1", "in_progress", "2026-01-01T00:00:00.000Z", { subject: "Inspect session sidebar" }),
    task("2", "cancelled", "2026-01-02T00:00:00.000Z", { subject: "Review archived session" }),
    task("3", "failed", "2026-01-03T00:00:00.000Z", { subject: "Inspect work panel" }),
  ], [], []);
  const originalStatuses = rows.map(({ task: item }) => item.status);

  assert.deepEqual(filterTeamTaskRows(rows, "all", "archived").map(({ task: item }) => item.taskId), ["2"]);
  assert.deepEqual(filterTeamTaskRows(rows, "failed", "").map(({ task: item }) => item.taskId), ["3"]);
  assert.deepEqual(rows.map(({ task: item }) => item.status), originalStatuses);
});

test("Lead panorama state respects Host activity, queued mail, pause, and task completion", () => {
  const runningMember = member("executor", "member-running", { phase: "running" });
  const pendingTask = task("pending", "pending", "2026-01-01T00:00:00.000Z");
  const completedTask = task("done", "completed", "2026-01-01T00:00:00.000Z");

  assert.deepEqual(deriveTeamLeadVisualState("idle", false, [runningMember], [], 0), {
    status: "idle",
    waitingForMembers: true,
  });
  assert.deepEqual(deriveTeamLeadVisualState("idle", false, [], [], 1), {
    status: "idle",
    waitingForMembers: true,
  });
  assert.deepEqual(deriveTeamLeadVisualState("completed", false, [], [pendingTask], 0), {
    status: "idle",
    waitingForMembers: false,
  });
  assert.deepEqual(deriveTeamLeadVisualState("completed", false, [], [completedTask], 0), {
    status: "completed",
    waitingForMembers: false,
  });
  assert.deepEqual(deriveTeamLeadVisualState("idle", true, [runningMember], [], 0), {
    status: "paused",
    waitingForMembers: false,
  });
  assert.deepEqual(deriveTeamLeadVisualState("failed", false, [runningMember], [], 0), {
    status: "failed",
    waitingForMembers: false,
  });
});


test("a 256-task board keeps stable ordering while Overview remains bounded", () => {
  const tasks = Array.from({ length: 256 }, (_, index) => task(
    `task-${index}`, index < 250 ? "completed" : "in_progress",
    new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    { subject: `Scope ${index} ${"long-path/".repeat(16)}` },
  ));
  const rows = buildTeamTaskRows(tasks, [], []);
  assert.equal(rows.length, 256);
  assert.deepEqual(rows.map((row) => row.ordinal), Array.from({ length: 256 }, (_, i) => i + 1));
  const overview = selectOverviewTaskRows(rows);
  assert.ok(overview.length <= 8);
  assert.ok(overview.slice(0, 6).every((row) => row.state === "in_progress"));
  assert.equal(filterTeamTaskRows(rows, "completed", "").length, 250);
  assert.equal(filterTeamTaskRows(rows, "all", "Scope 255")[0].task.taskId, "task-255");
});
