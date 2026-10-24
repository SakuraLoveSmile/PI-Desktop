import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  queueDisclosureExpanded,
  resetEmptyQueueDisclosure,
  toggleQueueDisclosure,
} from "../src/features/chat/composer/queue-disclosure-state.ts";

test("queue disclosure folds two or more rows by default and always lists a single row", () => {
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 1), true);
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 2), false);
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 4), false);
});

test("queue disclosure keeps only explicit choices per scope and resets an emptied scope", () => {
  let choices = toggleQueueDisclosure(new Map(), "session-a", 4);
  assert.equal(queueDisclosureExpanded(choices, "session-a", 2), true, "a manual expansion survives count changes");

  choices = toggleQueueDisclosure(choices, "session-b", 1);
  assert.equal(queueDisclosureExpanded(choices, "session-b", 1), false);
  choices = resetEmptyQueueDisclosure(choices, "session-b");
  assert.equal(choices.has("session-b"), false);
  assert.equal(queueDisclosureExpanded(choices, "session-b", 2), false, "an emptied scope folds again once it refills");
  assert.equal(queueDisclosureExpanded(choices, "session-a", 2), true);
});

test("ComposerStatus folds two or more queued rows behind one summary and lists a single row plainly", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { ComposerStatus } = await server.ssrLoadModule(
      "/src/features/chat/composer/ComposerStatus.tsx",
    );
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `turn-${index + 1}`,
      sessionId: "session-a",
      content: `Queued task ${index + 1}`,
      draft: { text: `Queued task ${index + 1}`, fileReferences: [] },
      createdAt: index,
    }));
    const render = (queuedPrompts) => renderToStaticMarkup(createElement(ComposerStatus, {
      t: (key, options) => key === "chat.queueNext" ? `Next: ${options.message}` : key,
      queueScopeKey: "session-a",
      queuedPrompts,
      removeQueuedPrompt() {},
      moveQueuedPrompt: async () => {},
      editQueuedPrompt() {},
      sendQueuedNow: async () => {},
      approvalPending: false,
      enhancementError: null,
      clearEnhancementError() {},
      droppedDirectories: [],
      openDroppedFolderAsProject: async () => {},
      insertDroppedDirectoryPaths() {},
      dismissDroppedDirectories() {},
    }));

    const single = render(rows.slice(0, 1));
    assert.doesNotMatch(single, /composer-queue-heading/, "one row has no summary to fold");
    assert.doesNotMatch(single, /class="composer-queue-body" hidden=""/);
    assert.equal((single.match(/data-testid="queued-prompt"/g) ?? []).length, 1);

    const folded = render(rows);
    assert.match(folded, /class="[^"]*composer-queue-heading[^"]*"[^>]*aria-expanded="false"/);
    assert.match(folded, /aria-controls="composer-queue-[^"]+"/);
    assert.match(folded, /Next: Queued task 1/);
    assert.match(folded, /class="composer-queue-body" hidden=""/);
    assert.equal((folded.match(/data-testid="queued-prompt"/g) ?? []).length, 4);
    assert.equal((folded.match(/composer-queued-prompt-more/g) ?? []).length, 4, "every row keeps its ⋯ trigger");
    assert.equal((folded.match(/class="composer-queued-prompt-send-now"/g) ?? []).length, 4);
  } finally {
    await server.close();
  }
});
