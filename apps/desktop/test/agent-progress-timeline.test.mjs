import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, transcript, timeline, styles] = await Promise.all([
  read("../src/stores/app-store.ts"),
  read("../src/components/ChatTranscript.tsx"),
  read("../src/components/AgentProgressTimeline.tsx"),
  loadStyles(),
]);

test("agent progress follows real lifecycle events", () => {
  assert.match(store, /event\.type === "compaction_start" \? "working" : "understanding"/);
  assert.match(store, /updateAgentProgress\([\s\S]*?"working"[\s\S]*?event\.toolName/);
  assert.match(store, /updateAgentProgress\([\s\S]*?"checking"[\s\S]*?toolName/);
  assert.match(store, /message\.content \|\| ""\)\.trim\(\)\s*\n\s*\? "finalizing"/);
  assert.match(store, /agentProgress: withoutRecordKey\(s\.agentProgress/);
});

test("transcript renders a labelled four-stage progress timeline", () => {
  assert.match(transcript, /<AgentProgressTimeline/);
  assert.match(transcript, /waitingForPermission=\{Boolean\(pendingPermission\)\}/);
  assert.match(timeline, /const PHASES[\s\S]*?"understanding"[\s\S]*?"working"[\s\S]*?"checking"[\s\S]*?"finalizing"/);
  assert.match(timeline, /data-testid="agent-progress"/);
  assert.match(timeline, /role="status"/);
  assert.match(timeline, /aria-live="polite"/);
  assert.match(styles, /\.agent-progress\s*\{/);
  assert.match(styles, /\.agent-progress-steps\s*\{[\s\S]*?repeat\(4/);
});
