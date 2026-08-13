import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composer = await readFile(
  new URL("../src/components/Composer.tsx", import.meta.url),
  "utf8",
);

test("composer keeps draft text and file references isolated per session", () => {
  assert.match(composer, /const HOME_DRAFT_KEY = "__home__"/);
  assert.match(composer, /function draftKeyForSession\(sessionId: string \| null \| undefined\)/);
  assert.match(composer, /new Map<string, ComposerDraftSnapshot>\(\)/);
  assert.match(composer, /const previousKey = draftKeyRef\.current/);
  assert.match(composer, /draftCacheRef\.current\.set\(previousKey, \{[\s\S]*?fileReferences:/);
  assert.match(composer, /const nextDraft = draftCacheRef\.current\.get\(draftKey\)/);
  assert.match(composer, /setValue\(nextDraft\?\.text \?\? ""\)/);
  assert.match(composer, /setFileReferences\([\s\S]*?createFileReference\(/);
});

test("composer handles home drafts, deleted sessions, and async sends by key", () => {
  assert.match(composer, /key !== HOME_DRAFT_KEY && key !== draftKey && !sessionIds\.has\(key\)/);
  assert.match(composer, /const clearDraftForKey = \(key: string\)/);
  assert.match(composer, /draftKeyForSession\(useAppStore\.getState\(\)\.activeSessionId\)/);
  assert.match(composer, /const submittedDraftKey = draftKey/);
  assert.match(composer, /clearDraftForKey\(submittedDraftKey\)/);
  assert.doesNotMatch(composer, /if \(accepted\) clearDraft\(\);/);
});
