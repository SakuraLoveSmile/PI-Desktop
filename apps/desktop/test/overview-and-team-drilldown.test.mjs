import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [overviewSource, teamPanelSource, englishLocaleSource, chineseLocaleSource] = await Promise.all([
  readFile(new URL("../src/components/workpanel/OverviewTab.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/workpanel/TeamPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/i18n/src/locales/en/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/i18n/src/locales/zh-CN/index.ts", import.meta.url), "utf8"),
]);

test("OverviewTab renders Expert Team card when session execution profile is team", () => {
  assert.match(overviewSource, /session\?\.executionProfile === "team"/);
  assert.match(overviewSource, /api\.getTeamRoster/);
  assert.match(overviewSource, /api\.getTeamBoard/);
  assert.match(overviewSource, /teamWorkPanelTab/);
  assert.match(overviewSource, /panel\.overview\.teamSection/);
  assert.match(overviewSource, /team\.lead/);
  assert.match(overviewSource, /team\.membersCount/);
  assert.match(overviewSource, /team\.tasksProgress/);
  assert.match(overviewSource, /team\.viewTeam/);
});

test("OverviewTab derives subagent roster and opens subagent tab", () => {
  assert.match(overviewSource, /isDelegationStartTool/);
  assert.match(overviewSource, /delegationIdForMessage/);
  assert.match(overviewSource, /delegateAgentName/);
  assert.match(overviewSource, /delegateTaskDescription/);
  assert.match(overviewSource, /openSubagentTab/);
  assert.match(overviewSource, /panel\.overview\.subagents/);
  assert.match(overviewSource, /panel\.overview\.noSubagents/);
});

test("TeamPanel implements in-panel read-only member and task detail with back button", () => {
  assert.match(teamPanelSource, /TeamMemberDetail/);
  assert.match(teamPanelSource, /TeamTaskDetail/);
  assert.match(teamPanelSource, /team\.memberDetail/);
  assert.match(teamPanelSource, /team\.taskDetail/);
  assert.match(teamPanelSource, /team\.back/);
  assert.match(teamPanelSource, /team\.assignedTasks/);
  assert.match(teamPanelSource, /team\.transcript/);
  assert.match(teamPanelSource, /api\.getSession/);
  assert.match(teamPanelSource, /team-clickable-card/);
});

test("English and Chinese catalogs define all overview, member, and task detail keys", () => {
  const keys = [
    "memberDetail",
    "taskDetail",
    "back",
    "assignedTasks",
    "transcript",
    "noTranscript",
    "noAssignedTasks",
    "openInMain",
    "taskOwner",
    "taskReadiness",
    "teamOverview",
    "lead",
    "membersCount",
    "tasksProgress",
    "viewTeam",
  ];
  for (const key of keys) {
    assert.match(englishLocaleSource, new RegExp(`${key}:`));
    assert.match(chineseLocaleSource, new RegExp(`${key}:`));
  }
});
