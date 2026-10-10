import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const file = new URL("../src/features/chat/activity/skill-suggestion-preferences.ts", import.meta.url);
const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file.pathname,
});
const module = { exports: {} };
new Function("exports", "module", outputText)(module.exports, module);
const { SKILL_SUGGESTION_PREFERENCES_KEY: key, MAX_IGNORED_SKILL_SUGGESTIONS: limit,
  skillSuggestionIdentity: identity, readIgnoredSkillSuggestions: read,
  ignoreSkillSuggestion: ignore, isSkillSuggestionIgnored: ignored } = module.exports;
const suggestion = { name: "verify-package-api", description: "Verify the exact package API.", body: "# Verify\n\nInspect installed exports." };
const storage = (initial = null) => {
  let value = initial;
  return { getItem: (requested) => { assert.equal(requested, key); return value; },
    setItem: (requested, next) => { assert.equal(requested, key); value = next; } };
};

test("ignoring persists UI-only identity across reload without retaining suggestion content", () => {
  const store = storage();
  const entry = identity("owner", "answer", suggestion);
  assert.deepEqual(read(store), []);
  assert.equal(ignored(ignore(store, entry), entry), true);
  assert.equal(ignored(read(store), entry), true);
  const saved = store.getItem(key);
  assert.equal(JSON.parse(saved).version, 1);
  assert.equal(saved.includes(suggestion.description), false);
  assert.equal(saved.includes(suggestion.body), false);
});

test("different sessions, source answers and revised same-answer drafts remain visible", () => {
  const store = storage();
  const first = identity("owner", "answer", suggestion);
  ignore(store, first);
  for (const other of [identity("other", "answer", suggestion), identity("owner", "new-answer", suggestion),
    identity("owner", "answer", { ...suggestion, name: "new-skill" }),
    identity("owner", "answer", { ...suggestion, description: "Revised description." }),
    identity("owner", "answer", { ...suggestion, body: "# Revised steps" })]) {
    assert.equal(ignored(read(store), other), false);
  }
});

test("ignore merges current preferences and prunes the oldest bounded entries", () => {
  const store = storage();
  for (let index = 0; index <= limit; index++) ignore(store, identity(`session-${index}`, "answer", suggestion));
  const entries = read(store);
  assert.equal(entries.length, limit);
  assert.equal(ignored(entries, identity("session-0", "answer", suggestion)), false);
  assert.equal(ignored(entries, identity(`session-${limit}`, "answer", suggestion)), true);
  ignore(store, identity(`session-${limit}`, "answer", suggestion));
  assert.equal(read(store).length, limit);
});

test("corrupt, oversized and unsupported preference versions are observable and not overwritten", () => {
  for (const raw of ["not-json", "null", "[]", JSON.stringify({ version: 2, ignored: [] }),
    JSON.stringify({ version: 1, ignored: [{ sessionId: "owner" }] }),
    JSON.stringify({ version: 1, ignored: Array.from({ length: limit + 1 }, () => identity("owner", "answer", suggestion)) }),
    " ".repeat(1024 * 1024 + 1)]) {
    const store = storage(raw);
    assert.throws(() => read(store));
    assert.throws(() => ignore(store, identity("owner", "answer", suggestion)));
    assert.equal(store.getItem(key), raw);
  }
});

test("unavailable reads and failed writes propagate without pretending an ignore succeeded", () => {
  assert.throws(() => read({ getItem: () => { throw new Error("unavailable"); } }), /unavailable/);
  const store = storage();
  store.setItem = () => { throw new Error("quota"); };
  assert.throws(() => ignore(store, identity("owner", "answer", suggestion)), /quota/);
  assert.deepEqual(read(store), []);
});
