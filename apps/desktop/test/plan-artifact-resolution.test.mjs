import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

const [resolver, store, approvalBar, events, sessions, overview] = await Promise.all([
  read("../src/lib/plan-artifact.ts"),
  read("../src/stores/app-store.ts"),
  read("../src/components/PlanApprovalBar.tsx"),
  read("../src/stores/slices/events-slice.ts"),
  read("../src/stores/slices/session-slice.ts"),
  read("../src/components/workpanel/OverviewTab.tsx"),
]);

test("temporary Goal artifacts resolve against the owning session scratch root", () => {
  assert.match(resolver, /api\.getSession\(proposal\.sessionId\)/);
  assert.match(resolver, /api\.getSessionScratchPath\(proposal\.sessionId\)/);
  assert.match(resolver, /proposal\.artifact\?\.workspaceKind !== "scratch"/);
  assert.match(resolver, /path:\s*`\${root}\/\${relativePath/);
  assert.match(resolver, /if \(!session\) \{/);
  assert.match(resolver, /temporary: true/);
});

test("artifact opens only on explicit card or Overview action with proposal ownership", () => {
  assert.doesNotMatch(store, /openPlanArtifact\(/);
  assert.match(approvalBar, /resolvePlanArtifactPath\(proposal\)/);
  assert.match(approvalBar, /fileWorkPanelTab\(resolved\.path\)/);
  assert.match(approvalBar, /openWorkPanelTabForSession\(\s*proposal\.sessionId/);
  assert.match(overview, /resolvePlanArtifactPath\(item\.proposal\)/);
  assert.match(overview, /fileWorkPanelTab\(resolved\.path\)/);
  assert.doesNotMatch(events, /void openPlanArtifact\(/);
  assert.doesNotMatch(sessions, /void openPlanArtifact\(/);
});

test("artifact resolution failures are visible and do not open a guessed path", () => {
  assert.match(approvalBar, /showToast\(/);
  assert.match(overview, /showToast\(/);
  assert.match(approvalBar, /variant: "error"/);
  assert.doesNotMatch(resolver, /getState\(\)\.activeSessionId/);
});
