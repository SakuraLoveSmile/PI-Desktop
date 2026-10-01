import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  subagentDetailSource,
  agentPanoramaSource,
  viewportSource,
  overviewTabSource,
  teamPanelSource,
  messagesCssSource,
  agentPanoramaCssSource,
  globalsCssSource,
  enLocaleSource,
  zhLocaleSource,
] = await Promise.all([
  readFile(new URL("../src/features/chat/transcript/SubagentDetail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/workpanel/AgentPanorama.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/workpanel/agent-panorama-viewport.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/workpanel/OverviewTab.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/workpanel/TeamPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/messages.css", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/agent-panorama.css", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/i18n/src/locales/en/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../packages/i18n/src/locales/zh-CN/index.ts", import.meta.url), "utf8"),
]);

test("SubagentDetail renders compact Task progress card with panorama button and task rows", () => {
  // Card header and title
  assert.match(subagentDetailSource, /subagent-tasks-card/);
  assert.match(subagentDetailSource, /chat\.taskProgress/);
  assert.match(subagentDetailSource, /chat\.viewPanorama/);
  assert.match(subagentDetailSource, /overviewWorkPanelTab\("panorama"\)/);

  // Filters actual delegations
  assert.match(subagentDetailSource, /isDelegationActivityItem/);
  assert.match(subagentDetailSource, /summarizeSubagentActivity/);

  // Compact rows with agent, task, status, and click-to-open subagent tab
  assert.match(subagentDetailSource, /subagent-tasks-row/);
  assert.match(subagentDetailSource, /delegateAgentName/);
  assert.match(subagentDetailSource, /delegateTaskDescription/);
  assert.match(subagentDetailSource, /openSubagentTab/);
});

test("AgentPanorama implements zoom, fit, reset, pan, and coordinate geometry", () => {
  // Bounded zoom 50% to 150% in 0.1 steps
  assert.match(viewportSource, /MIN_ZOOM = 0\.5/);
  assert.match(viewportSource, /MAX_ZOOM = 1\.5/);
  assert.match(agentPanoramaSource, /zoomBy\(0\.1\)/);

  // Layout math: root centered at top, children rows of at most 3
  assert.match(viewportSource, /Math\.min\(childIds\.length, 3\)/);
  assert.match(viewportSource, /PANORAMA_NODE_WIDTH = 304/);
  assert.match(viewportSource, /PANORAMA_ROOT_CHILD_GAP = 80/);

  // SVG Bezier connectors
  assert.match(agentPanoramaSource, /M \$\{rootCenterX\} \$\{rootBottomY\} C/);
  assert.match(agentPanoramaSource, /agent-panorama-edges-layer/);

  // Key controls and actions
  assert.match(agentPanoramaSource, /onClick={fit}/);
  assert.match(agentPanoramaSource, /onClick={reset}/);
  assert.match(agentPanoramaSource, /onBack/);
  assert.match(agentPanoramaSource, /onSelectNode/);
  assert.match(agentPanoramaSource, /is-panning/);
});

test("OverviewTab integrates AgentPanorama and toggles between overview and panorama views", () => {
  assert.match(overviewTabSource, /AgentPanorama/);
  assert.match(overviewTabSource, /viewMode/);
  assert.match(overviewTabSource, /resource === "panorama"/);
  assert.match(overviewTabSource, /subagents\.map/);
  assert.match(overviewTabSource, /openSubagentTab/);
});

test("TeamPanel integrates AgentPanorama with lead root and member children", () => {
  assert.match(teamPanelSource, /AgentPanorama/);
  assert.match(teamPanelSource, /view\.kind === "panorama"/);
  assert.match(teamPanelSource, /team\.lead/);
  assert.match(teamPanelSource, /roster\.map/);
  assert.match(teamPanelSource, /navigate\(\{ kind: "member", memberSessionId \}\)/);
  assert.match(teamPanelSource, /setView\(next \?\? \{ kind: "aggregate" \}\)/);
});

test("CSS rules include agent-panorama import and compact task progress styles", () => {
  assert.match(globalsCssSource, /@import "\.\/agent-panorama\.css";/);
  assert.match(messagesCssSource, /\.subagent-tasks-card/);
  assert.match(messagesCssSource, /\.subagent-tasks-header/);
  assert.match(messagesCssSource, /\.subagent-tasks-row/);
  assert.match(agentPanoramaCssSource, /\.agent-panorama/);
  assert.match(agentPanoramaCssSource, /width:\s*304px;/);
  assert.match(agentPanoramaCssSource, /\.agent-panorama-edge/);
});

test("Locales define all panorama and compact progress keys", () => {
  const chatKeys = ["taskProgress", "viewPanorama", "subagentProgressFinished"];
  const teamKeys = [
    "panoramaTitle",
    "viewPanorama",
    "zoomIn",
    "zoomOut",
    "zoomFit",
    "zoomReset",
  ];

  for (const key of chatKeys) {
    assert.match(enLocaleSource, new RegExp(`${key}:`));
    assert.match(zhLocaleSource, new RegExp(`${key}:`));
  }

  for (const key of teamKeys) {
    assert.match(enLocaleSource, new RegExp(`${key}:`));
    assert.match(zhLocaleSource, new RegExp(`${key}:`));
  }
});
