import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [apiSource, appSource, composerSource, settingsSource, commandsSource, storeSource, surfaceSource, transcriptSource, cardSource, englishSource, chineseSource] =
  await Promise.all([
    read("./lib/api.ts"),
    read("./App.tsx"),
    read("./components/Composer.tsx"),
    read("./pages/SettingsPage.tsx"),
    read("./lib/commands.ts"),
    read("./stores/app-store.ts"),
    read("./components/ChatSurface.tsx"),
    read("./components/ChatTranscript.tsx"),
    read("./components/PlanApprovalCard.tsx"),
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
  assert.match(cardSource, /proposalId: proposal\.id/);
  assert.match(cardSource, /sessionId: proposal\.sessionId/);
  assert.match(cardSource, /turnId: proposal\.turnId/);
  assert.match(cardSource, /toolCallId: proposal\.toolCallId/);
  assert.match(cardSource, /action,\n\s+\.\.\.\(action === "approve" \? \{ targetPermissionMode \}/);
  assert.match(cardSource, /action === "request_changes" && !trimmedFeedback/);
  assert.match(cardSource, /data-testid="plan-approval-card"/);
  assert.match(surfaceSource, /pendingPlan: activePlan/);
  assert.match(transcriptSource, /<PlanApprovalCard key=\{pendingPlan\.id\}/);
  const resolveBlock = storeSource.match(/resolvePlan: async \(resolution\)[\s\S]*?\n  showToast:/)?.[0] ?? "";
  assert.match(resolveBlock, /await api\.resolvePlan\(resolution\)/);
  assert.match(resolveBlock, /get\(\)\.handlePlansChanged/);
  assert.doesNotMatch(resolveBlock, /finally[\s\S]*pendingPlans/);
});

test("Plan labels and Auto file-change warning are locale-backed", () => {
  assert.match(englishSource, /modePlan: "Plan"/);
  assert.match(chineseSource, /modePlan: "规划"/);
  assert.match(englishSource, /autoWarning: "Auto runs Bash without asking and may change files\."/);
  assert.match(chineseSource, /autoWarning: "自动模式会直接运行 Bash，且可能修改文件。"/);
  assert.doesNotMatch(englishSource, new RegExp(legacyModeKey));
  assert.doesNotMatch(chineseSource, new RegExp(legacyModeKey));
});
