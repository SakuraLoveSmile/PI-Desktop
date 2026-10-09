import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

// Exercise the production component with its real Zustand store. The isolated
// Electron scenario covers opening the dialog and all durable Host actions.
test("bell displays the durable store count for successful and mixed outcomes", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    esbuild: { jsx: "automatic" }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  let restoreSnapshot;
  try {
    const { NotificationCenter } = await server.ssrLoadModule("/src/components/NotificationCenter.tsx");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const snapshot = useAppStore.getInitialState();
    const previous = { notifications: snapshot.notifications, unreadNotificationCount: snapshot.unreadNotificationCount };
    restoreSnapshot = () => Object.assign(snapshot, previous);
    const i18n = createInstance();
    await i18n.init({ lng: "en", keySeparator: false, resources: { en: { translation: {
      "notifications.openUnread": "Notifications: {{count}} unread", "notifications.open": "Notifications",
    } } } });
    const note = (kind) => ({ id: kind, kind, sessionId: "session", sessionTitle: "Session",
      turnId: kind, createdAt: "2026-10-08T10:00:00Z" });
    const render = (notifications, unreadNotificationCount) => {
      // Zustand SSR reads the hydration snapshot rather than the live client snapshot.
      Object.assign(useAppStore.getInitialState(), { notifications, unreadNotificationCount });
      return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(NotificationCenter)));
    };
    const completed = render([note("task.completed")], 1);
    assert.match(completed, /aria-label="Notifications: 1 unread"/);
    assert.match(completed, /notification-badge[^>]*>1<\/span>/);
    const mixed = render([note("task.completed"), note("task.failed")], 2);
    assert.match(mixed, /aria-label="Notifications: 2 unread"/);
    assert.match(mixed, /notification-badge[^>]*>2<\/span>/);
    // Host count can exceed the capped list window. Do not derive it from rows.
    const capped = render([note("task.completed")], 201);
    assert.match(capped, /aria-label="Notifications: 201 unread"/);
    assert.match(capped, /notification-badge[^>]*>99\+<\/span>/);
    assert.doesNotMatch(render([{ ...note("task.completed"), readAt: "2026-10-08T11:00:00Z" }], 0), /class="notification-badge"/);
  } finally {
    restoreSnapshot?.();
    await server.close();
  }
});
