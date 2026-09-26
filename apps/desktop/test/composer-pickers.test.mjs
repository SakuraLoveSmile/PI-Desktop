import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [profilePickerSource, contractPickerSource, toolbarSource, composerSource, sessionSliceSource] =
  await Promise.all([
    readFile(
      new URL(
        "../src/features/chat/composer/ComposerExecutionProfilePicker.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/chat/composer/ComposerContractPicker.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/features/chat/composer/ComposerToolbar.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/components/Composer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/stores/slices/session-slice.ts", import.meta.url),
      "utf8",
    ),
  ]);

test("ComposerExecutionProfilePicker renders two distinct options with notice", () => {
  assert.match(profilePickerSource, /chat\.profileAgent/);
  assert.match(profilePickerSource, /chat\.profileAgentDesc/);
  assert.match(profilePickerSource, /chat\.profileTeam/);
  assert.match(profilePickerSource, /chat\.profileTeamDesc/);
  assert.match(profilePickerSource, /chat\.profileTeamNotice/);
  assert.match(profilePickerSource, /role="menuitemradio"/);
  assert.match(profilePickerSource, /canSwitchToStandard/);
  assert.match(profilePickerSource, /IconUsers/);
  assert.match(profilePickerSource, /IconBot/);
});

test("ComposerContractPicker renders None, Plan, Goal contracts", () => {
  assert.match(contractPickerSource, /chat\.contractNone/);
  assert.match(contractPickerSource, /chat\.contractNoneDesc/);
  assert.match(contractPickerSource, /settings\.modePlan/);
  assert.match(contractPickerSource, /chat\.contractPlanDesc/);
  assert.match(contractPickerSource, /settings\.modeGoal/);
  assert.match(contractPickerSource, /chat\.contractGoalDesc/);
  assert.match(contractPickerSource, /role="menuitemradio"/);
  assert.match(contractPickerSource, /ModeIcon/);
});

test("ComposerToolbar mounts both pickers and manages menu coordination", () => {
  assert.match(toolbarSource, /<ComposerExecutionProfilePicker/);
  assert.match(toolbarSource, /<ComposerContractPicker/);
  assert.match(toolbarSource, /profileOpen/);
  assert.match(toolbarSource, /contractOpen/);
  assert.match(toolbarSource, /executionProfile/);
});

test("Composer derives executionProfile and passes it to ComposerToolbar", () => {
  assert.match(composerSource, /const executionProfile:\s*ExecutionProfile/);
  assert.match(composerSource, /activeSession\?\.executionProfile/);
  assert.match(composerSource, /draftConfiguration\?\.executionProfile/);
  assert.match(composerSource, /<ComposerToolbar[\s\S]*executionProfile=\{executionProfile\}/);
});

test("session-slice handles executionProfile and pauses team when switching to standard", () => {
  assert.match(sessionSliceSource, /executionProfile:\s*config\.executionProfile/);
  assert.match(sessionSliceSource, /config\.executionProfile === "standard"/);
  assert.match(sessionSliceSource, /active\?\.executionProfile === "team"/);
  assert.match(sessionSliceSource, /api\.getTeamRoster/);
  assert.match(sessionSliceSource, /api\.teamPause/);
  assert.match(sessionSliceSource, /chat\.profileBlockedByRunningTeammate/);
});
