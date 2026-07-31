import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [apiSource, appSource, composerSource, settingsSource, commandsSource, storeSource, surfaceSource, transcriptSource, barSource, englishSource, chineseSource] =
  await Promise.all([
    read("./lib/api.ts"),
    read("./App.tsx"),
    read("./components/Composer.tsx"),
    read("./pages/SettingsPage.tsx"),
    read("./lib/commands.ts"),
    read("./stores/app-store.ts"),
    read("./components/ChatSurface.tsx"),
    read("./components/ChatTranscript.tsx"),
    read("./components/PlanApprovalBar.tsx"),
    read("../../../packages/i18n/src/locales/en/index.ts"),
    read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
  ]);
const legacyModeKey = ["mode", "Chat"].join("");
const legacyModeCommand = ["builtin.mode", "chat"].join(".");
const legacyModeLiteral = ["mode:", '"chat"'].join(" ");

test("renderer exposes Agent and Plan as the only operating modes", () => {
  assert.match(composerSource, /mode === "agent" \? "plan" : "agent"/);
  assert.match(composerSource, /settings\.modePlan/);
  assert.match(composerSource, /IconListChecks/);
  assert.match(settingsSource, /\["plan", "settings\.modePlan"\]/);
  assert.match(commandsSource, /case "builtin\.mode\.plan"/);
  for (const source of [composerSource, settingsSource, commandsSource]) {
    assert.doesNotMatch(source, new RegExp(`${legacyModeKey}|${legacyModeCommand}|${legacyModeLiteral}`));
  }
});

test("plan IPC and host events are typed and restored across renderer entry points", () => {
  assert.match(apiSource, /IPC\.invoke\.plansPending/);
  assert.match(apiSource, /IPC\.invoke\.plansResolve/);
  assert.match(apiSource, /IPC\.event\.plansChanged/);
  assert.match(appSource, /api\.onPlansChanged\(handlePlansChanged\)/);
  assert.match(storeSource, /restorePendingPlan: async/);
  assert.match(storeSource, /api\.pendingPlans\(\)/);
  assert.match(storeSource, /void get\(\)\.restorePendingPlan\(id\)/);
  assert.match(storeSource, /handlePlansChanged: \(event\)/);
  assert.match(storeSource, /event\.type === "planning_state"/);
});

test("plan approval sends exact identities and waits for host confirmation", () => {
  assert.match(barSource, /proposalId: proposal\.id/);
  assert.match(barSource, /sessionId: proposal\.sessionId/);
  assert.match(barSource, /turnId: proposal\.turnId/);
  assert.match(barSource, /toolCallId: proposal\.toolCallId/);
  assert.match(barSource, /version: proposal\.version/);
  assert.match(barSource, /action,\n\s+\.\.\.\(action === "approve" && targetPermissionMode/);
  assert.doesNotMatch(barSource, /request_changes/);
  assert.match(barSource, /data-testid="plan-approval-bar"/);
  assert.match(barSource, /role="menuitemradio"/);
  assert.match(barSource, /aria-checked=\{rememberedMode === candidate\}/);
  assert.match(barSource, /ArrowDown.*ArrowUp.*Home.*End/s);
  assert.match(surfaceSource, /approvalPending: Boolean\(activePlan\)/);
  assert.doesNotMatch(transcriptSource, /PlanApprovalCard|plan-approval-card/);
  assert.doesNotMatch(transcriptSource, /\bpendingPlan\b/);
  assert.match(storeSource, /openPlanArtifact/);
  assert.match(storeSource, /fileWorkPanelTab\(relativePath\)/);
  const resolveBlock = storeSource.match(/resolvePlan: async \(resolution\)[\s\S]*?\n  showToast:/)?.[0] ?? "";
  assert.match(resolveBlock, /await api\.resolvePlan\(resolution\)/);
  assert.match(resolveBlock, /get\(\)\.handlePlansChanged/);
  assert.match(resolveBlock, /planApprovalPermissionMode/);
  assert.doesNotMatch(resolveBlock, /finally[\s\S]*pendingPlans/);
});

test("Plan approval labels and Auto file-change warning are locale-backed", () => {
  assert.match(englishSource, /modePlan: "Plan"/);
  assert.match(chineseSource, /modePlan: "规划"/);
  assert.match(englishSource, /approvalRegion: "Plan approval"/);
  assert.match(chineseSource, /approvalRegion: "规划审批"/);
  assert.match(englishSource, /approveAuto: "Approve \(Auto\)"/);
  assert.match(chineseSource, /approveAuto: "批准（全自动）"/);
  assert.match(englishSource, /autoWarning: "Auto runs Bash without asking and may change files\."/);
  assert.match(chineseSource, /autoWarning: "自动模式会直接运行 Bash，且可能修改文件。"/);
  assert.doesNotMatch(englishSource, new RegExp(legacyModeKey));
  assert.doesNotMatch(chineseSource, new RegExp(legacyModeKey));
});
