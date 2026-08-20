import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [store, sidebar, chatSurface, styles] = await Promise.all([
  read("../src/stores/app-store.ts"),
  read("../src/components/Sidebar.tsx"),
  read("../src/components/ChatSurface.tsx"),
  loadStyles(),
]);

test("session reads are coalesced, bounded, and never globally serialized", () => {
  assert.match(store, /const SESSION_TRANSCRIPT_CACHE_LIMIT = 20/);
  assert.match(store, /const sessionDetailLoads = new Map/);
  assert.match(store, /const active = sessionDetailLoads\.get\(id\)/);
  assert.match(store, /const detailPromise = loadSessionDetail\(id\)/);
  assert.doesNotMatch(store, /sessionSelectionQueue/);
});

test("only the latest navigation may commit a loaded transcript", () => {
  const selection = store.match(
    /selectSession: async[\s\S]*?\n  newSession: async/,
  )?.[0] ?? "";
  assert.match(selection, /set\(\{ selectingSessionId: id, page: "chat" \}\)/);
  assert.match(selection, /navigationIntentIsCurrent\(intent\)/);
  assert.match(selection, /commitSelection\(detail\.session\?\.messages \?\? \[\], false\)/);
  assert.ok(
    selection.indexOf("const detailPromise = loadSessionDetail(id)") <
      selection.indexOf("await alignWorkspaceLatest(summary.projectPath)"),
  );
});

test("sidebar owns feedback and prefetch while store owns workspace alignment", () => {
  assert.match(sidebar, /const selectedSessionId = selectingSessionId \?\? activeSessionId/);
  assert.match(sidebar, /onPointerEnter=\{\(\) => scheduleSessionPrefetch\(session\.id\)\}/);
  assert.match(sidebar, /onFocus=\{\(\) => void prefetchSession\(session\.id\)/);
  const projectSelection = sidebar.match(
    /const selectProjectSession[\s\S]*?\n  const selectTemporarySession/,
  )?.[0] ?? "";
  assert.match(projectSelection, /await selectSession\(session\.id\)/);
  assert.doesNotMatch(projectSelection, /await selectProject\(|activateProject\(/);
});

test("changed session trees render through a stable deferred busy frame", () => {
  assert.match(chatSurface, /useDeferredValue\(activeSessionId\)/);
  assert.match(chatSurface, /previousTranscriptViewRef/);
  assert.match(chatSurface, /aria-busy=\{sessionSwitching\}/);
  assert.match(chatSurface, /session-switch-progress/);
  assert.match(styles, /\.chat-surface\.session-switching[\s\S]*?pointer-events: none/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.session-switch-progress > span[\s\S]*?animation: none/,
  );
});
