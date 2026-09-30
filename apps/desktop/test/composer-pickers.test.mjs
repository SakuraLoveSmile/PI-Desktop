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

test("ComposerContractPicker renders compact indicator for active mode", () => {
  assert.match(contractPickerSource, /settings\.modePlan/);
  assert.match(contractPickerSource, /settings\.modeGoal/);
  assert.match(contractPickerSource, /ModeIcon/);
  assert.match(contractPickerSource, /(?:effectiveMode|mode) === ["']agent["']/);
  assert.match(contractPickerSource, /displayMode/);
});

test("ComposerToolbar mounts profile, model, mode indicator, and plus menu", () => {
  assert.match(toolbarSource, /<ComposerPlusMenu/);
  assert.match(toolbarSource, /<ComposerExecutionProfilePicker/);
  assert.match(toolbarSource, /<ComposerModelPicker/);
  assert.match(toolbarSource, /<ComposerContractPicker/);
  assert.match(toolbarSource, /profileOpen/);
  assert.match(toolbarSource, /plusOpen/);
  assert.match(toolbarSource, /executionProfile/);
});

test("Composer derives executionProfile and passes it to ComposerToolbar", () => {
  assert.match(composerSource, /const executionProfile:\s*ExecutionProfile/);
  assert.match(composerSource, /activeSession\?\.executionProfile/);
  assert.match(composerSource, /draftConfiguration\?\.executionProfile/);
  assert.match(composerSource, /<ComposerToolbar[\s\S]*executionProfile=\{executionProfile\}/);
  assert.match(composerSource, /const displayMode:\s*Mode/);
  assert.match(composerSource, /isActivePlanExecution\(planCheckpoint\)/);
  assert.match(composerSource, /displayMode=\{displayMode\}/);
  assert.match(toolbarSource, /displayMode=\{displayMode\}/);
});

test("session-slice handles executionProfile and pauses team when switching to standard", () => {
  assert.match(sessionSliceSource, /executionProfile:\s*config\.executionProfile/);
  assert.match(sessionSliceSource, /config\.executionProfile === "standard"/);
  assert.match(sessionSliceSource, /active\?\.executionProfile === "team"/);
  assert.match(sessionSliceSource, /api\.getTeamRoster/);
  assert.match(sessionSliceSource, /api\.teamPause/);
  assert.match(sessionSliceSource, /chat\.profileBlockedByRunningTeammate/);
});

test("displayMode derives executionKind during active plan-as-goal execution and reverts after completion", () => {
  const deriveDisplayMode = ({ activeSessionId, planCheckpoint, mode }) => {
    const isExecutionActive =
      planCheckpoint?.executionState === "queued" ||
      planCheckpoint?.executionState === "running";
    return planCheckpoint?.sessionId === activeSessionId && isExecutionActive
      ? (planCheckpoint.executionKind ?? planCheckpoint.kind)
      : mode;
  };

  const activeSessionId = "session-1";

  // 1. Plan approved as Goal while running
  const runningPlanAsGoal = {
    sessionId: "session-1",
    kind: "plan",
    executionKind: "goal",
    executionState: "running",
  };
  assert.strictEqual(
    deriveDisplayMode({ activeSessionId, planCheckpoint: runningPlanAsGoal, mode: "agent" }),
    "goal",
  );

  // 2. Native Goal running
  const runningNativeGoal = {
    sessionId: "session-1",
    kind: "goal",
    executionState: "running",
  };
  assert.strictEqual(
    deriveDisplayMode({ activeSessionId, planCheckpoint: runningNativeGoal, mode: "agent" }),
    "goal",
  );

  // 3. Execution completed -> reverts to configured mode
  const completedGoal = {
    sessionId: "session-1",
    kind: "plan",
    executionKind: "goal",
    executionState: "completed",
  };
  assert.strictEqual(
    deriveDisplayMode({ activeSessionId, planCheckpoint: completedGoal, mode: "agent" }),
    "agent",
  );

  // 4. Scheduled but not executing -> does not falsely show active execution
  const scheduledGoal = {
    sessionId: "session-1",
    kind: "plan",
    executionKind: "goal",
    scheduleState: "scheduled",
  };
  assert.strictEqual(
    deriveDisplayMode({ activeSessionId, planCheckpoint: scheduledGoal, mode: "agent" }),
    "agent",
  );

  // 5. Stale checkpoint from prior session -> does not affect active session
  const otherSessionGoal = {
    sessionId: "session-2",
    kind: "plan",
    executionKind: "goal",
    executionState: "running",
  };
  assert.strictEqual(
    deriveDisplayMode({ activeSessionId, planCheckpoint: otherSessionGoal, mode: "agent" }),
    "agent",
  );
});
