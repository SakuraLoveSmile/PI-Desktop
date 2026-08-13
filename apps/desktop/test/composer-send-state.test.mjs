import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, composer] = await Promise.all([
  read("../src/stores/app-store.ts"),
  read("../src/components/Composer.tsx"),
]);

test("composer send/stop button follows the visible session's run state", () => {
  const composerRight = composer.match(/<div className="composer-right">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  // Plan mode widened the stop condition: the button switches on `runActive`,
  // which folds an in-flight plan execution into the session's own `isRunning`.
  // Assert the derivation too, so the control keeps tracking the visible
  // session's run state rather than some unrelated global flag.
  assert.match(composerRight, /\{runActive \? \(/);
  assert.match(composer, /const runActive = isRunning \|\| executionActive;/);
  assert.match(composer, /const isRunning = useAppStore\(\(s\) => s\.isRunning\);/);
  assert.match(composerRight, /stop-btn/);
  assert.match(composerRight, /send-btn/);
  assert.match(composerRight, /onClick=\{\(\) => void abort\(\)\}/);
  assert.match(composer, /const inputBlocked = approvalPending \|\| pasting;/);
  assert.match(composer, /const controlsBlocked = approvalPending;/);
  assert.match(composer, /readOnly=\{inputBlocked\}/);
  assert.match(composer, /disabled=\{controlsBlocked\}/);
  assert.match(composer, /sendBlocked[\s\S]*\(!modelReady/);
  assert.doesNotMatch(composer, /const inputBlocked = [^;]*runActive/);
});

test("running session configuration is queued for the next turn", () => {
  assert.match(store, /pendingSessionConfigurations = new Map/);
  assert.match(
    store,
    /get\(\)\.runningSessions\[sessionId\][\s\S]*pendingSessionConfigurations\.set\(sessionId, config\)/,
  );
  assert.match(store, /event\.type === "agent_end"[\s\S]*flushPendingSessionConfiguration\(envelope\.sessionId\)/);
});

test("creating a session resets the run flag to the new session's own state", () => {
  const newSession = store.match(
    /newSession: async [\s\S]*?\n  forkSession: async/,
  )?.[0] ?? "";
  assert.ok(newSession.length > 0, "newSession implementation not found");
  // A draft reuse delegates to selectSession, which already derives
  // isRunning from the destination session's run state.
  assert.match(
    newSession,
    /await get\(\)\.selectSession\(session\.id, \{ navigationIntent: intent \}\)/,
  );
  // A fresh session commits with its own run state (false when the created
  // session is not running), so a turn still streaming in the previous
  // session cannot leave the new session stuck on the stop button.
  assert.match(
    newSession,
    /isRunning: s\.runningSessions\[created\.session\.id\] \?\? false/,
  );
});

test("cross-session agent_end cannot clear the active session's running flag", () => {
  const handleEvents = store.match(
    /handleAgentEvent: \(envelope\) => \{[\s\S]*?\n  setPage:/,
  )?.[0] ?? "";
  assert.match(handleEvents, /envelope\.sessionId !== get\(\)\.activeSessionId/);
  // The cross-session branch returns before the active-session switch that
  // sets `isRunning: false` on agent_end, so only the session-scoped
  // runningSessions entry is updated for other sessions.
  const crossSession = handleEvents.match(
    /if \(envelope\.sessionId !== get\(\)\.activeSessionId\) \{[\s\S]*?\n    \}/,
  )?.[0] ?? "";
  assert.ok(crossSession.length > 0);
  assert.match(crossSession, /return;/);
  const agentEnd = handleEvents.match(/case "agent_end":\s*set\(\{ isRunning: false \}\)/);
  assert.ok(agentEnd, "active-session agent_end clears isRunning");
});

test("mode slash prefixes send the trailing prompt and retain failed drafts", () => {
  const submit = composer.match(
    /const submit = async \(\) => \{[\s\S]*?\n  \};\n\n  const composerAc/,
  )?.[0] ?? "";
  assert.ok(submit.length > 0, "composer submit implementation not found");
  assert.match(submit, /const commandBody =/);
  assert.match(submit, /const isModeCommand =/);
  assert.match(
    submit,
    /if \(isModeCommand && commandBody\)[\s\S]*?await runPaletteCommand\(command\.id\);[\s\S]*?sendPrompt\(\s*commandBody,\s*draftSnapshot\(visibleCommandBody\)[\s\S]*?if \(accepted\) clearDraftForKey\(submittedDraftKey\);/,
  );
  assert.match(
    submit,
    /const accepted = await sendPrompt\(content, draftSnapshot\(value\)\);[\s\S]*?if \(accepted\) clearDraftForKey\(submittedDraftKey\);/,
  );
  assert.match(store, /draft\?: ComposerDraftSnapshot/);
  const sendPrompt = store.match(
    /sendPrompt: async \(content, draft\)[\s\S]*?\n  compactContext:/,
  )?.[0] ?? "";
  assert.match(sendPrompt, /return false;/);
  assert.match(sendPrompt, /await api\.prompt\(\{ sessionId, content \}\);[\s\S]*?return true;/);
});
