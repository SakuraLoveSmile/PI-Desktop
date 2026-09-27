import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSessionProjects,
  sessionProjectDisplayName,
} from "../src/lib/session-projects.ts";

// Frozen contract: KaneoPilot docs/protocol.md §5.23.10 T6.
// The workflow display name comes from the task's registered project name,
// while the session display name is the plan-page title. Workspace identity
// stays keyed by canonical path, so two worktrees of one project must NOT be
// merged into a single entry even though they share a display name.

function session(overrides) {
  return {
    id: "s1",
    title: "随机歌曲右侧按钮应随机新歌而非直接播放",
    messageCount: 3,
    mode: "goal",
    thinkingLevel: "medium",
    permissionMode: "ask",
    updatedAt: "2026-09-27T10:00:00.000Z",
    createdAt: "2026-09-27T09:00:00.000Z",
    ...overrides,
  };
}

test("the Host-persisted projectName outranks the directory basename", () => {
  assert.equal(
    sessionProjectDisplayName(
      session({ projectPath: "/w/ozb7d8vw1sbp/71de3380", projectName: "Music" }),
    ),
    "Music",
  );
});

test("a session without a persisted name keeps the directory basename", () => {
  assert.equal(
    sessionProjectDisplayName(session({ projectPath: "/w/worktrees/71de3380" })),
    "71de3380",
  );
  assert.equal(
    sessionProjectDisplayName(
      session({ projectPath: "/w/worktrees/71de3380", projectName: "   " }),
    ),
    "71de3380",
  );
});

test("two worktrees of one project stay separate entries sharing a display name", () => {
  const projects = collectSessionProjects([
    session({
      id: "a",
      projectPath: "/w/worktrees/round-a",
      projectName: "Music",
      updatedAt: "2026-09-27T10:00:00.000Z",
    }),
    session({
      id: "b",
      projectPath: "/w/worktrees/round-b",
      projectName: "Music",
      updatedAt: "2026-09-27T11:00:00.000Z",
    }),
  ]);

  assert.equal(projects.length, 2);
  assert.deepEqual(
    projects.map((project) => project.name),
    ["Music", "Music"],
  );
  assert.deepEqual(
    projects.map((project) => project.path).sort(),
    ["/w/worktrees/round-a", "/w/worktrees/round-b"],
  );
});

test("the canonical path decides identity, not the display name", () => {
  const projects = collectSessionProjects([
    session({ id: "a", projectPath: "/w/worktrees/round-a", projectName: "Music" }),
    // Same physical path spelled with a trailing slash must fold into one entry.
    session({ id: "b", projectPath: "/w/worktrees/round-a/", projectName: "Music" }),
  ]);

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "Music");
});
