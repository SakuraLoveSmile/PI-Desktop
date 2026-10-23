import assert from "node:assert/strict";
import test from "node:test";
import { buildSidebarMemoryProjects, collapseMemoryProjectGroups, memoryProjectForPath } from "../src/lib/memory-projects.ts";

const memoryProject = { id: "music", name: "Music", primaryPath: "/repos/music",
  paths: ["/repos/music", "/worktrees/music/review", "/pool/music/slot-3"] };
const groups = memoryProject.paths.map((path, index) => ({ id: `group-${index}`,
  name: index ? "slot-3" : "Music", primaryPath: path, roots: [{ path, name: "checkout", position: 0 }],
  memoryProject, pinned: false, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 }));
const sessions = [...memoryProject.paths, "/repos/another-music"].map((projectPath, index) => ({
  id: `session-${index}`, title: `Task ${index}`, projectPath, projectName: "Music", mode: "agent",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
}));

test("opening a worktree exposes its shared project and all related tasks without rebinding sessions", () => {
  const originalPaths = sessions.map((session) => session.projectPath);
  const entries = buildSidebarMemoryProjects({ groups, openPaths: ["/pool/music/slot-3"],
    workspaces: [{ path: "/pool/music/slot-3", name: "slot-3" }], sessions,
    activePath: "/pool/music/slot-3", projectMeta: {} });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "/repos/music");
  assert.equal(entries[0].actionPath, "/pool/music/slot-3");
  assert.equal(entries[0].groupId, "group-2");
  assert.equal(entries[0].name, "Music");
  assert.equal(entries[0].active, true);
  assert.deepEqual(entries[0].sessions.map((session) => session.id), ["session-0", "session-1", "session-2"]);
  assert.deepEqual(sessions.map((session) => session.projectPath), originalPaths);
  assert.equal(buildSidebarMemoryProjects({ groups, openPaths: [], workspaces: [], sessions,
    activePath: null, projectMeta: {} }).length, 0);
});

test("display grouping selects the real primary group without adding tool roots", () => {
  const collapsed = collapseMemoryProjectGroups([...groups].reverse());
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].id, "group-0");
  assert.deepEqual(collapsed[0].roots, groups[0].roots);
  assert.deepEqual(groups.map((group) => group.roots.length), [1, 1, 1]);
});

test("new tasks and project actions retain the active checkout when several related checkouts are open", () => {
  const entries = buildSidebarMemoryProjects({ groups, openPaths: [...memoryProject.paths].reverse(),
    workspaces: [], sessions, activePath: "/worktrees/music/review", projectMeta: {} });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "/repos/music");
  assert.equal(entries[0].actionPath, "/worktrees/music/review");
  assert.equal(entries[0].groupId, "group-1");
  assert.deepEqual(entries[0].roots, groups[1].roots);
});

test("clearing unavailable metadata restores separate checkouts and preserves host display names", () => {
  const args = { openPaths: ["/worktrees/music/review", "/pool/music/slot-3"],
    workspaces: [], sessions, activePath: "/pool/music/slot-3", projectMeta: {} };
  assert.equal(buildSidebarMemoryProjects({ ...args, groups }).length, 1);
  const independent = buildSidebarMemoryProjects({ ...args, groups: [] });
  assert.equal(independent.length, 2);
  assert.deepEqual(independent.map((entry) => entry.name), ["Music", "Music"]);
  assert.deepEqual(independent.map((entry) => entry.sessions[0].projectPath), args.openPaths);
});

test("matching names and unverified multi-root groups do not merge sidebar tabs", () => {
  const unrelatedGroups = [{ ...groups[0], memoryProject: undefined,
    roots: groups.flatMap((group) => group.roots) }];
  const entries = buildSidebarMemoryProjects({ groups: unrelatedGroups,
    openPaths: ["/repos/music", "/pool/music/slot-3", "/repos/another-music"], workspaces: [], sessions,
    activePath: "/repos/music", projectMeta: {} });
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.sessions.length), [1, 1, 1]);
});

test("a reused slot belongs to its current repository while historical tasks keep their memory identity", () => {
  const slot = "/pool/music/slot-3";
  const nextMemory = { id: "other", name: "Other", primaryPath: "/repos/other", paths: ["/repos/other", slot] };
  const current = { ...groups[2], id: "other-slot", memoryProject: nextMemory };
  const currentGroups = [groups[0], current];
  assert.equal(memoryProjectForPath(currentGroups, slot)?.memoryProject?.id, "other");
  const retained = [
    { ...sessions[2], id: "old-task", memoryProjectId: "music" },
    { ...sessions[2], id: "new-task", memoryProjectId: "other" },
    { ...sessions[2], id: "legacy-task" },
  ];
  const entries = buildSidebarMemoryProjects({ groups: currentGroups,
    openPaths: ["/repos/music", slot], workspaces: [], sessions: retained,
    activePath: slot, projectMeta: {} });
  assert.deepEqual(entries.map((entry) => [entry.name, entry.active, entry.sessions.map((session) => session.id)]), [
    ["Music", false, ["old-task"]], ["Other", true, ["new-task", "legacy-task"]],
  ]);
  assert.equal(entries[1].actionPath, slot);
  assert.equal(entries[0].paths.includes(slot), false);
});

test("a shared project without its primary checkout edits only the registered worktree", () => {
  const entries = buildSidebarMemoryProjects({ groups: [groups[2]], openPaths: [groups[2].primaryPath],
    workspaces: [], sessions: [], activePath: groups[2].primaryPath, projectMeta: {} });
  assert.equal(entries[0].path, memoryProject.primaryPath);
  assert.equal(entries[0].actionPath, groups[2].primaryPath);
  assert.equal(entries[0].groupId, groups[2].id);
  assert.deepEqual(entries[0].roots, groups[2].roots);
});
