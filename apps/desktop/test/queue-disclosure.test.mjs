import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  initializeQueueDisclosure,
  queueDisclosureExpanded,
  resetEmptyQueueDisclosure,
  toggleQueueDisclosure,
} from "../src/features/chat/composer/queue-disclosure-state.ts";

test("queue disclosure defaults to expanded through three rows and collapsed from four", () => {
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 1), true);
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 3), true);
  assert.equal(queueDisclosureExpanded(new Map(), "session-a", 4), false);
});

test("queue disclosure keeps each scope choice across count changes and resets only an emptied scope", () => {
  let choices = initializeQueueDisclosure(new Map(), "session-a", 4);
  choices = toggleQueueDisclosure(choices, "session-a", 4);
  choices = initializeQueueDisclosure(choices, "session-a", 2);
  choices = initializeQueueDisclosure(choices, "session-b", 1);
  assert.equal(queueDisclosureExpanded(choices, "session-a", 2), true);
  assert.equal(queueDisclosureExpanded(choices, "session-b", 1), true);

  choices = toggleQueueDisclosure(choices, "session-b", 1);
  choices = resetEmptyQueueDisclosure(choices, "session-b");
  assert.equal(choices.has("session-b"), false);
  assert.equal(queueDisclosureExpanded(choices, "session-a", 2), true);
  assert.equal(queueDisclosureExpanded(choices, "session-b", 4), false);
});

test("ComposerStatus renders the disclosure with the original five queue actions", async () => {
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

    const expandedMarkup = render(rows.slice(0, 3));
    assert.match(expandedMarkup, /aria-expanded="true"/);
    assert.match(expandedMarkup, /aria-controls="composer-queue-[^"]+"/);
    assert.match(expandedMarkup, /Next: Queued task 1/);
    assert.equal((expandedMarkup.match(/data-testid="queued-prompt"/g) ?? []).length, 3);

    const collapsedMarkup = render(rows);
    assert.match(collapsedMarkup, /aria-expanded="false"/);
    assert.match(collapsedMarkup, /class="composer-queue-body" hidden=""/);
    assert.equal((collapsedMarkup.match(/data-testid="queued-prompt"/g) ?? []).length, 4);
    assert.equal((collapsedMarkup.match(/class="composer-queued-prompt-(?:action|send-now)/g) ?? []).length, 20);
  } finally {
    await server.close();
  }
});
