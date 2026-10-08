import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  buildTeamTaskRows,
  deriveTeamLeadVisualState,
  filterTeamTaskRows,
  localTeamSessionId,
  projectMemberIdentities,
  selectOverviewTaskRows,
  taskStateLabelKey,
  memberFocusTask,
  localizedTeamSnapshotError,
} from "../src/lib/team-presentation.ts";

test("member focus selects current work with strict ownership and stable creation ties", () => {
  const owner = member("researcher", "member-1");
  const owned = (id, status, date, extra = {}) => task(id, status, date, { ownerSessionId: "member-1", ...extra });
  const pending = owned("pending", "pending", "2026-01-01");
  const running = owned("running", "in_progress", "2026-01-02");
  const latest = owned("latest", "completed", "2026-01-03", { updatedAt: "2026-01-09" });
  assert.equal(memberFocusTask(owner, [latest, pending, running]), running);
  assert.equal(memberFocusTask(owner, [latest, pending]), pending);
  assert.equal(memberFocusTask(owner, [owned("older", "failed", "2026-01-04"), latest]), latest);
  const named = owned("named", "in_progress", "2026-01-01", { ownerSessionId: null, ownerMemberName: "researcher" });
  const other = owned("other", "in_progress", "2026-01-01", { ownerSessionId: "member-2", ownerMemberName: "researcher" });
  assert.equal(memberFocusTask(owner, [other, named]), named);
  assert.equal(memberFocusTask(owner, [other, { ...named, deleted: true }]), undefined);
  const earlier = owned("a", "in_progress", "2026-01-02");
  const later = owned("b", "in_progress", "2026-01-02");
  assert.equal(memberFocusTask(owner, [later, earlier]), earlier);
  assert.equal(memberFocusTask(owner, []), undefined);
});

test("snapshot errors localize only the existing domain error codes", () => {
  const translate = (key) => `localized:${key}`;
  for (const code of ["TEAM_DISSOLVED", "TEAM_SCOPE_MISMATCH"]) {
    assert.equal(localizedTeamSnapshotError(code, translate), `localized:team.snapshotErrors.${code}`);
  }
  assert.equal(localizedTeamSnapshotError("read failed", translate), "read failed");
  assert.equal(localizedTeamSnapshotError("", translate), "");
});

test("Team progress presents numbered tasks, state labels and extra activity in one disclosure", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { TeamTaskProgress } = await server.ssrLoadModule("/src/components/workpanel/team/TeamTaskProgress.tsx");
    const { TaskStateGlyph } = await server.ssrLoadModule("/src/components/workpanel/team/TaskStateGlyph.tsx");
    for (const [state, glyph] of Object.entries({
      pending: "circle", in_progress: "circle-arrow-right", blocked: "circle-dashed",
      completed: "circle-check", failed: "circle-x", cancelled: "circle-slash",
    })) {
      const glyphHtml = renderToStaticMarkup(createElement(TaskStateGlyph, { state }));
      assert.match(glyphHtml, new RegExp(`data-state="${state}" aria-hidden="true"`));
      assert.match(glyphHtml, new RegExp(`lucide-${glyph}"`));
    }
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: { team: {
      taskProgress: "Task progress", numberedTask: "Task {{number}}: {{subject}}",
      openTaskWithStatus: "Open task {{subject}} ({{status}})",
      waitingForDependencies: "Waiting for dependencies", roles: { researcher: "Researcher" },
    } } } } });
    const rows = buildTeamTaskRows([
      task("blocked", "pending", "2026-01-01", { ownerSessionId: "alex" }),
    ], [member("researcher", "alex", { presentation: { role: "researcher", displayName: "Alex" } })], [
      { taskId: "blocked", isReady: false, unresolvedBlockedBy: ["missing"] },
    ], true);
    const render = (expanded) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
      createElement(TeamTaskProgress, { rows, completed: 0, total: 1, expanded,
        onToggle() {}, onOpenTask() {}, onOpenPanorama() {}, onOpenBoard() {},
        extra: createElement("p", null, "Lead activity"),
      })));
    const html = render(true);
    assert.match(html, /data-completed="0" data-total="1"/);
    assert.doesNotMatch(html, /team-progress-group-toggle/);
    assert.match(html, /Task 1: Task blocked/);
    assert.match(html, /Open task Task blocked \(Waiting for dependencies\)/);
    assert.match(html, /data-state="blocked"/);
    assert.match(html, /width="20" height="20"/);
    assert.match(html, /Researcher Alex/);
    assert.match(html, /Lead activity/);
    assert.doesNotMatch(html, /team-progress-count/);
    assert.match(render(false), /class="team-progress-body" hidden=""/);
    assert.equal(rows[0].owner.paused, true);
    const overview = await readFile(new URL("../src/components/workpanel/OverviewTab.tsx", import.meta.url), "utf8");
    assert.match(overview, /buildTeamTaskRows\(teamData.tasks, teamData.members, teamData.readiness, teamData.paused\)/);
    assert.match(overview, /extra=\{progressContent\}/);
    assert.match(overview, /!isTeam && \(/);
  } finally {
    await server.close();
  }
});

test("taskStateLabelKey shares localized labels for all six task states", () => {
  for (const state of ["pending", "in_progress", "completed", "failed", "cancelled"]) {
    assert.equal(taskStateLabelKey(state), `team.taskStatus.${state}`);
  }
  assert.equal(taskStateLabelKey("blocked"), "team.waitingForDependencies");
});

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
