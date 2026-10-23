import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_VISIBLE_SESSION_COUNT,
  buildProjectIndex,
  displayedProjectSessions,
  filterArchiveItems,
  groupArchiveRows,
  neighborPath,
  nextArchiveOpenPath,
  projectBucket,
  projectMatchesQuery,
  sessionMatchesIndexProject,
  sessionMatchesProjectRoots,
  sessionMatchesQuery,
  sessionTimestamp,
  shortenPath,
} from "../src/lib/project-archive.ts";

test("the archive never hides archived rows behind a filter", () => {
  const grouped = groupArchiveRows(
    [
      {
        path: "/a",
        name: "A",
        openedAt: 3,
        groupId: "a",
        roots: [{ path: "/a", name: "A", position: 0 }],
        legacy: false,
        pinned: true,
      },
      {
        path: "/b",
        name: "B",
        openedAt: 2,
        groupId: "b",
        roots: [{ path: "/b", name: "B", position: 0 }],
        legacy: false,
      },
      {
        path: "/c",
        name: "C",
        openedAt: 1,
        groupId: "c",
        roots: [{ path: "/c", name: "C", position: 0 }],
        legacy: false,
        archived: true,
      },
    ],
    "recent",
  );
  assert.deepEqual(
    grouped.map((group) => [group.id, group.rows.map((row) => row.path)]),
    [
      ["pinned", ["/a"]],
      ["projects", ["/b"]],
      ["archived", ["/c"]],
    ],
  );
  assert.equal(projectBucket({ archived: true, pinned: true, path: "/c", name: "C", openedAt: 0, groupId: "c", roots: [], legacy: false }), "archived");
});

test("search keeps a project when a session title matches", () => {
  const items = [
    {
      path: "/repo",
      name: "repo",
      openedAt: 1,
      groupId: "g",
      roots: [{ path: "/repo", name: "repo", position: 0 }],
      legacy: false,
    },
    {
      path: "/other",
      name: "other",
      openedAt: 2,
      groupId: "o",
      roots: [{ path: "/other", name: "other", position: 0 }],
      legacy: false,
    },
  ];
  const sessions = [
    {
      id: "s1",
      title: "Fix notarization",
      projectPath: "/repo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  ];
  const filtered = filterArchiveItems(items, sessions, "notarization");
  assert.deepEqual(
    filtered.map((item) => item.path),
    ["/repo"],
  );
  assert.equal(projectMatchesQuery(items[0], "notarization"), false);
  assert.equal(sessionMatchesQuery(sessions[0], "notarization"), true);
  assert.equal(sessionMatchesIndexProject(sessions[0], items[0]), true);
  const shown = displayedProjectSessions(sessions, items[0], "notarization");
  assert.equal(shown.sessionSearchMatch, true);
  assert.equal(shown.displayed[0]?.id, "s1");
});

test("the arrow keys walk the rows the user can see", () => {
  const rows = [
    { path: "/a", name: "A", openedAt: 1, groupId: "a", roots: [], legacy: false },
    { path: "/b", name: "B", openedAt: 2, groupId: "b", roots: [], legacy: false },
  ];
  assert.equal(neighborPath(rows, "/a", 1), "/b");
  assert.equal(neighborPath(rows, "/b", 1), "/b");
  assert.equal(neighborPath(rows, "/b", -1), "/a");
  // With nothing open yet the first key press lands on the first row, either
  // direction, and an empty index has nowhere to go.
  assert.equal(neighborPath(rows, null, 1), "/a");
  assert.equal(neighborPath(rows, null, -1), "/a");
  assert.equal(neighborPath([], null, 1), null);
});

test("the index merges durable groups ahead of recents and session seeds", () => {
  const items = buildProjectIndex({
    durableProjects: [
      {
        id: "g1",
        name: "Desktop",
        primaryPath: "/Users/lan/PI-Desktop",
        roots: [
          { path: "/Users/lan/PI-Desktop", name: "PI-Desktop", position: 0 },
          { path: "/Users/lan/docs", name: "docs", position: 1 },
        ],
        lastOpenedAt: 10,
        pinned: false,
      },
    ],
    recents: [{ path: "/Users/lan/PI-Desktop", name: "old", openedAt: 50 }],
    sessionProjects: [{ path: "/tmp/scratch", name: "scratch", updatedAt: 20 }],
    workspace: { path: "/Users/lan/PI-Desktop", name: "Desktop" },
    projectMeta: {
      "/Users/lan/PI-Desktop": { pinned: true },
      "/tmp/scratch": { archived: true },
    },
  });
  assert.equal(items[0]?.groupId, "g1");
  assert.equal(items[0]?.pinned, true);
  assert.equal(items[0]?.name, "Desktop");
  assert.equal(items[0]?.roots.length, 2);
  assert.equal(items[1]?.archived, true);
  assert.equal(shortenPath("/Users/lan/PI-Desktop"), "~/PI-Desktop");
  assert.equal(INITIAL_VISIBLE_SESSION_COUNT, 8);
  assert.ok(sessionTimestamp("2026-01-02T00:00:00.000Z") > 0);
});

test("one row click opens that row's card and closes the open one", () => {
  // Nothing is expanded to begin with, so the first click opens a card.
  assert.equal(nextArchiveOpenPath(null, "/a"), "/a");
  // Any other row takes the open card with it.
  assert.equal(nextArchiveOpenPath("/a", "/b"), "/b");
  // Clicking the open row closes it again. This is the path the index was
  // missing: the click re-selected the row and the card stayed up.
  assert.equal(nextArchiveOpenPath("/a", "/a"), null);
  assert.equal(nextArchiveOpenPath(null, "/a"), "/a");
});

test("verified worktrees share one project row while sessions keep their actual paths", () => {
  const memoryProject = { id: "music-memory", name: "Music", primaryPath: "/repos/music",
    paths: ["/repos/music", "/worktrees/music/review", "/pool/music/slot-3"] };
  const durableProjects = memoryProject.paths.map((path, index) => ({
    id: `group-${index}`, name: index ? "slot-3" : "Music", primaryPath: path,
    roots: [{ path, name: "checkout", position: 0 }], lastOpenedAt: index,
    pinned: false, memoryProject,
  }));
  const items = buildProjectIndex({ durableProjects, recents: [], sessionProjects: [
    { path: "/worktrees/music/review", name: "Music", updatedAt: 5 },
  ], workspace: { path: "/pool/music/slot-3", name: "slot-3", branch: "review" }, projectMeta: {} });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Music");
  assert.equal(items[0].path, "/repos/music");
  assert.deepEqual(items[0].roots, durableProjects[0].roots);
  const sessions = memoryProject.paths.map((projectPath, index) => ({ id: `session-${index}`,
    title: `Task ${index}`, projectPath, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z" }));
  assert.deepEqual(displayedProjectSessions(sessions, items[0], "").related.map(session => session.projectPath),
    memoryProject.paths);
  assert.equal(sessionMatchesIndexProject({ projectPath: "/repos/other" }, items[0]), false);
});

test("matching names do not combine unrelated project rows", () => {
  const durableProjects = ["/repos/music", "/repos/other-music"].map((path, index) => ({
    id: `group-${index}`, name: "Music", primaryPath: path,
    roots: [{ path, name: "Music", position: 0 }], lastOpenedAt: 1, pinned: false,
    memoryProject: { id: `memory-${index}`, name: "Music", primaryPath: path, paths: [path] },
  }));
  const items = buildProjectIndex({ durableProjects, recents: [], sessionProjects: [], projectMeta: {} });
  assert.equal(items.length, 2);
});

test("reused checkout paths do not move historical tasks into another memory project", () => {
  const slot = "/pool/slot-3";
  const durableProjects = [
    { id: "old-group", name: "Old", primaryPath: "/repos/old", roots: [{ path: "/repos/old", name: "Old", position: 0 }],
      lastOpenedAt: 1, pinned: false, memoryProject: { id: "old", name: "Old", primaryPath: "/repos/old", paths: ["/repos/old", slot] } },
    { id: "new-group", name: "New", primaryPath: slot, roots: [{ path: slot, name: "New", position: 0 }],
      lastOpenedAt: 2, pinned: false, memoryProject: { id: "new", name: "New", primaryPath: "/repos/new", paths: ["/repos/new", slot] } },
  ];
  const items = buildProjectIndex({ durableProjects, recents: [], sessionProjects: [], projectMeta: {} });
  const oldProject = items.find((item) => item.memoryProject.id === "old");
  const newProject = items.find((item) => item.memoryProject.id === "new");
  const oldTask = { projectPath: slot, memoryProjectId: "old" };
  const newTask = { projectPath: slot, memoryProjectId: "new" };
  assert.equal(sessionMatchesIndexProject(oldTask, oldProject), true);
  assert.equal(sessionMatchesIndexProject(oldTask, newProject), false);
  assert.equal(sessionMatchesIndexProject(newTask, oldProject), false);
  assert.equal(sessionMatchesIndexProject(newTask, newProject), true);
  assert.equal(sessionMatchesIndexProject({ projectPath: slot }, oldProject), false);
  assert.equal(sessionMatchesIndexProject({ projectPath: slot }, newProject), true);
  assert.equal(sessionMatchesIndexProject(oldTask, { path: slot, roots: newProject.roots }), false);
  assert.equal(sessionMatchesProjectRoots(oldTask, oldProject.roots.map((root) => root.path)), false);
  assert.equal(sessionMatchesProjectRoots(oldTask, newProject.roots.map((root) => root.path)), true);
});
