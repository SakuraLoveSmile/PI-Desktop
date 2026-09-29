import { readComposerModule, readComposerSource, readStoreModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_INPUT_HISTORY_MAX,
  COMPOSER_INPUT_HISTORY_SESSIONS_MAX,
  loadComposerInputHistory,
  rememberComposerInput,
} from "../src/lib/composer-input-history.ts";
import {
  planHistoryNavigation,
  runHistoryStep,
  stepHistoryIndex,
} from "../src/features/chat/composer/input-history.ts";

const KEY = "pi.desktop.composerInputHistory";

function installStorage({ failWrites = false } = {}) {
  const data = new Map();
  const storage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) throw new Error("QuotaExceededError");
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return data;
}

test.afterEach(() => {
  delete globalThis.localStorage;
});

const snap = (text, fileReferences = []) => ({ text, fileReferences });
const texts = (sessionId) => loadComposerInputHistory(sessionId).map((entry) => entry.text);

function createHarness(history, { sessionId = "s1" } = {}) {
  const state = { entries: [], index: null, applied: [], consumed: [] };
  const run = (direction, { draftEmpty, edited = false } = {}) => {
    const result = runHistoryStep({
      entries: state.entries,
      index: state.index,
      keptReferences: [],
      direction,
      draftEmpty,
      edited,
      loadHistory: () => (history === "store" ? loadComposerInputHistory(sessionId) : history),
      createReference: (reference) => ({ ...reference, attached: true }),
      effects: {
        applyDraft: (text, references, caret) => state.applied.push({ text, references, caret }),
      },
    });
    state.entries = result.entries;
    state.index = result.index;
    state.consumed.push(result.consumed);
    return result;
  };
  return { state, run };
}

test("records per conversation, newest-first, collapsing consecutive duplicates", () => {
  installStorage();
  rememberComposerInput("s1", snap("a"));
  rememberComposerInput("s1", snap("b"));
  rememberComposerInput("s1", snap("b"));
  assert.deepEqual(texts("s1"), ["b", "a"]);
});

test("a conversation never recalls another conversation's prompts", () => {
  installStorage();
  rememberComposerInput("s1", snap("from A"));
  rememberComposerInput("s2", snap("from B", [{ path: "C:\\w\\b.ts", name: "b.ts" }]));
  assert.deepEqual(texts("s1"), ["from A"]);
  assert.deepEqual(texts("s2"), ["from B"]);
  assert.deepEqual(texts("s3"), []);
  assert.deepEqual(texts(""), []);
  rememberComposerInput("s2", snap("from A"));
  assert.deepEqual(texts("s2"), ["from A", "from B"]);
});

test("skips empty submissions and caps one conversation's history", () => {
  installStorage();
  rememberComposerInput("s1", snap("   "));
  assert.equal(loadComposerInputHistory("s1").length, 0);
  for (let i = 0; i < COMPOSER_INPUT_HISTORY_MAX + 5; i += 1) rememberComposerInput("s1", snap(`m${i}`));
  const history = loadComposerInputHistory("s1");
  assert.equal(history.length, COMPOSER_INPUT_HISTORY_MAX);
  assert.equal(history[0].text, `m${COMPOSER_INPUT_HISTORY_MAX + 4}`);
});

test("keeps a bounded number of conversations, newest written first", () => {
  installStorage();
  for (let i = 0; i < COMPOSER_INPUT_HISTORY_SESSIONS_MAX; i += 1) rememberComposerInput(`s${i}`, snap(`m${i}`));
  rememberComposerInput("s0", snap("again"));
  rememberComposerInput(`s${COMPOSER_INPUT_HISTORY_SESSIONS_MAX}`, snap("newest session"));
  assert.deepEqual(texts("s0"), ["again", "m0"]);
  assert.deepEqual(texts("s1"), []);
  assert.deepEqual(texts(`s${COMPOSER_INPUT_HISTORY_SESSIONS_MAX}`), ["newest session"]);
});

test("corrupted or blocked storage yields an empty history", () => {
  const data = installStorage();
  data.set(KEY, "{not json");
  assert.deepEqual(loadComposerInputHistory("s1"), []);
  data.set(KEY, JSON.stringify({ sessions: "nope" }));
  assert.deepEqual(loadComposerInputHistory("s1"), []);
  data.set(KEY, JSON.stringify([{ text: "legacy array shape" }]));
  assert.deepEqual(loadComposerInputHistory("s1"), []);
  data.set(KEY, JSON.stringify({ sessions: [{ sessionId: "s1", entries: [{ text: 1 }, { text: "ok", fileReferences: [] }] }] }));
  assert.deepEqual(texts("s1"), ["ok"]);
  delete globalThis.localStorage;
  assert.deepEqual(loadComposerInputHistory("s1"), []);
  installStorage({ failWrites: true });
  assert.doesNotThrow(() => rememberComposerInput("s1", snap("x")));
});

test("browse index walks older, clamps, and unwinds", () => {
  let index = null;
  const seen = [];
  for (const direction of ["older", "older", "older", "newer", "newer"]) {
    index = stepHistoryIndex(index, direction, 2);
    seen.push(index);
  }
  assert.deepEqual(seen, [0, 1, 1, 0, null]);
  assert.equal(stepHistoryIndex(null, "newer", 2), null);
});

test("an empty draft starts a browse and edited drafts stay native", () => {
  assert.deepEqual(planHistoryNavigation({ index: null, direction: "older", length: 3, draftEmpty: true }), { action: "load", index: 0 });
  assert.deepEqual(planHistoryNavigation({ index: 2, direction: "older", length: 3, draftEmpty: false }), { action: "keep" });
  assert.deepEqual(planHistoryNavigation({ index: null, direction: "older", length: 5, draftEmpty: false }), { action: "ignore" });
});

test("recall walks this conversation's history and unwinds to empty", () => {
  installStorage();
  rememberComposerInput("s1", snap("m1"));
  rememberComposerInput("s1", snap("m2"));
  rememberComposerInput("s1", snap("m3"));
  const { state, run } = createHarness("store");
  run("older", { draftEmpty: true });
  run("older", { draftEmpty: false });
  run("older", { draftEmpty: false });
  run("older", { draftEmpty: false });
  run("newer", { draftEmpty: false });
  run("newer", { draftEmpty: false });
  run("newer", { draftEmpty: false });
  assert.deepEqual(state.applied.map((step) => step.text), ["m3", "m2", "m1", "m2", "m3", ""]);
  assert.equal(state.index, null);
});

test("a recalled entry brings its own references back", () => {
  const entry = { text: "see the shot", fileReferences: [{ path: "C:\\scratch\\s1\\a.png", name: "a.png", kind: "image" }] };
  const { state, run } = createHarness([entry]);
  run("older", { draftEmpty: true });
  assert.equal(state.applied[0].references[0].path, entry.fileReferences[0].path);
});

test("keydown order keeps IME and autocomplete ahead of history", async () => {
  const source = await readComposerModule("ComposerInput.tsx");
  const start = source.indexOf("onKeyDown={(event: ReactKeyboardEvent");
  const handler = source.slice(start, source.indexOf("        />", start));
  const ime = handler.indexOf("event.nativeEvent.isComposing");
  const autocomplete = handler.indexOf("composerAc.hasItems");
  const history = handler.indexOf("onHistoryNavigate(");
  const send = handler.search(/event\.key === "Enter"\s*&&\s*!event\.shiftKey\s*&&\s*\(enterToSend/);
  assert.ok(ime > -1 && autocomplete > ime);
  assert.ok(history > autocomplete);
  assert.ok(send > history);
});

test("composer wires recall and accepted-send recording", async () => {
  const composer = await readComposerSource();
  const hook = await readComposerModule("hooks/useComposerInputHistory.ts");
  assert.match(hook, /runHistoryStep\(\{/);
  assert.match(composer, /onHistoryNavigate=\{inputHistory\.navigate\}/);
  assert.match(composer, /recordHistory: inputHistory\.record/);
  assert.match(composer, /submit=\{submitFromComposer\}/);
  assert.match(
    hook,
    /applyDraft: \(text, references, caret\) => \{[\s\S]*?invalidatePromptEnhancement\(\);[\s\S]*?draft\.applyEditorDraft\(text, \[\.\.\.references\], caret\);/,
  );
});

test("sendPrompt keeps Plan revision options while reporting acceptance", async () => {
  const source = await readStoreModule("slices/queue-slice.ts");
  assert.match(source, /sendPrompt: async \(content, draft, requestedSessionId, options\)/);
  assert.match(source, /options\?\.onAccepted/);
  const submit = await readComposerModule("hooks/useComposerSubmit.ts");
  assert.match(submit, /onAccepted: captureAcceptedSession/);
  assert.match(submit, /recordHistory\?:/);
});
