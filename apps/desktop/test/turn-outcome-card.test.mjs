import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, transcript, outcome, styles] = await Promise.all([
  read("../src/stores/app-store.ts"),
  read("../src/components/ChatTranscript.tsx"),
  read("../src/components/TurnOutcomeCard.tsx"),
  loadStyles(),
]);

test("terminal agent events retain a session-scoped result for the transcript", () => {
  assert.match(store, /latestTurnResults: Record<string, AgentTurnResult>/);
  assert.match(store, /status: event\.type === "error" \? "failed" : "completed"/);
  assert.match(store, /turnId:\s*\n\s*envelope\.turnId \?\?/);
  assert.match(store, /error\.code === "TURN_ABORTED"[\s\S]*?withoutRecordKey\(s\.latestTurnResults/);
  assert.match(transcript, /<TurnOutcomeCard[\s\S]*?result=\{latestTurnResult\}/);
});

test("outcome card exposes completion evidence and recovery actions", () => {
  assert.match(outcome, /data-testid="turn-outcome-card"/);
  assert.match(outcome, /resultComplete/);
  assert.match(outcome, /resultFilesChanged/);
  assert.match(outcome, /retryLastPrompt/);
  assert.match(outcome, /openWorkPanelTab\(toolWorkPanelTab\("review"\)\)/);
  assert.match(outcome, /focusComposer/);
  assert.match(styles, /\.turn-outcome-card\s*\{/);
  assert.match(styles, /\.turn-outcome-card\.failed\s*\{/);
});
