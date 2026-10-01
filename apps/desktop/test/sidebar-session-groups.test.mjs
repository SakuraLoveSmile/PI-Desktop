import assert from "node:assert/strict";
import test from "node:test";
import {
  groupSidebarSessions,
  getGlobalPinnedSessions,
  groupSidebarSessionsByTime,
  groupSidebarSessionGroupsByTime,
  groupTeamSessions,
  teamMemberRowTitle,
  normalizeProjectPath,
  partitionPinnedSidebarSessionGroups,
  projectPathsForNewSessions,
  sidebarSessionGroupUpdatedAt,
  sortSidebarSessionGroups,
  visibleSidebarSessionGroups,
  sessionMatchesProject,
} from "../src/lib/sidebar-session-groups.ts";

function session(overrides) {
  return {
    id: "session-1",
    title: "Session",
    projectPath: undefined,
    mode: "agent",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T11:00:00.000Z",
    ...overrides,
  };
}

test("shows only the current project and path-less temporary sessions", () => {
  const groups = groupSidebarSessions(
    [
      session({ id: "current", projectPath: "/work/current" }),
      session({ id: "other", projectPath: "/work/other" }),
      session({ id: "temporary" }),
    ],
    "/work/current/",
  );

  assert.deepEqual(
    groups.projectSessions.map((item) => item.id),
    ["current"],
  );
  assert.deepEqual(
    groups.temporarySessions.map((item) => item.id),
    ["temporary"],
  );
});

test("normalizes separators and trailing slashes for project matching", () => {
  assert.equal(normalizeProjectPath("C:\\work\\project\\"), "C:/work/project");
  assert.equal(
    sessionMatchesProject(session({ projectPath: "C:\\work\\project" }), "C:/work/project/"),
    true,
  );
});

test("strips Windows extended-length path prefix", () => {
  // Forward-slash variant stored by older DB versions
  assert.equal(normalizeProjectPath("//?/C:/Users/mi/project"), "C:/Users/mi/project");
  assert.equal(normalizeProjectPath("//?/D:/work/app"), "D:/work/app");
  // Backslash variant from canonicalize
  assert.equal(normalizeProjectPath("\\\\?\\C:\\Users\\mi\\project"), "C:/Users/mi/project");
  // Drive-root path (trailing slash preserved as single slash)
  assert.equal(normalizeProjectPath("//?/C:/"), "C:/");
  assert.equal(normalizeProjectPath("\\\\?\\C:\\"), "C:/");
  // Non-drive UNC paths are left intact (stripped of leading slashes by the normalize logic)
  assert.equal(normalizeProjectPath("//?/UNC/server/share"), "//?/UNC/server/share");
});

test("treats blank project paths as temporary", () => {
  const groups = groupSidebarSessions(
    [session({ id: "blank", projectPath: "   " }), session({ id: "missing" })],
    "/work/current",
  );

  assert.deepEqual(
    groups.temporarySessions.map((item) => item.id),
    ["blank", "missing"],
  );
});

test("finds only newly imported project-bound sessions", () => {
  assert.deepEqual(
    projectPathsForNewSessions(
      [session({ id: "existing", projectPath: "/work/archived" })],
      [
        session({ id: "existing", projectPath: "/work/archived" }),
        session({ id: "new-a", projectPath: "/work/archived/" }),
        session({ id: "new-b", projectPath: "C:\\work\\new" }),
        session({ id: "temporary", projectPath: " " }),
      ],
    ),
    ["/work/archived", "C:/work/new"],
  );
});

test("global pins include closed projects and temporary sessions without date buckets", () => {
  const sessions = [
    session({ id: "today", projectPath: "/open", updatedAt: "2026-09-13T01:00:00Z" }),
    session({ id: "old-pin", projectPath: "/open", updatedAt: "2025-01-01T00:00:00Z" }),
    session({ id: "closed-pin", projectPath: "/closed", updatedAt: "2024-01-01T00:00:00Z" }),
    session({ id: "temporary-pin" }),
  ];
  const meta = Object.fromEntries(sessions.slice(1).map((row) => [row.id, { pinned: true }]));
  const pins = getGlobalPinnedSessions(sessions, meta, {}, false);
  assert.deepEqual(
    pins.map((row) => row.id),
    ["old-pin", "closed-pin", "temporary-pin"],
  );
  for (const now of [new Date(2026, 8, 13, 12), new Date(2026, 8, 14, 12)]) {
    const ids = new Set(pins.map((row) => row.id));
    const history = groupSidebarSessionsByTime(
      sessions.filter((row) => !ids.has(row.id)),
      now,
    );
    const rendered = [...pins, ...history.flatMap((group) => group.sessions)].map((row) => row.id);
    assert.deepEqual(rendered, ["old-pin", "closed-pin", "temporary-pin", "today"]);
    assert.equal(new Set(rendered).size, sessions.length);
  }
  assert.equal(sessions[1].projectPath, "/open", "pinning must not rebind a conversation");
});

test("global pins honor session and project archives including normalized paths", () => {
  const sessions = [
    session({ id: "visible", projectPath: "/open" }),
    session({ id: "session-archived" }),
    session({ id: "project-archived", projectPath: "C:\\work\\archived\\" }),
    session({ id: "legacy", pinned: true, archived: true }),
  ];
  const meta = {
    visible: { pinned: true },
    "session-archived": { pinned: true, archived: true },
    "project-archived": { pinned: true },
  };
  const projects = { "C:/work/archived": { archived: true } };
  assert.deepEqual(
    getGlobalPinnedSessions(sessions, meta, projects, false).map((row) => row.id),
    ["visible"],
  );
  assert.equal(getGlobalPinnedSessions(sessions, meta, projects, true).length, 4);
  assert.equal(
    getGlobalPinnedSessions([], meta, projects, false).length,
    0,
    "stale preferences cannot restore deleted rows",
  );
  assert.equal(
    getGlobalPinnedSessions(sessions, { ...meta, visible: { pinned: false } }, projects, false)
      .length,
    0,
  );
});

test("ordinary date groups retain their order after pins are removed", () => {
  const date = (day) => new Date(2026, 8, day, 1).toISOString();
  const rows = [
    session({ id: "old", updatedAt: "2025-01-01T00:00:00Z" }),
    session({ id: "week", updatedAt: date(10) }),
    session({ id: "today", updatedAt: date(13) }),
    session({ id: "yesterday", updatedAt: date(12) }),
    session({ id: "fortnight", updatedAt: date(3) }),
  ];
  assert.deepEqual(
    groupSidebarSessionsByTime(rows, new Date(2026, 8, 13, 12)).map((group) => group.group),
    ["today", "yesterday", "thisWeek", "older14d", "archived"],
  );
});

test("groups members by host lead relation and keeps legacy sessions flat", () => {
  const groups = groupTeamSessions([
    session({ id: "legacy" }),
    session({ id: "member-late", createdAt: "2026-07-27", team: { role: "member", teamSessionId: "lead", memberName: "Researcher" } }),
    session({ id: "lead", team: { role: "lead", teamSessionId: "lead" } }),
    session({ id: "member-early", createdAt: "2026-07-26", team: { role: "member", teamSessionId: "lead" } }),
    session({ id: "orphan", team: { role: "member", teamSessionId: "archived-lead" } }),
  ]);
  assert.deepEqual(groups.map((group) => group.kind === "team" ? group.lead.id : group.session.id), [
    "lead", "legacy", "orphan",
  ]);
  assert.deepEqual(groups[0].members.map((member) => member.id), ["member-early", "member-late"]);
  assert.equal(groups[2].parentSessionId, "archived-lead");
});

test("team history pagination counts top-level groups rather than member rows", () => {
  const rows = [
    session({ id: "lead", team: { role: "lead", teamSessionId: "lead" } }),
    session({ id: "member", team: { role: "member", teamSessionId: "lead" } }),
    ...Array.from({ length: 10 }, (_, index) => session({ id: `single-${index}` })),
  ];
  const groups = groupTeamSessions(rows);
  const page = visibleSidebarSessionGroups(groups, false, 10);
  assert.equal(page.visible.length, 10);
  assert.equal(page.hiddenCount, 1);
  assert.equal(page.visible[0].kind, "team");
  assert.equal(page.visible[0].members.length, 1);
});

test("pinned lead remains one group and pinned members stay a single global row", () => {
  const groups = groupTeamSessions([
    session({ id: "lead", team: { role: "lead", teamSessionId: "lead" } }),
    session({ id: "member-pin", team: { role: "member", teamSessionId: "lead" } }),
    session({ id: "member-normal", team: { role: "member", teamSessionId: "lead" } }),
  ]);
  const memberPin = partitionPinnedSidebarSessionGroups(groups, new Set(["member-pin"]));
  assert.deepEqual(memberPin.pinned.map((group) => group.kind === "team" ? group.lead.id : group.session.id), ["member-pin"]);
  assert.equal(memberPin.pinned[0].parentSessionId, "lead");
  assert.equal(memberPin.history[0].kind, "team");
  assert.equal(memberPin.history[0].members.length, 2, "the full team count is retained");
  assert.deepEqual([...memberPin.pinnedSessionIds], ["member-pin"]);

  const leadPin = partitionPinnedSidebarSessionGroups(groups, new Set(["lead"]));
  assert.deepEqual(leadPin.pinned.map((group) => group.kind === "team" ? group.lead.id : group.session.id), ["lead"]);
  assert.equal(leadPin.pinned[0].members.length, 2);
  assert.equal(leadPin.history.length, 0);
  assert.equal(leadPin.pinnedSessionIds.size, 3);
});

test("recent team ordering follows member activity while other sorts preserve lead order", () => {
  const groups = groupTeamSessions([
    session({ id: "older-lead", updatedAt: "2026-07-20T00:00:00Z", team: { role: "lead", teamSessionId: "older-lead" } }),
    session({ id: "active-member", updatedAt: "2026-07-29T00:00:00Z", team: { role: "member", teamSessionId: "older-lead" } }),
    session({ id: "newer-lead", updatedAt: "2026-07-25T00:00:00Z", team: { role: "lead", teamSessionId: "newer-lead" } }),
  ]);
  const compareParent = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  assert.deepEqual(sortSidebarSessionGroups(groups, compareParent, true).map((group) => group.kind === "team" ? group.lead.id : group.session.id), ["older-lead", "newer-lead"]);
  assert.equal(sidebarSessionGroupUpdatedAt(groups[0]), "2026-07-29T00:00:00Z");
  assert.deepEqual(sortSidebarSessionGroups(groups, () => 0, false).map((group) => group.kind === "team" ? group.lead.id : group.session.id), ["older-lead", "newer-lead"]);
});

test("keeps a team together across date buckets and dissolves to reachable rows when the lead is absent", () => {
  const rows = [
    session({ id: "lead", updatedAt: "2026-09-01T00:00:00Z", team: { role: "lead", teamSessionId: "lead" } }),
    session({ id: "member", updatedAt: "2026-09-13T00:00:00Z", team: { role: "member", teamSessionId: "lead" } }),
  ];
  const [team] = groupTeamSessions(rows);
  assert.equal(team.kind, "team");
  const buckets = groupSidebarSessionGroupsByTime([team], new Date(2026, 8, 13, 12));
  assert.deepEqual(buckets.map((bucket) => bucket.group), ["today"]);

  const afterLeadRemoval = groupTeamSessions([rows[1]]);
  assert.equal(afterLeadRemoval.length, 1);
  assert.equal(afterLeadRemoval[0].kind, "session");
  assert.equal(afterLeadRemoval[0].session.id, "member");
  assert.equal(afterLeadRemoval[0].parentSessionId, "lead");
});

test("grouped member labels spend row width on role and display name without replacing a custom title", () => {
  const member = { title: 'Teammate: researcher', team: { role: 'member', memberName: 'researcher', teamSessionId: 'lead' } };
  assert.equal(teamMemberRowTitle(member, 'Researcher Alex'), 'Researcher Alex');
  assert.equal(teamMemberRowTitle({ ...member, title: 'My review notes' }, 'Researcher Alex'), 'My review notes');
  assert.equal(teamMemberRowTitle(member), 'Teammate: researcher');
  assert.equal(teamMemberRowTitle({ ...member, team: { role: 'lead' } }, 'Lead Alex'), 'Teammate: researcher');
});
