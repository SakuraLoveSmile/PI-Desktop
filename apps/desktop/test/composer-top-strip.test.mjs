import assert from "node:assert/strict";
import { createElement } from "react";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

import {
  initialTopStripState,
  syncTopStripState,
  toggleTopStrip,
  topStripExpanded,
} from "../src/features/chat/composer/composer-top-strip-state.ts";

test("the top strip opens while idle, folds during a run, and a manual opening lasts only that run", () => {
  let state = initialTopStripState(false);
  assert.equal(topStripExpanded(state), true);

  state = syncTopStripState(state, true);
  assert.equal(topStripExpanded(state), false, "a run folds the strip");

  state = toggleTopStrip(state);
  assert.equal(topStripExpanded(state), true, "the user can open it during the run");

  state = syncTopStripState(state, false);
  assert.equal(topStripExpanded(state), true, "idle always shows the strip");

  state = syncTopStripState(state, true);
  assert.equal(topStripExpanded(state), false, "the next run starts folded again");
});

test("syncing an unchanged run keeps the same state object, so renders do not loop", () => {
  const state = initialTopStripState(true);
  assert.equal(syncTopStripState(state, true), state);
});

test("ComposerWorkspaceContext lists project and branch while idle and folds to the branch during a run", async (context) => {
  const ssr = await slotSsr(context);
  const { ComposerWorkspaceContext } = await ssr.load("/src/features/chat/composer/ComposerWorkspaceContext.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  // Server renders read zustand's initial state, so the fixture is patched there
  // (see queue-send-now-tool-abort.test.mjs) and restored after the render.
  const initial = { ...useAppStore.getInitialState() };
  Object.assign(useAppStore.getInitialState(), {
    activeSessionId: "local",
    sessions: [{ id: "local", source: "desktop", projectPath: "/isolated/project-a", projectName: "Project A" }],
  });
  const t = (key) => key;
  try {
    const idle = ssr.render(createElement(ComposerWorkspaceContext, { t, running: false }));
    assert.match(idle, /class="composer-top-strip" data-expanded="true"/);
    assert.match(idle, /Project A/);
    assert.doesNotMatch(idle, /composer-top-strip-toggle/, "an idle strip has nothing to fold");

    const running = ssr.render(createElement(ComposerWorkspaceContext, { t, running: true }));
    assert.match(running, /class="composer-top-strip" data-expanded="false"/);
    assert.doesNotMatch(running, /Project A/, "the project name folds away during a run");
    assert.match(running, /class="composer-top-strip-toggle"[^>]*aria-expanded="false"[^>]*aria-label="chat.topStripExpand"/);
  } finally {
    Object.assign(useAppStore.getInitialState(), initial);
  }
});
