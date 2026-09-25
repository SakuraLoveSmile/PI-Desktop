import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

const [resolver, store, approvalBar, events, sessions] = await Promise.all([
  read("../src/lib/plan-artifact.ts"),
  read("../src/stores/app-store.ts"),
  read("../src/components/PlanApprovalBar.tsx"),
  read("../src/stores/slices/events-slice.ts"),
  read("../src/stores/slices/session-slice.ts"),
]);

test("temporary Goal artifacts resolve against the owning session scratch root", () => {
  assert.match(resolver, /api\.getSession\(proposal\.sessionId\)/);
  assert.match(resolver, /api\.getSessionScratchPath\(proposal\.sessionId\)/);
  assert.match(resolver, /proposal\.artifact\?\.workspaceKind !== "scratch"/);
  assert.match(resolver, /path:\s*`\${root}\/\${relativePath/);
  assert.match(resolver, /if \(!session\) \{/);
  assert.match(resolver, /temporary: true/);
});

test("automatic and manual artifact openers retain proposal session ownership", () => {
  assert.match(store, /resolvePlanArtifactPath\(proposal\)/);
  assert.match(store, /resolved\.temporary\s*\?\s*fileWorkPanelTab\(resolved\.path\)/s);
  assert.match(store, /openWorkPanelTabForSession\(\s*proposal\.sessionId/);
  assert.match(approvalBar, /resolvePlanArtifactPath\(proposal\)/);
  assert.match(approvalBar, /resolved\.temporary\s*\?\s*fileWorkPanelTab\(resolved\.path\)/s);
  assert.match(approvalBar, /openWorkPanelTabForSession\(\s*proposal\.sessionId/);
  assert.match(events, /void openPlanArtifact\(/);
  assert.match(sessions, /void openPlanArtifact\(/);
});

test("artifact resolution failures are visible and do not open a guessed path", () => {
  assert.match(store, /showToast\(/);
  assert.match(approvalBar, /showToast\(/);
  assert.match(store, /variant: "error"/);
  assert.match(approvalBar, /variant: "error"/);
  assert.doesNotMatch(resolver, /getState\(\)\.activeSessionId/);
});
