import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, transcript, messagesStyles, proseStyles, en, zh] =
  await Promise.all([
    read("../src/stores/app-store.ts"),
    read("../src/components/ChatTranscript.tsx"),
    read("../src/styles/messages.css"),
    read("../src/styles/prose.css"),
    read("../../../packages/i18n/src/locales/en/index.ts"),
    read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
  ]);

test("active turns keep the lower transcript surface clear", () => {
  assert.doesNotMatch(transcript, /AgentProgressTimeline|WorkingIndicator|agent-progress/);
  assert.match(transcript, /<PermissionCard/);
  assert.doesNotMatch(store, /AgentProgress|agentProgress|updateAgentProgress/);
  assert.doesNotMatch(messagesStyles, /\.agent-progress\s*\{/);
  assert.doesNotMatch(proseStyles, /\.working-indicator\s*\{|\.shimmer-text\s*\{/);
  assert.doesNotMatch(
    en,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
  assert.doesNotMatch(
    zh,
    /progressUnderstanding|progressWorking|progressChecking|progressFinalizing|progressWaiting/,
  );
});
