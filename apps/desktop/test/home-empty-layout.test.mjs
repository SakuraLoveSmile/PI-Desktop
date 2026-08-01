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
  assert.match(chatSurface, /home-composer-wrap/);
  assert.doesNotMatch(
    chatSurface,
    /HomeSuggestions|home-suggestions-block|home-upper|home-lower|home-suggestions-portal/,
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
  assert.match(emptyBlock, /<HomeQuickActions[\s\S]*?onPrefill=/);
  assert.doesNotMatch(emptyBlock, /empty-hero-copy/);
  assert.doesNotMatch(emptyBlock, /HomeSuggestions|home-suggestion-card/);
});

test("short windows keep the empty stack scrollable rather than overlapping", () => {
  assert.match(styles, /@media \(max-height:\s*760px\)/);
  assert.match(styles, /@media \(max-height:\s*640px\)/);
  assert.match(checklist, /home-onboarding-checklist/);
  assert.doesNotMatch(checklist, /\bmt-6\b/);
});

test("empty home keeps optional actions collapsed by default", async () => {
  const quickActions = await read("../src/components/HomeQuickActions.tsx");
  assert.match(quickActions, /<details/);
  assert.doesNotMatch(quickActions, /<details[^>]*\bopen\b/);
  assert.match(quickActions, /<summary className="home-quick-actions-trigger">/);
  assert.match(quickActions, /data-testid="home-quick-actions"/);
  assert.match(quickActions, /quickActionInspectPrompt/);
  assert.match(quickActions, /quickActionOpenProject/);
  assert.match(styles, /\.home-quick-actions-list\s*\{/);
  assert.match(styles, /\.home-quick-actions-trigger\s*\{/);
  assert.match(styles, /\.home-quick-actions\[open\]/);
  assert.match(styles, /\.home-quick-action\s*\{[\s\S]*?border-radius:\s*var\(--radius-full\)/);
  assert.doesNotMatch(styles, /\.home-suggestion-card/);
});
