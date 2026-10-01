import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isKnownWorkPanelTab,
  teamWorkPanelTab,
} from "../src/lib/work-panel-tabs.ts";

const [teamPanelSource, workPanelSource, tabsSource, englishLocaleSource, chineseLocaleSource] = await Promise.all([
  readFile(
    new URL("../src/components/workpanel/TeamPanel.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/workpanel/WorkPanel.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/lib/work-panel-tabs.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../packages/i18n/src/locales/en/index.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../packages/i18n/src/locales/zh-CN/index.ts", import.meta.url),
    "utf8",
  ),
]);

const supportedLocaleSources = await Promise.all(
  ["de", "es", "fr", "ko", "pt-BR", "tr"].map((locale) =>
    readFile(
      new URL(`../../../packages/i18n/src/locales/${locale}/index.ts`, import.meta.url),
      "utf8",
    ),
  ),
);

test("work-panel-tabs supports team tab kind", () => {
  assert.match(tabsSource, /\|\s*"team"/);
  const tab = teamWorkPanelTab("session-123");
  assert.equal(tab.kind, "team");
  assert.equal(tab.resource, "session-123");
  assert.equal(tab.id, "team:session-123");
  assert.ok(isKnownWorkPanelTab(tab));
});

test("TeamPanel consumes the shared snapshot and renders resume and panorama actions", () => {
  assert.match(teamPanelSource, /useTeamSnapshot\(teamSessionId\)/);
  assert.doesNotMatch(teamPanelSource, /api\.getTeamRoster|api\.getTeamBoard/);
  assert.match(teamPanelSource, /api\.teamResume/);
  assert.match(teamPanelSource, /team-panel-header/);
  assert.match(teamPanelSource, /<TeamStatusBadge snapshot=\{snapshot\}/);
  assert.match(teamPanelSource, /team\.resumeButton/);
});

test("TeamPanel relies on one current TeamSnapshot instead of racing independent DTO requests", () => {
  assert.match(teamPanelSource, /const \{ snapshot, loading, error: snapshotError, refresh, lastSuccessAt \} = useTeamSnapshot/);
  assert.doesNotMatch(teamPanelSource, /as unknown as Promise/);
  assert.doesNotMatch(teamPanelSource, /setInterval\(/);
  assert.match(teamPanelSource, /teamSessionId/);
  assert.match(teamPanelSource, /scopeOverlaps/);
  assert.doesNotMatch(teamPanelSource, /projection\?\.team/);
});

test("TeamPanel renders write-scope overlap warnings and member roster", () => {
  assert.match(teamPanelSource, /team-warning-box/);
  assert.match(teamPanelSource, /team\.warnings/);
  assert.match(teamPanelSource, /team\.roster/);
  assert.match(teamPanelSource, /team-member-card/);
  assert.match(teamPanelSource, /team\.openSession/);
  assert.match(teamPanelSource, /onSelectSession/);
  assert.match(teamPanelSource, /MemberIdentity/);
  assert.match(teamPanelSource, /projectMemberIdentities/);
});

test("TeamPanel renders a compact searchable board and opens full task detail", () => {
  assert.match(teamPanelSource, /team\.board/);
  assert.match(teamPanelSource, /CompactTeamBoard/);
  assert.match(teamPanelSource, /team-task-board/);
  assert.match(teamPanelSource, /TeamTaskProgress/);
  assert.match(teamPanelSource, /TeamTaskDetail/);
  assert.match(teamPanelSource, /initialTaskId\?: string/);
  assert.match(teamPanelSource, /initialView\?: "aggregate" \| "board" \| "task" \| "panorama"/);
});

test("TeamPanel localizes DTO values and data consistency errors", () => {
  for (const key of [
    "staleData",
    "scopeOverlapCount",
    "openOverlapTask",
    "blockedBy",
    "scopes",
    "readiness",
    "context",
    "phase",
    "taskStatus",
  ]) {
    assert.match(englishLocaleSource, new RegExp(`${key}:`));
    assert.match(chineseLocaleSource, new RegExp(`${key}:`));
    for (const localeSource of supportedLocaleSources) {
      assert.match(localeSource, new RegExp(`(?:"${key}"|${key}):`));
    }
  }
  assert.match(teamPanelSource, /team\.staleData/);
  assert.match(teamPanelSource, /team\.scopeOverlapCount/);
  assert.match(teamPanelSource, /team\.taskStatus/);
  assert.match(teamPanelSource, /team\.readiness/);
  assert.match(teamPanelSource, /team\.phase/);
  assert.match(teamPanelSource, /team\.context/);
  assert.doesNotMatch(teamPanelSource, />Ready</);
  assert.doesNotMatch(teamPanelSource, />Blocked</);
});

test("WorkPanel mounts TeamPanel for team tabs and registers team tool", () => {
  assert.match(workPanelSource, /<TeamPanel/);
  assert.match(workPanelSource, /activeTab\?\.kind === "team"/);
  assert.match(workPanelSource, /team:\s*IconUsers/);
  assert.match(workPanelSource, /teamWorkPanelTab/);
  assert.match(workPanelSource, /localTeamSessionId\(activeSession\)/);
});
