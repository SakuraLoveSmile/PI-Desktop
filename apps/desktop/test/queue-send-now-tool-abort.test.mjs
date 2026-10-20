import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import i18next from "i18next";
import { IPC } from "@pi-desktop/shared";

const ABORT_BUTTON = /<button\b[^>]*composer-queued-prompt-abort-tool/g;
const ROW_ACTIONS = (markup) => (markup.match(/<button\b[^>]*>/g) ?? [])
  .filter((button) => !button.includes("composer-queue-heading"));

function createViteServer() {
  return createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
}

const bashRow = (overrides = {}) => ({
  id: "tool-bash-1",
  role: "tool",
  content: "",
  toolName: "Bash",
  toolCallId: "bash-1",
  toolStatus: "running",
  ...overrides,
});

const promotedRow = (id, promotedAt, priority = 0) => ({
  id,
  sessionId: "session-a",
  content: `Message ${id}`,
  draft: { text: `Message ${id}`, fileReferences: [] },
  createdAt: 1,
  priority,
  promotedAt,
});

const waitingRow = (id) => ({
  id,
  sessionId: "session-a",
  content: `Message ${id}`,
  draft: { text: `Message ${id}`, fileReferences: [] },
  createdAt: 1,
});

test("send-now offers an abort on the head promoted row once a top-level Bash has waited 30 seconds", async (t) => {
  const server = await createViteServer();
  try {
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const { ComposerStatus } = await server.ssrLoadModule("/src/features/chat/composer/ComposerStatus.tsx");
    const initial = { ...useAppStore.getInitialState() };
    // Server renders read zustand's initial state, so live fields are patched there (see todo-recovery.test.mjs).
    const render = (queuedPrompts, live = {}, { approvalPending = false } = {}) => {
      Object.assign(useAppStore.getInitialState(), {
        activeSessionId: "session-a",
        runningSessions: { "session-a": true },
        messages: [bashRow()],
        sessions: [],
        ...live,
      });
      return renderToStaticMarkup(createElement(ComposerStatus, {
        t: (key) => key,
        queueScopeKey: "session-a",
        queuedPrompts,
        removeQueuedPrompt: () => {},
        moveQueuedPrompt: async () => {},
        editQueuedPrompt: () => {},
        sendQueuedNow: async () => {},
        approvalPending,
        enhancementError: null,
        clearEnhancementError: () => {},
        droppedDirectories: [],
        openDroppedFolderAsProject: async () => {},
        insertDroppedDirectoryPaths: () => {},
        dismissDroppedDirectories: () => {},
      }));
    };
    try {
      await t.test("offers the abort once the head row has waited 30 seconds behind a running Bash", () => {
        const markup = render([promotedRow("turn-a", Date.now() - 31_000)]);
        assert.equal(markup.match(ABORT_BUTTON)?.length, 1);
        assert.equal(ROW_ACTIONS(markup).length, 6, "the abort is an extra action beside the five existing ones");
      });

      await t.test("stays hidden before the 30 second threshold", () => {
        const markup = render([promotedRow("turn-a", Date.now() - 29_000)]);
        assert.equal(markup.match(ABORT_BUTTON), null);
        assert.equal(ROW_ACTIONS(markup).length, 5);
      });

      await t.test("never targets a subagent Bash, a finished or non-Bash call, or an idle session", () => {
        const due = [promotedRow("turn-a", Date.now() - 31_000)];
        const cases = [
          ["subagent Bash", { messages: [bashRow({ parentToolCallId: "task-1" })] }],
          ["nested Bash", { messages: [bashRow({ nestedParentToolCallId: "task-1" })] }],
          ["finished Bash", { messages: [bashRow({ toolStatus: "success" })] }],
          ["non-Bash tool", { messages: [bashRow({ toolName: "Read" })] }],
          ["idle session", { runningSessions: {} }],
          ["another session is active", { activeSessionId: "session-b" }],
          ["remote session", { sessions: [{ id: "session-a", source: "remote" }] }],
        ];
        for (const [name, live] of cases) {
          assert.equal(render(due, live).match(ABORT_BUTTON), null, name);
        }
      });

      await t.test("only the head promoted row carries the abort; waiting and pending rows never do", () => {
        const markup = render([
          promotedRow("turn-a", Date.now() - 31_000, 0),
          promotedRow("turn-b", Date.now() - 31_000, 1),
          waitingRow("turn-c"),
          waitingRow("pending:turn-d"),
        ]);
        assert.equal(markup.match(ABORT_BUTTON)?.length, 1);
      });

      await t.test("a pending approval hides the abort even when a Bash call is due", () => {
        const markup = render([promotedRow("turn-a", Date.now() - 31_000)], {}, { approvalPending: true });
        assert.equal(markup.match(ABORT_BUTTON), null);
      });
    } finally {
      Object.assign(useAppStore.getInitialState(), initial);
    }
  } finally {
    await server.close();
  }
});

test("send-now stamps the promotion clock and queue refreshes keep the first stamp", async () => {
  const server = await createViteServer();
  const previousWindow = globalThis.window;
  try {
    const { createQueueSlice } = await server.ssrLoadModule("/src/stores/slices/queue-slice.ts");
    let entries = [{ id: "turn-1", sessionId: "session-a", content: "First", position: 1, createdAt: "2026-10-17T00:00:00Z" }];
    globalThis.window = { piDesktop: { invoke: async (channel, payload) => {
      if (channel === IPC.invoke.agentQueueList) return { ok: true, data: { entries } };
      if (channel === IPC.invoke.agentQueuePrioritize) {
        entries = entries.map((entry) => (entry.id === payload.turnId ? { ...entry, priority: 0 } : entry));
        return { ok: true, data: {} };
      }
      throw new Error(`Unexpected IPC: ${channel}`);
    } } };
    let state = { activeSessionId: "session-a", queuedPrompts: {}, runningSessions: {}, showToast: assert.fail };
    const slice = createQueueSlice({
      get: () => state,
      set: (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; },
      promptAttachmentsFromDraft: () => [],
    });
    Object.assign(state, slice);

    await slice.refreshQueuedPrompts("session-a");
    const before = Date.now();
    await slice.sendQueuedNow("turn-1");
    const after = Date.now();
    const promoted = state.queuedPrompts["session-a"][0];
    assert.equal(promoted.priority, 0);
    assert.ok(promoted.promotedAt >= before && promoted.promotedAt <= after, "send now starts the 30 second clock");

    await new Promise((resolve) => setTimeout(resolve, 5));
    await slice.refreshQueuedPrompts("session-a");
    assert.equal(state.queuedPrompts["session-a"][0].promotedAt, promoted.promotedAt, "a Host refresh keeps the first stamp");

    entries = [{ id: "turn-2", sessionId: "session-a", content: "Second", position: 1, createdAt: "2026-10-17T00:00:00Z", priority: 0 }];
    const observed = Date.now();
    await slice.refreshQueuedPrompts("session-a");
    const adopted = state.queuedPrompts["session-a"][0].promotedAt;
    assert.ok(adopted >= observed, "a promoted row this renderer never clicked starts its clock when first seen");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await slice.refreshQueuedPrompts("session-a");
    assert.equal(state.queuedPrompts["session-a"][0].promotedAt, adopted, "repeated refreshes keep that stamp");
  } finally {
    globalThis.window = previousWindow;
    await server.close();
  }
});

test("abort tool asks the Host for the one Bash call and reports why it could not stop it", async () => {
  const server = await createViteServer();
  const previousWindow = globalThis.window;
  try {
    const { createQueueSlice } = await server.ssrLoadModule("/src/stores/slices/queue-slice.ts");
    const { catalogs } = await server.ssrLoadModule(
      fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)),
    );
    // queue-slice translates through the default i18next instance.
    await i18next.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const calls = [];
    let reply;
    globalThis.window = { piDesktop: { invoke: async (channel, payload) => {
      if (channel !== IPC.invoke.agentAbortTool) throw new Error(`Unexpected IPC: ${channel}`);
      calls.push(payload);
      if (reply instanceof Error) throw reply;
      return { ok: true, data: reply };
    } } };
    const toasts = [];
    let state = {
      activeSessionId: "session-a",
      queuedPrompts: {},
      showToast: (message, options) => toasts.push({ message, variant: options?.variant }),
    };
    const slice = createQueueSlice({
      get: () => state,
      set: (patch) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; },
      promptAttachmentsFromDraft: () => [],
    });
    Object.assign(state, slice);

    reply = { found: true, requested: true };
    await slice.abortQueuedPromptTool("session-a", "bash-1");
    assert.deepEqual(calls, [{ sessionId: "session-a", toolCallId: "bash-1" }], "no turnId: the Host matches the active turn");
    assert.deepEqual(toasts, [], "a requested abort needs no toast; the queued row starts when the turn ends");

    reply = { found: false, requested: false };
    await slice.abortQueuedPromptTool("session-a", "bash-1");
    assert.deepEqual(toasts.at(-1), { message: i18next.t("chat.queuedPromptToolAbortGone"), variant: "info" });

    reply = { found: true, requested: false };
    await slice.abortQueuedPromptTool("session-a", "bash-1");
    assert.deepEqual(toasts.at(-1), { message: i18next.t("chat.queuedPromptStopFailed"), variant: "info" });

    reply = new Error("host RPC timeout: agent.abortTool");
    await slice.abortQueuedPromptTool("session-a", "bash-1");
    assert.deepEqual(toasts.at(-1), {
      message: `${i18next.t("chat.queuedPromptStopFailed")} host RPC timeout: agent.abortTool`,
      variant: "error",
    });
  } finally {
    globalThis.window = previousWindow;
    await server.close();
  }
});
