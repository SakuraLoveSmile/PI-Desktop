import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/*
 * The context-usage entry lives at the right end of the workspace strip above
 * the input (D652). Server rendering is the first frame of a mount: the
 * popover opens on a click and is portaled to the body, so what it lays out is
 * covered by the Electron E2E; the parts that carry behavior are rendered here.
 */

// 24K uncached input + 76K cache reads: a 76% cache hit rate.
const totals = {
  rounds: 3,
  steps: 12,
  inputTokens: 24_000,
  outputTokens: 4_000,
  cacheReadTokens: 76_000,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 148_000,
};
const lastRequest = { inputTokens: 1_000, outputTokens: 200, totalTokens: 1_200 };
const footerProps = { usage: lastRequest, turnUsage: lastRequest, contextWindow: 200_000, tools: [], variant: "footer" };

test("the session block reports rounds, steps, the token total and the cache hit rate", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerUsageStats } = await ssr.load("/src/features/chat/composer/ComposerUsageStats.tsx");
  const html = ssr.render(createElement(ComposerUsageStats, { totals }), { sessionId: null });
  assert.match(html, /<span class="context-inspector-label">Session<\/span>/);
  assert.match(html, /aria-label="Session: 3 rounds, 12 steps"[^>]*>[\s\S]*<b>3 rounds<\/b><span aria-hidden="true">·<\/span><b>12 steps<\/b>/);
  assert.match(html, /aria-label="Session total 148K tokens, cache hit 76%"[^>]*>[\s\S]*<b>148K tok<\/b><span aria-hidden="true">·<\/span><span>cache<\/span><b>76%<\/b>/);
  assert.doesNotMatch(html, /tok\/s|tokens\/s/, "generation speed has its own cell in the turn summary");
  assert.doesNotMatch(html, /data-unavailable="true"/);
});

test("the session block says so when the totals are not available yet", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerUsageStats } = await ssr.load("/src/features/chat/composer/ComposerUsageStats.tsx");
  const html = ssr.render(createElement(ComposerUsageStats, { totals: undefined }), { sessionId: null });
  assert.equal(html.match(/aria-label="Session usage unavailable"/g)?.length, 2, "both rows are announced as unavailable");
  assert.equal(html.match(/data-unavailable="true"/g)?.length, 2);
  assert.doesNotMatch(html, /rounds|steps/);
  assert.match(html, /<b>—<\/b>/);
});

test("a session without cache reads reports the cache hit rate as unavailable, not as 0%", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerUsageStats, sessionTokensAria } = await ssr.load("/src/features/chat/composer/ComposerUsageStats.tsx");
  const uncached = { ...totals, inputTokens: 0, cacheReadTokens: 0 };
  const html = ssr.render(createElement(ComposerUsageStats, { totals: uncached }), { sessionId: null });
  assert.match(html, /aria-label="Session total 148K tokens, cache hit —"/);
  assert.match(html, /<span>Cache hit rate unavailable<\/span>/);
  assert.doesNotMatch(html, /<b>0%<\/b>/);
  assert.equal(sessionTokensAria((key, values) => `${key}:${values.tokens}:${values.cache}`, totals), "chat.usageSessionTokensAria:148K:76%");
});

test("the strip trigger prints the context percentage and the session total, and describes the total", async (t) => {
  const ssr = await slotSsr(t);
  const { ContextUsageInspector } = await ssr.load("/src/components/ContextUsageInspector.tsx");
  const html = ssr.render(createElement(ContextUsageInspector, { ...footerProps, sessionTotals: totals }));
  assert.match(
    html,
    /<span class="composer-usage-label">Used<\/span><span class="composer-usage-value">1%<\/span><span class="composer-usage-sep" aria-hidden="true">·<\/span><span class="composer-usage-session">148K tok<\/span><\/button>/,
  );
  // The name stays the context sentence; a label would otherwise hide the total.
  assert.match(html, /<button[^>]*aria-label="1% context used, 1\.2K tokens"/);
  const noteId = html.match(/<button[^>]*aria-describedby="([^"]+)"/)?.[1];
  assert.ok(noteId, "the trigger points at a description");
  assert.ok(
    html.includes(`<span id="${noteId}" hidden="">Session total 148K tokens, cache hit 76%</span>`),
    "the description carries the session total",
  );
});

test("the strip trigger shows the context alone while the session total is unavailable", async (t) => {
  const ssr = await slotSsr(t);
  const { ContextUsageInspector } = await ssr.load("/src/components/ContextUsageInspector.tsx");
  const html = ssr.render(createElement(ContextUsageInspector, footerProps));
  assert.match(html, /<span class="composer-usage-value">1%<\/span><\/button>/);
  assert.doesNotMatch(html, /composer-usage-session|composer-usage-sep|aria-describedby/);
});

test("the unavailable placeholder is the bare entry, with no footer wrapper around it", async (t) => {
  const ssr = await slotSsr(t);
  const { ContextUsagePlaceholder } = await ssr.load("/src/features/chat/composer/ContextUsagePlaceholder.tsx");
  const html = ssr.render(createElement(ContextUsagePlaceholder));
  assert.ok(html.startsWith('<div class="composer-usage-item composer-usage-context" data-unavailable="true">'), html);
  assert.doesNotMatch(html, /composer-usage-footer/);
});

test("the workspace strip closes on the usage entry, outside the workspace controls", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerWorkspaceContext } = await ssr.load("/src/features/chat/composer/ComposerWorkspaceContext.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  // Server renders read zustand's initial state, so the fixture is patched there
  // and restored after the render (see composer-top-strip.test.mjs).
  const initial = { ...useAppStore.getInitialState() };
  Object.assign(useAppStore.getInitialState(), {
    activeSessionId: "local",
    sessions: [{ id: "local", source: "desktop", projectPath: "/isolated/project-a", projectName: "Project A" }],
  });
  const strings = (key) => key;
  const usage = createElement("div", { className: "composer-usage-item", id: "usage-entry" }, "usage");
  try {
    for (const running of [false, true]) {
      const html = ssr.render(createElement(ComposerWorkspaceContext, { t: strings, running, usage }));
      const contextEnd = html.indexOf('<div class="composer-usage-item" id="usage-entry">');
      assert.ok(contextEnd > 0, "the usage entry is rendered");
      assert.ok(html.endsWith('<div class="composer-usage-item" id="usage-entry">usage</div></div>'), "and it is the strip's last child");
      assert.ok(
        html.lastIndexOf('<div class="composer-workspace-context">', contextEnd) >= 0 &&
          !html.slice(html.indexOf('<div class="composer-workspace-context">'), contextEnd).includes("usage-entry"),
        "it sits after the workspace controls rather than inside them",
      );
    }
    const bare = ssr.render(createElement(ComposerWorkspaceContext, { t: strings, running: false }));
    assert.doesNotMatch(bare, /composer-usage-item/, "a strip with no usage entry renders none");
  } finally {
    Object.assign(useAppStore.getInitialState(), initial);
  }
});

test("during a run the fold toggle joins the branch trigger in one group", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerWorkspaceContext } = await ssr.load("/src/features/chat/composer/ComposerWorkspaceContext.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  const initial = { ...useAppStore.getInitialState() };
  Object.assign(useAppStore.getInitialState(), {
    activeSessionId: "local",
    sessions: [{ id: "local", source: "desktop", projectPath: "/isolated/project-a", projectName: "Project A" }],
  });
  const strings = (key) => key;
  try {
    const group = (html) => html.match(/<div class="composer-workspace-branch">([\s\S]*?)<\/div><\/div>(?:<div class="composer-usage-item"|$)/)?.[1] ?? "";
    const running = group(ssr.render(createElement(ComposerWorkspaceContext, { t: strings, running: true })));
    assert.match(running, /composer-footer-trigger[\s\S]*<button[^>]*class="composer-top-strip-toggle"/, "the toggle follows the branch trigger");
    const idle = group(ssr.render(createElement(ComposerWorkspaceContext, { t: strings, running: false })));
    assert.match(idle, /composer-footer-trigger/);
    assert.doesNotMatch(idle, /composer-top-strip-toggle/, "an idle strip has nothing to fold");
  } finally {
    Object.assign(useAppStore.getInitialState(), initial);
  }
});
