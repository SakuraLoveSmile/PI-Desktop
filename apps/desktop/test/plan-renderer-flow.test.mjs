import {
  readStoreModuleSync,
  readStoreSourceSync,
  readComposerSourceSync,
} from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDesktop = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [store, planState, approvalBar, composer, packageJson] =
  await Promise.all([
    readStoreSourceSync(),
    readDesktop("src/lib/plan-mode-state.ts"),
    readDesktop("src/components/PlanApprovalBar.tsx"),
    readComposerSourceSync(),
    readDesktop("package.json"),
  ]);
const eventsSource = readStoreModuleSync("slices/events-slice.ts");
const assistantTurn = await readDesktop("src/features/chat/transcript/AssistantTurn.tsx");

test("rejection clears only the live gate and a later proposal replaces the checkpoint", () => {
  const hostPlanBlock = eventsSource.slice(eventsSource.indexOf("handlePlansChanged: (event) =>"));
  assert.match(hostPlanBlock, /mergePlanCheckpoint/);
  assert.match(hostPlanBlock, /planCheckpoints: checkpoint/);
  assert.match(hostPlanBlock, /const pendingPlans = activeProposal/);
  assert.match(hostPlanBlock, /\n\s+pendingPlans,/);
  assert.match(hostPlanBlock, /withoutRecordKey\(state\.pendingPlans, event\.sessionId\)/);
  assert.match(planState, /if \(event\.proposal\) return event\.proposal/);
  assert.match(planState, /current\.status === "pending" && event\.state === "planning"/);
});

test("terminal proposals and execution states stay session-scoped and readable", () => {
  for (const status of ["rejected", "expired", "interrupted", "approved", "queued", "running"]) {
    assert.match(planState, new RegExp(`"${status}"`));
  }
  assert.match(store, /planCheckpoints: Record<string, PlanProposal>/);
  assert.match(store, /planHistory: Record<string, PlanProposal\[\]>/);
  assert.match(assistantTurn, /turnProposals\.map\(\(proposal\) => <PlanApprovalBar/);
  assert.match(approvalBar, /data-execution-state=\{proposal\.executionState \|\| ""\}/);
  assert.match(approvalBar, /scheduleState/);
  assert.doesNotMatch(store, /planApprovalPermissionMode/);
});

test("each pending proposal restores the remembered approval choice", () => {
  assert.match(approvalBar, /useState<GlobalPermissionMode>\(\s*readPlanApprovalMode\(\)/);
  assert.match(approvalBar, /setApprovalMode\(readPlanApprovalMode\(\)\)/);
  assert.match(approvalBar, /rememberPlanApprovalMode\(selectedMode\)/);
  assert.match(approvalBar, /\}, \[proposal\.id\]\);/);
  assert.doesNotMatch(approvalBar, /state\.settings|planApprovalPermissionMode/);
});

test("pending review retains editable input and routes send to revision", () => {
  assert.match(composer, /contentEditable=\{!inputBlocked\}/);
  assert.match(composer, /aria-readonly=\{inputBlocked\}/);
  assert.match(composer, /enabled: !inputBlocked/);
  assert.match(composer, /disabled=\{controlsBlocked\}/);
  assert.match(composer, /const controlsBlocked = nativeSession;/);
  assert.match(composer, /const sendBlocked = pasting \|\| nativeInputBlocked;/);
  assert.match(composer, /return revisePlan\(/);
  assert.match(store, /planDraftsDirty: Record<string, boolean>/);
  assert.match(store, /pendingPlans\[resolution\.sessionId\]/);
});

test("plan revision keeps uploaded files on first send and retry", async () => {
  const interaction = await readDesktop("src/stores/slices/interaction-slice.ts");
  assert.match(composer, /return revisePlan\(\{[\s\S]*?draft: snapshot,/);
  assert.match(interaction, /revisePlan: \(input\)[\s\S]*?draft: input\.draft/);
  assert.match(interaction, /get\(\)\.sendPrompt\(intent\.content, intent\.draft, sessionId/);
  assert.match(interaction, /retryPlanRevision: \(proposal\)[\s\S]*?startRevision\(proposal\.id, proposal\.sessionId, intent\)/);
});

test("the normal desktop test command includes source-level renderer contracts", () => {
  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts.test, /test\/\*\.test\.mjs/);
  assert.ok(
    existsSync(new URL("./plan-mode-source-contract.test.mjs", import.meta.url)),
    "the source-level contract test must live under test/ so the glob picks it up",
  );
});
