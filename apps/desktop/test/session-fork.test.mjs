import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("session fork is wired through protocol, main, API, store, and sidebar", () => {
  const protocol = read("../../../packages/shared/src/protocol.ts");
  const main = read("../electron/main/index.ts");
  const api = read("../src/lib/api.ts");
  const store = read("../src/stores/app-store.ts");
  const sidebar = read("../src/components/Sidebar.tsx");

  assert.match(
    protocol,
    /sessionFork:\s*"pi-desktop\/session\/fork"/,
  );
  assert.match(protocol, /PROTOCOL_VERSION = 9/);
  assert.match(main, /handle\(\s*IPC\.invoke\.sessionFork,/);
  assert.match(main, /activeTurns\.has\(sessionId\)/);
  assert.match(main, /"session\.fork"/);
  assert.match(
    api,
    /forkSession:\s*\(sessionId: string, title\?: string, throughMessageId\?: string\)/,
  );
  assert.match(store, /forkSession:\s*async \(id\)/);
  assert.match(store, /const \{ messages, \.\.\.summary \} = result\.session/);
  assert.match(store, /activeSessionId: summary\.id/);
  assert.match(sidebar, /data-action="fork-session"/);
  assert.match(sidebar, /disabled=\{Boolean\(runningSessions\[session\.id\]\)\}/);
  assert.match(sidebar, /<IconBranch size=\{14\} \/>/);
  assert.match(sidebar, /\[role="menuitem"\]:not\(:disabled\)/);
});

test("assistant response fork reuses isolated session snapshots", () => {
  const main = read("../electron/main/index.ts");
  const store = read("../src/stores/app-store.ts");
  const transcript = read("../src/components/ChatTranscript.tsx");

  assert.match(main, /throughMessageId/);
  assert.match(store, /forkAssistantMessage:\s*async \(messageId\)/);
  assert.match(store, /api\.forkSession\([\s\S]*?messageId/);
  assert.match(transcript, /forkAssistantMessage\(actionMessage\.id\)/);
  assert.match(transcript, /chat\.forkResponse/);
});

test("session fork labels are localized", () => {
  const english = read("../../../packages/i18n/src/locales/en/index.ts");
  const chinese = read("../../../packages/i18n/src/locales/zh-CN/index.ts");

  assert.match(english, /createBranch:\s*"Branch from here"/);
  assert.match(english, /branchTitle:\s*"\{\{title\}\} \(branch\)"/);
  assert.match(chinese, /createBranch:\s*"从此处分支"/);
  assert.match(chinese, /branchTitle:\s*"\{\{title\}\}（分支）"/);
});

test("fork actions populate sessionHistory and cache transcript (D-fork-msg-loss)", () => {
  const store = read("../src/stores/app-store.ts");

  // forkSession must set sessionHistory for the new session
  assert.match(
    store,
    /forkSession[\s\S]*?set\(\(current\)[\s\S]*?sessionHistory:\s*\{[\s\S]*?\[summary\.id\]:\s*\{\s*messageStart:\s*0,\s*hasMoreBefore:\s*false\s*\}/,
    "forkSession must set sessionHistory[summary.id] = { messageStart: 0, hasMoreBefore: false }",
  );

  // forkAssistantMessage must set sessionHistory for the new session
  assert.match(
    store,
    /forkAssistantMessage[\s\S]*?set\(\(current\)[\s\S]*?sessionHistory:\s*\{[\s\S]*?\[summary\.id\]:\s*\{\s*messageStart:\s*0,\s*hasMoreBefore:\s*false\s*\}/,
    "forkAssistantMessage must set sessionHistory[summary.id] = { messageStart: 0, hasMoreBefore: false }",
  );

  // Both must cache the forked transcript so re-selection uses it immediately
  const forkSessionBlock = store.slice(
    store.indexOf("forkSession: async (id)"),
    store.indexOf("forkAssistantMessage: async"),
  );
  assert.match(
    forkSessionBlock,
    /cacheSessionTranscript\(summary\.id,\s*messages/,
    "forkSession must call cacheSessionTranscript after set()",
  );

  const forkAssistantBlock = store.slice(
    store.indexOf("forkAssistantMessage: async"),
    store.indexOf("configureActiveSession", store.indexOf("forkAssistantMessage: async")),
  );
  assert.match(
    forkAssistantBlock,
    /cacheSessionTranscript\(summary\.id,\s*messages/,
    "forkAssistantMessage must call cacheSessionTranscript after set()",
  );
});
