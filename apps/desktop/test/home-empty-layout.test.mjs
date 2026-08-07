import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [chatSurface, styles, checklist] = await Promise.all([
  read("../src/components/ChatSurface.tsx"),
  loadStyles(),
  read("../src/components/OnboardingChecklist.tsx"),
]);

test("empty home uses a single scrollable stack instead of dual-grow portals", () => {
  assert.match(chatSurface, /className="home-main-content" data-testid="home-empty"/);
  assert.match(chatSurface, /className="home-scroll"/);
  assert.match(chatSurface, /className="home-stack-inner"/);
  assert.match(chatSurface, /<OnboardingChecklist \/>/);
  assert.match(chatSurface, /<div className="home-composer-wrap">/);
  assert.doesNotMatch(
    chatSurface,
    /HomeQuickActions|HomeSuggestions|home-quick-actions|home-suggestion-card|home-suggestions-block|home-upper|home-lower|home-suggestions-portal/,
  );

  assert.match(styles, /\.home-main-content \{[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.home-scroll \{[\s\S]*?overflow-y:\s*auto;/);
  // Auto block margins center the stack when it fits and degrade to
  // top-aligned scrolling on overflow; justify-content:center would clip
  // the top of overflowing content.
  assert.match(
    styles,
    /\.home-stack-inner \{[\s\S]*?flex-direction:\s*column;[\s\S]*?margin:\s*auto;/,
  );
  assert.doesNotMatch(
    styles.match(/\.home-stack-inner \{[^}]*\}/s)?.[0] ?? "",
    /^\s*justify-content:\s*center;/m,
  );
  assert.doesNotMatch(
    styles,
    /\.home-suggestion|\.home-upper \{|\.home-lower \{|\.home-suggestions-portal \{/,
  );
});

test("empty home keeps the primary task surface focused", () => {
  const emptyStart = chatSurface.indexOf("{!hasTranscript ? (");
  const emptyEnd = chatSurface.indexOf("<ChatTranscript", emptyStart);
  const emptyBlock = chatSurface.slice(emptyStart, emptyEnd);
  const onboardingAt = emptyBlock.indexOf("<OnboardingChecklist />");
  const composerAt = emptyBlock.indexOf("home-composer-wrap");
  assert.notEqual(onboardingAt, -1);
  assert.notEqual(composerAt, -1);
  assert.ok(onboardingAt < composerAt, "onboarding must precede composer in markup");
  assert.match(
    emptyBlock,
    /<div className="home-scroll">[\s\S]*?<\/div>\s*<div className="home-composer-wrap">/,
  );
  assert.doesNotMatch(emptyBlock, /empty-hero-copy/);
  assert.doesNotMatch(emptyBlock, /HomeQuickActions|HomeSuggestions|home-quick-actions|home-suggestion-card/);
});

test("short windows keep the empty stack scrollable rather than overlapping", () => {
  assert.match(styles, /@media \(max-height:\s*760px\)/);
  assert.match(styles, /@media \(max-height:\s*640px\)/);
  assert.match(checklist, /home-onboarding-checklist/);
  assert.doesNotMatch(checklist, /\bmt-6\b/);
});

test("empty home keeps the composer in a bottom region", () => {
  assert.match(
    styles,
    /\.home-composer-wrap\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?padding:\s*0 12px 16px;/,
  );
  assert.match(styles, /\.composer-dock-home\s*\{[\s\S]*?position:\s*relative;/);
  assert.doesNotMatch(styles, /\.home-quick-actions|\.home-quick-action|\.home-suggestion-card/);
});
